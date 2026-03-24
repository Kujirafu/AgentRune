import React, { useState, useRef, useEffect, useCallback } from "react"
import type { Project, AppSession, AgentEvent } from "../../types"
import { AGENTS } from "../../types"
import type { SessionDecisionDigest } from "../../lib/session-summary"
import { routeCommand, type RoutedInstruction } from "../../lib/command-router"

interface StatusDashboardProps {
  projects: Project[]
  sessions: AppSession[]
  allSessions: AppSession[]
  digests: Map<string, SessionDecisionDigest>
  sessionEvents: Map<string, AgentEvent[]>
  theme: "light" | "dark"
  t: (key: string, vars?: Record<string, string>) => string
  onSelectSession: (sessionId: string) => void
  onLaunch: (projectId: string, agentId: string) => void
  onSessionInput: (sessionId: string, data: string) => void
  onKillSession?: (sessionId: string) => void
  selectedProjectId: string | null
  onSelectProject: (projectId: string | null) => void
  onViewPrd?: (projectId: string) => void
}

const STATUS_COLORS: Record<string, string> = {
  blocked: "#ef4444",
  working: "#3b82f6",
  idle: "#94a3b8",
  done: "#22c55e",
}

const _i = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }

function EventIcon({ type }: { type: AgentEvent["type"] }) {
  switch (type) {
    case "file_edit": return <svg {..._i}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    case "file_create": return <svg {..._i}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
    case "command_run": return <svg {..._i}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
    case "test_result": return <svg {..._i}><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
    case "error": return <svg {..._i}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    case "decision_request": return <svg {..._i}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    case "response": return <svg {..._i}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
    case "user_message": return <svg {..._i}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    default: return <svg {..._i}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
  }
}

function eventColor(type: AgentEvent["type"]): string {
  switch (type) {
    case "error": return "#ef4444"
    case "test_result": return "#22c55e"
    case "decision_request": return "#f59e0b"
    case "user_message": return "#37ACC0"
    case "file_edit": case "file_create": return "#a78bfa"
    case "command_run": return "#60a5fa"
    default: return "#94a3b8"
  }
}

