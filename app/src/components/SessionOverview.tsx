// components/SessionOverview.tsx
// Home screen showing all active sessions with their latest progress
import { useState, useEffect } from "react"
import type { Project, AppSession, AgentEvent, ProgressReport } from "../types"
import { AGENTS } from "../types"
import { ProgressCard } from "./ProgressCard"
import { NewSessionSheet } from "./NewSessionSheet"

interface SessionOverviewProps {
  activeSessions: AppSession[]
  sessionEvents: Map<string, AgentEvent[]>
  projects: Project[]
  selectedProject: string | null
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onLaunch: (projectId: string, agentId: string) => void
  onNextStep?: (sessionId: string, step: string) => void
  theme: "light" | "dark"
  toggleTheme: () => void
}

const STATUS_DOT: Record<string, { color: string; shadow: string }> = {
  working: { color: "#60a5fa", shadow: "0 0 8px rgba(96,165,250,0.5)" },
  idle: { color: "#4ade80", shadow: "0 0 8px rgba(74,222,128,0.5)" },
  blocked: { color: "#f87171", shadow: "0 0 8px rgba(248,113,113,0.5)" },
  done: { color: "#4ade80", shadow: "0 0 8px rgba(74,222,128,0.5)" },
}

function getLatestProgress(events: AgentEvent[]): ProgressReport | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].progress) return events[i].progress!
  }
  return null
}

function getSessionStatus(events: AgentEvent[]): string {
  const prog = getLatestProgress(events)
  if (prog?.status === "blocked") return "blocked"
  if (prog?.status === "done") return "done"
  // Check if agent is actively working (recent non-progress events)
  if (events.length > 0) {
    const last = events[events.length - 1]
    if (last.status === "in_progress") return "working"
  }
  return "idle"
}

export function SessionOverview({
  activeSessions,
  sessionEvents,
  projects,
  selectedProject,
  onSelectSession,
  onNewSession,
  onLaunch,
  onNextStep,
  theme,
  toggleTheme,
}: SessionOverviewProps) {
  const [now, setNow] = useState(Date.now())
  const [showNewSheet, setShowNewSheet] = useState(false)

  // Update relative timestamps every 30s
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{
      height: "100dvh",
      display: "flex",
      flexDirection: "column",
      background: "var(--bg-primary)",
    }}>
      {/* Header */}
      <div style={{
        padding: "calc(env(safe-area-inset-top, 0px) + 16px) 20px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div>
          <div style={{
            fontSize: 28,
            fontWeight: 700,
            color: "var(--text-primary)",
            letterSpacing: "-0.5px",
          }}>
            AgentRune
          </div>
          <div style={{
            fontSize: 12,
            color: "var(--text-secondary)",
            fontWeight: 500,
            marginTop: 2,
          }}>
            {activeSessions.length} active session{activeSessions.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            style={{
              width: 40, height: 40, borderRadius: "50%",
              background: "var(--glass-bg)",
              border: "1px solid var(--glass-border)",
              color: "var(--text-primary)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            {theme === "light" ? (
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
          {/* New session */}
          <button
            onClick={() => setShowNewSheet(true)}
            style={{
              width: 40, height: 40, borderRadius: "50%",
              background: "var(--glass-bg)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid var(--glass-border)",
              boxShadow: "var(--glass-shadow)",
              color: "var(--text-primary)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
              fontSize: 20,
              fontWeight: 300,
            }}
          >
            +
          </button>
        </div>
      </div>

      {/* Session list */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "8px 16px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}>
        {activeSessions.length === 0 && (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            color: "var(--text-secondary)",
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 500 }}>No active sessions</div>
            <button
              onClick={() => setShowNewSheet(true)}
              style={{
                padding: "10px 24px",
                borderRadius: 12,
                background: "var(--glass-bg)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                border: "1px solid var(--glass-border)",
                boxShadow: "var(--glass-shadow)",
                color: "var(--text-primary)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Start a new session
            </button>
          </div>
        )}

        {activeSessions.map((session) => {
          const events = sessionEvents.get(session.id) || []
          const status = getSessionStatus(events)
          const dotStyle = STATUS_DOT[status] || STATUS_DOT.idle
          const agentDef = AGENTS.find((a) => a.id === session.agentId)
          const latestProgress = getLatestProgress(events)
          const lastEvent = events.length > 0 ? events[events.length - 1] : null
          const labels = getSessionLabels()
          const label = labels[session.id]

          return (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "var(--glass-bg)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                borderRadius: 20,
                border: status === "blocked"
                  ? "1px solid rgba(248,113,113,0.2)"
                  : "1px solid var(--glass-border)",
                boxShadow: `inset 3px 0 12px -4px ${dotStyle.color}40, var(--glass-shadow)`,
                padding: 16,
                cursor: "pointer",
                transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {/* Session header: status dot + agent name + session id */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: dotStyle.color,
                  boxShadow: dotStyle.shadow,
                  flexShrink: 0,
                }} />
                <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)", flex: 1 }}>
                  {label || agentDef?.name || session.agentId}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "'JetBrains Mono', monospace" }}>
                  {session.id.slice(0, 8)}
                </div>
              </div>

              {/* Latest progress summary or last event */}
              {latestProgress ? (
                <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  <span style={{
                    display: "inline-block",
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: dotStyle.color,
                    marginRight: 8,
                  }}>
                    {latestProgress.status === "done" ? "Done" : latestProgress.status === "blocked" ? "Blocked" : "Working"}
                  </span>
                  {latestProgress.summary.length > 120
                    ? latestProgress.summary.slice(0, 120) + "..."
                    : latestProgress.summary}
                </div>
              ) : lastEvent ? (
                <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  {lastEvent.title}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-secondary)", opacity: 0.6 }}>
                  Session started
                </div>
              )}

              {/* Blocked quick-reply: show first nextStep as tappable action */}
              {status === "blocked" && latestProgress?.nextSteps?.[0] && (
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    onNextStep?.(session.id, latestProgress.nextSteps[0])
                  }}
                  style={{
                    marginTop: 10,
                    padding: "8px 12px",
                    borderRadius: 10,
                    background: "rgba(248,113,113,0.08)",
                    border: "1px solid rgba(248,113,113,0.2)",
                    color: "#f87171",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {latestProgress.nextSteps[0]}
                </div>
              )}
            </button>
          )
        })}
      </div>

      <NewSessionSheet
        open={showNewSheet}
        projects={projects}
        selectedProject={selectedProject}
        onClose={() => setShowNewSheet(false)}
        onLaunch={onLaunch}
      />
    </div>
  )
}

// Re-use session labels from MissionControl
function getSessionLabels(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem("agentrune_session_labels") || "{}") } catch { return {} }
}
