import React, { useState, useCallback, useRef, useEffect, lazy, Suspense } from "react"
import type { Project, AppSession, AgentEvent } from "../types"
import { AGENTS } from "../types"
import { DesktopOnboarding } from "./desktop/DesktopOnboarding"
import type { PhaseGateRequest, PendingReauthRequest, AutomationConfig, AutomationResult, PhaseGateAction, AutomationTemplate } from "../data/automation-types"
import { useLocale } from "../lib/i18n/index.js"
import { useSessionDigests } from "../hooks/useSessionDigests"
import { useAutomations } from "../hooks/useAutomations"
import { isSummaryNoise } from "../lib/session-summary"
import { CommandCenter } from "./desktop/CommandCenter"
import { QuickLaunchDialog } from "./desktop/QuickLaunchDialog"

const AutomationSheet = lazy(() => import("./AutomationSheet").then(m => ({ default: m.AutomationSheet })))
const FireCrewSheet = lazy(() => import("./FireCrewSheet"))
const AutomationReportSheet = lazy(() => import("./AutomationReportSheet"))
const CrewReportSheet = lazy(() => import("./CrewReportSheet"))
const ChainBuilder = lazy(() => import("./ChainBuilder").then(m => ({ default: m.ChainBuilder })))

// --- Session label helpers (match UnifiedPanel pattern) ---
function getSessionLabels(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem("agentrune_session_labels") || "{}") } catch { return {} }
}
function getAutoLabels(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem("agentrune_session_autolabels") || "{}") } catch { return {} }
}

export interface DashboardProps {
  projects: Project[]
  activeSessions: AppSession[]
  sessionEvents: Map<string, AgentEvent[]>
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
  pendingPhaseGate: PhaseGateRequest | null
  pendingReauthQueue: PendingReauthRequest[]
  onPhaseGateRespond: (action: PhaseGateAction, instructions?: string, reviewNote?: string) => void
  onReauth: (automationId: string) => void
  onKillSession: (sessionId: string) => Promise<void>
  onNewProject: (name: string, cwd: string) => Promise<void>
  onDeleteProject: (projectId: string) => Promise<void>
}

