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
    | "session_summary"
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
}

export interface DecisionOption {
  label: string
  input: string
  style: "primary" | "danger" | "default"
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

export interface ParseContext {
  buffer: string        // rolling buffer of recent output (last ~200 lines)
  agentId: string
  projectId: string
  lastEventType?: string
  isIdle: boolean
}
