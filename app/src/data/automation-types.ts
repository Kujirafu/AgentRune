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
  bypass?: boolean           // --dangerously-skip-permissions (unattended mode)

  // Trust Layer
  trustProfile?: TrustProfile          // default: "supervised"
  sandboxLevel?: SandboxLevel
  requirePlanReview?: boolean
  requireMergeApproval?: boolean
  dailyRunLimit?: number               // 0 = unlimited
  planReviewTimeoutMinutes?: number    // 0 = no timeout

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
  summary?: string  // human-readable summary of what the agent actually did
  status: "success" | "failed" | "timeout" | "blocked_by_risk" | "skipped_no_confirmation" | "skipped_daily_limit"
}

export interface AutomationTemplate {
  id: string
  name: string
  description: string
  icon: string
  prompt: string
  skill?: string

  category: "builtin" | "community" | "custom"

  authorId?: string
  visibility: "private" | "public"
  rating: number
  ratingCount: number
  pinCount: number

  tags?: string[]
  group?: string
  createdAt: number
}
