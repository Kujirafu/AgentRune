// server/automation-manager.ts
// Manages scheduled automations — runs agent commands on intervals/cron/events
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { getConfigDir } from "../shared/config.js"
import { log } from "../shared/logger.js"
import { VaultSync } from "./vault-sync.js"
import { WorktreeManager } from "./worktree-manager.js"
import type { PtyManager } from "./pty-manager.js"
import type { Project } from "../shared/types.js"

// --- Types ---

export type ScheduleType = "daily" | "interval"

export interface AutomationSchedule {
  type: ScheduleType
  timeOfDay?: string        // "09:00" (daily mode)
  weekdays?: number[]       // [0-6], 0=Sun 1=Mon...6=Sat
  intervalMinutes?: number  // (interval mode)
}

export interface AutomationConfig {
  id: string
  projectId: string
  name: string
  command?: string          // legacy raw command
  prompt?: string           // natural language prompt for agent
  skill?: string            // MCP skill name
  templateId?: string
  schedule: AutomationSchedule
  runMode: "local" | "worktree"
  agentId: string
  model?: string            // e.g. "sonnet", "opus", "haiku" (agent-specific)
  bypass?: boolean           // --dangerously-skip-permissions (unattended mode)
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  lastRunStatus?: "success" | "failed" | "timeout"
}

export interface AutomationResult {
  id: string
  automationId: string
  startedAt: number
  finishedAt: number
  exitCode: number | null
  output: string
  status: "success" | "failed" | "timeout"
}

// --- Locale detection ---

function getSystemLocale(): string {
  // Check env vars (Unix: LANG/LC_ALL, Windows: handled by Intl)
  const envLang = process.env.LANG || process.env.LC_ALL || ""
  if (envLang.startsWith("zh")) return "zh-TW"
  if (envLang.startsWith("ja")) return "ja"
  if (envLang.startsWith("ko")) return "ko"
  // Fallback to Intl
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    if (locale.startsWith("zh")) return "zh-TW"
    if (locale.startsWith("ja")) return "ja"
    if (locale.startsWith("ko")) return "ko"
  } catch {}
  return "en"
}

const LOCALE_NAMES: Record<string, string> = {
  "zh-TW": "Traditional Chinese (繁體中文)",
  "ja": "Japanese (日本語)",
  "ko": "Korean (한국어)",
  "en": "English",
}

export function wrapPromptWithLocale(prompt: string): string {
  const locale = getSystemLocale()
  if (locale === "en") return prompt
  const langName = LOCALE_NAMES[locale] || locale
  return `[System] Respond in ${langName}. All output, summaries, and reports must be in ${langName}.\n\n${prompt}`
}

// --- Agent protocol (shared with ws-server) ---

function buildAgentProtocol(locale?: string): string {
  const langHint = locale ? ` Respond in the user's language (${locale}).` : ""
  return [
    "AGENTRUNE PROTOCOL: You are running inside AgentRune.",
    `FIRST ACTION (mandatory, before anything else): If .agentrune/rules.md exists, read it and follow the behavior rules strictly. Then read .agentrune/agentlore.md (your project memory — treat it like memory.md). If agentlore.md does not exist, create it (mkdir -p .agentrune) by scanning the project.${langHint}`,
    "MEMORY: .agentrune/agentlore.md IS your memory. Read it at session start, write to it when you learn something. Do NOT use CLAUDE.md, .claude/memory/, or any agent-native memory system — user cannot see those.",
  ].join(" ")
}

/** Escape a string for use as a single shell argument */
function shellEscape(s: string): string {
  // Use $'...' syntax which handles newlines and special chars
  return "$'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r") + "'"
}

// --- Manager ---

export type AutomationEventCallback = (event: {
  type: "automation_completed"
  automation: AutomationConfig
  result: AutomationResult
}) => void

// --- Rate limiting ---

export interface AutomationLimits {
  maxAutomations: number       // max concurrent automations
  maxDailyExecutions: number   // max executions per day (across all automations)
}

