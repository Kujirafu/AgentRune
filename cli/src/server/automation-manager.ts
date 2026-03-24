// server/automation-manager.ts
// Manages scheduled automations — runs agent commands on intervals/cron/events
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, createReadStream, chmodSync, statSync, renameSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { readEncryptedFile, writeEncryptedFile, isEncrypted } from "./crypto.js"
import { execSync, execFileSync, spawn, type ChildProcess } from "node:child_process"
import { getConfigDir } from "../shared/config.js"
import { log } from "../shared/logger.js"
import { VaultSync } from "./vault-sync.js"
import { WorktreeManager } from "./worktree-manager.js"
import { type SkillManifest, createDefaultManifest, createManifestForLevel, buildSandboxInstructions, scanPromptForConflicts, type PromptScanResult } from "./skill-manifest.js"
import { buildPlanningConstraints, formatConstraintsForPrompt } from "./planning-constraints.js"
import { createFromTrustProfile, inheritForResume, hasPermission, grantPermission, violationTypeToPermissionKey, type AuthorityMap, type PermissionSeverity } from "./authority-map.js"
import { auditLog, pruneAuditLogs } from "./audit-log.js"
import { analyzeSkillContent, type SkillRiskReport } from "./skill-analyzer.js"
import { SkillWhitelist } from "./skill-whitelist.js"
import { SkillMonitor } from "./skill-monitor.js"
import {
  buildAutomationSocialInstructions,
  detectAutomationSocialMode,
  extractAutomationSocialDirective,
  outputIndicatesNoPublishableContent,
  outputNeedsManualIntervention,
} from "./automation-social.js"
import {
  buildRecentSocialPostPromptContext,
  clearSocialPublishCooldown,
  findDuplicateSocialPost,
  formatSocialDuplicateMatch,
  formatSocialPublishCooldown,
  getActiveSocialPublishCooldown,
  rememberSocialPost,
  rememberSocialPublishCooldown,
} from "./social-dedup.js"
import { recordPublishedSocialPost } from "./social-history.js"
import { publishSocialPost, postMoltbookComment, pickCtaVariant, postXSelfReply, pickXCtaVariant } from "./social-publisher.js"
import { extractAutomationSummary } from "./automation-summary.js"
import { callLlmForSummary, shouldUseLlmSummary } from "./llm-summary.js"
import {
  estimatePhaseGateReviewMs,
  estimateReauthReviewMs,
  summarizeReviewDecision,
} from "./automation-review.js"
import {
  computeAutomationBehaviorStateHash,
  computeAutomationLaunchStateHash,
  computeAutomationPromptStateHash,
  validateAutomationLaunchState,
} from "./automation-state.js"
import {
  buildAgentEnvironment,
  createLocalAgentExecutor,
  type AgentExecutor,
} from "./agent-executor.js"
import type { PtyManager } from "./pty-manager.js"
import type { Project } from "../shared/types.js"

/** Kill a child process and its entire tree (Windows: taskkill /T, POSIX: negative PID for detached) */
function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid || proc.killed) return
  try {
    if (process.platform === "win32") {
      // taskkill /T kills child tree; windowsHide prevents CMD flash
      execFileSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore", windowsHide: true })
    } else {
      // Kill process group (negative PID) — works because detached=true on POSIX
      process.kill(-proc.pid, "SIGTERM")
    }
  } catch {
    // Fallback: kill just the process
    try { proc.kill("SIGTERM") } catch {}
  }
}

/** Extract activity log from Claude JSONL session file (fallback when stdout is empty on Windows pipe buffering) */
function extractJSONLActivity(projectCwd: string, startedAt: number): string | null {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || ""
    const slug = projectCwd.replace(/[^a-zA-Z0-9-]/g, "-")
    const claudeProjectDir = join(home, ".claude", "projects", slug)
    if (!existsSync(claudeProjectDir)) return null

    // Find JSONL files modified after startedAt (5s tolerance for startup delay)
    const files = readdirSync(claudeProjectDir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => {
        const fullPath = join(claudeProjectDir, f)
        const stat = statSync(fullPath)
        return { path: fullPath, mtime: stat.mtimeMs }
      })
      .filter(f => f.mtime >= startedAt - 5000)
      .sort((a, b) => b.mtime - a.mtime)

    if (files.length === 0) return null

    const content = readFileSync(files[0].path, "utf-8")
    const lines = content.split("\n").filter(Boolean)
    const activities: string[] = []
    let totalOutputTokens = 0
    let cost: number | null = null

    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        if (obj.type === "assistant") {
          const blocks = obj.message?.content || []
          const usage = obj.message?.usage
          if (usage?.output_tokens) totalOutputTokens += usage.output_tokens

          for (const c of blocks) {
            if (c.type === "text" && c.text) {
              activities.push(`[text] ${c.text.slice(0, 200)}`)
            } else if (c.type === "tool_use") {
              const inp = c.input || {}
              switch (c.name) {
                case "Read": activities.push(`[Read] ${inp.file_path || "?"}`); break
                case "Edit": activities.push(`[Edit] ${inp.file_path || "?"}`); break
                case "Write": activities.push(`[Write] ${inp.file_path || "?"}`); break
                case "Bash": activities.push(`[Bash] ${(inp.command || "?").slice(0, 100)}`); break
                case "Glob": activities.push(`[Glob] ${inp.pattern || "?"}`); break
                case "Grep": activities.push(`[Grep] ${inp.pattern || "?"}`); break
                default: activities.push(`[${c.name}]`); break
              }
            }
          }
        } else if (obj.type === "result") {
          cost = obj.costUSD ?? null
        }
      } catch {}
    }

    if (activities.length === 0) return null

    const header = `--- Activity Log (${activities.length} actions, ${totalOutputTokens} output tokens${cost != null ? `, $${cost.toFixed(3)}` : ""}) ---\n`
    const body = activities.join("\n")
    const maxLen = 50_000
    return header + (body.length > maxLen ? body.slice(-maxLen) : body)
  } catch {
    return null
  }
}

// --- Types ---

export type ScheduleType = "daily" | "interval" | "manual"

export interface AutomationSchedule {
  type: ScheduleType
  timeOfDay?: string        // "09:00" (daily mode)
  weekdays?: number[]       // [0-6], 0=Sun 1=Mon...6=Sat
  intervalMinutes?: number  // (interval mode)
}

export type SandboxLevel = "strict" | "moderate" | "permissive" | "none"
export type TrustProfile = "autonomous" | "supervised" | "guarded" | "custom"

export interface TrustProfileConfig {
  sandboxLevel: SandboxLevel
  requirePlanReview: boolean
  requireMergeApproval: boolean
  dailyRunLimit: number              // 0 = unlimited
  planReviewTimeoutMinutes: number   // 0 = no timeout
}

export const TRUST_PROFILE_PRESETS: Record<Exclude<TrustProfile, "custom">, TrustProfileConfig> = {
  autonomous: { sandboxLevel: "none", requirePlanReview: false, requireMergeApproval: false, dailyRunLimit: 0, planReviewTimeoutMinutes: 0 },
  supervised: { sandboxLevel: "moderate", requirePlanReview: false, requireMergeApproval: false, dailyRunLimit: 50, planReviewTimeoutMinutes: 30 },
  guarded:    { sandboxLevel: "strict", requirePlanReview: true, requireMergeApproval: true, dailyRunLimit: 10, planReviewTimeoutMinutes: 30 },
}

/** Expand a trust profile into concrete settings. Custom returns undefined (caller uses explicit fields). */
export function expandTrustProfile(profile: TrustProfile): TrustProfileConfig | undefined {
  if (profile === "custom") return undefined
  return TRUST_PROFILE_PRESETS[profile]
}

// --- Crew types ---

export interface CrewPersona {
  tone: string
  focus: string
  style: string
}

export interface CrewRole {
  id: string
  nameKey: string
  prompt: string
  persona: CrewPersona
  icon: string
  color: string
  skillChainSlug?: string
  /** Pre-serialized skill chain workflow (injected by frontend from BUILTIN_CHAINS) */
  skillChainWorkflow?: string
  phase: number
  estimatedTokens?: number
}

export interface CrewConfig {
  roles: CrewRole[]
  tokenBudget: number
  targetBranch?: string
  phaseDelayMinutes?: number
  phaseGate?: boolean
}

export type PhaseGateAction = "proceed" | "proceed_with_instructions" | "retry" | "retry_with_instructions" | "abort"

export interface PhaseGateRequest {
  automationId: string
  automationName: string
  completedPhase: number
  nextPhase: number
  phaseResults: { roleId: string; roleName: string; icon: string; color: string; status: string; outputSummary: string }[]
  totalTokensUsed: number
  tokenBudget: number
  timestamp: number
  estimatedReviewMs?: number
}

export interface PhaseGateResponse {
  automationId: string
  action: PhaseGateAction
  instructions?: string
  reviewNote?: string
}

export interface CrewRoleResult {
  roleId: string
  roleName: string
  icon: string
  color: string
  phase: number
  status: "completed" | "failed" | "skipped" | "circuit_broken" | "aborted"
  tokensUsed: number
  durationMs: number
  outputSummary: string
  outputFull?: string
}

export interface CrewExecutionReport {
  automationId: string
  startedAt: number
  completedAt: number
  status: "completed" | "failed" | "circuit_broken" | "aborted"
  totalTokensUsed: number
  tokenBudget: number
  targetBranch?: string
  phases: { phase: number; roles: CrewRoleResult[] }[]
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
  locale?: string
  model?: string            // e.g. "sonnet", "opus", "haiku" (agent-specific)
  bypass?: boolean           // --dangerously-skip-permissions (unattended mode, requires per-run human confirmation)
  behaviorStateHash?: string
  // Trust Layer — trustProfile controls sandboxLevel, requireMergeApproval, requirePlanReview, dailyRunLimit
  trustProfile?: TrustProfile        // default: "supervised"
  requireMergeApproval?: boolean
  requirePlanReview?: boolean
  sandboxLevel?: SandboxLevel
  dailyRunLimit?: number             // 0 = unlimited
  planReviewTimeoutMinutes?: number  // 0 = no timeout
  timeoutMinutes?: number            // execution timeout per run (default 30)
  manifest?: SkillManifest   // resource permissions declared by this skill
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  lastRunStatus?: "success" | "failed" | "timeout" | "blocked_by_risk" | "skipped_no_confirmation" | "skipped_no_action" | "circuit_broken" | "interrupted" | "running" | "pending_reauth"
  // Crew execution
  crew?: CrewConfig
}

