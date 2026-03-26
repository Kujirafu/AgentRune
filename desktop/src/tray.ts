// desktop/src/tray.ts — System tray with context menu
import { app, Tray, Menu, nativeImage, type BrowserWindow } from "electron"
import { join } from "node:path"
import { logRuntime } from "./runtime-log.js"

let tray: Tray | null = null

function safeLog(message: string) {
  try {
    if (typeof logRuntime === "function") logRuntime(message)
  } catch {}
}

export function setupTray(win: BrowserWindow, port: number): void {
  // Use tray icon from assets, fallback to main icon
  const iconPath = join(__dirname, "..", "assets", "tray-icon.png")
  const fallbackPath = join(__dirname, "..", "assets", "icon.png")

  let trayIcon: Electron.NativeImage
  try {
    trayIcon = nativeImage.createFromPath(iconPath)
    if (trayIcon.isEmpty()) throw new Error("empty")
  } catch {
    try {
      trayIcon = nativeImage.createFromPath(fallbackPath).resize({ width: 16, height: 16 })
    } catch {
      // Last resort: create a minimal 16x16 icon
      trayIcon = nativeImage.createEmpty()
    }
  }

  tray = new Tray(trayIcon)
  tray.setToolTip("AgentRune")

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Dashboard",
      click: () => {
        safeLog("[Tray] Open Dashboard clicked");
        win.show()
        win.focus()
      },
    },
    { type: "separator" },
    {
      label: `Daemon: localhost:${port}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        safeLog("[Tray] Quit clicked");
        ;(app as any).__agentruneQuitSource = "tray"
        ;(app as any).isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  // Double-click tray icon -> show window
  tray.on("double-click", () => {
    safeLog("[Tray] Double-click -> show window");
    win.show()
    win.focus()
  })
}