export const FREE_LIMITS: AutomationLimits = { maxAutomations: 3, maxDailyExecutions: 5 }
export const PRO_LIMITS: AutomationLimits = { maxAutomations: 50, maxDailyExecutions: 500 }

export class AutomationManager {
  private automations = new Map<string, AutomationConfig>()
  private timers = new Map<string, NodeJS.Timeout>()
  private nextRunAtMap = new Map<string, number>()  // track next trigger timestamp
  private results = new Map<string, AutomationResult[]>()
  private dailyExecCount = new Map<string, number>()  // "YYYY-MM-DD" → count
  private storageDir: string
  private ptyManager: PtyManager
  private projects: Project[]
  private onEvent?: AutomationEventCallback
  private vaultPath?: string
  private limits: AutomationLimits

  private static MAX_RESULTS_PER_AUTOMATION = 20
  private static MAX_OUTPUT_BYTES = 50_000

  constructor(ptyManager: PtyManager, projects: Project[], onEvent?: AutomationEventCallback, opts?: { vaultPath?: string; limits?: AutomationLimits }) {
    this.ptyManager = ptyManager
    this.projects = projects
    this.onEvent = onEvent
    this.vaultPath = opts?.vaultPath
    this.limits = opts?.limits || FREE_LIMITS
    this.storageDir = join(getConfigDir(), "automations")
    mkdirSync(this.storageDir, { recursive: true })
    this.loadFromDisk()
  }

  /** Update projects reference (when projects list changes) */
  updateProjects(projects: Project[]) {
    this.projects = projects
  }

  // --- CRUD ---

  /** Update rate limits (e.g. when user upgrades to pro) */
  setLimits(limits: AutomationLimits) {
    this.limits = limits
  }

  add(config: Omit<AutomationConfig, "id" | "createdAt">): AutomationConfig | { error: string } {
    // Check automation count limit
    if (this.automations.size >= this.limits.maxAutomations) {
      return { error: `Automation limit reached (max ${this.limits.maxAutomations}). Upgrade to add more.` }
    }
    const id = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const automation: AutomationConfig = {
      ...config,
      id,
      createdAt: Date.now(),
      runMode: config.runMode || "local",
      agentId: config.agentId || "claude",
    }
    this.automations.set(id, automation)
    this.results.set(id, [])
    this.saveToDisk()

    if (automation.enabled) {
      this.startSchedule(automation)
    }
    return automation
  }

  remove(id: string): boolean {
    this.stopSchedule(id)
    const deleted = this.automations.delete(id)
    this.results.delete(id)
    if (deleted) this.saveToDisk()
    return deleted
  }

  list(projectId?: string): (AutomationConfig & { nextRunAt?: number; lastResult?: { status: string; startedAt: number; finishedAt?: number; duration?: number } })[] {
    const all = [...this.automations.values()].map(a => {
      const results = this.results.get(a.id) || []
      const last = results.length > 0 ? results[results.length - 1] : undefined
      return {
        ...a,
        nextRunAt: this.nextRunAtMap.get(a.id),
        lastResult: last ? {
          status: last.status,
          startedAt: last.startedAt,
          finishedAt: last.finishedAt,
          duration: last.finishedAt - last.startedAt,
        } : undefined,
      }
    })
    if (projectId) return all.filter((a) => a.projectId === projectId)
    return all
  }

  get(id: string): AutomationConfig | undefined {
    return this.automations.get(id)
  }

  enable(id: string): boolean {
    const auto = this.automations.get(id)
    if (!auto) return false
    auto.enabled = true
    this.startSchedule(auto)
    this.saveToDisk()
    return true
  }

  disable(id: string): boolean {
    const auto = this.automations.get(id)
    if (!auto) return false
    auto.enabled = false
    this.stopSchedule(id)
    this.saveToDisk()
    return true
  }