export function StatusDashboard({
  projects,
  sessions,
  allSessions,
  digests,
  sessionEvents,
  theme,
  t,
  onSelectSession,
  onLaunch,
  onSessionInput,
  onKillSession,
  selectedProjectId,
  onSelectProject,
}: StatusDashboardProps) {
  const [commandText, setCommandText] = useState("")
  const [selectedAgentId, setSelectedAgentId] = useState("claude")
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())
  const [sessionInputs, setSessionInputs] = useState<Record<string, string>>({})
  const [lastRouted, setLastRouted] = useState<RoutedInstruction[] | null>(null)
  const eventEndRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const dark = theme === "dark"

  const cardBg = dark ? "rgba(30,41,59,0.7)" : "rgba(255,255,255,0.8)"
  const cardBorder = dark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.15)"
  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const inputBg = dark ? "rgba(15,23,42,0.6)" : "rgba(241,245,249,0.8)"
  const accentBg = dark ? "rgba(55,172,192,0.08)" : "rgba(55,172,192,0.04)"

  // Categorize sessions
  const activeSessions: AppSession[] = []
  const completedSessions: AppSession[] = []
  for (const s of sessions) {
    const d = digests.get(s.id)
    if (d?.status === "done") completedSessions.push(s)
    else activeSessions.push(s)
  }

  // Sort: blocked → working → idle
  const statusOrder: Record<string, number> = { blocked: 0, working: 1, idle: 2 }
  activeSessions.sort((a, b) => {
    const da = digests.get(a.id)
    const db = digests.get(b.id)
    return (statusOrder[da?.status || "idle"] ?? 2) - (statusOrder[db?.status || "idle"] ?? 2)
  })

  // Separate expanded vs collapsed active sessions
  const expandedActive = activeSessions.filter(s => expandedSessions.has(s.id))
  const collapsedActive = activeSessions.filter(s => !expandedSessions.has(s.id))

  // ─── Command dispatch ─────────────────────────────────
  const handleCommand = () => {
    if (!commandText.trim()) return
    const routed = routeCommand(commandText.trim(), sessions, digests, sessionEvents)
    for (const r of routed) {
      if (r.sessionId) {
        onSessionInput(r.sessionId, r.instruction + "\n")
      } else if (selectedProjectId) {
        onLaunch(selectedProjectId, selectedAgentId)
      }
    }
    setLastRouted(routed)
    setCommandText("")
    setTimeout(() => setLastRouted(null), 5000)
  }

  const toggleExpand = (sid: string) => {
    setExpandedSessions(prev => {
      const next = new Set(prev)
      if (next.has(sid)) next.delete(sid)
      else next.add(sid)
      return next
    })
  }

  const handleSessionInput = (sid: string) => {
    const text = sessionInputs[sid]?.trim()
    if (!text) return
    onSessionInput(sid, text + "\n")
    setSessionInputs(prev => ({ ...prev, [sid]: "" }))
  }

  // Auto-scroll expanded panels
  useEffect(() => {
    for (const sid of expandedSessions) {
      const el = eventEndRefs.current[sid]
      if (el) el.scrollIntoView({ behavior: "smooth", block: "end" })
    }
  }, [sessionEvents, expandedSessions])

  const getLabel = useCallback((s: AppSession) => {
    const d = digests.get(s.id)
    const agent = AGENTS.find(a => a.id === s.agentId)
    return d?.displayLabel || agent?.name || s.agentId
  }, [digests])

  const getProjectSessionCount = (pid: string) =>
    allSessions.filter(s => s.projectId === pid).length

  // ─── Collapsed row (compact, for regular users) ───────
  const renderCollapsedRow = (s: AppSession) => {
    const d = digests.get(s.id)
    const statusKey = d?.status || "idle"
    const color = STATUS_COLORS[statusKey] || "#94a3b8"
    const routedHere = lastRouted?.find(r => r.sessionId === s.id)

    return (
      <div
        key={s.id}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 14px", borderRadius: 10,
          background: routedHere ? (dark ? "rgba(55,172,192,0.08)" : "rgba(55,172,192,0.04)") : cardBg,
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          border: `1px solid ${routedHere ? "rgba(55,172,192,0.3)" : cardBorder}`,
          borderLeft: `3px solid ${color}`,
          cursor: "default",
          transition: "all 0.15s",
        }}
      >
        {/* Status dot */}
        {d?.status === "working" ? (
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, animation: "pulse 2s infinite", flexShrink: 0 }} />
        ) : (
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
        )}

        {/* Label */}
        <span style={{
          fontSize: 13, fontWeight: 600, color: textPrimary,
          minWidth: 80, maxWidth: 160,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {getLabel(s)}
        </span>

        {/* Summary */}
        <span style={{
          flex: 1, fontSize: 12, color: textSecondary,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {d?.summary || ""}
          {d?.nextAction && d.status === "blocked" && (
            <span style={{ color: "#ef4444", fontWeight: 500 }}> — {d.nextAction}</span>
          )}
        </span>

        {/* Routing feedback */}
        {routedHere && (
          <span style={{ fontSize: 11, color: "#37ACC0", fontWeight: 500, flexShrink: 0 }}>
            {routedHere.matchReason ? routedHere.matchReason : (t("dash.routedNew") || "Sent")}
          </span>
        )}

        {/* Agent badge */}
        <span style={{
          fontSize: 10, color: textSecondary, padding: "2px 6px", borderRadius: 4,
          background: dark ? "rgba(100,116,139,0.15)" : "rgba(100,116,139,0.08)",
          flexShrink: 0,
        }}>
          {AGENTS.find(a => a.id === s.agentId)?.name || s.agentId}
        </span>

        {/* Expand button */}
        <button
          onClick={() => toggleExpand(s.id)}
          title={t("dash.expand") || "Expand panel"}
          style={{
            width: 26, height: 26, borderRadius: 6, border: `1px solid ${cardBorder}`,
            background: "transparent", cursor: "pointer", color: textSecondary,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "color 0.15s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#37ACC0" }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = textSecondary }}
        >
          {/* Maximize icon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        </button>
      </div>
    )
  }

  // ─── Expanded panel (for engineers, side by side) ──────
  const renderExpandedPanel = (s: AppSession) => {
    const d = digests.get(s.id)
    const events = sessionEvents.get(s.id) || []
    const statusKey = d?.status || "idle"
    const color = STATUS_COLORS[statusKey] || "#94a3b8"
    const visibleEvents = events
      .filter(e => e.type !== "token_usage" && e.type !== "progress_report")
      .slice(-30)
    const routedHere = lastRouted?.find(r => r.sessionId === s.id)

    return (
      <div
        key={s.id}
        style={{
          borderRadius: 12,
          background: dark ? "rgba(30,41,59,0.85)" : "rgba(255,255,255,0.92)",
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          border: `1px solid ${routedHere ? "rgba(55,172,192,0.4)" : cardBorder}`,
          borderTop: `3px solid ${color}`,
          display: "flex", flexDirection: "column",
          minHeight: 220, maxHeight: "calc(100vh - 300px)",
          overflow: "hidden",
          transition: "border-color 0.3s",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "8px 12px",
          display: "flex", alignItems: "center", gap: 8,
          borderBottom: `1px solid ${cardBorder}`,
          flexShrink: 0,
        }}>
          {d?.status === "working" ? (
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, animation: "pulse 2s infinite", boxShadow: `0 0 8px ${color}60`, flexShrink: 0 }} />
          ) : (
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: textPrimary, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {getLabel(s)}
          </span>
          <span style={{ fontSize: 10, color: textSecondary, padding: "2px 6px", borderRadius: 4, background: dark ? "rgba(100,116,139,0.15)" : "rgba(100,116,139,0.08)", flexShrink: 0 }}>
            {AGENTS.find(a => a.id === s.agentId)?.name || s.agentId}
          </span>

          {/* Open terminal */}
          <button onClick={() => onSelectSession(s.id)} title={t("dash.openTerminal")}
            style={{ width: 24, height: 24, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#37ACC0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
          </button>

          {/* Kill */}
          {onKillSession && (
            <button onClick={() => onKillSession(s.id)} title={t("dash.kill")}
              style={{ width: 24, height: 24, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: 0.5 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "1" }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "0.5" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}

          {/* Collapse */}
          <button onClick={() => toggleExpand(s.id)} title={t("dash.collapse") || "Collapse"}
            style={{ width: 24, height: 24, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: textSecondary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
        </div>

        {/* Summary */}
        {d?.summary && (
          <div style={{ padding: "5px 12px", fontSize: 11, color: textSecondary, lineHeight: 1.4, borderBottom: `1px solid ${cardBorder}`, flexShrink: 0 }}>
            {d.summary}
            {d.nextAction && d.status === "blocked" && (
              <span style={{ color: "#ef4444", fontWeight: 500, marginLeft: 4 }}>— {d.nextAction}</span>
            )}
          </div>
        )}

        {/* Routing feedback */}
        {routedHere && (
          <div style={{ padding: "3px 12px", fontSize: 10, color: "#37ACC0", fontWeight: 500, background: dark ? "rgba(55,172,192,0.06)" : "rgba(55,172,192,0.04)", flexShrink: 0 }}>
            {routedHere.matchReason ? `${t("dash.routedMatch") || "Matched"}: ${routedHere.matchReason}` : (t("dash.routedNew") || "Instruction sent")}
          </div>
        )}

        {/* Event feed */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 12px", background: dark ? "rgba(0,0,0,0.1)" : "rgba(0,0,0,0.015)" }}>
          {visibleEvents.length === 0 ? (
            <div style={{ fontSize: 11, color: textSecondary, textAlign: "center", padding: 14, opacity: 0.5 }}>
              {t("dash.noEvents") || "No events yet"}
            </div>
          ) : visibleEvents.map((ev, i) => (
            <div key={ev.id || i} style={{ display: "flex", gap: 6, padding: "3px 0", alignItems: "flex-start", fontSize: 11 }}>
              <span style={{ color: eventColor(ev.type), flexShrink: 0, marginTop: 1 }}><EventIcon type={ev.type} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: textPrimary, fontWeight: 500 }}>{ev.title}</span>
                {ev.detail && (
                  <div style={{ color: textSecondary, fontSize: 10, marginTop: 1, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>{ev.detail}</div>
                )}
              </div>
              <span style={{ fontSize: 9, color: textSecondary, opacity: 0.5, flexShrink: 0 }}>
                {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
          <div ref={el => { eventEndRefs.current[s.id] = el }} />
        </div>

        {/* Input bar (pinned bottom) */}
        <div style={{ display: "flex", gap: 6, padding: "7px 10px", borderTop: `1px solid ${cardBorder}`, flexShrink: 0 }}>
          <input
            type="text"
            value={sessionInputs[s.id] || ""}
            onChange={e => setSessionInputs(prev => ({ ...prev, [s.id]: e.target.value }))}
            onKeyDown={e => e.key === "Enter" && handleSessionInput(s.id)}
            placeholder={t("dash.sessionInputPlaceholder") || "Send message..."}
            style={{ flex: 1, padding: "7px 10px", borderRadius: 7, fontSize: 12, border: `1px solid ${cardBorder}`, background: inputBg, color: textPrimary, outline: "none" }}
          />
          <button
            onClick={() => handleSessionInput(s.id)}
            disabled={!sessionInputs[s.id]?.trim()}
            style={{
              padding: "7px 10px", borderRadius: 7, border: "none",
              background: sessionInputs[s.id]?.trim() ? "#37ACC0" : (dark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.15)"),
              color: sessionInputs[s.id]?.trim() ? "#fff" : "#37ACC0",
              cursor: sessionInputs[s.id]?.trim() ? "pointer" : "default",
              fontSize: 11, fontWeight: 600, flexShrink: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ─── Command Bar ─────────────────────────────── */}
      <div style={{
        background: accentBg, borderRadius: 14,
        border: `1px solid ${dark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)"}`,
        padding: "14px 16px",
      }}>
        {/* Project pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          <button onClick={() => onSelectProject(null)}
            style={{
              padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
              border: `1px solid ${!selectedProjectId ? "#37ACC0" : cardBorder}`,
              background: !selectedProjectId ? (dark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)") : "transparent",
              color: !selectedProjectId ? "#37ACC0" : textSecondary,
              cursor: "pointer", transition: "all 0.15s",
            }}>
            {t("dash.allProjects") || "All"}
          </button>
          {projects.map(p => {
            const isActive = selectedProjectId === p.id
            const count = getProjectSessionCount(p.id)
            return (
              <button key={p.id} onClick={() => onSelectProject(p.id)}
                style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${isActive ? "#37ACC0" : cardBorder}`,
                  background: isActive ? (dark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)") : "transparent",
                  color: isActive ? "#37ACC0" : textSecondary,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 5, transition: "all 0.15s",
                }}>
                {p.name}
                {count > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "0 5px", borderRadius: 10,
                    background: isActive ? (dark ? "rgba(55,172,192,0.25)" : "rgba(55,172,192,0.15)") : (dark ? "rgba(148,163,184,0.15)" : "rgba(148,163,184,0.1)"),
                    color: isActive ? "#37ACC0" : textSecondary }}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Input row */}
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          {/* Agent picker (compact dropdown) */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              onClick={() => setShowAgentPicker(!showAgentPicker)}
              style={{
                height: "100%", padding: "0 12px", borderRadius: 10,
                border: `1px solid ${dark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.15)"}`,
                background: dark ? "rgba(15,23,42,0.5)" : "rgba(255,255,255,0.8)",
                backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                color: textPrimary, fontSize: 12, fontWeight: 600,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                transition: "border-color 0.2s",
              }}
            >
              <span style={{ color: "#37ACC0", fontSize: 11 }}>
                {/* Bot icon */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/>
                </svg>
              </span>
              {AGENTS.find(a => a.id === selectedAgentId)?.name || selectedAgentId}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>

            {showAgentPicker && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setShowAgentPicker(false)} />
                <div style={{
                  position: "absolute", bottom: "calc(100% + 6px)", left: 0,
                  minWidth: 200, zIndex: 100, borderRadius: 10, overflow: "hidden",
                  background: dark ? "rgba(30,41,59,0.97)" : "rgba(255,255,255,0.98)",
                  backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                  border: `1px solid ${cardBorder}`,
                  boxShadow: dark ? "0 -8px 32px rgba(0,0,0,0.4)" : "0 -8px 32px rgba(0,0,0,0.12)",
                }}>
                  {AGENTS.filter(a => a.id !== "terminal").map(agent => {
                    const isActive = selectedAgentId === agent.id
                    return (
                      <div
                        key={agent.id}
                        onClick={() => { setSelectedAgentId(agent.id); setShowAgentPicker(false) }}
                        style={{
                          padding: "8px 14px", cursor: "pointer", fontSize: 12,
                          display: "flex", alignItems: "center", gap: 8,
                          background: isActive ? (dark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.06)") : "transparent",
                          color: isActive ? "#37ACC0" : textPrimary,
                          fontWeight: isActive ? 600 : 400,
                          borderBottom: `1px solid ${cardBorder}`,
                        }}
                        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = dark ? "rgba(55,172,192,0.06)" : "rgba(55,172,192,0.03)" }}
                        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent" }}
                      >
                        <span style={{ flex: 1 }}>{agent.name}</span>
                        <span style={{ fontSize: 10, color: textSecondary }}>{agent.description}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          <input type="text" value={commandText}
            onChange={e => setCommandText(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCommand()}
            placeholder={t("dash.commandPlaceholder") || "Describe what you want to do..."}
            style={{
              flex: 1, padding: "14px 18px", borderRadius: 10, fontSize: 14,
              border: `1px solid ${dark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.15)"}`,
              background: dark ? "rgba(15,23,42,0.5)" : "rgba(255,255,255,0.8)",
              backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
              color: textPrimary, outline: "none", transition: "border-color 0.2s",
            }}
            onFocus={e => { (e.target as HTMLInputElement).style.borderColor = "#37ACC0" }}
            onBlur={e => { (e.target as HTMLInputElement).style.borderColor = dark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.15)" }}
          />
          <button onClick={handleCommand} disabled={!commandText.trim()}
            style={{
              padding: "14px 24px", borderRadius: 10, fontSize: 13, fontWeight: 700, border: "none",
              background: commandText.trim() ? "#37ACC0" : (dark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.15)"),
              color: commandText.trim() ? "#fff" : "#37ACC0",
              cursor: commandText.trim() ? "pointer" : "default",
              whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, transition: "background 0.2s",
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            {t("dash.send") || "Send"}
          </button>
        </div>

        {/* Routing feedback */}
        {lastRouted && lastRouted.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: textSecondary, display: "flex", flexDirection: "column", gap: 2 }}>
            {lastRouted.map((r, i) => {
              const target = r.sessionId ? sessions.find(s => s.id === r.sessionId) : null
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span style={{ color: textPrimary, fontWeight: 500 }}>
                    {r.instruction.length > 50 ? r.instruction.slice(0, 50) + "..." : r.instruction}
                  </span>
                  <span style={{ color: textSecondary }}>
                    {target ? `→ ${getLabel(target)}${r.matchReason ? ` (${r.matchReason})` : ""}` : `→ ${t("dash.newSession") || "New Session"}`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── Expanded panels grid (engineer mode) ────── */}
      {expandedActive.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: expandedActive.length === 1 ? "1fr" : expandedActive.length === 2 ? "1fr 1fr" : "repeat(auto-fill, minmax(380px, 1fr))",
          gap: 12,
        }}>
          {expandedActive.map(s => renderExpandedPanel(s))}
        </div>
      )}

      {/* ─── Collapsed session rows (default view) ───── */}
      {collapsedActive.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {collapsedActive.map(s => renderCollapsedRow(s))}
        </div>
      )}

      {/* ─── Completed (compact) ─────────────────────── */}
      {completedSessions.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "0 4px" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: textSecondary, letterSpacing: 0.5, textTransform: "uppercase" }}>
              {t("dash.completedToday") || "Completed"}
            </span>
            <span style={{ fontSize: 11, color: textSecondary }}>({completedSessions.length})</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {completedSessions.map(s => {
              const d = digests.get(s.id)
              return (
                <div key={s.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderRadius: 8,
                  background: dark ? "rgba(30,41,59,0.4)" : "rgba(255,255,255,0.5)", fontSize: 12,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
                  <span style={{ color: textPrimary, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                    {getLabel(s)}
                  </span>
                  {d?.summary && (
                    <span style={{ flex: 1, color: textSecondary, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.summary}</span>
                  )}
                  <button onClick={() => onSelectSession(s.id)}
                    style={{ padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, border: `1px solid ${cardBorder}`, background: "transparent", color: textSecondary, cursor: "pointer", flexShrink: 0 }}>
                    {t("dash.openTerminal") || "Open"}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── Empty state ─────────────────────────────── */}
      {sessions.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: textSecondary, fontSize: 14 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={textSecondary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3, marginBottom: 12 }}>
            <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
          <div>{t("dash.noSessions")}</div>
          <div style={{ fontSize: 12, color: textSecondary, marginTop: 6, opacity: 0.7 }}>
            {t("dash.noSessionsHint") || "Use the command bar above to start a new session"}
          </div>
        </div>
      )}
    </div>
  )
}
