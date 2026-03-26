// desktop/src/updater.ts — electron-updater auto-update
import { autoUpdater } from "electron-updater"
import { app, ipcMain, type BrowserWindow } from "electron"
import { logRuntime } from "./runtime-log.js"

function safeLog(message: string) {
  try {
    if (typeof logRuntime === "function") logRuntime(message)
  } catch {}
}

export function setupAutoUpdate(win: BrowserWindow): void {
  // Don't auto-update in dev mode
  if (!app.isPackaged) {
    safeLog("[AutoUpdater] Skipped in dev mode")
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on("update-available", (info) => {
    safeLog(`[AutoUpdater] update-available ${info.version}`)
    win.webContents.send("update:available", info.version)
  })

  autoUpdater.on("update-downloaded", () => {
    safeLog("[AutoUpdater] update-downloaded")
    win.webContents.send("update:downloaded")
  })

  autoUpdater.on("error", (err) => {
    safeLog(`[AutoUpdater] error ${err.message}`)
    console.error("[AutoUpdater]", err.message)
  })

  // Renderer can trigger install via IPC
  ipcMain.on("update:install", () => {
    safeLog("[AutoUpdater] update:install IPC received")
    ;(app as any).__agentruneQuitSource = "auto_updater"
    autoUpdater.quitAndInstall()
  })

  // Check on startup
  autoUpdater.checkForUpdates().catch(() => {})

  // Check every 6 hours
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 6 * 60 * 60 * 1000)
}
