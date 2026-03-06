// adapters/types.ts
import type { AgentEvent, ParseContext } from "../shared/types.js"

export type { AgentEvent, ParseContext } from "../shared/types.js"

/** PTY-based adapter: parses raw terminal output into structured events */
export interface AgentAdapter {
  id: string
  name: string
  icon: string
  capabilities: string[]
  parse(chunk: string, ctx: ParseContext): AgentEvent[]
  detectIdle(buffer: string): boolean
}

/** API-based adapter: connects via WebSocket/REST instead of PTY */
export interface ApiAgentAdapter {
  id: string
  name: string
  transport: "websocket" | "rest"
  connect(config: Record<string, unknown>): Promise<ApiAgentConnection>
}

/** Active connection to an API-based agent */
export interface ApiAgentConnection {
  send(message: string): void
  close(): void
  onEvent(handler: (event: AgentEvent) => void): void
}

export function makeEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
