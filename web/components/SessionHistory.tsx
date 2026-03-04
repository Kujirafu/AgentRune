// web/components/SessionHistory.tsx
import { useState, useEffect } from "react"

interface SessionSummary {
  id: string
  projectId: string
  agentId: string
  startedAt: number
  endedAt?: number
  status: "active" | "completed" | "killed"
  summary?: {
    filesModified: number
    filesCreated: number
    decisionsAsked: number
    duration: number
  }
}

interface SessionHistoryProps {
  projectId: string
  projectName: string
  apiBase: string
  onBack: () => void
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

const STATUS_COLORS: Record<string, string> = {
  active: "rgba(74,222,128,0.6)",
  completed: "rgba(96,165,250,0.6)",
  killed: "rgba(248,113,113,0.6)",
}

export function SessionHistory({ projectId, projectName, apiBase, onBack }: SessionHistoryProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${apiBase}/api/history/${projectId}`)
      .then(r => r.json())
      .then(data => { setSessions(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [projectId, apiBase])

  return (
    <div style={{
      height: "100dvh",
      display: "flex",
      flexDirection: "column",
      background: "#0f172a",
      color: "#e2e8f0",
    }}>
      {/* Top bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        background: "rgba(255,255,255,0.03)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.6)",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          {"\u2190"}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontWeight: 600,
            fontSize: 14,
            color: "#fff",
          }}>
            {projectName}
            <span style={{ color: "rgba(255,255,255,0.25)", margin: "0 6px" }}>{"\u00B7"}</span>
            <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 400 }}>
              History
            </span>
          </div>
        </div>
      </div>

      {/* Session list */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.3)" }}>
            Loading...
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: "rgba(255,255,255,0.2)" }}>
            <div style={{ fontSize: 28, marginBottom: 16, fontFamily: "monospace", opacity: 0.4 }}>{"[ ]"}</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>No sessions yet</div>
            <div style={{ fontSize: 12, marginTop: 8 }}>Session history will appear here after agent runs</div>
          </div>
        )}

        {sessions.map(session => (
          <div
            key={session.id}
            style={{
              padding: 16,
              borderRadius: 20,
              background: "rgba(255,255,255,0.04)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderLeft: `4px solid ${STATUS_COLORS[session.status] || STATUS_COLORS.completed}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {">_"}
                {" "}{session.agentId}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 4,
                background: session.status === "active" ? "rgba(74,222,128,0.1)" :
                            session.status === "killed" ? "rgba(248,113,113,0.1)" :
                            "rgba(96,165,250,0.1)",
                color: session.status === "active" ? "#4ade80" :
                       session.status === "killed" ? "#f87171" : "#60a5fa",
                fontWeight: 600,
              }}>
                {session.status}
              </span>
            </div>

            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "flex", gap: 12 }}>
              <span>{formatTime(session.startedAt)}</span>
              {session.summary && (
                <>
                  <span>{formatDuration(session.summary.duration)}</span>
                  <span>{session.summary.filesModified + session.summary.filesCreated} files</span>
                  <span>{session.summary.decisionsAsked} decisions</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
