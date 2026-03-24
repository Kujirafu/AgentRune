import React, { useState, useEffect, useCallback } from "react"
import type { RoutingRule, DetectedAgent } from "../../types"
import { DEFAULT_ROUTING_RULES } from "../../types"
import { RoutingRulesEditor } from "./RoutingRulesEditor"

interface DesktopOnboardingProps {
  onComplete: () => void
  theme: "light" | "dark"
  t: (key: string) => string
  locale: string
  apiBase: string
  projectId: string | null
}

export function DesktopOnboarding({ onComplete, theme, t, locale, apiBase, projectId }: DesktopOnboardingProps) {
  const dark = theme === "dark"
  const [step, setStep] = useState(1)
  const [agents, setAgents] = useState<DetectedAgent[]>([])
  const [globalRules, setGlobalRules] = useState<RoutingRule[]>([...DEFAULT_ROUTING_RULES])
  const [agentsLoading, setAgentsLoading] = useState(false)

  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const textMuted = dark ? "#475569" : "#94a3b8"
  const bg = dark ? "#0f172a" : "#f8fafc"
  const cardBg = dark ? "rgba(30,41,59,0.6)" : "rgba(255,255,255,0.8)"
  const border = dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.15)"

  // Fetch agents when reaching step 3
  useEffect(() => {
    if (step === 3 && agents.length === 0) {
      setAgentsLoading(true)
      const base = apiBase || ""
      fetch(`${base}/api/detect-agents`)
        .then(r => r.json())
        .then(data => { setAgents(data); setAgentsLoading(false) })
        .catch(() => setAgentsLoading(false))
    }
  }, [step, agents.length, apiBase])

  const handleComplete = useCallback(() => {
    // Save global rules to server
    const base = apiBase || ""
    fetch(`${base}/api/routing-rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules: globalRules }),
    }).catch(() => {})
    localStorage.setItem("desktop_onboarding_seen", "1")
    onComplete()
  }, [apiBase, globalRules, onComplete])

  const handleSkip = useCallback(() => {
    localStorage.setItem("desktop_onboarding_seen", "1")
    onComplete()
  }, [onComplete])

  const installedCount = agents.filter(a => a.installed).length

  // ── Progress bar ──
  const renderProgress = () => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, padding: "24px 0 12px" }}>
      {[1, 2, 3, 4, 5].map(s => (
        <React.Fragment key={s}>
          <div style={{
            width: 28, height: 28, borderRadius: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 600,
            background: s <= step ? "#37ACC0" : (dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.08)"),
            color: s <= step ? "#ffffff" : textMuted,
            transition: "all 0.2s",
          }}>
            {s < step ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : s}
          </div>
          {s < 5 && <div style={{ width: 40, height: 2, background: s < step ? "#37ACC0" : (dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.1)"), transition: "background 0.2s" }} />}
        </React.Fragment>
      ))}
    </div>
  )

  // ── Step 1: Welcome ──
  const renderWelcome = () => (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}>
        <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
      </svg>
      <h2 style={{ fontSize: 24, fontWeight: 700, color: textPrimary, margin: "0 0 8px" }}>
        {t("onboarding.welcome.title") || "Welcome to AgentRune"}
      </h2>
      <p style={{ color: textSecondary, fontSize: 15, maxWidth: 440, margin: "0 auto 32px", lineHeight: 1.6 }}>
        {t("onboarding.welcome.subtitle") || "Multi-agent control center. Manage Claude, Codex, Gemini and more from one place \u2014 desktop and mobile synced in real-time."}
      </p>
      <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
        <button
          onClick={() => setStep(2)}
          style={{
            padding: "10px 28px", background: "#37ACC0", color: "#ffffff",
            borderRadius: 8, border: "none", fontSize: 14, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {t("onboarding.welcome.start") || "Get Started"}
        </button>
        <button
          onClick={handleSkip}
          style={{
            padding: "10px 28px", background: "transparent",
            border: `1px solid ${border}`, color: textSecondary,
            borderRadius: 8, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {t("onboarding.welcome.skip") || "Skip Setup"}
        </button>
      </div>
    </div>
  )

  // ── Step 2: Connect Mobile ──
  const renderMobile = () => (
    <div style={{ padding: "40px 20px", display: "flex", gap: 32, alignItems: "flex-start", justifyContent: "center" }}>
      <div style={{ flex: 1, maxWidth: 400 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: textPrimary, margin: "0 0 8px" }}>
          {t("onboarding.mobile.title") || "Sync with your phone"}
        </h3>
        <p style={{ color: textSecondary, fontSize: 14, margin: "0 0 20px", lineHeight: 1.6 }}>
          {t("onboarding.mobile.desc") || "Download AgentRune on your phone. Login with the same AgentLore account and they'll automatically pair."}
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <a
            href="https://github.com/Kujirafu/AgentRune/releases"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "6px 16px", background: cardBg, border: `1px solid ${border}`,
              borderRadius: 8, fontSize: 13, color: "#37ACC0", fontFamily: "inherit",
              textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            GitHub Release (Android APK)
          </a>
        </div>
        <p style={{ color: textMuted, fontSize: 12 }}>
          {t("onboarding.mobile.later") || "You can also pair later in Settings."}
        </p>
      </div>
      <div style={{
        width: 120, height: 200,
        background: dark ? "rgba(148,163,184,0.04)" : "rgba(148,163,184,0.03)",
        border: `2px solid ${border}`, borderRadius: 20,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={textMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
      </div>
    </div>
  )

  // ── Step 3: Detect Agents ──
  const renderAgents = () => (
    <div style={{ padding: "32px 20px", maxWidth: 560, margin: "0 auto" }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, color: textPrimary, margin: "0 0 4px" }}>
        {t("onboarding.agents.title") || "Installed Agents"}
      </h3>
      <p style={{ color: textSecondary, fontSize: 13, margin: "0 0 20px" }}>
        {t("onboarding.agents.desc") || "We scanned your system for AI agent CLIs."}
      </p>
      {agentsLoading ? (
        <div style={{ textAlign: "center", padding: 40, color: textMuted, fontSize: 13 }}>Scanning...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {agents.map(agent => (
            <div key={agent.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px",
              background: agent.installed
                ? (dark ? "rgba(55,172,192,0.06)" : "rgba(55,172,192,0.03)")
                : (dark ? "rgba(148,163,184,0.04)" : "rgba(148,163,184,0.02)"),
              border: `1px solid ${agent.installed
                ? (dark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)")
                : border}`,
              borderRadius: 8,
            }}>
              {agent.installed ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              )}
              <div>
                <div style={{
                  fontSize: 13, color: agent.installed ? textPrimary : textSecondary,
                  fontWeight: agent.installed ? 600 : 400,
                }}>
                  {agent.name}
                </div>
                <div style={{ fontSize: 11, color: textMuted }}>
                  {agent.installed
                    ? (agent.version || "installed")
                    : (t("onboarding.agents.notInstalled") || "Not installed")}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {!agentsLoading && agents.length > 0 && (
        <p style={{ color: textMuted, fontSize: 12, marginTop: 12 }}>
          {(t("onboarding.agents.detected") || "{count} agents detected").replace("{count}", String(installedCount))}
        </p>
      )}
    </div>
  )

  // ── Step 4: Routing Rules ──
  const renderRouting = () => (
    <div style={{ padding: "32px 20px", maxWidth: 560, margin: "0 auto" }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, color: textPrimary, margin: "0 0 4px" }}>
        {t("onboarding.routing.title") || "Route tasks to the right agent"}
      </h3>
      <p style={{ color: textSecondary, fontSize: 13, margin: "0 0 20px" }}>
        {t("onboarding.routing.desc") || "Add keyword rules to auto-assign commands. Rules are matched top to bottom. You can change these anytime in Settings."}
      </p>
      <RoutingRulesEditor
        globalRules={globalRules}
        projectRules={[]}
        onSaveGlobal={setGlobalRules}
        onSaveProject={() => {}}
        hasProject={false}
        theme={theme}
        t={t}
        locale={locale}
      />
    </div>
  )

  // ── Step 5: Ready ──
  const renderReady = () => (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }}>
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      <h3 style={{ fontSize: 20, fontWeight: 700, color: textPrimary, margin: "0 0 8px" }}>
        {t("onboarding.ready.title") || "All set!"}
      </h3>
      <p style={{ color: textSecondary, fontSize: 14, maxWidth: 380, margin: "0 auto 28px" }}>
        {(t("onboarding.ready.summary") || "{agents} agents detected, {rules} routing rules configured")
          .replace("{agents}", String(installedCount))
          .replace("{rules}", String(globalRules.length))}
      </p>
      <button
        onClick={handleComplete}
        style={{
          padding: "12px 36px", background: "#37ACC0", color: "#ffffff",
          borderRadius: 8, border: "none", fontSize: 15, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit",
        }}
      >
        {t("onboarding.ready.start") || "Start using AgentRune"}
      </button>
    </div>
  )

  const STEPS = [renderWelcome, renderMobile, renderAgents, renderRouting, renderReady]

  return (
    <div style={{
      width: "100%", height: "100%", background: bg,
      display: "flex", flexDirection: "column", fontFamily: "inherit",
      color: textPrimary,
    }}>
      {/* Skip link top-right */}
      {step < 5 && (
        <div style={{ position: "absolute", top: 48, right: 24 }}>
          <button
            onClick={handleSkip}
            style={{
              background: "transparent", border: "none", color: textMuted,
              fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {t("onboarding.skip") || "Skip"}
          </button>
        </div>
      )}

      {/* Progress */}
      {renderProgress()}

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {STEPS[step - 1]()}
      </div>

      {/* Navigation bar */}
      {step > 1 && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 32px 20px",
          borderTop: `1px solid ${border}`,
        }}>
          <button
            onClick={() => setStep(s => Math.max(1, s - 1))}
            style={{
              padding: "8px 20px", background: "transparent",
              border: `1px solid ${border}`, color: textSecondary,
              borderRadius: 7, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {t("onboarding.back") || "Back"}
          </button>
          <span style={{ fontSize: 12, color: textMuted }}>{step} / 5</span>
          {step < 5 ? (
            <button
              onClick={() => setStep(s => Math.min(5, s + 1))}
              style={{
                padding: "8px 20px", background: "#37ACC0", color: "#ffffff",
                borderRadius: 7, border: "none", fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {t("onboarding.next") || "Next"}
            </button>
          ) : (
            <button
              onClick={handleComplete}
              style={{
                padding: "8px 20px", background: "#37ACC0", color: "#ffffff",
                borderRadius: 7, border: "none", fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {t("onboarding.ready.start") || "Start"}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
