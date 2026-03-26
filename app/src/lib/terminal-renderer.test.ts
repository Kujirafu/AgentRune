import { describe, expect, it } from "vitest"
import { shouldUseXtermWebgl } from "./terminal-renderer"

describe("terminal-renderer", () => {
  it("disables xterm WebGL inside Electron", () => {
    expect(shouldUseXtermWebgl({ electronAPI: {} })).toBe(false)
  })

  it("allows xterm WebGL outside Electron", () => {
    expect(shouldUseXtermWebgl({})).toBe(true)
  })

  it("stays safe when no window is available", () => {
    expect(shouldUseXtermWebgl(undefined)).toBe(false)
  })
})
