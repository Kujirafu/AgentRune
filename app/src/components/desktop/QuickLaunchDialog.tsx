import React, { useState, useEffect, useRef } from "react"
import type { Project } from "../../types"
import { AGENTS } from "../../types"
import { getApiBase } from "../../lib/storage"

interface AgentSession {
  sessionId: string
  slug: string
  firstUserMessage: string
  messageCount: number
  lastModified: number
  sizeBytes: number
}

export interface QuickLaunchDialogProps {
  open: boolean
  projects: Project[]
  selectedProjectId: string | null
  theme: "light" | "dark"
  t: (key: string) => string
  onLaunch: (projectId: string, agentId: string, resumeSessionId?: string) => void
  onClose: () => void
}

function formatTimeAgo(ms: number) {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function QuickLaunchDialog({
  open, projects, selectedProjectId, theme, t, onLaunch, onClose,
}: QuickLaunchDialogProps) {
  const dark = theme === "dark"
  const [projectId, setProjectId] = useState(selectedProjectId || projects[0]?.id || "")
  const [agentId, setAgentId] = useState("claude")
  const [showResume, setShowResume] = useState(false)
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  // Preview state
  const [previewSession, setPreviewSession] = useState<AgentSession | null>(null)
  const [previewMessages, setPreviewMessages] = useState<{ role: string; text: string; timestamp?: string }[]>([])
  const [totalMessageCount, setTotalMessageCount] = useState(0)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const previewScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && selectedProjectId) setProjectId(selectedProjectId)
    if (!open) { setShowResume(false); setAgentSessions([]); setPreviewSession(null); setPreviewMessages([]); setTotalMessageCount(0) }
  }, [open, selectedProjectId])

  // Fetch messages when previewing a session
  useEffect(() => {
    if (!previewSession || !projectId) return
    setLoadingPreview(true)
    fetch(`${getApiBase()}/api/agent-sessions/${projectId}/${agentId}/${previewSession.sessionId}/messages`)
      .then(r => r.json())
      .then((data: { role: string; text: string; timestamp?: string }[]) => {
        const all = Array.isArray(data) ? data : []
        setTotalMessageCount(all.length)
        // Only keep last 80 messages so user sees recent conversation
        setPreviewMessages(all.length > 80 ? all.slice(-80) : all)
      })
      .catch(() => setPreviewMessages([]))
      .finally(() => setLoadingPreview(false))
  }, [previewSession, projectId, agentId])

  // Auto-scroll to bottom after messages render
  useEffect(() => {
    if (previewMessages.length > 0 && previewScrollRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          previewScrollRef.current?.scrollTo({ top: previewScrollRef.current.scrollHeight })
        })
      })
    }
  }, [previewMessages])

  // Esc to close (or dismiss preview first)
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (previewSession) { setPreviewSession(null); setPreviewMessages([]) }
        else onClose()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose, previewSession])

  // Agents that support session resume
  const supportsResume = ["claude", "codex", "gemini", "cursor"].includes(agentId)

  // Fetch past sessions when showing resume panel
  useEffect(() => {
    if (!showResume || !projectId || !supportsResume) return
    setLoadingSessions(true)
    fetch(`${getApiBase()}/api/agent-sessions/${projectId}/${agentId}`)
      .then(r => r.json())
      .then((data: AgentSession[]) => setAgentSessions(Array.isArray(data) ? data : []))
      .catch(() => setAgentSessions([]))
      .finally(() => setLoadingSessions(false))
  }, [showResume, projectId, agentId, supportsResume])

  if (!open) return null

  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const glassBg = dark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.92)"
  const glassBorder = dark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.18)"
  const inputBg = dark ? "rgba(30,41,59,0.6)" : "rgba(241,245,249,0.8)"

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      />
      {/* Dialog */}
      <div style={{
        position: "fixed",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 201,
        width: "min(480px, 90vw)",
        maxHeight: "80vh",
        overflowY: "auto",
        borderRadius: 14,
        background: glassBg,
        backdropFilter: "blur(40px) saturate(1.4)",
        WebkitBackdropFilter: "blur(40px) saturate(1.4)",
        border: `1px solid ${glassBorder}`,
        boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
        padding: 20,
        color: textPrimary,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 18 }}>
          {t("newSession.title")}
        </div>

        {/* Project selector */}
        <div style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: textSecondary,
            textTransform: "uppercase", letterSpacing: 1, marginBottom: 8,
          }}>
            {t("newSession.project")}
          </div>
          <select
            value={projectId}
            onChange={(e) => { setProjectId(e.target.value); setShowResume(false) }}
            style={{
              width: "100%", padding: "8px 12px", borderRadius: 8,
              border: `1px solid ${glassBorder}`,
              background: inputBg, color: textPrimary,
              fontSize: 12, fontFamily: "inherit",
              outline: "none", cursor: "pointer",
            }}
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Resume past session toggle */}
        {supportsResume && projectId && (
          <div style={{ marginBottom: 14 }}>
            <button
              onClick={() => setShowResume(!showResume)}
              style={{
                width: "100%", padding: "8px 14px", borderRadius: 8,
                border: showResume
                  ? "1px solid #37ACC0"
                  : `1px solid ${glassBorder}`,
                background: showResume
                  ? (dark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.06)")
                  : "transparent",
                color: showResume ? "#37ACC0" : textSecondary,
                fontSize: 11, fontWeight: 600,
                cursor: "pointer", textAlign: "left",
                display: "flex", alignItems: "center", gap: 8,
                fontFamily: "inherit",
              }}
            >
              {/* History icon */}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M12 7v5l4 2" />
              </svg>
              {t("newSession.resumePastSession")}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "auto", opacity: 0.5, transform: showResume ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* Session list */}
            {showResume && (
              <div style={{
                marginTop: 6, borderRadius: 8,
                border: `1px solid ${glassBorder}`,
                background: inputBg,
                overflow: "hidden",
                maxHeight: 200,
                overflowY: "auto",
              }}>
                {loadingSessions && (
                  <div style={{ padding: "14px 12px", textAlign: "center", color: textSecondary, fontSize: 11 }}>
                    {t("newSession.loadingSessions")}
                  </div>
                )}
                {!loadingSessions && agentSessions.length === 0 && (
                  <div style={{ padding: "14px 12px", textAlign: "center", color: textSecondary, fontSize: 11 }}>
                    {t("newSession.noSessions")}
                  </div>
                )}
                {!loadingSessions && agentSessions.map((session) => (
                  <button
                    key={session.sessionId}
                    onClick={() => setPreviewSession(session)}
                    style={{
                      width: "100%", padding: "10px 12px",
                      border: "none",
                      borderBottom: `1px solid ${glassBorder}`,
                      background: "transparent",
                      color: textPrimary,
                      cursor: "pointer", textAlign: "left",
                      fontFamily: "inherit",
                      display: "flex", flexDirection: "column", gap: 2,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        flex: 1, marginRight: 8,
                      }}>
                        {session.firstUserMessage || session.slug || session.sessionId.slice(0, 8)}
                      </span>
                      <span style={{ fontSize: 10, color: textSecondary, flexShrink: 0 }}>
                        {formatTimeAgo(session.lastModified)}
                      </span>
                    </div>
                    {session.slug && session.firstUserMessage && (
                      <div style={{ fontSize: 10, color: textSecondary, fontFamily: "'JetBrains Mono', monospace" }}>
                        {session.slug}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Agent grid */}
        <div style={{
          fontSize: 10, fontWeight: 700, color: textSecondary,
          textTransform: "uppercase", letterSpacing: 1, marginBottom: 8,
        }}>
          {t("newSession.agent")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {AGENTS.map((agent) => {
            const selected = agent.id === agentId
            return (
              <button
                key={agent.id}
                onClick={() => {
                  if (selected && projectId) {
                    onLaunch(projectId, agent.id)
                    onClose()
                  } else {
                    setAgentId(agent.id)
                    setShowResume(false)
                  }
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", borderRadius: 10,
                  border: selected
                    ? "1.5px solid #37ACC0"
                    : `1px solid ${glassBorder}`,
                  background: selected
                    ? (dark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.06)")
                    : "transparent",
                  cursor: "pointer", textAlign: "left",
                  fontFamily: "inherit", color: "inherit",
                  transition: "all 0.15s",
                }}
              >
                <div style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: selected ? "#37ACC0" : textSecondary,
                  opacity: selected ? 1 : 0.3,
                }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{agent.name}</div>
                  <div style={{ fontSize: 12, color: textSecondary, marginTop: 2 }}>
                    {agent.description}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Launch button */}
        <button
          onClick={() => {
            if (projectId) {
              onLaunch(projectId, agentId)
              onClose()
            }
          }}
          disabled={!projectId}
          style={{
            width: "100%", padding: "12px",
            borderRadius: 10, border: "none",
            background: "#37ACC0", color: "#fff",
            fontSize: 13, fontWeight: 700,
            cursor: projectId ? "pointer" : "default",
            opacity: projectId ? 1 : 0.5,
            boxShadow: "0 4px 16px rgba(55,172,192,0.3)",
          }}
        >
          {t("newSession.startSession")}
        </button>
      </div>

      {/* Session preview overlay */}
      {previewSession && (
        <>
          <div
            onClick={() => { setPreviewSession(null); setPreviewMessages([]) }}
            style={{
              position: "fixed", inset: 0, zIndex: 300,
              background: "rgba(0,0,0,0.5)",
              backdropFilter: "blur(6px)",
              WebkitBackdropFilter: "blur(6px)",
            }}
          />
          <div style={{
            position: "fixed",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 301,
            width: "min(560px, 90vw)",
            maxHeight: "70vh",
            borderRadius: 14,
            background: glassBg,
            backdropFilter: "blur(40px) saturate(1.4)",
            WebkitBackdropFilter: "blur(40px) saturate(1.4)",
            border: `1px solid ${glassBorder}`,
            boxShadow: "0 8px 40px rgba(0,0,0,0.3)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            color: textPrimary,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}>
            {/* Preview header */}
            <div style={{
              padding: "14px 16px",
              borderBottom: `1px solid ${glassBorder}`,
              display: "flex", alignItems: "center", gap: 10,
              flexShrink: 0,
            }}>
              <button
                onClick={() => { setPreviewSession(null); setPreviewMessages([]) }}
                style={{
                  width: 28, height: 28, borderRadius: 6,
                  border: `1px solid ${glassBorder}`,
                  background: inputBg,
                  color: textSecondary,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
                </svg>
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {previewSession.slug || previewSession.firstUserMessage?.slice(0, 50) || previewSession.sessionId.slice(0, 8)}
                </div>
                <div style={{ fontSize: 11, color: textSecondary, marginTop: 1 }}>
                  {formatTimeAgo(previewSession.lastModified)} · {totalMessageCount > 0
                    ? (totalMessageCount > previewMessages.length
                      ? `${previewMessages.length} / ${totalMessageCount} messages`
                      : `${totalMessageCount} messages`)
                    : `${previewSession.messageCount} messages`}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div
              ref={previewScrollRef}
              style={{
              flex: 1, overflowY: "auto",
              padding: "12px 16px",
              display: "flex", flexDirection: "column", gap: 10,
            }}>
              {loadingPreview && (
                <div style={{ textAlign: "center", color: textSecondary, fontSize: 12, padding: 20 }}>
                  Loading...
                </div>
              )}
              {!loadingPreview && previewMessages.length === 0 && (
                <div style={{ textAlign: "center", color: textSecondary, fontSize: 12, padding: 20 }}>
                  No messages found
                </div>
              )}
              {!loadingPreview && previewMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    padding: "8px 12px", borderRadius: 8,
                    background: msg.role === "user"
                      ? (dark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.06)")
                      : inputBg,
                    border: msg.role === "user"
                      ? "1px solid rgba(55,172,192,0.2)"
                      : `1px solid ${glassBorder}`,
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                  }}
                >
                  <div style={{
                    fontSize: 10, fontWeight: 600,
                    color: msg.role === "user" ? "#37ACC0" : textSecondary,
                    marginBottom: 3,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <span style={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {msg.role === "user" ? "You" : "Agent"}
                    </span>
                    {msg.timestamp && (
                      <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 9 }}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 12, color: textPrimary,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Resume button */}
            <div style={{
              padding: "12px 16px",
              borderTop: `1px solid ${glassBorder}`,
              flexShrink: 0,
            }}>
              <button
                onClick={() => {
                  onLaunch(projectId, agentId, previewSession.sessionId)
                  setPreviewSession(null)
                  onClose()
                }}
                style={{
                  width: "100%", padding: "12px",
                  borderRadius: 10, border: "none",
                  background: "#37ACC0", color: "#fff",
                  fontSize: 13, fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 4px 16px rgba(55,172,192,0.3)",
                }}
              >
                {t("newSession.resumeThisSession")}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
