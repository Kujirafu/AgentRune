// server/automation-manager.ts
// Manages scheduled automations — runs agent commands on intervals/cron/events
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { getConfigDir } from "../shared/config.js"
import { log } from "../shared/logger.js"
import { VaultSync } from "./vault-sync.js"
import { WorktreeManager } from "./worktree-manager.js"
import { type SkillManifest, createDefaultManifest, buildSandboxInstructions } from "./skill-manifest.js"
import { analyzeSkillContent, type SkillRiskReport } from "./skill-analyzer.js"
import { SkillWhitelist } from "./skill-whitelist.js"
import { SkillMonitor } from "./skill-monitor.js"
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
  bypass?: boolean           // --dangerously-skip-permissions (unattended mode, requires per-run human confirmation)
  manifest?: SkillManifest   // resource permissions declared by this skill
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  lastRunStatus?: "success" | "failed" | "timeout" | "blocked_by_risk" | "skipped_no_confirmation"
}

export interface AutomationResult {
  id: string
  automationId: string
  startedAt: number
  finishedAt: number
  exitCode: number | null
  output: string
  status: "success" | "failed" | "timeout" | "blocked_by_risk" | "skipped_no_confirmation"
  riskReport?: SkillRiskReport
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

/** Write prompt to a temp file and return a shell snippet that pipes it to the command.
 *  This avoids shell escaping issues — $'...' is bash-only, PowerShell doesn't support it.
 */
function writePromptFile(storageDir: string, automationId: string, prompt: string): string {
  const filePath = join(storageDir, `prompt_${automationId}.txt`)
  writeFileSync(filePath, prompt, "utf-8")
  return filePath
}

// --- Manager ---

export type AutomationEventCallback = (event:
  | { type: "automation_completed"; automation: AutomationConfig; result: AutomationResult }
  | { type: "skill_confirmation_required"; automationId: string; skillId: string; riskReport: SkillRiskReport; manifest?: SkillManifest }
  | { type: "bypass_confirmation_required"; automationId: string; automationName: string }
) => void

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
  private whitelist: SkillWhitelist
  /** Pending confirmations: automationId → { resolve, timer } */
  private pendingConfirmations = new Map<string, { resolve: (action: "approve" | "approve_and_trust" | "deny") => void; timer: NodeJS.Timeout }>()

  private static MAX_RESULTS_PER_AUTOMATION = 20
  private static MAX_OUTPUT_BYTES = 50_000

  constructor(ptyManager: PtyManager, projects: Project[], onEvent?: AutomationEventCallback, opts?: { vaultPath?: string; limits?: AutomationLimits }) {
    this.ptyManager = ptyManager
    this.projects = projects
    this.onEvent = onEvent
    this.vaultPath = opts?.vaultPath
    this.limits = opts?.limits || FREE_LIMITS
    this.whitelist = new SkillWhitelist()
    this.storageDir = join(getConfigDir(), "automations")
    mkdirSync(this.storageDir, { recursive: true })
    this.loadFromDisk()
  }

  /** Get the skill whitelist (for API routes) */
  getWhitelist(): SkillWhitelist { return this.whitelist }

