import React, { useState, useCallback, useMemo } from "react"
import { useLocale } from "../../lib/i18n/index.js"
import type { Project, AppSession, AgentEvent } from "../../types"
import { buildProjectDecisionSummary, type SessionDecisionDigest } from "../../lib/session-summary"
import type { PhaseGateRequest, PendingReauthRequest, AutomationConfig, AutomationResult, PhaseGateAction } from "../../data/automation-types"
import { Sidebar } from "./Sidebar"
import { SessionCard } from "./SessionCard"
import { DesktopSessionPanel } from "./DesktopSessionPanel"
import { DesktopInputBar } from "./DesktopInputBar"
import { ApprovalBar } from "./ApprovalBar"
import { NewProjectDialog } from "./NewProjectDialog"
import { SchedulesTool } from "./tools/SchedulesTool"
import { PrdTool } from "./tools/PrdTool"
import { WorkflowsTool } from "./tools/WorkflowsTool"
import { GitTool } from "./tools/GitTool"
import { SettingsTool } from "./tools/SettingsTool"
import type { AutomationTemplate } from "../../data/automation-types"
import { getSettings, getAutoSaveKeysEnabled, getAutoSaveKeysPath } from "../../lib/storage"

export type ToolView = "sessions" | "prd" | "git" | "schedules" | "workflows" | "settings"

export interface CommandCenterProps {
  projects: Project[]
  activeSessions: AppSession[]
  sessionEvents: Map<string, AgentEvent[]>
  digests: Map<string, SessionDecisionDigest>
  send: (msg: Record<string, unknown>) => boolean
  on: (type: string, handler: (msg: Record<string, unknown>) => void) => (() => void)
  sessionToken: string
  wsConnected: boolean
  apiBase: string
  theme: "light" | "dark"
  toggleTheme: () => void
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onLaunch: (projectId: string, agentId: string, resumeSessionId?: string) => void
  onOpenBuilder: () => void
  onOpenChainEditor?: (slug: string) => void
  expandSessionId?: string | null
  pendingPhaseGate: PhaseGateRequest | null
  pendingReauthQueue: PendingReauthRequest[]
  onPhaseGateRespond: (action: PhaseGateAction, instructions?: string, reviewNote?: string) => void
  onReauth: (automationId: string) => void
  automations: AutomationConfig[]
  autoResults: Map<string, AutomationResult[]>
  autoLoading: boolean
  autoToggle: (id: string, enabled: boolean) => Promise<void>
  autoRefresh: () => void
  onEditAutomation: (auto: AutomationConfig) => void
  onNewAutomation: () => void
  onDeleteAutomation?: (auto: AutomationConfig) => Promise<void>
  onFireCrew: () => void
  onCreateFromTemplate?: (template: AutomationTemplate) => void
  onViewReport?: (auto: AutomationConfig, results: AutomationResult[]) => void
  onViewCrewReport?: (auto: AutomationConfig) => void
  selectedProjectId: string | null
  onSelectProject: (id: string | null) => void
  onKillSession: (sessionId: string) => Promise<void>
  onNewProject: (name: string, cwd: string) => Promise<void>
  onDeleteProject: (projectId: string) => Promise<void>
  t: (key: string) => string
  locale: string
  /** Inline panel content — replaces main view when present (e.g. automation editor) */
  inlinePanel?: React.ReactNode
  onCloseInlinePanel?: () => void
}

