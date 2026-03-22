// desktop/src/updater.ts — electron-updater auto-update
import { autoUpdater } from "electron-updater"
import { app, ipcMain, type BrowserWindow } from "electron"

export function setupAutoUpdate(win: BrowserWindow): void {
  // Don't auto-update in dev mode
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on("update-available", (info) => {
    win.webContents.send("update:available", info.version)
  })

  autoUpdater.on("update-downloaded", () => {
    win.webContents.send("update:downloaded")
  })

  autoUpdater.on("error", (err) => {
    console.error("[AutoUpdater]", err.message)
  })

  // Renderer can trigger install via IPC
  ipcMain.on("update:install", () => autoUpdater.quitAndInstall())

  // Check on startup
  autoUpdater.checkForUpdates().catch(() => {})

  // Check every 6 hours
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 6 * 60 * 60 * 1000)
}