  /** Resolve a pending skill/bypass confirmation from the client */
  resolveConfirmation(automationId: string, action: "approve" | "approve_and_trust" | "deny"): boolean {
    const pending = this.pendingConfirmations.get(automationId)
    if (!pending) return false
    clearTimeout(pending.timer)
    this.pendingConfirmations.delete(automationId)
    pending.resolve(action)
    return true
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

  update(id: string, updates: Partial<Pick<AutomationConfig, "name" | "command" | "prompt" | "skill" | "schedule" | "enabled" | "runMode" | "agentId" | "model" | "templateId" | "bypass" | "manifest">>): (AutomationConfig & { nextRunAt?: number }) | null {
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
    if (updates.manifest !== undefined) auto.manifest = updates.manifest

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

  /** Build the agent CLI command for an automation.
   *  Prompt is written to a temp file and piped via stdin to avoid shell escaping issues.
   *  PowerShell doesn't support bash $'...' syntax, and long prompts break command-line args.
   */
  private buildAutomationCommand(auto: AutomationConfig): { agentCmd: string; promptText: string; promptFilePath?: string } | null {
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

    // Inject sandbox instructions if manifest exists
    const manifest = auto.manifest || createDefaultManifest(auto.templateId || auto.id)
    const project = this.projects.find(p => p.id === auto.projectId)
    if (project) {
      const sandboxBlock = buildSandboxInstructions(manifest, project.cwd)
      promptText = `${sandboxBlock}\n\n${promptText}`
    }

    // Write prompt to file (avoids shell escaping issues on all platforms)
    const promptFilePath = writePromptFile(this.storageDir, auto.id, promptText)

    // Build agent command based on agentId
    const locale = getSystemLocale()
    const isWindows = process.platform === "win32"
    // Shell-safe way to pipe file content into command
    const catCmd = isWindows ? `Get-Content -Raw "${promptFilePath}" |` : `cat "${promptFilePath}" |`

    switch (auto.agentId) {
      case "claude": {
        let cmd = "claude --print"
        if (auto.model && /^[a-zA-Z0-9._-]+$/.test(auto.model)) cmd += ` --model ${auto.model}`
        if (auto.bypass) cmd += " --dangerously-skip-permissions"
        // Escape double quotes in system prompt for shell
        const sysPrompt = buildAgentProtocol(locale).replace(/"/g, isWindows ? '`"' : '\\"')
        cmd += ` --append-system-prompt "${sysPrompt}"`
        // Pipe prompt from file instead of passing via -p flag
        return { agentCmd: `${catCmd} ${cmd}`, promptText: "", promptFilePath }
      }
      case "codex": {
        let cmd = "codex --full-auto"
        if (auto.model && /^[a-zA-Z0-9._-]+$/.test(auto.model)) cmd += ` --model ${auto.model}`
        // Codex uses -q flag; pipe not supported, so read file content as arg
        // For codex, use PowerShell variable substitution
        if (isWindows) {
          return { agentCmd: `$p = Get-Content -Raw "${promptFilePath}"; ${cmd} -q $p`, promptText: "", promptFilePath }
        } else {
          return { agentCmd: `${cmd} -q "$(cat "${promptFilePath}")"`, promptText: "", promptFilePath }
        }
      }
      default: {
        // For other agents (aider, gemini, etc.), launch agent then send prompt via PTY
        const agentBin = auto.agentId && /^[a-zA-Z0-9_-]+$/.test(auto.agentId) ? auto.agentId : "claude"
        return { agentCmd: agentBin, promptText, promptFilePath }
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
    // Prune stale daily counts (keep only last 7 days)
    if (this.dailyExecCount.size > 7) {
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
      for (const key of this.dailyExecCount.keys()) {
        if (key < cutoff) this.dailyExecCount.delete(key)
      }
    }

    const project = this.projects.find((p) => p.id === auto.projectId)
    if (!project) {
      log.warn(`[Automation] Project "${auto.projectId}" not found for automation "${auto.name}"`)
      return
    }

    // ── Security gate: static analysis ──
    const contentToAnalyze = [auto.prompt || "", auto.command || "", auto.skill || ""].join("\n")
    const riskReport = analyzeSkillContent(contentToAnalyze, auto.manifest)
    if (riskReport.level === "critical") {
      log.warn(`[Automation] BLOCKED "${auto.name}" — critical risk score ${riskReport.score}`)
      const result: AutomationResult = {
        id: `result_${Date.now()}`,
        automationId: id,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        exitCode: null,
        output: `Blocked: critical risk score (${riskReport.score}/100). Findings: ${riskReport.findings.map(f => f.pattern).join(", ")}`,
        status: "blocked_by_risk",
        riskReport,
      }
      this.storeResult(id, result)
      return
    }

    // ── Security gate: whitelist + confirmation ──
    const skillId = auto.templateId || auto.skill || auto.id
    if (!this.whitelist.isTrusted(skillId) && riskReport.score >= 30 && this.onEvent) {
      log.info(`[Automation] Requesting confirmation for "${auto.name}" (risk=${riskReport.score})`)
      this.onEvent({ type: "skill_confirmation_required", automationId: id, skillId, riskReport, manifest: auto.manifest })

      const action = await this.waitForConfirmation(id)
      if (action === "deny") {
        log.info(`[Automation] User denied "${auto.name}"`)
        const result: AutomationResult = {
          id: `result_${Date.now()}`, automationId: id, startedAt: Date.now(), finishedAt: Date.now(),
          exitCode: null, output: "Skipped: user denied execution", status: "skipped_no_confirmation", riskReport,
        }
        this.storeResult(id, result)
        return
      }
      if (action === "approve_and_trust") {
        this.whitelist.trust(skillId, "full", riskReport.score)
      }
    }

    // ── Security gate: bypass always needs fresh confirmation ──
    if (auto.bypass && this.onEvent) {
      log.info(`[Automation] Requesting bypass confirmation for "${auto.name}"`)
      this.onEvent({ type: "bypass_confirmation_required", automationId: id, automationName: auto.name })

      const bypassAction = await this.waitForConfirmation(id)
      if (bypassAction === "deny") {
        log.info(`[Automation] User denied bypass for "${auto.name}", running without bypass`)
        auto.bypass = false  // run without bypass this time (don't persist)
      }
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

      // Runtime behavior monitor
      const manifest = auto.manifest || createDefaultManifest(auto.templateId || auto.id)
      const monitor = new SkillMonitor({
        manifest,
        projectCwd: execProject.cwd,
        autoHalt: riskReport.score >= 30,  // auto-halt only for medium+ risk skills
        onViolation: (v) => {
          if (this.onEvent) {
            this.onEvent({
              type: "automation_completed",
              automation: auto,
              result: { id: `violation_${Date.now()}`, automationId: id, startedAt, finishedAt: Date.now(), exitCode: null, output: `Runtime violation: ${v.type} — ${v.description}: ${v.matchedText}`, status: "failed" },
            })
          }
        },
        onHalt: (reason) => {
          log.warn(`[Automation] Monitor halted "${auto.name}": ${reason}`)
          this.ptyManager.kill(sessionId)
        },
      })

      // Collect output (capped at 100KB to prevent memory leaks)
      const outputChunks: string[] = []
      let outputBytes = 0
      const MAX_OUTPUT_CAPTURE = 100_000
      const dataHandler = (sid: string, data: string) => {
        if (sid === sessionId) {
          if (outputBytes < MAX_OUTPUT_CAPTURE) {
            outputChunks.push(data)
            outputBytes += data.length
          }
          monitor.processOutput(data)
        }
      }
      this.ptyManager.on("data", dataHandler)

      // Wait for shell to initialize
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // If worktree, cd into it first
      if (worktree) {
        const cdPath = worktree.path.replace(/\\/g, "/")
        const cdCmd = process.platform === "win32" ? `cd "${worktree.path}"` : `cd "${cdPath}"`
        this.ptyManager.write(sessionId, cdCmd + "\n")
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      // Send the agent command
      // For piped commands (cat file | claude --print), the full command is in agentCmd
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

        // Idle detection: if no output for IDLE_MS after agent starts producing real output.
        // Problem: prompt echo from PTY creates early "output" that triggers false idle timeout.
        // Solution: don't start idle detection until agent actually produces real response output.
        // Real output = anything after the prompt file content has been echoed (grace period).
        let idleTimer: NodeJS.Timeout | null = null
        const IDLE_MS = 90_000  // 90 seconds idle = done (increased from 60s)
        const GRACE_PERIOD_MS = 120_000  // 2 minutes grace period for agent to start responding
        let idleActive = false

        const resetIdle = () => {
          if (!idleActive) return
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
          if (sid === sessionId && idleActive) resetIdle()
        }
        this.ptyManager.on("data", idleDataHandler)

        // Start idle detection after grace period (agent needs time to load, call API, etc.)
        // claude --print with long prompts: echo takes ~5s, API call takes 30-90s
        setTimeout(() => {
          idleActive = true
          resetIdle()
        }, GRACE_PERIOD_MS)

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
      monitor.flush()
      output = outputChunks.join("")
      if (output.length > AutomationManager.MAX_OUTPUT_BYTES) {
        output = output.slice(-AutomationManager.MAX_OUTPUT_BYTES)
      }
      exitCode = result.exitCode
      status = monitor.isHalted() ? "blocked_by_risk" : result.timedOut ? "timeout" : "success"
      if (monitor.getViolations().length > 0) {
        const violations = monitor.getViolations()
        output += `\n\n--- Monitor Report ---\nViolations: ${violations.length}\n${violations.map(v => `[${v.severity}] ${v.type}: ${v.description} — "${v.matchedText}"`).join("\n")}`
      }
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

    this.storeResult(id, resultEntry)

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

  // --- Security helpers ---

  /** Wait for user confirmation via WebSocket, with 5-minute timeout (default: deny) */
  private waitForConfirmation(automationId: string): Promise<"approve" | "approve_and_trust" | "deny"> {
    return new Promise((resolve) => {
      const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

      const timer = setTimeout(() => {
        this.pendingConfirmations.delete(automationId)
        log.info(`[Automation] Confirmation timed out for "${automationId}" — defaulting to deny`)
        resolve("deny")
      }, TIMEOUT_MS)

      this.pendingConfirmations.set(automationId, { resolve, timer })
    })
  }

  /** Store a result in the ring buffer and persist to disk */
  private storeResult(automationId: string, result: AutomationResult): void {
    const results = this.results.get(automationId) || []
    results.push(result)
    if (results.length > AutomationManager.MAX_RESULTS_PER_AUTOMATION) {
      results.splice(0, results.length - AutomationManager.MAX_RESULTS_PER_AUTOMATION)
    }
    this.results.set(automationId, results)
    this.saveResultsToDisk(automationId)
  }

  /** Stop all timers (for graceful shutdown) */
  stopAll() {
    for (const [id] of this.timers) {
      this.stopSchedule(id)
    }
  }
}
