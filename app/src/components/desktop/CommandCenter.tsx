import React, { useState, useCallback, useMemo, useEffect, useRef } from "react"
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
import { resolveDesktopLaunchAgentId } from "../../lib/desktop-session-launch"
import { resolveDesktopSessionTarget } from "../../lib/desktop-session-routing"
import { buildSessionOrdinalMap, sortSessionsByOrdinal } from "../../lib/session-ordinals"
import { buildSessionAttachMessage } from "../../lib/session-attach"
import { getSettings, getAutoSaveKeysEnabled, getAutoSaveKeysPath } from "../../lib/storage"
import { trackDesktopSessionCreate, trackDesktopCommandSend, trackDesktopToolView, trackDesktopSessionExpand, trackDesktopSessionRestart, trackDesktopBypassToggle, trackDesktopSessionKill, trackDesktopNewProject } from "../../lib/analytics"

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
  const [forceNewSession, setForceNewSession] = useState(false)
  const [pendingNewSessionId, setPendingNewSessionId] = useState<string | null>(null)
  const lastHandledExpandSessionIdRef = React.useRef<string | null>(null)
  const forceNewSessionRef = useRef(false)
  const pendingNewSessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    forceNewSessionRef.current = forceNewSession
  }, [forceNewSession])

  useEffect(() => {
    pendingNewSessionIdRef.current = pendingNewSessionId
  }, [pendingNewSessionId])
  // Clear stale target when session no longer exists
  useEffect(() => {
    if (targetSessionId === pendingNewSessionId) return
    if (targetSessionId && !activeSessions.some(s => s.id === targetSessionId)) {
      setTargetSessionId(null)
    }
  }, [targetSessionId, activeSessions, pendingNewSessionId])
  useEffect(() => {
    if (!pendingNewSessionId) return
    if (!activeSessions.some(s => s.id === pendingNewSessionId)) return
    setActiveView("sessions")
    setExpandedSessions(new Set([pendingNewSessionId]))
    setTargetSessionId(pendingNewSessionId)
    forceNewSessionRef.current = false
    pendingNewSessionIdRef.current = null
    setForceNewSession(false)
    setPendingNewSessionId(null)
  }, [pendingNewSessionId, activeSessions])
  useEffect(() => {
    if (!pendingNewSessionId) return
    if (targetSessionId === pendingNewSessionId && expandedSessions.has(pendingNewSessionId)) return
    setActiveView("sessions")
    setExpandedSessions(new Set([pendingNewSessionId]))
    setTargetSessionId(pendingNewSessionId)
  }, [pendingNewSessionId, targetSessionId, expandedSessions])
  const [showNewProject, setShowNewProject] = useState(false)
  const sessionOrdinals = useMemo(() => buildSessionOrdinalMap(activeSessions), [activeSessions])
  const ordinalSessions = useMemo(() => sortSessionsByOrdinal(activeSessions), [activeSessions])

  // Track locally resolved permission IDs (cleared when server updates event status)
  const [resolvedPermIds, setResolvedPermIds] = useState<Set<string>>(new Set())

  // Find ALL pending permission requests across all sessions
  const pendingPermissions = useMemo(() => {
    const results: { event: AgentEvent; sessionId: string; sessionIdx: number }[] = []
    const seen = new Set<string>()
    for (const [sid, events] of props.sessionEvents) {
      const sessionIdx = sessionOrdinals.get(sid)
      if (!sessionIdx) continue // skip closed/removed sessions
      // Skip sessions that are idle/done — they can't have real pending permissions
      const d = digests.get(sid)
      if (d && (d.status === "idle" || d.status === "done")) continue
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]
        if (e.type === "decision_request" && e.status === "waiting" && !resolvedPermIds.has(e.id)) {
          const key = `${sid}:${e.detail || e.title}`
          if (seen.has(key)) continue
          seen.add(key)
          results.push({ event: e, sessionId: sid, sessionIdx })
        }
      }
    }
    return results
  }, [props.sessionEvents, digests, resolvedPermIds, sessionOrdinals])

  // Track permission history (last 10 resolved)
  const permissionHistory = useMemo(() => {
    const results: { event: AgentEvent; sessionId: string; sessionIdx: number }[] = []
    for (const [sid, events] of props.sessionEvents) {
      const sessionIdx = sessionOrdinals.get(sid)
      if (!sessionIdx) continue // skip closed/removed sessions
      for (const e of events) {
        if (e.type === "decision_request" && e.status === "completed") {
          results.push({ event: e, sessionId: sid, sessionIdx })
        }
      }
    }
    return results.slice(-10)
  }, [props.sessionEvents, sessionOrdinals])

  const handleTargetChange = useCallback((sessionId: string | null) => {
    forceNewSessionRef.current = false
    pendingNewSessionIdRef.current = null
    setForceNewSession(false)
    setPendingNewSessionId(null)
    setTargetSessionId(sessionId)
  }, [])

  const handleNewSessionIntent = useCallback(() => {
    forceNewSessionRef.current = true
    pendingNewSessionIdRef.current = null
    setActiveView("sessions")
    setExpandedSessions(new Set())
    setTargetSessionId(null)
    setPendingNewSessionId(null)
    setForceNewSession(true)
  }, [])

  // Handle send from input bar (with optional images)
  const handleSend = useCallback((text: string, images?: string[]) => {
    const sid = pendingNewSessionId || resolveDesktopSessionTarget({
      text,
      forceNewSession,
      targetSessionId,
      expandedSessionIds: expandedSessions,
      sessions: activeSessions,
      digests,
      sessionEvents: props.sessionEvents,
    })
    const launchAgentId = resolveDesktopLaunchAgentId({
      targetSessionId,
      expandedSessionIds: expandedSessions,
      sessions: activeSessions,
      selectedProjectId,
    })
    if (!sid) trackDesktopSessionCreate(selectedProjectId || "", launchAgentId, !!text)
    else trackDesktopCommandSend(sid, text.startsWith("/"), !!text.match(/\[AgentLore Skill Chain/))
    if (!sid) {
      const pid = selectedProjectId || projects[0]?.id
      if (pid) {
        const newId = `${pid}_${Date.now()}`
        const userSettings = getSettings(pid)
        const attachMsg = buildSessionAttachMessage({
          projectId: pid,
          agentId: launchAgentId,
          sessionId: newId,
          autoSaveKeys: getAutoSaveKeysEnabled(),
          autoSaveKeysPath: getAutoSaveKeysPath(),
          settings: userSettings,
          locale,
        }) as Record<string, unknown>
        attachMsg.initialCommand = text
        if (images && images.length > 0) attachMsg.initialImages = images
        if (send(attachMsg)) {
          forceNewSessionRef.current = false
          pendingNewSessionIdRef.current = newId
          setActiveView("sessions")
          setExpandedSessions(new Set([newId]))
          setTargetSessionId(newId)
          setForceNewSession(false)
          setPendingNewSessionId(newId)
        }
      }
      return
    }
    // Send text and Enter separately — match MissionControl's delay pattern
    const msg: Record<string, unknown> = {
      type: "session_input",
      sessionId: sid,
      data: text,
      persistUserEvent: true,
    }
    if (images && images.length > 0) msg.images = images
    if (send(msg)) {
      forceNewSessionRef.current = false
      setForceNewSession(false)
      setActiveView("sessions")
      setExpandedSessions(new Set([sid]))
      setTargetSessionId(sid)
      if (sid !== pendingNewSessionId) {
        pendingNewSessionIdRef.current = null
        setPendingNewSessionId(null)
      }
    }
  }, [pendingNewSessionId, forceNewSession, targetSessionId, expandedSessions, send, activeSessions, digests, props.sessionEvents, selectedProjectId, projects, locale])

  // Handle raw send (e.g. interrupt \x03) to specific session
  const handleRawSend = useCallback((sessionId: string, data: string) => {
    send({ type: "session_input", sessionId, data })
  }, [send])

  // Settings change handler — match MissionControl's handleSettingsChange pattern
  const [bypassConfirmPending, setBypassConfirmPending] = useState(false)
  const pendingBypassRef = React.useRef<{ projectId: string; agentId: string } | null>(null)
  const [pendingRestart, setPendingRestart] = useState(false)

  const handleSettingsChange = useCallback((prev: import("../../types").ProjectSettings, next: import("../../types").ProjectSettings) => {
    // Find the active session to send commands to
    const targetSid = targetSessionId || activeSessions.find(s => s.status !== "recoverable")?.id
    if (!targetSid) return

    const session = activeSessions.find(s => s.id === targetSid)
    if (!session) return

    // Bypass toggle → confirmation before restart
    if (next.bypass !== prev.bypass) {
      if (next.bypass) {
        pendingBypassRef.current = { projectId: session.projectId, agentId: session.agentId }
        setBypassConfirmPending(true)
      } else {
        setPendingRestart(true)
      }
      return
    }

    // Sandbox/bypass/planMode changes → mark as pending (user confirms via "Apply" button)
    if (next.sandboxLevel !== prev.sandboxLevel || next.requirePlanReview !== prev.requirePlanReview || next.requireMergeApproval !== prev.requireMergeApproval) {
      setPendingRestart(true)
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

  // Restart session with resume — uses server-side restart_session which preserves Claude conversation
  const restartWithResume = useCallback((sessionToRestart: AppSession) => {
    trackDesktopSessionRestart(sessionToRestart.projectId, "settings_change")
    const pid = sessionToRestart.projectId
    const userSettings = pid ? getSettings(pid) : undefined
    send({
      type: "restart_session",
      settings: userSettings,
      autoSaveKeysPath: getAutoSaveKeysPath(),
    })
  }, [send])

  const confirmBypass = useCallback(() => {
    setBypassConfirmPending(false)
    const info = pendingBypassRef.current
    if (!info) return
    const session = activeSessions.find(s => s.id === targetSessionId) || activeSessions.find(s => s.projectId === info.projectId && s.status !== "recoverable")
    if (session) restartWithResume(session)
    pendingBypassRef.current = null
  }, [targetSessionId, activeSessions, restartWithResume])

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
    trackDesktopSessionExpand(sessionId)
    setExpandedSessions(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }, [])

  // Direct expand: when expandSessionId prop changes, expand that session
  React.useEffect(() => {
    if (!props.expandSessionId) {
      lastHandledExpandSessionIdRef.current = null
      return
    }
    if (forceNewSessionRef.current || pendingNewSessionIdRef.current) {
      lastHandledExpandSessionIdRef.current = props.expandSessionId
      return
    }
    if (props.expandSessionId === lastHandledExpandSessionIdRef.current) return
    lastHandledExpandSessionIdRef.current = props.expandSessionId
    setActiveView("sessions")
    setExpandedSessions(new Set([props.expandSessionId]))
    setTargetSessionId(props.expandSessionId)
    pendingNewSessionIdRef.current = null
    forceNewSessionRef.current = false
    setPendingNewSessionId(null)
    setForceNewSession(false)
  }, [props.expandSessionId])

  // Only the session we explicitly started is allowed to finish the fresh-session handshake.
  React.useEffect(() => {
    return props.on("attached", (msg) => {
      const pendingSid = pendingNewSessionIdRef.current
      const sid = msg.sessionId as string
      const resumed = msg.resumed as boolean
      if (!sid || resumed || !pendingSid || sid !== pendingSid) return
      forceNewSessionRef.current = false
      setActiveView("sessions")
      setExpandedSessions(new Set([sid]))
      setTargetSessionId(sid)
      setForceNewSession(false)
      /*
      const sid = msg.sessionId as string
      const resumed = msg.resumed as boolean
      if (!sid || resumed || forceNewSession) return
        // New session attached — expand it
        setActiveView("sessions")
        setExpandedSessions(new Set([sid]))
        setTargetSessionId(sid)
        setForceNewSession(false)
      */
    })
  }, [props.on])

  // Keep card positions stable by creation order; status is shown in the card itself.
  const sortedSessions = useMemo(() => {
    return ordinalSessions
  }, [ordinalSessions])

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
            sessionOrdinals={sessionOrdinals}
            digests={digests}
            automations={automations}
            activeView={activeView}
            onChangeView={(v) => { setActiveView(v); props.onCloseInlinePanel?.(); trackDesktopToolView(v) }}
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
              setPendingNewSessionId(null)
              setForceNewSession(false)
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
                  {sortedSessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      digest={digests.get(session.id)}
                      events={props.sessionEvents.get(session.id)}
                      sessionNumber={sessionOrdinals.get(session.id)}
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
                          sessionNumber={sessionOrdinals.get(session.id)}
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
                      {sortedSessions.filter(s => !expandedSessions.has(s.id)).map((session) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          digest={digests.get(session.id)}
                          events={props.sessionEvents.get(session.id)}
                          sessionNumber={sessionOrdinals.get(session.id)}
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
            <div data-testid="schedules-view">
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
            </div>
          )}

          {activeView === "prd" && (
            <div data-testid="prd-view">
              <PrdTool
                projectId={selectedProjectId}
                send={send}
                theme={theme}
                t={t}
              />
            </div>
          )}

          {activeView === "workflows" && (
            <div data-testid="workflows-view">
              <WorkflowsTool
                theme={theme}
                t={t}
                onFireCrew={onFireCrew}
                onOpenChainBuilder={props.onOpenBuilder}
                onCreateFromTemplate={props.onCreateFromTemplate}
                onOpenChainEditor={props.onOpenChainEditor}
              />
            </div>
          )}

          {activeView === "git" && (
            <div data-testid="git-view">
              <GitTool
                projectId={selectedProjectId}
                theme={theme}
                t={t}
              />
            </div>
          )}

          {activeView === "settings" && (<>
            <div data-testid="settings-view">
            <SettingsTool
              projectId={selectedProjectId}
              theme={theme}
              t={t}
              onSettingsChange={handleSettingsChange}
            />
            </div>
            {/* "Apply Changes" banner when sandbox/bypass changes need restart */}
            {pendingRestart && (
              <div style={{
                position: "sticky", bottom: 0, padding: "10px 16px",
                background: dark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.06)",
                borderTop: "2px solid rgba(55,172,192,0.3)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <span style={{ fontSize: 13, color: dark ? "#e2e8f0" : "#1e293b", fontWeight: 500 }}>
                  {locale.startsWith("zh") ? "沙盒設定已變更，需要重啟 session 才能套用" : "Sandbox settings changed. Restart sessions to apply."}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setPendingRestart(false)} style={{
                    padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    border: `1px solid ${dark ? "rgba(148,163,184,0.15)" : "rgba(148,163,184,0.2)"}`,
                    background: "transparent", color: dark ? "#94a3b8" : "#64748b",
                  }}>{locale.startsWith("zh") ? "稍後" : "Later"}</button>
                  <button onClick={() => {
                    setPendingRestart(false)
                    const toRestart = activeSessions.filter(s => s.status !== "recoverable")
                    for (const s of toRestart) restartWithResume(s)
                  }} style={{
                    padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    border: "none", background: "#37ACC0", color: "#fff",
                  }}>{locale.startsWith("zh") ? "立即重啟" : "Restart Now"}</button>
                </div>
              </div>
            )}
          </>)}

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
                    background: "#FB8184", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
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
            sessions={ordinalSessions}
            sessionOrdinals={sessionOrdinals}
            digests={digests}
            targetSessionId={targetSessionId}
            pendingNewSession={forceNewSession || !!pendingNewSessionId}
            onChangeTarget={handleTargetChange}
            onNewSession={props.onNewSession}
            onArmFreshSession={handleNewSessionIntent}
            onCycleSession={() => {
              if (ordinalSessions.length === 0) return
              setActiveView("sessions")
              // Cycle: all(Auto) → #1 → #2 → ... → all(Auto)
              // Find where we are in the cycle
              const currentTarget = targetSessionId
              if (!currentTarget) {
                // Auto → go to #1
                const first = ordinalSessions[0]
                setExpandedSessions(new Set([first.id]))
                setTargetSessionId(first.id)
                setPendingNewSessionId(null)
                setForceNewSession(false)
              } else {
                const currentIdx = ordinalSessions.findIndex(s => s.id === currentTarget)
                const nextIdx = currentIdx >= 0 ? currentIdx + 1 : 0
                if (nextIdx >= ordinalSessions.length) {
                  // Past last → back to All (card view + Auto)
                  setExpandedSessions(new Set())
                  setTargetSessionId(null)
                  setPendingNewSessionId(null)
                  setForceNewSession(false)
                } else {
                  const next = ordinalSessions[nextIdx]
                  setExpandedSessions(new Set([next.id]))
                  setTargetSessionId(next.id)
                  setPendingNewSessionId(null)
                  setForceNewSession(false)
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
// Tracking imports are added at component level — see below