export interface AutomationResult {
  id: string
  automationId: string
  startedAt: number
  finishedAt: number
  exitCode: number | null
  output: string
  summary?: string
  status: "success" | "failed" | "timeout" | "blocked_by_risk" | "skipped_no_confirmation" | "skipped_daily_limit" | "skipped_no_action" | "circuit_broken" | "interrupted" | "pending_reauth"
  riskReport?: SkillRiskReport
  behaviorStateHash?: string
  promptStateHash?: string
  launchStateHash?: string
  behaviorStateIssues?: string[]
  pendingMerge?: { worktreePath: string; branch: string; sessionId: string }  // set when requireMergeApproval=true and execution succeeded
  crewReport?: CrewExecutionReport  // set for crew automation runs
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

function normalizeAutomationLocale(locale?: string): string | undefined {
  if (!locale || !/^[A-Za-z0-9_-]{2,32}$/.test(locale)) return undefined
  if (locale.toLowerCase().startsWith("zh")) return "zh-TW"
  if (locale.toLowerCase().startsWith("ja")) return "ja"
  if (locale.toLowerCase().startsWith("ko")) return "ko"
  if (locale.toLowerCase().startsWith("en")) return "en"
  return locale
}

function getAutomationLocale(auto?: { locale?: string }): string {
  return normalizeAutomationLocale(auto?.locale) || getSystemLocale()
}

const LOCALE_NAMES: Record<string, string> = {
  "zh-TW": "Traditional Chinese (繁體中文)",
  "ja": "Japanese (日本語)",
  "ko": "Korean (한국어)",
  "en": "English",
}

export function wrapPromptWithLocale(prompt: string, locale: string = getSystemLocale()): string {
  if (locale === "en") return prompt
  const langName = LOCALE_NAMES[locale] || locale
  const outputStyle =
    locale === "zh-TW"
      ? "Use Traditional Chinese for all section headings, summaries, progress reports, tables, and final answers. Do not switch to Korean, Japanese, Simplified Chinese, or English except for unavoidable product names, API field names, or direct quotes."
      : locale === "ja"
        ? "Use Japanese for all section headings, summaries, progress reports, tables, and final answers."
        : locale === "ko"
          ? "Use Korean for all section headings, summaries, progress reports, tables, and final answers."
          : `All output, summaries, and reports must be in ${langName}.`
  return `[System] Respond in ${langName}. ${outputStyle}\n\n${prompt}`
}

// --- Agent protocol (shared with ws-server) ---

function buildAgentProtocol(locale?: string): string {
  const langHint = locale ? ` Respond in the user's language (${locale}).` : ""
  return [
    "AGENTRUNE PROTOCOL: You are running inside AgentRune.",
    `FIRST ACTION (mandatory, before anything else): If .agentrune/rules.md exists, read it and follow the behavior rules strictly. Then read .agentrune/agentlore.md (the project memory index). If agentlore.md does not exist, create it (mkdir -p .agentrune) by scanning the project.${langHint}`,
    "MEMORY: .agentrune/agentlore.md is the memory index. Do NOT read every context file by default. Use the index to choose only the sections relevant to the current task. If the right section is unclear, search the structured memory sections and then read the best matches. When you learn something stable, update the matching memory section instead of bloating the index. Do NOT use CLAUDE.md, .claude/memory/, or any agent-native memory system - the user cannot see those.",
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

// --- Atomic write + save queue ---

/** Write to a temp file then rename — prevents partial writes on crash/kill.
 *  Encrypts with AES-256-GCM (same scheme as vault keys and auth tokens). */
function writeAtomic(filePath: string, data: string): void {
  const tmpPath = `${filePath}.${randomBytes(4).toString("hex")}.tmp`
  try {
    writeEncryptedFile(tmpPath, data)
    renameSync(tmpPath, filePath)
  } catch (err) {
    // Clean up temp file on failure
    try { unlinkSync(tmpPath) } catch {}
    throw err
  }
}

/** Read a file, decrypting if encrypted. Auto-migrates plaintext files. */
function readAtomicEncrypted(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  const content = readEncryptedFile(filePath)
  if (content === null) return null
  // Auto-migrate: if file was plaintext, re-encrypt on read
  const raw = readFileSync(filePath, "utf-8")
  if (!isEncrypted(raw)) {
    writeEncryptedFile(filePath, content)
  }
  return content
}

/** Promise queue that serializes saveToDisk calls — prevents concurrent read-modify-write */
class SaveQueue {
  private queue: Promise<void> = Promise.resolve()

  enqueue(fn: () => void): void {
    this.queue = this.queue.then(() => {
      try { fn() } catch (err) {
        log.error(`[SaveQueue] ${err instanceof Error ? err.message : err}`)
      }
    })
  }

  /** Wait for all pending saves to complete (used in shutdown) */
  async flush(): Promise<void> {
    await this.queue
  }
}

// --- Manager ---

/** Context saved when an automation is killed for reauth */
export interface PendingReauth {
  automationId: string
  automationName: string
  sessionId: string
  violationType: string
  violationDescription: string
  permissionKey: string
  authorityMap: AuthorityMap
  killedAt: number
  estimatedReviewMs?: number
}

export type AutomationEventCallback = (event:
  | { type: "automation_started"; automationId: string; automationName: string; isCrew: boolean }
  | { type: "automation_completed"; automation: AutomationConfig; result: AutomationResult }
  | { type: "skill_confirmation_required"; automationId: string; skillId: string; riskReport: SkillRiskReport; manifest?: SkillManifest }
  | { type: "bypass_confirmation_required"; automationId: string; automationName: string }
  | { type: "daily_limit_reached"; automationId: string; automationName: string; limit: number; todayCount: number }
  | { type: "plan_review_required"; automationId: string; automationName: string; timeoutMinutes: number }
  | { type: "reauth_required"; automationId: string; automationName: string; permissionKey: string; violationType: string; violationDescription: string; killedAt: number; estimatedReviewMs?: number }
  | { type: "phase_gate_waiting"; gate: PhaseGateRequest }
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
  private _resultsLoadFailed = new Set<string>()
  private running = new Set<string>()  // prevent duplicate concurrent executions
  private dailyExecCount = new Map<string, number>()  // "YYYY-MM-DD" → count
  private storageDir: string
  private ptyManager: PtyManager
  private projects: Project[]
  private onEvent?: AutomationEventCallback
  private vaultPath?: string
  private limits: AutomationLimits
  private executor: AgentExecutor
  private whitelist: SkillWhitelist
  /** Pending confirmations: automationId → { resolve, timer } */
  private pendingConfirmations = new Map<string, { resolve: (action: "approve" | "approve_and_trust" | "deny") => void; timer: NodeJS.Timeout }>()
  /** Pending worktree merges: automationId → { worktree info for deferred merge } */
  private pendingMerges = new Map<string, { projectCwd: string; worktreePath: string; branch: string; sessionId: string }>()
  private saveQueue = new SaveQueue()
  private shuttingDown = false
  /** Pending reauth: automationId → context for user decision */
  private pendingReauths = new Map<string, PendingReauth>()
  /** Authority maps for running automations (persisted across reauth cycles) */
  private authorityMaps = new Map<string, AuthorityMap>()
  /** Pending phase gates: automationId → { resolve, request } */
  private pendingPhaseGates = new Map<string, { resolve: (response: PhaseGateResponse) => void; request: PhaseGateRequest }>()

  private static MAX_RESULTS_PER_AUTOMATION = 20
  private static MAX_OUTPUT_BYTES = 50_000

  private schedulingEnabled: boolean

  constructor(ptyManager: PtyManager, projects: Project[], onEvent?: AutomationEventCallback, opts?: { vaultPath?: string; limits?: AutomationLimits; schedulingEnabled?: boolean; executor?: AgentExecutor }) {
    this.ptyManager = ptyManager
    this.projects = projects
    this.onEvent = onEvent
    this.vaultPath = opts?.vaultPath
    this.limits = opts?.limits || FREE_LIMITS
    this.executor = opts?.executor || createLocalAgentExecutor()
    this.schedulingEnabled = opts?.schedulingEnabled !== false // default true
    this.whitelist = new SkillWhitelist()
    this.storageDir = join(getConfigDir(), "automations")
    mkdirSync(this.storageDir, { recursive: true })
    this.loadFromDisk()
    pruneAuditLogs()
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

  /** Resolve a pending phase gate from the client */
  resolvePhaseGate(automationId: string, response: PhaseGateResponse): boolean {
    const pending = this.pendingPhaseGates.get(automationId)
    if (!pending) return false
    this.pendingPhaseGates.delete(automationId)
    const review = summarizeReviewDecision({
      requestedAt: pending.request.timestamp,
      estimatedReviewMs: pending.request.estimatedReviewMs,
      reviewNote: response.reviewNote,
    })
    auditLog("phase_gate_response", {
      action: response.action,
      hasInstructions: !!response.instructions,
      ...review,
    }, { automationId, automationName: pending.request.automationName })
    pending.resolve(response)
    return true
  }

  /** List all pending phase gates (for WS reconnection state recovery) */
  listPendingPhaseGates(): PhaseGateRequest[] {
    return [...this.pendingPhaseGates.values()].map(p => p.request)
  }

  /** Get pending reauth requests */
  listPendingReauths(): PendingReauth[] {
    return [...this.pendingReauths.values()]
  }

  /** Get a specific pending reauth */
  getPendingReauth(automationId: string): PendingReauth | undefined {
    return this.pendingReauths.get(automationId)
  }

  /**
   * Resolve a pending reauth: approve (with optional noExpiry) or deny.
   * Approve → grant permission + re-trigger automation.
   * Deny → mark automation as blocked, no re-trigger.
   */
  async resolveReauth(
    automationId: string,
    action: "approve" | "deny",
    opts?: { noExpiry?: boolean; reviewNote?: string },
  ): Promise<{ success: boolean; message: string }> {
    const pending = this.pendingReauths.get(automationId)
    if (!pending) return { success: false, message: "No pending reauth found" }

    this.pendingReauths.delete(automationId)
    const review = summarizeReviewDecision({
      requestedAt: pending.killedAt,
      estimatedReviewMs: pending.estimatedReviewMs,
      reviewNote: opts?.reviewNote,
    })

    if (action === "deny") {
      // Mark automation status as blocked
      const auto = this.automations.get(automationId)
      if (auto) {
        auto.lastRunStatus = "failed"
        this.saveToDisk()
      }
      // Clean up authority map
      this.authorityMaps.delete(automationId)
      this.running.delete(automationId)

      auditLog("reauth_denied", {
        permissionKey: pending.permissionKey,
        ...review,
      }, { automationId, automationName: pending.automationName })
      log.info(`[Automation] Reauth denied for "${pending.automationName}": ${pending.permissionKey}`)
      return { success: true, message: "Reauth denied — automation blocked" }
    }

    // Approve: grant the permission on the authority map
    const severity: PermissionSeverity = pending.violationType === "wallet" || pending.violationType === "shell" ? "critical" : "warning"
    grantPermission(pending.authorityMap, pending.permissionKey, {
      noExpiry: opts?.noExpiry || false,
      severity,
      reason: `Reauth approved by user at ${new Date().toISOString()}`,
    })
    // Store updated authority map for next execution
    this.authorityMaps.set(automationId, pending.authorityMap)
    this.running.delete(automationId)

    auditLog("reauth_approved", {
      permissionKey: pending.permissionKey,
      noExpiry: opts?.noExpiry || false,
      severity,
      ...review,
    }, { automationId, automationName: pending.automationName })
    log.info(`[Automation] Reauth approved for "${pending.automationName}": ${pending.permissionKey} (noExpiry=${opts?.noExpiry || false})`)

    // Re-trigger the automation
    try {
      await this.trigger(automationId)
      return { success: true, message: "Reauth approved — automation re-triggered" }
    } catch (err) {
      return { success: false, message: `Reauth approved but re-trigger failed: ${err instanceof Error ? err.message : err}` }
    }
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
    const id = `auto_${Date.now()}_${randomBytes(4).toString("hex")}`
    const automation: AutomationConfig = {
      ...config,
      id,
      createdAt: Date.now(),
      runMode: config.runMode || "local",
      agentId: config.agentId || "claude",
      locale: normalizeAutomationLocale(config.locale) || getSystemLocale(),
      trustProfile: config.trustProfile || "supervised",
    }
    // Expand trust profile into concrete settings (unless custom)
    const expanded = expandTrustProfile(automation.trustProfile!)
    if (expanded) {
      automation.sandboxLevel = automation.sandboxLevel ?? expanded.sandboxLevel
      automation.requirePlanReview = automation.requirePlanReview ?? expanded.requirePlanReview
      automation.requireMergeApproval = automation.requireMergeApproval ?? expanded.requireMergeApproval
      automation.dailyRunLimit = automation.dailyRunLimit ?? expanded.dailyRunLimit
      automation.planReviewTimeoutMinutes = automation.planReviewTimeoutMinutes ?? expanded.planReviewTimeoutMinutes
    }
    automation.behaviorStateHash = computeAutomationBehaviorStateHash(automation)
    this.automations.set(id, automation)
    this.results.set(id, [])
    this.persistFullState()

    if (automation.enabled) {
      this.startSchedule(automation)
    }
    return automation
  }

  remove(id: string): boolean {
    this.stopSchedule(id)
    const deleted = this.automations.delete(id)
    this.results.delete(id)
    if (deleted) this.persistFullState()
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
    this.persistFullState()
    return true
  }

  disable(id: string): boolean {
    const auto = this.automations.get(id)
    if (!auto) return false
    auto.enabled = false
    this.stopSchedule(id)
    this.persistFullState()
    return true
  }

  update(id: string, updates: Partial<Pick<AutomationConfig, "name" | "command" | "prompt" | "skill" | "schedule" | "enabled" | "runMode" | "agentId" | "locale" | "model" | "templateId" | "bypass" | "trustProfile" | "requireMergeApproval" | "requirePlanReview" | "sandboxLevel" | "dailyRunLimit" | "planReviewTimeoutMinutes" | "timeoutMinutes" | "manifest" | "crew">>): (AutomationConfig & { nextRunAt?: number }) | null {
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
    if (updates.locale !== undefined) auto.locale = normalizeAutomationLocale(updates.locale) || getSystemLocale()
    if (updates.model !== undefined) auto.model = updates.model
    if (updates.templateId !== undefined) auto.templateId = updates.templateId
    if (updates.bypass !== undefined) auto.bypass = updates.bypass
    if (updates.manifest !== undefined) auto.manifest = updates.manifest
    if (updates.crew !== undefined) auto.crew = updates.crew
    // Trust Layer fields
    if (updates.trustProfile !== undefined) {
      auditLog("trust_profile_changed", { from: auto.trustProfile, to: updates.trustProfile }, { automationId: id, automationName: auto.name })
      auto.trustProfile = updates.trustProfile
      const expanded = expandTrustProfile(updates.trustProfile)
      if (expanded) {
        auto.sandboxLevel = expanded.sandboxLevel
        auto.requirePlanReview = expanded.requirePlanReview
        auto.requireMergeApproval = expanded.requireMergeApproval
        auto.dailyRunLimit = expanded.dailyRunLimit
        auto.planReviewTimeoutMinutes = expanded.planReviewTimeoutMinutes
      }
    }
    // Individual overrides (for custom profile or manual tweaks)
    if (updates.sandboxLevel !== undefined) auto.sandboxLevel = updates.sandboxLevel
    if (updates.requireMergeApproval !== undefined) auto.requireMergeApproval = updates.requireMergeApproval
    if (updates.requirePlanReview !== undefined) auto.requirePlanReview = updates.requirePlanReview
    if (updates.dailyRunLimit !== undefined) auto.dailyRunLimit = updates.dailyRunLimit
    if (updates.planReviewTimeoutMinutes !== undefined) auto.planReviewTimeoutMinutes = updates.planReviewTimeoutMinutes

    const scheduleChanged = JSON.stringify(auto.schedule) !== oldSchedule
    const enabledChanged = wasEnabled !== auto.enabled

    // Only restart timer if schedule or enabled state changed
    if (scheduleChanged || enabledChanged) {
      if (wasEnabled) this.stopSchedule(id)
      if (auto.enabled) this.startSchedule(auto)
    }

    auto.behaviorStateHash = computeAutomationBehaviorStateHash(auto)
    this.persistFullState()
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
    if (!this.schedulingEnabled) return // release daemon does not schedule
    this.stopSchedule(auto.id) // clear any existing

    if (auto.schedule.type === "interval") {
      const ms = (auto.schedule.intervalMinutes || 30) * 60 * 1000

      // If last run was recent, delay first execution to respect the interval
      // If overdue (sinceLastRun >= interval), run immediately instead of waiting another full cycle
      const sinceLastRun = auto.lastRunAt ? Date.now() - auto.lastRunAt : ms
      const overdue = sinceLastRun >= ms
      const initialDelay = overdue ? 0 : ms - sinceLastRun

      if (overdue) {
        log.info(`[Automation] "${auto.name}" overdue by ${Math.round((sinceLastRun - ms) / 60000)}m — running immediately`)
      } else if (initialDelay < ms) {
        log.info(`[Automation] "${auto.name}" last ran ${Math.round(sinceLastRun / 60000)}m ago, next in ${Math.round(initialDelay / 60000)}m`)
      } else {
        log.info(`[Automation] Starting interval for "${auto.name}" every ${auto.schedule.intervalMinutes}m`)
      }

      this.nextRunAtMap.set(auto.id, Date.now() + initialDelay)

      // Use setTimeout for the first tick (respects lastRunAt), then setInterval
      const startInterval = () => {
        const timer = setInterval(() => {
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
        this.nextRunAtMap.set(auto.id, Date.now() + ms)
        this.executeAutomation(auto.id)
      }

      const delayTimer = setTimeout(startInterval, initialDelay)
      this.timers.set(auto.id, delayTimer)
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
    // behavior state validation happens during execution, not during schedule calculation
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

  private buildRecentRunPromptContext(automationId: string): string | null {
    const recentRuns = (this.results.get(automationId) || [])
      .slice(-3)
      .reverse()

    if (recentRuns.length === 0) return null

    const lines = recentRuns.map((result) => {
      const summary = (result.summary || extractAutomationSummary(result.output || "", result.status))
        .replace(/\s+/g, " ")
        .trim()
      const compactSummary = summary.length > 180 ? `${summary.slice(0, 177)}...` : summary
      return `- ${this.formatAutomationTimestamp(result.finishedAt)} | ${result.status} | ${compactSummary || "no summary"}`
    })

    return [
      "[Recent Automation Memory]",
      "Recent runs of this exact automation:",
      ...lines,
      "Build on the latest run state instead of repeating the same output. If nothing materially changed, say so briefly and avoid redundant work.",
    ].join("\n")
  }

  private formatAutomationTimestamp(timestamp: number): string {
    try {
      return new Intl.DateTimeFormat("zh-TW", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(timestamp))
    } catch {
      return new Date(timestamp).toISOString()
    }
  }

  /** Build the agent command args + prompt file for an automation.
   *  Prompt is written to a temp file and piped via stdin (child_process.spawn).
   */
  private buildAutomationCommand(auto: AutomationConfig): { bin: string; args: string[]; promptFilePath: string; fullPrompt: string } | null {
    const rawPrompt = auto.prompt || ""
    let promptText = wrapPromptWithLocale(rawPrompt, getAutomationLocale(auto))
    const socialMode = detectAutomationSocialMode(auto)
    const recentRunContext = this.buildRecentRunPromptContext(auto.id)

    // Legacy raw command field is no longer supported for direct execution (security: command injection risk).
    if (auto.command && !auto.prompt) {
      promptText = wrapPromptWithLocale(auto.command, getAutomationLocale(auto))
    }

    if (recentRunContext) {
      promptText = `${recentRunContext}\n\n${promptText}`
    }

    // Inject skill instruction into prompt if specified
    if (auto.skill) {
      promptText = `[Important] Use the MCP skill "${auto.skill}" to accomplish this task. Call the relevant MCP tool for this skill before proceeding.\n\n${promptText}`
    }

    // Inject sandbox instructions based on sandboxLevel
    const sandboxLevel = auto.sandboxLevel || "strict"
    const project = this.projects.find(p => p.id === auto.projectId)
    if (sandboxLevel !== "none") {
      const manifest = auto.manifest || createManifestForLevel(auto.templateId || auto.id, sandboxLevel)
      if (project) {
        const sandboxBlock = buildSandboxInstructions(manifest, project.cwd)
        promptText = `${sandboxBlock}\n\n${promptText}`
      }
    }

    // Inject planning constraints (standards + sandbox + authority)
    const authorityMap = createFromTrustProfile({
      sessionId: auto.id,
      automationId: auto.id,
      sandboxLevel: auto.sandboxLevel,
      requirePlanReview: auto.requirePlanReview,
      requireMergeApproval: auto.requireMergeApproval,
    })
    const constraintSet = buildPlanningConstraints({
      projectPath: project?.cwd,
      sandboxLevel: auto.sandboxLevel || "strict",
      manifest: auto.manifest,
      authorityMap,
      trustProfile: auto.trustProfile,
      locale: getAutomationLocale(auto),
    })
    const constraintsBlock = formatConstraintsForPrompt(constraintSet)
    if (constraintsBlock) {
      promptText = `${constraintsBlock}\n\n${promptText}`
    }

    if (socialMode) {
      const recentSocialContext = buildRecentSocialPostPromptContext(socialMode.platform)
      promptText = [
        buildAutomationSocialInstructions(socialMode),
        recentSocialContext,
        promptText,
      ].filter(Boolean).join("\n\n")
    }

    // Write prompt (with agent protocol) to file
    const locale = getAutomationLocale(auto)
    const agentProtocol = buildAgentProtocol(locale)
    const fullPrompt = `[System Instructions]\n${agentProtocol}\n\n[User Prompt]\n${promptText}`
    const promptFilePath = writePromptFile(this.storageDir, auto.id, fullPrompt)

    switch (auto.agentId) {
      case "claude": {
        // Use -p with short instruction to read prompt file — avoids stdin pipe issues with long prompts
        const args = ["-p", `Read and follow all instructions in this file: ${promptFilePath}`, "--dangerously-skip-permissions"]
        if (auto.model && /^[a-zA-Z0-9._-]+$/.test(auto.model)) args.push("--model", auto.model)
        return { bin: "claude", args, promptFilePath, fullPrompt }
      }
      case "codex": {
        const args = ["--full-auto", "-q", `Read and follow all instructions in ${promptFilePath}`]
        if (auto.model && /^[a-zA-Z0-9._-]+$/.test(auto.model)) args.push("--model", auto.model)
        return { bin: "codex", args, promptFilePath, fullPrompt }
      }
      default: {
        const agentBin = auto.agentId && /^[a-zA-Z0-9_-]+$/.test(auto.agentId) ? auto.agentId : "claude"
        return { bin: agentBin, args: ["--print"], promptFilePath, fullPrompt }
      }
    }
  }

  /** Kill a running automation process */
  killAutomation(id: string): boolean {
    const proc = this.runningProcesses.get(id)
    if (!proc || proc.killed) return false
    // Resolve any pending phase gate to prevent deadlock
    const pendingGate = this.pendingPhaseGates.get(id)
    if (pendingGate) {
      pendingGate.resolve({ automationId: id, action: "abort" })
      this.pendingPhaseGates.delete(id)
    }
    killProcessTree(proc)
    // Force kill after 5s if still running
    setTimeout(() => { if (!proc.killed) killProcessTree(proc) }, 5000)
    return true
  }

  /** Manually trigger an automation (ignores schedule, respects rate limits) */
  async trigger(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.schedulingEnabled) return { ok: false, error: "Automation execution disabled on this daemon" }
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

  /** Fire-and-forget: create a temp automation with crew config and execute immediately */
  async fireAndForget(projectId: string, name: string, crew: CrewConfig, sessionContext?: string): Promise<string> {
    if (!this.schedulingEnabled) throw new Error("Automation execution disabled on this daemon (release daemon)");
    const id = `fire_${Date.now()}_${randomBytes(4).toString("hex")}`
    const auto: AutomationConfig = {
      id,
      projectId,
      name,
      prompt: sessionContext || "",
      schedule: { type: "manual" },
      enabled: false, // no scheduling
      createdAt: Date.now(),
      runMode: "local",
      agentId: "claude",
      trustProfile: "autonomous",
      bypass: true,
      crew,
    }
    this.automations.set(id, auto)
    this.results.set(id, [])

    // Inject session context as handoff for first phase
    if (sessionContext) {
      auto.prompt = sessionContext
    }

    // Execute in background
    this.executeAutomation(id, true).catch((err) => {
      log.error(`[Automation] Fire-and-forget failed for "${name}": ${err?.message || err}`)
    }).finally(() => {
      // Clean up temp automation after a delay (keep for report access)
      setTimeout(() => {
        // Don't delete if still running
        if (!this.running.has(id)) {
          // Keep in memory for 1 hour for report access, then remove
        }
      }, 60 * 60 * 1000)
    })

    return id
  }

  /** Execute an automation: open a PTY, launch agent, collect output */
  private async executeAutomation(id: string, manualTrigger = false) {
    if (!this.schedulingEnabled) return // release daemon does not execute automations
    const auto = this.automations.get(id)
    if (!auto || (!auto.enabled && !manualTrigger)) return
    const socialMode = detectAutomationSocialMode(auto)

    // Prevent duplicate concurrent execution
    if (this.running.has(id)) {
      log.info(`[Automation] "${auto.name}" already running, skipping`)
      return
    }
    this.running.add(id)
    auto.lastRunStatus = "running"
    this.saveToDisk()

    auditLog("automation_started", { trustProfile: auto.trustProfile, sandboxLevel: auto.sandboxLevel, manualTrigger }, { automationId: id, automationName: auto.name })

    if (this.onEvent) {
      this.onEvent({ type: "automation_started", automationId: id, automationName: auto.name, isCrew: !!auto.crew })
    }

    try {
      if (socialMode) {
        const activeCooldown = getActiveSocialPublishCooldown(socialMode.platform)
        if (activeCooldown) {
          const startedAt = Date.now()
          const output = [
            "--- AgentRune Social Publish ---",
            `Platform: ${socialMode.platform}`,
            "Posted: skipped",
            "Reason: publish cooldown active",
            `Cooldown: ${formatSocialPublishCooldown(activeCooldown, startedAt)}`,
            `Cooldown Reason: ${activeCooldown.reason}`,
            activeCooldown.error ? `Last Error: ${activeCooldown.error}` : undefined,
            activeCooldown.source ? `Source: ${activeCooldown.source}` : undefined,
            manualTrigger ? "Manual Trigger: respected active cooldown" : undefined,
          ].filter(Boolean).join("\n")

          const resultEntry: AutomationResult = {
            id: `result_${Date.now()}_${randomBytes(3).toString("hex")}`,
            automationId: id,
            startedAt,
            finishedAt: Date.now(),
            exitCode: null,
            output,
            summary: extractAutomationSummary(output, "skipped_no_action"),
            status: "skipped_no_action",
          }

          this.storeResult(id, resultEntry)
          auto.lastRunAt = resultEntry.finishedAt
          auto.lastRunStatus = "skipped_no_action"
          this.saveToDisk()

          log.info(`[Automation] "${auto.name}" skipped: active ${socialMode.platform} publish cooldown`)
          auditLog(
            "automation_completed",
            { status: resultEntry.status, exitCode: resultEntry.exitCode, durationMs: resultEntry.finishedAt - resultEntry.startedAt },
            { automationId: id, automationName: auto.name },
          )
          if (this.onEvent) {
            this.onEvent({ type: "automation_completed", automation: auto, result: resultEntry })
          }
          return
        }
      }

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

      // Per-automation daily run limit (from Trust Profile)
      if (auto.dailyRunLimit && auto.dailyRunLimit > 0) {
        const results = this.results.get(id) || []
        const todayStart = new Date(todayKey).getTime()
        const todayRunCount = results.filter(r => r.startedAt >= todayStart && r.status !== "skipped_daily_limit").length
        if (todayRunCount >= auto.dailyRunLimit) {
          log.warn(`[Automation] Per-automation daily limit reached for "${auto.name}" (${todayRunCount}/${auto.dailyRunLimit})`)
          auditLog("daily_limit_reached", { todayRunCount, limit: auto.dailyRunLimit }, { automationId: id, automationName: auto.name })
          const result: AutomationResult = {
            id: `result_${Date.now()}`, automationId: id, startedAt: Date.now(), finishedAt: Date.now(),
            exitCode: null, output: `Skipped: daily run limit reached (${todayRunCount}/${auto.dailyRunLimit})`,
            status: "skipped_daily_limit",
          }
          this.storeResult(id, result)
          this.running.delete(id)
          if (this.onEvent) {
            this.onEvent({ type: "daily_limit_reached", automationId: id, automationName: auto.name, limit: auto.dailyRunLimit, todayCount: todayRunCount })
          }
          return
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

    // ── Security gate: whitelist + confirmation (bypass=true skips this) ──
    const skillId = auto.templateId || auto.skill || auto.id
    if (!auto.bypass && !this.whitelist.isTrusted(skillId) && riskReport.score >= 30 && this.onEvent) {
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

    // ── Plan Review gate (Trust Layer) ──
    if (auto.requirePlanReview && this.onEvent) {
      const timeoutMinutes = auto.planReviewTimeoutMinutes || 30
      log.info(`[Automation] Plan review required for "${auto.name}" (timeout: ${timeoutMinutes}m)`)
      auditLog("plan_review_requested", { timeoutMinutes }, { automationId: id, automationName: auto.name })
      this.onEvent({ type: "plan_review_required", automationId: id, automationName: auto.name, timeoutMinutes })

      const action = await this.waitForConfirmation(id, timeoutMinutes * 60 * 1000)
      if (action === "deny") {
        log.info(`[Automation] Plan review rejected for "${auto.name}"`)
        auditLog("plan_review_denied", {}, { automationId: id, automationName: auto.name })
        const result: AutomationResult = {
          id: `result_${Date.now()}`, automationId: id, startedAt: Date.now(), finishedAt: Date.now(),
          exitCode: null, output: "Skipped: plan review rejected by user",
          status: "skipped_no_confirmation",
        }
        this.storeResult(id, result)
        this.running.delete(id)
        return
      }
      // "approve" or "approve_and_trust" → proceed
      log.info(`[Automation] Plan review approved for "${auto.name}"`)
      auditLog("plan_review_approved", {}, { automationId: id, automationName: auto.name })
    }

    // ── Crew execution path ──
    if (auto.crew && auto.crew.roles.length > 0) {
      await this.executeCrewAutomation(id, auto, project)
      return
    }

    const locale = getAutomationLocale(auto)
    const built = this.buildAutomationCommand(auto)
    if (!built) {
      log.warn(`[Automation] Could not build command for "${auto.name}" (agent=${auto.agentId})`)
      return
    }
    auto.behaviorStateHash = auto.behaviorStateHash || computeAutomationBehaviorStateHash(auto)
    const promptStateHash = computeAutomationPromptStateHash(built.fullPrompt)
    const launchStateHash = computeAutomationLaunchStateHash({
      bin: built.bin,
      args: built.args,
      fullPrompt: built.fullPrompt,
    })
    const behaviorStateIssues = validateAutomationLaunchState(auto, {
      bin: built.bin,
      args: built.args,
      fullPrompt: built.fullPrompt,
    })
    if (behaviorStateIssues.length > 0) {
      auditLog("runtime_violation", {
        type: "behavior_state",
        description: "Configured automation state did not fully reach the runtime launch snapshot",
        matchedText: behaviorStateIssues.join(" | "),
        permissionKey: "behavior.state",
        permitted: false,
        halted: false,
      }, { automationId: id, automationName: auto.name })
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

      // Runtime Authority Map — reuse from previous reauth cycle or create fresh
      const isResumedExec = this.authorityMaps.has(id)
      const runtimeAuthority = this.authorityMaps.get(id) || createFromTrustProfile({
        sessionId: `exec_${id}_${startedAt}`,
        automationId: id,
        sandboxLevel: auto.sandboxLevel,
        requirePlanReview: auto.requirePlanReview,
        requireMergeApproval: auto.requireMergeApproval,
      })
      // Store authority map for potential reauth cycles
      this.authorityMaps.set(id, runtimeAuthority)

      const monitor = new SkillMonitor({
        manifest,
        projectCwd: execProject.cwd,
        autoHalt: riskReport.score >= 30,
        authorityMap: runtimeAuthority,
        isResumedSession: isResumedExec,
        onReauthRequired: (violation, permissionKey) => {
          // Kill process + save context for reauth
          const proc = this.runningProcesses.get(id)
          if (proc && !proc.killed) killProcessTree(proc)
          const estimatedReviewMs = estimateReauthReviewMs(permissionKey, violation.description)

          const reauth: PendingReauth = {
            automationId: id,
            automationName: auto.name,
            sessionId: `exec_${id}_${startedAt}`,
            violationType: violation.type,
            violationDescription: violation.description,
            permissionKey,
            authorityMap: runtimeAuthority,
            killedAt: Date.now(),
            estimatedReviewMs,
          }
          this.pendingReauths.set(id, reauth)
          auditLog("reauth_required", {
            permissionKey, violationType: violation.type,
            violationDescription: violation.description,
            estimatedReviewMs,
          }, { automationId: id, automationName: auto.name })
          log.warn(`[Automation] Reauth required for "${auto.name}": ${permissionKey} — waiting for user`)

          // Mark status as pending reauth
          auto.lastRunStatus = "pending_reauth"
          this.saveToDisk()

          if (this.onEvent) {
            this.onEvent({
              type: "reauth_required",
              automationId: id,
              automationName: auto.name,
              permissionKey,
              violationType: violation.type,
              violationDescription: violation.description,
              killedAt: reauth.killedAt,
              estimatedReviewMs,
            })
          }
        },
        onViolation: (v) => {
          // Runtime authority checkpoint: check if violated permission is denied
          const permKey = violationTypeToPermissionKey(v.type)
          const permitted = hasPermission(runtimeAuthority, permKey)
          auditLog("runtime_violation", {
            type: v.type, description: v.description, matchedText: v.matchedText,
            permissionKey: permKey, permitted, halted: !permitted,
          }, { automationId: id, automationName: auto.name })

          if (!permitted) {
            // Authority denies this operation — halt
            auditLog("runtime_halt", { reason: `Authority denied: ${permKey}`, violationType: v.type }, { automationId: id, automationName: auto.name })
            log.warn(`[Automation] Authority checkpoint halted "${auto.name}": ${permKey} denied`)
            const proc = this.runningProcesses.get(id)
            if (proc && !proc.killed) killProcessTree(proc)
          }

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
          auditLog("runtime_halt", { reason }, { automationId: id, automationName: auto.name })
          const proc = this.runningProcesses.get(id)
          if (proc && !proc.killed) killProcessTree(proc)
        },
      })

      // Spawn agent process directly — no PTY, clean stdin/stdout pipe
      const TIMEOUT_MS = (auto.timeoutMinutes || 30) * 60 * 1000
      const env = buildAgentEnvironment()

      const result = await new Promise<{ exitCode: number | null; timedOut: boolean; output: string }>((resolve) => {
        let resolved = false
        const outputChunks: string[] = []
        let outputBytes = 0
        const MAX_OUTPUT_CAPTURE = 100_000

        const proc = this.executor.spawnProcess({
          command: built.bin,
          args: built.args,
          cwd: worktree?.path || execProject.cwd,
          baseEnv: env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
          windowsHide: true,
        })

        this.runningProcesses.set(id, proc)

        // Close stdin — prompt is passed via -p flag or agent reads from file
        if (proc.stdin) {
          try { proc.stdin.end() } catch {}
          proc.stdin.on("error", () => {})
        }

        // Collect stdout (with error handler to prevent daemon crash on broken pipe)
        if (proc.stdout) {
          proc.stdout.on("data", (data: Buffer) => {
            const text = data.toString()
            if (outputBytes < MAX_OUTPUT_CAPTURE) {
              outputChunks.push(text)
              outputBytes += text.length
            }
            monitor.processOutput(text)
          })
          proc.stdout.on("error", () => {})
        }

        // Collect stderr (merge into output, with error handler)
        if (proc.stderr) {
          proc.stderr.on("data", (data: Buffer) => {
            const text = data.toString()
            if (outputBytes < MAX_OUTPUT_CAPTURE) {
              outputChunks.push(text)
              outputBytes += text.length
            }
          })
          proc.stderr.on("error", () => {})
        }

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
      // Fallback: if stdout was empty (Windows pipe buffering), extract activity from JSONL
      if (!output || output.length === 0) {
        const jsonlActivity = extractJSONLActivity(execProject.cwd, startedAt)
        if (jsonlActivity) output = jsonlActivity
      }
      if (output.length > AutomationManager.MAX_OUTPUT_BYTES) {
        output = output.slice(-AutomationManager.MAX_OUTPUT_BYTES)
      }
      exitCode = result.exitCode
      status = monitor.isHalted() ? "blocked_by_risk" : result.timedOut ? "timeout" : "success"
      if (monitor.getViolations().length > 0) {
        const violations = monitor.getViolations()
        output += `\n\n--- Monitor Report ---\nViolations: ${violations.length}\n${violations.map(v => `[${v.severity}] ${v.type}: ${v.description} — "${v.matchedText}"`).join("\n")}`
      }
      if (behaviorStateIssues.length > 0) {
        output += `\n\n--- Behavior State ---\nConfig Hash: ${auto.behaviorStateHash}\nPrompt Hash: ${promptStateHash}\nLaunch Hash: ${launchStateHash}\nIssues:\n${behaviorStateIssues.map((issue) => `- ${issue}`).join("\n")}`
      }
      if (socialMode && status === "success") {
        const directive = extractAutomationSocialDirective(output, socialMode.platform)
        if (directive?.kind === "post") {
          const duplicateMatch = findDuplicateSocialPost({
            platform: directive.platform,
            text: directive.text,
            title: directive.title,
          })

          if (duplicateMatch) {
            output += `\n\n--- AgentRune Social Publish ---\nPlatform: ${directive.platform}\nPosted: skipped\nReason: duplicate content matched a recently published post\nDuplicate Of: ${formatSocialDuplicateMatch(duplicateMatch)}\nSource: ${directive.source || "unknown"}`
            status = "skipped_no_action"
          } else {
            const publishResult = await publishSocialPost({
              platform: directive.platform,
              text: directive.text,
              title: directive.title,
              submolt: directive.submolt,
              source: directive.source,
              reason: directive.reason,
            })
            if (publishResult.success) {
              output += `\n\n--- AgentRune Social Publish ---\nPlatform: ${directive.platform}\nPosted: yes\nPost ID: ${publishResult.postId}\nSource: ${directive.source || "unknown"}`

              const cooldownClear = clearSocialPublishCooldown(directive.platform)
              if (cooldownClear.success) {
                output += `\nCooldown Guard: ${cooldownClear.cleared ? "cleared" : "not active"}`
              } else {
                output += `\nCooldown Guard: clear failed\nCooldown Guard Error: ${cooldownClear.error || "Unknown cooldown clear error"}`
              }

              const dedupeResult = rememberSocialPost({
                platform: directive.platform,
                text: directive.text,
                title: directive.title,
                postId: publishResult.postId,
                source: directive.source,
                reason: directive.reason,
                recordType: directive.recordType,
                recordTitle: directive.recordTitle,
                recordMetrics: directive.recordMetrics,
                publishedAt: Date.now(),
              })
              if (dedupeResult.success) {
                output += `\nDuplicate Guard: ${dedupeResult.stored ? "recorded" : "already recorded"}`
              } else {
                output += `\nDuplicate Guard: failed\nDuplicate Guard Error: ${dedupeResult.error || "Unknown duplicate history error"}`
              }

              // Auto-reply CTA on Moltbook posts
              if (directive.platform === "moltbook" && publishResult.postId) {
                try {
                  await new Promise((resolve) => setTimeout(resolve, 5000))
                  const cta = pickCtaVariant()
                  const ctaResult = await postMoltbookComment(publishResult.postId, cta)
                  if (ctaResult.success) {
                    log.info(`[Automation] CTA self-reply posted on ${publishResult.postId}`)
                  } else {
                    log.warn(`[Automation] CTA self-reply failed: ${ctaResult.error}`)
                  }
                } catch (ctaErr) {
                  log.warn(`[Automation] CTA self-reply error: ${ctaErr instanceof Error ? ctaErr.message : String(ctaErr)}`)
                }
              }

              // Auto-reply CTA on X posts
              if (directive.platform === "x" && publishResult.postId) {
                try {
                  await new Promise((resolve) => setTimeout(resolve, 10000))
                  const cta = pickXCtaVariant()
                  const ctaResult = await postXSelfReply(publishResult.postId, cta)
                  if (ctaResult.success) {
                    log.info(`[Automation] X CTA self-reply posted on ${publishResult.postId}`)
                  } else {
                    log.warn(`[Automation] X CTA self-reply failed: ${ctaResult.error}`)
                  }
                } catch (ctaErr) {
                  log.warn(`[Automation] X CTA self-reply error: ${ctaErr instanceof Error ? ctaErr.message : String(ctaErr)}`)
                }
              }

              // Auto-trigger Playwright reply bot after X post
              // Spawns as detached background process with jittered delay, engages with related growing posts
              if (directive.platform === "x") {
                try {
                  const replyScript = join(project.cwd, "scripts", "x-auto-reply.ts")
                  if (existsSync(replyScript)) {
                    const topicText = (directive.text.split("\n---\n")[0] || "").slice(0, 200)
                    // Jittered delay: 15-30 min (anti-detection: not always the same gap)
                    const delayMin = 15 + Math.floor(Math.random() * 16)
                    // Sanitize topicText for safe env var usage (strip shell metacharacters)
                    const safeTopicText = topicText.replace(/[^\p{L}\p{N}\s.,!?;:'"()\-]/gu, "")
                    // Only forward safe env vars — avoid leaking API keys to child process
                    const safeEnv: Record<string, string> = { X_REPLY_TOPIC: safeTopicText }
                    for (const k of ["PATH", "HOME", "USERPROFILE", "NODE_ENV", "LANG", "TERM"]) {
                      if (process.env[k]) safeEnv[k] = process.env[k]!
                    }
                    const child = spawn("npx", ["tsx", replyScript, "--delay-min", String(delayMin)], {
                      detached: true,
                      stdio: "ignore",
                      cwd: project.cwd,
                      env: safeEnv,
                    })
                    child.unref()
                    log.info(`[Automation] X reply bot spawned (PID ${child.pid}), will start in ~${delayMin} min`)
                    output += `\nReply Bot: spawned (PID ${child.pid}), starts in ~${delayMin} min`
                  }
                } catch (replyErr) {
                  log.warn(`[Automation] X reply bot spawn failed: ${replyErr instanceof Error ? replyErr.message : String(replyErr)}`)
                }
              }

              const historyResult = recordPublishedSocialPost({
                platform: directive.platform,
                recordType: directive.recordType,
                recordTitle: directive.recordTitle,
                recordMetrics: directive.recordMetrics,
              })
              if (historyResult.success) {
                output += `\nMaterials Updated: ${historyResult.skipped ? "already up to date" : "yes"}\nMaterials Path: ${historyResult.path || "unknown"}`
              } else {
                output += `\nMaterials Updated: no\nMaterials Error: ${historyResult.error || "Unknown materials update error"}`
              }
            } else {
              output += `\n\n--- AgentRune Social Publish ---\nPlatform: ${directive.platform}\nPosted: no\nError: ${publishResult.error || "Unknown publish error"}`
              if (publishResult.cooldownMs && publishResult.cooldownReason) {
                const cooldownResult = rememberSocialPublishCooldown({
                  platform: directive.platform,
                  reason: publishResult.cooldownReason,
                  cooldownMs: publishResult.cooldownMs,
                  retryAfterMs: publishResult.retryAfterMs,
                  statusCode: publishResult.statusCode,
                  error: publishResult.error,
                  source: directive.source,
                })
                if (cooldownResult.success && cooldownResult.entry) {
                  output += `\nCooldown Guard: active until ${formatSocialPublishCooldown(cooldownResult.entry)}`
                } else {
                  output += `\nCooldown Guard: failed\nCooldown Guard Error: ${cooldownResult.error || "Unknown cooldown persistence error"}`
                }
              }
              status = "failed"
            }
          }
        } else if (directive?.kind === "skip") {
          output += `\n\n--- AgentRune Social Publish ---\nPlatform: ${directive.platform}\nPosted: skipped\nReason: ${directive.reason}\nSource: ${directive.source || "unknown"}`
          status = "skipped_no_action"
        } else if (outputIndicatesNoPublishableContent(output)) {
          output += `\n\n--- AgentRune Social Publish ---\nPlatform: ${socialMode.platform}\nPosted: skipped\nReason: automation reported that no publishable materials were available`
          status = "skipped_no_action"
        } else if (outputNeedsManualIntervention(output)) {
          output += "\n\n--- AgentRune Social Publish ---\nPosted: no\nError: automation requested manual intervention instead of API posting"
          status = "failed"
        } else {
          output += "\n\n--- AgentRune Social Publish ---\nPosted: no\nError: social automation did not emit a publish or skip directive"
          status = "failed"
        }
      }
    } catch (err) {
      log.error(`[Automation] execution error: ${err instanceof Error ? err.message : String(err)}`)
      output = "Automation execution failed unexpectedly"
      status = "failed"
    }

    let summary = extractAutomationSummary(output, status)
    if (shouldUseLlmSummary(output)) {
      try {
        const humanized = await callLlmForSummary(output, { locale, agentId: auto.agentId })
        if (humanized?.trim()) summary = humanized.trim()
      } catch (err) {
        log.warn(`[Automation] LLM summary failed for "${auto.name}": ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const resultEntry: AutomationResult = {
      id: `result_${Date.now()}_${randomBytes(3).toString("hex")}`,
      automationId: id,
      startedAt,
      finishedAt: Date.now(),
      exitCode,
      output,
      summary,
      status,
      behaviorStateHash: auto.behaviorStateHash,
      promptStateHash,
      launchStateHash,
      behaviorStateIssues: behaviorStateIssues.length > 0 ? [...behaviorStateIssues] : undefined,
    }

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
          status: status === "success" || status === "skipped_no_action" ? "done" : "blocked",
          summary: `${status === "success" ? "Completed" : status === "skipped_no_action" ? "Skipped" : status === "timeout" ? "Timed out" : "Failed"} in ${durationStr}${worktree ? ` (branch: ${worktree.branch})` : ""}`,
          nextSteps: status !== "success" && status !== "skipped_no_action" ? ["Check automation output for details"] : [],
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

    this.storeResult(id, resultEntry)

    // Broadcast completion event
    auditLog("automation_completed", { status: resultEntry.status, exitCode: resultEntry.exitCode, durationMs: resultEntry.finishedAt - resultEntry.startedAt }, { automationId: id, automationName: auto.name })
    if (this.onEvent) {
      this.onEvent({ type: "automation_completed", automation: auto, result: resultEntry })
    }
    } finally {
      this.running.delete(id)
    }
  }

  // --- Crew execution ---

  /** Execute a crew automation: run roles phase-by-phase with circuit breaker and handoff */
  private async executeCrewAutomation(id: string, auto: AutomationConfig, project: Project) {
    const crew = auto.crew!
    const startedAt = Date.now()
    const report: CrewExecutionReport = {
      automationId: id,
      startedAt,
      completedAt: 0,
      status: "completed",
      totalTokensUsed: 0,
      tokenBudget: crew.tokenBudget,
      targetBranch: crew.targetBranch,
      phases: [],
    }

    log.info(`[Crew] Starting crew execution for "${auto.name}" — ${crew.roles.length} roles, budget ${crew.tokenBudget} tokens`)

    // Create target branch if specified
    let execCwd = project.cwd
    if (crew.targetBranch) {
      const branchName = crew.targetBranch.replace("YYYY-MM-DD", new Date().toISOString().slice(0, 10))
      try {
        execFileSync("git", ["checkout", "-b", branchName], { cwd: project.cwd, stdio: "pipe" })
        report.targetBranch = branchName
        log.info(`[Crew] Created target branch: ${branchName}`)
      } catch (err) {
        // Branch might already exist — try checkout
        try {
          execFileSync("git", ["checkout", branchName], { cwd: project.cwd, stdio: "pipe" })
          report.targetBranch = branchName
        } catch {
          log.warn(`[Crew] Failed to create/checkout branch "${branchName}": ${err}`)
        }
      }
    }

    // Group roles by phase, sort phases ascending
    const phaseMap = new Map<number, CrewRole[]>()
    for (const role of crew.roles) {
      const list = phaseMap.get(role.phase) || []
      list.push(role)
      phaseMap.set(role.phase, list)
    }
    const sortedPhases = [...phaseMap.keys()].sort((a, b) => a - b)

    let handoffSummary = ""  // accumulated summary from previous phases
    let circuitBroken = false

    for (const phaseNum of sortedPhases) {
      if (circuitBroken) break

      const roles = phaseMap.get(phaseNum)!
      log.info(`[Crew] Phase ${phaseNum}: executing ${roles.length} role(s) — ${roles.map(r => r.id).join(", ")}`)

      // Circuit breaker check before phase starts
      if (report.totalTokensUsed >= crew.tokenBudget) {
        circuitBroken = true
        log.warn(`[Crew] Circuit breaker: budget exceeded (${report.totalTokensUsed}/${crew.tokenBudget})`)
        // Mark remaining roles as circuit_broken
        const remainingPhases = sortedPhases.filter(p => p >= phaseNum)
        for (const p of remainingPhases) {
          const remainingRoles = phaseMap.get(p)!
          report.phases.push({
            phase: p,
            roles: remainingRoles.map(r => ({
              roleId: r.id,
              roleName: r.nameKey,
              icon: r.icon,
              color: r.color,
              phase: p,
              status: "circuit_broken" as const,
              tokensUsed: 0,
              durationMs: 0,
              outputSummary: "Circuit breaker: token budget exceeded",
            })),
          })
        }
        break
      }

      // Execute all roles in this phase concurrently
      const roleResults = await Promise.all(
        roles.map(role => this.executeCrewRole(auto, role, execCwd, handoffSummary))
      )

      const phaseResult = { phase: phaseNum, roles: roleResults }
      report.phases.push(phaseResult)

      // Accumulate tokens and build handoff
      let phaseSummaries: string[] = []
      for (const rr of roleResults) {
        report.totalTokensUsed += rr.tokensUsed

        if (rr.status === "completed") {
          phaseSummaries.push(`[${rr.roleName}]: ${rr.outputSummary}`)
        } else if (rr.status === "failed") {
          phaseSummaries.push(`[${rr.roleName}]: FAILED — ${rr.outputSummary}`)
        }

        // Circuit breaker mid-phase check
        if (report.totalTokensUsed >= crew.tokenBudget) {
          circuitBroken = true
          log.warn(`[Crew] Circuit breaker triggered mid-phase ${phaseNum} (${report.totalTokensUsed}/${crew.tokenBudget})`)
        }
      }

      // Build handoff summary for next phase
      const handoffLengthBeforePhase = handoffSummary.length
      handoffSummary += `\n\n--- Phase ${phaseNum} Results ---\n${phaseSummaries.join("\n\n")}`

      // Phase delay
      if (crew.phaseDelayMinutes && crew.phaseDelayMinutes > 0 && !circuitBroken) {
        const delayMs = crew.phaseDelayMinutes * 60 * 1000
        log.info(`[Crew] Phase delay: waiting ${crew.phaseDelayMinutes}m before next phase`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }

      // Phase Gate: pause for human decision between phases
      const phaseIdx = sortedPhases.indexOf(phaseNum)
      const hasNextPhase = phaseIdx < sortedPhases.length - 1
      if (crew.phaseGate && hasNextPhase && !circuitBroken) {
        const nextPhaseNum = sortedPhases[phaseIdx + 1]
        const gateRequest: PhaseGateRequest = {
          automationId: id,
          automationName: auto.name,
          completedPhase: phaseNum,
          nextPhase: nextPhaseNum,
          phaseResults: roleResults.map(r => ({
            roleId: r.roleId, roleName: r.roleName, icon: r.icon,
            color: r.color, status: r.status, outputSummary: r.outputSummary,
          })),
          totalTokensUsed: report.totalTokensUsed,
          tokenBudget: crew.tokenBudget,
          timestamp: Date.now(),
          estimatedReviewMs: estimatePhaseGateReviewMs(roleResults),
        }

        log.info(`[Crew] Phase gate: waiting for human decision after phase ${phaseNum}`)
        auditLog("phase_gate_waiting", { completedPhase: phaseNum, nextPhase: nextPhaseNum }, { automationId: id, automationName: auto.name })

        // Broadcast gate event + wait for response (infinite wait)
        if (this.onEvent) {
          this.onEvent({ type: "phase_gate_waiting", gate: gateRequest })
        }

        const gateResponse = await new Promise<PhaseGateResponse>((resolve) => {
          this.pendingPhaseGates.set(id, { resolve, request: gateRequest })
        })

        log.info(`[Crew] Phase gate response: ${gateResponse.action}${gateResponse.instructions ? ` (with instructions)` : ""}`)

        if (gateResponse.action === "abort") {
          // Mark remaining phases as aborted
          const remainingPhases = sortedPhases.filter(p => p > phaseNum)
          for (const p of remainingPhases) {
            const remainingRoles = phaseMap.get(p)!
            report.phases.push({
              phase: p,
              roles: remainingRoles.map(r => ({
                roleId: r.id, roleName: r.nameKey, icon: r.icon, color: r.color,
                phase: p, status: "aborted" as const, tokensUsed: 0, durationMs: 0,
                outputSummary: "Aborted by user at phase gate",
              })),
            })
          }
          report.status = "aborted"
          break
        } else if (gateResponse.action === "proceed_with_instructions") {
          // Append user instructions to handoff for next phase
          if (gateResponse.instructions) {
            handoffSummary += `\n\n--- Human Instructions (after Phase ${phaseNum}) ---\n${gateResponse.instructions}`
          }
        } else if (gateResponse.action === "retry" || gateResponse.action === "retry_with_instructions") {
          // Re-execute current phase: remove last phase result, restore handoff to pre-phase state
          report.phases.pop()
          handoffSummary = handoffSummary.slice(0, handoffLengthBeforePhase)

          // Add retry instructions if provided
          let retryHandoff = handoffSummary
          if (gateResponse.action === "retry_with_instructions" && gateResponse.instructions) {
            retryHandoff += `\n\n--- Human Instructions (retry Phase ${phaseNum}) ---\n${gateResponse.instructions}`
          }

          log.info(`[Crew] Retrying phase ${phaseNum}`)
          const retryResults = await Promise.all(
            roles.map(role => this.executeCrewRole(auto, role, execCwd, retryHandoff))
          )

          // Replace phase result
          const retryPhaseResult = { phase: phaseNum, roles: retryResults }
          report.phases.push(retryPhaseResult)

          // Recalculate tokens for retry
          let retryPhaseSummaries: string[] = []
          for (const rr of retryResults) {
            report.totalTokensUsed += rr.tokensUsed
            if (rr.status === "completed") {
              retryPhaseSummaries.push(`[${rr.roleName}]: ${rr.outputSummary}`)
            } else if (rr.status === "failed") {
              retryPhaseSummaries.push(`[${rr.roleName}]: FAILED — ${rr.outputSummary}`)
            }
            if (report.totalTokensUsed >= crew.tokenBudget) {
              circuitBroken = true
            }
          }

          // Rebuild handoff with retry results
          handoffSummary += `\n\n--- Phase ${phaseNum} Results (retry) ---\n${retryPhaseSummaries.join("\n\n")}`
        }
        // "proceed" → continue normally, no changes needed
      }
    }

    report.completedAt = Date.now()
    if (!report.status || report.status === "completed") {
      report.status = circuitBroken ? "circuit_broken" : report.phases.some(p => p.roles.every(r => r.status === "failed")) ? "failed" : "completed"
    }

    // Store crew report
    this.storeCrewReport(id, report)

    // Build overall automation result
    const outputParts = report.phases.flatMap(p =>
      p.roles.map(r => `[Phase ${r.phase}] ${r.roleName}: ${r.status} (${r.tokensUsed} tok, ${r.durationMs}ms)\n${r.outputSummary}`)
    )
    const output = outputParts.join("\n\n---\n\n")

    const resultEntry: AutomationResult = {
      id: `result_${Date.now()}_${randomBytes(3).toString("hex")}`,
      automationId: id,
      startedAt,
      finishedAt: report.completedAt,
      exitCode: report.status === "completed" ? 0 : 1,
      output: output.length > AutomationManager.MAX_OUTPUT_BYTES ? output.slice(-AutomationManager.MAX_OUTPUT_BYTES) : output,
      summary: `Crew: ${report.status} — ${crew.roles.length} roles, ${report.totalTokensUsed}/${crew.tokenBudget} tokens`,
      status: report.status === "aborted" ? "failed" : report.status === "circuit_broken" ? "circuit_broken" : report.status === "failed" ? "failed" : "success",
      crewReport: report,
    }

    this.storeResult(id, resultEntry)

    auto.lastRunAt = resultEntry.finishedAt
    auto.lastRunStatus = resultEntry.status === "success" ? "success" : resultEntry.status === "circuit_broken" ? "circuit_broken" : "failed"
    this.saveToDisk()

    const durationMs = report.completedAt - startedAt
    log.info(`[Crew] "${auto.name}" finished: ${report.status} (${durationMs}ms, ${report.totalTokensUsed}/${crew.tokenBudget} tokens)`)

    // Broadcast completion
    auditLog("automation_completed", { status: resultEntry.status, durationMs, crewStatus: report.status, totalTokens: report.totalTokensUsed }, { automationId: id, automationName: auto.name })
    if (this.onEvent) {
      this.onEvent({ type: "automation_completed", automation: auto, result: resultEntry })
    }
  }

  /** Execute a single crew role as an agent process */
  private async executeCrewRole(auto: AutomationConfig, role: CrewRole, cwd: string, handoffSummary: string): Promise<CrewRoleResult> {
    const roleStart = Date.now()
    const locale = getAutomationLocale(auto)

    // Build role-specific prompt with persona, handoff, and humanizer
    let rolePrompt = ""

    // Persona injection
    rolePrompt += `[Your Role]\nYou are acting as: ${role.nameKey}\n`
    rolePrompt += `Persona:\n- Tone: ${role.persona.tone}\n- Focus: ${role.persona.focus}\n- Style: ${role.persona.style}\n\n`

    // Handoff from previous phases
    if (handoffSummary) {
      rolePrompt += `[Previous Phase Results]\nThe following work was completed in earlier phases. Build on these results:\n${handoffSummary}\n\n`
    }

    // Core task prompt
    rolePrompt += `[Task]\n${role.prompt}\n\n`

    // Skill chain workflow injection
    if (role.skillChainWorkflow) {
      rolePrompt += `[Workflow]\nFollow these steps in order:\n${role.skillChainWorkflow}\n\n`
    }

    // Humanizer injection based on locale
    if (locale === "zh-TW" || locale.startsWith("zh")) {
      rolePrompt += `[Output Style]\nWrite naturally in Traditional Chinese. Avoid AI-sounding patterns: no "在當今快速發展的時代", no "讓我們深入探討", no "值得注意的是". Use short sentences, casual tone, mix Chinese and English terms naturally.\n\n`
    } else {
      rolePrompt += `[Output Style]\nWrite naturally. Avoid AI-sounding patterns: no "In today's fast-paced world", no "Let's dive in", no "It's worth noting", no "leverage", no "robust". Use short sentences, direct tone.\n\n`
    }

    // Wrap with locale
    const promptText = wrapPromptWithLocale(rolePrompt, locale)

    // Build agent protocol + write prompt file
    const agentProtocol = buildAgentProtocol(locale)
    const fullPrompt = `[System Instructions]\n${agentProtocol}\n\n[User Prompt]\n${promptText}`
    const promptFilePath = writePromptFile(this.storageDir, `${auto.id}_${role.id}`, fullPrompt)

    // Build agent args
    const agentId = auto.agentId || "claude"
    let bin: string
    let args: string[]
    switch (agentId) {
      case "claude":
        bin = "claude"
        args = ["-p", `Read and follow all instructions in this file: ${promptFilePath}`, "--dangerously-skip-permissions"]
        if (auto.model && /^[a-zA-Z0-9._-]+$/.test(auto.model)) args.push("--model", auto.model)
        break
      case "codex":
        bin = "codex"
        args = ["--full-auto", "-q", `Read and follow all instructions in ${promptFilePath}`]
        if (auto.model && /^[a-zA-Z0-9._-]+$/.test(auto.model)) args.push("--model", auto.model)
        break
      default:
        bin = /^[a-zA-Z0-9_-]+$/.test(agentId) ? agentId : "claude"
        args = ["--print"]
        break
    }

    // Spawn process
    const ROLE_TIMEOUT_MS = (auto.timeoutMinutes || 30) * 60 * 1000
    const env = buildAgentEnvironment()

    try {
      const result = await new Promise<{ exitCode: number | null; timedOut: boolean; output: string }>((resolve) => {
        let resolved = false
        const outputChunks: string[] = []
        let outputBytes = 0
        const MAX_OUTPUT = 100_000

        const proc = this.executor.spawnProcess({
          command: bin,
          args,
          cwd,
          baseEnv: env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
          windowsHide: true,
        })

        if (proc.stdin) {
          try { proc.stdin.end() } catch {}
          proc.stdin.on("error", () => {})
        }

        if (proc.stdout) {
          proc.stdout.on("data", (data: Buffer) => {
            const text = data.toString()
            if (outputBytes < MAX_OUTPUT) {
              outputChunks.push(text)
              outputBytes += text.length
            }
          })
          proc.stdout.on("error", () => {})
        }

        if (proc.stderr) {
          proc.stderr.on("data", (data: Buffer) => {
            const text = data.toString()
            if (outputBytes < MAX_OUTPUT) {
              outputChunks.push(text)
              outputBytes += text.length
            }
          })
          proc.stderr.on("error", () => {})
        }

        proc.on("close", (code) => {
          if (!resolved) { resolved = true; resolve({ exitCode: code, timedOut: false, output: outputChunks.join("") }) }
        })
        proc.on("error", (err) => {
          if (!resolved) { resolved = true; resolve({ exitCode: 1, timedOut: false, output: `Spawn error: ${err.message}` }) }
        })

        setTimeout(() => {
          if (!resolved) {
            resolved = true
            killProcessTree(proc)
            setTimeout(() => { if (!proc.killed) killProcessTree(proc) }, 5000)
            resolve({ exitCode: null, timedOut: true, output: outputChunks.join("") })
          }
        }, ROLE_TIMEOUT_MS)
      })

      const roleDuration = Date.now() - roleStart
      // Fallback: if stdout was empty, extract activity from JSONL
      let roleOutput = result.output
      if (!roleOutput || roleOutput.length === 0) {
        const jsonlActivity = extractJSONLActivity(cwd, roleStart)
        if (jsonlActivity) roleOutput = jsonlActivity
      }
      const summary = extractAutomationSummary(roleOutput, result.timedOut ? "timeout" : "success")

      return {
        roleId: role.id,
        roleName: role.nameKey,
        icon: role.icon,
        color: role.color,
        phase: role.phase,
        status: result.timedOut ? "failed" : (result.exitCode === 0 || result.exitCode === null ? "completed" : "failed"),
        tokensUsed: role.estimatedTokens || 2000,
        durationMs: roleDuration,
        outputSummary: summary,
        outputFull: roleOutput.length > AutomationManager.MAX_OUTPUT_BYTES ? roleOutput.slice(-AutomationManager.MAX_OUTPUT_BYTES) : roleOutput,
      }
    } catch (err) {
      return {
        roleId: role.id,
        roleName: role.nameKey,
        icon: role.icon,
        color: role.color,
        phase: role.phase,
        status: "failed",
        tokensUsed: 0,
        durationMs: Date.now() - roleStart,
        outputSummary: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /** Store a crew execution report */
  private storeCrewReport(automationId: string, report: CrewExecutionReport): void {
    const filePath = join(this.storageDir, `crew_report_${automationId}.json`)
    // Keep last 10 reports
    let reports: CrewExecutionReport[] = []
    try {
      if (existsSync(filePath)) {
        reports = JSON.parse(readFileSync(filePath, "utf-8"))
      }
    } catch {}
    reports.push(report)
    if (reports.length > 10) reports.splice(0, reports.length - 10)
    writeFileSync(filePath, JSON.stringify(reports, null, 2))
  }

  /** Get crew execution reports for an automation */
  getCrewReports(automationId: string): CrewExecutionReport[] {
    const filePath = join(this.storageDir, `crew_report_${automationId}.json`)
    try {
      if (existsSync(filePath)) {
        return JSON.parse(readFileSync(filePath, "utf-8"))
      }
    } catch {}
    return []
  }

  // --- Persistence ---

  private getAutomationsFile(): string {
    return join(this.storageDir, "automations.json")
  }

  private getResultsFile(automationId: string): string {
    return join(this.storageDir, `results_${automationId}.json`)
  }

  /**
   * saveToDisk — daemon-only fields (lastRunAt, lastRunStatus).
   * Reads disk first, merges only daemon-owned fields, writes atomically.
   * User-facing fields (enabled, schedule, name, etc.) are written by persistFullState().
   */
  private saveToDisk() {
    this.saveQueue.enqueue(() => this.saveToDiskSync())
  }

  /** Synchronous save — called inside the queue or during shutdown */
  private saveToDiskSync() {
    const filePath = this.getAutomationsFile()
    let diskMap = new Map<string, AutomationConfig>()
    try {
      const diskContent = readAtomicEncrypted(filePath)
      if (diskContent) {
        const diskData: AutomationConfig[] = JSON.parse(diskContent)
        for (const a of diskData) diskMap.set(a.id, a)
      }
    } catch { /* ignore parse errors */ }

    // Only update daemon-owned fields on existing disk entries
    for (const [id, auto] of this.automations) {
      const disk = diskMap.get(id)
      if (disk) {
        // Daemon fields — always overwrite from memory
        disk.lastRunAt = auto.lastRunAt
        disk.lastRunStatus = auto.lastRunStatus
      } else {
        // New automation not on disk yet — write full object
        diskMap.set(id, { ...auto })
      }
    }

    // Remove automations that were deleted in memory
    for (const id of diskMap.keys()) {
      if (!this.automations.has(id)) diskMap.delete(id)
    }

    writeAtomic(filePath, JSON.stringify([...diskMap.values()], null, 2))
  }

  /**
   * persistFullState — writes the full automation config to disk (atomic).
   * Used by API write-through (add/remove/update/enable/disable).
   */
  private persistFullState() {
    this.saveQueue.enqueue(() => {
      const filePath = this.getAutomationsFile()
      const data = [...this.automations.values()]
      writeAtomic(filePath, JSON.stringify(data, null, 2))
    })
  }

  private saveResultsToDisk(automationId: string) {
    if (this._resultsLoadFailed.has(automationId)) {
      // Results failed to load — merge new results with existing disk data instead of overwriting
      try {
        const diskContent = readAtomicEncrypted(this.getResultsFile(automationId))
        const diskResults: AutomationResult[] = diskContent ? JSON.parse(diskContent) : []
        const memResults = this.results.get(automationId) || []
        const existingIds = new Set(diskResults.map(r => r.id))
        const merged = [...diskResults, ...memResults.filter(r => !existingIds.has(r.id))]
        if (merged.length > AutomationManager.MAX_RESULTS_PER_AUTOMATION) {
          merged.splice(0, merged.length - AutomationManager.MAX_RESULTS_PER_AUTOMATION)
        }
        writeAtomic(this.getResultsFile(automationId), JSON.stringify(merged, null, 2))
        this.results.set(automationId, merged)
        this._resultsLoadFailed.delete(automationId)
        log.info(`[Automation] Recovered results for "${automationId}" — merged ${diskResults.length} disk + ${memResults.length} new`)
      } catch (err) {
        log.warn(`[Automation] Cannot merge results for "${automationId}", saving in-memory only: ${err}`)
        const results = this.results.get(automationId) || []
        writeAtomic(this.getResultsFile(automationId), JSON.stringify(results, null, 2))
      }
      return
    }
    const results = this.results.get(automationId) || []
    writeAtomic(this.getResultsFile(automationId), JSON.stringify(results, null, 2))
  }

  private loadFromDisk() {
    try {
      const filePath = this.getAutomationsFile()
      if (!existsSync(filePath)) return

      const content = readAtomicEncrypted(filePath)
      if (!content) return
      const data: AutomationConfig[] = JSON.parse(content)
      let needsSave = false
      for (const auto of data) {
        // Backward compat: infer trustProfile from sandboxLevel for pre-Trust-Layer automations
        if (!auto.trustProfile) {
          const sl = auto.sandboxLevel || "strict"
          if (sl === "none" && !auto.requirePlanReview && !auto.requireMergeApproval) {
            auto.trustProfile = "autonomous"
          } else if (sl === "strict" && auto.requirePlanReview) {
            auto.trustProfile = "guarded"
          } else if (sl === "moderate" || sl === "permissive") {
            auto.trustProfile = "supervised"
          } else {
            auto.trustProfile = "custom"
          }
        }
        // Stale state recovery: if lastRunStatus looks like it was mid-run, mark interrupted
        if (auto.lastRunStatus === "running") {
          log.warn(`[Automation] "${auto.name}" was running when daemon last exited — marking interrupted`)
          auto.lastRunStatus = "interrupted"
          needsSave = true
        }
        const behaviorStateHash = computeAutomationBehaviorStateHash(auto)
        if (auto.behaviorStateHash !== behaviorStateHash) {
          auto.behaviorStateHash = behaviorStateHash
          needsSave = true
        }

        this.automations.set(auto.id, auto)
        // Load results — on failure, log warning but DO NOT overwrite the disk file
        try {
          const resultsPath = this.getResultsFile(auto.id)
          if (existsSync(resultsPath)) {
            this.results.set(auto.id, JSON.parse(readAtomicEncrypted(resultsPath) || "[]"))
          } else {
            this.results.set(auto.id, [])
          }
        } catch (err) {
          log.warn(`[Automation] Failed to load results for "${auto.name}": ${err}`)
          // Use empty array in memory but mark as unloaded so saveResultsToDisk won't overwrite
          this.results.set(auto.id, [])
          this._resultsLoadFailed.add(auto.id)
        }
        // Resume enabled schedules (only if this daemon is the scheduler)
        if (auto.enabled && this.schedulingEnabled) {
          this.startSchedule(auto)
        }
      }
      if (needsSave) this.saveToDiskSync()
      log.info(`[Automation] Loaded ${data.length} automations from disk${this.schedulingEnabled ? "" : " (scheduling disabled — release daemon)"}`)
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
  private waitForConfirmation(automationId: string, timeoutMs?: number): Promise<"approve" | "approve_and_trust" | "deny"> {
    return new Promise((resolve) => {
      const ms = timeoutMs || 5 * 60 * 1000 // default 5 minutes

      const timer = setTimeout(() => {
        this.pendingConfirmations.delete(automationId)
        log.info(`[Automation] Confirmation timed out for "${automationId}" — defaulting to deny`)
        resolve("deny")
      }, ms)

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

  /** Synchronous kill of all running automation child processes.
   *  Called from process.on("exit") to prevent zombie orphans on daemon crash.
   *  Must be synchronous — async won't run inside "exit" handler. */
  killAllRunning(): void {
    for (const [id, proc] of this.runningProcesses) {
      try { killProcessTree(proc) } catch {}
    }
    this.runningProcesses.clear()
    this.running.clear()
  }

  /**
   * Graceful shutdown: kill running automations, mark interrupted, save, exit.
   * Called from SIGTERM/SIGINT handlers.
   */
  async gracefulShutdown(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    log.warn(`[Automation] Graceful shutdown — ${this.runningProcesses.size} running, ${this.timers.size} scheduled`)

    // 1. Stop all timers
    this.stopAll()

    // 2. Resolve all pending phase gates to prevent deadlock
    for (const [id, pending] of this.pendingPhaseGates) {
      pending.resolve({ automationId: id, action: "abort" })
    }
    this.pendingPhaseGates.clear()

    // 3. Kill all running automation processes
    for (const [id, proc] of this.runningProcesses) {
      log.warn(`[Automation] Killing running automation: ${id} (PID ${proc.pid})`)
      killProcessTree(proc)
      // Mark as interrupted
      const auto = this.automations.get(id)
      if (auto) {
        auto.lastRunStatus = "interrupted"
        auto.lastRunAt = Date.now()
      }
      // Store interrupted result
      this.storeResult(id, {
        id: `result_${Date.now()}_${randomBytes(3).toString("hex")}`,
        automationId: id,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        exitCode: null,
        output: "Daemon shutdown — automation interrupted",
        summary: "Interrupted by daemon shutdown",
        status: "interrupted",
      })
    }
    this.runningProcesses.clear()
    this.running.clear()

    // 3. Final save (synchronous — we're about to exit)
    try {
      this.saveToDiskSync()
    } catch (err) {
      log.error(`[Automation] Failed to save on shutdown: ${err instanceof Error ? err.message : err}`)
    }

    // 4. Wait for queued saves to flush
    await this.saveQueue.flush()
    log.info(`[Automation] Shutdown complete`)
  }
}
