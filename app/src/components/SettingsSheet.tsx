import { useState, useEffect } from "react"
import { SpringOverlay } from "./SpringOverlay"
import type { ProjectSettings, CodexMode, CodexModel, CodexReasoningEffort, ClaudeEffort, AiderModel, OpenClawProvider, CursorMode, CursorSandbox } from "../types"
import { useLocale, SUPPORTED_LOCALES } from "../lib/i18n/index.js"
import { TRUST_PROFILE_PRESETS } from "../data/automation-types"
const TRUST_PRESETS = TRUST_PROFILE_PRESETS
import { getVolumeKeysEnabled, setVolumeKeysEnabled, getKeepAwakeEnabled, setKeepAwakeEnabled, getWorktreeEnabled, setWorktreeEnabled, getAutoSaveKeysEnabled, setAutoSaveKeysEnabled, getAutoSaveKeysPath, setAutoSaveKeysPath, getNotificationsEnabled, setNotificationsEnabled, getAutoUpdateEnabled, setAutoUpdateEnabled, getLastUpdateCheck, setLastUpdateCheck, getSkippedVersion, setSkippedVersion } from "../lib/storage"
import { App } from "@capacitor/app"
import { Browser } from "@capacitor/browser"
import { identifyUser, trackLogin } from "../lib/analytics"

interface SettingsSheetProps {
  open: boolean
  settings: ProjectSettings
  agentId: string
  onChange: (settings: ProjectSettings) => void
  onClose: () => void
  send?: (msg: any) => void
  on?: (type: string, cb: (msg: any) => void) => () => void
  theme?: "light" | "dark"
  toggleTheme?: () => void
}

const DONATE_AMOUNTS = [1, 10, 20, 100]
const DONATE_CHECKOUT = "https://agentlore.lemonsqueezy.com/checkout/buy/fed5b03f-701b-44d0-b6e5-7edf8c08823d"
const SUBSCRIBE_URLS = {
  pro:   "https://agentlore.lemonsqueezy.com/checkout/buy/049d9d42-13ce-4b65-ba59-3c35bb24af6c",
  trust: "https://agentlore.lemonsqueezy.com/checkout/buy/98a2b87b-971d-4ca1-a3ae-b05c4c3e5acb",
}

const AGENTLORE_PHONE_AUTH_URL = "https://agentlore.vercel.app/api/agentrune/phone-auth"

// Agent → env var + key申請連結 mapping
const AGENT_KEY_MAP: Record<string, { envVar: string; label: string; url: string }[]> = {
  claude: [{ envVar: "ANTHROPIC_API_KEY", label: "Anthropic", url: "https://console.anthropic.com/settings/keys" }],
  codex: [{ envVar: "OPENAI_API_KEY", label: "OpenAI", url: "https://platform.openai.com/api-keys" }],
  gemini: [{ envVar: "GEMINI_API_KEY", label: "Google AI", url: "https://aistudio.google.com/apikey" }],
  cursor: [{ envVar: "CURSOR_API_KEY", label: "Cursor", url: "https://cursor.com/settings" }],
  aider: [
    { envVar: "ANTHROPIC_API_KEY", label: "Anthropic", url: "https://console.anthropic.com/settings/keys" },
    { envVar: "OPENAI_API_KEY", label: "OpenAI", url: "https://platform.openai.com/api-keys" },
  ],
  cline: [{ envVar: "ANTHROPIC_API_KEY", label: "Anthropic", url: "https://console.anthropic.com/settings/keys" }],
  openclaw: [{ envVar: "OPENROUTER_API_KEY", label: "OpenRouter", url: "https://openrouter.ai/keys" }],
}

