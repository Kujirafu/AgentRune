// components/ProjectOverview.tsx
// Home screen: 2-panel swipe — Panel 0 (Projects) / Panel 1 (Session Dashboard)
import React, { useState, useEffect, useRef } from "react"
import type { Project, AppSession, AgentEvent, ProgressReport } from "../types"
import { AGENTS } from "../types"
import { NewSessionSheet } from "./NewSessionSheet"
import { useLocale } from "../lib/i18n"

const AGENTLORE_DEVICES_URL = "https://agentlore.vercel.app/api/agentrune/devices"

interface CloudDevice {
  id: string
  hostname: string
  localIp: string
  port: number
  status: string
  cloudSessionToken?: string
}

interface ProjectOverviewProps {
  activeSessions: AppSession[]
  sessionEvents: Map<string, AgentEvent[]>
  projects: Project[]
  selectedProject: string | null
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onLaunch: (projectId: string, agentId: string) => void
  onNewProject?: (name: string, cwd: string) => Promise<void>
  onNextStep?: (sessionId: string, step: string) => void
  onKillSession?: (sessionId: string) => void
  onCloudConnect?: (url: string, cloudSessionToken?: string) => void
  theme: "light" | "dark"
  toggleTheme: () => void
}

const STATUS_DOT: Record<string, { color: string; shadow: string; glow: string }> = {
  working: { color: "#3b82f6", shadow: "0 0 8px rgba(59,130,246,0.6)", glow: "rgba(59,130,246,0.35)" },
  idle: { color: "#22c55e", shadow: "0 0 8px rgba(34,197,94,0.6)", glow: "rgba(34,197,94,0.3)" },
  blocked: { color: "#ef4444", shadow: "0 0 8px rgba(239,68,68,0.6)", glow: "rgba(239,68,68,0.35)" },
  done: { color: "#22c55e", shadow: "0 0 8px rgba(34,197,94,0.6)", glow: "rgba(34,197,94,0.3)" },
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
  if (events.length > 0) {
    const last = events[events.length - 1]
    if (last.status === "in_progress") return "working"
  }
  return "idle"
}

function getSessionLabels(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem("agentrune_session_labels") || "{}") } catch { return {} }
}

