import { describe, it, expect, vi, beforeEach } from "vitest"

/* ── Shared mock state (vi.hoisted runs before vi.mock factories) ── */

const {
  appHandlers,
  ipcHandlers,
  nativeThemeHandlers,
  mockApp,
  mockIpcMain,
  mockNativeTheme,
  mockSession,
  mockWin,
  MockBrowserWindow,
  mockSetupTray,
  mockSetupAutoUpdate,
} = vi.hoisted(() => {
  const appHandlers: Record<string, Function> = {}
  const ipcHandlers: Record<string, Function> = {}
  const nativeThemeHandlers: Record<string, Function> = {}

  const mockWin = {
    loadURL: vi.fn(),
    webContents: {
      on: vi.fn(),
      send: vi.fn(),
      reloadIgnoringCache: vi.fn(),
      toggleDevTools: vi.fn(),
    },
    once: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    setTitleBarOverlay: vi.fn(),
    setBackgroundColor: vi.fn(),
  }

  return {
    appHandlers,
    ipcHandlers,
    nativeThemeHandlers,
    mockApp: {
      isPackaged: false,
      isQuitting: false,
      requestSingleInstanceLock: vi.fn(() => true),
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn((ev: string, cb: Function) => { appHandlers[ev] = cb }),
      exit: vi.fn(),
      quit: vi.fn(),
    },
    mockIpcMain: {
      on: vi.fn((ch: string, cb: Function) => { ipcHandlers[ch] = cb }),
    },
    mockNativeTheme: {
      shouldUseDarkColors: true,
      on: vi.fn((ev: string, cb: Function) => { nativeThemeHandlers[ev] = cb }),
    },
    mockSession: { defaultSession: { clearCache: vi.fn(() => Promise.resolve()) } },
    mockWin,
    MockBrowserWindow: vi.fn(() => mockWin),
    mockSetupTray: vi.fn(),
    mockSetupAutoUpdate: vi.fn(),
  }
})

vi.mock("electron", () => ({
  app: mockApp,
  BrowserWindow: MockBrowserWindow,
  nativeTheme: mockNativeTheme,
  ipcMain: mockIpcMain,
  session: mockSession,
}))

vi.mock("./tray.js", () => ({ setupTray: mockSetupTray }))
vi.mock("./updater.js", () => ({ setupAutoUpdate: mockSetupAutoUpdate }))
vi.mock("./runtime-log.js", () => ({ logRuntime: vi.fn() }))

// Mock global fetch — simulate daemon already running so startDaemon returns early
vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true })))

/* ── Import triggers side effects (registers handlers) ────────── */
await import("./main.js")
// Flush microtask queue so whenReady().then(async () => { ... }) completes
// (clearCache → startDaemon → createWindow → setupTray → setupAutoUpdate)
await new Promise((r) => setTimeout(r, 50))

/* ── Tests ───────────────────────────────────────────────────── */

describe("main process", () => {
  // Note: do NOT clearAllMocks here — handler references were captured at import
  // time and we verify the functions stored in our handler maps, not spy call counts.

  describe("IPC handlers", () => {
    it("registers window:minimize handler", () => {
      expect(ipcHandlers["window:minimize"]).toBeDefined()
    })

    it("registers window:maximize handler", () => {
      expect(ipcHandlers["window:maximize"]).toBeDefined()
    })

    it("registers window:close handler", () => {
      expect(ipcHandlers["window:close"]).toBeDefined()
    })

    it("registers theme:set handler", () => {
      expect(ipcHandlers["theme:set"]).toBeDefined()
    })
  })

  describe("single instance lock", () => {
    it("registers second-instance handler when lock obtained", () => {
      expect(appHandlers["second-instance"]).toBeDefined()
    })
  })

  describe("app lifecycle", () => {
    it("registers before-quit handler", () => {
      expect(appHandlers["before-quit"]).toBeDefined()
    })

    it("before-quit sets isQuitting", () => {
      mockApp.isQuitting = false
      appHandlers["before-quit"]()
      expect(mockApp.isQuitting).toBe(true)
    })

    it("registers render-process-gone handler", () => {
      expect(appHandlers["render-process-gone"]).toBeDefined()
    })

    it("registers window-all-closed handler (keeps running)", () => {
      expect(appHandlers["window-all-closed"]).toBeDefined()
    })
  })

  describe("initialization", () => {
    it("clears session cache on startup", () => {
      expect(mockSession.defaultSession.clearCache).toHaveBeenCalled()
    })

    it("creates a BrowserWindow", () => {
      expect(MockBrowserWindow).toHaveBeenCalled()
    })

    it("sets up tray", () => {
      expect(mockSetupTray).toHaveBeenCalled()
    })

    it("sets up auto-update", () => {
      expect(mockSetupAutoUpdate).toHaveBeenCalled()
    })
  })

  describe("theme", () => {
    it("registers nativeTheme updated handler", () => {
      expect(nativeThemeHandlers["updated"]).toBeDefined()
    })

    it("theme:set applies dark theme to titlebar and background", () => {
      mockWin.setTitleBarOverlay.mockClear()
      mockWin.setBackgroundColor.mockClear()
      ipcHandlers["theme:set"]({}, true)
      expect(mockWin.setTitleBarOverlay).toHaveBeenCalledWith(
        expect.objectContaining({ color: "#0f172a" }),
      )
      expect(mockWin.setBackgroundColor).toHaveBeenCalledWith("#0f172a")
    })

    it("theme:set applies light theme to titlebar and background", () => {
      mockWin.setTitleBarOverlay.mockClear()
      mockWin.setBackgroundColor.mockClear()
      ipcHandlers["theme:set"]({}, false)
      expect(mockWin.setTitleBarOverlay).toHaveBeenCalledWith(
        expect.objectContaining({ color: "#f8fafc" }),
      )
      expect(mockWin.setBackgroundColor).toHaveBeenCalledWith("#f8fafc")
    })
  })

  describe("window behavior", () => {
    it("loads daemon URL", () => {
      expect(mockWin.loadURL).toHaveBeenCalledWith("http://localhost:3457")
    })

    it("window:minimize calls minimize", () => {
      mockWin.minimize.mockClear()
      ipcHandlers["window:minimize"]()
      expect(mockWin.minimize).toHaveBeenCalled()
    })

    it("window:maximize toggles maximize", () => {
      mockWin.isMaximized.mockReturnValueOnce(false)
      mockWin.maximize.mockClear()
      ipcHandlers["window:maximize"]()
      expect(mockWin.maximize).toHaveBeenCalled()
    })

    it("window:maximize unmaximizes when already maximized", () => {
      mockWin.isMaximized.mockReturnValueOnce(true)
      mockWin.unmaximize.mockClear()
      ipcHandlers["window:maximize"]()
      expect(mockWin.unmaximize).toHaveBeenCalled()
    })
  })
})

describe("main process — no lock", () => {
  it("quits when single instance lock is not obtained", async () => {
    vi.resetModules()
    mockApp.exit.mockClear()
    mockApp.quit.mockClear()
    mockApp.requestSingleInstanceLock.mockReturnValueOnce(false)
    await import("./main.js")
    expect(mockApp.exit).toHaveBeenCalledWith(0)
  })
})
