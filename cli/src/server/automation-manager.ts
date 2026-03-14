// server/automation-manager.ts
// Manages scheduled automations — runs agent commands on intervals/cron/events
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, createReadStream, chmodSync } from "node:fs"
import { join } from "node:path"
import { spawn, execSync, execFileSync, type ChildProcess } from "node:child_process"
import { getConfigDir } from "../shared/config.js"
import { log } from "../shared/logger.js"
import { VaultSync } from "./vault-sync.js"
import { WorktreeManager } from "./worktree-manager.js"
import { type SkillManifest, createDefaultManifest, createManifestForLevel, buildSandboxInstructions, scanPromptForConflicts, type PromptScanResult } from "./skill-manifest.js"
import { analyzeSkillContent, type SkillRiskReport } from "./skill-analyzer.js"
import { SkillWhitelist } from "./skill-whitelist.js"
import { SkillMonitor } from "./skill-monitor.js"
import type { PtyManager } from "./pty-manager.js"
import type { Project } from "../shared/types.js"

/** Kill a child process and its entire tree (Windows: taskkill /T, POSIX: negative PID for detached) */
function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid || proc.killed) return
  try {
    if (process.platform === "win32") {
      // taskkill /T kills child tree; windowsHide prevents CMD flash
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "ignore", windowsHide: true })
    } else {
      // Kill process group (negative PID) — works because detached=true on POSIX
      process.kill(-proc.pid, "SIGTERM")
    }
  } catch {
    // Fallback: kill just the process
    try { proc.kill("SIGTERM") } catch {}
  }
}

// --- Types ---

export type ScheduleType = "daily" | "interval"

export interface AutomationSchedule {
  type: ScheduleType
  timeOfDay?: string        // "09:00" (daily mode)
  weekdays?: number[]       // [0-6], 0=Sun 1=Mon...6=Sat
  intervalMinutes?: number  // (interval mode)
}

export type SandboxLevel = "strict" | "moderate" | "permissive" | "none"

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
  requireMergeApproval?: boolean  // when true, worktree changes wait for manual approval instead of auto-merging (default: false)
  sandboxLevel?: SandboxLevel  // "strict" (default) | "moderate" | "permissive" | "none"
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
  summary?: string
  status: "success" | "failed" | "timeout" | "blocked_by_risk" | "skipped_no_confirmation"
  riskReport?: SkillRiskReport
  pendingMerge?: { worktreePath: string; branch: string; sessionId: string }  // set when requireMergeApproval=true and execution succeeded
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
  writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 })
  // On Windows writeFileSync mode is ignored, but chmodSync still sets read-only;
  // on POSIX this ensures owner-only read/write.
  try { chmodSync(filePath, 0o600) } catch {}
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

export const FREE_LIMITS: AutomationLimits = { maxAutomations: 3, maxDailyExecutions: 50 }
export const PRO_LIMITS: AutomationLimits = { maxAutomations: 50, maxDailyExecutions: 500 }
export const ADMIN_LIMITS: AutomationLimits = { maxAutomations: Infinity, maxDailyExecutions: Infinity }

export class AutomationManager {
  private automations = new Map<string, AutomationConfig>()
  private timers = new Map<string, NodeJS.Timeout>()
  private nextRunAtMap = new Map<string, number>()  // track next trigger timestamp
  private runningProcesses = new Map<string, ChildProcess>()  // for killing running automations
  private results = new Map<string, AutomationResult[]>()
  private running = new Set<string>()  // prevent duplicate concurrent executions
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
  /** Pending worktree merges: automationId → { worktree info for deferred merge } */
  private pendingMerges = new Map<string, { projectCwd: string; worktreePath: string; branch: string; sessionId: string }>()

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

