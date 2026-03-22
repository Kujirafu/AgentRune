import React, { useState } from "react"
import type { AutomationConfig, AutomationResult, AutomationSchedule } from "../../../data/automation-types"
import type { Project } from "../../../types"
import { ConfirmDialog } from "../ConfirmDialog"

function formatSchedule(s: AutomationSchedule): string {
  if (s.type === "interval" && s.intervalMinutes) return `Every ${s.intervalMinutes}m`
  if (s.type === "daily" && s.timeOfDay) return `Daily ${s.timeOfDay}`
  return s.type
}

interface SchedulesToolProps {
  automations: AutomationConfig[]
  results: Map<string, AutomationResult[]>
  loading: boolean
  projects: Project[]
  theme: "light" | "dark"
  t: (key: string) => string
  onToggle: (id: string, enabled: boolean) => Promise<void>
  onEdit: (auto: AutomationConfig) => void
  onNew: () => void
  onDelete?: (auto: AutomationConfig) => Promise<void>
  onViewReport?: (auto: AutomationConfig, results: AutomationResult[]) => void
  onViewCrewReport?: (auto: AutomationConfig) => void
}

export function SchedulesTool({
  automations, results, loading, projects, theme, t, onToggle, onEdit, onNew, onDelete,
  onViewReport, onViewCrewReport,
}: SchedulesToolProps) {
  const dark = theme === "dark"
  const [deleteTarget, setDeleteTarget] = useState<AutomationConfig | null>(null)
  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const border = dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)"
  const headerBg = dark ? "rgba(30,41,59,0.4)" : "rgba(241,245,249,0.6)"
  const rowBg = dark ? "rgba(30,41,59,0.3)" : "rgba(255,255,255,0.6)"

  const getProjectName = (projectId: string) => {
    return projects.find(p => p.id === projectId)?.name || projectId
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: textPrimary, margin: 0 }}>{t("dash.schedules")}</h2>
        <button
          onClick={onNew}
          style={{
            padding: "6px 14px", fontSize: 12, fontWeight: 600,
            borderRadius: 6, border: "none",
            background: "#37ACC0", color: "#fff", cursor: "pointer",
          }}
        >
          + New
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: textSecondary }}>Loading...</div>
      ) : automations.length === 0 ? (
        <div style={{ fontSize: 13, color: textSecondary, textAlign: "center", padding: 40 }}>
          No automations configured
        </div>
      ) : (
        <div style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${border}` }}>
          {/* Table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 80px 50px 40px 40px",
            padding: "8px 14px", fontSize: 11, fontWeight: 700,
            color: textSecondary, background: headerBg,
            textTransform: "uppercase", letterSpacing: 0.5,
          }}>
            <span>Name</span>
            <span>Project</span>
            <span>Schedule</span>
            <span>Last Run</span>
            <span>Next Run</span>
            <span>Status</span>
            <span>Report</span>
            <span></span>
            <span></span>
          </div>
          {/* Rows */}
          {automations.map(auto => {
            const autoResults = results.get(auto.id) || []
            const lastResult = autoResults[autoResults.length - 1]
            const nextRun = (auto as any).nextRunAt
              ? new Date((auto as any).nextRunAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
              : "-"
            const lastRun = lastResult
              ? new Date(lastResult.finishedAt || lastResult.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
              : "-"

            return (
              <div
                key={auto.id}
                role="row"
                onClick={() => onEdit(auto)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit(auto) } }}
                tabIndex={0}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 80px 50px 40px 40px",
                  padding: "10px 14px", fontSize: 12,
                  color: textPrimary, background: rowBg,
                  borderTop: `1px solid ${border}`,
                  cursor: "pointer",
                  opacity: auto.enabled ? 1 : 0.5,
                }}
              >
                <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{auto.name}</span>
                <span style={{ color: textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getProjectName(auto.projectId)}</span>
                <span style={{ color: textSecondary }}>{formatSchedule(auto.schedule)}</span>
                <span style={{ color: textSecondary }}>{lastRun}</span>
                <span style={{ color: textSecondary }}>{nextRun}</span>
                <span>
                  {/* Last 5 result dots */}
                  <div style={{ display: "flex", gap: 4 }}>
                    {autoResults.slice(-5).map((r, i) => (
                      <span
                        key={r.id || i}
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (onViewReport && autoResults.length > 0) {
                            onViewReport(auto, autoResults)
                          }
                        }}
                        style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: r.status === "success" ? "#22c55e" : r.status === "failed" ? "#ef4444" : "#94a3b8",
                          cursor: "pointer",
                        }}
                      />
                    ))}
                    {autoResults.length === 0 && <span style={{ color: textSecondary, fontSize: 11 }}>-</span>}
                  </div>
                </span>
                <span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (auto.crew && onViewCrewReport) {
                        onViewCrewReport(auto)
                      } else if (onViewReport && autoResults.length > 0) {
                        onViewReport(auto, autoResults)
                      }
                    }}
                    style={{
                      padding: "3px 8px", borderRadius: 4, border: `1px solid ${border}`,
                      background: "transparent", color: textSecondary, fontSize: 11,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle" }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                    </svg>
                  </button>
                </span>
                <button
                  onClick={e => { e.stopPropagation(); onToggle(auto.id, !auto.enabled) }}
                  aria-label={auto.enabled ? "Disable" : "Enable"}
                  style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                >
                  <div style={{
                    width: 32, height: 16, borderRadius: 8,
                    background: auto.enabled ? "#37ACC0" : (dark ? "rgba(148,163,184,0.2)" : "rgba(148,163,184,0.15)"),
                    position: "relative", transition: "background 0.2s",
                  }}>
                    <div style={{
                      width: 12, height: 12, borderRadius: "50%",
                      background: "#fff", position: "absolute", top: 2,
                      left: auto.enabled ? 18 : 2, transition: "left 0.2s",
                    }} />
                  </div>
                </button>
                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (onDelete) setDeleteTarget(auto)
                  }}
                  title="Delete"
                  style={{
                    background: "transparent", border: "none", padding: 0, cursor: "pointer",
                    color: textSecondary, display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    onMouseEnter={(e) => { (e.currentTarget.parentElement as HTMLElement).style.color = "#ef4444" }}
                    onMouseLeave={(e) => { (e.currentTarget.parentElement as HTMLElement).style.color = textSecondary }}
                  >
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        theme={theme}
        title={`Delete "${deleteTarget?.name}"?`}
        message="This automation will be permanently removed."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          if (deleteTarget && onDelete) onDelete(deleteTarget)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
