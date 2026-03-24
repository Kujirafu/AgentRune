// desktop/src/preload.ts — contextBridge IPC for renderer
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("electronAPI", {
  platform: "electron" as const,
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  setTheme: (dark: boolean) => ipcRenderer.send("theme:set", dark),
  // Auto-update IPC
  onUpdateAvailable: (cb: (version: string) => void) => {
    ipcRenderer.on("update:available", (_e, version: string) => cb(version))
  },
  onUpdateDownloaded: (cb: () => void) => {
    ipcRenderer.on("update:downloaded", () => cb())
  },
  installUpdate: () => ipcRenderer.send("update:install"),
})
