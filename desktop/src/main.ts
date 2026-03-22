// desktop/src/main.ts — AgentRune Electron main process
import { app, BrowserWindow, nativeTheme, ipcMain, session } from "electron"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { setupTray } from "./tray.js"
import { setupAutoUpdate } from "./updater.js"

const PORT = 3457

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

  // Open DevTools with F12 or Ctrl+Shift+I
  win.webContents.on("before-input-event", (_e, input) => {
    if (input.key === "F12" || (input.control && input.shift && input.key === "I")) {
      win.webContents.toggleDevTools()
    }
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
    if (!(app as any).isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })

  return win
}

// ─── IPC handlers ─────────────────────────────────────────────

ipcMain.on("window:minimize", () => mainWindow?.minimize())
ipcMain.on("window:maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on("window:close", () => mainWindow?.close())

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
  app.quit()
} else {
  app.on("second-instance", () => {
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
})

// Catch renderer crashes
app.on("render-process-gone", (_event, _webContents, details) => {
  console.error("[Electron] Renderer crashed:", details.reason, details.exitCode)
})

process.on("uncaughtException", (err) => {
  console.error("[Electron] Uncaught exception:", err.message, err.stack?.slice(0, 300))
})

// Keep app running when all windows closed (tray mode)
app.on("window-all-closed", () => {
  // Don't quit — tray keeps it alive
})
