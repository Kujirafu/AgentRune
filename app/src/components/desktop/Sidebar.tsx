import React, { useState, useEffect, useCallback } from "react"
import type { Project, AppSession, AgentEvent } from "../../types"
import type { SessionDecisionDigest } from "../../lib/session-summary"
import type { AutomationConfig } from "../../data/automation-types"
import type { ToolView } from "./CommandCenter"
import { getApiBase } from "../../lib/storage"
import { ConfirmDialog } from "./ConfirmDialog"

import type { PhaseGateRequest, PendingReauthRequest, PhaseGateAction } from "../../data/automation-types"

export interface PendingPermItem {
  event: AgentEvent
  sessionId: string
  sessionIdx: number
}

interface SidebarProps {
  projects: Project[]
  selectedProjectId: string | null
  onSelectProject: (id: string | null) => void
  sessions: AppSession[]
  digests: Map<string, SessionDecisionDigest>
  automations: AutomationConfig[]
  activeView: ToolView
  onChangeView: (view: ToolView) => void
  onExpandSession: (sessionId: string) => void
  theme: "light" | "dark"
  wsConnected: boolean
  toggleTheme: () => void
  t: (key: string) => string
  onNewProject?: () => void
  onDeleteProject?: (projectId: string) => void
  /** Live pending permission requests */
  pendingPermissions?: PendingPermItem[]
  /** Recently resolved permissions (last 10) */
  permissionHistory?: PendingPermItem[]
  /** Send WS message (for approve/deny) */
  send?: (msg: Record<string, unknown>) => boolean
  /** Phase gate + reauth (from automations) */
  pendingPhaseGate?: PhaseGateRequest | null
  pendingReauthQueue?: PendingReauthRequest[]
  onPhaseGateRespond?: (action: PhaseGateAction, instructions?: string, reviewNote?: string) => void
  onReauth?: (automationId: string) => void
  /** Jump to a session's detail view */
  onJumpToSession?: (sessionId: string) => void
  /** Mark a permission event as resolved (remove from Live list) */
  onResolvePermission?: (sessionId: string, eventId: string) => void
}

const statusColor: Record<string, string> = {
  blocked: "#FB8184", working: "#37ACC0", idle: "#94a3b8", done: "#BDD1C6",
}

// Task status → color
const taskStatusColor: Record<string, string> = {
  pending: "#D09899", in_progress: "#37ACC0", done: "#BDD1C6", skipped: "#94a3b8",
}

// Lucide-style task status icons
function TaskStatusIcon({ status, color }: { status: string; color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {status === "done" ? (
        <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>
      ) : status === "skipped" ? (
        <><circle cx="12" cy="12" r="10" /><line x1="8" y1="12" x2="16" y2="12" /></>
      ) : status === "in_progress" ? (
        <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>
      ) : (
        <circle cx="12" cy="12" r="10" />
      )}
    </svg>
  )
}

// Lucide-style tool icons
function ToolIcon({ tool, color }: { tool: string; color: string }) {
  const props = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: "2", strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  switch (tool) {
    case "sessions": return <svg {...props}><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
    case "prd": return <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
    case "git": return <svg {...props}><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><line x1="6" y1="9" x2="6" y2="21" /></svg>
    case "schedules": return <svg {...props}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
    case "workflows": return <svg {...props}><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>
    case "settings": return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
    default: return null
  }
}

interface SidebarTask {
  id: number
  title: string
  status: string
  prdTitle?: string
}