export function CommandCenter(props: CommandCenterProps) {
  const {
    theme, wsConnected, toggleTheme,
    projects, activeSessions, digests,
    automations, selectedProjectId, onSelectProject,
    send, on, sessionToken, onNewSession,
    pendingPhaseGate, pendingReauthQueue,
    onPhaseGateRespond, onReauth,
    onEditAutomation, onNewAutomation, onFireCrew,
    onKillSession, onNewProject, onDeleteProject,
    t, locale,
  } = props
  const dark = theme === "dark"
  const electron = !!(window as any).electronAPI

  const [activeView, setActiveView] = useState<ToolView>("sessions")
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())
  const [targetSessionId, setTargetSessionId] = useState<string | null>(null)
  const [showNewProject, setShowNewProject] = useState(false)

  // Track locally resolved permission IDs (cleared when server updates event status)
  const [resolvedPermIds, setResolvedPermIds] = useState<Set<string>>(new Set())

  // Find ALL pending permission requests across all sessions
  const pendingPermissions = useMemo(() => {
    const results: { event: AgentEvent; sessionId: string; sessionIdx: number }[] = []
    const seen = new Set<string>()
    for (const [sid, events] of props.sessionEvents) {
      const idx = activeSessions.findIndex(s => s.id === sid)
      // Skip sessions that are idle/done — they can't have real pending permissions
      const d = digests.get(sid)
      if (d && (d.status === "idle" || d.status === "done")) continue
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]
        if (e.type === "decision_request" && e.status === "waiting" && !resolvedPermIds.has(e.id)) {
          const key = `${sid}:${e.detail || e.title}`
          if (seen.has(key)) continue
          seen.add(key)
          results.push({ event: e, sessionId: sid, sessionIdx: idx + 1 })
        }
      }
    }
    return results
  }, [props.sessionEvents, activeSessions, resolvedPermIds])

  // Track permission history (last 10 resolved)
  const permissionHistory = useMemo(() => {
    const results: { event: AgentEvent; sessionId: string; sessionIdx: number }[] = []
    for (const [sid, events] of props.sessionEvents) {
      const idx = activeSessions.findIndex(s => s.id === sid)
      for (const e of events) {
        if (e.type === "decision_request" && e.status === "completed") {
          results.push({ event: e, sessionId: sid, sessionIdx: idx + 1 })
        }
      }
    }
    return results.slice(-10)
  }, [props.sessionEvents, activeSessions])

  // Handle send from input bar (with optional images)
  const handleSend = useCallback((text: string, images?: string[]) => {
    const resolveTarget = () => {
      // Explicit target always wins
      if (targetSessionId) return targetSessionId
      const confirmed = activeSessions.filter(s =>
        s.status !== "recoverable" && digests.has(s.id)
      )
      if (confirmed.length === 0) return null
      // Prefer idle session — agent is free to take new work
      const idleSession = confirmed.find(s => digests.get(s.id)?.status === "idle")
      if (idleSession) return idleSession.id
      // All sessions busy → create new session (multi-session dispatch)
      return null
    }
    const sid = resolveTarget()
    console.log("[CMD] handleSend:", { sid, targetSessionId, activeCount: activeSessions.length, selectedProjectId, textLen: text.length })
    if (!sid) {
      const pid = selectedProjectId || projects[0]?.id
      console.log("[CMD] No session, creating new. pid:", pid)
      if (pid) {
        const newId = `${pid}_${Date.now()}`
        const userSettings = getSettings(pid)
        const ok = send({
          type: "attach",
          projectId: pid,
          agentId: "claude",
          sessionId: newId,
          settings: userSettings,
          autoSaveKeys: getAutoSaveKeysEnabled(),
          autoSaveKeysPath: getAutoSaveKeysPath(),
          initialCommand: text,
        })
        console.log("[CMD] attach sent:", ok, "newId:", newId)
      }
      return
    }
    // Send text and Enter separately — match MissionControl's delay pattern
    const isSlash = text.startsWith("/")
    const msg: Record<string, unknown> = { type: "session_input", sessionId: sid, data: text }
    if (images && images.length > 0) msg.images = images
    send(msg)
    setTimeout(() => send({ type: "session_input", sessionId: sid, data: "\r" }), isSlash ? 300 : 500)
    // Store user message event (like MissionControl does)
    const userEvent = {
      id: `usr_${Date.now()}`,
      timestamp: Date.now(),
      type: "user_message" as const,
      status: "completed" as const,
      title: text.length > 60 ? text.slice(0, 60) + "..." : text,
      detail: text.length > 60 ? text : undefined,
    }
    send({ type: "store_event", sessionId: sid, event: userEvent })
  }, [targetSessionId, send, activeSessions, digests, selectedProjectId, projects, props.onLaunch])

  // Handle raw send (e.g. interrupt \x03) to specific session
  const handleRawSend = useCallback((sessionId: string, data: string) => {
    send({ type: "session_input", sessionId, data })
  }, [send])

  // Settings change handler — match MissionControl's handleSettingsChange pattern
  const [bypassConfirmPending, setBypassConfirmPending] = useState(false)
  const pendingBypassRef = React.useRef<{ projectId: string; agentId: string } | null>(null)

  const handleSettingsChange = useCallback((prev: import("../../types").ProjectSettings, next: import("../../types").ProjectSettings) => {
    // Find the active session to send commands to
    const targetSid = targetSessionId || activeSessions.find(s => s.status !== "recoverable")?.id
    if (!targetSid) return

    const session = activeSessions.find(s => s.id === targetSid)
    if (!session) return

    // Bypass toggle → kill + relaunch (like MissionControl)
    if (next.bypass !== prev.bypass) {
      if (next.bypass) {
        // Enable bypass → show confirmation
        pendingBypassRef.current = { projectId: session.projectId, agentId: session.agentId }
        setBypassConfirmPending(true)
      } else {
        // Disable bypass → immediate restart
        onKillSession(targetSid).then(() => {
          setTimeout(() => props.onLaunch(session.projectId, session.agentId), 500)
        })
      }
      return
    }

    // Sandbox level change → restart all sessions with new settings
    if (next.sandboxLevel !== prev.sandboxLevel || next.requirePlanReview !== prev.requirePlanReview || next.requireMergeApproval !== prev.requireMergeApproval) {
      // Restart all non-recoverable sessions with new sandbox
      const toRestart = activeSessions.filter(s => s.status !== "recoverable")
      for (const s of toRestart) {
        onKillSession(s.id).then(() => {
          setTimeout(() => props.onLaunch(s.projectId, s.agentId), 500)
        })
      }
      return
    }

    // Model switch → /model command
    if (next.model !== prev.model) {
      send({ type: "session_input", sessionId: targetSid, data: "\x15" }) // Ctrl+U clear
      setTimeout(() => {
        send({ type: "session_input", sessionId: targetSid, data: `/model ${next.model}` })
        setTimeout(() => send({ type: "session_input", sessionId: targetSid, data: "\r" }), 50)
      }, 100)
    }

    // Plan mode → Shift+Tab
    if (next.planMode !== prev.planMode) {
      send({ type: "session_input", sessionId: targetSid, data: "\x1b[Z" })
    }

    // Fast mode → /fast
    if (next.fastMode !== prev.fastMode) {
      send({ type: "session_input", sessionId: targetSid, data: "\x15" })
      setTimeout(() => {
        send({ type: "session_input", sessionId: targetSid, data: "/fast" })
        setTimeout(() => send({ type: "session_input", sessionId: targetSid, data: "\r" }), 50)
      }, 100)
    }
  }, [targetSessionId, activeSessions, send, onKillSession, props.onLaunch])

  const confirmBypass = useCallback(() => {
    setBypassConfirmPending(false)
    const info = pendingBypassRef.current
    if (!info) return
    const targetSid = targetSessionId || activeSessions.find(s => s.id && s.projectId === info.projectId)?.id
    if (targetSid) {
      onKillSession(targetSid).then(() => {
        setTimeout(() => props.onLaunch(info.projectId, info.agentId), 500)
      })
    }
    pendingBypassRef.current = null
  }, [targetSessionId, activeSessions, onKillSession, props.onLaunch])

  // Esc to collapse all expanded sessions
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && expandedSessions.size > 0) {
        setExpandedSessions(new Set())
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [expandedSessions])

  const handleExpandSession = useCallback((sessionId: string) => {
    setExpandedSessions(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }, [])

  // Direct expand: when expandSessionId prop changes, expand that session
  React.useEffect(() => {
    if (props.expandSessionId) {
      setActiveView("sessions")
      setExpandedSessions(new Set([props.expandSessionId]))
      setTargetSessionId(props.expandSessionId)
    }
  }, [props.expandSessionId])

  // Listen for server "attached" to auto-expand new sessions created via QuickLaunchDialog
  React.useEffect(() => {
    return props.on("attached", (msg) => {
      const sid = msg.sessionId as string
      const resumed = msg.resumed as boolean
      if (sid && !resumed) {
        // New session attached — expand it
        setActiveView("sessions")
        setExpandedSessions(new Set([sid]))
        setTargetSessionId(sid)
      }
    })
  }, [props.on])

  // Sort sessions: blocked -> working -> idle -> done
  const sortedSessions = useMemo(() => {
    const order: Record<string, number> = { blocked: 0, working: 1, idle: 2, done: 3 }
    return [...activeSessions].sort((a, b) => {
      const sa = order[digests.get(a.id)?.status || "idle"] ?? 2
      const sb = order[digests.get(b.id)?.status || "idle"] ?? 2
      return sa - sb
    })
  }, [activeSessions, digests])

  const bg = dark ? "#0f172a" : "#f8fafc"
  const sidebarBg = dark ? "rgba(15,23,42,0.95)" : "rgba(255,255,255,0.95)"
  const sidebarBorder = dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)"
  const inputBorder = dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)"
  const textSecondary = dark ? "#94a3b8" : "#64748b"

  return (
    <div style={{
      display: "flex",
      height: "100%",
      background: bg,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: dark ? "#e2e8f0" : "#1e293b",
      overflow: "hidden",
    }}>
      {/* Sidebar */}
      <div style={{
        width: 240,
        background: sidebarBg,
        borderRight: `1px solid ${sidebarBorder}`,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        paddingTop: electron ? 36 : 0,
        ...(electron ? { WebkitAppRegion: "drag" } as any : {}),
      }}>
        <div style={{ ...(electron ? { WebkitAppRegion: "no-drag" } as any : {}), display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          <Sidebar
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={onSelectProject}
            sessions={activeSessions}
            digests={digests}
            automations={automations}
            activeView={activeView}
            onChangeView={setActiveView}
            onExpandSession={handleExpandSession}
            theme={theme}
            wsConnected={wsConnected}
            toggleTheme={toggleTheme}
            t={t}
            onNewProject={() => setShowNewProject(true)}
            onDeleteProject={(id) => onDeleteProject(id)}
            pendingPermissions={pendingPermissions}
            permissionHistory={permissionHistory}
            send={send}
            pendingPhaseGate={pendingPhaseGate}
            pendingReauthQueue={pendingReauthQueue}
            onPhaseGateRespond={onPhaseGateRespond}
            onReauth={onReauth}
            onResolvePermission={(_sid, eventId) => {
              setResolvedPermIds(prev => new Set(prev).add(eventId))
            }}
            onJumpToSession={(sid) => {
              setActiveView("sessions")
              setExpandedSessions(new Set([sid]))
              setTargetSessionId(sid)
            }}
          />
        </div>
      </div>

      {/* Main area */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}>
        {/* Draggable titlebar region for Electron */}
        {electron && (
          <div style={{
            height: 36, flexShrink: 0,
            ...(electron ? { WebkitAppRegion: "drag" } as any : {}),
          }} />
        )}
        {/* Content area */}
        <div style={{
          flex: 1, padding: "16px 20px",
          overflow: (expandedSessions.size > 0 || props.inlinePanel) ? "hidden" : "auto",
          display: (expandedSessions.size > 0 || props.inlinePanel) ? "flex" : undefined,
          flexDirection: (expandedSessions.size > 0 || props.inlinePanel) ? "column" : undefined,
        }}>
          {/* Inline panel (automation editor, fire crew, etc.) — replaces all views */}
          {props.inlinePanel ? (
            <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
              {props.onCloseInlinePanel && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8, flexShrink: 0 }}>
                  <button
                    onClick={props.onCloseInlinePanel}
                    style={{
                      background: "transparent", border: `1px solid ${dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.15)"}`,
                      borderRadius: 6, padding: "4px 12px", cursor: "pointer",
                      fontSize: 12, color: textSecondary, fontFamily: "inherit",
                    }}
                  >
                    {"\u2190"} {t("common.back") || "Back"}
                  </button>
                </div>
              )}
              <div style={{ flex: 1, overflow: "auto" }}>
                {props.inlinePanel}
              </div>
            </div>
          ) : (<>
          {activeView === "sessions" && (
            <div data-testid="sessions-view" style={expandedSessions.size > 0 ? { display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" } : undefined}>
              {/* Project summary + next steps (matches mobile) */}
              {sortedSessions.length > 0 && expandedSessions.size === 0 && (() => {
                const reportLocale = locale.startsWith("zh") ? "zh-TW" as const : "en" as const
                const digestArr = Array.from(digests.values())
                const summary = buildProjectDecisionSummary(digestArr, reportLocale)
                const steps: { label: string; action: string }[] = []
                for (const [, d] of digests) {
                  if (d.nextAction) steps.push({ label: d.displayLabel || "Agent", action: d.nextAction })
                }
                return (summary || steps.length > 0) ? (
                  <div style={{
                    padding: "10px 14px", borderRadius: 10, marginBottom: 12,
                    background: dark ? "rgba(30,41,59,0.4)" : "rgba(255,255,255,0.6)",
                    border: `1px solid ${dark ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.1)"}`,
                    backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                  }}>
                    {summary && (
                      <div style={{ fontSize: 13, color: dark ? "#cbd5e1" : "#475569", lineHeight: 1.5, marginBottom: steps.length > 0 ? 8 : 0 }}>
                        {summary}
                      </div>
                    )}
                    {steps.length > 0 && (
                      <div>
                        {steps.slice(0, 5).map((s, i) => (
                          <div key={i} style={{ display: "flex", gap: 6, fontSize: 12, lineHeight: 1.6, color: textSecondary }}>
                            <span style={{ fontWeight: 600, color: dark ? "#e2e8f0" : "#1e293b", opacity: 0.6, flexShrink: 0 }}>{s.label}:</span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.action}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null
              })()}

              {sortedSessions.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: textSecondary, fontSize: 14 }}>
                  No active sessions
                </div>
              ) : expandedSessions.size === 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {sortedSessions.map((session, i) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      digest={digests.get(session.id)}
                      events={props.sessionEvents.get(session.id)}
                      index={i}
                      theme={theme}
                      expanded={false}
                      onToggleExpand={handleExpandSession}
                      onKill={(id) => onKillSession(id)}
                    />
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
                  {/* Expanded panels */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: expandedSessions.size === 1 ? "1fr" : "1fr 1fr",
                    gap: 10,
                    flex: 1,
                    overflow: "hidden",
                  }}>
                    {sortedSessions.filter(s => expandedSessions.has(s.id)).map((session) => {
                      const sessionIdx = sortedSessions.indexOf(session)
                      return (
                      <div key={session.id} style={{
                        borderRadius: 10,
                        background: dark ? "rgba(30,41,59,0.6)" : "rgba(255,255,255,0.8)",
                        border: `1px solid ${dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.12)"}`,
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                      }}>
                        <DesktopSessionPanel
                          session={session}
                          digest={digests.get(session.id)}
                          events={props.sessionEvents.get(session.id) || []}
                          index={sessionIdx}
                          send={send}
                          on={on}
                          sessionToken={sessionToken}
                          theme={theme}
                          locale={locale}
                          onKill={() => onKillSession(session.id)}
                          onCollapse={() => handleExpandSession(session.id)}
                        />
                      </div>
                    )})}
                  </div>
                  {/* Other sessions — shown as cards below */}
                  {sortedSessions.some(s => !expandedSessions.has(s.id)) && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10, flexShrink: 0 }}>
                      {sortedSessions.filter(s => !expandedSessions.has(s.id)).map((session, i) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          digest={digests.get(session.id)}
                          events={props.sessionEvents.get(session.id)}
                          index={sortedSessions.indexOf(session)}
                          theme={theme}
                          expanded={false}
                          onToggleExpand={handleExpandSession}
                          onKill={(id) => onKillSession(id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeView === "schedules" && (
            <SchedulesTool
              automations={props.automations}
              results={props.autoResults}
              loading={props.autoLoading}
              projects={projects}
              theme={theme}
              t={t}
              onToggle={props.autoToggle}
              onEdit={onEditAutomation}
              onNew={onNewAutomation}
              onDelete={props.onDeleteAutomation}
              onViewReport={props.onViewReport}
              onViewCrewReport={props.onViewCrewReport}
            />
          )}

          {activeView === "prd" && (
            <PrdTool
              projectId={selectedProjectId}
              send={send}
              theme={theme}
              t={t}
            />
          )}

          {activeView === "workflows" && (
            <WorkflowsTool
              theme={theme}
              t={t}
              onFireCrew={onFireCrew}
              onOpenChainBuilder={props.onOpenBuilder}
              onCreateFromTemplate={props.onCreateFromTemplate}
              onOpenChainEditor={props.onOpenChainEditor}
            />
          )}

          {activeView === "git" && (
            <GitTool
              projectId={selectedProjectId}
              theme={theme}
              t={t}
            />
          )}

          {activeView === "settings" && (
            <SettingsTool
              projectId={selectedProjectId}
              theme={theme}
              t={t}
              onSettingsChange={handleSettingsChange}
            />
          )}

          {/* Bypass confirmation dialog (match MissionControl) */}
          {bypassConfirmPending && (
            <div onClick={() => setBypassConfirmPending(false)} style={{
              position: "fixed", inset: 0, zIndex: 1000,
              background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div onClick={e => e.stopPropagation()} style={{
                background: dark ? "#1e293b" : "#fff", borderRadius: 16, padding: 24, maxWidth: 380,
                border: `1px solid ${dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.2)"}`,
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: dark ? "#e2e8f0" : "#1e293b" }}>
                  {t("mc.bypassConfirmTitle")}
                </div>
                <div style={{ fontSize: 13, color: dark ? "#94a3b8" : "#64748b", marginBottom: 16, lineHeight: 1.5 }}>
                  {t("mc.bypassConfirmDesc")}
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => setBypassConfirmPending(false)} style={{
                    padding: "8px 16px", borderRadius: 8, border: `1px solid ${dark ? "rgba(148,163,184,0.15)" : "rgba(148,163,184,0.2)"}`,
                    background: "transparent", color: dark ? "#94a3b8" : "#64748b", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}>{t("mc.cancel") || "Cancel"}</button>
                  <button onClick={confirmBypass} style={{
                    padding: "8px 16px", borderRadius: 8, border: "none",
                    background: "#ef4444", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}>{t("mc.bypassConfirmBtn")}</button>
                </div>
              </div>
            </div>
          )}
          </>)}
        </div>

        {/* Bottom stack */}
        <div style={{
          borderTop: `1px solid ${inputBorder}`,
          background: dark ? "rgba(15,23,42,0.5)" : "rgba(248,250,252,0.9)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          flexShrink: 0,
        }}>
          {/* All approvals handled by Sidebar shield button */}
          {/* Input bar */}
          <DesktopInputBar
            onSend={handleSend}
            onRawSend={handleRawSend}
            sessions={sortedSessions}
            digests={digests}
            targetSessionId={targetSessionId}
            onChangeTarget={setTargetSessionId}
            onNewSession={onNewSession}
            onCycleSession={() => {
              if (sortedSessions.length === 0) return
              setActiveView("sessions")
              // Cycle: all(Auto) → #1 → #2 → ... → all(Auto)
              // Find where we are in the cycle
              const currentTarget = targetSessionId
              if (!currentTarget) {
                // Auto → go to #1
                const first = sortedSessions[0]
                setExpandedSessions(new Set([first.id]))
                setTargetSessionId(first.id)
              } else {
                const currentIdx = sortedSessions.findIndex(s => s.id === currentTarget)
                const nextIdx = currentIdx + 1
                if (nextIdx >= sortedSessions.length) {
                  // Past last → back to All (card view + Auto)
                  setExpandedSessions(new Set())
                  setTargetSessionId(null)
                } else {
                  const next = sortedSessions[nextIdx]
                  setExpandedSessions(new Set([next.id]))
                  setTargetSessionId(next.id)
                }
              }
            }}
            theme={theme}
            t={t}
            locale={locale}
            apiBase={props.apiBase}
            projects={projects}
            selectedProjectId={selectedProjectId}
          />
        </div>
      </div>

      {/* New Project Dialog */}
      <NewProjectDialog
        open={showNewProject}
        theme={theme}
        t={t}
        onCreateProject={async (name, cwd) => {
          await onNewProject(name, cwd)
          setShowNewProject(false)
        }}
        onClose={() => setShowNewProject(false)}
      />
    </div>
  )
}
