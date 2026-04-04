import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  getSettings,
  saveSettings,
  getRecentCommands,
  addRecentCommand,
  getApiBase,
  getApiAuthToken,
  authedFetch,
  canUseApi,
  buildApiUrl,
  getVolumeKeysEnabled,
  setVolumeKeysEnabled,
  getKilledSessionIds,
  addKilledSessionId,
  getApiKeys,
  setApiKey,
  setApiKeys,
  getWorktreeEnabled,
  setWorktreeEnabled,
} from "./storage"
import { DEFAULT_SETTINGS } from "../types"

beforeEach(() => {
  localStorage.clear()
  vi.mocked(global.fetch).mockReset()
  vi.mocked(global.fetch).mockResolvedValue(new Response(null, { status: 204 }))
})

// ── getSettings ──────────────────────────────────────────────────

describe("getSettings", () => {
  it("returns DEFAULT_SETTINGS when no stored data", () => {
    const settings = getSettings("proj-1")
    expect(settings).toEqual(DEFAULT_SETTINGS)
  })

  it("returns a copy, not the same reference as DEFAULT_SETTINGS", () => {
    const settings = getSettings("proj-1")
    expect(settings).not.toBe(DEFAULT_SETTINGS)
  })

  it("merges stored partial settings with defaults", () => {
    localStorage.setItem(
      "agentrune_settings_proj-2",
      JSON.stringify({ model: "opus", bypass: true })
    )
    const settings = getSettings("proj-2")
    expect(settings.model).toBe("opus")
    expect(settings.bypass).toBe(true)
    // Non-overridden fields should still be defaults
    expect(settings.planMode).toBe(DEFAULT_SETTINGS.planMode)
    expect(settings.fastMode).toBe(DEFAULT_SETTINGS.fastMode)
    expect(settings.codexModel).toBe(DEFAULT_SETTINGS.codexModel)
  })

  it("handles corrupted JSON gracefully and returns defaults", () => {
    localStorage.setItem("agentrune_settings_bad", "{not-valid-json!!!")
    const settings = getSettings("bad")
    expect(settings).toEqual(DEFAULT_SETTINGS)
  })

  it("isolates settings by projectId", () => {
    localStorage.setItem(
      "agentrune_settings_a",
      JSON.stringify({ model: "haiku" })
    )
    const settingsA = getSettings("a")
    const settingsB = getSettings("b")
    expect(settingsA.model).toBe("haiku")
    expect(settingsB.model).toBe("sonnet") // default
  })
})

// ── saveSettings ─────────────────────────────────────────────────

describe("saveSettings", () => {
  it("stores JSON in localStorage under the correct key", () => {
    const custom = { ...DEFAULT_SETTINGS, model: "opus" as const }
    saveSettings("proj-3", custom)
    const raw = localStorage.getItem("agentrune_settings_proj-3")
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toEqual(custom)
  })

  it("overwrites previous settings", () => {
    saveSettings("proj-3", { ...DEFAULT_SETTINGS, model: "haiku" })
    saveSettings("proj-3", { ...DEFAULT_SETTINGS, model: "opus" })
    const result = getSettings("proj-3")
    expect(result.model).toBe("opus")
  })
})

// ── getRecentCommands ────────────────────────────────────────────

describe("getRecentCommands", () => {
  it("returns empty array when none stored", () => {
    expect(getRecentCommands("proj-x")).toEqual([])
  })

  it("returns empty array on corrupted JSON", () => {
    localStorage.setItem("agentrune_recent_proj-x", "!!!bad")
    expect(getRecentCommands("proj-x")).toEqual([])
  })

  it("returns stored commands", () => {
    localStorage.setItem(
      "agentrune_recent_proj-x",
      JSON.stringify(["cmd1", "cmd2"])
    )
    expect(getRecentCommands("proj-x")).toEqual(["cmd1", "cmd2"])
  })
})

// ── addRecentCommand ─────────────────────────────────────────────

