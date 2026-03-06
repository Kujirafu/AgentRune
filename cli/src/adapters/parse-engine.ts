// adapters/parse-engine.ts
import type { AgentEvent, ParseContext } from "../shared/types.js"
import { getAdapter } from "./index.js"

const MAX_BUFFER_LINES = 200

export class ParseEngine {
  private buffer: string[] = []
  private ctx: ParseContext
  private adapter

  constructor(agentId: string, projectId: string, projectCwd?: string) {
    this.adapter = getAdapter(agentId)
    this.ctx = {
      buffer: "",
      agentId,
      projectId,
      projectCwd,
      isIdle: false,
    }
  }

  /** Set scrollback data for TUI menu detection */
  setScrollback(scrollback: string): void {
    this.ctx.scrollback = scrollback
  }

  /** Set cursor offset from server auto-scroll in /resume TUI */
  setResumeCursorOffset(offset: number): void {
    this.ctx.resumeCursorOffset = offset
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

  /** Reset resume-related adapter state so re-feed can emit fresh options */
  resetResumeState(): void {
    const as = (this.ctx as any)._as
    if (as) {
      as.resumeEmitted = false
      as.resumeFirstSeen = 0
    }
  }

  /** Prepare engine for scrollback reparse: clear dedup state, buffer */
  prepareReparse(): void {
    const as = (this.ctx as any)._as
    if (as) {
      as.seenTools.clear()
      as.seenToolsExpire = Date.now() + 30000
      as.resumeSummaryEmitted = true  // Don't emit summary during reparse
      as.responseAccum = ""
      as.pending = ""
    }
    this.buffer = []
    this.ctx.buffer = ""
  }

  clear(): void {
    this.buffer = []
    this.ctx.buffer = ""
    this.ctx.lastEventType = undefined
    this.ctx.isIdle = false
  }
}
