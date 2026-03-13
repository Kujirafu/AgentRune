import { ProjectSettings, DEFAULT_SETTINGS } from "../types"

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

export function getVolumeKeysEnabled(): boolean {
  return localStorage.getItem("agentrune_volume_keys") === "true"
}

export function setVolumeKeysEnabled(enabled: boolean) {
  localStorage.setItem("agentrune_volume_keys", enabled ? "true" : "false")
}

export function getKeepAwakeEnabled(): boolean {
  return localStorage.getItem("agentrune_keep_awake") === "true"
}

export function setKeepAwakeEnabled(enabled: boolean) {
  localStorage.setItem("agentrune_keep_awake", enabled ? "true" : "false")
}

export function getLastProject(): string | null {
  return localStorage.getItem("agentrune_last_project")
}

export function saveLastProject(projectId: string) {
  localStorage.setItem("agentrune_last_project", projectId)
}

export function getWorktreeEnabled(): boolean {
  const val = localStorage.getItem("agentrune_worktree_enabled")
  return val === null ? true : val === "true"  // default true
}

export function setWorktreeEnabled(enabled: boolean) {
  localStorage.setItem("agentrune_worktree_enabled", enabled ? "true" : "false")
}

export function getAutoSaveKeysEnabled(): boolean {
  return localStorage.getItem("agentrune_auto_save_keys") === "true"
}

export function setAutoSaveKeysEnabled(enabled: boolean) {
  localStorage.setItem("agentrune_auto_save_keys", enabled ? "true" : "false")
}

export function getAutoSaveKeysPath(): string {
  return localStorage.getItem("agentrune_auto_save_keys_path") || "~/.agentrune/secrets"
}

export function setAutoSaveKeysPath(path: string) {
  localStorage.setItem("agentrune_auto_save_keys_path", path.trim() || "~/.agentrune/secrets")
}

export function getNotificationsEnabled(): boolean {
  return localStorage.getItem("agentrune_notifications") === "true"
}

export function setNotificationsEnabled(enabled: boolean) {
  localStorage.setItem("agentrune_notifications", enabled ? "true" : "false")
}

// Auto Update
export function getAutoUpdateEnabled(): boolean {
  const val = localStorage.getItem("agentrune_auto_update")
  return val === null ? true : val === "true"  // default true
}

export function setAutoUpdateEnabled(enabled: boolean) {
  localStorage.setItem("agentrune_auto_update", enabled ? "true" : "false")
}

export function getLastUpdateCheck(): number {
  return parseInt(localStorage.getItem("agentrune_last_update_check") || "0", 10)
}

export function setLastUpdateCheck(timestamp: number) {
  localStorage.setItem("agentrune_last_update_check", String(timestamp))
}

export function getSkippedVersion(): string | null {
  return localStorage.getItem("agentrune_skipped_version")
}

export function setSkippedVersion(version: string | null) {
  if (version) {
    localStorage.setItem("agentrune_skipped_version", version)
  } else {
    localStorage.removeItem("agentrune_skipped_version")
  }
}

// Track when a new version was first detected (for delayed notification)
export function getUpdateDetectedAt(): { version: string; at: number } | null {
  const raw = localStorage.getItem("agentrune_update_detected")
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function setUpdateDetectedAt(version: string, at: number) {
  localStorage.setItem("agentrune_update_detected", JSON.stringify({ version, at }))
}

export function clearUpdateDetected() {
  localStorage.removeItem("agentrune_update_detected")
}

// Track whether the update notification has already been sent (avoid repeat)
export function getUpdateNotified(): string | null {
  return localStorage.getItem("agentrune_update_notified")
}

export function setUpdateNotified(version: string) {
  localStorage.setItem("agentrune_update_notified", version)
}

// Killed sessions — local cache so sessions don't reappear if server kill fails
const KILLED_KEY = "agentrune_killed_sessions"
const MAX_KILLED = 200  // prevent unbounded growth

export function getKilledSessionIds(): Set<string> {
  try {
    const raw = localStorage.getItem(KILLED_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}

export function addKilledSessionId(id: string) {
  const killed = getKilledSessionIds()
  killed.add(id)
  // Trim to max size (keep newest by converting to array, slicing tail)
  const arr = [...killed]
  if (arr.length > MAX_KILLED) arr.splice(0, arr.length - MAX_KILLED)
  localStorage.setItem(KILLED_KEY, JSON.stringify(arr))
}

// API Keys — stored in localStorage, synced to server vault on save
export interface ApiKeyEntry {
  envVar: string
  label: string
  value: string
}

const API_KEY_SERVICES: { envVar: string; label: string }[] = [
  { envVar: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)" },
  { envVar: "OPENAI_API_KEY", label: "OpenAI (Codex)" },
  { envVar: "GEMINI_API_KEY", label: "Google (Gemini)" },
  { envVar: "GROQ_API_KEY", label: "Groq" },
  { envVar: "CURSOR_API_KEY", label: "Cursor" },
  { envVar: "OPENROUTER_API_KEY", label: "OpenRouter" },
  { envVar: "MISTRAL_API_KEY", label: "Mistral" },
  { envVar: "DEEPSEEK_API_KEY", label: "DeepSeek" },
  { envVar: "XAI_API_KEY", label: "xAI (Grok)" },
]

export function getApiKeyServices() { return API_KEY_SERVICES }

export function getApiKeys(): Record<string, string> {
  try {
    const raw = localStorage.getItem("agentrune_api_keys")
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function setApiKeys(keys: Record<string, string>) {
  localStorage.setItem("agentrune_api_keys", JSON.stringify(keys))
}

export function setApiKey(envVar: string, value: string) {
  const keys = getApiKeys()
  if (value.trim()) {
    keys[envVar] = value.trim()
  } else {
    delete keys[envVar]
  }
  setApiKeys(keys)
}