describe("addRecentCommand", () => {
  it("adds to front of the list", () => {
    addRecentCommand("proj-r", "first")
    addRecentCommand("proj-r", "second")
    const cmds = getRecentCommands("proj-r")
    expect(cmds[0]).toBe("second")
    expect(cmds[1]).toBe("first")
  })

  it("deduplicates (moves existing to front)", () => {
    addRecentCommand("proj-r", "alpha")
    addRecentCommand("proj-r", "beta")
    addRecentCommand("proj-r", "alpha") // re-add
    const cmds = getRecentCommands("proj-r")
    expect(cmds).toEqual(["alpha", "beta"])
  })

  it("caps at 10 entries", () => {
    for (let i = 0; i < 15; i++) {
      addRecentCommand("proj-r", `cmd-${i}`)
    }
    const cmds = getRecentCommands("proj-r")
    expect(cmds).toHaveLength(10)
    // Most recent should be first
    expect(cmds[0]).toBe("cmd-14")
  })

  it("skips empty strings", () => {
    addRecentCommand("proj-r", "")
    expect(getRecentCommands("proj-r")).toEqual([])
  })

  it("skips whitespace-only strings", () => {
    addRecentCommand("proj-r", "   ")
    expect(getRecentCommands("proj-r")).toEqual([])
  })

  it("skips single-character strings (length < 2)", () => {
    addRecentCommand("proj-r", "a")
    expect(getRecentCommands("proj-r")).toEqual([])
  })

  it("trims whitespace before storing", () => {
    addRecentCommand("proj-r", "  hello world  ")
    const cmds = getRecentCommands("proj-r")
    expect(cmds[0]).toBe("hello world")
  })
})

// ── getApiBase ───────────────────────────────────────────────────

describe("getApiBase", () => {
  it("returns empty string when not Capacitor environment", () => {
    // jsdom does not have window.Capacitor
    expect(getApiBase()).toBe("")
  })
})

describe("buildApiUrl / canUseApi", () => {
  it("uses same-origin relative paths on web even when a server URL is stored", () => {
    localStorage.setItem("agentrune_server", "https://example.trycloudflare.com")
    expect(canUseApi()).toBe(true)
    expect(buildApiUrl("/api/automations/proj-1")).toBe("/api/automations/proj-1")
  })

  it("uses the configured daemon base on Capacitor", () => {
    ;(window as any).Capacitor = { isNativePlatform: () => true }
    localStorage.setItem("agentrune_server", "http://127.0.0.1:3457/")
    expect(getApiBase()).toBe("http://127.0.0.1:3457/")
    expect(canUseApi()).toBe(true)
    expect(buildApiUrl("/api/automations/proj-1")).toBe("http://127.0.0.1:3457/api/automations/proj-1")
    delete (window as any).Capacitor
  })

  it("keeps same-origin relative URLs on Capacitor web runtime", () => {
    ;(window as any).Capacitor = { isNativePlatform: () => false }
    localStorage.setItem("agentrune_server", "https://example.trycloudflare.com")
    expect(getApiBase()).toBe("")
    expect(canUseApi()).toBe(true)
    expect(buildApiUrl("/api/project-summary")).toBe("/api/project-summary")
    delete (window as any).Capacitor
  })
})

describe("getApiAuthToken / authedFetch", () => {
  it("prefers the current api token over the legacy cloud token", async () => {
    localStorage.setItem("agentrune_cloud_token", "cloud-token")
    localStorage.setItem("agentrune_api_token", "api-token")
    expect(getApiAuthToken()).toBe("api-token")

    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await authedFetch("/api/projects")

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    )
    const [, init] = vi.mocked(global.fetch).mock.calls.at(-1)!
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer api-token")
  })

  it("falls back to the cloud token when no api token is stored", async () => {
    localStorage.setItem("agentrune_cloud_token", "cloud-token")
    expect(getApiAuthToken()).toBe("cloud-token")

    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await authedFetch("/api/tasks")

    const [, init] = vi.mocked(global.fetch).mock.calls.at(-1)!
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer cloud-token")
  })
})

// ── volume keys roundtrip ────────────────────────────────────────

describe("getVolumeKeysEnabled / setVolumeKeysEnabled", () => {
  it("defaults to false when not set", () => {
    expect(getVolumeKeysEnabled()).toBe(false)
  })

  it("roundtrips true", () => {
    setVolumeKeysEnabled(true)
    expect(getVolumeKeysEnabled()).toBe(true)
  })

  it("roundtrips false after being set to true", () => {
    setVolumeKeysEnabled(true)
    setVolumeKeysEnabled(false)
    expect(getVolumeKeysEnabled()).toBe(false)
  })
})

