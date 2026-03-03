// server/parse-engine.ts
import type { AgentEvent, ParseContext } from "../shared/types.js"
import { getAdapter } from "./adapters/index.js"

const MAX_BUFFER_LINES = 200

export class ParseEngine {
  private buffer: string[] = []
  private ctx: ParseContext
  private adapter

  constructor(agentId: string, projectId: string) {
    this.adapter = getAdapter(agentId)
    this.ctx = {
      buffer: "",
      agentId,
      projectId,
      isIdle: false,
    }
  }

  /** Feed raw PTY output, returns any detected events */
  feed(chunk: string): AgentEvent[] {
    // Update rolling buffer
    const newLines = chunk.split("\n")
    this.buffer.push(...newLines)
    if (this.buffer.length > MAX_BUFFER_LINES) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_LINES)
    }
    this.ctx.buffer = this.buffer.join("\n")

    // Check idle state
    this.ctx.isIdle = this.adapter.detectIdle(this.ctx.buffer)

    // Parse with agent-specific adapter
    const events = this.adapter.parse(chunk, this.ctx)

    // Update context
    if (events.length > 0) {
      this.ctx.lastEventType = events[events.length - 1].type
    }

    return events
  }

  isIdle(): boolean {
    return this.ctx.isIdle
  }

  getAgentId(): string {
    return this.ctx.agentId
  }

  clear(): void {
    this.buffer = []
    this.ctx.buffer = ""
    this.ctx.lastEventType = undefined
    this.ctx.isIdle = false
  }
}
