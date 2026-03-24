import { describe, expect, it } from "vitest"

import type { AgentEvent, AppSession } from "../types"
import { buildSessionCompletionNotice } from "./session-completion"

function makeSession(overrides: Partial<AppSession> = {}): AppSession {
  return {
    id: "sid-1",
    projectId: "proj-1",
    agentId: "claude",
    ...overrides,
  }
}

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: "evt-1",
    timestamp: 100,
    type: "response",
    status: "completed",
    title: "已完成首頁整理",
    ...overrides,
  }
}

describe("buildSessionCompletionNotice", () => {
  it("builds a completion notice from finished session events", () => {
    const notice = buildSessionCompletionNotice({
      session: makeSession({ taskTitle: "整理首頁" }),
      events: [
        makeEvent({ type: "progress_report", progress: { summary: "首頁整理完成", steps: [], nextSteps: [] } as any }),
      ],
      locale: "zh-TW",
      sessionIdx: 2,
    })

    expect(notice).toMatchObject({
      sessionId: "sid-1",
      sessionIdx: 2,
      label: "整理首頁",
      summary: "首頁整理完成",
    })
  })

  it("does not create a completion notice for blocked sessions", () => {
    const notice = buildSessionCompletionNotice({
      session: makeSession(),
      events: [
        makeEvent({ type: "decision_request", status: "waiting", title: "需要你確認" }),
      ],
      locale: "zh-TW",
      sessionIdx: 1,
    })

    expect(notice).toBeNull()
  })
})