// ── killed sessions ──────────────────────────────────────────────

describe("getKilledSessionIds / addKilledSessionId", () => {
  it("returns empty set when none stored", () => {
    const killed = getKilledSessionIds()
    expect(killed.size).toBe(0)
    expect(killed).toBeInstanceOf(Set)
  })

  it("adds an id and retrieves it", () => {
    addKilledSessionId("session-1")
    const killed = getKilledSessionIds()
    expect(killed.has("session-1")).toBe(true)
  })

  it("deduplicates (Set semantics)", () => {
    addKilledSessionId("session-1")
    addKilledSessionId("session-1")
    const killed = getKilledSessionIds()
    expect(killed.size).toBe(1)
  })

  it("caps at 200 entries, keeping newest", () => {
    for (let i = 0; i < 210; i++) {
      addKilledSessionId(`s-${i}`)
    }
    const killed = getKilledSessionIds()
    expect(killed.size).toBe(200)
    // Oldest should be removed
    expect(killed.has("s-0")).toBe(false)
    expect(killed.has("s-9")).toBe(false)
    // Newest should be kept
    expect(killed.has("s-209")).toBe(true)
    expect(killed.has("s-10")).toBe(true)
  })

  it("handles corrupted JSON gracefully", () => {
    localStorage.setItem("agentrune_killed_sessions", "broken!")
    const killed = getKilledSessionIds()
    expect(killed.size).toBe(0)
  })
})

// ── API Keys CRUD ────────────────────────────────────────────────

describe("getApiKeys / setApiKey / setApiKeys", () => {
  it("returns empty object when none stored", () => {
    expect(getApiKeys()).toEqual({})
  })

  it("sets and retrieves a single key", () => {
    setApiKey("ANTHROPIC_API_KEY", "sk-ant-123")
    const keys = getApiKeys()
    expect(keys["ANTHROPIC_API_KEY"]).toBe("sk-ant-123")
  })

  it("overwrites an existing key", () => {
    setApiKey("ANTHROPIC_API_KEY", "old-value")
    setApiKey("ANTHROPIC_API_KEY", "new-value")
    expect(getApiKeys()["ANTHROPIC_API_KEY"]).toBe("new-value")
  })

  it("deletes a key when value is empty string", () => {
    setApiKey("OPENAI_API_KEY", "sk-openai-xxx")
    setApiKey("OPENAI_API_KEY", "")
    const keys = getApiKeys()
    expect(keys["OPENAI_API_KEY"]).toBeUndefined()
  })

  it("deletes a key when value is whitespace-only", () => {
    setApiKey("OPENAI_API_KEY", "sk-openai-xxx")
    setApiKey("OPENAI_API_KEY", "   ")
    const keys = getApiKeys()
    expect(keys["OPENAI_API_KEY"]).toBeUndefined()
  })

  it("trims key values", () => {
    setApiKey("GROQ_API_KEY", "  gsk-trimme  ")
    expect(getApiKeys()["GROQ_API_KEY"]).toBe("gsk-trimme")
  })

  it("setApiKeys bulk-sets multiple keys", () => {
    setApiKeys({ A: "1", B: "2", C: "3" })
    const keys = getApiKeys()
    expect(keys).toEqual({ A: "1", B: "2", C: "3" })
  })

  it("handles corrupted JSON gracefully", () => {
    localStorage.setItem("agentrune_api_keys", "{nope")
    expect(getApiKeys()).toEqual({})
  })
})

// ── getWorktreeEnabled ───────────────────────────────────────────

describe("getWorktreeEnabled / setWorktreeEnabled", () => {
  it("defaults to true when not set", () => {
    expect(getWorktreeEnabled()).toBe(true)
  })

  it("returns false when explicitly set to false", () => {
    setWorktreeEnabled(false)
    expect(getWorktreeEnabled()).toBe(false)
  })

  it("roundtrips back to true", () => {
    setWorktreeEnabled(false)
    setWorktreeEnabled(true)
    expect(getWorktreeEnabled()).toBe(true)
  })
})

// ── Routing Rules ────────────────────────────────────────────────

