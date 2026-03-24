import React, { useState, useMemo, useRef, useEffect, lazy, Suspense } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { AppSession, AgentEvent } from "../../types"
import type { SessionDecisionDigest } from "../../lib/session-summary"
import { getSettings } from "../../lib/storage"

const DesktopTerminalPanel = lazy(() =>
  import("./DesktopTerminalPanel").then(m => ({ default: m.DesktopTerminalPanel }))
)

// --- Type icons (Lucide-style SVG) ---
const typeIcons: Record<string, React.ReactNode> = {
  file_edit: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  file_create: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  ),
  file_delete: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  ),
  command_run: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  test_result: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  ),
  error: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  decision_request: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  user_message: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  info: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  response: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  ),
  session_summary: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  progress_report: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
}

const defaultIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
  </svg>
)

function getTypeColors(dark: boolean): Record<string, string> {
  return dark ? {
    file_edit: "#38bdf8",
    file_create: "#86efac",
    file_delete: "#f87171",
    command_run: "#0ea5e9",
    test_result: "#86efac",
    error: "#f87171",
    decision_request: "#fbbf24",
    info: "#64748b",
    response: "#38bdf8",
    user_message: "#38bdf8",
    session_summary: "#38bdf8",
    progress_report: "#fbbf24",
    install_package: "#0ea5e9",
    token_usage: "#64748b",
  } : {
    file_edit: "#347792",
    file_create: "#2d8a6e",
    file_delete: "#dc2626",
    command_run: "#1e6b87",
    test_result: "#2d8a6e",
    error: "#dc2626",
    decision_request: "#b45309",
    info: "#94a3b8",
    response: "#347792",
    user_message: "#347792",
    session_summary: "#347792",
    progress_report: "#b45309",
    install_package: "#1e6b87",
    token_usage: "#94a3b8",
  }
}

const typeLabels: Record<string, string> = {
  file_edit: "Edit",
  file_create: "Create",
  file_delete: "Delete",
  command_run: "Command",
  test_result: "Test",
  error: "Error",
  decision_request: "Decision",
  info: "Info",
  response: "Response",
  user_message: "User",
  session_summary: "Summary",
  progress_report: "Progress",
  install_package: "Install",
  token_usage: "Tokens",
}

