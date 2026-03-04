import { ProjectSettings, DEFAULT_SETTINGS } from "./types"

export function getSettings(projectId: string): ProjectSettings {
  try {
    const raw = localStorage.getItem(`agentrune_settings_${projectId}`)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(projectId: string, settings: ProjectSettings) {
  localStorage.setItem(`agentrune_settings_${projectId}`, JSON.stringify(settings))
}

export function getRecentCommands(projectId: string): string[] {
  try {
    const raw = localStorage.getItem(`agentrune_recent_${projectId}`)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function addRecentCommand(projectId: string, cmd: string) {
  const trimmed = cmd.trim()
  if (!trimmed || trimmed.length < 2) return
  const recent = getRecentCommands(projectId)
  const filtered = recent.filter((r) => r !== trimmed)
  filtered.unshift(trimmed)
  localStorage.setItem(`agentrune_recent_${projectId}`, JSON.stringify(filtered.slice(0, 10)))
}

export function getApiBase(): string {
  const isCapacitor = typeof window !== "undefined" && !!(window as any).Capacitor
  if (!isCapacitor) return ""
  return localStorage.getItem("agentrune_server") || ""
}

export function getLastProject(): string | null {
  return localStorage.getItem("agentrune_last_project")
}

export function saveLastProject(projectId: string) {
  localStorage.setItem("agentrune_last_project", projectId)
}
