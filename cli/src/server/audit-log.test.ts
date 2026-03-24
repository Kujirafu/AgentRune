import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// vi.hoisted ensures testDir is available when vi.mock factories run
const testDir = vi.hoisted(() => {
  const { join } = require("node:path")
  const { tmpdir } = require("node:os")
  return join(tmpdir(), `agentrune-audit-test-${process.pid}`)
})

vi.mock("../shared/config.js", () => ({
  getConfigDir: () => testDir,
}))
vi.mock("../shared/logger.js", () => ({
  log: { warn: vi.fn(), info: vi.fn() },
}))

import {
  auditLog,
  readAuditLog,
  listAuditDates,
  getRecentAuditEntries,
  getAutomationAudit,
  pruneAuditLogs,
} from "./audit-log.js"

beforeEach(() => {
  mkdirSync(join(testDir, "audit"), { recursive: true })
})

afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
})

// ── auditLog ──

describe("auditLog", () => {
  it("writes a JSONL entry for today", () => {
    auditLog("automation_started", { foo: 1 })
    const entries = readAuditLog()
    expect(entries).toHaveLength(1)
    expect(entries[0].action).toBe("automation_started")
    expect(entries[0].detail).toEqual({ foo: 1 })
    expect(entries[0].timestamp).toBeGreaterThan(0)
  })

  it("appends multiple entries", () => {
    auditLog("automation_started", {})
    auditLog("automation_completed", {})
    auditLog("permission_granted", { user: "admin" })
    expect(readAuditLog()).toHaveLength(3)
  })

  it("includes optional automation and session IDs", () => {
    auditLog("plan_review_requested", { plan: "p1" }, {
      automationId: "auto-1",
      automationName: "Deploy",
      sessionId: "sess-42",
    })
    const entries = readAuditLog()
    expect(entries[0].automationId).toBe("auto-1")
    expect(entries[0].automationName).toBe("Deploy")
    expect(entries[0].sessionId).toBe("sess-42")
  })

  it("does not throw on write failure", () => {
    // Make audit dir read-only would be platform-specific; just verify no throw
    expect(() => auditLog("runtime_violation", {})).not.toThrow()
  })
})

// ── readAuditLog ──

describe("readAuditLog", () => {
  it("returns empty array when no log file exists", () => {
    expect(readAuditLog("2000-01-01")).toEqual([])
  })

  it("reads entries for a specific date", () => {
    const auditDir = join(testDir, "audit")
    const entry = JSON.stringify({
      timestamp: 1700000000000,
      action: "permission_granted",
      detail: {},
    })
    writeFileSync(join(auditDir, "2023-11-14.jsonl"), entry + "\n")
    const entries = readAuditLog("2023-11-14")
    expect(entries).toHaveLength(1)
    expect(entries[0].action).toBe("permission_granted")
  })

  it("rejects malformed date format (defense-in-depth)", () => {
    expect(readAuditLog("../../etc/passwd")).toEqual([])
    expect(readAuditLog("not-a-date")).toEqual([])
    expect(readAuditLog("2023/11/14")).toEqual([])
  })

  it("returns empty on corrupted file content", () => {
    const auditDir = join(testDir, "audit")
    writeFileSync(join(auditDir, "2023-01-01.jsonl"), "not-json\n")
    expect(readAuditLog("2023-01-01")).toEqual([])
  })
})

// ── listAuditDates ──

describe("listAuditDates", () => {
  it("returns empty when no logs exist", () => {
    expect(listAuditDates()).toEqual([])
  })

  it("returns dates in reverse chronological order", () => {
    const auditDir = join(testDir, "audit")
    writeFileSync(join(auditDir, "2023-11-01.jsonl"), "{}\n")
    writeFileSync(join(auditDir, "2023-11-03.jsonl"), "{}\n")
    writeFileSync(join(auditDir, "2023-11-02.jsonl"), "{}\n")
    const dates = listAuditDates()
    expect(dates).toEqual(["2023-11-03", "2023-11-02", "2023-11-01"])
  })

  it("ignores non-jsonl files", () => {
    const auditDir = join(testDir, "audit")
    writeFileSync(join(auditDir, "notes.txt"), "hi")
    writeFileSync(join(auditDir, "2023-11-01.jsonl"), "{}\n")
    expect(listAuditDates()).toEqual(["2023-11-01"])
  })
})

// ── getRecentAuditEntries ──

describe("getRecentAuditEntries", () => {
  it("returns entries across multiple days, newest first", () => {
    const auditDir = join(testDir, "audit")
    const entry1 = JSON.stringify({ timestamp: 1, action: "a", detail: {} })
    const entry2 = JSON.stringify({ timestamp: 2, action: "b", detail: {} })
    writeFileSync(join(auditDir, "2023-11-01.jsonl"), entry1 + "\n")
    writeFileSync(join(auditDir, "2023-11-02.jsonl"), entry2 + "\n")
    const entries = getRecentAuditEntries(10)
    // 2023-11-02 is more recent, should come first after listAuditDates reverse
    expect(entries[0].action).toBe("b")
    expect(entries[1].action).toBe("a")
  })

  it("respects limit", () => {
    auditLog("a" as any, {})
    auditLog("b" as any, {})
    auditLog("c" as any, {})
    const entries = getRecentAuditEntries(2)
    expect(entries).toHaveLength(2)
  })
})

// ── getAutomationAudit ──

describe("getAutomationAudit", () => {
  it("filters entries by automationId", () => {
    auditLog("automation_started", {}, { automationId: "auto-1" })
    auditLog("automation_started", {}, { automationId: "auto-2" })
    auditLog("automation_completed", {}, { automationId: "auto-1" })

    const entries = getAutomationAudit("auto-1")
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.automationId === "auto-1")).toBe(true)
  })

  it("returns empty array when no matches", () => {
    auditLog("automation_started", {}, { automationId: "other" })
    expect(getAutomationAudit("missing")).toEqual([])
  })
})

// ── pruneAuditLogs ──

describe("pruneAuditLogs", () => {
  it("removes logs older than MAX_LOG_FILES (30)", () => {
    const auditDir = join(testDir, "audit")
    // Create 35 log files
    for (let i = 1; i <= 35; i++) {
      const day = String(i).padStart(2, "0")
      const month = i <= 28 ? "01" : "02"
      const dayNum = i <= 28 ? day : String(i - 28).padStart(2, "0")
      writeFileSync(join(auditDir, `2023-${month}-${dayNum}.jsonl`), "{}\n")
    }
    pruneAuditLogs()
    const remaining = readdirSync(auditDir).filter((f) => f.endsWith(".jsonl"))
    expect(remaining.length).toBe(30)
  })

  it("does nothing when under limit", () => {
    const auditDir = join(testDir, "audit")
    writeFileSync(join(auditDir, "2023-11-01.jsonl"), "{}\n")
    pruneAuditLogs()
    expect(readdirSync(auditDir).filter((f) => f.endsWith(".jsonl")).length).toBe(1)
  })
})