  /** Approve a pending worktree merge (when requireMergeApproval is true) */
  approveWorktreeMerge(automationId: string): { success: boolean; message: string } {
    const pending = this.pendingMerges.get(automationId)
    if (!pending) return { success: false, message: "No pending merge found for this automation" }

    const wtm = new WorktreeManager(pending.projectCwd)
    // Re-register the worktree in the new manager instance so merge() can find it
    // WorktreeManager.merge() looks up by sessionId, so we recreate the entry
    const wt = wtm.get(pending.sessionId)
    if (!wt) {
      // The worktree was created by a previous manager instance — do a direct git merge
      try {
        execFileSync("git", ["merge", pending.branch, "--no-edit"], {
          cwd: pending.projectCwd,
          encoding: "utf-8",
          stdio: "pipe",
        })
        this.pendingMerges.delete(automationId)
        log.info(`[Automation] Approved merge for "${automationId}": merged ${pending.branch}`)
        return { success: true, message: `Merged ${pending.branch} into current branch` }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Merge failed"
        return { success: false, message: msg }
      }
    }

    const result = wtm.merge(pending.sessionId)
    if (result.success) {
      this.pendingMerges.delete(automationId)
      log.info(`[Automation] Approved merge for "${automationId}": ${result.message}`)
    }
    return result
  }

  /** Get pending merge info for an automation */
  getPendingMerge(automationId: string): { worktreePath: string; branch: string; sessionId: string } | undefined {
    return this.pendingMerges.get(automationId)
  }