  update(id: string, updates: Partial<Pick<AutomationConfig, "name" | "command" | "prompt" | "skill" | "schedule" | "enabled" | "runMode" | "agentId" | "model" | "templateId" | "bypass">>): (AutomationConfig & { nextRunAt?: number }) | null {
    const auto = this.automations.get(id)
    if (!auto) return null

    const wasEnabled = auto.enabled
    const oldSchedule = JSON.stringify(auto.schedule)

    if (updates.name !== undefined) auto.name = updates.name
    if (updates.command !== undefined) auto.command = updates.command
    if (updates.prompt !== undefined) auto.prompt = updates.prompt
    if (updates.skill !== undefined) auto.skill = updates.skill
    if (updates.schedule !== undefined) auto.schedule = updates.schedule
    if (updates.enabled !== undefined) auto.enabled = updates.enabled
    if (updates.runMode !== undefined) auto.runMode = updates.runMode
    if (updates.agentId !== undefined) auto.agentId = updates.agentId
    if (updates.model !== undefined) auto.model = updates.model
    if (updates.templateId !== undefined) auto.templateId = updates.templateId
    if (updates.bypass !== undefined) auto.bypass = updates.bypass

    const scheduleChanged = JSON.stringify(auto.schedule) !== oldSchedule
    const enabledChanged = wasEnabled !== auto.enabled

    // Only restart timer if schedule or enabled state changed
    if (scheduleChanged || enabledChanged) {
      if (wasEnabled) this.stopSchedule(id)
      if (auto.enabled) this.startSchedule(auto)
    }

    this.saveToDisk()
    return { ...auto, nextRunAt: this.nextRunAtMap.get(id) }
  }

  getResults(id: string): AutomationResult[] {
    return this.results.get(id) || []
  }

  // --- Scheduling ---

  private startSchedule(auto: AutomationConfig) {
    this.stopSchedule(auto.id) // clear any existing

    if (auto.schedule.type === "interval") {
      const ms = (auto.schedule.intervalMinutes || 30) * 60 * 1000
      log.info(`[Automation] Starting interval for "${auto.name}" every ${auto.schedule.intervalMinutes}m`)
      this.nextRunAtMap.set(auto.id, Date.now() + ms)
      const timer = setInterval(() => {
        this.nextRunAtMap.set(auto.id, Date.now() + ms)
        this.executeAutomation(auto.id)
      }, ms)
      this.timers.set(auto.id, timer)
    } else if (auto.schedule.type === "daily") {
      this.scheduleDailyNext(auto)
    }
  }

  /** Calculate ms until next daily trigger, then setTimeout */
  private scheduleDailyNext(auto: AutomationConfig) {
    const { timeOfDay, weekdays } = auto.schedule
    if (!timeOfDay) return

    const [hours, minutes] = timeOfDay.split(":").map(Number)
    const now = new Date()
    const allowedDays = weekdays && weekdays.length > 0 ? weekdays : [0, 1, 2, 3, 4, 5, 6]

    // Find next matching day+time
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(now)
      candidate.setDate(candidate.getDate() + offset)
      candidate.setHours(hours, minutes, 0, 0)

      // Skip if already passed today
      if (candidate.getTime() <= now.getTime()) continue
      // Skip if day not in allowed weekdays
      if (!allowedDays.includes(candidate.getDay())) continue

      const ms = candidate.getTime() - now.getTime()
      log.info(`[Automation] Scheduling daily "${auto.name}" at ${timeOfDay} — next in ${Math.round(ms / 60000)}m`)
      this.nextRunAtMap.set(auto.id, candidate.getTime())

      const timer = setTimeout(() => {
        this.executeAutomation(auto.id)
        // Reschedule for next occurrence
        const current = this.automations.get(auto.id)
        if (current?.enabled) {
          this.scheduleDailyNext(current)
        }
      }, ms)
      this.timers.set(auto.id, timer)
      return
    }

