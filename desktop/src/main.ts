// desktop/src/main.ts — AgentRune Electron main process
import { app, BrowserWindow, nativeTheme, ipcMain, session, shell } from "electron"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { logRuntime } from "./runtime-log.js"
import { setupTray } from "./tray.js"
import { setupAutoUpdate } from "./updater.js"

const PORT = 3457

function getQuitSource(): string {
  const source = (app as any).__agentruneQuitSource
  return typeof source === "string" && source ? source : "unknown"
}

function getWindowCloseSource(): string {
  const source = (app as any).__agentruneWindowCloseSource
  return typeof source === "string" && source ? source : "unknown"
}

// ─── Daemon startup ───────────────────────────────────────────

async function startDaemon(): Promise<void> {
  // Check if daemon is already running
  try {
    const res = await fetch(`http://localhost:${PORT}/api/projects`)
    if (res.ok) return // daemon already running, skip startup
  } catch { /* not running, start it */ }

  // Tell CLI server to serve React app as static files
  process.env.AGENTRUNE_APP_DIST = app.isPackaged
    ? join(process.resourcesPath, "app-dist")
    : join(__dirname, "..", "..", "app", "dist")

  // Skip Cloudflare tunnel in Electron
  process.env.AGENTRUNE_SKIP_TUNNEL = "1"

  const serverPath = app.isPackaged
    ? join(process.resourcesPath, "cli-dist", "server-entry.js")
    : join(__dirname, "..", "..", "cli", "dist", "server-entry.js")

  const { createServer } = await import(pathToFileURL(serverPath).href)

  return new Promise<void>((resolve) => {
    const { server } = createServer(PORT)
    server.on("listening", () => resolve())
  })
}

// ─── Window creation ──────────────────────────────────────────

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const iconPath = join(__dirname, "..", "assets", "icon.png")
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    icon: iconPath,
    backgroundColor: dark ? "#0f172a" : "#f8fafc",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: dark ? "#0f172a" : "#f8fafc",
      symbolColor: dark ? "#e2e8f0" : "#334155",
      height: 36,
    },
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  win.loadURL(`http://localhost:${PORT}`)

  win.webContents.on("did-fail-load", (_event, code, desc, url, isMainFrame) => {
    logRuntime(`[Electron] did-fail-load code=${code} desc=${desc} url=${url} main=${isMainFrame}`)
  })

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level <= 2 || /error|warning|failed/i.test(message)) {
      logRuntime(`[Renderer:${level}] ${sourceId}:${line} ${message}`)
    }
  })

  win.webContents.on("unresponsive", () => {
    logRuntime("[Electron] Renderer became unresponsive")
  })

  // Open DevTools with F12 or Ctrl+Shift+I
  win.webContents.on("before-input-event", (_e, input) => {
    if (input.key === "F12" || (input.control && input.shift && input.key === "I")) {
      win.webContents.toggleDevTools()
    }
  })

  // Block in-app navigation to non-local URLs; hand external http(s) links to the OS browser.
  // Uses URL parsing (not startsWith) so `http://localhost:3457.evil.com` cannot slip through.
  win.webContents.on("will-navigate", (event, url) => {
    try {
      const u = new URL(url)
      if (u.protocol === "http:" && u.hostname === "localhost" && u.port === String(PORT)) return
    } catch { /* unparseable URL — fall through to block */ }
    event.preventDefault()
    logRuntime(`[Electron] Blocked in-window navigation: ${url}`)
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
  })

  // Deny window.open; external http(s) links go to the OS browser, everything else is refused
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
    else logRuntime(`[Electron] Refused window.open for non-http url: ${url}`)
    return { action: "deny" }
  })

  win.once("ready-to-show", () => {
    win.show()
    // Re-apply stored theme after page load (React may send theme:set after DOM ready)
    if (lastDarkTheme !== dark) {
      setTimeout(() => applyTheme(lastDarkTheme), 500)
    }
  })

  // Close -> hide to tray (unless app is quitting)
  win.on("close", (e) => {
    logRuntime(
      `[Electron] Window close event: isQuitting=${Boolean((app as any).isQuitting)} source=${getWindowCloseSource()}`,
    )
    if (!(app as any).isQuitting) {
      e.preventDefault()
      win.hide()
      logRuntime("[Electron] Window close prevented; hiding to tray")
    }
  })

  win.on("closed", () => {
    logRuntime(`[Electron] Window closed source=${getWindowCloseSource()}`)
  })

  return win
}

