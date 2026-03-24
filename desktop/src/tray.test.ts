import { describe, it, expect, vi, beforeEach } from "vitest"
import type { BrowserWindow } from "electron"

/* ── Electron mocks ──────────────────────────────────────────── */

const { mockTrayInstance, mockApp, MockTray, mockMenu, mockNativeImage } =
  vi.hoisted(() => {
    const mockTrayInstance = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn(),
    }
    return {
      mockTrayInstance,
      mockApp: { isQuitting: false, quit: vi.fn() },
      MockTray: vi.fn(() => mockTrayInstance),
      mockMenu: { buildFromTemplate: vi.fn((t: unknown[]) => ({ items: t })) },
      mockNativeImage: {
        createFromPath: vi.fn(() => ({
          isEmpty: vi.fn(() => false),
          resize: vi.fn().mockReturnThis(),
        })),
        createEmpty: vi.fn(() => ({})),
      },
    }
  })

vi.mock("electron", () => ({
  app: mockApp,
  Tray: MockTray,
  Menu: mockMenu,
  nativeImage: mockNativeImage,
}))

/* ── Tests ───────────────────────────────────────────────────── */

import { setupTray } from "./tray.js"

describe("setupTray", () => {
  let win: BrowserWindow

  beforeEach(() => {
    vi.clearAllMocks()
    mockApp.isQuitting = false
    win = { show: vi.fn(), focus: vi.fn() } as unknown as BrowserWindow
  })

  it("creates a Tray and sets tooltip", () => {
    setupTray(win, 3457)
    expect(MockTray).toHaveBeenCalledOnce()
    expect(mockTrayInstance.setToolTip).toHaveBeenCalledWith("AgentRune")
  })

  it("builds context menu with Open Dashboard, daemon info and Quit", () => {
    setupTray(win, 3457)
    const template = vi.mocked(mockMenu.buildFromTemplate).mock.calls[0][0] as any[]
    const labels = template.filter((i: any) => i.label).map((i: any) => i.label)
    expect(labels).toContain("Open Dashboard")
    expect(labels).toContain("Daemon: localhost:3457")
    expect(labels).toContain("Quit")
  })

  it("shows port number in menu", () => {
    setupTray(win, 9999)
    const template = vi.mocked(mockMenu.buildFromTemplate).mock.calls[0][0] as any[]
    expect(template.find((i: any) => i.label === "Daemon: localhost:9999")).toBeTruthy()
  })

  it("Open Dashboard shows and focuses window", () => {
    setupTray(win, 3457)
    const template = vi.mocked(mockMenu.buildFromTemplate).mock.calls[0][0] as any[]
    template.find((i: any) => i.label === "Open Dashboard").click()
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  it("Quit sets isQuitting and calls app.quit", () => {
    setupTray(win, 3457)
    const template = vi.mocked(mockMenu.buildFromTemplate).mock.calls[0][0] as any[]
    template.find((i: any) => i.label === "Quit").click()
    expect(mockApp.isQuitting).toBe(true)
    expect(mockApp.quit).toHaveBeenCalled()
  })

  it("double-click shows and focuses window", () => {
    setupTray(win, 3457)
    const handler = vi.mocked(mockTrayInstance.on).mock.calls
      .find(([e]) => e === "double-click")![1] as Function
    handler()
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  it("falls back to resized main icon when tray icon is empty", () => {
    mockNativeImage.createFromPath.mockReturnValueOnce({
      isEmpty: vi.fn(() => true),
      resize: vi.fn(() => ({})),
    } as any)
    setupTray(win, 3457)
    // Should attempt createFromPath twice (tray icon + fallback)
    expect(mockNativeImage.createFromPath).toHaveBeenCalledTimes(2)
  })

  it("falls back to empty icon when both paths fail", () => {
    mockNativeImage.createFromPath
      .mockImplementationOnce(() => { throw new Error("no file") })
      .mockImplementationOnce(() => { throw new Error("no file") })
    setupTray(win, 3457)
    expect(mockNativeImage.createEmpty).toHaveBeenCalled()
  })
})
