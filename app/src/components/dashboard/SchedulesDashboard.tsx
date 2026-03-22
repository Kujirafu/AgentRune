import React, { useState } from "react"
import type { AutomationConfig, AutomationResult } from "../../data/automation-types"

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

interface SchedulesDashboardProps {
  automations: AutomationConfig[]
  results: Map<string, AutomationResult[]>
  loading: boolean
  theme: "light" | "dark"
  t: (key: string, vars?: Record<string, string>) => string
  onToggle: (id: string, enabled: boolean) => void
  onEdit: (automation: AutomationConfig) => void
  onNew: () => void
}

function getResultDotColor(status: AutomationResult["status"]): string {
  if (status === "success") return "#22c55e"
  if (status === "failed" || status === "blocked_by_risk" || status === "circuit_broken") return "#ef4444"
  if (status === "timeout" || status === "interrupted") return "#f59e0b"
  return "#94a3b8"
}

export function SchedulesDashboard({
  automations,
  results,
  loading,
  theme,
  t,
  onToggle,
  onEdit,
  onNew,
}: SchedulesDashboardProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const dark = theme === "dark"

  const cardBg = dark ? "rgba(30,41,59,0.7)" : "rgba(255,255,255,0.8)"
  const cardBorder = dark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.15)"
  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"

  if (loading) {
    return (
      <div style={{ padding: "60px 24px", textAlign: "center", color: textSecondary }}>
        <div style={{
          width: 20, height: 20,
          border: `2px solid ${dark ? "rgba(55,172,192,0.3)" : "rgba(55,172,192,0.2)"}`,
          borderTopColor: "#37ACC0", borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
          margin: "0 auto 12px",
        }} />
      </div>
    )
  }

  return (
    <div style={{ padding: "0 24px 24px" }}>
      {automations.map((auto) => {
        const isExpanded = expandedId === auto.id
        const autoResults = results.get(auto.id) || []
        const isDaily = auto.schedule.type === "daily"
        return (
          <div
            key={auto.id}
            style={{
              marginBottom: 10,
              borderRadius: 12,
              background: cardBg,
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: `1px solid ${cardBorder}`,
              overflow: "hidden",
              transition: "box-shadow 0.2s",
            }}
          >
            {/* Main card */}
            <div
              style={{
                padding: "14px 16px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 14,
              }}
              onClick={() => setExpandedId(isExpanded ? null : auto.id)}
            >
              {/* Time display */}
              <div style={{ minWidth: 72, textAlign: "center" }}>
                {isDaily ? (
                  <div style={{ fontSize: 22, fontWeight: 700, color: textPrimary, letterSpacing: -0.5 }}>
                    {auto.schedule.timeOfDay || "00:00"}
                  </div>
                ) : (
                  <div style={{ fontSize: 15, fontWeight: 700, color: textPrimary }}>
                    {t("dash.every", { interval: String(auto.schedule.intervalMinutes || 30) })}
                  </div>
                )}
                {isDaily && auto.schedule.weekdays && (
                  <div style={{ display: "flex", gap: 2, justifyContent: "center", marginTop: 4 }}>
                    {WEEKDAY_LABELS.map((label, i) => {
                      const active = auto.schedule.weekdays!.includes(i)
                      return (
                        <span key={i} style={{
                          fontSize: 9, fontWeight: 600, padding: "1px 3px", borderRadius: 3,
                          color: active ? "#37ACC0" : textSecondary,
                          background: active ? (dark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)") : "transparent",
                          opacity: active ? 1 : 0.4,
                        }}>
                          {label}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Name + status dots */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14, fontWeight: 600, color: textPrimary,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {auto.name}
                </div>
                {autoResults.length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                    {autoResults.slice(0, 5).map((r, i) => (
                      <div key={i} style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: getResultDotColor(r.status),
                      }} />
                    ))}
                  </div>
                )}
              </div>

              {/* Toggle */}
              <div
                onClick={(e) => { e.stopPropagation(); onToggle(auto.id, !auto.enabled) }}
                style={{
                  width: 44, height: 24, borderRadius: 12, cursor: "pointer",
                  background: auto.enabled ? "#37ACC0" : (dark ? "rgba(100,116,139,0.3)" : "rgba(100,116,139,0.2)"),
                  position: "relative", transition: "background 0.2s", flexShrink: 0,
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: "50%", background: "#fff",
                  position: "absolute", top: 3,
                  left: auto.enabled ? 23 : 3,
                  transition: "left 0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }} />
              </div>
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div style={{
                padding: "12px 16px", borderTop: `1px solid ${cardBorder}`,
              }}>
                {/* Recent results */}
                {autoResults.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: textSecondary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {t("dash.recentRuns")}
                    </div>
                    {autoResults.slice(0, 5).map((r, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        fontSize: 12, color: textSecondary, padding: "4px 0",
                      }}>
                        <div style={{
                          width: 6, height: 6, borderRadius: "50%",
                          background: getResultDotColor(r.status),
                          flexShrink: 0,
                        }} />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.summary || r.status}
                        </span>
                        <span style={{ opacity: 0.6, fontSize: 11, flexShrink: 0 }}>
                          {new Date(r.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit(auto) }}
                    style={{
                      padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                      border: `1px solid ${cardBorder}`, background: "transparent",
                      color: textPrimary, cursor: "pointer",
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: -1 }}>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Add new schedule button */}
      <button
        onClick={onNew}
        style={{
          width: "100%", padding: "14px", borderRadius: 12, marginTop: 8,
          border: `1px dashed ${cardBorder}`,
          background: "transparent", color: "#37ACC0",
          fontSize: 13, fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        {t("dash.schedules")}
      </button>

      {automations.length === 0 && !loading && (
        <div style={{
          textAlign: "center", padding: "40px 20px",
          color: textSecondary, fontSize: 14,
        }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={textSecondary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, marginBottom: 12 }}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
      )}
    </div>
  )
}
