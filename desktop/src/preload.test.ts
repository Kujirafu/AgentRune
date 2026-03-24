import { describe, it, expect, vi, beforeEach } from "vitest"

/* ── Electron mocks ──────────────────────────────────────────── */

const { sendMock, onMock, exposeInMainWorldMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  onMock: vi.fn(),
  exposeInMainWorldMock: vi.fn(),
}))

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: exposeInMainWorldMock },
  ipcRenderer: { send: sendMock, on: onMock },
}))

/* ── Tests ───────────────────────────────────────────────────── */

describe("preload", () => {
  let api: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    await import("./preload.js")
    api = exposeInMainWorldMock.mock.calls[0][1]
  })

  it("exposes electronAPI with platform = electron", () => {
    expect(exposeInMainWorldMock).toHaveBeenCalledWith("electronAPI", expect.any(Object))
    expect(api.platform).toBe("electron")
  })

  it("minimize sends window:minimize", () => {
    api.minimize()
    expect(sendMock).toHaveBeenCalledWith("window:minimize")
  })

  it("maximize sends window:maximize", () => {
    api.maximize()
    expect(sendMock).toHaveBeenCalledWith("window:maximize")
  })

  it("close sends window:close", () => {
    api.close()
    expect(sendMock).toHaveBeenCalledWith("window:close")
  })

  it("setTheme sends theme:set with boolean", () => {
    api.setTheme(true)
    expect(sendMock).toHaveBeenCalledWith("theme:set", true)
    api.setTheme(false)
    expect(sendMock).toHaveBeenCalledWith("theme:set", false)
  })

  it("onUpdateAvailable registers IPC listener and forwards version", () => {
    const cb = vi.fn()
    api.onUpdateAvailable(cb)
    expect(onMock).toHaveBeenCalledWith("update:available", expect.any(Function))

    // Simulate IPC event
    const ipcCb = onMock.mock.calls.find(
      ([ch]: [string]) => ch === "update:available",
    )![1] as Function
    ipcCb({}, "3.0.0")
    expect(cb).toHaveBeenCalledWith("3.0.0")
  })

  it("onUpdateDownloaded registers IPC listener and forwards callback", () => {
    const cb = vi.fn()
    api.onUpdateDownloaded(cb)
    expect(onMock).toHaveBeenCalledWith("update:downloaded", expect.any(Function))

    const ipcCb = onMock.mock.calls.find(
      ([ch]: [string]) => ch === "update:downloaded",
    )![1] as Function
    ipcCb()
    expect(cb).toHaveBeenCalled()
  })

  it("installUpdate sends update:install", () => {
    api.installUpdate()
    expect(sendMock).toHaveBeenCalledWith("update:install")
  })
})