import {
  getCachedGlobalRoutingRules,
  cacheGlobalRoutingRules,
  getProjectRoutingRules,
  getKeepAwakeEnabled,
  setKeepAwakeEnabled,
  getLastProject,
  saveLastProject,
  getAutoSaveKeysEnabled,
  setAutoSaveKeysEnabled,
  getAutoSaveKeysPath,
  setAutoSaveKeysPath,
  getNotificationsEnabled,
  setNotificationsEnabled,
  getAutoUpdateEnabled,
  setAutoUpdateEnabled,
  getLastUpdateCheck,
  setLastUpdateCheck,
  getSkippedVersion,
  setSkippedVersion,
  getUpdateDetectedAt,
  setUpdateDetectedAt,
  clearUpdateDetected,
  getUpdateNotified,
  setUpdateNotified,
  getFcmToken,
  setFcmToken,
  getApiKeyServices,
  syncSettingsFromServer,
} from "./storage"

describe("getCachedGlobalRoutingRules / cacheGlobalRoutingRules", () => {
  it("returns empty array when not cached", () => {
    expect(getCachedGlobalRoutingRules()).toEqual([])
  })

  it("roundtrips cached rules", () => {
    const rules = [{ id: "r1", pattern: "fix*", target: "agent-a" }]
    cacheGlobalRoutingRules(rules as any)
    expect(getCachedGlobalRoutingRules()).toEqual(rules)
  })

  it("returns empty array on corrupted JSON", () => {
    localStorage.setItem("agentrune_global_routing_rules", "bad!")
    expect(getCachedGlobalRoutingRules()).toEqual([])
  })
})

describe("getProjectRoutingRules", () => {
  it("returns empty array when project has no routing rules", () => {
    expect(getProjectRoutingRules("no-rules")).toEqual([])
  })

  it("returns routing rules from project settings", () => {
    const rules = [{ id: "r1", pattern: "*", target: "t" }]
    localStorage.setItem(
      "agentrune_settings_proj-rr",
      JSON.stringify({ routingRules: rules }),
    )
    expect(getProjectRoutingRules("proj-rr")).toEqual(rules)
  })
})

// ── Keep Awake ──────────────────────────────────────────────────

describe("getKeepAwakeEnabled / setKeepAwakeEnabled", () => {
  it("defaults to false", () => {
    expect(getKeepAwakeEnabled()).toBe(false)
  })
  it("roundtrips true", () => {
    setKeepAwakeEnabled(true)
    expect(getKeepAwakeEnabled()).toBe(true)
  })
  it("roundtrips false", () => {
    setKeepAwakeEnabled(true)
    setKeepAwakeEnabled(false)
    expect(getKeepAwakeEnabled()).toBe(false)
  })
})

// ── Last Project ────────────────────────────────────────────────

describe("getLastProject / saveLastProject", () => {
  it("returns null when not set", () => {
    expect(getLastProject()).toBeNull()
  })
  it("roundtrips project id", () => {
    saveLastProject("proj-42")
    expect(getLastProject()).toBe("proj-42")
  })
})

// ── Auto Save Keys ──────────────────────────────────────────────

describe("getAutoSaveKeysEnabled / setAutoSaveKeysEnabled", () => {
  it("defaults to false", () => {
    expect(getAutoSaveKeysEnabled()).toBe(false)
  })
  it("roundtrips true", () => {
    setAutoSaveKeysEnabled(true)
    expect(getAutoSaveKeysEnabled()).toBe(true)
  })
})

describe("getAutoSaveKeysPath / setAutoSaveKeysPath", () => {
  it("returns default path when not set", () => {
    expect(getAutoSaveKeysPath()).toBe("~/.agentrune/secrets")
  })
  it("stores custom path", () => {
    setAutoSaveKeysPath("/custom/path")
    expect(getAutoSaveKeysPath()).toBe("/custom/path")
  })
  it("falls back to default on empty/whitespace", () => {
    setAutoSaveKeysPath("  ")
    expect(getAutoSaveKeysPath()).toBe("~/.agentrune/secrets")
  })
})

// ── Notifications ───────────────────────────────────────────────

describe("getNotificationsEnabled / setNotificationsEnabled", () => {
  it("defaults to false", () => {
    expect(getNotificationsEnabled()).toBe(false)
  })
  it("roundtrips true", () => {
    setNotificationsEnabled(true)
    expect(getNotificationsEnabled()).toBe(true)
  })
})

