/**
 * Integration test: Session lifecycle across EventStore + crypto + summary
 * Tests the cross-module flow of session creation → events → completion → encrypted persistence.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { EventStore } from "./event-store.js"
import type { AgentEvent } from "../shared/types.js"

const testBaseDir = join(tmpdir(), `agentrune-integ-${process.pid}-${Date.now()}`)

beforeEach(() => {
  mkdirSync(testBaseDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(testBaseDir)) rmSync(testBaseDir, { recursive: true, force: true })
})

function makeStore() {
  return new EventStore(join(testBaseDir, "sessions"))
}

describe("Session lifecycle integration", () => {
  it("creates a session and persists index to disk", () => {
    const store = makeStore()
    const id = store.startSession("proj-1", "claude")
    expect(id).toMatch(/^session_/)

    const indexPath = join(testBaseDir, "sessions", "index.json")
    expect(existsSync(indexPath)).toBe(true)

    const index = JSON.parse(readFileSync(indexPath, "utf-8"))
    expect(index).toHaveLength(1)
    expect(index[0].id).toBe(id)
    expect(index[0].projectId).toBe("proj-1")
    expect(index[0].agentId).toBe("claude")
    expect(index[0].status).toBe("active")
  })

  it("adds events and auto-persists at 10-event boundary", () => {
    const store = makeStore()
    const id = store.startSession("proj-1", "claude")

    for (let i = 0; i < 10; i++) {
      store.addEvent(id, {
        type: "file_edit",
        timestamp: Date.now(),
        path: `file-${i}.ts`,
      } as AgentEvent)
    }

    // After 10 events, session file should be persisted (encrypted)
    const sessionPath = join(testBaseDir, "sessions", `${id}.json`)
    expect(existsSync(sessionPath)).toBe(true)
  })

  it("computes summary on session end", () => {
    const store = makeStore()
    const id = store.startSession("proj-1", "claude")

    // Add mixed events
    store.addEvent(id, { type: "file_edit", timestamp: Date.now(), path: "a.ts" } as AgentEvent)
    store.addEvent(id, { type: "file_edit", timestamp: Date.now(), path: "b.ts" } as AgentEvent)
    store.addEvent(id, { type: "file_create", timestamp: Date.now(), path: "c.ts" } as AgentEvent)
    store.addEvent(id, { type: "decision_request", timestamp: Date.now(), question: "ok?" } as AgentEvent)
    store.addEvent(id, { type: "test_result", timestamp: Date.now(), status: "completed" } as AgentEvent)
    store.addEvent(id, { type: "test_result", timestamp: Date.now(), status: "error" } as AgentEvent)

    store.endSession(id, "completed")

    const session = store.getSession(id)
    expect(session).toBeDefined()
    expect(session!.status).toBe("completed")
    expect(session!.endedAt).toBeGreaterThan(0)
    expect(session!.summary).toEqual(
      expect.objectContaining({
        filesModified: 2,
        filesCreated: 1,
        decisionsAsked: 1,
        testsRun: 2,
        testsPassed: 1,
      }),
    )
  })

  it("survives store re-initialization (load from disk)", () => {
    const sessDir = join(testBaseDir, "sessions")
    const store1 = new EventStore(sessDir)
    const id = store1.startSession("proj-2", "codex")
    store1.addEvent(id, { type: "file_edit", timestamp: Date.now(), path: "x.py" } as AgentEvent)
    store1.endSession(id, "completed")

    // Create a new store instance from the same directory
    const store2 = new EventStore(sessDir)
    const session = store2.getSession(id)
    expect(session).toBeDefined()
    expect(session!.projectId).toBe("proj-2")
    expect(session!.status).toBe("completed")
  })

  it("lists sessions by project", () => {
    const store = makeStore()
    store.startSession("proj-a", "claude")
    store.startSession("proj-b", "codex")
    store.startSession("proj-a", "gemini")

    const projA = store.getSessionsByProject("proj-a")
    expect(projA).toHaveLength(2)
    expect(projA.every((s) => s.projectId === "proj-a")).toBe(true)

    const projB = store.getSessionsByProject("proj-b")
    expect(projB).toHaveLength(1)
  })

  it("handles kill status correctly", () => {
    const store = makeStore()
    const id = store.startSession("proj-1", "claude")
    store.endSession(id, "killed")
    const session = store.getSession(id)
    expect(session!.status).toBe("killed")
  })

  it("concurrent sessions on same project don't interfere", () => {
    const store = makeStore()
    const id1 = store.startSession("proj-1", "claude")
    const id2 = store.startSession("proj-1", "codex")

    store.addEvent(id1, { type: "file_edit", timestamp: Date.now(), path: "a.ts" } as AgentEvent)
    store.addEvent(id2, { type: "file_create", timestamp: Date.now(), path: "b.py" } as AgentEvent)

    store.endSession(id1, "completed")
    store.endSession(id2, "completed")

    const s1 = store.getSession(id1)
    const s2 = store.getSession(id2)
    expect(s1!.summary!.filesModified).toBe(1)
    expect(s1!.summary!.filesCreated).toBe(0)
    expect(s2!.summary!.filesModified).toBe(0)
    expect(s2!.summary!.filesCreated).toBe(1)
  })
})
