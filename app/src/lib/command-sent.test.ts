import { describe, it, expect, beforeEach } from "vitest"
import { commandSent } from "./command-sent"

describe("commandSent", () => {
  beforeEach(() => {
    // Reset all tracked sessions
    commandSent.reset("test-1")
    commandSent.reset("test-2")
  })

  it("has() returns false for untracked session", () => {
    expect(commandSent.has("unknown-session")).toBe(false)
  })

  it("mark() then has() returns true", () => {
    commandSent.mark("test-1")
    expect(commandSent.has("test-1")).toBe(true)
  })

  it("reset() clears a tracked session", () => {
    commandSent.mark("test-1")
    commandSent.reset("test-1")
    expect(commandSent.has("test-1")).toBe(false)
  })

  it("tracks multiple sessions independently", () => {
    commandSent.mark("test-1")
    expect(commandSent.has("test-1")).toBe(true)
    expect(commandSent.has("test-2")).toBe(false)

    commandSent.mark("test-2")
    expect(commandSent.has("test-1")).toBe(true)
    expect(commandSent.has("test-2")).toBe(true)
  })

  it("reset() only affects the specified session", () => {
    commandSent.mark("test-1")
    commandSent.mark("test-2")
    commandSent.reset("test-1")
    expect(commandSent.has("test-1")).toBe(false)
    expect(commandSent.has("test-2")).toBe(true)
  })

  it("mark() is idempotent", () => {
    commandSent.mark("test-1")
    commandSent.mark("test-1")
    expect(commandSent.has("test-1")).toBe(true)
    commandSent.reset("test-1")
    expect(commandSent.has("test-1")).toBe(false)
  })
})