  /** List all automations with pending merges */
  listPendingMerges(): { automationId: string; branch: string; worktreePath: string }[] {
    return [...this.pendingMerges.entries()].map(([automationId, info]) => ({
      automationId,
      branch: info.branch,
      worktreePath: info.worktreePath,
    }))
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

  update(id: string, updates: Partial<Pick<AutomationConfig, "name" | "command" | "prompt" | "skill" | "schedule" | "enabled" | "runMode" | "agentId" | "model" | "templateId" | "bypass" | "requireMergeApproval" | "sandboxLevel" | "manifest">>): (AutomationConfig & { nextRunAt?: number }) | null {
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
    if (updates.requireMergeApproval !== undefined) auto.requireMergeApproval = updates.requireMergeApproval
    if (updates.sandboxLevel !== undefined) auto.sandboxLevel = updates.sandboxLevel
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

  /** Scan an automation's prompt for sandbox conflicts */
  scanConflicts(id: string, overrideLevel?: SandboxLevel): PromptScanResult | null {
    const auto = this.automations.get(id)
    if (!auto) return null
    const promptText = auto.prompt || auto.command || ""
    if (!promptText) return null
    const level = overrideLevel || auto.sandboxLevel || "strict"
    return scanPromptForConflicts(promptText, level)
  }

  // --- Scheduling ---

  private startSchedule(auto: AutomationConfig) {
    this.stopSchedule(auto.id) // clear any existing

    if (auto.schedule.type === "interval") {
      const ms = (auto.schedule.intervalMinutes || 30) * 60 * 1000
      log.info(`[Automation] Starting interval for "${auto.name}" every ${auto.schedule.intervalMinutes}m`)
      this.nextRunAtMap.set(auto.id, Date.now() + ms)
      const timer = setInterval(() => {
        // Re-check enabled state — defends against stale timers surviving a toggle-off
        const current = this.automations.get(auto.id)
        if (!current?.enabled) {
          log.info(`[Automation] "${auto.name}" disabled, stopping stale interval`)
          this.stopSchedule(auto.id)
          return
        }
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

  /** Build the agent command args + prompt file for an automation.
   *  Prompt is written to a temp file and piped via stdin (child_process.spawn).
   */
  private buildAutomationCommand(auto: AutomationConfig): { bin: string; args: string[]; promptFilePath: string } | null {
    const rawPrompt = auto.prompt || ""
    let promptText = wrapPromptWithLocale(rawPrompt)

    // Legacy raw command field is no longer supported for direct execution (security: command injection risk).
    if (auto.command && !auto.prompt) {
      promptText = wrapPromptWithLocale(auto.command)
    }

    // Inject skill instruction into prompt if specified
    if (auto.skill) {
      promptText = `[Important] Use the MCP skill "${auto.skill}" to accomplish this task. Call the relevant MCP tool for this skill before proceeding.\n\n${promptText}`
    }

    // Inject sandbox instructions based on sandboxLevel
    const sandboxLevel = auto.sandboxLevel || "strict"
    if (sandboxLevel !== "none") {
      const manifest = auto.manifest || createManifestForLevel(auto.templateId || auto.id, sandboxLevel)
      const project = this.projects.find(p => p.id === auto.projectId)
      if (project) {
        const sandboxBlock = buildSandboxInstructions(manifest, project.cwd)
        promptText = `${sandboxBlock}\n\n${promptText}`
      }
    }

    // Write prompt (with agent protocol) to file
    const locale = getSystemLocale()
    const agentProtocol = buildAgentProtocol(locale)
    const fullPrompt = `[System Instructions]\n${agentProtocol}\n\n[User Prompt]\n${promptText}`
    const promptFilePath = writePromptFile(this.storageDir, auto.id, fullPrompt)

    switch (auto.agentId) {
      case "claude": {
        // Use -p with short instruction to read prompt file — avoids stdin pipe issues with long prompts
        const args = ["-p", `Read and follow all instructions in this file: ${promptFilePath}`, "--dangerously-skip-permissions"]
        if (auto.model && /^[a-zA-Z0-9._-]+$/.test(auto.model)) args.push("--model", auto.model)
        return { bin: "claude", args, promptFilePath }
      }
      case "codex": {
        const args = ["--full-auto", "-q", `Read and follow all instructions in ${promptFilePath}`]
        if (auto.model && /^[a-zA-Z0-9._-]+$/.test(auto.model)) args.push("--model", auto.model)
        return { bin: "codex", args, promptFilePath }
      }
      default: {
        const agentBin = auto.agentId && /^[a-zA-Z0-9_-]+$/.test(auto.agentId) ? auto.agentId : "claude"
        return { bin: agentBin, args: ["--print"], promptFilePath }
      }
    }
  }

  /** Kill a running automation process */
  killAutomation(id: string): boolean {
    const proc = this.runningProcesses.get(id)
    if (!proc || proc.killed) return false
    killProcessTree(proc)
    // Force kill after 5s if still running
    setTimeout(() => { if (!proc.killed) killProcessTree(proc) }, 5000)
    return true
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

    // Execute in background — don't block the trigger response
    this.executeAutomation(id, true).catch((err) => {
      log.error(`[Automation] Background trigger failed for "${auto.name}": ${err?.message || err}`)
    })
    return { ok: true }
  }

  /** Execute an automation: open a PTY, launch agent, collect output */
  private async executeAutomation(id: string, manualTrigger = false) {
    const auto = this.automations.get(id)
    if (!auto || (!auto.enabled && !manualTrigger)) return

    // Prevent duplicate concurrent execution
    if (this.running.has(id)) {
      log.info(`[Automation] "${auto.name}" already running, skipping`)
      return
    }
    this.running.add(id)

    try {
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

    // bypass=true means user explicitly wants unattended execution — no confirmation needed

    const built = this.buildAutomationCommand(auto)
    if (!built) {
      log.warn(`[Automation] Could not build command for "${auto.name}" (agent=${auto.agentId})`)
      return
    }

    // Worktree setup — create isolated worktree if runMode === "worktree"
    let worktree: { path: string; branch: string } | null = null
    let worktreeManager: WorktreeManager | null = null
    let worktreeSessionId: string | null = null
    if (auto.runMode === "worktree") {
      try {
        worktreeManager = new WorktreeManager(project.cwd)
        worktreeSessionId = `automation_${id}_${Date.now()}`
        const slug = auto.name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 30)
        const wt = worktreeManager.create(worktreeSessionId, slug)
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
      // Runtime behavior monitor
      const level = auto.sandboxLevel || "strict"
      const manifest = auto.manifest || createManifestForLevel(auto.templateId || auto.id, level)
      const monitor = new SkillMonitor({
        manifest,
        projectCwd: execProject.cwd,
        autoHalt: riskReport.score >= 30,
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
          const proc = this.runningProcesses.get(id)
          if (proc && !proc.killed) killProcessTree(proc)
        },
      })

      // Spawn agent process directly — no PTY, clean stdin/stdout pipe
      const TIMEOUT_MS = 10 * 60 * 1000
      const env = { ...process.env }
      // Remove Claude Code session markers to prevent "nested session" detection
      delete (env as any).CLAUDECODE
      delete (env as any).CLAUDE_CODE_ENTRYPOINT

      const result = await new Promise<{ exitCode: number | null; timedOut: boolean; output: string }>((resolve) => {
        let resolved = false
        const outputChunks: string[] = []
        let outputBytes = 0
        const MAX_OUTPUT_CAPTURE = 100_000

        const proc = spawn(built.bin, built.args, {
          cwd: worktree?.path || execProject.cwd,
          env,
          stdio: ["pipe", "pipe", "pipe"],
          // Detach on POSIX for process group isolation; skip on Windows (creates visible console)
          ...(process.platform !== "win32" ? { detached: true } : {}),
          windowsHide: true,
        })

        this.runningProcesses.set(id, proc)

        // Close stdin — prompt is passed via -p flag or agent reads from file
        try { proc.stdin.end() } catch {}
        proc.stdin.on("error", () => {})

        // Collect stdout (with error handler to prevent daemon crash on broken pipe)
        proc.stdout.on("data", (data: Buffer) => {
          const text = data.toString()
          if (outputBytes < MAX_OUTPUT_CAPTURE) {
            outputChunks.push(text)
            outputBytes += text.length
          }
          monitor.processOutput(text)
        })
        proc.stdout.on("error", () => {})

        // Collect stderr (merge into output, with error handler)
        proc.stderr.on("data", (data: Buffer) => {
          const text = data.toString()
          if (outputBytes < MAX_OUTPUT_CAPTURE) {
            outputChunks.push(text)
            outputBytes += text.length
          }
        })
        proc.stderr.on("error", () => {})

        proc.on("close", (code) => {
          if (!resolved) {
            resolved = true
            this.runningProcesses.delete(id)
            resolve({ exitCode: code, timedOut: false, output: outputChunks.join("") })
          }
        })

        proc.on("error", (err) => {
          if (!resolved) {
            resolved = true
            this.runningProcesses.delete(id)
            resolve({ exitCode: 1, timedOut: false, output: `Spawn error: ${err.message}` })
          }
        })

        // Hard timeout
        setTimeout(() => {
          if (!resolved) {
            resolved = true
            this.runningProcesses.delete(id)
            killProcessTree(proc)
            setTimeout(() => { if (!proc.killed) killProcessTree(proc) }, 5000)
            resolve({ exitCode: null, timedOut: true, output: outputChunks.join("") })
          }
        }, TIMEOUT_MS)
      })

      monitor.flush()
      output = result.output
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
      summary: AutomationManager.extractSummary(output, status),
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

    // Worktree merge handling
    if (worktree && worktreeManager && worktreeSessionId && status === "success") {
      if (auto.requireMergeApproval) {
        // Save pending merge for later approval
        this.pendingMerges.set(id, {
          projectCwd: project.cwd,
          worktreePath: worktree.path,
          branch: worktree.branch,
          sessionId: worktreeSessionId,
        })
        resultEntry.pendingMerge = {
          worktreePath: worktree.path,
          branch: worktree.branch,
          sessionId: worktreeSessionId,
        }
        log.info(`[Automation] Merge pending approval for "${auto.name}" (branch: ${worktree.branch})`)
      } else {
        // Auto-merge (default behavior)
        const mergeResult = worktreeManager.merge(worktreeSessionId)
        if (mergeResult.success) {
          log.info(`[Automation] Auto-merged "${auto.name}": ${mergeResult.message}`)
        } else {
          log.warn(`[Automation] Auto-merge failed for "${auto.name}": ${mergeResult.message}`)
          resultEntry.output += `\n\n--- Worktree Merge ---\nFailed: ${mergeResult.message}`
        }
      }
    }

    // Broadcast completion event
    if (this.onEvent) {
      this.onEvent({ type: "automation_completed", automation: auto, result: resultEntry })
    }
    } finally {
      this.running.delete(id)
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
    // Read-modify-write: merge in-memory state with on-disk state to avoid
    // stale writes overriding changes made by other code paths (e.g. toggle off
    // from the app being overwritten by a daemon saveToDisk with old enabled=true).
    const filePath = this.getAutomationsFile()
    let diskMap = new Map<string, AutomationConfig>()
    try {
      if (existsSync(filePath)) {
        const diskData: AutomationConfig[] = JSON.parse(readFileSync(filePath, "utf-8"))
        for (const a of diskData) diskMap.set(a.id, a)
      }
    } catch { /* ignore parse errors, overwrite */ }

    // In-memory is authoritative for all fields of automations we know about
    for (const [id, auto] of this.automations) {
      diskMap.set(id, auto)
    }

    // Remove automations that were deleted in memory but still on disk
    for (const id of diskMap.keys()) {
      if (!this.automations.has(id)) diskMap.delete(id)
    }

    writeFileSync(filePath, JSON.stringify([...diskMap.values()], null, 2))
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

  // --- Output summary ---

  /** Extract a human-readable summary from raw PTY output */
  static extractSummary(rawOutput: string, status: string): string {
    try {
      if (!rawOutput) return status === "success" ? "Completed (no output)" : `${status} (no output)`

      // Strip ALL ANSI/VT100 escape sequences with a comprehensive regex
      // Covers: CSI (incl. private modes like ?25h), OSC, Fe (single-char), charset, control chars
      const clean = rawOutput
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")       // CSI: ESC [ <params> <intermediate> <final> (covers ALL CSI including ?-prefixed)
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")  // OSC: ESC ] ... (BEL or ST)
        .replace(/\x1b[@-Z\\-_]/g, "")                  // Fe: ESC + single char (RIS, IND, NEL, etc.)
        .replace(/\x1b[()][0-9A-B]/g, "")              // charset selection (SCS)
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "") // remaining control chars (keep \n \r \t)
        .replace(/___AGENTRUNE_DONE___/g, "")           // strip done marker from summary

      // Split into lines, skip empty
      const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

      // Filter out noise: prompt echo, shell prompts, progress spinners, control chars
      const meaningful = lines.filter(line => {
        if (line.length < 3) return false
        if (line.length > 500) return false  // likely binary or long echo
        // Shell prompts
        if (/^[$#>❯%]\s*$/.test(line)) return false
        if (/^(PS )?[A-Z]:\\/.test(line)) return false  // PowerShell prompt
        // PowerShell welcome message (contains garbled Big5/CP950 chars)
        if (line.includes("Windows PowerShell")) return false
        if (line.includes("Microsoft Corporation")) return false
        if (line.includes("aka.ms/PSWindows")) return false
        if (line.includes("PowerShell")) return false
        if (/^\w+@\w+/.test(line) && line.includes("$")) return false  // bash prompt
        // Command echo (the piped command itself)
        if (line.includes("cat ") && line.includes("| claude")) return false
        if (line.includes("Get-Content") && line.includes("claude")) return false
        // Done marker
        if (line.includes("___AGENTRUNE_DONE___")) return false
        // Spinner/progress characters
        if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏─│┌┐└┘├┤┬┴┼]+$/.test(line)) return false
        // Pure control/escape artifacts
        if (/^\[[\d;]*[a-zA-Z]/.test(line)) return false
        return true
      })

      if (meaningful.length === 0) {
        return status === "timeout" ? "Timed out (no meaningful output)"
          : status === "success" ? "Completed (only prompt echo)"
          : `${status}`
      }

      // Take last 8 meaningful lines as summary (agent's final output is most important)
      const tail = meaningful.slice(-8)
      const summary = tail.join("\n")

      // Truncate if too long
      return summary.length > 600 ? summary.slice(-600) + "..." : summary
    } catch {
      return status
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
