// server/adapters/types.ts
import type { AgentEvent, ParseContext } from "../../shared/types.js"

export type { AgentEvent, ParseContext } from "../../shared/types.js"

export interface AgentAdapter {
  id: string
  name: string
  icon: string
  capabilities: string[]
  parse(chunk: string, ctx: ParseContext): AgentEvent[]
  detectIdle(buffer: string): boolean
}

export function makeEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
