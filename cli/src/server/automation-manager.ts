// server/automation-manager.ts
// Manages scheduled automations — runs agent commands on intervals/cron/events
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { getConfigDir } from "../shared/config.js"
import { log } from "../shared/logger.js"
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

// --- Manager ---

export class AutomationManager {
  private automations = new Map<string, AutomationConfig>()
  private timers = new Map<string, NodeJS.Timeout>()
  private results = new Map<string, AutomationResult[]>()
  private storageDir: string
  private ptyManager: PtyManager
  private projects: Project[]

  private static MAX_RESULTS_PER_AUTOMATION = 20
  private static MAX_OUTPUT_BYTES = 50_000

  constructor(ptyManager: PtyManager, projects: Project[]) {
    this.ptyManager = ptyManager
    this.projects = projects
    this.storageDir = join(getConfigDir(), "automations")
    mkdirSync(this.storageDir, { recursive: true })
    this.loadFromDisk()
  }

  /** Update projects reference (when projects list changes) */
  updateProjects(projects: Project[]) {
    this.projects = projects
  }

  // --- CRUD ---

  add(config: Omit<AutomationConfig, "id" | "createdAt">): AutomationConfig {
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

  list(projectId?: string): AutomationConfig[] {
    const all = [...this.automations.values()]
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

  update(id: string, updates: Partial<Pick<AutomationConfig, "name" | "command" | "prompt" | "skill" | "schedule" | "enabled" | "runMode" | "agentId" | "templateId">>): AutomationConfig | null {
    const auto = this.automations.get(id)
    if (!auto) return null

    const wasEnabled = auto.enabled

    if (updates.name !== undefined) auto.name = updates.name
    if (updates.command !== undefined) auto.command = updates.command
    if (updates.prompt !== undefined) auto.prompt = updates.prompt
    if (updates.skill !== undefined) auto.skill = updates.skill
    if (updates.schedule !== undefined) auto.schedule = updates.schedule
    if (updates.enabled !== undefined) auto.enabled = updates.enabled
    if (updates.runMode !== undefined) auto.runMode = updates.runMode
    if (updates.agentId !== undefined) auto.agentId = updates.agentId
    if (updates.templateId !== undefined) auto.templateId = updates.templateId

    if (wasEnabled) this.stopSchedule(id)
    if (auto.enabled) this.startSchedule(auto)

    this.saveToDisk()
    return auto
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
      const timer = setInterval(() => {
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
  }

  /** Execute an automation: open a PTY, run command, collect output */
  private async executeAutomation(id: string) {
    const auto = this.automations.get(id)
    if (!auto || !auto.enabled) return

    const project = this.projects.find((p) => p.id === auto.projectId)
    if (!project) {
      log.warn(`[Automation] Project "${auto.projectId}" not found for automation "${auto.name}"`)
      return
    }

    log.info(`[Automation] Executing "${auto.name}" in project "${project.name}"`)

    const startedAt = Date.now()
    let output = ""
    let exitCode: number | null = null
    let status: AutomationResult["status"] = "success"

    try {
      // Create a temporary PTY session for this automation
      const sessionId = `automation_${id}_${Date.now()}`
      const session = this.ptyManager.create(project, "automation", sessionId)

      // Collect output
      const outputChunks: string[] = []
      const dataHandler = (sid: string, data: string) => {
        if (sid === sessionId) {
          outputChunks.push(data)
        }
      }
      this.ptyManager.on("data", dataHandler)

      // Wait a moment for shell to initialize, then send prompt or command
      await new Promise((resolve) => setTimeout(resolve, 500))
      const rawInput = auto.prompt || auto.command || ""
      const input = wrapPromptWithLocale(rawInput)
      this.ptyManager.write(sessionId, input + "\n")

      // Wait for command to finish (with timeout)
      const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
      const result = await new Promise<{ exitCode: number | null; timedOut: boolean }>((resolve) => {
        let resolved = false

        const exitHandler = (sid: string) => {
          if (sid === sessionId && !resolved) {
            resolved = true
            resolve({ exitCode: 0, timedOut: false })
          }
        }
        this.ptyManager.on("exit", exitHandler)

        // Also detect completion by watching for shell prompt return
        // Use a heuristic: if no output for 10 seconds after first output, consider done
        let idleTimer: NodeJS.Timeout | null = null
        const resetIdle = () => {
          if (idleTimer) clearTimeout(idleTimer)
          idleTimer = setTimeout(() => {
            if (!resolved) {
              resolved = true
              this.ptyManager.removeListener("exit", exitHandler)
              this.ptyManager.kill(sessionId)
              resolve({ exitCode: 0, timedOut: false })
            }
          }, 10_000)
        }

        const idleDataHandler = (sid: string, _data: string) => {
          if (sid === sessionId) resetIdle()
        }
        this.ptyManager.on("data", idleDataHandler)

        // Start idle detection after initial delay
        setTimeout(() => resetIdle(), 2000)

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

    log.info(`[Automation] "${auto.name}" finished: ${status} (${resultEntry.finishedAt - startedAt}ms)`)
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