export function Dashboard({
  projects,
  activeSessions,
  sessionEvents,
  send,
  on,
  sessionToken,
  wsConnected,
  apiBase,
  theme,
  toggleTheme,
  onSelectSession,
  onNewSession,
  onLaunch,
  onOpenBuilder,
  pendingPhaseGate,
  pendingReauthQueue,
  onPhaseGateRespond,
  onReauth,
  onKillSession,
  onNewProject,
  onDeleteProject,
}: DashboardProps) {
  const { t, locale } = useLocale()
  const reportLocale = locale === "zh-TW" ? "zh-TW" : "en" as const
  const dark = theme === "dark"

  // State
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    projects[0]?.id || null
  )
  const [showFireCrewSheet, setShowFireCrewSheet] = useState(false)
  const [showAutomationSheet, setShowAutomationSheet] = useState(false)
  const [editingAutomation, setEditingAutomation] = useState<AutomationConfig | null>(null)
  const [showQuickLaunch, setShowQuickLaunch] = useState(false)
  const [reportOverlay, setReportOverlay] = useState<{
    type: "automation" | "crew"
    auto: AutomationConfig
    results?: AutomationResult[]
    selectedResultId?: string
  } | null>(null)
  const [expandSessionId, setExpandSessionId] = useState<string | null>(null)
  const [showChainBuilder, setShowChainBuilder] = useState(false)
  const [chainBuilderSlug, setChainBuilderSlug] = useState<string | undefined>(undefined)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window === "undefined") return false
    const isDesktop = !!(window as any).electronAPI
    return isDesktop && !localStorage.getItem("desktop_onboarding_seen")
  })

  // Auto-expand new sessions
  const prevSessionIdsRef = useRef(new Set(activeSessions.map(s => s.id)))
  useEffect(() => {
    const prevIds = prevSessionIdsRef.current
    const newSession = activeSessions.find(s => !prevIds.has(s.id) && s.status !== "recoverable")
    prevSessionIdsRef.current = new Set(activeSessions.map(s => s.id))
    if (newSession) {
      console.log("[Dashboard] New session detected, expanding:", newSession.id)
      setExpandSessionId(newSession.id)
    }
  }, [activeSessions])

  // Ensure selected project is valid
  const selectedProject = selectedProjectId
    ? projects.find(p => p.id === selectedProjectId) || projects[0]
    : projects[0]
  const effectiveProjectId = selectedProject?.id || null

  // Filter sessions by project (null = all)
  const filteredSessions = effectiveProjectId
    ? activeSessions.filter(s => s.projectId === effectiveProjectId)
    : activeSessions

  // Display label helper
  const labels = getSessionLabels()
  const autoLabels = getAutoLabels()
  const getDisplayLabel = useCallback((session: AppSession) => {
    const rawAutoLabel = autoLabels[session.id]
    const agentDef = AGENTS.find(a => a.id === session.agentId)
    return labels[session.id]
      || (rawAutoLabel && !isSummaryNoise(rawAutoLabel) ? rawAutoLabel : null)
      || agentDef?.name
      || session.agentId
  }, [autoLabels, labels])

  // Session digests
  const digests = useSessionDigests(filteredSessions, sessionEvents, reportLocale, getDisplayLabel)

  // Automations — cross-project (null = all projects)
  const { automations, results, loading: autoLoading, toggle: autoToggle, refresh: autoRefresh } = useAutomations(null, apiBase)

  // Style tokens
  const bg = dark ? "#0f172a" : "#f8fafc"
  const textPrimary = dark ? "#e2e8f0" : "#1e293b"

  const serverUrl = apiBase || localStorage.getItem("agentrune_server") || ""

  // Desktop onboarding — first launch only
  if (showOnboarding) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: bg }}>
        <DesktopOnboarding
          onComplete={() => setShowOnboarding(false)}
          theme={theme}
          t={t}
          locale={locale}
          apiBase={apiBase}
          projectId={effectiveProjectId}
        />
      </div>
    )
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: bg,
      display: "flex", flexDirection: "column",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      color: textPrimary,
      overflow: "hidden",
    }}>
      {/* Command Center — replaces old tab layout */}
      <CommandCenter
        projects={projects}
        activeSessions={filteredSessions}
        sessionEvents={sessionEvents}
        digests={digests}
        send={send}
        on={on}
        sessionToken={sessionToken}
        wsConnected={wsConnected}
        apiBase={apiBase}
        theme={theme}
        toggleTheme={toggleTheme}
        onSelectSession={onSelectSession}
        onNewSession={() => setShowQuickLaunch(true)}
        onLaunch={onLaunch}
        onOpenBuilder={() => { setChainBuilderSlug(undefined); setShowChainBuilder(true) }}
        expandSessionId={expandSessionId}
        onOpenChainEditor={(slug: string) => { setChainBuilderSlug(slug); setShowChainBuilder(true) }}
        pendingPhaseGate={pendingPhaseGate}
        pendingReauthQueue={pendingReauthQueue}
        onPhaseGateRespond={onPhaseGateRespond}
        onReauth={onReauth}
        automations={automations}
        autoResults={results}
        autoLoading={autoLoading}
        autoToggle={autoToggle}
        autoRefresh={autoRefresh}
        onEditAutomation={(auto) => { setEditingAutomation(auto); setShowAutomationSheet(true) }}
        onNewAutomation={() => { setEditingAutomation(null); setShowAutomationSheet(true) }}
        onDeleteAutomation={async (auto) => {
          const serverUrl = apiBase || localStorage.getItem("agentrune_server") || ""
          try {
            await fetch(`${serverUrl}/api/automations/${auto.projectId}/${auto.id}`, { method: "DELETE" })
            autoRefresh()
          } catch { /* ignore */ }
        }}
        onFireCrew={() => setShowFireCrewSheet(true)}
        onCreateFromTemplate={(template: AutomationTemplate) => {
          // Open AutomationSheet with template data pre-filled
          setEditingAutomation({
            id: "",
            projectId: effectiveProjectId || "",
            name: template.name,
            prompt: template.prompt || "",
            templateId: template.id,
            schedule: { type: "daily", timeOfDay: "09:00" },
            runMode: "local",
            agentId: "claude",
            enabled: true,
            createdAt: Date.now(),
            crew: template.crew,
          })
          setShowAutomationSheet(true)
        }}
        onViewReport={(auto, autoResults) => setReportOverlay({ type: "automation", auto, results: autoResults })}
        onViewCrewReport={(auto) => setReportOverlay({ type: "crew", auto })}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        onKillSession={onKillSession}
        onNewProject={onNewProject}
        onDeleteProject={onDeleteProject}
        t={t}
        locale={locale}
        inlinePanel={
          // AutomationSheet — inline in desktop
          (showAutomationSheet && effectiveProjectId) ? (
            <Suspense fallback={null}>
              <AutomationSheet
                open
                inline
                projectId={effectiveProjectId}
                serverUrl={serverUrl}
                onClose={() => { setShowAutomationSheet(false); setEditingAutomation(null); autoRefresh() }}
                initialEdit={editingAutomation ? {
                  id: editingAutomation.id,
                  name: editingAutomation.name,
                  prompt: editingAutomation.prompt || editingAutomation.command || "",
                  schedule: editingAutomation.schedule,
                  runMode: editingAutomation.runMode,
                  agentId: editingAutomation.agentId,
                  templateId: editingAutomation.templateId,
                  crew: editingAutomation.crew,
                } as any : undefined}
              />
            </Suspense>
          ) : (showFireCrewSheet && effectiveProjectId) ? (
            <Suspense fallback={null}>
              <FireCrewSheet
                open
                inline
                onClose={() => setShowFireCrewSheet(false)}
                t={t}
                serverUrl={serverUrl}
                projectId={effectiveProjectId}
                sessionId={filteredSessions[0]?.id || null}
                sessionSummary={filteredSessions[0] ? digests.get(filteredSessions[0].id)?.summary : undefined}
              />
            </Suspense>
          ) : showChainBuilder ? (
            <Suspense fallback={null}>
              <ChainBuilder
                onBack={() => setShowChainBuilder(false)}
                t={t}
                initialSlug={chainBuilderSlug}
                inline
              />
            </Suspense>
          ) : undefined
        }
        onCloseInlinePanel={
          showAutomationSheet ? () => { setShowAutomationSheet(false); setEditingAutomation(null); autoRefresh() }
          : showFireCrewSheet ? () => setShowFireCrewSheet(false)
          : undefined
        }
      />

      {/* ─── Overlays ──────────────────────────────── */}

      {/* Quick Launch Dialog */}
      <QuickLaunchDialog
        open={showQuickLaunch}
        projects={projects}
        selectedProjectId={selectedProjectId}
        theme={theme}
        t={t}
        onLaunch={(pid, aid) => { onLaunch(pid, aid); setShowQuickLaunch(false) }}
        onClose={() => setShowQuickLaunch(false)}
      />

      {/* Automation Report Sheet */}
      {reportOverlay?.type === "automation" && reportOverlay.results && (
        <Suspense fallback={null}>
          <AutomationReportSheet
            open
            automationName={reportOverlay.auto.name}
            results={reportOverlay.results}
            selectedResultId={reportOverlay.selectedResultId}
            onSelectResult={(id: string) => setReportOverlay(prev => prev ? { ...prev, selectedResultId: id } : null)}
            onClose={() => setReportOverlay(null)}
          />
        </Suspense>
      )}

      {/* Crew Report Sheet */}
      {reportOverlay?.type === "crew" && (
        <Suspense fallback={null}>
          <CrewReportSheet
            open
            automationId={reportOverlay.auto.id}
            automationName={reportOverlay.auto.name}
            serverUrl={serverUrl}
            onClose={() => setReportOverlay(null)}
          />
        </Suspense>
      )}

      {/* AutomationSheet & FireCrewSheet now render inline via CommandCenter inlinePanel */}

      {/* Pulse animation keyframe */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
