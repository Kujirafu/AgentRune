import { afterEach, describe, expect, it, vi } from "vitest"

const childProcessMocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}))

vi.mock("node:child_process", () => ({
  execFileSync: childProcessMocks.execFileSync,
}))

import { killProcessTree } from "./process-tree.js"

const originalPlatform = process.platform

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, "platform", {
    value,
    configurable: true,
  })
}

afterEach(() => {
  childProcessMocks.execFileSync.mockReset()
  vi.restoreAllMocks()
  setPlatform(originalPlatform)
})

describe("killProcessTree", () => {
  it("uses taskkill tree mode on Windows", () => {
    setPlatform("win32")

    killProcessTree(123)

    expect(childProcessMocks.execFileSync).toHaveBeenCalledWith("taskkill", ["/F", "/T", "/PID", "123"], {
      stdio: "ignore",
      windowsHide: true,
    })
  })

  it("kills the process group on POSIX first", () => {
    setPlatform("linux")
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true)

    killProcessTree(456)

    expect(killSpy).toHaveBeenCalledWith(-456, "SIGTERM")
  })

  it("falls back to the direct pid when group kill fails", () => {
    setPlatform("linux")
    const killSpy = vi.spyOn(process, "kill")
      .mockImplementationOnce(() => {
        throw new Error("group kill failed")
      })
      .mockImplementationOnce(() => true)

    killProcessTree(789)

    expect(killSpy).toHaveBeenNthCalledWith(1, -789, "SIGTERM")
    expect(killSpy).toHaveBeenNthCalledWith(2, 789, "SIGTERM")
  })

  it("ignores invalid pids", () => {
    setPlatform("win32")

    killProcessTree(0)

    expect(childProcessMocks.execFileSync).not.toHaveBeenCalled()
  })
})