// ─── IPC handlers ─────────────────────────────────────────────

ipcMain.on("window:minimize", () => mainWindow?.minimize())
ipcMain.on("window:maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on("window:close", (_event, payload?: { source?: string }) => {
  const source = payload?.source || "unknown"
  ;(app as any).__agentruneWindowCloseSource = source
  logRuntime(`[Electron] IPC window:close received source=${source}`)
  mainWindow?.close()
})

// ─── Theme change → update titlebar overlay ───────────────────

function applyTheme(dark: boolean) {
  if (!mainWindow) return
  try {
    mainWindow.setTitleBarOverlay({
      color: dark ? "#0f172a" : "#f8fafc",
      symbolColor: dark ? "#e2e8f0" : "#334155",
      height: 36,
    })
  } catch { /* setTitleBarOverlay may fail on some platforms */ }
  mainWindow.setBackgroundColor(dark ? "#0f172a" : "#f8fafc")
}

// Store last known theme for re-apply after window recreation
let lastDarkTheme = nativeTheme.shouldUseDarkColors

nativeTheme.on("updated", () => applyTheme(nativeTheme.shouldUseDarkColors))

// App-side theme toggle (independent of system theme)
ipcMain.on("theme:set", (_e, dark: boolean) => {
  lastDarkTheme = dark
  applyTheme(dark)
})

// ─── Single instance lock ─────────────────────────────────────

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  logRuntime("[Electron] Single-instance lock denied; exiting current process as secondary instance")
  app.exit(0)
} else {
  app.on("second-instance", () => {
    logRuntime("[Electron] Second instance detected; reloading and focusing existing window")
    if (mainWindow) {
      // Hard-reload to pick up new builds (dev mode runs npm run dev again)
      mainWindow.webContents.reloadIgnoringCache()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    // Clear HTTP cache to avoid stale chunk references after app rebuild
    await session.defaultSession.clearCache()
    await startDaemon()
    mainWindow = createWindow()
    setupTray(mainWindow, PORT)
    setupAutoUpdate(mainWindow)
  })
}

app.on("before-quit", () => {
  (app as any).isQuitting = true
  logRuntime(
    `[Electron] before-quit source=${getQuitSource()} windowCloseSource=${getWindowCloseSource()}`,
  )
})

app.on("will-quit", () => {
  logRuntime("[Electron] will-quit")
})

// Catch renderer crashes
app.on("render-process-gone", (_event, _webContents, details) => {
  logRuntime(`[Electron] Renderer crashed: reason=${details.reason} exitCode=${details.exitCode}`)
})

app.on("child-process-gone", (_event, details) => {
  logRuntime(`[Electron] Child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode ?? "n/a"} service=${details.serviceName || ""}`)
})

process.on("uncaughtException", (err) => {
  logRuntime(`[Electron] Uncaught exception: ${err.message}\n${err.stack?.slice(0, 300) || ""}`)
})

process.on("unhandledRejection", (err) => {
  const detail = err instanceof Error ? `${err.message}\n${err.stack || ""}` : String(err)
  logRuntime(`[Electron] Unhandled rejection: ${detail.slice(0, 600)}`)
})

process.on("exit", (code) => {
  logRuntime(`[Electron] process exit code=${code}`)
})

// Keep app running when all windows closed (tray mode)
app.on("window-all-closed", () => {
  // Don't quit — tray keeps it alive
})
