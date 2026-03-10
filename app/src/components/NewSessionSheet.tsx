// components/NewSessionSheet.tsx
// Bottom sheet for creating a new session (with resume past agent session support)
import { useState, useEffect } from "react"
import type { Project } from "../types"
import { AGENTS } from "../types"
import { FileBrowser } from "./FileBrowser"
import { useLocale } from "../lib/i18n"
import { getApiBase } from "../lib/storage"
import { useSwipeToDismiss } from "../hooks/useSwipeToDismiss"

interface AgentSession {
  sessionId: string
  slug: string
  firstUserMessage: string
  messageCount: number
  lastModified: number
  sizeBytes: number
}

interface NewSessionSheetProps {
  open: boolean
  projects: Project[]
  selectedProject: string | null
  onClose: () => void
  onLaunch: (projectId: string, agentId: string, resumeSessionId?: string) => void
  onNewProject?: (name: string, cwd: string) => Promise<void>
  onDeleteProject?: (projectId: string) => Promise<void>
}

export function NewSessionSheet({ open, projects, selectedProject, onClose, onLaunch, onNewProject, onDeleteProject }: NewSessionSheetProps) {
  const [projectId, setProjectId] = useState(selectedProject || "")
  const [agentId, setAgentId] = useState("claude")
  const [showAddProject, setShowAddProject] = useState(false)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const { t } = useLocale()
  const [newName, setNewName] = useState("")
  const [newCwd, setNewCwd] = useState("")
  const [showBrowser, setShowBrowser] = useState(false)
  const [creating, setCreating] = useState(false)

  // Resume session state
  const [showResume, setShowResume] = useState(false)
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)

  // Session preview state
  const [previewSession, setPreviewSession] = useState<AgentSession | null>(null)
  const [previewMessages, setPreviewMessages] = useState<{ role: string; text: string; timestamp?: string }[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)

  useEffect(() => {
    if (open && selectedProject) setProjectId(selectedProject)
  }, [open, selectedProject])

  // Reset state when sheet closes
  useEffect(() => {
    if (!open) {
      setShowAddProject(false)
      setNewName("")
      setNewCwd("")
      setShowResume(false)
      setAgentSessions([])
      setPreviewSession(null)
      setPreviewMessages([])
    }
  }, [open])

  // Auto-select first project if none selected
  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0].id)
    }
  }, [projects, projectId])

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

  // Fetch messages when previewing a session
  useEffect(() => {
    if (!previewSession || !projectId) return
    setLoadingPreview(true)
    fetch(`${getApiBase()}/api/agent-sessions/${projectId}/${agentId}/${previewSession.sessionId}/messages`)
      .then(r => r.json())
      .then((data: { role: string; text: string; timestamp?: string }[]) => setPreviewMessages(Array.isArray(data) ? data : []))
      .catch(() => setPreviewMessages([]))
      .finally(() => setLoadingPreview(false))
  }, [previewSession, projectId, agentId])

  const handleCreateProject = async () => {
    if (!newName.trim() || !newCwd.trim() || !onNewProject) return
    setCreating(true)
    try {
      await onNewProject(newName.trim(), newCwd.trim())
      setShowAddProject(false)
      setNewName("")
      setNewCwd("")
    } finally {
      setCreating(false)
    }
  }

  const formatTimeAgo = (ms: number) => {
    const diff = Date.now() - ms
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  }

  const { sheetRef, handlers: swipeHandlers } = useSwipeToDismiss({ onDismiss: onClose })

  // Android back button: close preview first, then resume list, then close sheet
  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (previewSession) {
        setPreviewSession(null)
      } else {
        onClose()
      }
    }
    // Use capture phase so this fires BEFORE MissionControl's bubble-phase handler
    document.addEventListener("app:back", handler, true)
    return () => document.removeEventListener("app:back", handler, true)
  }, [open, previewSession, onClose])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        {...swipeHandlers}
        style={{
        position: "fixed",
        bottom: 0, left: 0, right: 0,
        zIndex: 201,
        backgroundImage: "var(--sheet-bg)",
        backdropFilter: "blur(40px) saturate(1.5)",
        WebkitBackdropFilter: "blur(40px) saturate(1.5)",
        borderTop: "1px solid var(--glass-border)",
        borderRadius: "24px 24px 0 0",
        padding: "20px 20px calc(20px + env(safe-area-inset-bottom, 0px))",
        maxHeight: "80dvh",
        overflowX: "hidden",
        overflowY: "auto",
      }}>
        {/* Decorative glow — matches LaunchPad radial accent */}
        <div style={{
          position: "absolute", top: "-60%", left: "-30%", width: "160%", height: "160%",
          background: "radial-gradient(ellipse at 30% 20%, var(--sheet-glow-1) 0%, transparent 60%)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: "-40%", right: "-20%", width: "120%", height: "120%",
          background: "radial-gradient(ellipse at 70% 80%, var(--sheet-glow-2) 0%, transparent 60%)",
          pointerEvents: "none",
        }} />
        {/* Handle */}
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: "var(--text-secondary)", opacity: 0.3,
          margin: "0 auto 20px",
          position: "relative", zIndex: 1,
        }} />

        <div style={{
          fontSize: 18, fontWeight: 700,
          color: "var(--text-primary)",
          marginBottom: 20,
          position: "relative", zIndex: 1,
        }}>
          {t("newSession.title")}
        </div>

        {/* Project selector */}
        <div style={{ marginBottom: 16, position: "relative", zIndex: 2 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: "var(--text-secondary)",
            textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8,
          }}>
            {t("newSession.project")}
          </div>

          {!showAddProject ? (
            <div style={{ position: "relative" }}>
              {/* Custom select trigger */}
              <button
                onClick={() => setShowProjectPicker(!showProjectPicker)}
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: showProjectPicker
                    ? "1.5px solid var(--accent-primary)"
                    : "1px solid var(--glass-border)",
                  background: "var(--glass-bg)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  color: "var(--text-primary)",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  transition: "all 0.2s",
                }}
              >
                <span>{projects.find(p => p.id === projectId)?.name || t("newSession.project")}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, transform: showProjectPicker ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {/* Dropdown */}
              {showProjectPicker && (
                <div style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  left: 0, right: 0,
                  zIndex: 10,
                  borderRadius: 14,
                  border: "1px solid var(--glass-border)",
                  background: "var(--glass-bg)",
                  backdropFilter: "blur(40px) saturate(1.4)",
                  WebkitBackdropFilter: "blur(40px) saturate(1.4)",
                  boxShadow: "var(--glass-shadow)",
                  overflow: "hidden",
                  maxHeight: 240,
                  overflowY: "auto",
                }}>
                  {projects.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        borderBottom: "1px solid var(--glass-border)",
                        background: p.id === projectId ? "var(--accent-primary-bg)" : "transparent",
                        transition: "background 0.15s",
                      }}
                    >
                      <button
                        onClick={() => { setProjectId(p.id); setShowProjectPicker(false) }}
                        style={{
                          flex: 1,
                          padding: "12px 16px",
                          border: "none",
                          background: "transparent",
                          color: p.id === projectId ? "var(--accent-primary)" : "var(--text-primary)",
                          fontSize: 14,
                          fontWeight: p.id === projectId ? 600 : 400,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        {p.name}
                      </button>
                      {onDeleteProject && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm(`Delete "${p.name}"?`)) {
                              onDeleteProject(p.id).then(() => {
                                if (projectId === p.id && projects.length > 1) {
                                  setProjectId(projects.find(pp => pp.id !== p.id)?.id || "")
                                }
                              })
                            }
                          }}
                          style={{
                            width: 32, height: 32,
                            border: "none",
                            background: "transparent",
                            color: "var(--text-secondary)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            marginRight: 8,
                            borderRadius: 6,
                            opacity: 0.4,
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                  {onNewProject && (
                    <button
                      onClick={() => { setShowAddProject(true); setShowProjectPicker(false) }}
                      style={{
                        width: "100%",
                        padding: "12px 16px",
                        border: "none",
                        background: "transparent",
                        color: "var(--accent-primary)",
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      {t("newSession.newProject")}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("newSession.projectName")}
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: 14,
                  border: "1px solid var(--glass-border)",
                  background: "var(--icon-bg)", color: "var(--text-primary)",
                  fontSize: 14, outline: "none", boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={newCwd}
                  onChange={(e) => setNewCwd(e.target.value)}
                  placeholder={t("newSession.projectPath")}
                  style={{
                    flex: 1, padding: "12px 16px", borderRadius: 14,
                    border: "1px solid var(--glass-border)",
                    background: "var(--icon-bg)", color: "var(--text-primary)",
                    fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                    outline: "none", boxSizing: "border-box",
                  }}
                />
                <button
                  onClick={() => setShowBrowser(true)}
                  style={{
                    width: 44, height: 44, borderRadius: 14, flexShrink: 0,
                    border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)",
                    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                    color: "var(--text-secondary)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={handleCreateProject}
                  disabled={!newName.trim() || !newCwd.trim() || creating}
                  style={{
                    flex: 1, padding: "10px 16px", borderRadius: 12,
                    border: "1px solid var(--glass-border)",
                    background: newName.trim() && newCwd.trim() ? "var(--glass-bg)" : "transparent",
                    color: "var(--text-primary)", fontSize: 13, fontWeight: 600,
                    cursor: newName.trim() && newCwd.trim() ? "pointer" : "default",
                    opacity: newName.trim() && newCwd.trim() ? 1 : 0.4,
                  }}
                >
                  {creating ? t("newSession.creating") : t("newSession.create")}
                </button>
                <button
                  onClick={() => { setShowAddProject(false); setNewName(""); setNewCwd("") }}
                  style={{
                    padding: "10px 16px", borderRadius: 12,
                    border: "1px solid var(--glass-border)",
                    background: "transparent",
                    color: "var(--text-secondary)", fontSize: 13, fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {t("newSession.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Agent list */}
        {!showAddProject && (
          <div style={{ position: "relative", zIndex: 1 }}>
            {/* Resume past session toggle — ABOVE agent list */}
            {supportsResume && projectId && (
              <div style={{ marginBottom: 16 }}>
                <button
                  onClick={() => setShowResume(!showResume)}
                  style={{
                    width: "100%",
                    padding: "10px 16px",
                    borderRadius: 12,
                    border: showResume
                      ? "1px solid var(--accent-primary)"
                      : "1px solid var(--glass-border)",
                    background: showResume ? "var(--accent-primary-bg)" : "transparent",
                    color: showResume ? "var(--accent-primary)" : "var(--text-secondary)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    transition: "all 0.2s",
                  }}
                >
                  {/* History icon */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M12 7v5l4 2" />
                  </svg>
                  {t("newSession.resumePastSession")}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "auto", opacity: 0.5, transform: showResume ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {/* Session list */}
                {showResume && (
                  <div style={{
                    marginTop: 8,
                    borderRadius: 14,
                    border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    overflow: "hidden",
                    maxHeight: 280,
                    overflowY: "auto",
                  }}>
                    {loadingSessions && (
                      <div style={{
                        padding: "20px 16px",
                        textAlign: "center",
                        color: "var(--text-secondary)",
                        fontSize: 13,
                      }}>
                        {t("newSession.loadingSessions")}
                      </div>
                    )}
                    {!loadingSessions && agentSessions.length === 0 && (
                      <div style={{
                        padding: "20px 16px",
                        textAlign: "center",
                        color: "var(--text-secondary)",
                        fontSize: 13,
                      }}>
                        {t("newSession.noSessions")}
                      </div>
                    )}
                    {!loadingSessions && agentSessions.map((session) => (
                      <button
                        key={session.sessionId}
                        onClick={() => setPreviewSession(session)}
                        style={{
                          width: "100%",
                          padding: "12px 16px",
                          border: "none",
                          borderBottom: "1px solid var(--glass-border)",
                          background: "transparent",
                          color: "var(--text-primary)",
                          cursor: "pointer",
                          textAlign: "left",
                          transition: "background 0.15s",
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{
                            fontSize: 13, fontWeight: 600,
                            color: "var(--text-primary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                            marginRight: 8,
                          }}>
                            {session.firstUserMessage || session.slug || session.sessionId.slice(0, 8)}
                          </span>
                          <span style={{
                            fontSize: 11,
                            color: "var(--text-secondary)",
                            flexShrink: 0,
                          }}>
                            {formatTimeAgo(session.lastModified)}
                          </span>
                        </div>
                        {session.slug && session.firstUserMessage && (
                          <div style={{
                            fontSize: 11,
                            color: "var(--text-secondary)",
                            fontFamily: "'JetBrains Mono', monospace",
                          }}>
                            {session.slug}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Agent list */}
            <div style={{
              fontSize: 11, fontWeight: 700, color: "var(--text-secondary)",
              textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10,
            }}>
              {t("newSession.agent")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
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
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "12px 16px",
                      borderRadius: 14,
                      border: selected
                        ? "1.5px solid var(--accent-primary)"
                        : "1px solid var(--glass-border)",
                      background: selected ? "var(--accent-primary-bg)" : "transparent",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: selected ? "var(--accent-primary)" : "var(--text-secondary)",
                      opacity: selected ? 1 : 0.3,
                      transition: "all 0.2s",
                    }} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{agent.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
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
                width: "100%",
                padding: "14px",
                borderRadius: 14,
                border: "1px solid rgba(55,172,192,0.6)",
                background: "#37ACC0",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                boxShadow: "0 4px 20px rgba(55,172,192,0.25), inset 0 1px 0 rgba(255,255,255,0.15)",
                color: "#fff",
                fontSize: 15,
                fontWeight: 700,
                cursor: projectId ? "pointer" : "default",
                opacity: projectId ? 1 : 0.5,
                transition: "all 0.2s",
                position: "relative",
              }}
            >
              {t("newSession.startSession")}
            </button>
          </div>
        )}
      </div>

      {/* Session preview overlay */}
      {previewSession && (
        <>
          <div
            onClick={() => setPreviewSession(null)}
            style={{
              position: "fixed", inset: 0, zIndex: 300,
              background: "rgba(0,0,0,0.5)",
              backdropFilter: "blur(6px)",
              WebkitBackdropFilter: "blur(6px)",
            }}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            style={{
            position: "fixed",
            top: "5dvh", left: 12, right: 12, bottom: "5dvh",
            zIndex: 301,
            backgroundImage: "var(--sheet-bg)",
            backdropFilter: "blur(40px) saturate(1.5)",
            WebkitBackdropFilter: "blur(40px) saturate(1.5)",
            border: "1px solid var(--glass-border)",
            borderRadius: 20,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--glass-border)",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexShrink: 0,
            }}>
              <button
                onClick={() => setPreviewSession(null)}
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  border: "1px solid var(--glass-border)",
                  background: "var(--glass-bg)",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
                </svg>
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14, fontWeight: 600,
                  color: "var(--text-primary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {previewSession.slug || previewSession.firstUserMessage.slice(0, 40) || previewSession.sessionId.slice(0, 8)}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                  {formatTimeAgo(previewSession.lastModified)}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div style={{
              flex: 1,
              overflowY: "auto",
              WebkitOverflowScrolling: "touch",
              overscrollBehavior: "contain",
              padding: "12px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}>
              {loadingPreview && (
                <div style={{ textAlign: "center", color: "var(--text-secondary)", fontSize: 13, padding: 20 }}>
                  Loading...
                </div>
              )}
              {!loadingPreview && previewMessages.length === 0 && (
                <div style={{ textAlign: "center", color: "var(--text-secondary)", fontSize: 13, padding: 20 }}>
                  No messages found
                </div>
              )}
              {!loadingPreview && previewMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    background: msg.role === "user"
                      ? "var(--accent-primary-bg)"
                      : "var(--glass-bg)",
                    border: msg.role === "user"
                      ? "1px solid var(--accent-primary)"
                      : "1px solid var(--glass-border)",
                    alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                  }}
                >
                  <div style={{
                    fontSize: 10, fontWeight: 600,
                    color: msg.role === "user" ? "var(--accent-primary)" : "var(--text-secondary)",
                    marginBottom: 4,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}>
                    {msg.role === "user" ? "You" : "Agent"}
                  </div>
                  <div style={{
                    fontSize: 13,
                    color: "var(--text-primary)",
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
              padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))",
              borderTop: "1px solid var(--glass-border)",
              flexShrink: 0,
            }}>
              <button
                onClick={() => {
                  onLaunch(projectId, agentId, previewSession.sessionId)
                  setPreviewSession(null)
                  onClose()
                }}
                style={{
                  width: "100%",
                  padding: "14px",
                  borderRadius: 14,
                  border: "1px solid rgba(55,172,192,0.6)",
                  background: "#37ACC0",
                  boxShadow: "0 4px 20px rgba(55,172,192,0.25), inset 0 1px 0 rgba(255,255,255,0.15)",
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {t("newSession.resumeThisSession")}
              </button>
            </div>
          </div>
        </>
      )}

      {/* FileBrowser for folder selection */}
      <FileBrowser
        open={showBrowser}
        onClose={() => setShowBrowser(false)}
        onSelectPath={(path) => { setNewCwd(path); setShowBrowser(false) }}
        initialPath={newCwd || undefined}
      />
    </>
  )
}
