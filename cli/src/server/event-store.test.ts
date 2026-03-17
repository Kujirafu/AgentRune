import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { EventStore } from "./event-store.js"
import { isEncrypted } from "./crypto.js"
import type { AgentEvent } from "../shared/types.js"

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    type: "info",
    status: "completed",
    title: "test event",
    ...overrides,
  }
}

describe("EventStore", () => {
  let tmpDir: string
  let store: EventStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentrune-eventstore-test-"))
    store = new EventStore(tmpDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("startSession returns a session id and persists index", () => {
    const id = store.startSession("proj1", "claude")
    expect(id).toMatch(/^session_/)
    expect(existsSync(join(tmpDir, "index.json"))).toBe(true)
  })

  it("getSession returns session metadata without events", () => {
    const id = store.startSession("proj1", "claude")
    const session = store.getSession(id)
    expect(session).toBeDefined()
    expect(session!.projectId).toBe("proj1")
    expect(session!.agentId).toBe("claude")
    expect(session!.status).toBe("active")
    expect((session as any).events).toBeUndefined()
  })

  it("getSession returns undefined for unknown id", () => {
    expect(store.getSession("nonexistent")).toBeUndefined()
  })

  it("addEvent accumulates events in memory", () => {
    const id = store.startSession("proj1", "claude")
    store.addEvent(id, makeEvent({ title: "first" }))
    store.addEvent(id, makeEvent({ title: "second" }))

    const events = store.getSessionEvents(id)
    expect(events).toHaveLength(2)
    expect(events[0].title).toBe("first")
    expect(events[1].title).toBe("second")
  })

  it("addEvent ignores unknown session id", () => {
    expect(() => store.addEvent("nonexistent", makeEvent())).not.toThrow()
  })

  it("persists session to encrypted file every 10 events", () => {
    const id = store.startSession("proj1", "claude")
    for (let i = 0; i < 10; i++) {
      store.addEvent(id, makeEvent({ title: `event_${i}` }))
    }

    const sessionFile = join(tmpDir, `${id}.json`)
    expect(existsSync(sessionFile)).toBe(true)
    const raw = readFileSync(sessionFile, "utf-8")
    expect(isEncrypted(raw)).toBe(true)
  })

  it("persists immediately on decision_request event", () => {
    const id = store.startSession("proj1", "claude")
    store.addEvent(id, makeEvent({ type: "decision_request", status: "waiting", title: "approve?" }))

    const sessionFile = join(tmpDir, `${id}.json`)
    expect(existsSync(sessionFile)).toBe(true)
  })

  it("endSession sets status, endedAt, and computes summary", () => {
    const id = store.startSession("proj1", "claude")
    store.addEvent(id, makeEvent({ type: "file_edit", title: "edit" }))
    store.addEvent(id, makeEvent({ type: "file_create", title: "create" }))
    store.addEvent(id, makeEvent({ type: "test_result", status: "completed", title: "test pass" }))
    store.addEvent(id, makeEvent({ type: "test_result", status: "failed", title: "test fail" }))
    store.addEvent(id, makeEvent({ type: "decision_request", title: "ask" }))
    store.endSession(id)

    const session = store.getSession(id)
    expect(session!.status).toBe("completed")
    expect(session!.endedAt).toBeGreaterThan(0)
    expect(session!.summary).toBeDefined()
    expect(session!.summary!.filesModified).toBe(1)
    expect(session!.summary!.filesCreated).toBe(1)
    expect(session!.summary!.testsRun).toBe(2)
    expect(session!.summary!.testsPassed).toBe(1)
    expect(session!.summary!.decisionsAsked).toBe(1)
    expect(session!.summary!.duration).toBeGreaterThanOrEqual(0)
  })

  it("endSession with killed status", () => {
    const id = store.startSession("proj1", "claude")
    store.endSession(id, "killed")
    expect(store.getSession(id)!.status).toBe("killed")
  })

  it("getSessionsByProject filters and sorts by startedAt desc", () => {
    store.startSession("proj1", "claude")
    store.startSession("proj2", "codex")
    store.startSession("proj1", "gemini")

    const proj1Sessions = store.getSessionsByProject("proj1")
    expect(proj1Sessions).toHaveLength(2)
    expect(proj1Sessions[0].startedAt).toBeGreaterThanOrEqual(proj1Sessions[1].startedAt)
    expect(proj1Sessions.every(s => s.projectId === "proj1")).toBe(true)
  })

  it("reloads sessions from disk (cross-instance persistence)", () => {
    const id = store.startSession("proj1", "claude")
    store.addEvent(id, makeEvent({ type: "file_edit", title: "edit1" }))
    store.endSession(id)

    // Create a new store pointing to the same directory
    const store2 = new EventStore(tmpDir)
    const session = store2.getSession(id)
    expect(session).toBeDefined()
    expect(session!.projectId).toBe("proj1")
    expect(session!.status).toBe("completed")
  })

  it("reloads session events from encrypted disk file", () => {
    const id = store.startSession("proj1", "claude")
    for (let i = 0; i < 10; i++) {
      store.addEvent(id, makeEvent({ title: `event_${i}` }))
    }

    // New store instance loads index but not events
    const store2 = new EventStore(tmpDir)
    const events = store2.getSessionEvents(id)
    expect(events).toHaveLength(10)
    expect(events[0].title).toBe("event_0")
  })
})