// ── Auto Update ─────────────────────────────────────────────────

describe("getAutoUpdateEnabled / setAutoUpdateEnabled", () => {
  it("defaults to true when not set", () => {
    expect(getAutoUpdateEnabled()).toBe(true)
  })
  it("returns false when set to false", () => {
    setAutoUpdateEnabled(false)
    expect(getAutoUpdateEnabled()).toBe(false)
  })
})

describe("getLastUpdateCheck / setLastUpdateCheck", () => {
  it("returns 0 when not set", () => {
    expect(getLastUpdateCheck()).toBe(0)
  })
  it("roundtrips timestamp", () => {
    setLastUpdateCheck(1700000000)
    expect(getLastUpdateCheck()).toBe(1700000000)
  })
})

describe("getSkippedVersion / setSkippedVersion", () => {
  it("returns null when not set", () => {
    expect(getSkippedVersion()).toBeNull()
  })
  it("roundtrips version string", () => {
    setSkippedVersion("1.2.3")
    expect(getSkippedVersion()).toBe("1.2.3")
  })
  it("clears on null", () => {
    setSkippedVersion("1.2.3")
    setSkippedVersion(null)
    expect(getSkippedVersion()).toBeNull()
  })
})

// ── Update Detection ────────────────────────────────────────────

describe("getUpdateDetectedAt / setUpdateDetectedAt / clearUpdateDetected", () => {
  it("returns null when not set", () => {
    expect(getUpdateDetectedAt()).toBeNull()
  })
  it("roundtrips version and timestamp", () => {
    setUpdateDetectedAt("2.0.0", 1700000000)
    expect(getUpdateDetectedAt()).toEqual({ version: "2.0.0", at: 1700000000 })
  })
  it("clears detection", () => {
    setUpdateDetectedAt("2.0.0", 1700000000)
    clearUpdateDetected()
    expect(getUpdateDetectedAt()).toBeNull()
  })
  it("returns null on corrupted JSON", () => {
    localStorage.setItem("agentrune_update_detected", "oops")
    expect(getUpdateDetectedAt()).toBeNull()
  })
})

describe("getUpdateNotified / setUpdateNotified", () => {
  it("returns null when not set", () => {
    expect(getUpdateNotified()).toBeNull()
  })
  it("roundtrips notified version", () => {
    setUpdateNotified("2.0.0")
    expect(getUpdateNotified()).toBe("2.0.0")
  })
})

// ── FCM Token ───────────────────────────────────────────────────

describe("getFcmToken / setFcmToken", () => {
  it("returns null when not set", () => {
    expect(getFcmToken()).toBeNull()
  })
  it("roundtrips token", () => {
    setFcmToken("fcm-xyz-123")
    expect(getFcmToken()).toBe("fcm-xyz-123")
  })
})

// ── API Key Services ────────────────────────────────────────────

describe("getApiKeyServices", () => {
  it("returns non-empty list of services", () => {
    const services = getApiKeyServices()
    expect(services.length).toBeGreaterThan(0)
    expect(services[0]).toHaveProperty("envVar")
    expect(services[0]).toHaveProperty("label")
  })
  it("includes Anthropic", () => {
    const services = getApiKeyServices()
    expect(services.find((s) => s.envVar === "ANTHROPIC_API_KEY")).toBeTruthy()
  })
})

// ── syncSettingsFromServer ──────────────────────────────────────

describe("syncSettingsFromServer", () => {
  it("merges server settings with defaults and caches locally", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ model: "opus" }),
    }) as any
    const result = await syncSettingsFromServer("proj-sync")
    expect(result.model).toBe("opus")
    // Should be cached in localStorage
    const cached = getSettings("proj-sync")
    expect(cached.model).toBe("opus")
  })

  it("falls back to local settings on fetch failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as any
    localStorage.setItem(
      "agentrune_settings_proj-sync",
      JSON.stringify({ model: "haiku" }),
    )
    const result = await syncSettingsFromServer("proj-sync")
    expect(result.model).toBe("haiku")
  })

  it("falls back to local settings on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as any
    const result = await syncSettingsFromServer("proj-sync")
    expect(result).toEqual(DEFAULT_SETTINGS)
  })
})
