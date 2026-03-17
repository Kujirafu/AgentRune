// data/automation-types.ts
// Shared types for the scheduling system

export type ScheduleType = "daily" | "interval"
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

export interface AutomationSchedule {
  type: ScheduleType
  timeOfDay?: string        // "09:00" (daily mode)
  weekdays?: number[]       // [0-6], 0=Sun 1=Mon...6=Sat
  intervalMinutes?: number  // (interval mode)
}

// --- Crew system ---

export interface CrewPersona {
  tone: string       // 說話風格
  focus: string      // 關注重點
  style: string      // 工作風格
}

export interface CrewRole {
  id: string
  nameKey: string              // i18n key: "crew.role.pm"
  prompt: string               // 任務指令
  persona: CrewPersona
  icon: string                 // Lucide icon name: "target", "code"
  color: string                // 角色代表色
  skillChainSlug?: string      // 可選掛載 skills chain
  skillChainWorkflow?: string  // 序列化的技能鏈步驟（前端生成，CLI 注入 prompt）
  phase: number                // 執行階段，同 phase 並行
  estimatedTokens?: number     // 預估 token 用量
}

export interface CrewConfig {
  roles: CrewRole[]
  tokenBudget: number           // 熔斷閾值（總 token 上限）
  targetBranch?: string         // trial 分支名稱（空 = 不切分支）
  phaseDelayMinutes?: number    // 階段間延遲（預設 0）
  phaseGate?: boolean           // 階段間人類介入關卡（預設 false）
}

// --- Phase Gate ---

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
}

export interface PhaseGateResponse {
  automationId: string
  action: PhaseGateAction
  instructions?: string       // 補充指示（proceed_with_instructions / retry_with_instructions）
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

  // Execution content
  command?: string          // legacy raw command (backward compat)
  prompt?: string           // natural language prompt for agent
  skill?: string            // MCP skill name (optional)

  // Template source
  templateId?: string

  // Schedule
  schedule: AutomationSchedule

  // Execution environment
  runMode: "local" | "worktree"
  agentId: string
  locale?: string
  bypass?: boolean           // --dangerously-skip-permissions (unattended mode)

  // Trust Layer
  trustProfile?: TrustProfile          // default: "supervised"
  sandboxLevel?: SandboxLevel
  requirePlanReview?: boolean
  requireMergeApproval?: boolean
  dailyRunLimit?: number               // 0 = unlimited
  planReviewTimeoutMinutes?: number    // 0 = no timeout
  timeoutMinutes?: number             // execution timeout per run (default 30)

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
  summary?: string  // human-readable summary of what the agent actually did
  status: "success" | "failed" | "timeout" | "blocked_by_risk" | "skipped_no_confirmation" | "skipped_daily_limit" | "skipped_no_action" | "circuit_broken" | "interrupted" | "pending_reauth"
}

export interface AutomationTemplate {
  id: string
  name: string
  description: string
  icon: string
  prompt: string
  skill?: string

  category: "builtin" | "community" | "custom" | "crew"

  // Crew config (only for crew templates)
  crew?: CrewConfig

  authorId?: string
  visibility: "private" | "public"
  rating: number
  ratingCount: number
  pinCount: number

  tags?: string[]
  group?: string
  subgroup?: string
  createdAt: number
}