export function SettingsSheet({ open, settings, agentId, onChange, onClose, send, on, theme, toggleTheme }: SettingsSheetProps) {
  const { t, locale, setLocale } = useLocale()
  const themePreference = typeof window !== "undefined"
    ? ((localStorage.getItem("agentrune_theme") as "light" | "dark" | "system" | null) || "system")
    : "system"
  const [phoneToken, setPhoneToken] = useState<string | null>(null)
  const [volumeKeys, setVolumeKeys] = useState(false)
  const [keepAwake, setKeepAwake] = useState(false)
  const [worktreeIsolation, setWorktreeIsolation] = useState(true)
  const [autoSaveKeys, setAutoSaveKeys] = useState(false)
  const [autoSaveKeysPathVal, setAutoSaveKeysPathVal] = useState("~/.agentrune/secrets")
  const [savedKeys, setSavedKeys] = useState<string[]>([])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editKeyValue, setEditKeyValue] = useState("")
  const [savingKey, setSavingKey] = useState(false)
  const [notifications, setNotifications] = useState(false)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [updateInfo, setUpdateInfo] = useState<{ version: string; url: string; notes: string } | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)

  useEffect(() => {
    setPhoneToken(localStorage.getItem("agentrune_phone_token"))
    setVolumeKeys(getVolumeKeysEnabled())
    setKeepAwake(getKeepAwakeEnabled())
    setWorktreeIsolation(getWorktreeEnabled())
    setAutoSaveKeys(getAutoSaveKeysEnabled())
    setAutoSaveKeysPathVal(getAutoSaveKeysPath())
    setNotifications(getNotificationsEnabled())
    setAutoUpdate(getAutoUpdateEnabled())
    // Fetch saved API key list from server
    if (open && send) {
      send({ type: "list_api_keys" })
    }
  }, [open])

  // Listen for api_keys_list response
  useEffect(() => {
    if (!on) return
    const unsub = on("api_keys_list", (msg) => {
      setSavedKeys(msg.keys as string[] || [])
    })
    return unsub
  }, [on])

  // Listen for api_key_result (save/delete)
  useEffect(() => {
    if (!on) return
    const unsub = on("api_key_result", (msg) => {
      setSavingKey(false)
      if (msg.success) {
        setEditingKey(null)
        setEditKeyValue("")
        // Refresh list
        if (send) send({ type: "list_api_keys" })
      }
    })
    return unsub
  }, [on, send])

  // Listen for update check results from App.tsx
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail) {
        setUpdateInfo(detail)
      }
    }
    const checkingHandler = (e: Event) => {
      setUpdateChecking((e as CustomEvent).detail)
    }
    window.addEventListener("updateAvailable", handler)
    window.addEventListener("updateChecking", checkingHandler)
    return () => {
      window.removeEventListener("updateAvailable", handler)
      window.removeEventListener("updateChecking", checkingHandler)
    }
  }, [])

  useEffect(() => {
    let cleanup: (() => void) | undefined
    App.addListener("appUrlOpen", ({ url }) => {
      if (url.startsWith("agentrune://auth")) {
        const u = new URL(url)
        const token = u.searchParams.get("token")
        const userId = u.searchParams.get("userId")
        if (token) {
          localStorage.setItem("agentrune_phone_token", token)
          if (userId) localStorage.setItem("agentrune_user_id", userId)
          identifyUser(); trackLogin()
          setPhoneToken(token)
        }
      }
    }).then((h) => { cleanup = () => h.remove() })
    return () => { cleanup?.() }
  }, [])

  const models = ["sonnet", "opus", "haiku"] as const
  const codexModels: { value: CodexModel; label: string }[] = [
    { value: "default", label: "Default" },
    { value: "gpt-5", label: "GPT-5" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.3", label: "GPT-5.3" },
    { value: "gpt-5-codex", label: "GPT-5 Codex" },
    { value: "codex-mini-latest", label: "Codex Mini" },
  ]
  const codexModes: { value: CodexMode; label: string; description: string }[] = [
    { value: "default", label: t("settings.codexModeDefault") || "Default", description: t("settings.codexModeDefaultDesc") || "Use Codex defaults from your config" },
    { value: "full-auto", label: t("settings.codexModeFullAuto") || "Full Auto", description: t("settings.codexModeFullAutoDesc") || "Run with --full-auto" },
    { value: "danger-full-access", label: t("settings.codexModeDanger") || "Dangerous", description: t("settings.codexModeDangerDesc") || "No sandbox, no approval prompts" },
  ]
  const codexReasoningEfforts: { value: CodexReasoningEffort; label: string; description: string }[] = [
    { value: "default", label: t("settings.reasoningDefault") || "Default", description: t("settings.reasoningDefaultDesc") || "Use model_reasoning_effort from your Codex config" },
    { value: "low", label: t("settings.reasoningLow") || "Low", description: t("settings.reasoningLowDesc") || "Fastest response, shallow reasoning" },
    { value: "medium", label: t("settings.reasoningMedium") || "Medium", description: t("settings.reasoningMediumDesc") || "Balanced quality and speed" },
    { value: "high", label: t("settings.reasoningHigh") || "High", description: t("settings.reasoningHighDesc") || "More deliberate reasoning" },
    { value: "xhigh", label: t("settings.reasoningXHigh") || "X-High", description: t("settings.reasoningXHighDesc") || "Maximum reasoning depth (slowest)" },
  ]
  const claudeEfforts: { value: ClaudeEffort; label: string; description: string }[] = [
    { value: "default", label: t("settings.effortDefault") || "Default", description: t("settings.effortDefaultDesc") || "Use Claude's default effort" },
    { value: "low", label: t("settings.effortLow") || "Low", description: t("settings.effortLowDesc") || "Quick responses, less thinking" },
    { value: "medium", label: t("settings.effortMedium") || "Medium", description: t("settings.effortMediumDesc") || "Balanced quality and speed" },
    { value: "high", label: t("settings.effortHigh") || "High", description: t("settings.effortHighDesc") || "More thorough reasoning" },
    { value: "max", label: t("settings.effortMax") || "Max", description: t("settings.effortMaxDesc") || "Maximum reasoning depth" },
  ]
  const aiderModels: { value: AiderModel; label: string }[] = [
    { value: "default", label: "Default" },
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "claude-3.5-sonnet", label: "Claude 3.5" },
    { value: "deepseek-chat", label: "DeepSeek" },
    { value: "o3-mini", label: "o3-mini" },
  ]
  const openclawProviders: { value: OpenClawProvider; label: string }[] = [
    { value: "default", label: "Default" },
    { value: "openai", label: "OpenAI" },
    { value: "anthropic", label: "Anthropic" },
    { value: "ollama", label: "Ollama" },
    { value: "custom", label: "Custom" },
  ]
  const isClaudeAgent = agentId === "claude"
  const isCodexAgent = agentId === "codex"
  const isAiderAgent = agentId === "aider"
  const isClineAgent = agentId === "cline"
  const isOpenClawAgent = agentId === "openclaw"
  const isGeminiAgent = agentId === "gemini"
  const isCursorAgent = agentId === "cursor"
  const cursorModes: { value: CursorMode; label: string }[] = [
    { value: "default", label: "Agent" },
    { value: "plan", label: "Plan" },
    { value: "ask", label: "Ask" },
  ]
  const cursorSandboxModes: { value: CursorSandbox; label: string }[] = [
    { value: "default", label: t("settings.cursorSandboxDefault") || "Default" },
    { value: "enabled", label: t("settings.cursorSandboxEnabled") || "Enabled" },
    { value: "disabled", label: t("settings.cursorSandboxDisabled") || "Disabled" },
  ]
  const geminiApprovalModes = [
    { value: "default", label: "Default" },
    { value: "auto_edit", label: "Auto Edit" },
    { value: "yolo", label: "YOLO" },
    { value: "plan", label: "Plan (Read-only)" },
  ] as const

  const openExternal = (url: string) => {
    Browser.open({ url }).catch(() => window.open(url, "_blank"))
  }

  const handleDonate = (amount: number | "custom") => {
    const url = amount === "custom"
      ? DONATE_CHECKOUT
      : `${DONATE_CHECKOUT}?checkout[custom_price]=${amount * 100}`
    openExternal(url)
  }

  const handleSubscribe = (plan: "pro" | "trust") => {
    openExternal(SUBSCRIBE_URLS[plan])
  }

  return (
    <SpringOverlay open={open}>
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 100,
      display: "flex",
      flexDirection: "column",
      background: "var(--bg-gradient)",
      color: "var(--text-primary)",
    }}>
      {/* Header */}
      <div style={{
        padding: "calc(env(safe-area-inset-top, 0px) + 48px) 20px 16px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}>
        <div style={{ width: "100%", maxWidth: 400, display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onClose} style={glassBtnStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.3 }}>{t("settings.title")}</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "0 20px 24px",
        width: "100%",
        maxWidth: 440,
        margin: "0 auto",
        WebkitOverflowScrolling: "touch" as never,
      }}>
        {/* Profile / Avatar */}
        <div style={{ marginBottom: 24 }}>
          <div style={sectionLabelStyle}>{t("settings.profile")}</div>
          <div style={{
            padding: "16px 20px",
            borderRadius: 20,
            border: "1px solid var(--glass-border)",
            background: "var(--card-bg)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "var(--glass-shadow)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {/* Avatar circle */}
              <div style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                background: phoneToken ? "var(--accent-primary-bg)" : "var(--icon-bg)",
                border: phoneToken ? "1.5px solid var(--accent-primary)" : "1.5px solid var(--glass-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: phoneToken ? "var(--accent-primary)" : "var(--text-secondary)",
                boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>
                  {phoneToken ? t("settings.loggedInAs") : t("settings.notLoggedIn")}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, lineHeight: 1.4 }}>
                  {phoneToken ? "AgentLore" : t("settings.loginHint")}
                </div>
              </div>
              {/* Theme toggle */}
              {toggleTheme && (
                <button
                  onClick={toggleTheme}
                  style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: "var(--icon-bg)",
                    border: "1px solid var(--glass-border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", color: "var(--text-primary)", flexShrink: 0,
                  }}
                  aria-label={themePreference === "system" ? "System theme" : "Toggle theme"}
                >
                  {themePreference === "system" ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 3a9 9 0 0 1 0 18V3z" />
                    </svg>
                  ) : theme === "light" ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                  )}
                </button>
              )}
            </div>
            <div style={{ marginTop: 14 }}>
              {phoneToken ? (
                <button
                  onClick={() => {
                    localStorage.removeItem("agentrune_phone_token")
                    localStorage.removeItem("agentrune_user_id")
                    setPhoneToken(null)
                  }}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: 14,
                    border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)",
                    color: "var(--text-secondary)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    textAlign: "center",
                  }}
                >
                  {t("settings.logoutAgentLore")}
                </button>
              ) : (
                <button
                  onClick={() => {
                    // Use system browser (_system) instead of in-app Chrome Custom Tab.
                    // Chrome Custom Tab sometimes brings the app to foreground without
                    // calling onNewIntent, so appUrlOpen never fires after the OAuth
                    // redirect to agentrune://auth. The system browser (Chrome / Safari)
                    // correctly triggers onNewIntent ??Capacitor appUrlOpen.
                    window.open(AGENTLORE_PHONE_AUTH_URL, "_system")
                  }}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: 14,
                    border: "1.5px solid var(--accent-primary)",
                    background: "var(--accent-primary-bg)",
                    color: "var(--accent-primary)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    textAlign: "center",
                  }}
                >
                  {t("settings.loginAgentLore")}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Language Selector */}
        <div style={{ marginBottom: 24 }}>
          <div style={sectionLabelStyle}>{t("settings.language") || "Language"}</div>
          <div style={{
            display: "flex",
            gap: 10,
            padding: "16px 20px",
            borderRadius: 20,
            border: "1px solid var(--glass-border)",
            background: "var(--card-bg)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "var(--glass-shadow)",
          }}>
            {SUPPORTED_LOCALES.map((loc) => (
              <button
                key={loc.id}
                onClick={() => setLocale(loc.id)}
                style={{
                  flex: 1,
                  padding: "12px 8px",
                  borderRadius: 14,
                  border: locale === loc.id
                    ? "1.5px solid var(--accent-primary)"
                    : "1px solid var(--glass-border)",
                  background: locale === loc.id
                    ? "var(--accent-primary-bg)"
                    : "var(--glass-bg)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  color: locale === loc.id ? "var(--accent-primary)" : "var(--text-secondary)",
                  fontWeight: locale === loc.id ? 700 : 500,
                  fontSize: 14,
                  cursor: "pointer",
                  transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                {loc.label}
              </button>
            ))}
          </div>
        </div>

        {/* Model Selection - Claude */}
        {isClaudeAgent && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabelStyle}>{t("settings.model")}</div>
            <div style={{
              display: "flex",
              gap: 10,
              padding: "16px 20px",
              borderRadius: 20,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: "var(--glass-shadow)",
            }}>
              {models.map((m) => (
                <button
                  key={m}
                  onClick={() => onChange({ ...settings, model: m })}
                  style={{
                    flex: 1,
                    padding: "12px 8px",
                    borderRadius: 14,
                    border: settings.model === m
                      ? "1.5px solid var(--accent-primary)"
                      : "1px solid var(--glass-border)",
                    background: settings.model === m
                      ? "var(--accent-primary-bg)"
                      : "var(--glass-bg)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    color: settings.model === m ? "var(--accent-primary)" : "var(--text-secondary)",
                    fontWeight: settings.model === m ? 700 : 500,
                    fontSize: 14,
                    cursor: "pointer",
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    textTransform: "capitalize",
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Model Selection - Codex */}
        {isCodexAgent && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabelStyle}>{t("settings.codexModel")}</div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 10,
              padding: "16px 20px",
              borderRadius: 20,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: "var(--glass-shadow)",
            }}>
              {codexModels.map((m) => (
                <button
                  key={m.value}
                  onClick={() => onChange({ ...settings, codexModel: m.value })}
                  style={{
                    padding: "12px 10px",
                    borderRadius: 14,
                    border: settings.codexModel === m.value
                      ? "1.5px solid var(--accent-primary)"
                      : "1px solid var(--glass-border)",
                    background: settings.codexModel === m.value
                      ? "var(--accent-primary-bg)"
                      : "var(--glass-bg)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    color: settings.codexModel === m.value ? "var(--accent-primary)" : "var(--text-secondary)",
                    fontWeight: settings.codexModel === m.value ? 700 : 500,
                    fontSize: 13,
                    cursor: "pointer",
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    textAlign: "center",
                  }}
                >
                  {m.label}
                </button>
              ))}
              <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                <input
                  type="text"
                  value={settings.codexModel === "default" ? "" : settings.codexModel}
                  onChange={(e) => {
                    const value = e.target.value
                    onChange({ ...settings, codexModel: value.trim() ? value : "default" })
                  }}
                  placeholder="gpt-5.4"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)",
                    color: "var(--text-primary)",
                    fontSize: 13,
                    fontFamily: "monospace",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ fontSize: 11, color: "var(--text-secondary)", opacity: 0.8 }}>
                  {t("settings.codexModelDesc") || "Leave empty for default, or enter any safe Codex model id such as gpt-5.4."}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reasoning - Codex */}
        {isCodexAgent && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabelStyle}>{t("settings.codexReasoning")}</div>
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: "16px 20px",
              borderRadius: 20,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: "var(--glass-shadow)",
            }}>
              {codexReasoningEfforts.map((effort) => (
                <button
                  key={effort.value}
                  onClick={() => onChange({ ...settings, codexReasoningEffort: effort.value })}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: settings.codexReasoningEffort === effort.value
                      ? "1.5px solid var(--accent-primary)"
                      : "1px solid var(--glass-border)",
                    background: settings.codexReasoningEffort === effort.value
                      ? "var(--accent-primary-bg)"
                      : "var(--glass-bg)",
                    color: settings.codexReasoningEffort === effort.value ? "var(--accent-primary)" : "var(--text-primary)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{effort.label}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>{effort.description}</div>
                </button>
              ))}
              <div style={{ fontSize: 11, color: "var(--text-secondary)", opacity: 0.85 }}>
                Applies on next Codex launch.
              </div>
            </div>
          </div>
        )}
        {/* Model Selection - Aider */}
        {isAiderAgent && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabelStyle}>{t("settings.aiderModel")}</div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
              padding: "16px 20px",
              borderRadius: 20,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: "var(--glass-shadow)",
            }}>
              {aiderModels.map((m) => (
                <button
                  key={m.value}
                  onClick={() => onChange({ ...settings, aiderModel: m.value })}
                  style={{
                    padding: "12px 10px",
                    borderRadius: 14,
                    border: settings.aiderModel === m.value
                      ? "1.5px solid var(--accent-primary)"
                      : "1px solid var(--glass-border)",
                    background: settings.aiderModel === m.value
                      ? "var(--accent-primary-bg)"
                      : "var(--glass-bg)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    color: settings.aiderModel === m.value ? "var(--accent-primary)" : "var(--text-secondary)",
                    fontWeight: settings.aiderModel === m.value ? 700 : 500,
                    fontSize: 13,
                    cursor: "pointer",
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    textAlign: "center",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* OpenClaw Provider + Gateway */}
        {isOpenClawAgent && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabelStyle}>{t("settings.openclawProvider")}</div>
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              padding: "16px 20px",
              borderRadius: 20,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: "var(--glass-shadow)",
            }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 8,
              }}>
                {openclawProviders.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => onChange({ ...settings, openclawProvider: p.value })}
                    style={{
                      padding: "10px 6px",
                      borderRadius: 12,
                      border: settings.openclawProvider === p.value
                        ? "1.5px solid var(--accent-primary)"
                        : "1px solid var(--glass-border)",
                      background: settings.openclawProvider === p.value
                        ? "var(--accent-primary-bg)"
                        : "var(--glass-bg)",
                      color: settings.openclawProvider === p.value ? "var(--accent-primary)" : "var(--text-secondary)",
                      fontWeight: settings.openclawProvider === p.value ? 700 : 500,
                      fontSize: 12,
                      cursor: "pointer",
                      transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                      textAlign: "center",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {/* Gateway URL */}
              <div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, marginBottom: 6 }}>
                  {t("settings.openclawGateway")}
                </div>
                <input
                  type="text"
                  value={settings.openclawGatewayUrl}
                  onChange={(e) => onChange({ ...settings, openclawGatewayUrl: e.target.value })}
                  placeholder="ws://127.0.0.1:18789"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)",
                    color: "var(--text-primary)",
                    fontSize: 13,
                    fontFamily: "monospace",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ fontSize: 11, color: "var(--text-secondary)", opacity: 0.7, marginTop: 4 }}>
                  {t("settings.openclawGatewayDesc")}
                </div>
              </div>
              {/* API Token */}
              <div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, marginBottom: 6 }}>
                  {t("settings.openclawToken")}
                </div>
                <input
                  type="password"
                  value={settings.openclawToken}
                  onChange={(e) => onChange({ ...settings, openclawToken: e.target.value })}
                  placeholder="OPENCLAW_GATEWAY_TOKEN"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)",
                    color: "var(--text-primary)",
                    fontSize: 13,
                    fontFamily: "monospace",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ fontSize: 11, color: "var(--text-secondary)", opacity: 0.7, marginTop: 4 }}>
                  {t("settings.openclawTokenDesc")}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Gemini Approval Mode */}
        {isGeminiAgent && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabelStyle}>{t("settings.geminiApprovalMode")}</div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
              padding: "16px 20px",
              borderRadius: 20,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: "var(--glass-shadow)",
            }}>
              {geminiApprovalModes.map((m) => (
                <button
                  key={m.value}
                  onClick={() => onChange({ ...settings, geminiApprovalMode: m.value })}
                  style={{
                    padding: "12px 10px",
                    borderRadius: 14,
                    border: settings.geminiApprovalMode === m.value
                      ? "1.5px solid var(--accent-primary)"
                      : "1px solid var(--glass-border)",
                    background: settings.geminiApprovalMode === m.value
                      ? "var(--accent-primary-bg)"
                      : "var(--glass-bg)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    color: settings.geminiApprovalMode === m.value ? "var(--accent-primary)" : "var(--text-secondary)",
                    fontWeight: settings.geminiApprovalMode === m.value ? 700 : 500,
                    fontSize: 13,
                    cursor: "pointer",
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    textAlign: "center",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Gemini Model (text input) */}
        {isGeminiAgent && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabelStyle}>{t("settings.geminiModel")}</div>
            <div style={{
              padding: "16px 20px",
              borderRadius: 20,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)",
            }}>
              <input
                type="text"
                value={settings.geminiModel}
                onChange={(e) => onChange({ ...settings, geminiModel: e.target.value })}
                placeholder="e.g. gemini-2.5-pro"
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid var(--glass-border)",
                  background: "var(--glass-bg)",
                  color: "var(--text-primary)",
                  fontSize: 13,
                  fontFamily: "monospace",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ fontSize: 11, color: "var(--text-secondary)", opacity: 0.7, marginTop: 4 }}>
                {t("settings.geminiModelDesc")}
              </div>
            </div>
          </div>
        )}

        {/* Cursor Agent Mode */}
        {isCursorAgent && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabelStyle}>{t("settings.cursorMode")}</div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 10,
              padding: "16px 20px",
              borderRadius: 20,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: "var(--glass-shadow)",
            }}>
              {cursorModes.map((m) => (
                <button
                  key={m.value}
                  onClick={() => onChange({ ...settings, cursorMode: m.value })}
                  style={{
                    padding: "12px 10px",
                    borderRadius: 14,
                    border: settings.cursorMode === m.value
                      ? "1.5px solid var(--accent-primary)"
                      : "1px solid var(--glass-border)",
                    background: settings.cursorMode === m.value
                      ? "var(--accent-primary-bg)"
                      : "var(--glass-bg)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    color: settings.cursorMode === m.value ? "var(--accent-primary)" : "var(--text-secondary)",
                    fontWeight: settings.cursorMode === m.value ? 700 : 500,
                    fontSize: 13,
                    cursor: "pointer",
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    textAlign: "center",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Cursor Model (text input) */}
        {isCursorAgent && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabelStyle}>{t("settings.cursorModel")}</div>
            <div style={{
              padding: "16px 20px",
              borderRadius: 20,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)",
            }}>
              <input
                type="text"
                value={settings.cursorModel}
                onChange={(e) => onChange({ ...settings, cursorModel: e.target.value })}
                placeholder="e.g. gpt-5.2"
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid var(--glass-border)",
                  background: "var(--glass-bg)",
                  color: "var(--text-primary)",
                  fontSize: 13,
                  fontFamily: "monospace",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ fontSize: 11, color: "var(--text-secondary)", opacity: 0.7, marginTop: 4 }}>
                {t("settings.cursorModelDesc")}
              </div>
            </div>
          </div>
        )}

        {/* Cursor Sandbox */}
        {isCursorAgent && (
          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabelStyle}>{t("settings.cursorSandbox")}</div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 10,
              padding: "16px 20px",
              borderRadius: 20,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: "var(--glass-shadow)",
            }}>
              {cursorSandboxModes.map((m) => (
                <button
                  key={m.value}
                  onClick={() => onChange({ ...settings, cursorSandbox: m.value })}
                  style={{
                    padding: "12px 10px",
                    borderRadius: 14,
                    border: settings.cursorSandbox === m.value
                      ? "1.5px solid var(--accent-primary)"
                      : "1px solid var(--glass-border)",
                    background: settings.cursorSandbox === m.value
                      ? "var(--accent-primary-bg)"
                      : "var(--glass-bg)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    color: settings.cursorSandbox === m.value ? "var(--accent-primary)" : "var(--text-secondary)",
                    fontWeight: settings.cursorSandbox === m.value ? 700 : 500,
                    fontSize: 13,
                    cursor: "pointer",
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    textAlign: "center",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Mode Toggles */}
        <div style={{ marginBottom: 24 }}>
          <div style={sectionLabelStyle}>{t("settings.mode")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {isClaudeAgent && (
              <>
                <ToggleCard
                  label={t("settings.bypass")}
                  description={t("settings.bypassDesc")}
                  icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>}
                  active={settings.bypass}
                  onChange={(v) => onChange({ ...settings, bypass: v })}
                />
                {/* Trust Profile */}
                <div style={{
                  display: "flex", flexDirection: "column", gap: 8,
                  padding: "16px 20px", borderRadius: 20,
                  border: "1px solid var(--glass-border)",
                  background: "var(--card-bg)",
                  backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                  boxShadow: "var(--glass-shadow)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                        {locale.startsWith("zh") ? "信任等級" : "Trust Level"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                        {locale.startsWith("zh") ? "搭配 Bypass 使用可限制自主範圍" : "Limits what bypass mode can do"}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["autonomous", "supervised", "guarded"] as const).map(profile => {
                      const preset = TRUST_PRESETS[profile]
                      const isActive = (settings.sandboxLevel || "none") === preset.sandboxLevel
                        && (settings.requirePlanReview || false) === preset.requirePlanReview
                        && (settings.requireMergeApproval || false) === preset.requireMergeApproval
                      const colors: Record<string, string> = { autonomous: "#22c55e", supervised: "#37ACC0", guarded: "#ef4444" }
                      const labels = locale.startsWith("zh")
                        ? { autonomous: "自主", supervised: "監督", guarded: "嚴謹" }
                        : { autonomous: "Auto", supervised: "Supervised", guarded: "Guarded" }
                      const descs = locale.startsWith("zh")
                        ? { autonomous: "全權自主", supervised: "有沙盒限制", guarded: "嚴格 + 審查" }
                        : { autonomous: "Full autonomy", supervised: "Sandboxed", guarded: "Strict + review" }
                      return (
                        <button key={profile} onClick={() => onChange({
                          ...settings,
                          sandboxLevel: preset.sandboxLevel,
                          requirePlanReview: preset.requirePlanReview,
                          requireMergeApproval: preset.requireMergeApproval,
                        })} style={{
                          flex: 1, padding: "10px 4px", borderRadius: 14, cursor: "pointer",
                          border: isActive ? `2px solid ${colors[profile]}` : "1px solid var(--glass-border)",
                          background: isActive ? `${colors[profile]}15` : "transparent",
                          textAlign: "center",
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: isActive ? colors[profile] : "var(--text-primary)", marginBottom: 2 }}>
                            {labels[profile]}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.2 }}>
                            {descs[profile]}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <ToggleCard
                  label={t("settings.planMode")}
                  description={t("settings.planModeDesc")}
                  icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>}
                  active={settings.planMode}
                  onChange={(v) => onChange({ ...settings, planMode: v })}
                />
                <ToggleCard
                  label={t("settings.autoEdit")}
                  description={t("settings.autoEditDesc")}
                  icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>}
                  active={settings.autoEdit}
                  onChange={(v) => onChange({ ...settings, autoEdit: v })}
                />
                {settings.model === "opus" && (
                  <ToggleCard
                    label={t("settings.fastMode") || "Fast Mode (Opus)"}
                    description={(t("settings.fastModeDesc") || "Faster output with same Opus model") + " — /fast in session"}
                    icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>}
                    active={settings.fastMode}
                    onChange={(v) => onChange({ ...settings, fastMode: v })}
                  />
                )}
                {/* Claude Effort Level */}
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  padding: "16px 20px",
                  borderRadius: 20,
                  border: "1px solid var(--glass-border)",
                  background: "var(--card-bg)",
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                  boxShadow: "var(--glass-shadow)",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 2 }}>
                    {t("settings.effort") || "Effort Level"}
                  </div>
                  {claudeEfforts.map((effort) => (
                    <button
                      key={effort.value}
                      onClick={() => onChange({ ...settings, claudeEffort: effort.value })}
                      style={{
                        width: "100%",
                        padding: "12px 14px",
                        borderRadius: 14,
                        border: settings.claudeEffort === effort.value
                          ? "1.5px solid var(--accent-primary)"
                          : "1px solid var(--glass-border)",
                        background: settings.claudeEffort === effort.value
                          ? "var(--accent-primary-bg)"
                          : "var(--glass-bg)",
                        color: settings.claudeEffort === effort.value ? "var(--accent-primary)" : "var(--text-primary)",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{effort.label}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>{effort.description}</div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {isCodexAgent && (
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "16px 20px",
                borderRadius: 20,
                border: "1px solid var(--glass-border)",
                background: "var(--card-bg)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                boxShadow: "var(--glass-shadow)",
              }}>
                {codexModes.map((mode) => (
                  <button
                    key={mode.value}
                    onClick={() => onChange({ ...settings, codexMode: mode.value })}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: 14,
                      border: settings.codexMode === mode.value
                        ? "1.5px solid var(--accent-primary)"
                        : "1px solid var(--glass-border)",
                      background: settings.codexMode === mode.value
                        ? "var(--accent-primary-bg)"
                        : "var(--glass-bg)",
                      color: settings.codexMode === mode.value ? "var(--accent-primary)" : "var(--text-primary)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{mode.label}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>{mode.description}</div>
                  </button>
                ))}
                <div style={{ fontSize: 11, color: "var(--text-secondary)", opacity: 0.85 }}>
                  Applies on next Codex launch.
                </div>
              </div>
            )}

            {isAiderAgent && (
              <>
                <ToggleCard
                  label={t("settings.aiderAutoCommit")}
                  description={t("settings.aiderAutoCommitDesc")}
                  icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>}
                  active={settings.aiderAutoCommit}
                  onChange={(v) => onChange({ ...settings, aiderAutoCommit: v })}
                />
                <ToggleCard
                  label={t("settings.aiderArchitect")}
                  description={t("settings.aiderArchitectDesc")}
                  icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>}
                  active={settings.aiderArchitect}
                  onChange={(v) => onChange({ ...settings, aiderArchitect: v })}
                />
              </>
            )}

            {isClineAgent && (
              <ToggleCard
                label={t("settings.clineAutoApprove")}
                description={t("settings.clineAutoApproveDesc")}
                icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>}
                active={settings.clineAutoApprove}
                onChange={(v) => onChange({ ...settings, clineAutoApprove: v })}
              />
            )}

            {isGeminiAgent && (
              <ToggleCard
                label={t("settings.geminiSandbox")}
                description={t("settings.geminiSandboxDesc")}
                icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>}
                active={settings.geminiSandbox}
                onChange={(v) => onChange({ ...settings, geminiSandbox: v })}
              />
            )}

            <ToggleCard
              label={t("settings.volumeKeys") || "Volume Keys -> Up/Down"}
              description={t("settings.volumeKeysDesc") || "Use volume buttons as arrow keys for TUI navigation"}
              icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>}
              active={volumeKeys}
              onChange={(v) => { setVolumeKeys(v); setVolumeKeysEnabled(v) }}
            />
            <ToggleCard
              label={t("settings.keepAwake")}
              description={t("settings.keepAwakeDesc")}
              icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>}
              active={keepAwake}
              onChange={(v) => {
                setKeepAwake(v)
                setKeepAwakeEnabled(v)
                window.dispatchEvent(new CustomEvent("keepAwakeChanged", { detail: v }))
              }}
            />
            <ToggleCard
              label={t("settings.worktreeIsolation")}
              description={t("settings.worktreeIsolationDesc")}
              icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>}
              active={worktreeIsolation}
              onChange={(v) => {
                setWorktreeIsolation(v)
                setWorktreeEnabled(v)
              }}
            />
            {/* API Key Management */}
            <div style={{
              padding: "16px 20px",
              borderRadius: 16,
              border: "1px solid var(--glass-border)",
              background: "var(--glass-bg)",
              backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
              display: "flex", flexDirection: "column", gap: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{t("settings.apiKeys")}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {t("settings.apiKeysDesc")}
              </div>

              {/* Key list per agent */}
              {(AGENT_KEY_MAP[agentId] || [
                { envVar: "ANTHROPIC_API_KEY", label: "Anthropic", url: "https://console.anthropic.com/settings/keys" },
                { envVar: "OPENAI_API_KEY", label: "OpenAI", url: "https://platform.openai.com/api-keys" },
                { envVar: "GEMINI_API_KEY", label: "Google AI", url: "https://aistudio.google.com/apikey" },
              ]).map(({ envVar, label, url }) => {
                const isSaved = savedKeys.includes(envVar)
                const isEditing = editingKey === envVar
                return (
                  <div key={envVar} style={{
                    padding: "12px 14px", borderRadius: 12,
                    border: "1px solid var(--glass-border)",
                    background: "var(--card-bg)",
                    display: "flex", flexDirection: "column", gap: 8,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{label}</span>
                        {isSaved && !isEditing && (
                          <span style={{
                            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 8,
                            background: "rgba(55,172,192,0.15)", color: "#37ACC0",
                          }}>{t("settings.apiKeySet")}</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {/* Get key link */}
                        <button onClick={() => {
                          import("@capacitor/browser").then(({ Browser: B }) => {
                            B.open({ url }).catch(() => window.open(url, "_blank"))
                          }).catch(() => window.open(url, "_blank"))
                        }} style={{
                          padding: "4px 8px", borderRadius: 8,
                          border: "1px solid var(--glass-border)",
                          background: "transparent", color: "#37ACC0",
                          fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                        }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                          {t("settings.apiKeyGet")}
                        </button>
                        {/* Edit / Delete */}
                        {isSaved && !isEditing && (
                          <>
                            <button onClick={() => { setEditingKey(envVar); setEditKeyValue("") }} style={{
                              padding: "4px 8px", borderRadius: 8,
                              border: "1px solid var(--glass-border)",
                              background: "transparent", color: "var(--text-secondary)",
                              fontSize: 11, cursor: "pointer",
                            }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                            </button>
                            <button onClick={() => {
                              if (send) {
                                send({ type: "delete_api_key", envVar })
                                setSavedKeys(prev => prev.filter(k => k !== envVar))
                              }
                            }} style={{
                              padding: "4px 8px", borderRadius: 8,
                              border: "1px solid rgba(251,129,132,0.3)",
                              background: "transparent", color: "#FB8184",
                              fontSize: 11, cursor: "pointer",
                            }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                            </button>
                          </>
                        )}
                        {!isSaved && !isEditing && (
                          <button onClick={() => { setEditingKey(envVar); setEditKeyValue("") }} style={{
                            padding: "4px 10px", borderRadius: 8,
                            border: "none", background: "#37ACC0", color: "#fff",
                            fontSize: 11, fontWeight: 600, cursor: "pointer",
                          }}>{t("settings.apiKeyAdd")}</button>
                        )}
                      </div>
                    </div>
                    {/* Env var name */}
                    <code style={{ fontSize: 11, color: "var(--text-tertiary, var(--text-secondary))", fontFamily: "monospace" }}>{envVar}</code>
                    {/* Edit input */}
                    {isEditing && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          type="password"
                          value={editKeyValue}
                          onChange={e => setEditKeyValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter" && editKeyValue.trim() && send) {
                              setSavingKey(true)
                              send({ type: "save_api_key", envVar, value: editKeyValue.trim() })
                            }
                          }}
                          placeholder="sk-..."
                          autoFocus
                          style={{
                            flex: 1, padding: "8px 12px", borderRadius: 10,
                            border: "1px solid var(--glass-border)",
                            background: "var(--input-bg, rgba(255,255,255,0.05))",
                            color: "var(--text-primary)", fontSize: 13,
                            fontFamily: "monospace", outline: "none",
                          }}
                        />
                        <button onClick={() => { setEditingKey(null); setEditKeyValue("") }} style={{
                          padding: "8px 12px", borderRadius: 10,
                          border: "1px solid var(--glass-border)",
                          background: "var(--glass-bg)", color: "var(--text-secondary)",
                          fontSize: 12, cursor: "pointer",
                        }}>{t("mc.cancel")}</button>
                        <button onClick={() => {
                          if (editKeyValue.trim() && send) {
                            setSavingKey(true)
                            send({ type: "save_api_key", envVar, value: editKeyValue.trim() })
                          }
                        }} disabled={!editKeyValue.trim() || savingKey} style={{
                          padding: "8px 14px", borderRadius: 10,
                          border: "none",
                          background: editKeyValue.trim() ? "#37ACC0" : "rgba(55,172,192,0.3)",
                          color: "#fff", fontSize: 12, fontWeight: 600,
                          cursor: editKeyValue.trim() ? "pointer" : "default",
                          opacity: savingKey ? 0.6 : 1,
                        }}>{savingKey ? "..." : t("settings.apiKeySave")}</button>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Security note */}
              <div style={{ fontSize: 11, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6, opacity: 0.7 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                {t("settings.apiKeysLocal")}
              </div>
            </div>
            <ToggleCard
              label={t("settings.notifications")}
              description={t("settings.notificationsDesc")}
              icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>}
              active={notifications}
              onChange={(v) => {
                setNotifications(v)
                setNotificationsEnabled(v)
                if (v) window.dispatchEvent(new CustomEvent("notificationsChanged", { detail: true }))
              }}
            />
            <ToggleCard
              label={t("settings.autoUpdate")}
              description={t("settings.autoUpdateDesc")}
              icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /></svg>}
              active={autoUpdate}
              onChange={(v) => {
                setAutoUpdate(v)
                setAutoUpdateEnabled(v)
                if (v) {
                  // Trigger a check immediately when enabled
                  window.dispatchEvent(new CustomEvent("checkForUpdate"))
                }
              }}
            />
            {updateInfo && (
              <div style={{
                padding: "16px 20px",
                borderRadius: 20,
                border: "1.5px solid var(--accent-primary)",
                background: "var(--accent-primary-bg)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--accent-primary)" }}>
                      {t("settings.updateAvailable")} — v{updateInfo.version}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                      {t("settings.updateAvailableDesc")}
                    </div>
                  </div>
                </div>
                {updateInfo.notes && (
                  <div style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    padding: "10px 14px",
                    borderRadius: 12,
                    background: "var(--glass-bg)",
                    border: "1px solid var(--glass-border)",
                    maxHeight: 100,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.5,
                  }}>
                    {updateInfo.notes}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => {
                      window.open(updateInfo.url, "_blank")
                    }}
                    style={{
                      flex: 2,
                      padding: "12px 8px",
                      borderRadius: 14,
                      border: "1.5px solid var(--accent-primary)",
                      background: "var(--accent-primary)",
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    {t("settings.updateNow")}
                  </button>
                  <button
                    onClick={() => {
                      setSkippedVersion(updateInfo.version)
                      setUpdateInfo(null)
                    }}
                    style={{
                      flex: 1,
                      padding: "12px 8px",
                      borderRadius: 14,
                      border: "1px solid var(--glass-border)",
                      background: "var(--glass-bg)",
                      color: "var(--text-secondary)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    {t("settings.updateSkip")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {/* Donate Section */}
        <div>
          <div style={sectionLabelStyle}>{t("settings.support")}</div>
          <div style={{
            padding: "16px 20px",
            borderRadius: 20,
            border: "1px solid var(--glass-border)",
            background: "var(--card-bg)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "var(--glass-shadow)",
          }}>
            <div style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              marginBottom: 14,
              fontWeight: 500,
              lineHeight: 1.5,
            }}>
              {t("settings.supportDesc")}
              {locale === "zh-TW" && (
                <span style={{ display: "block", marginTop: 4, fontSize: 11, opacity: 0.7 }}>

                  以美元計價

                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {DONATE_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  onClick={() => handleDonate(amount)}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    borderRadius: 14,
                    border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    color: "var(--text-primary)",
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    textAlign: "center",
                  }}
                >
                  {locale === "zh-TW" ? `US$${amount}` : `$${amount}`}
                </button>
              ))}
            </div>
            <button
              onClick={() => handleDonate("custom")}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "12px 8px",
                borderRadius: 14,
                border: "1.5px solid var(--accent-primary)",
                background: "var(--accent-primary-bg)",
                color: "var(--accent-primary)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                textAlign: "center",
              }}
            >
              {t("settings.customAmount")}
            </button>
          </div>
        </div>

        {/* Subscribe Section */}
        <div>
          <div style={sectionLabelStyle}>{t("settings.subscribe")}</div>
          <div style={{
            padding: "16px 20px",
            borderRadius: 20,
            border: "1px solid var(--glass-border)",
            background: "var(--card-bg)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "var(--glass-shadow)",
          }}>
            <div style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              marginBottom: 14,
              fontWeight: 500,
              lineHeight: 1.5,
            }}>
              {t("settings.subscribeDesc")}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {(["pro", "trust"] as const).map((plan) => (
                <button
                  key={plan}
                  onClick={() => handleSubscribe(plan)}
                  style={{
                    flex: 1,
                    padding: "13px 8px",
                    borderRadius: 14,
                    border: plan === "trust"
                      ? "1.5px solid var(--accent-primary)"
                      : "1px solid var(--glass-border)",
                    background: plan === "trust"
                      ? "var(--accent-primary-bg)"
                      : "var(--glass-bg)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    color: plan === "trust" ? "var(--accent-primary)" : "var(--text-primary)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    textAlign: "center",
                  }}
                >
                  {t(`settings.subscribe${plan.charAt(0).toUpperCase() + plan.slice(1)}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* Version Info + Links */}
        <div style={{ marginTop: 24, textAlign: "center", padding: "16px 0" }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", opacity: 0.5, fontWeight: 500 }}>
            AgentRune v{__APP_VERSION__}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.3, marginTop: 4 }}>
            Build {__BUILD_TIME__}
          </div>
          {updateChecking && (
            <div style={{ fontSize: 10, color: "var(--accent-primary)", opacity: 0.7, marginTop: 4 }}>
              {t("settings.checking")}
            </div>
          )}
          {!updateChecking && !updateInfo && autoUpdate && (
            <div style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.4, marginTop: 4 }}>
              {t("settings.upToDate")}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 10 }}>
            <a
              href="https://agentlore.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 11, color: "var(--accent-primary)", opacity: 0.7, textDecoration: "none" }}
            >
              {t("settings.website")}
            </a>
            <a
              href="https://github.com/Kujirafu/agentrune"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 11, color: "var(--accent-primary)", opacity: 0.7, textDecoration: "none" }}
            >
              GitHub
            </a>
          </div>
          <div style={{ fontSize: 9, color: "var(--text-secondary)", opacity: 0.25, marginTop: 8 }}>
            AGPL-3.0 License
          </div>
        </div>
      </div>
    </div>
    </SpringOverlay>
  )
}

function ToggleCard({
  label,
  description,
  icon,
  active,
  onChange,
}: {
  label: string
  description: string
  icon: React.ReactNode
  active: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!active)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        width: "100%",
        padding: "16px 20px",
        borderRadius: 20,
        border: active
          ? "1.5px solid var(--accent-primary)"
          : "1px solid var(--glass-border)",
        background: active
          ? "var(--accent-primary-bg)"
          : "var(--card-bg)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        boxShadow: active ? "0 4px 16px rgba(59,130,246,0.15)" : "var(--glass-shadow)",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        color: "var(--text-primary)",
      }}
    >
      {/* Icon ??48x48 borderRadius 14, same as LaunchPad */}
      <div style={{
        width: 48,
        height: 48,
        borderRadius: 14,
        background: "var(--icon-bg)",
        border: "1px solid var(--glass-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: active ? "var(--accent-primary)" : "var(--text-primary)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>
          {description}
        </div>
      </div>
      {/* Toggle */}
      <div style={{
        width: 48,
        height: 28,
        borderRadius: 14,
        background: active
          ? "var(--accent-primary)"
          : "var(--glass-border)",
        position: "relative",
        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        flexShrink: 0,
      }}>
        <div style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "#fff",
          position: "absolute",
          top: 3,
          left: active ? 23 : 3,
          transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
        }} />
      </div>
    </button>
  )
}

const glassBtnStyle: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 12,
  border: "1px solid var(--glass-border)",
  background: "var(--glass-bg)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  boxShadow: "var(--glass-shadow)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  marginBottom: 12,
}
