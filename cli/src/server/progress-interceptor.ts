// server/progress-interceptor.ts
// Monitors agent sessions and injects report_progress prompts when agent is idle

const IDLE_THRESHOLD_MS = 15_000  // 15 seconds of idle before prompting
const PROMPT_COOLDOWN_MS = 120_000  // Don't re-prompt within 2 minutes

interface SessionState {
  lastProgressReport: number
  lastPromptInjected: number
  lastActivityTime: number
  hasNewWork: boolean
}

export class ProgressInterceptor {
  private sessions = new Map<string, SessionState>()

  /** Called when a session starts */
  trackSession(sessionId: string): void {
    this.sessions.set(sessionId, {
      lastProgressReport: Date.now(),
      lastPromptInjected: 0,
      lastActivityTime: Date.now(),
      hasNewWork: false,
    })
  }

  /** Called when session ends */
  untrackSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /** Called on every PTY data event — tracks activity and work detection */
  onData(sessionId: string, hasToolEvents: boolean): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.lastActivityTime = Date.now()
    if (hasToolEvents) {
      state.hasNewWork = true
    }
  }

  /** Called when report_progress is received from MCP */
  onProgressReport(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.lastProgressReport = Date.now()
    state.hasNewWork = false
  }

  /** Check if we should inject a prompt for a given session.
   *  Returns the prompt text to inject, or null if no injection needed. */
  checkInjection(sessionId: string, isIdle: boolean): string | null {
    const state = this.sessions.get(sessionId)
    if (!state) return null

    const now = Date.now()

    if (
      isIdle &&
      state.hasNewWork &&
      (now - state.lastActivityTime) >= IDLE_THRESHOLD_MS &&
      (now - state.lastPromptInjected) >= PROMPT_COOLDOWN_MS
    ) {
      state.lastPromptInjected = now
      return "Please call the report_progress MCP tool to report what you just accomplished. The user is monitoring from their phone and can only see structured progress reports."
    }

    return null
  }
}
