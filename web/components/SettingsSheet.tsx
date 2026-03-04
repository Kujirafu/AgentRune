import { useState, useEffect } from "react"
import type { ProjectSettings } from "../lib/types"
import { useLocale, SUPPORTED_LOCALES } from "../lib/i18n/index.js"
import { App } from "@capacitor/app"

interface SettingsSheetProps {
  open: boolean
  settings: ProjectSettings
  agentId: string
  onChange: (settings: ProjectSettings) => void
  onClose: () => void
}

const DONATE_AMOUNTS = [1, 10, 20, 100]
const DONATE_URL = "https://agentlore.lemonsqueezy.com"
const SUBSCRIBE_URLS = {
  pro:   "https://agentlore.lemonsqueezy.com/checkout/buy/049d9d42-13ce-4b65-ba59-3c35bb24af6c",
  trust: "https://agentlore.lemonsqueezy.com/checkout/buy/98a2b87b-971d-4ca1-a3ae-b05c4c3e5acb",
}

const AGENTLORE_PHONE_AUTH_URL = "https://agentlore.vercel.app/api/agentrune/phone-auth"

export function SettingsSheet({ open, settings, agentId, onChange, onClose }: SettingsSheetProps) {
  const { t, locale, setLocale } = useLocale()
  const [phoneToken, setPhoneToken] = useState<string | null>(null)

  useEffect(() => {
    setPhoneToken(localStorage.getItem("agentrune_phone_token"))
  }, [open])

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
          setPhoneToken(token)
        }
      }
    }).then((h) => { cleanup = () => h.remove() })
    return () => { cleanup?.() }
  }, [])

  if (!open) return null

  const models = ["sonnet", "opus", "haiku"] as const
  const isClaudeAgent = agentId === "claude"

  const handleDonate = (_amount: number | "custom") => {
    window.open(DONATE_URL, "_blank")
  }

  const handleSubscribe = (plan: "pro" | "trust") => {
    window.open(SUBSCRIBE_URLS[plan], "_blank")
  }

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 100,
      display: "flex",
      flexDirection: "column",
      background: "var(--bg-gradient)",
      color: "var(--text-primary)",
      animation: "fadeSlideUp 0.3s ease-out",
    }}>
      {/* Header */}
      <div style={{
        padding: "48px 20px 16px",
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
                  onClick={() => window.open(AGENTLORE_PHONE_AUTH_URL, "_blank")}
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

        {/* Model Selection — only for Claude */}
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

        {/* Mode Toggles */}
        <div style={{ marginBottom: 24 }}>
          <div style={sectionLabelStyle}>{t("settings.mode")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ToggleCard
              label={t("settings.bypass")}
              description={t("settings.bypassDesc")}
              icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>}
              active={settings.bypass}
              onChange={(v) => onChange({ ...settings, bypass: v })}
            />
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
                  ${amount}
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
      </div>
    </div>
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
      {/* Icon — 48x48 borderRadius 14, same as LaunchPad */}
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
