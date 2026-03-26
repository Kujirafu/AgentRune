import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}))

import { execFileSync } from "node:child_process"
import { readClipboard, writeClipboard } from "./clipboard.js"

const mockedExecFileSync = vi.mocked(execFileSync)

function stubPlatform(platform: string) {
  vi.spyOn(process, "platform", "get").mockReturnValue(platform as NodeJS.Platform)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// readClipboard
// ---------------------------------------------------------------------------

describe("readClipboard", () => {
  it("calls pbpaste on darwin and returns its output", () => {
    stubPlatform("darwin")
    mockedExecFileSync.mockReturnValue("clipboard content")

    const result = readClipboard()

    expect(result).toBe("clipboard content")
    expect(mockedExecFileSync).toHaveBeenCalledOnce()
    expect(mockedExecFileSync).toHaveBeenCalledWith("pbpaste", [], { encoding: "utf-8", timeout: 3000 })
  })

  it("calls Get-Clipboard via powershell on win32 and trims trailing whitespace", () => {
    stubPlatform("win32")
    mockedExecFileSync.mockReturnValue("clipboard content\r\n")

    const result = readClipboard()

    expect(result).toBe("clipboard content")
    expect(mockedExecFileSync).toHaveBeenCalledOnce()
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "powershell.exe",
      ["-command", "Get-Clipboard"],
      { encoding: "utf-8", timeout: 3000 },
    )
  })

  it("calls xclip on linux when xclip is available", () => {
    stubPlatform("linux")
    mockedExecFileSync.mockReturnValue("clipboard content")

    const result = readClipboard()

    expect(result).toBe("clipboard content")
    expect(mockedExecFileSync).toHaveBeenCalledOnce()
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "xclip",
      ["-selection", "clipboard", "-o"],
      { encoding: "utf-8", timeout: 3000 },
    )
  })

  it("falls back to xsel on linux when xclip throws", () => {
    stubPlatform("linux")
    mockedExecFileSync
      .mockImplementationOnce(() => { throw new Error("xclip not found") })
      .mockReturnValueOnce("xsel content")

    const result = readClipboard()

    expect(result).toBe("xsel content")
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2)
    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      1,
      "xclip",
      ["-selection", "clipboard", "-o"],
      { encoding: "utf-8", timeout: 3000 },
    )
    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      2,
      "xsel",
      ["--clipboard", "--output"],
      { encoding: "utf-8", timeout: 3000 },
    )
  })

  it("returns empty string when the platform command throws on darwin", () => {
    stubPlatform("darwin")
    mockedExecFileSync.mockImplementation(() => { throw new Error("pbpaste failed") })

    expect(readClipboard()).toBe("")
  })

  it("returns empty string when both xclip and xsel throw on linux", () => {
    stubPlatform("linux")
    mockedExecFileSync.mockImplementation(() => { throw new Error("no clipboard tool") })

    expect(readClipboard()).toBe("")
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2)
  })

  it("returns empty string when powershell throws on win32", () => {
    stubPlatform("win32")
    mockedExecFileSync.mockImplementation(() => { throw new Error("powershell failed") })

    expect(readClipboard()).toBe("")
  })
})

// ---------------------------------------------------------------------------
// writeClipboard
// ---------------------------------------------------------------------------

describe("writeClipboard", () => {
  it("calls pbcopy on darwin with the input text and returns true", () => {
    stubPlatform("darwin")
    mockedExecFileSync.mockReturnValue(undefined as never)

    const result = writeClipboard("hello")

    expect(result).toBe(true)
    expect(mockedExecFileSync).toHaveBeenCalledOnce()
    expect(mockedExecFileSync).toHaveBeenCalledWith("pbcopy", [], { input: "hello", timeout: 3000 })
  })

  it("calls Set-Clipboard via powershell on win32 with the input text and returns true", () => {
    stubPlatform("win32")
    mockedExecFileSync.mockReturnValue(undefined as never)

    const result = writeClipboard("hello")

    expect(result).toBe(true)
    expect(mockedExecFileSync).toHaveBeenCalledOnce()
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "powershell.exe",
      ["-command", "Set-Clipboard", "-Value", "$input"],
      { input: "hello", timeout: 3000 },
    )
  })

  it("calls xclip on linux when xclip is available and returns true", () => {
    stubPlatform("linux")
    mockedExecFileSync.mockReturnValue(undefined as never)

    const result = writeClipboard("hello")

    expect(result).toBe(true)
    expect(mockedExecFileSync).toHaveBeenCalledOnce()
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "xclip",
      ["-selection", "clipboard"],
      { input: "hello", timeout: 3000 },
    )
  })

  it("falls back to xsel on linux when xclip throws and returns true", () => {
    stubPlatform("linux")
    mockedExecFileSync
      .mockImplementationOnce(() => { throw new Error("xclip not found") })
      .mockReturnValueOnce(undefined as never)

    const result = writeClipboard("hello")

    expect(result).toBe(true)
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2)
    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      1,
      "xclip",
      ["-selection", "clipboard"],
      { input: "hello", timeout: 3000 },
    )
    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      2,
      "xsel",
      ["--clipboard", "--input"],
      { input: "hello", timeout: 3000 },
    )
  })

  it("returns false when the platform command throws on darwin", () => {
    stubPlatform("darwin")
    mockedExecFileSync.mockImplementation(() => { throw new Error("pbcopy failed") })

    expect(writeClipboard("hello")).toBe(false)
  })

  it("returns false when both xclip and xsel throw on linux", () => {
    stubPlatform("linux")
    mockedExecFileSync.mockImplementation(() => { throw new Error("no clipboard tool") })

    expect(writeClipboard("hello")).toBe(false)
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2)
  })

  it("returns false when powershell throws on win32", () => {
    stubPlatform("win32")
    mockedExecFileSync.mockImplementation(() => { throw new Error("powershell failed") })

    expect(writeClipboard("hello")).toBe(false)
  })
})