    log.warn(`[Automation] No valid next day found for "${auto.name}" — no weekdays selected?`)
  }

  private stopSchedule(id: string) {
    const timer = this.timers.get(id)
    if (timer) {
      clearTimeout(timer)   // works for both setTimeout and setInterval
      clearInterval(timer)
      this.timers.delete(id)
    }
    this.nextRunAtMap.delete(id)
  }

  /** Build the agent CLI command for an automation */
  private buildAutomationCommand(auto: AutomationConfig): { agentCmd: string; promptText: string } | null {
    const rawPrompt = auto.prompt || ""
    let promptText = wrapPromptWithLocale(rawPrompt)

    // Legacy raw command field is no longer supported for direct execution (security: command injection risk).
    // If automation only has command and no prompt, treat the command as a prompt description.
    if (auto.command && !auto.prompt) {
      promptText = wrapPromptWithLocale(auto.command)
    }

    // Inject skill instruction into prompt if specified
    if (auto.skill) {
      promptText = `[Important] Use the MCP skill "${auto.skill}" to accomplish this task. Call the relevant MCP tool for this skill before proceeding.\n\n${promptText}`
    }

    // Build agent command based on agentId
    const locale = getSystemLocale()
    switch (auto.agentId) {
      case "claude": {
        let cmd = "claude --print"
        if (auto.model && /^[a-zA-Z0-9._-]+$/.test(auto.model)) cmd += ` --model ${auto.model}`
        if (auto.bypass) cmd += " --dangerously-skip-permissions"
        cmd += ` --append-system-prompt "${buildAgentProtocol(locale).replace(/"/g, '\\"')}"`
        // Pass prompt via -p flag with escaped content
        cmd += ` -p ${shellEscape(promptText)}`
        return { agentCmd: cmd, promptText: "" }
      }
      case "codex": {
        let cmd = "codex --full-auto"
        if (auto.model && /^[a-zA-Z0-9._-]+$/.test(auto.model)) cmd += ` --model ${auto.model}`
        cmd += ` -q ${shellEscape(promptText)}`
        return { agentCmd: cmd, promptText: "" }
      }
      default: {
        // For other agents (aider, gemini, etc.), launch agent then send prompt
        // Validate agentId to prevent command injection
        const agentBin = auto.agentId && /^[a-zA-Z0-9_-]+$/.test(auto.agentId) ? auto.agentId : "claude"
        return { agentCmd: agentBin, promptText }
      }
    }
  }

  /** Manually trigger an automation (ignores schedule, respects rate limits) */
  async trigger(id: string): Promise<{ ok: boolean; error?: string }> {
    const auto = this.automations.get(id)
    if (!auto) return { ok: false, error: "Automation not found" }

    // Rate limit check
    const todayKey = new Date().toISOString().slice(0, 10)
    const todayCount = this.dailyExecCount.get(todayKey) || 0
    if (todayCount >= this.limits.maxDailyExecutions) {
      return { ok: false, error: `Daily execution limit reached (max ${this.limits.maxDailyExecutions}). Upgrade for more.` }
    }

    // Execute regardless of enabled state (manual trigger)
    await this.executeAutomation(id, true)
    return { ok: true }
  }

  /** Execute an automation: open a PTY, launch agent, collect output */
  private async executeAutomation(id: string, manualTrigger = false) {
    const auto = this.automations.get(id)
    if (!auto || (!auto.enabled && !manualTrigger)) return

    // Daily rate limit check
    const todayKey = new Date().toISOString().slice(0, 10)
    const todayCount = this.dailyExecCount.get(todayKey) || 0
    if (todayCount >= this.limits.maxDailyExecutions) {
      log.warn(`[Automation] Daily execution limit reached (${this.limits.maxDailyExecutions}), skipping "${auto.name}"`)
      return
    }
    this.dailyExecCount.set(todayKey, todayCount + 1)

    const project = this.projects.find((p) => p.id === auto.projectId)
    if (!project) {
      log.warn(`[Automation] Project "${auto.projectId}" not found for automation "${auto.name}"`)
      return
    }

    const built = this.buildAutomationCommand(auto)
    if (!built) {
      log.warn(`[Automation] Could not build command for "${auto.name}" (agent=${auto.agentId})`)
      return
    }

    // Worktree setup — create isolated worktree if runMode === "worktree"
    let worktree: { path: string; branch: string } | null = null
    let worktreeManager: WorktreeManager | null = null
    if (auto.runMode === "worktree") {
      try {
        worktreeManager = new WorktreeManager(project.cwd)
        const sessionId = `automation_${id}_${Date.now()}`
        const slug = auto.name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 30)
        const wt = worktreeManager.create(sessionId, slug)
        worktree = { path: wt.path, branch: wt.branch }
        log.info(`[Automation] Created worktree for "${auto.name}" at ${wt.path} (branch: ${wt.branch})`)
      } catch (err) {
        log.warn(`[Automation] Failed to create worktree for "${auto.name}": ${err}`)
        // Fallback to local mode
      }
    }

    // Use worktree project if available, otherwise original project
    const execProject = worktree ? { ...project, cwd: worktree.path } : project

    log.info(`[Automation] Executing "${auto.name}" in ${execProject.cwd} (agent=${auto.agentId}, model=${auto.model || "default"}, bypass=${!!auto.bypass}, worktree=${!!worktree})`)

    const startedAt = Date.now()
    let output = ""
    let exitCode: number | null = null
    let status: AutomationResult["status"] = "success"

    try {
      // Create a temporary PTY session for this automation
      const sessionId = `automation_${id}_${Date.now()}`
      const session = this.ptyManager.create(execProject, "automation", sessionId)

      // Collect output
      const outputChunks: string[] = []
      const dataHandler = (sid: string, data: string) => {
        if (sid === sessionId) {
          outputChunks.push(data)
        }
      }
      this.ptyManager.on("data", dataHandler)

      // Wait for shell to initialize
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // If worktree, cd into it first
      if (worktree) {
        this.ptyManager.write(sessionId, `cd ${shellEscape(worktree.path)}\n`)
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      // Send the agent command (e.g. "claude --print -p 'prompt'")
      this.ptyManager.write(sessionId, built.agentCmd + "\n")

      // If agent needs interactive prompt (non-print mode), send it after agent starts
      if (built.promptText) {
        await new Promise((resolve) => setTimeout(resolve, 3000))
        this.ptyManager.write(sessionId, built.promptText + "\n")
      }

      // Wait for agent to finish (with timeout)
      // Agent tasks like Moltbook posting can take a while — allow 10 minutes
      const TIMEOUT_MS = 10 * 60 * 1000
      const result = await new Promise<{ exitCode: number | null; timedOut: boolean }>((resolve) => {
        let resolved = false

        const exitHandler = (sid: string) => {
          if (sid === sessionId && !resolved) {
            resolved = true
            resolve({ exitCode: 0, timedOut: false })
          }
        }
        this.ptyManager.on("exit", exitHandler)

        // Idle detection: if no output for 30 seconds, consider done
        // (agent --print mode exits on completion, but interactive agents may not)
        let idleTimer: NodeJS.Timeout | null = null
        const IDLE_MS = 30_000
        const resetIdle = () => {
          if (idleTimer) clearTimeout(idleTimer)
          idleTimer = setTimeout(() => {
            if (!resolved) {
              resolved = true
              this.ptyManager.removeListener("exit", exitHandler)
              this.ptyManager.kill(sessionId)
              resolve({ exitCode: 0, timedOut: false })
            }
          }, IDLE_MS)
        }

        const idleDataHandler = (sid: string, _data: string) => {
          if (sid === sessionId) resetIdle()
        }
        this.ptyManager.on("data", idleDataHandler)

        // Start idle detection after giving agent time to start
        setTimeout(() => resetIdle(), 5000)

        // Hard timeout
        setTimeout(() => {
          if (!resolved) {
            resolved = true
            this.ptyManager.removeListener("exit", exitHandler)
            this.ptyManager.removeListener("data", idleDataHandler)
            this.ptyManager.kill(sessionId)
            resolve({ exitCode: null, timedOut: true })
          }
        }, TIMEOUT_MS)
      })

      this.ptyManager.removeListener("data", dataHandler)
      output = outputChunks.join("")
      if (output.length > AutomationManager.MAX_OUTPUT_BYTES) {
        output = output.slice(-AutomationManager.MAX_OUTPUT_BYTES)
      }
      exitCode = result.exitCode
      status = result.timedOut ? "timeout" : "success"
    } catch (err) {
      output = err instanceof Error ? err.message : String(err)
      status = "failed"
    }

    const resultEntry: AutomationResult = {
      id: `result_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      automationId: id,
      startedAt,
      finishedAt: Date.now(),
      exitCode,
      output,
      status,
    }

    // Store result (ring buffer)
    const results = this.results.get(id) || []
    results.push(resultEntry)
    if (results.length > AutomationManager.MAX_RESULTS_PER_AUTOMATION) {
      results.splice(0, results.length - AutomationManager.MAX_RESULTS_PER_AUTOMATION)
    }
    this.results.set(id, results)
    this.saveResultsToDisk(id)

    // Update automation with last run info
    auto.lastRunAt = resultEntry.finishedAt
    auto.lastRunStatus = status
    this.saveToDisk()

    const durationMs = resultEntry.finishedAt - startedAt
    log.info(`[Automation] "${auto.name}" finished: ${status} (${durationMs}ms)${worktree ? ` [worktree: ${worktree.branch}]` : ""}`)

    // Write to Obsidian vault if configured
    if (this.vaultPath) {
      try {
        const vault = new VaultSync({ vaultPath: this.vaultPath, projectName: project.name })
        const durationStr = durationMs < 60000 ? `${Math.round(durationMs / 1000)}s` : `${Math.round(durationMs / 60000)}m`
        vault.writeProgress({
          title: `[Automation] ${auto.name}`,
          status: status === "success" ? "done" : "blocked",
          summary: `${status === "success" ? "Completed" : status === "timeout" ? "Timed out" : "Failed"} in ${durationStr}${worktree ? ` (branch: ${worktree.branch})` : ""}`,
          nextSteps: status !== "success" ? ["Check automation output for details"] : [],
          details: output.length > 2000 ? output.slice(-2000) : output,
        })
      } catch (err) {
        log.warn(`[Automation] Failed to write vault record: ${err}`)
      }
    }

    // Broadcast completion event
    if (this.onEvent) {
      this.onEvent({ type: "automation_completed", automation: auto, result: resultEntry })
    }
  }

  // --- Persistence ---

  private getAutomationsFile(): string {
    return join(this.storageDir, "automations.json")
  }

  private getResultsFile(automationId: string): string {
    return join(this.storageDir, `results_${automationId}.json`)
  }

  private saveToDisk() {
    const data = [...this.automations.values()]
    writeFileSync(this.getAutomationsFile(), JSON.stringify(data, null, 2))
  }

  private saveResultsToDisk(automationId: string) {
    const results = this.results.get(automationId) || []
    writeFileSync(this.getResultsFile(automationId), JSON.stringify(results, null, 2))
  }

  private loadFromDisk() {
    try {
      const filePath = this.getAutomationsFile()
      if (!existsSync(filePath)) return

      const data: AutomationConfig[] = JSON.parse(readFileSync(filePath, "utf-8"))
      for (const auto of data) {
        this.automations.set(auto.id, auto)
        // Load results
        try {
          const resultsPath = this.getResultsFile(auto.id)
          if (existsSync(resultsPath)) {
            this.results.set(auto.id, JSON.parse(readFileSync(resultsPath, "utf-8")))
          } else {
            this.results.set(auto.id, [])
          }
        } catch {
          this.results.set(auto.id, [])
        }
        // Resume enabled schedules
        if (auto.enabled) {
          this.startSchedule(auto)
        }
      }
      log.info(`[Automation] Loaded ${data.length} automations from disk`)
    } catch (err) {
      log.warn(`[Automation] Failed to load automations: ${err}`)
    }
  }

  /** Stop all timers (for graceful shutdown) */
  stopAll() {
    for (const [id] of this.timers) {
      this.stopSchedule(id)
    }
  }
}
