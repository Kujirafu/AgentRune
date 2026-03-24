import React, { useState, useCallback, useRef, useEffect } from "react"
import type { RoutingRule } from "../../types"
import { AGENTS } from "../../types"

export interface RoutingRulesEditorProps {
  globalRules: RoutingRule[]
  projectRules: RoutingRule[]
  onSaveGlobal: (rules: RoutingRule[]) => void
  onSaveProject: (rules: RoutingRule[]) => void
  hasProject: boolean
  theme: "light" | "dark"
  t: (key: string) => string
  locale: string
}

export function RoutingRulesEditor({
  globalRules, projectRules, onSaveGlobal, onSaveProject,
  hasProject, theme, t, locale,
}: RoutingRulesEditorProps) {
  const dark = theme === "dark"
  const [scope, setScope] = useState<"global" | "project">("global")

  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const textMuted = dark ? "#475569" : "#94a3b8"
  const border = dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)"
  const cardBg = dark ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.04)"
  const inputBg = dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.06)"

  const activeRules = scope === "global" ? globalRules : projectRules
  const onSave = scope === "global" ? onSaveGlobal : onSaveProject

  const handleAdd = useCallback(() => {
    onSave([...activeRules, {
      id: Date.now().toString(),
      keywords: [],
      agentId: "claude",
      enabled: true,
    }])
  }, [activeRules, onSave])

  const handleDelete = useCallback((id: string) => {
    onSave(activeRules.filter(r => r.id !== id))
  }, [activeRules, onSave])

  const handleUpdateKeywords = useCallback((id: string, raw: string) => {
    const keywords = raw.split(",").map(s => s.trim()).filter(Boolean)
    onSave(activeRules.map(r => r.id === id ? { ...r, keywords } : r))
  }, [activeRules, onSave])

  const handleChangeAgent = useCallback((id: string, agentId: string) => {
    onSave(activeRules.map(r => r.id === id ? { ...r, agentId } : r))
  }, [activeRules, onSave])

  const handleToggle = useCallback((id: string) => {
    onSave(activeRules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r))
  }, [activeRules, onSave])

  const [agentDropdownOpenId, setAgentDropdownOpenId] = useState<string | null>(null)
  const agentDropdownRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Close dropdown on outside click
  useEffect(() => {
    if (!agentDropdownOpenId) return
    const handleClickOutside = (e: MouseEvent) => {
      const ref = agentDropdownRefs.current[agentDropdownOpenId]
      if (ref && !ref.contains(e.target as Node)) {
        setAgentDropdownOpenId(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [agentDropdownOpenId])

  // Available agents (only those in AGENTS array)
  const agentOptions = AGENTS.filter(a => a.id !== "terminal")

  return (
    <div>
      {/* Scope toggle */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        <button
          onClick={() => setScope("global")}
          style={{
            padding: "5px 14px", borderRadius: 7, border: "none",
            fontSize: 12, fontWeight: scope === "global" ? 600 : 400,
            background: scope === "global" ? (dark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.08)") : "transparent",
            color: scope === "global" ? "#37ACC0" : textSecondary,
            cursor: "pointer", fontFamily: "inherit",
            borderBottom: scope === "global" ? "2px solid #37ACC0" : "2px solid transparent",
          }}
        >
          {t("routing.global") || "Global"}
        </button>
        {hasProject && (
          <button
            onClick={() => setScope("project")}
            style={{
              padding: "5px 14px", borderRadius: 7, border: "none",
              fontSize: 12, fontWeight: scope === "project" ? 600 : 400,
              background: scope === "project" ? (dark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.08)") : "transparent",
              color: scope === "project" ? "#37ACC0" : textSecondary,
              cursor: "pointer", fontFamily: "inherit",
              borderBottom: scope === "project" ? "2px solid #37ACC0" : "2px solid transparent",
            }}
          >
            {t("routing.project") || "Per-project"}
          </button>
        )}
      </div>

      {/* Rules */}
      {activeRules.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: textMuted }}>
          {t("routing.noRules") || "No rules configured"}
        </div>
      ) : (
        activeRules.map((rule, idx) => (
          <div
            key={rule.id}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              marginBottom: 8, padding: "10px 12px",
              background: cardBg,
              border: `1px solid ${border}`,
              borderRadius: 8,
              opacity: rule.enabled ? 1 : 0.5,
            }}
          >
            {/* Priority number */}
            <span
              onClick={() => handleToggle(rule.id)}
              style={{
                fontSize: 10, color: textMuted, width: 16, cursor: "pointer",
                textAlign: "center", flexShrink: 0,
              }}
              title={rule.enabled ? "Disable" : "Enable"}
            >
              {idx + 1}
            </span>

            {/* Keywords input */}
            <input
              defaultValue={rule.keywords.join(", ")}
              onBlur={e => handleUpdateKeywords(rule.id, e.target.value)}
              placeholder={t("routing.keywords") || "keywords"}
              style={{
                flex: 1, padding: "5px 10px",
                background: inputBg,
                border: `1px solid ${border}`,
                borderRadius: 5, fontSize: 12,
                fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
                color: textPrimary, outline: "none",
              }}
            />

            {/* Arrow */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
            </svg>

            {/* Agent select */}
            <div
              ref={(el) => { agentDropdownRefs.current[rule.id] = el }}
              style={{ position: "relative", minWidth: 90 }}
            >
              <button
                onClick={() => setAgentDropdownOpenId(agentDropdownOpenId === rule.id ? null : rule.id)}
                style={{
                  width: "100%", padding: "5px 8px",
                  background: dark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.06)",
                  border: `1px solid ${dark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.15)"}`,
                  borderRadius: 5, color: "#37ACC0", fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit", outline: "none",
                  display: "flex", alignItems: "center", gap: 4,
                  backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                }}
              >
                <span style={{ flex: 1, textAlign: "left" }}>{rule.agentId}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: "transform 0.2s", transform: agentDropdownOpenId === rule.id ? "rotate(180deg)" : "rotate(0deg)" }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {agentDropdownOpenId === rule.id && (
                <div style={{
                  position: "absolute", top: "calc(100% + 3px)", left: 0,
                  minWidth: "100%", borderRadius: 6, overflow: "hidden",
                  border: `1px solid ${dark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.15)"}`,
                  background: dark ? "rgba(15,23,42,0.95)" : "rgba(255,255,255,0.97)",
                  backdropFilter: "blur(20px) saturate(1.4)",
                  WebkitBackdropFilter: "blur(20px) saturate(1.4)",
                  boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
                  zIndex: 10,
                }}>
                  {agentOptions.map((a, i) => (
                    <button
                      key={a.id}
                      onClick={() => { handleChangeAgent(rule.id, a.id); setAgentDropdownOpenId(null) }}
                      style={{
                        width: "100%", padding: "6px 10px", border: "none",
                        background: a.id === rule.agentId ? (dark ? "rgba(55,172,192,0.18)" : "rgba(55,172,192,0.10)") : "transparent",
                        color: a.id === rule.agentId ? "#37ACC0" : textPrimary,
                        fontSize: 12, fontWeight: a.id === rule.agentId ? 600 : 400,
                        cursor: "pointer", textAlign: "left",
                        fontFamily: "inherit", display: "block",
                        borderBottom: i < agentOptions.length - 1 ? `1px solid ${border}` : "none",
                      }}
                      onMouseEnter={(e) => { if (a.id !== rule.agentId) e.currentTarget.style.background = dark ? "rgba(55,172,192,0.08)" : "rgba(55,172,192,0.04)" }}
                      onMouseLeave={(e) => { if (a.id !== rule.agentId) e.currentTarget.style.background = "transparent" }}
                    >
                      {a.id}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Delete */}
            <button
              onClick={() => handleDelete(rule.id)}
              style={{
                width: 24, height: 24, borderRadius: 4, border: "none",
                background: "transparent", color: textMuted, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))
      )}

      {/* Add rule */}
      <div style={{ textAlign: "center", marginTop: 4, marginBottom: 12 }}>
        <button
          onClick={handleAdd}
          style={{
            background: "transparent", border: "none", color: "#37ACC0",
            fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: "4px 12px",
          }}
        >
          + {t("routing.addRule") || "Add rule"}
        </button>
      </div>

      {/* Fallback note */}
      <div style={{
        padding: "8px 12px",
        background: dark ? "rgba(55,172,192,0.04)" : "rgba(55,172,192,0.02)",
        border: `1px solid ${dark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.06)"}`,
        borderRadius: 6, fontSize: 11, color: textMuted,
      }}>
        {t("onboarding.routing.fallback") || "No rule matched? Auto-route by keyword similarity or start new session."}
      </div>
    </div>
  )
}
