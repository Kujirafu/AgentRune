import { describe, it, expect, beforeEach } from "vitest"
import {
  getSettings,
  saveSettings,
  getRecentCommands,
  addRecentCommand,
  getApiBase,
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
