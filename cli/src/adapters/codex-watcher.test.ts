import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { codexLineToEvents, codexSessionCwdMatchesProject, readCodexSessionCwd } from "./codex-watcher.js"

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
})
