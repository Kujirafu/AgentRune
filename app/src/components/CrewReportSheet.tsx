// components/CrewReportSheet.tsx
// Crew execution report viewer — shows phase timeline, role results, token usage
import { useState, useEffect, useCallback } from "react"
import { useLocale } from "../lib/i18n"
import type { CrewExecutionReport, CrewRoleResult } from "../data/automation-types"

interface CrewReportSheetProps {
  open: boolean
  automationId: string
  automationName: string
  serverUrl: string
  onClose: () => void
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`
  return `${Math.round(ms / 3600000)}h ${Math.round((ms % 3600000) / 60000)}m`
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    completed: { bg: "rgba(34,197,94,0.15)", text: "#22c55e" },
    failed: { bg: "rgba(239,68,68,0.15)", text: "#ef4444" },
    circuit_broken: { bg: "rgba(245,158,11,0.15)", text: "#f59e0b" },
    skipped: { bg: "rgba(148,163,184,0.15)", text: "#94a3b8" },
  }
  const c = colorMap[status] || colorMap.skipped
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
      background: c.bg, color: c.text,
    }}>
      {t(`crew.report.status.${status}`) || status}
    </span>
  )
}

function TokenBar({ used, budget }: { used: number; budget: number }) {
  const pct = Math.min((used / budget) * 100, 100)
  const isOver = used >= budget
  return (
    <div style={{ width: "100%", height: 6, borderRadius: 3, background: "rgba(0,0,0,0.06)", overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`, height: "100%", borderRadius: 3,
        background: isOver ? "#ef4444" : pct > 80 ? "#f59e0b" : "#37ACC0",
        transition: "width 0.3s ease",
      }} />
    </div>
  )
}

