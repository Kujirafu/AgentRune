// shared/types.ts
// Shared between server and client — no Node.js or DOM dependencies

export interface AgentEvent {
  id: string
  timestamp: number
  type:
    | "file_edit"
    | "file_create"
    | "file_delete"
    | "command_run"
    | "test_result"
    | "install_package"
    | "decision_request"
    | "error"
    | "info"
    | "token_usage"
    | "response"
    | "user_message"
    | "session_summary"
    | "progress_report"
  status: "in_progress" | "completed" | "failed" | "waiting"
  title: string
  detail?: string
  raw?: string
  diff?: {
    filePath: string
    before: string
    after: string
  }
  decision?: {
    options: DecisionOption[]
    purpose?: string    // 目的 — why the agent needs this permission
    scope?: string      // 影響範圍 — what files/systems will be affected
  }
  progress?: ProgressReport
}

export interface DecisionOption {
  label: string
  input: string
  style: "primary" | "danger" | "default"
}

export interface ProgressReport {
  title: string
  status: "done" | "blocked" | "in_progress"
  summary: string
  nextSteps: string[]
  details?: string
}

export interface SessionSummary {
  filesModified: number
  filesCreated: number
  linesAdded: number
  linesRemoved: number
  testsRun?: number
  testsPassed?: number
  decisionsAsked: number
  duration: number
}

export type PrdPriority = "p0" | "p1" | "p2" | "p3"
export type PrdStatus = "active" | "done"

export interface Task {
  id: number
  title: string
  description: string
  status: "pending" | "in_progress" | "done" | "skipped"
  priority?: PrdPriority
  dependsOn: number[]
}

export interface PrdDecision {
  question: string
  answer: string
}

export interface PrdApproach {
  name: string
  pros: string[]
  cons: string[]
  adopted: boolean
  techNote?: string
}

export interface PrdItem {
  id: string
  title: string
  priority: PrdPriority
  status: PrdStatus
  goal: string
  decisions: PrdDecision[]
  approaches: PrdApproach[]
  scope: { included: string[]; excluded: string[] }
  tasks: Task[]
  createdAt: number
  updatedAt: number
}

/** @deprecated Use PrdItem instead — kept for migration */
export interface Prd {
  goal: string
  decisions: PrdDecision[]
  approaches: PrdApproach[]
  scope: { included: string[]; excluded: string[] }
}

export interface TaskStore {
  projectId: string
  requirement: string
  tasks: Task[]
  prd?: Prd
  createdAt: number
  updatedAt: number
}

export interface ParseContext {
  buffer: string        // rolling buffer of recent output (last ~200 lines)
  scrollback?: string   // full scrollback for TUI menu detection (set by server)
  agentId: string
  projectId: string
  projectCwd?: string   // project working directory (for reading files)
  lastEventType?: string
  isIdle: boolean
  resumeCursorOffset?: number  // net cursor position after server auto-scroll in /resume TUI
  resumeTuiActive?: boolean    // signal from parse engine: resume TUI is on screen (trigger only, no decision event)
  locale?: string              // user locale for i18n (e.g. "zh-TW", "en")
}

export interface Project {
  id: string
  name: string
  cwd: string
  shell?: string
}

export interface Session {
  id: string
  projectId: string
  agentId: string
  createdAt: number
  lastActivity: number
}
