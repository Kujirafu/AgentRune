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

export interface Task {
  id: number
  title: string
  description: string
  status: "pending" | "in_progress" | "done"
  dependsOn: number[]
}

export interface TaskStore {
  projectId: string
  requirement: string
  tasks: Task[]
  prd?: string
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