export default function CrewReportSheet({ open, automationId, automationName, serverUrl, onClose }: CrewReportSheetProps) {
  const { t } = useLocale()
  const [reports, setReports] = useState<CrewExecutionReport[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [expandedRole, setExpandedRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchReports = useCallback(async () => {
    if (!automationId || !serverUrl) return
    setLoading(true)
    try {
      // Extract projectId from URL context — use generic endpoint
      const resp = await fetch(`${serverUrl}/api/automations/_/${automationId}/crew-reports`)
      if (resp.ok) {
        const data = await resp.json()
        setReports(data)
        setSelectedIdx(data.length - 1)  // show latest by default
      }
    } catch (err) {
      console.warn("[CrewReport] Failed to fetch reports:", err)
    } finally {
      setLoading(false)
    }
  }, [automationId, serverUrl])

  useEffect(() => {
    if (open) {
      fetchReports()
      setExpandedRole(null)
    }
  }, [open, fetchReports])

  if (!open) return null

  const report = reports[selectedIdx]

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1200,
      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)",
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px", display: "flex", alignItems: "center", gap: 12,
        background: "rgba(255,255,255,0.95)", borderBottom: "1px solid rgba(0,0,0,0.08)",
      }}>
        <button onClick={onClose} style={{
          background: "none", border: "none", cursor: "pointer", padding: 4,
          color: "#64748b", display: "flex",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b" }}>{t("crew.report.title")}</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{automationName}</div>
        </div>
        {/* History selector */}
        {reports.length > 1 && (
          <select
            value={selectedIdx}
            onChange={(e) => { setSelectedIdx(Number(e.target.value)); setExpandedRole(null) }}
            style={{
              padding: "4px 8px", borderRadius: 6, fontSize: 11,
              border: "1px solid rgba(0,0,0,0.1)", background: "rgba(255,255,255,0.8)",
              color: "#1e293b", outline: "none",
            }}
          >
            {reports.map((r, i) => (
              <option key={i} value={i}>
                {new Date(r.startedAt).toLocaleDateString()} {new Date(r.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 13 }}>Loading...</div>
        ) : !report ? (
          <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 13 }}>
            {t("crew.report.noReports")}
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <div style={{
                padding: "12px 14px", borderRadius: 12,
                background: "rgba(255,255,255,0.8)", border: "1px solid rgba(0,0,0,0.06)",
              }}>
                <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>{t("crew.report.totalTokens")}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1e293b" }}>
                  {report.totalTokensUsed.toLocaleString()}
                </div>
                <div style={{ marginTop: 6 }}>
                  <TokenBar used={report.totalTokensUsed} budget={report.tokenBudget} />
                  <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 3 }}>
                    {t("crew.report.budget")}: {report.tokenBudget.toLocaleString()}
                  </div>
                </div>
              </div>
              <div style={{
                padding: "12px 14px", borderRadius: 12,
                background: "rgba(255,255,255,0.8)", border: "1px solid rgba(0,0,0,0.06)",
              }}>
                <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>{t("crew.report.duration")}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1e293b" }}>
                  {formatDuration(report.completedAt - report.startedAt)}
                </div>
                <div style={{ marginTop: 8 }}>
                  <StatusBadge status={report.status} t={t} />
                </div>
              </div>
            </div>

            {/* Circuit breaker alert */}
            {report.status === "circuit_broken" && (
              <div style={{
                padding: "10px 14px", borderRadius: 10, marginBottom: 16,
                background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span style={{ fontSize: 12, color: "#92400e" }}>{t("crew.report.circuitBreaker")}</span>
              </div>
            )}

            {/* Phase timeline */}
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 10 }}>
              {t("crew.report.phaseTimeline")}
            </div>

            {report.phases.map((phase) => (
              <div key={phase.phase} style={{ marginBottom: 12 }}>
                {/* Phase header */}
                <div style={{
                  fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 6,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: "50%",
                    background: "rgba(55,172,192,0.1)", color: "#37ACC0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700,
                  }}>
                    {phase.phase}
                  </div>
                  {t("crew.phase").replace("{n}", String(phase.phase))}
                  {phase.roles.length > 1 && (
                    <span style={{ fontSize: 9, color: "#94a3b8" }}>({t("crew.parallel")})</span>
                  )}
                </div>

                {/* Role cards */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 10 }}>
                  {phase.roles.map((role) => {
                    const isExpanded = expandedRole === `${phase.phase}_${role.roleId}`
                    const roleName = t(role.roleName) !== role.roleName ? t(role.roleName) : role.roleId
                    return (
                      <div key={role.roleId} style={{
                        borderRadius: 10, border: "1px solid rgba(0,0,0,0.06)",
                        background: "rgba(255,255,255,0.8)", overflow: "hidden",
                        borderLeft: `3px solid ${role.color}`,
                      }}>
                        <button
                          onClick={() => setExpandedRole(isExpanded ? null : `${phase.phase}_${role.roleId}`)}
                          style={{
                            width: "100%", display: "flex", alignItems: "center", gap: 8,
                            padding: "8px 10px", background: "none", border: "none",
                            cursor: "pointer", textAlign: "left",
                          }}
                        >
                          <div style={{
                            width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                            background: role.color, color: "#fff",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 10, fontWeight: 700,
                          }}>
                            {roleName.charAt(0).toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>{roleName}</div>
                            <div style={{ fontSize: 10, color: "#94a3b8" }}>
                              {role.tokensUsed.toLocaleString()} tok · {formatDuration(role.durationMs)}
                            </div>
                          </div>
                          <StatusBadge status={role.status} t={t} />
                        </button>

                        {isExpanded && (
                          <div style={{ padding: "0 10px 10px" }}>
                            {/* Output summary */}
                            <div style={{
                              fontSize: 11, lineHeight: 1.6, color: "#475569",
                              whiteSpace: "pre-wrap", wordBreak: "break-word",
                              maxHeight: 200, overflowY: "auto",
                              padding: "8px 10px", borderRadius: 8,
                              background: "rgba(0,0,0,0.03)",
                              fontFamily: "monospace",
                            }}>
                              {role.outputSummary || "(no output)"}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Target branch info */}
            {report.targetBranch && (
              <div style={{
                marginTop: 12, padding: "8px 12px", borderRadius: 8,
                background: "rgba(55,172,192,0.06)", border: "1px solid rgba(55,172,192,0.12)",
                fontSize: 11, color: "#0e7490", display: "flex", alignItems: "center", gap: 6,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 01-9 9" />
                </svg>
                Branch: {report.targetBranch}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
