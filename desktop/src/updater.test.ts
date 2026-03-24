import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { BrowserWindow } from "electron"

/* ── Shared mock state ───────────────────────────────────────── */

const { mockAutoUpdater, mockApp, ipcHandlers } = vi.hoisted(() => ({
  mockAutoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve()),
    quitAndInstall: vi.fn(),
  },
  mockApp: { isPackaged: true },
  ipcHandlers: {} as Record<string, Function>,
}))

vi.mock("electron-updater", () => ({ autoUpdater: mockAutoUpdater }))
vi.mock("electron", () => ({
  app: mockApp,
  ipcMain: {
    on: vi.fn((ch: string, cb: Function) => { ipcHandlers[ch] = cb }),
  },
}))

/* ── Tests ───────────────────────────────────────────────────── */

import { setupAutoUpdate } from "./updater.js"

describe("setupAutoUpdate", () => {
  let win: BrowserWindow

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockAutoUpdater.autoDownload = false
    mockAutoUpdater.autoInstallOnAppQuit = false
    mockApp.isPackaged = true
    Object.keys(ipcHandlers).forEach((k) => delete ipcHandlers[k])
    win = { webContents: { send: vi.fn() } } as unknown as BrowserWindow
  })

  afterEach(() => vi.useRealTimers())

  it("skips setup when app is not packaged", () => {
    mockApp.isPackaged = false
    setupAutoUpdate(win)
    expect(mockAutoUpdater.on).not.toHaveBeenCalled()
  })

  it("enables autoDownload and autoInstallOnAppQuit", () => {
    setupAutoUpdate(win)
    expect(mockAutoUpdater.autoDownload).toBe(true)
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  it("registers update-available, update-downloaded, and error handlers", () => {
    setupAutoUpdate(win)
    const events = vi.mocked(mockAutoUpdater.on).mock.calls.map(([e]) => e)
    expect(events).toContain("update-available")
    expect(events).toContain("update-downloaded")
    expect(events).toContain("error")
  })

  it("sends version to renderer on update-available", () => {
    setupAutoUpdate(win)
    const handler = vi.mocked(mockAutoUpdater.on).mock.calls
      .find(([e]) => e === "update-available")![1] as Function
    handler({ version: "2.0.0" })
    expect(win.webContents.send).toHaveBeenCalledWith("update:available", "2.0.0")
  })

  it("sends update:downloaded to renderer", () => {
    setupAutoUpdate(win)
    const handler = vi.mocked(mockAutoUpdater.on).mock.calls
      .find(([e]) => e === "update-downloaded")![1] as Function
    handler()
    expect(win.webContents.send).toHaveBeenCalledWith("update:downloaded")
  })

  it("registers update:install IPC that calls quitAndInstall", () => {
    setupAutoUpdate(win)
    expect(ipcHandlers["update:install"]).toBeDefined()
    ipcHandlers["update:install"]()
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalled()
  })

  it("checks for updates on startup", () => {
    setupAutoUpdate(win)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledOnce()
  })

  it("checks for updates every 6 hours", () => {
    setupAutoUpdate(win)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(6 * 60 * 60 * 1000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(6 * 60 * 60 * 1000)
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(3)
  })
})