export function ProjectOverview({
  activeSessions,
  sessionEvents,
  projects,
  selectedProject,
  onSelectSession,
  onNewSession,
  onLaunch,
  onNewProject,
  onNextStep,
  onKillSession,
  onCloudConnect,
  theme,
  toggleTheme,
}: ProjectOverviewProps) {
  const [now, setNow] = useState(Date.now())
  const [showNewSheet, setShowNewSheet] = useState(false)
  const [contextProjectId, setContextProjectId] = useState<string | null>(null)
  const [cloudDevices, setCloudDevices] = useState<CloudDevice[]>([])
  const [showDevices, setShowDevices] = useState(false)
  const { t } = useLocale()
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  // Panel navigation
  const [panel, setPanel] = useState(0)
  const [selectedProjectForSessions, setSelectedProjectForSessions] = useState<string | null>(null)
  const [replySessionId, setReplySessionId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState("")
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchDeltaX = useRef(0)
  const swipingPanel = useRef(false)

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(interval)
  }, [])

  // Fetch cloud devices
  useEffect(() => {
    const token = localStorage.getItem("agentrune_phone_token")
    if (!token) return
    fetch(AGENTLORE_DEVICES_URL, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setCloudDevices(d.data?.devices ?? []))
      .catch(() => {})
  }, [])

  // Group sessions by project
  const sessionsByProject = new Map<string, AppSession[]>()
  for (const s of activeSessions) {
    const list = sessionsByProject.get(s.projectId) || []
    list.push(s)
    sessionsByProject.set(s.projectId, list)
  }

  // Get best status for a project (working > blocked > idle > done)
  const getProjectStatus = (sessions: AppSession[]) => {
    let best = "idle"
    for (const s of sessions) {
      const events = sessionEvents.get(s.id) || []
      const st = getSessionStatus(events)
      if (st === "working") return "working"
      if (st === "blocked") best = "blocked"
      else if (st === "idle" && best !== "blocked") best = "idle"
    }
    return best
  }

  // Get latest progress across all sessions of a project
  const getProjectSummary = (sessions: AppSession[]) => {
    let latest: { progress: ProgressReport; timestamp: number } | null = null
    for (const s of sessions) {
      const events = sessionEvents.get(s.id) || []
      const prog = getLatestProgress(events)
      if (prog) {
        const ts = events[events.length - 1]?.timestamp || 0
        if (!latest || ts > latest.timestamp) {
          latest = { progress: prog, timestamp: ts }
        }
      }
    }
    return latest?.progress || null
  }

  const handleProjectTap = (projectId: string) => {
    const sessions = sessionsByProject.get(projectId) || []
    if (sessions.length === 0) {
      setContextProjectId(projectId)
      setShowNewSheet(true)
    } else {
      setSelectedProjectForSessions(projectId)
      setPanel(1)
    }
  }

  // Swipe handlers for panel navigation
  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea")) return
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchDeltaX.current = 0
    swipingPanel.current = false
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current
    const dy = e.touches[0].clientY - touchStartY.current
    if (!swipingPanel.current && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      swipingPanel.current = true
    }
    if (swipingPanel.current) {
      touchDeltaX.current = dx
    }
  }

  const handleTouchEnd = () => {
    if (!swipingPanel.current) return
    const threshold = 50
    if (touchDeltaX.current < -threshold && panel === 0 && selectedProjectForSessions) {
      setPanel(1)
    } else if (touchDeltaX.current > threshold && panel === 1) {
      setPanel(0)
    }
    swipingPanel.current = false
    touchDeltaX.current = 0
  }

  const handleInlineReply = (sessionId: string) => {
    if (!replyText.trim()) return
    onNextStep?.(sessionId, replyText.trim())
    setReplyText("")
    setReplySessionId(null)
  }

  const labels = getSessionLabels()

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        height: "100dvh",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Sliding panels */}
      <div style={{
        display: "flex",
        width: "200vw",
        height: "100%",
        transform: `translateX(-${panel * 100}vw)`,
        transition: "transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
      }}>

        {/* ========== Panel 0: Projects ========== */}
        <div style={{
          width: "100vw",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-primary)",
          flexShrink: 0,
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
                marginTop: 4,
              }}>
                {projects.length} project{projects.length !== 1 ? "s" : ""} · {activeSessions.length} session{activeSessions.length !== 1 ? "s" : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {/* Connection status button */}
              <button
                onClick={() => setShowDevices(true)}
                style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: "var(--glass-bg)",
                  backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                  border: "1px solid var(--glass-border)",
                  boxShadow: "var(--glass-shadow)",
                  color: "var(--text-primary)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer",
                  position: "relative",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                {(() => {
                  const currentServer = localStorage.getItem("agentrune_server") || ""
                  const isConnected = !!currentServer && !!localStorage.getItem("agentrune_cloud_token")
                  return (
                    <div style={{
                      position: "absolute", bottom: 2, right: 2,
                      width: 8, height: 8, borderRadius: "50%",
                      background: isConnected ? "#22c55e" : "#ef4444",
                      boxShadow: isConnected ? "0 0 4px rgba(34,197,94,0.6)" : "0 0 4px rgba(239,68,68,0.6)",
                      border: "1.5px solid var(--card-bg)",
                    }} />
                  )
                })()}
              </button>
              <button
                onClick={toggleTheme}
                style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: "var(--glass-bg)",
                  backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                  border: "1px solid var(--glass-border)",
                  boxShadow: "var(--glass-shadow)",
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
              <button
                onClick={() => setShowNewSheet(true)}
                style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: "var(--glass-bg)",
                  backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
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

          {/* Project list */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px 16px 40px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}>
            {projects.length === 0 && (
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
                <div style={{ fontSize: 14, fontWeight: 500 }}>No projects</div>
                <button
                  onClick={() => setShowNewSheet(true)}
                  style={{
                    padding: "10px 24px",
                    borderRadius: 12,
                    background: "var(--glass-bg)",
                    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
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

            {projects.map((project) => {
              const sessions = sessionsByProject.get(project.id) || []
              const sessionCount = sessions.length
              const status = sessionCount > 0 ? getProjectStatus(sessions) : "idle"
              const dotStyle = STATUS_DOT[status] || STATUS_DOT.idle
              const summary = sessionCount > 0 ? getProjectSummary(sessions) : null
              const workingCount = sessions.filter(s => {
                const events = sessionEvents.get(s.id) || []
                return getSessionStatus(events) === "working"
              }).length

              return (
                <button
                  key={project.id}
                  onClick={() => {
                    if (longPressFired.current) return
                    handleProjectTap(project.id)
                  }}
                  onTouchStart={() => {
                    longPressFired.current = false
                    longPressTimer.current = setTimeout(() => {
                      longPressFired.current = true
                      setContextProjectId(project.id)
                      if (navigator.vibrate) navigator.vibrate(50)
                    }, 500)
                  }}
                  onTouchEnd={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
                  onTouchMove={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
                  onContextMenu={(e) => { e.preventDefault(); setContextProjectId(project.id) }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "var(--glass-bg)",
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    borderRadius: 20,
                    border: "1px solid var(--glass-border)",
                    boxShadow: `inset 4px 0 14px -4px ${dotStyle.glow}, var(--glass-shadow)`,
                    padding: 16,
                    cursor: "pointer",
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                >
                  {/* Project header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: dotStyle.color,
                      boxShadow: dotStyle.shadow,
                      flexShrink: 0,
                    }} />
                    <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)", flex: 1 }}>
                      {project.name}
                    </div>
                    <div style={{
                      fontSize: 11, color: "var(--text-secondary)",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {sessionCount > 0
                        ? `${sessionCount} session${sessionCount !== 1 ? "s" : ""}${workingCount > 0 ? ` · ${workingCount} working` : ""}`
                        : t("overview.noSessions")
                      }
                    </div>
                  </div>

                  {/* Latest progress summary */}
                  {summary ? (
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, marginLeft: 18 }}>
                      <span style={{
                        display: "inline-block",
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase" as const,
                        letterSpacing: 0.5,
                        color: dotStyle.color,
                        marginRight: 8,
                      }}>
                        {summary.status === "done" ? t("overview.statusDone") : summary.status === "blocked" ? t("overview.statusBlocked") : t("overview.statusWorking")}
                      </span>
                      {summary.summary.length > 120
                        ? summary.summary.slice(0, 120) + "..."
                        : summary.summary}
                    </div>
                  ) : sessionCount === 0 ? (
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", opacity: 0.5, marginLeft: 18 }}>
                      {t("overview.tapToStart")}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", opacity: 0.6, marginLeft: 18 }}>
                      {t("mc.sessionStarted")}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ========== Panel 1: Session Dashboard ========== */}
        <div style={{
          width: "100vw",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-primary)",
          flexShrink: 0,
        }}>
          {/* Panel 1 Header */}
          <div style={{
            padding: "calc(env(safe-area-inset-top, 0px) + 16px) 20px 12px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexShrink: 0,
          }}>
            <button
              onClick={() => setPanel(0)}
              style={{
                width: 36, height: 36, borderRadius: "50%",
                background: "var(--glass-bg)",
                backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                border: "1px solid var(--glass-border)",
                color: "var(--text-primary)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                {projects.find(p => p.id === selectedProjectForSessions)?.name || t("sessions.title")}
              </div>
            </div>
            <button
              onClick={() => {
                setContextProjectId(selectedProjectForSessions)
                setShowNewSheet(true)
              }}
              style={{
                width: 36, height: 36, borderRadius: "50%",
                background: "var(--glass-bg)",
                backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                border: "1px solid var(--glass-border)",
                color: "var(--text-primary)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", fontSize: 20, fontWeight: 300,
              }}
            >
              +
            </button>
          </div>

          {/* Session list */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px 16px 40px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}>
            {(() => {
              const sessions = selectedProjectForSessions
                ? (sessionsByProject.get(selectedProjectForSessions) || [])
                : []

              if (sessions.length === 0) {
                return (
                  <div style={{
                    flex: 1, display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: 16,
                    color: "var(--text-secondary)",
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{t("sessions.noSessions")}</div>
                    <button
                      onClick={() => {
                        setContextProjectId(selectedProjectForSessions)
                        setShowNewSheet(true)
                      }}
                      style={{
                        padding: "10px 24px", borderRadius: 12,
                        background: "var(--glass-bg)",
                        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                        border: "1px solid var(--glass-border)",
                        boxShadow: "var(--glass-shadow)",
                        color: "var(--text-primary)",
                        fontSize: 14, fontWeight: 600, cursor: "pointer",
                      }}
                    >
                      {t("sessions.startFirst")}
                    </button>
                  </div>
                )
              }

              return sessions.map((session) => {
                const events = sessionEvents.get(session.id) || []
                const status = getSessionStatus(events)
                const dotStyle = STATUS_DOT[status] || STATUS_DOT.idle
                const agentDef = AGENTS.find(a => a.id === session.agentId)
                const latestProgress = getLatestProgress(events)
                const label = labels[session.id]
                const isBlocked = status === "blocked"
                const isReplying = replySessionId === session.id
                const isExpanded = expandedSessionId === session.id
                const summaryText = latestProgress?.summary || ""
                const needsExpand = summaryText.length > 80

                return (
                  <div key={session.id}>
                    <button
                      onClick={() => {
                        if (longPressFired.current) return
                        onSelectSession(session.id)
                      }}
                      onTouchStart={() => {
                        longPressFired.current = false
                        longPressTimer.current = setTimeout(() => {
                          longPressFired.current = true
                          if (navigator.vibrate) navigator.vibrate(50)
                        }, 500)
                      }}
                      onTouchEnd={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
                      onTouchMove={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        background: "var(--glass-bg)",
                        backdropFilter: "blur(20px)",
                        WebkitBackdropFilter: "blur(20px)",
                        borderRadius: isReplying ? "20px 20px 0 0" : 20,
                        border: isBlocked
                          ? "1.5px solid rgba(239,68,68,0.3)"
                          : "1px solid var(--glass-border)",
                        boxShadow: `inset 4px 0 14px -4px ${dotStyle.glow}, var(--glass-shadow)`,
                        padding: 16,
                        cursor: "pointer",
                        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                      }}
                    >
                      {/* Session header */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: dotStyle.color,
                          boxShadow: dotStyle.shadow,
                          flexShrink: 0,
                        }} />
                        <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)", flex: 1 }}>
                          {label || agentDef?.name || session.agentId}
                        </div>
                        <div style={{
                          fontSize: 11, color: "var(--text-secondary)",
                          fontFamily: "'JetBrains Mono', monospace",
                        }}>
                          {session.worktreeBranch
                            ? session.worktreeBranch.replace(/^agentrune\//, "")
                            : session.id.slice(0, 8)}
                        </div>
                      </div>

                      {/* Progress summary — expandable */}
                      {latestProgress ? (
                        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, marginLeft: 18 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700,
                            textTransform: "uppercase" as const,
                            letterSpacing: 0.5,
                            color: dotStyle.color,
                            marginRight: 6,
                          }}>
                            {latestProgress.status === "done" ? t("overview.statusDone") : latestProgress.status === "blocked" ? t("overview.statusBlocked") : t("overview.statusWorking")}
                          </span>
                          {isExpanded
                            ? summaryText
                            : (needsExpand ? summaryText.slice(0, 80) + "..." : summaryText)
                          }
                          {needsExpand && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedSessionId(isExpanded ? null : session.id)
                              }}
                              style={{
                                display: "inline",
                                marginLeft: 6,
                                padding: 0,
                                border: "none",
                                background: "none",
                                color: "var(--accent-primary)",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              {isExpanded ? t("sessions.showLess") : t("sessions.showMore")}
                            </button>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: "var(--text-secondary)", opacity: 0.6, marginLeft: 18 }}>
                          {t("mc.sessionStarted")}
                        </div>
                      )}

                      {/* Blocked — show reply button */}
                      {isBlocked && !isReplying && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setReplySessionId(session.id)
                            // Also expand so user can see full question
                            if (needsExpand) setExpandedSessionId(session.id)
                          }}
                          style={{
                            marginTop: 10, marginLeft: 18,
                            padding: "6px 14px", borderRadius: 10,
                            border: "1px solid rgba(239,68,68,0.3)",
                            background: "rgba(239,68,68,0.08)",
                            color: "#ef4444",
                            fontSize: 12, fontWeight: 600, cursor: "pointer",
                          }}
                        >
                          {t("sessions.blocked")}
                        </button>
                      )}
                    </button>

                    {/* Inline reply input */}
                    {isReplying && (
                      <div style={{
                        display: "flex", gap: 8,
                        padding: "10px 16px",
                        background: "var(--glass-bg)",
                        backdropFilter: "blur(20px)",
                        WebkitBackdropFilter: "blur(20px)",
                        borderRadius: "0 0 20px 20px",
                        border: "1.5px solid rgba(239,68,68,0.3)",
                        borderTop: "none",
                      }}>
                        <input
                          autoFocus
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleInlineReply(session.id) }}
                          placeholder={t("sessions.replyPlaceholder")}
                          style={{
                            flex: 1, padding: "8px 12px", borderRadius: 10,
                            border: "1px solid var(--glass-border)",
                            background: "var(--icon-bg)", color: "var(--text-primary)",
                            fontSize: 13, outline: "none", boxSizing: "border-box",
                          }}
                        />
                        <button
                          onClick={() => handleInlineReply(session.id)}
                          disabled={!replyText.trim()}
                          style={{
                            padding: "8px 14px", borderRadius: 10,
                            border: "1px solid var(--glass-border)",
                            background: replyText.trim() ? "var(--glass-bg)" : "transparent",
                            color: "var(--text-primary)",
                            fontSize: 13, fontWeight: 600,
                            cursor: replyText.trim() ? "pointer" : "default",
                            opacity: replyText.trim() ? 1 : 0.4,
                          }}
                        >
                          {t("input.send")}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            })()}
          </div>
        </div>
      </div>

      {/* Page indicator dots */}
      <div style={{
        position: "fixed",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
        left: 0, right: 0,
        display: "flex",
        justifyContent: "center",
        gap: 8,
        zIndex: 10,
        pointerEvents: "none",
      }}>
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              width: panel === i ? 8 : 6,
              height: panel === i ? 8 : 6,
              borderRadius: "50%",
              background: panel === i ? "var(--accent-primary)" : "var(--text-secondary)",
              opacity: panel === i ? 1 : 0.3,
              transition: "all 0.3s",
            }}
          />
        ))}
      </div>

      {/* ========== Overlays (outside sliding panels) ========== */}

      {/* Long-press context menu */}
      {contextProjectId && (() => {
        const proj = projects.find(p => p.id === contextProjectId)
        const sessions = sessionsByProject.get(contextProjectId) || []
        if (!proj) return null

        const actionRow = (opts: { icon: React.ReactNode; label: string; desc: string; color?: string; onClick: () => void }) => (
          <button
            onClick={opts.onClick}
            style={{
              display: "flex", alignItems: "center", gap: 16,
              width: "100%", padding: "14px 20px",
              background: "transparent", border: "none",
              color: opts.color || "var(--text-primary)",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: opts.color || "var(--text-secondary)",
            }}>
              {opts.icon}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{opts.label}</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{opts.desc}</div>
            </div>
          </button>
        )

        return (
          <>
            <div
              onClick={() => setContextProjectId(null)}
              style={{
                position: "fixed", inset: 0, zIndex: 400,
                background: "rgba(0,0,0,0.5)",
                backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
              }}
            />
            <div style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 401,
              background: "var(--card-bg)",
              backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
              borderTop: "1px solid var(--glass-border)",
              borderRadius: "24px 24px 0 0",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
            }}>
              <div style={{
                width: 36, height: 4, borderRadius: 2,
                background: "var(--text-secondary)", opacity: 0.3,
                margin: "12px auto 8px",
              }} />
              <div style={{ padding: "8px 20px 12px", fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                {proj.name}
              </div>

              {actionRow({
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
                label: t("overview.newSession"),
                desc: `Start a new agent session in ${proj.name}`,
                onClick: () => {
                  setContextProjectId(null)
                  setShowNewSheet(true)
                },
              })}

              {sessions.length > 0 && actionRow({
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>,
                label: t("overview.viewPrd"),
                desc: "View task board for this project",
                onClick: () => {
                  setContextProjectId(null)
                  if (sessions.length > 0) onSelectSession(sessions[0].id)
                },
              })}

              {sessions.length > 0 && actionRow({
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>,
                label: t("overview.killAll"),
                desc: `Terminate all ${sessions.length} session${sessions.length !== 1 ? "s" : ""}`,
                color: "#ef4444",
                onClick: () => {
                  sessions.forEach(s => onKillSession?.(s.id))
                  setContextProjectId(null)
                },
              })}

              <button
                onClick={() => setContextProjectId(null)}
                style={{
                  width: "100%", padding: "16px", marginTop: 8,
                  border: "none", borderTop: "1px solid var(--glass-border)",
                  background: "transparent", color: "var(--text-secondary)",
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </>
        )
      })()}

      <NewSessionSheet
        open={showNewSheet}
        projects={projects}
        selectedProject={contextProjectId || selectedProject}
        onClose={() => setShowNewSheet(false)}
        onLaunch={onLaunch}
        onNewProject={onNewProject}
      />

      {/* Device Management Sheet */}
      {showDevices && (
        <>
          <div
            onClick={() => setShowDevices(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 200,
              background: "rgba(0,0,0,0.4)",
              backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
            }}
          />
          <div style={{
            position: "fixed",
            bottom: 0, left: 0, right: 0, zIndex: 201,
            background: "var(--card-bg)",
            backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
            borderTop: "1px solid var(--glass-border)",
            borderRadius: "24px 24px 0 0",
            padding: "20px 20px calc(20px + env(safe-area-inset-bottom, 0px))",
            maxHeight: "70dvh", overflowY: "auto",
          }}>
            <div style={{
              width: 36, height: 4, borderRadius: 2,
              background: "var(--text-secondary)", opacity: 0.3,
              margin: "0 auto 20px",
            }} />
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
              {t("overview.devices")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
              {(() => {
                const srv = localStorage.getItem("agentrune_server")
                return srv ? t("overview.connectedTo").replace("{url}", srv) : t("overview.notConnected")
              })()}
            </div>

            {cloudDevices.length === 0 ? (
              <div style={{
                padding: "32px 16px", textAlign: "center",
                color: "var(--text-secondary)", fontSize: 13,
              }}>
                {t("overview.noDevices")}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {cloudDevices.map((device) => {
                  const url = `http://${device.localIp}:${device.port}`
                  const isOnline = device.status === "ONLINE"
                  const currentServer = localStorage.getItem("agentrune_server") || ""
                  const isConnected = currentServer === url && !!localStorage.getItem("agentrune_cloud_token")
                  return (
                    <button
                      key={device.id}
                      onClick={() => {
                        if (onCloudConnect) {
                          localStorage.setItem("agentrune_server", url)
                          onCloudConnect(url, device.cloudSessionToken)
                        }
                        setShowDevices(false)
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 14,
                        padding: "14px 18px", borderRadius: 18,
                        border: isConnected
                          ? "1.5px solid rgba(74, 222, 128, 0.4)"
                          : "1px solid var(--glass-border)",
                        background: isConnected
                          ? "rgba(74, 222, 128, 0.06)"
                          : "var(--glass-bg)",
                        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                        cursor: "pointer", textAlign: "left",
                        color: "var(--text-primary)",
                        transition: "all 0.2s",
                      }}
                    >
                      <div style={{
                        width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                        background: isConnected ? "#22c55e" : isOnline ? "#fbbf24" : "var(--text-secondary)",
                        boxShadow: isConnected ? "0 0 6px rgba(34,197,94,0.3)" : isOnline ? "0 0 6px #fbbf24" : "none",
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{device.hostname}</div>
                        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                          {device.localIp}:{device.port}
                        </div>
                      </div>
                      <div style={{
                        fontSize: 12,
                        color: isConnected ? "#22c55e" : "var(--text-secondary)",
                        fontWeight: isConnected ? 700 : 500,
                      }}>
                        {isConnected ? t("overview.connected") : isOnline ? t("overview.tapToConnect") : t("overview.offline")}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Manual server input */}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--glass-border)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>
                {t("overview.manualConnection")}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id="manual-server-input"
                  placeholder="http://192.168.1.x:3456"
                  defaultValue={localStorage.getItem("agentrune_server") || ""}
                  style={{
                    flex: 1, padding: "10px 14px", borderRadius: 12,
                    border: "1px solid var(--glass-border)",
                    background: "var(--icon-bg)", color: "var(--text-primary)",
                    fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                    outline: "none", boxSizing: "border-box",
                  }}
                />
                <button
                  onClick={() => {
                    const input = document.getElementById("manual-server-input") as HTMLInputElement
                    const url = input?.value?.trim()
                    if (url && onCloudConnect) {
                      localStorage.setItem("agentrune_server", url)
                      onCloudConnect(url)
                    }
                    setShowDevices(false)
                  }}
                  style={{
                    padding: "10px 16px", borderRadius: 12,
                    border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)", color: "var(--text-primary)",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {t("overview.connect")}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