export function Sidebar({
  projects, selectedProjectId, onSelectProject,
  sessions, digests, automations,
  activeView, onChangeView, onExpandSession,
  theme, wsConnected, toggleTheme, t,
  onNewProject, onDeleteProject,
  pendingPermissions = [], permissionHistory = [], send,
  pendingPhaseGate, pendingReauthQueue = [], onPhaseGateRespond, onReauth,
  onJumpToSession, onResolvePermission,
}: SidebarProps) {
  const dark = theme === "dark"
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<Project | null>(null)
  const [permPanel, setPermPanel] = useState(false)
  const [permTab, setPermTab] = useState<"live" | "history">("live")
  // Track resolved items for feedback animation (eventId → "approved" | "denied")
  const [resolvedFeedback, setResolvedFeedback] = useState<Map<string, string>>(new Map())

  const totalPending = pendingPermissions.length + (pendingPhaseGate ? 1 : 0) + pendingReauthQueue.length

  // Auto-open panel when new approvals arrive
  const prevPermCount = React.useRef(0)
  useEffect(() => {
    if (totalPending > prevPermCount.current && totalPending > 0) {
      setPermPanel(true)
      setPermTab("live")
    }
    prevPermCount.current = totalPending
  }, [totalPending])
  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const textMuted = dark ? "#475569" : "#94a3b8"
  const dividerColor = dark ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.1)"

  const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: textMuted,
    textTransform: "uppercase", letterSpacing: 1,
    padding: "16px 16px 6px",
  }

  // Session count per project
  const sessionCounts = new Map<string, number>()
  for (const s of sessions) {
    sessionCounts.set(s.projectId, (sessionCounts.get(s.projectId) || 0) + 1)
  }

  // ── Fetch project tasks (PRD + standalone) ──
  const [tasks, setTasks] = useState<SidebarTask[]>([])

  const fetchTasks = useCallback(() => {
    if (!selectedProjectId) { setTasks([]); return }
    const base = getApiBase()
    Promise.all([
      fetch(`${base}/api/prd/${encodeURIComponent(selectedProjectId)}`)
        .then(r => r.json())
        .then(async (list: any[]) => {
          if (!Array.isArray(list) || list.length === 0) return []
          const details = await Promise.all(
            list.filter((p: any) => p.tasksTotal > 0).map((p: any) =>
              fetch(`${base}/api/prd/${encodeURIComponent(selectedProjectId!)}/${encodeURIComponent(p.id)}`)
                .then(r => r.json()).catch(() => null)
            )
          )
          const out: SidebarTask[] = []
          for (const d of details) {
            if (!d?.tasks) continue
            for (const task of d.tasks) {
              out.push({ id: task.id, title: task.title, status: task.status, prdTitle: d.title })
            }
          }
          return out
        }).catch(() => [] as SidebarTask[]),
      fetch(`${base}/api/tasks/${encodeURIComponent(selectedProjectId)}`)
        .then(r => r.json())
        .then((data: any) => {
          const items = data?.tasks || []
          return items.map((t: any) => ({ id: t.id, title: t.title, status: t.status } as SidebarTask))
        }).catch(() => [] as SidebarTask[]),
    ]).then(([prdTasks, standaloneTasks]) => {
      setTasks([...prdTasks, ...standaloneTasks])
    })
  }, [selectedProjectId])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  // Listen for task changes (from InputBar or agent)
  useEffect(() => {
    const handler = () => fetchTasks()
    window.addEventListener("tasks_changed", handler)
    window.addEventListener("prd_changed", handler)
    return () => { window.removeEventListener("tasks_changed", handler); window.removeEventListener("prd_changed", handler) }
  }, [fetchTasks])

  // Sort tasks: in_progress → pending → done → skipped
  const sortedTasks = [...tasks].sort((a, b) => {
    const order: Record<string, number> = { in_progress: 0, pending: 1, done: 2, skipped: 3 }
    return (order[a.status] ?? 4) - (order[b.status] ?? 4)
  })

  // Upcoming automations (next 3 enabled with nextRunAt)
  const upcoming = automations
    .filter(a => a.enabled && (a as any).nextRunAt)
    .sort((a, b) => ((a as any).nextRunAt || 0) - ((b as any).nextRunAt || 0))
    .slice(0, 3)

  const tools: { key: ToolView; label: string }[] = [
    { key: "sessions", label: t("desktop.sessions") },
    { key: "prd", label: "PRD" },
    { key: "git", label: "Git" },
    { key: "schedules", label: t("dash.schedules") },
    { key: "workflows", label: t("dash.workflows") },
    { key: "settings", label: t("settings.title") },
  ]

  return (
    <>
      {/* Brand */}
      <div style={{
        padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 8,
        borderBottom: `1px solid ${dividerColor}`,
      }}>
        <img src="/icon.png" alt="AgentRune" style={{ width: 24, height: 24, borderRadius: 5 }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: textPrimary }}>AgentRune</span>
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          background: wsConnected ? "#BDD1C6" : "#FB8184",
        }} />
      </div>

      {/* Projects */}
      <div style={{ ...sectionLabel, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{t("desktop.projects")}</span>
        {onNewProject && (
          <button
            onClick={onNewProject}
            style={{
              width: 18, height: 18, borderRadius: 4, border: "none",
              background: "transparent", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: textMuted, fontSize: 14, fontWeight: 700,
              padding: 0,
            }}
            title={t("desktop.newProject")}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
      </div>
      {projects.map(p => {
        const isActive = p.id === selectedProjectId
        const count = sessionCounts.get(p.id) || 0
        return (
          <button
            key={p.id}
            onClick={() => { onSelectProject(p.id) }}
            onContextMenu={(e) => {
              if (!onDeleteProject) return
              e.preventDefault()
              setDeleteProjectTarget(p)
            }}
            style={{
              padding: "6px 16px",
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? textPrimary : textSecondary,
              background: isActive ? (dark ? "rgba(55,172,192,0.08)" : "rgba(55,172,192,0.04)") : "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              borderTop: "none",
              borderRight: "none",
              borderBottom: "none",
              borderLeft: isActive ? "3px solid #37ACC0" : "3px solid transparent",
              width: "100%",
              textAlign: "left",
              fontFamily: "inherit",
            }}
          >
            {p.name}
            <span style={{ flex: 1 }} />
            {count > 0 && (
              <span style={{
                fontSize: 11,
                background: isActive ? (dark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.1)") : (dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.08)"),
                color: isActive ? "#37ACC0" : textSecondary,
                padding: "1px 6px",
                borderRadius: 6,
              }}>{count}</span>
            )}
          </button>
        )
      })}

      {/* Tasks — from PRD + standalone beeds */}
      <div style={{ ...sectionLabel, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{t("desktop.tasks")}</span>
        {sortedTasks.length > 0 && (
          <span style={{ fontSize: 10, color: textMuted, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
            {tasks.filter(t => t.status === "done").length}/{tasks.length}
          </span>
        )}
      </div>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {sortedTasks.length === 0 && (
          <div style={{ padding: "4px 16px", fontSize: 12, color: textMuted }}>
            {t("desktop.noTasks")}
          </div>
        )}
        {sortedTasks.slice(0, 12).map((task) => {
          const color = taskStatusColor[task.status] || textSecondary
          const isDone = task.status === "done" || task.status === "skipped"
          return (
            <button
              key={`${task.prdTitle || "s"}-${task.id}`}
              onClick={() => onChangeView("prd")}
              style={{
                padding: "3px 16px",
                fontSize: 12,
                color: isDone ? textMuted : textSecondary,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                overflow: "hidden",
                border: "none",
                background: "transparent",
                width: "100%",
                textAlign: "left",
                fontFamily: "inherit",
                opacity: isDone ? 0.5 : 1,
                textDecoration: isDone ? "line-through" : "none",
              }}
            >
              <span style={{ width: 12, height: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <TaskStatusIcon status={task.status} color={color} />
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {task.title}
              </span>
            </button>
          )
        })}
        {sortedTasks.length > 12 && (
          <button
            onClick={() => onChangeView("prd")}
            style={{
              padding: "3px 16px", fontSize: 11, color: "#37ACC0",
              border: "none", background: "transparent", cursor: "pointer",
              fontFamily: "inherit", width: "100%", textAlign: "left",
            }}
          >
            +{sortedTasks.length - 12} more...
          </button>
        )}
      </div>

      {/* Tools */}
      <div style={sectionLabel}>{t("desktop.tools")}</div>
      {tools.map(tool => {
        const isActive = activeView === tool.key
        const color = isActive ? "#37ACC0" : textSecondary
        return (
          <button
            key={tool.key}
            onClick={() => onChangeView(tool.key)}
            style={{
              padding: "5px 16px",
              fontSize: 13,
              color,
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: isActive ? (dark ? "rgba(55,172,192,0.06)" : "rgba(55,172,192,0.03)") : "transparent",
              border: "none",
              width: "100%",
              textAlign: "left",
              fontFamily: "inherit",
            }}
          >
            <ToolIcon tool={tool.key} color={color} />
            {tool.label}
          </button>
        )
      })}

      <div style={{ flex: 1 }} />

      {/* Upcoming schedules */}
      {upcoming.length > 0 && (
        <div style={{ padding: "8px 16px", borderTop: `1px solid ${dividerColor}` }}>
          <div style={{ fontSize: 11, color: textMuted, marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{t("desktop.upcoming")}</div>
          {upcoming.map(a => {
            const time = (a as any).nextRunAt
              ? new Date((a as any).nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : ""
            return (
              <div key={a.id} style={{ fontSize: 12, color: textSecondary, marginTop: 3 }}>
                {time} {a.name}
              </div>
            )
          })}
        </div>
      )}

      {/* Bottom: permission widget + theme toggle */}
      <div style={{
        padding: "10px 16px",
        borderTop: totalPending > 0 ? "2px solid rgba(55,172,192,0.4)" : `1px solid ${dividerColor}`,
        display: "flex", alignItems: "center", gap: 8,
        position: "relative",
        transition: "border-top 0.3s ease",
      }}>
        {/* Permission shield button */}
        <button
          onClick={() => setPermPanel(!permPanel)}
          style={{
            width: 28, height: 28, borderRadius: 6, border: "none",
            background: totalPending > 0 ? "rgba(55,172,192,0.15)" : "transparent",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            color: totalPending > 0 ? "#37ACC0" : textSecondary,
            position: "relative",
            animation: totalPending > 0 ? "pulse 2s infinite" : "none",
          }}
          title={t("perm.title")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          {totalPending > 0 && (
            <span style={{
              position: "absolute", top: -2, right: -2,
              width: 14, height: 14, borderRadius: 7,
              background: "#FB8184", color: "#fff", fontSize: 9, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{totalPending}</span>
          )}
        </button>
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          style={{
            width: 28, height: 28, borderRadius: 6, border: "none",
            background: "transparent", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: textSecondary,
          }}
          title={dark ? "Light mode" : "Dark mode"}
        >
          {dark ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {/* Permission panel — expands upward */}
        {permPanel && (
          <div style={{
            position: "absolute", bottom: 48, left: 0, width: 230,
            background: dark ? "rgba(15,23,42,0.97)" : "rgba(255,255,255,0.97)",
            backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
            border: `1px solid ${dividerColor}`,
            borderRadius: 12, boxShadow: "0 -4px 24px rgba(0,0,0,0.2)",
            zIndex: 100, overflow: "hidden",
            maxHeight: 400,
          }}>
            {/* Header with tabs + close */}
            <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${dividerColor}` }}>
              <button onClick={() => setPermTab("live")} style={{
                fontSize: 12, fontWeight: permTab === "live" ? 700 : 500, border: "none", background: "none", cursor: "pointer",
                color: permTab === "live" ? "#37ACC0" : textSecondary, padding: "4px 10px", borderRadius: 6,
                ...(permTab === "live" ? { background: "rgba(55,172,192,0.1)" } : {}),
              }}>Live ({totalPending})</button>
              <button onClick={() => setPermTab("history")} style={{
                fontSize: 12, fontWeight: permTab === "history" ? 700 : 500, border: "none", background: "none", cursor: "pointer",
                color: permTab === "history" ? "#37ACC0" : textSecondary, padding: "4px 10px", borderRadius: 6,
                ...(permTab === "history" ? { background: "rgba(55,172,192,0.1)" } : {}),
              }}>History</button>
              <div style={{ flex: 1 }} />
              <button onClick={() => setPermPanel(false)} style={{
                width: 22, height: 22, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", color: textSecondary,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {/* Content */}
            <div style={{ overflowY: "auto", maxHeight: 340, padding: "8px 0" }}>
              {permTab === "live" && (<>
                {/* Phase gate */}
                {pendingPhaseGate && (
                  <div style={{ padding: "8px 12px", borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}` }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FB8184" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                      <span style={{ fontSize: 13, fontWeight: 600, color: textPrimary }}>{pendingPhaseGate.automationName} — Phase {pendingPhaseGate.completedPhase}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button onClick={() => onPhaseGateRespond?.("proceed")} style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none", background: "#BDD1C6", color: "#fff" }}>Proceed</button>
                      <button onClick={() => onPhaseGateRespond?.("abort")} style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "1px solid rgba(248,113,113,0.3)", background: "transparent", color: "#FB8184" }}>Abort</button>
                    </div>
                  </div>
                )}
                {/* Reauth requests */}
                {pendingReauthQueue.map(req => (
                  <div key={req.automationId} style={{ padding: "8px 12px", borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}` }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D09899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                      <span style={{ fontSize: 13, fontWeight: 600, color: textPrimary }}>{req.automationName} — {req.violationType}</span>
                    </div>
                    <button onClick={() => onReauth?.(req.automationId)} style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none", background: "#D09899", color: "#fff" }}>Re-auth</button>
                  </div>
                ))}
                {/* Agent permission requests */}
                {totalPending === 0
                  ? <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 12, color: textMuted }}>No pending approvals</div>
                  : pendingPermissions.map(({ event: ev, sessionId: sid, sessionIdx }, permIdx) => ev.decision && (
                    <div key={ev.id} style={{
                      padding: "8px 12px",
                      borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}`,
                      ...(resolvedFeedback.has(ev.id) ? {
                        background: resolvedFeedback.get(ev.id) === "approved" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                        opacity: 0.6, transition: "all 0.3s ease",
                      } : permIdx === 0 ? {
                        // First item highlighted — this is the one the agent is waiting on
                        borderLeft: "3px solid #37ACC0",
                      } : { opacity: 0.7 }),
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        {resolvedFeedback.has(ev.id) ? (
                          <span style={{ fontSize: 12, fontWeight: 700, color: resolvedFeedback.get(ev.id) === "approved" ? "#BDD1C6" : "#FB8184" }}>
                            {resolvedFeedback.get(ev.id) === "approved" ? "Approved" : "Denied"}
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, color: textMuted }}>{permIdx + 1}/{pendingPermissions.length}</span>
                        )}
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#37ACC0" }}>#{sessionIdx}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: textPrimary, flex: 1 }}>{ev.decision!.purpose || t("perm.title")}</span>
                        <button onClick={() => { onJumpToSession?.(sid); setPermPanel(false) }} title="View session" style={{
                          width: 20, height: 20, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", color: textMuted, flexShrink: 0,
                        }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </button>
                      </div>
                      {ev.decision!.scope && (
                        <div style={{ fontSize: 11, color: textSecondary, marginBottom: 2 }}>
                          {t("perm.scope")}: {ev.decision!.scope}
                        </div>
                      )}
                      {/* Short file path hint */}
                      {ev.detail && (() => {
                        const pathMatch = (ev.detail || "").match(/(?:\/[^\s"')]+|[A-Z]:\\[^\s"')]+)/i)
                        if (!pathMatch) return null
                        const parts = pathMatch[0].replace(/\\/g, "/").split("/").filter(Boolean)
                        const short = parts.length > 2 ? parts.slice(-2).join("/") : parts.join("/")
                        return <div style={{ fontSize: 10, color: textMuted, fontFamily: "monospace", marginBottom: 2 }}>{short}</div>
                      })()}
                      <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: ev.decision!.options.length > 3 ? "wrap" : "nowrap" }}>
                        {ev.decision!.options.map(opt => {
                          const isDeny = /deny|拒絕|reject|no$/i.test(opt.label)
                          const shortLabel = opt.label
                            .replace(/Yes,?\s*clear context\s*&?\s*auto-accept edits/i, "Auto")
                            .replace(/Yes,?\s*auto-accept edits/i, "Auto edits")
                            .replace(/Yes,?\s*manually approve edits/i, "Manual")
                            .replace(/Edit plan/i, "Edit")
                            .replace(/Allow always/i, "Always")
                            .replace(/永久允許/, "永久")
                            .slice(0, 12)
                          return (
                            <button key={opt.label} title={opt.label} disabled={resolvedFeedback.has(ev.id)} onClick={(e) => {
                              e.stopPropagation()
                              // Show feedback immediately
                              const fb = isDeny ? "denied" : "approved"
                              setResolvedFeedback(prev => new Map(prev).set(ev.id, fb))
                              // Send to PTY — split escape sequences with 150ms delay (MissionControl pattern)
                              const parts = opt.input.match(/\x1b\[[A-Z]|\x1b|\r|[^\x1b\r]+/g) || [opt.input]
                              parts.forEach((part, i) => {
                                setTimeout(() => send?.({ type: "session_input", sessionId: sid, data: part }), i * 150)
                              })
                              // Request scrollback reparse after approval (3s + 8s, like MissionControl)
                              setTimeout(() => send?.({ type: "scrollback_request", reparse: true }), 3000)
                              setTimeout(() => send?.({ type: "scrollback_request", reparse: true }), 8000)
                              // Remove from Live list after feedback shown
                              setTimeout(() => {
                                onResolvePermission?.(sid, ev.id)
                                setResolvedFeedback(prev => { const n = new Map(prev); n.delete(ev.id); return n })
                              }, 800)
                            }} style={{
                              padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer",
                              border: isDeny ? "1px solid rgba(248,113,113,0.3)" : "1px solid rgba(55,172,192,0.25)",
                              background: isDeny ? "rgba(248,113,113,0.08)" : "rgba(55,172,192,0.08)",
                              color: isDeny ? "rgb(248,113,113)" : "rgb(55,172,192)",
                            }}>{shortLabel}</button>
                          )
                        })}
                      </div>
                    </div>
                  ))
              }</>)}
              {permTab === "history" && (
                permissionHistory.length === 0
                  ? <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 12, color: textMuted }}>No recent permissions</div>
                  : permissionHistory.map(({ event: ev, sessionIdx }) => (
                    <div key={ev.id} style={{ padding: "6px 12px", borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"}` }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#37ACC0" }}>#{sessionIdx}</span>
                        <span style={{ fontSize: 12, color: textPrimary }}>{ev.decision?.purpose || ev.title}</span>
                        <span style={{ fontSize: 10, color: ev.status === "completed" ? "#BDD1C6" : "#FB8184", fontWeight: 600, marginLeft: "auto" }}>
                          {ev.status === "completed" ? "Approved" : "Denied"}
                        </span>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteProjectTarget}
        theme={theme}
        title={`Delete "${deleteProjectTarget?.name}"?`}
        message="This project will be removed from AgentRune. Files on disk will not be deleted."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          if (deleteProjectTarget && onDeleteProject) onDeleteProject(deleteProjectTarget.id)
          setDeleteProjectTarget(null)
        }}
        onCancel={() => setDeleteProjectTarget(null)}
      />
    </>
  )
}