/** Strip ANSI escape codes */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[78]/g, "")
    .replace(/\x1b\([A-Z]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
}

export interface DesktopSessionPanelProps {
  session: AppSession
  digest: SessionDecisionDigest | undefined
  events: AgentEvent[]
  send: (msg: Record<string, unknown>) => boolean
  on: (type: string, handler: (msg: Record<string, unknown>) => void) => (() => void)
  sessionToken: string
  theme: "light" | "dark"
  locale: string
  onKill?: () => void
  onCollapse?: () => void
  index?: number
}

const statusColor: Record<string, string> = {
  blocked: "#FB8184", working: "#37ACC0", idle: "#94a3b8", done: "#BDD1C6",
}
const statusLabel: Record<string, string> = {
  blocked: "Blocked", working: "Working", idle: "Idle", done: "Done",
}

export function DesktopSessionPanel({
  session, digest, events, send, on, sessionToken, theme, locale, onKill, onCollapse, index,
}: DesktopSessionPanelProps) {
  const dark = theme === "dark"
  const [mode, setMode] = useState<"events" | "terminal">("events")
  const eventsEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // Tick every 10s to re-evaluate hasRecentActivity
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 10000)
    return () => clearInterval(t)
  }, [])
  const [autoScroll, setAutoScroll] = useState(true)
  const [planDetail, setPlanDetail] = useState<string | null>(null)

  const digestStatus = digest?.status || "idle"
  // Working indicator: use digest status OR check if recent events are fresh (< 30s)
  const lastEventTime = events.length > 0 ? events[events.length - 1].timestamp : 0
  const hasRecentActivity = Date.now() - lastEventTime < 30000
  const isWorking = digestStatus === "working" || (session.status === "active" && hasRecentActivity && digestStatus !== "done")
  const status = isWorking ? "working" : digestStatus
  const sessionNumber = index != null ? `#${index + 1}` : ""
  const taskName = session.taskTitle || digest?.displayLabel || session.agentId
  const label = sessionNumber ? `${sessionNumber} ${taskName}` : taskName
  const color = statusColor[status] || "#94a3b8"
  const summary = digest?.summary || ""
  const nextAction = digest?.nextAction || ""

  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const borderClr = dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.12)"

  // Request events + auto-resume recoverable sessions on mount
  useEffect(() => {
    send({ type: "request_events", sessionId: session.id, agentId: session.agentId })
    // Auto-resume recoverable sessions — don't require user to click terminal tab
    if (session.status === "recoverable") {
      send({
        type: "attach",
        projectId: session.projectId,
        agentId: session.agentId,
        sessionId: session.id,
        isAgentResume: true,
        settings: getSettings(session.projectId),
      })
    }
    const unsub = on("__ws_open__", () => {
      send({ type: "request_events", sessionId: session.id, agentId: session.agentId })
    })
    return unsub
  }, [send, on, session.id])

  // Filter out noise events + dedup decision_requests + hide waiting decisions (shown in banner)
  const visibleEvents = useMemo(() => {
    const seen = new Set<string>()
    return events
      .filter(e => {
        if (e.type === "token_usage") return false
        // Filter ParseEngine's "X responded" — raw PTY garbage, JSONL watcher has clean version
        if (e.type === "info" && /^(?:Claude|Codex|Cursor|Gemini|Aider) responded/i.test(e.title || "")) return false
        // Filter Claude CLI status spinners (not agent content)
        if (e.type === "info" && /^(?:Thinking|Beboppin|Ionizing|Saut[ée]ing|Crunching|Orchestrating|Brewing|Moonwalking|plan mode|bypass permissions)/i.test(e.title || "")) return false
        if (e.type === "response" && (e.detail || e.title)) return true
        if (!e.title || !e.title.trim()) return false
        if (e.type === "decision_request") {
          const key = `decision:${e.detail || e.title}`
          if (seen.has(key)) return false
          seen.add(key)
          if (e.status === "waiting") return false
        }
        return true
      })
      .sort((a, b) => a.timestamp - b.timestamp)
  }, [events])

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && mode === "events" && eventsEndRef.current) {
      eventsEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [visibleEvents.length, autoScroll, mode])

  // Detect user scroll to disable auto-scroll
  const handleScroll = () => {
    if (!scrollContainerRef.current) return
    const el = scrollContainerRef.current
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px",
        borderBottom: `1px solid ${borderClr}`,
        flexShrink: 0,
      }}>
        {/* Status badge */}
        <span style={{
          fontSize: 11, fontWeight: 600,
          padding: "2px 8px", borderRadius: 4,
          background: `${color}18`, color,
          flexShrink: 0,
        }}>
          {statusLabel[status] || status}
        </span>
        {/* Label */}
        <span style={{
          fontSize: 13, fontWeight: 600,
          color: textPrimary,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          flex: 1,
        }}>
          {label}
        </span>
        {/* Mode toggle — events / terminal */}
        <div style={{
          display: "flex", borderRadius: 5,
          border: `1px solid ${borderClr}`,
          overflow: "hidden",
        }}>
          <button
            onClick={() => setMode("events")}
            title="Events"
            style={{
              width: 28, height: 24, border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: mode === "events"
                ? (dark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)")
                : "transparent",
              color: mode === "events" ? "#37ACC0" : textSecondary,
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {/* List icon */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
          <button
            onClick={() => setMode("terminal")}
            title="Terminal"
            style={{
              width: 28, height: 24, border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: mode === "terminal"
                ? (dark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)")
                : "transparent",
              color: mode === "terminal" ? "#37ACC0" : textSecondary,
              borderLeft: `1px solid ${borderClr}`,
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {/* Terminal icon */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </button>
        </div>
        {/* Kill session (trash icon) */}
        {onKill && (
          <button
            onClick={(e) => { e.stopPropagation(); onKill() }}
            title="Kill session"
            style={{
              width: 24, height: 24, borderRadius: 5, border: "none",
              background: "transparent", cursor: "pointer", color: textSecondary,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#FB8184" }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = textSecondary }}
          >
            {/* Lucide Trash2 */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        )}
        {/* Collapse (X icon — minimizes to card, does NOT kill) */}
        {onCollapse && (
          <button
            onClick={(e) => { e.stopPropagation(); onCollapse() }}
            title="Collapse"
            style={{
              width: 24, height: 24, borderRadius: 5, border: "none",
              background: "transparent", cursor: "pointer", color: textSecondary,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Events mode */}
      {mode === "events" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Summary section */}
          {(summary || nextAction) && (
            <div style={{
              padding: "8px 14px",
              borderBottom: `1px solid ${dark ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.08)"}`,
              background: dark ? "rgba(15,23,42,0.4)" : "rgba(248,250,252,0.6)",
              flexShrink: 0,
            }}>
              {summary && (
                <div style={{
                  fontSize: 12, color: dark ? "#cbd5e1" : "#475569",
                  lineHeight: 1.6,
                }}>
                  {summary}
                </div>
              )}
              {nextAction && (
                <div style={{
                  fontSize: 11, color: textSecondary,
                  marginTop: summary ? 4 : 0,
                }}>
                  Next: {nextAction}
                </div>
              )}
            </div>
          )}

          {/* Event list */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            style={{
              flex: 1, overflow: "auto",
              padding: "8px 12px",
            }}
          >
            {visibleEvents.length === 0 ? (
              <div style={{
                textAlign: "center", padding: "32px 0",
                color: textSecondary, fontSize: 13,
              }}>
                {status === "working" ? (
                  <span style={{ animation: "pulse 2s infinite" }}>Waiting for events...</span>
                ) : "No events yet"}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: "auto" }}>
                {visibleEvents.map((event) => (
                  <DesktopEventRow
                    key={event.id}
                    event={event}
                    theme={theme}
                    onApprove={event.type === "decision_request" && event.status === "waiting" ? () => {
                      send({ type: "session_input", sessionId: session.id, data: "y\n" })
                    } : undefined}
                    onReject={event.type === "decision_request" && event.status === "waiting" ? () => {
                      send({ type: "session_input", sessionId: session.id, data: "n\n" })
                    } : undefined}
                    onViewDetail={event.title === "Plan ready" ? (d) => setPlanDetail(d) : undefined}
                  />
                ))}
                {/* Working indicator at bottom of events */}
                {status === "working" && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "10px 10px",
                    borderRadius: 7,
                    background: dark ? "rgba(55,172,192,0.06)" : "rgba(55,172,192,0.04)",
                    border: `1px solid ${dark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.08)"}`,
                  }}>
                    <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
                      {[0, 1, 2].map(i => (
                        <span key={i} style={{
                          width: 5, height: 5, borderRadius: "50%",
                          background: dark ? "#38bdf8" : "#37ACC0",
                          animation: `desktopPulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                        }} />
                      ))}
                    </span>
                    <span style={{ fontSize: 12, color: textSecondary }}>Agent working...</span>
                    <style>{`@keyframes desktopPulse { 0%,80%,100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }`}</style>
                  </div>
                )}
                <div ref={eventsEndRef} />
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Terminal mode */
        <Suspense fallback={
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: textSecondary, fontSize: 13 }}>
            Loading terminal...
          </div>
        }>
          <DesktopTerminalPanel
            session={session}
            digest={digest}
            send={send}
            on={on}
            sessionToken={sessionToken}
            theme={theme}
            locale={locale}
            embedded
          />
        </Suspense>
      )}

      {/* Markdown styles for desktop event panel */}
      <style>{`
        .desktop-md p { margin: 0 0 6px; }
        .desktop-md p:last-child { margin-bottom: 0; }
        .desktop-md h1, .desktop-md h2, .desktop-md h3 { margin: 8px 0 4px; font-size: 14px; font-weight: 700; }
        .desktop-md h2 { font-size: 13px; }
        .desktop-md h3 { font-size: 12px; }
        .desktop-md ul, .desktop-md ol { margin: 4px 0; padding-left: 20px; }
        .desktop-md li { margin: 2px 0; }
        .desktop-md code {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 11px;
          padding: 1px 5px;
          border-radius: 4px;
          background: ${dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.12)"};
        }
        .desktop-md pre {
          margin: 6px 0;
          padding: 8px 10px;
          border-radius: 6px;
          overflow-x: auto;
          font-size: 11px;
          line-height: 1.5;
          background: ${dark ? "rgba(15,23,42,0.6)" : "rgba(241,245,249,0.8)"};
        }
        .desktop-md pre code { padding: 0; background: transparent; }
        .desktop-md strong { font-weight: 700; }
        .desktop-md hr { border: none; border-top: 1px solid ${dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.15)"}; margin: 8px 0; }
        .desktop-md table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 12px; }
        .desktop-md th, .desktop-md td { padding: 4px 8px; border: 1px solid ${dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.15)"}; text-align: left; }
        .desktop-md th { font-weight: 600; background: ${dark ? "rgba(30,41,59,0.4)" : "rgba(241,245,249,0.6)"}; }
        .desktop-md blockquote { margin: 4px 0; padding: 4px 10px; border-left: 3px solid #37ACC0; opacity: 0.85; }
        .desktop-md a { color: #37ACC0; text-decoration: none; }
      `}</style>
      {/* Plan detail modal */}
      {planDetail && (
        <div onClick={() => setPlanDetail(null)} style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "min(720px, 90vw)", maxHeight: "80vh",
            background: dark ? "#1e293b" : "#fff",
            borderRadius: 12, overflow: "hidden",
            border: `1px solid ${dark ? "rgba(148,163,184,0.15)" : "rgba(148,163,184,0.2)"}`,
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            display: "flex", flexDirection: "column",
          }}>
            <div style={{
              padding: "14px 20px", borderBottom: `1px solid ${dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.12)"}`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: textPrimary }}>Plan</span>
              <button onClick={() => setPlanDetail(null)} style={{
                width: 24, height: 24, borderRadius: 6, border: "none",
                background: "transparent", cursor: "pointer", color: textSecondary,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="desktop-md" style={{
              padding: "16px 20px", overflow: "auto", flex: 1,
              fontSize: 13, color: dark ? "#cbd5e1" : "#334155",
              lineHeight: 1.8, wordBreak: "break-word",
            }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{planDetail}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Compact event row for desktop ---
const DesktopEventRow = React.memo(function DesktopEventRow({
  event, theme, onApprove, onReject, onViewDetail,
}: {
  event: AgentEvent
  theme: "light" | "dark"
  onApprove?: () => void
  onReject?: () => void
  onViewDetail?: (detail: string) => void
}) {
  const dark = theme === "dark"
  const isResponse = event.type === "response" || event.type === "session_summary" || event.type === "progress_report"
  const [expanded, setExpanded] = useState(isResponse)

  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const typeColor = getTypeColors(dark)[event.type] || "#94a3b8"
  const isUser = event.id.startsWith("usr_")
  const isError = event.type === "error" || event.status === "failed"

  const cleanDetail = useMemo(() => {
    if (!event.detail) return ""
    const stripped = stripAnsi(event.detail)
    // Remove duplicate title prefix
    if (event.title) {
      const titleBase = event.title.replace(/\.\.\.$/, "")
      if (stripped.startsWith(titleBase)) {
        return stripped.slice(titleBase.length).trim()
      }
    }
    return stripped
  }, [event.detail, event.title])

  const hasDetail = !!cleanDetail
  const time = new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })

  return (
    <div
      onClick={() => hasDetail && setExpanded(!expanded)}
      style={{
        display: "flex", flexDirection: "column",
        padding: "6px 10px",
        borderRadius: 7,
        borderLeft: isUser ? undefined : undefined,
        background: isUser
          ? (dark ? "#1e6b87" : "#37ACC0")
          : isError
            ? (dark ? "rgba(248,113,113,0.1)" : "rgba(220,38,38,0.06)")
            : (dark ? "rgba(30,41,59,0.3)" : "rgba(241,245,249,0.5)"),
        border: `1px solid ${
          isError ? (dark ? "rgba(248,113,113,0.15)" : "rgba(220,38,38,0.1)")
          : "transparent"
        }`,
        cursor: hasDetail ? "pointer" : "default",
        transition: "background 0.1s",
      }}
    >
      {/* Main row */}
      <div style={{ display: "flex", alignItems: isResponse ? "flex-start" : "center", gap: 8, minHeight: 22 }}>
        {/* Type icon */}
        <span style={{
          color: isUser ? "#fff" : typeColor, flexShrink: 0, display: "flex", alignItems: "center",
          marginTop: isResponse ? 2 : 0,
          animation: event.status === "in_progress" ? "desktopPulse 1.4s ease-in-out infinite" : undefined,
        }}>
          {typeIcons[event.type] || defaultIcon}
        </span>
        {/* Title */}
        {isResponse ? (
          <div className="desktop-md" style={{
            fontSize: 13, color: textPrimary,
            flex: 1, overflow: "hidden",
            lineHeight: 1.7,
            wordBreak: "break-word",
          }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.title}</ReactMarkdown>
          </div>
        ) : (
          <span style={{
            fontSize: 12, color: isUser ? "#fff" : textPrimary,
            flex: 1, overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: expanded ? "normal" : "nowrap",
            wordBreak: expanded ? "break-word" : undefined,
            fontWeight: isUser ? 600 : 400,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            lineHeight: 1.5,
          }}>
            {event.title}
          </span>
        )}
        {/* Type label */}
        <span style={{
          fontSize: 10, fontWeight: 600,
          color: isUser ? "rgba(255,255,255,0.8)" : typeColor,
          opacity: isUser ? 1 : 0.8,
          flexShrink: 0, textTransform: "uppercase",
          letterSpacing: 0.3,
        }}>
          {typeLabels[event.type] || event.type}
        </span>
        {/* Timestamp */}
        <span style={{
          fontSize: 10, color: isUser ? "rgba(255,255,255,0.6)" : textSecondary,
          opacity: isUser ? 1 : 0.6, flexShrink: 0,
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {time}
        </span>
        {/* View full plan button */}
        {event.title === "Plan ready" && cleanDetail && onViewDetail && (
          <button onClick={(e) => { e.stopPropagation(); onViewDetail(cleanDetail) }} style={{
            padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
            border: `1px solid ${dark ? "rgba(55,172,192,0.3)" : "rgba(55,172,192,0.2)"}`,
            background: "transparent", color: dark ? "#38bdf8" : "#37ACC0",
            cursor: "pointer", flexShrink: 0,
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 3, verticalAlign: -1 }}>
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
            </svg>
            Plan
          </button>
        )}
        {/* Expand indicator */}
        {hasDetail && (
          <span style={{
            fontSize: 10, color: textSecondary,
            opacity: 0.4, flexShrink: 0,
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        )}
      </div>
      {/* Approve/Reject buttons for decision_request */}
      {onApprove && (
        <div style={{ display: "flex", gap: 8, marginTop: 6, paddingLeft: 22 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onApprove() }}
            style={{
              padding: "4px 16px", borderRadius: 6, border: "none",
              background: "#BDD1C6", color: "#fff",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Approve
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onReject?.() }}
            style={{
              padding: "4px 16px", borderRadius: 6,
              border: `1px solid ${dark ? "rgba(239,68,68,0.3)" : "rgba(239,68,68,0.2)"}`,
              background: "transparent", color: "#FB8184",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Reject
          </button>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && cleanDetail && (
        isResponse ? (
          <div className="desktop-md" style={{
            marginTop: 6, paddingTop: 6,
            borderTop: `1px solid ${dark ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.08)"}`,
            fontSize: 13, color: dark ? "#cbd5e1" : "#475569",
            lineHeight: 1.7,
            wordBreak: "break-word",
          }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanDetail}</ReactMarkdown>
          </div>
        ) : (
          <div className="desktop-md" style={{
            marginTop: 6, paddingTop: 6,
            borderTop: `1px solid ${dark ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.08)"}`,
            fontSize: 12, color: dark ? "#cbd5e1" : "#475569",
            lineHeight: 1.6,
            wordBreak: "break-word",
            maxHeight: 400,
            overflow: "auto",
          }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanDetail}</ReactMarkdown>
          </div>
        )
      )}
    </div>
  )
})
