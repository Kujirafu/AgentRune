import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import {
  codexLineToEvents,
  codexSessionCwdEqualsProject,
  codexSessionCwdMatchesProject,
  findActiveCodexSession,
  readCodexSessionCwd,
} from "./codex-watcher.js"

describe("codex-watcher", () => {
  it("matches the same project across path separators and case differences", () => {
    expect(codexSessionCwdMatchesProject(
      "C:\\Users\\testuser\\Projects\\MyApp",
      "c:/users/testuser/projects/myapp",
    )).toBe(true)
  })

  it("rejects unrelated project paths", () => {
    expect(codexSessionCwdMatchesProject(
      "C:\\Users\\testuser\\Projects\\MyApp",
      "C:\\Users\\testuser\\Documents\\OtherProject",
    )).toBe(false)
  })

  it("requires an exact cwd match when resolving the active watcher file", () => {
    expect(codexSessionCwdEqualsProject(
      "C:\\Users\\testuser\\Projects\\MyApp",
      "C:\\Users\\testuser\\Projects\\MyApp",
    )).toBe(true)
    expect(codexSessionCwdEqualsProject(
      "C:\\Users\\testuser\\Projects\\MyApp",
      "C:\\Users\\testuser\\Projects\\MyApp\\.worktrees\\session-1",
    )).toBe(false)
  })

  it("reads the session cwd from Codex session_meta", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentrune-codex-"))
    const sessionPath = join(dir, "rollout-test.jsonl")
    writeFileSync(sessionPath, [
      JSON.stringify({
        type: "session_meta",
        payload: { cwd: "C:\\Users\\testuser\\Projects\\MyApp" },
      }),
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "hello" } }),
      "",
    ].join("\n"))

    expect(readCodexSessionCwd(sessionPath)).toBe("C:\\Users\\testuser\\Projects\\MyApp")
  })

  it("skips commentary agent_message events", () => {
    const events = codexLineToEvents({
      type: "event_msg",
      payload: {
        type: "agent_message",
        phase: "commentary",
        message: "internal thought that should not reach the app",
      },
    })

    expect(events).toEqual([])
  })

  it("parses assistant response_item messages into response events", () => {
    const events = codexLineToEvents({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "First line" },
          { type: "output_text", text: "Second line" },
        ],
      },
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe("response")
    expect(events[0]?.title).toBe("First line")
    expect(events[0]?.detail).toBe("First line\n\nSecond line")
  })

  it("prefers an explicitly mapped JSONL path over newer siblings", () => {
    const sessionsRoot = mkdtempSync(join(tmpdir(), "agentrune-codex-sessions-"))
    const dayDir = join(sessionsRoot, "2026", "04", "04")
    mkdirSync(dayDir, { recursive: true })

    const cwd = "C:\\Users\\testuser\\Projects\\MyApp"
    const preferred = join(dayDir, "rollout-preferred.jsonl")
    const newer = join(dayDir, "rollout-newer.jsonl")

    writeFileSync(preferred, `${JSON.stringify({ type: "session_meta", payload: { cwd } })}\n`)
    writeFileSync(newer, `${JSON.stringify({ type: "session_meta", payload: { cwd } })}\n`)

    utimesSync(preferred, new Date("2026-04-04T10:00:00.000Z"), new Date("2026-04-04T10:00:00.000Z"))
    utimesSync(newer, new Date("2026-04-04T11:00:00.000Z"), new Date("2026-04-04T11:00:00.000Z"))

    expect(findActiveCodexSession(cwd, {
      sessionsDir: sessionsRoot,
      preferredPath: preferred,
    })).toBe(preferred)
  })

  it("ignores older same-cwd sessions when a launch time floor is provided", () => {
    const sessionsRoot = mkdtempSync(join(tmpdir(), "agentrune-codex-floor-"))
    const dayDir = join(sessionsRoot, "2026", "04", "04")
    mkdirSync(dayDir, { recursive: true })

    const cwd = "C:\\Users\\testuser\\Projects\\MyApp"
    const older = join(dayDir, "rollout-older.jsonl")
    const fresh = join(dayDir, "rollout-fresh.jsonl")

    writeFileSync(older, `${JSON.stringify({ type: "session_meta", payload: { cwd } })}\n`)
    writeFileSync(fresh, `${JSON.stringify({ type: "session_meta", payload: { cwd } })}\n`)

    utimesSync(older, new Date("2026-04-04T10:00:00.000Z"), new Date("2026-04-04T10:00:00.000Z"))
    utimesSync(fresh, new Date("2026-04-04T10:30:00.000Z"), new Date("2026-04-04T10:30:00.000Z"))

    expect(findActiveCodexSession(cwd, {
      sessionsDir: sessionsRoot,
      minMtimeMs: new Date("2026-04-04T10:15:00.000Z").getTime(),
    })).toBe(fresh)
  })
})
