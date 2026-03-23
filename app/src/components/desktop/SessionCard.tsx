import React, { useState, useRef } from "react"
import type { AppSession, AgentEvent } from "../../types"
import { AGENTS } from "../../types"
import type { SessionDecisionDigest } from "../../lib/session-summary"

function getSessionLabels(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem("agentrune_session_labels") || "{}") } catch { return {} }
}
function setSessionLabel(sessionId: string, label: string) {
  const labels = getSessionLabels()
  if (label) labels[sessionId] = label
  else delete labels[sessionId]
  localStorage.setItem("agentrune_session_labels", JSON.stringify(labels))
}

interface SessionCardProps {
  session: AppSession
  digest: SessionDecisionDigest | undefined
  events?: AgentEvent[]
  index: number
  theme: "light" | "dark"
  expanded: boolean
  onToggleExpand: (sessionId: string) => void
  onKill?: (sessionId: string) => void
}

const statusColor: Record<string, string> = {
  blocked: "#FB8184", working: "#37ACC0", idle: "#94a3b8", done: "#BDD1C6",
}

const statusLabel: Record<string, string> = {
  blocked: "Blocked", working: "Working", idle: "Idle", done: "Done",
}

export function SessionCard({ session, digest, events, index, theme, expanded, onToggleExpand, onKill }: SessionCardProps) {
  const dark = theme === "dark"
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const [reportExpanded, setReportExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const status = digest?.status || "idle"
  const color = statusColor[status] || "#94a3b8"
  const agentDef = AGENTS.find(a => a.id === session.agentId)
  const label = digest?.displayLabel || agentDef?.name || session.agentId
  const summary = digest?.summary || ""
  const isDone = status === "done"
  const isBlocked = status === "blocked"

  // Extract completion report from session_summary events
  const sessionReport = (() => {
    if (!events || events.length === 0) return null
    const summaryEvent = [...events].reverse().find(e => e.type === "session_summary")
    if (summaryEvent) return summaryEvent.detail || summaryEvent.title || null
    // Also check progress_report for done sessions
    if (isDone) {
      const progressEvent = [...events].reverse().find(e => e.type === "progress_report" && e.progress?.summary)
      if (progressEvent?.progress?.summary) return progressEvent.progress.summary
    }
    return null
  })()

  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const cardBg = dark ? "rgba(30,41,59,0.6)" : "rgba(255,255,255,0.8)"

  const borderColor = hovered
    ? "rgba(55,172,192,0.3)"
    : isBlocked
      ? "rgba(239,68,68,0.2)"
      : dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.12)"

  return (
    <button
      onClick={() => onToggleExpand(session.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "calc(33.33% - 7px)",
        minWidth: 220,
        borderRadius: 10,
        background: cardBg,
        border: `1px solid ${borderColor}`,
        padding: "12px 14px",
        cursor: "pointer",
        opacity: isDone && !hovered ? 0.6 : 1,
        transition: "border-color 0.15s, opacity 0.15s",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        textAlign: "left",
        fontFamily: "inherit",
        color: "inherit",
      }}
    >
      {/* Top: number + status dot + label + agent badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        {/* Number badge */}
        <span style={{
          width: 20, height: 20, borderRadius: 5,
          background: dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.08)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, color: textSecondary, flexShrink: 0,
        }}>
          {index + 1}
        </span>
        {/* Status dot */}
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: color, flexShrink: 0,
        }} />
        {/* Label — double-click to edit */}
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation()
                setSessionLabel(session.id, editValue.trim())
                setEditing(false)
              }
              if (e.key === "Escape") {
                e.stopPropagation()
                setEditing(false)
              }
            }}
            onBlur={() => {
              setSessionLabel(session.id, editValue.trim())
              setEditing(false)
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            style={{
              fontSize: 13, fontWeight: 600, color: textPrimary,
              flex: 1, minWidth: 0,
              background: dark ? "rgba(30,41,59,0.8)" : "rgba(241,245,249,0.9)",
              border: `1px solid ${dark ? "rgba(55,172,192,0.3)" : "rgba(55,172,192,0.4)"}`,
              borderRadius: 4, padding: "2px 6px",
              outline: "none", fontFamily: "inherit",
            }}
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation()
              setEditValue(label)
              setEditing(true)
            }}
            style={{
              fontSize: 13, fontWeight: 600, color: textPrimary,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
              cursor: "text",
            }}
          >
            {label}
          </span>
        )}
        {/* Agent badge */}
        <span style={{
          fontSize: 11, fontWeight: 500,
          padding: "2px 6px", borderRadius: 4,
          background: dark ? "rgba(55,172,192,0.12)" : "rgba(55,172,192,0.08)",
          color: "#37ACC0",
          flexShrink: 0,
        }}>
          {agentDef?.name || session.agentId}
        </span>
        {/* Kill button (trash icon) — visible on hover */}
        {onKill && hovered && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onKill(session.id) }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onKill(session.id) } }}
            title="Kill session"
            style={{
              width: 18, height: 18, borderRadius: 4, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "#FB8184",
            }}
          >
            {/* Lucide Trash2 */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </span>
        )}
      </div>

      {/* Middle: summary or report */}
      {isDone && sessionReport ? (
        <>
          <div
            onClick={(e) => { e.stopPropagation(); setReportExpanded(!reportExpanded) }}
            style={{
              fontSize: 12, color: dark ? "#cbd5e1" : "#475569", lineHeight: 1.6,
              marginBottom: 8,
              overflow: "hidden",
              maxHeight: reportExpanded ? 300 : 48,
              overflowY: reportExpanded ? "auto" : "hidden",
              transition: "max-height 0.2s",
              cursor: "pointer",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {sessionReport}
          </div>
          {sessionReport.length > 120 && !reportExpanded && (
            <button
              onClick={(e) => { e.stopPropagation(); setReportExpanded(true) }}
              style={{
                fontSize: 11, color: "#37ACC0", fontWeight: 500,
                border: "none", background: "transparent",
                cursor: "pointer", padding: 0, marginBottom: 6,
                fontFamily: "inherit",
              }}
            >
              Show full report
            </button>
          )}
        </>
      ) : summary ? (
        <div style={{
          fontSize: 12, color: textSecondary, lineHeight: 1.5,
          overflow: "hidden", textOverflow: "ellipsis",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          marginBottom: 8,
        } as React.CSSProperties}>
          {summary}
        </div>
      ) : null}

      {/* Bottom: status tag */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          fontSize: 11, fontWeight: 600,
          padding: "2px 8px", borderRadius: 4,
          background: `${color}18`,
          color,
        }}>
          {statusLabel[status] || status}
        </span>
        {digest?.nextAction && (
          <span style={{
            fontSize: 11, color: textSecondary,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {digest.nextAction}
          </span>
        )}
      </div>
    </button>
  )
}
