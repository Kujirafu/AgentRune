import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Project } from "../shared/types.js"

// ---------------------------------------------------------------------------
// Mock agent-executor before importing PtyManager so the module factory runs
// before any import of the real module.
// ---------------------------------------------------------------------------

const mockOnData = vi.fn()
const mockOnExit = vi.fn()
const mockWrite = vi.fn()
const mockResize = vi.fn()
const mockKill = vi.fn()

const mockTerm = {
  onData: mockOnData,
  onExit: mockOnExit,
  write: mockWrite,
  resize: mockResize,
  kill: mockKill,
}

const mockCreateSessionId = vi.fn().mockReturnValue("test-session-1")
const mockSpawnTerminal = vi.fn().mockReturnValue(mockTerm)

const mockExecutor = {
  createSessionId: mockCreateSessionId,
  spawnTerminal: mockSpawnTerminal,
  buildEnv: vi.fn(),
  spawnProcess: vi.fn(),
}

vi.mock("./agent-executor.js", () => ({
  createLocalAgentExecutor: () => mockExecutor,
}))

// Import after mock is registered
import { PtyManager } from "./pty-manager.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: "proj-1",
  name: "Test Project",
  cwd: "/tmp/test",
  ...overrides,
})

/** Capture the callback registered via term.onData / term.onExit */
function captureCallback(mockFn: ReturnType<typeof vi.fn>): (...args: unknown[]) => void {
  const calls = mockFn.mock.calls
  if (calls.length === 0) throw new Error("No callback registered")
  return calls[calls.length - 1][0] as (...args: unknown[]) => void
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PtyManager", () => {
  let manager: PtyManager

  beforeEach(() => {
    vi.clearAllMocks()
    // Re-set the default return value after clearAllMocks resets it
    mockCreateSessionId.mockReturnValue("test-session-1")
    mockSpawnTerminal.mockReturnValue(mockTerm)
    manager = new PtyManager(mockExecutor)
  })

  // -------------------------------------------------------------------------
  // 1. constructor
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("creates a PtyManager that is an EventEmitter with no sessions", () => {
      expect(manager.getAll()).toEqual([])
    })

    it("accepts an injected executor instead of calling createLocalAgentExecutor", () => {
      const project = makeProject()
      manager.create(project)
      expect(mockSpawnTerminal).toHaveBeenCalledOnce()
    })
  })

  // -------------------------------------------------------------------------
  // 2–4. create
  // -------------------------------------------------------------------------

  describe("create", () => {
    it("creates a session with the generated id, project, and default agentId", () => {
      const project = makeProject()
      const session = manager.create(project)

      expect(session.id).toBe("test-session-1")
      expect(session.project).toBe(project)
      expect(session.agentId).toBe("terminal")
      expect(session.scrollback).toEqual([])
      expect(session.pty).toBe(mockTerm)
    })

    it("uses the provided agentId when given", () => {
      const session = manager.create(makeProject(), "claude")
      expect(session.agentId).toBe("claude")
    })

    it("uses a custom sessionId when provided", () => {
      const session = manager.create(makeProject(), "terminal", "custom-id")
      expect(session.id).toBe("custom-id")
      // executor.createSessionId should NOT be called when an explicit id is given
      expect(mockCreateSessionId).not.toHaveBeenCalled()
    })

    it("returns the existing session without spawning a new terminal when sessionId matches", () => {
      const project = makeProject()
      const first = manager.create(project, "terminal", "custom-id")
      const second = manager.create(project, "terminal", "custom-id")

      expect(second).toBe(first)
      expect(mockSpawnTerminal).toHaveBeenCalledOnce()
    })

    it("registers onData and onExit callbacks on the spawned terminal", () => {
      manager.create(makeProject())
      expect(mockOnData).toHaveBeenCalledOnce()
      expect(mockOnExit).toHaveBeenCalledOnce()
    })

    it("passes extraEnv to spawnTerminal", () => {
      manager.create(makeProject(), "terminal", undefined, { MY_VAR: "hello" })
      expect(mockSpawnTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ extraEnv: { MY_VAR: "hello" } }),
      )
    })

    it("defaults to the correct shell for the current platform", () => {
      const project = makeProject() // no shell field
      manager.create(project)
      const expectedShell = process.platform === "win32" ? "powershell.exe" : "bash"
      expect(mockSpawnTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ shell: expectedShell }),
      )
    })

    it("uses project.shell when specified", () => {
      const project = makeProject({ shell: "zsh" })
      manager.create(project)
      expect(mockSpawnTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ shell: "zsh" }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // 5. get / getAll / getByProject
  // -------------------------------------------------------------------------

  describe("get / getAll / getByProject", () => {
    it("get returns the session by id", () => {
      const session = manager.create(makeProject())
      expect(manager.get("test-session-1")).toBe(session)
    })

    it("get returns undefined for an unknown id", () => {
      expect(manager.get("no-such-id")).toBeUndefined()
    })

    it("getAll returns summary objects for all sessions", () => {
      const project = makeProject()
      manager.create(project)

      const all = manager.getAll()
      expect(all).toHaveLength(1)
      expect(all[0]).toMatchObject({
        id: "test-session-1",
        projectId: project.id,
        projectName: project.name,
        agentId: "terminal",
        cwd: project.cwd,
      })
      expect(typeof all[0].lastActivity).toBe("number")
    })

    it("getAll returns an empty array when there are no sessions", () => {
      expect(manager.getAll()).toEqual([])
    })

    it("getByProject returns only sessions belonging to the given project", () => {
      mockCreateSessionId
        .mockReturnValueOnce("s-1")
        .mockReturnValueOnce("s-2")
        .mockReturnValueOnce("s-3")

      const projA = makeProject({ id: "proj-a" })
      const projB = makeProject({ id: "proj-b" })

      manager.create(projA)
      manager.create(projA)
      manager.create(projB)

      const aResults = manager.getByProject("proj-a")
      expect(aResults).toHaveLength(2)
      aResults.forEach((s) => expect(s.project.id).toBe("proj-a"))

      const bResults = manager.getByProject("proj-b")
      expect(bResults).toHaveLength(1)
    })

    it("getByProject returns an empty array for an unknown project", () => {
      expect(manager.getByProject("unknown")).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // 6. onData callback — scrollback and event emission
  // -------------------------------------------------------------------------

  describe("onData callback", () => {
    it("appends data to session scrollback", () => {
      const session = manager.create(makeProject())
      const onData = captureCallback(mockOnData)

      onData("hello ")
      onData("world")

      expect(session.scrollback).toEqual(["hello ", "world"])
    })

    it("emits a 'data' event with the session id and chunk", () => {
      manager.create(makeProject())
      const onData = captureCallback(mockOnData)

      const dataListener = vi.fn()
      manager.on("data", dataListener)

      onData("chunk1")

      expect(dataListener).toHaveBeenCalledWith("test-session-1", "chunk1")
    })

    it("updates lastActivity when data arrives", async () => {
      const session = manager.create(makeProject())
      const before = session.lastActivity
      const onData = captureCallback(mockOnData)

      // Ensure a tick passes so Date.now() can increment
      await new Promise((r) => setTimeout(r, 5))
      onData("x")

      expect(session.lastActivity).toBeGreaterThanOrEqual(before)
    })
  })

  // -------------------------------------------------------------------------
  // 7. scrollback capped at MAX_SCROLLBACK (20 000)
  // -------------------------------------------------------------------------

  describe("onData scrollback cap", () => {
    it("trims scrollback to MAX_SCROLLBACK entries when exceeded", () => {
      const session = manager.create(makeProject())
      const onData = captureCallback(mockOnData)

      // Push 20 001 chunks — one more than the cap
      const total = 20_001
      for (let i = 0; i < total; i++) onData(`chunk-${i}`)

      // After trimming, exactly 20 000 chunks should remain
      expect(session.scrollback).toHaveLength(20_000)
      // The oldest chunks should have been discarded
      expect(session.scrollback[0]).toBe("chunk-1")
      expect(session.scrollback[session.scrollback.length - 1]).toBe(`chunk-${total - 1}`)
    })
  })

  // -------------------------------------------------------------------------
  // 8. onExit — session removal and event emission
  // -------------------------------------------------------------------------

  describe("onExit callback", () => {
    it("removes the session from the map when the PTY exits", () => {
      manager.create(makeProject())
      expect(manager.get("test-session-1")).toBeDefined()

      const onExit = captureCallback(mockOnExit)
      onExit()

      expect(manager.get("test-session-1")).toBeUndefined()
    })

    it("emits an 'exit' event with the session id", () => {
      manager.create(makeProject())
      const exitListener = vi.fn()
      manager.on("exit", exitListener)

      const onExit = captureCallback(mockOnExit)
      onExit()

      expect(exitListener).toHaveBeenCalledWith("test-session-1")
    })
  })

  // -------------------------------------------------------------------------
  // 9–10. write
  // -------------------------------------------------------------------------

  describe("write", () => {
    it("forwards data to the PTY and updates lastActivity", async () => {
      const session = manager.create(makeProject())
      const before = session.lastActivity

      await new Promise((r) => setTimeout(r, 5))
      manager.write("test-session-1", "ls -la\n")

      expect(mockWrite).toHaveBeenCalledWith("ls -la\n")
      expect(session.lastActivity).toBeGreaterThanOrEqual(before)
    })

    it("does nothing when the session id does not exist", () => {
      manager.write("no-such-id", "data")
      expect(mockWrite).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 11. resize
  // -------------------------------------------------------------------------

  describe("resize", () => {
    it("calls pty.resize with the given dimensions", () => {
      manager.create(makeProject())
      manager.resize("test-session-1", 200, 50)
      expect(mockResize).toHaveBeenCalledWith(200, 50)
    })

    it("does nothing when the session id does not exist", () => {
      manager.resize("no-such-id", 80, 24)
      expect(mockResize).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 12. kill
  // -------------------------------------------------------------------------

  describe("kill", () => {
    it("calls pty.kill and removes the session", () => {
      manager.create(makeProject())
      manager.kill("test-session-1")

      expect(mockKill).toHaveBeenCalledOnce()
      expect(manager.get("test-session-1")).toBeUndefined()
    })

    it("does nothing when the session id does not exist", () => {
      manager.kill("no-such-id")
      expect(mockKill).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 13–14. getScrollback
  // -------------------------------------------------------------------------

  describe("getScrollback", () => {
    it("returns all scrollback chunks joined as a single string", () => {
      const session = manager.create(makeProject())
      const onData = captureCallback(mockOnData)

      onData("foo")
      onData("bar")
      onData("baz")

      expect(manager.getScrollback("test-session-1")).toBe("foobarbaz")
    })

    it("returns an empty string when scrollback is empty", () => {
      manager.create(makeProject())
      expect(manager.getScrollback("test-session-1")).toBe("")
    })

    it("returns an empty string for a non-existent session", () => {
      expect(manager.getScrollback("no-such-id")).toBe("")
    })
  })

  // -------------------------------------------------------------------------
  // 15–16. getRecentScrollback
  // -------------------------------------------------------------------------

  describe("getRecentScrollback", () => {
    it("returns all chunks when total size is within maxBytes", () => {
      const session = manager.create(makeProject())
      const onData = captureCallback(mockOnData)

      onData("aaa")
      onData("bbb")

      expect(manager.getRecentScrollback("test-session-1", 1_000)).toBe("aaabbb")
    })

    it("returns only the most recent chunks that fit within maxBytes", () => {
      const session = manager.create(makeProject())
      const onData = captureCallback(mockOnData)

      // 3 chunks of 5 bytes each = 15 bytes total
      onData("AAAAA")
      onData("BBBBB")
      onData("CCCCC")

      // maxBytes = 10: only the last two chunks (10 bytes) should fit
      expect(manager.getRecentScrollback("test-session-1", 10)).toBe("BBBBBCCCCC")
    })

    it("excludes a chunk that would push the total over maxBytes", () => {
      const session = manager.create(makeProject())
      const onData = captureCallback(mockOnData)

      onData("X".repeat(6)) // 6 bytes
      onData("Y".repeat(6)) // 6 bytes

      // maxBytes = 8: second chunk alone (6) fits, but both (12) do not
      expect(manager.getRecentScrollback("test-session-1", 8)).toBe("Y".repeat(6))
    })

    it("returns an empty string for a non-existent session", () => {
      expect(manager.getRecentScrollback("no-such-id")).toBe("")
    })

    it("returns an empty string when the session has no scrollback", () => {
      manager.create(makeProject())
      expect(manager.getRecentScrollback("test-session-1")).toBe("")
    })
  })
})
