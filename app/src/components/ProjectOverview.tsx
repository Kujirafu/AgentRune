// components/ProjectOverview.tsx
// Home screen: 2-panel swipe — Panel 0 (Projects) / Panel 1 (Session Dashboard)
import React, { useState, useEffect, useRef } from "react"
import type { Project, AppSession, AgentEvent, ProgressReport } from "../types"
import { AGENTS } from "../types"
import { NewSessionSheet } from "./NewSessionSheet"
import { AutomationSheet } from "./AutomationSheet"
import { BUILTIN_TEMPLATES, TEMPLATE_GROUPS } from "../data/builtin-templates"
import type { AutomationTemplate } from "../data/automation-types"
import { useLocale } from "../lib/i18n"

const AGENTLORE_DEVICES_URL = "https://agentlore.vercel.app/api/agentrune/devices"


interface CloudDevice {
  id: string
  hostname: string
  localIp: string
  port: number
  status: string
  cloudSessionToken?: string
  tunnelUrl?: string
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
  onDeleteProject?: (projectId: string) => Promise<void>
  onNextStep?: (sessionId: string, step: string) => void
  onKillSession?: (sessionId: string) => void
  onSessionInput?: (sessionId: string, data: string) => void
  onCloudConnect?: (url: string, cloudSessionToken?: string) => void
  theme: "light" | "dark"
  toggleTheme: () => void
  wsConnected?: boolean
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

// Get a useful summary from events when no progress_report exists
function getEventSummary(events: AgentEvent[]): string {
  // Try progress report first
  const prog = getLatestProgress(events)
  if (prog?.summary) return prog.summary
  // Fallback: find latest response or meaningful event (skip user messages)
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.id.startsWith("usr_")) continue
    if (e.type === "response" && e.title) return e.title
    if (e.type === "file_edit" || e.type === "file_create") {
      const path = e.diff?.filePath || e.title?.replace(/^(Editing|Creating|Edited|Created)\s+/i, "") || ""
      return path ? `Editing ${path.split(/[/\\]/).pop()}` : e.title || ""
    }
    if (e.type === "command_run" && e.title) return e.title
    if (e.type === "error" && e.title) return e.title
  }
  return ""
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
function setSessionLabelStorage(id: string, label: string) {
  const labels = getSessionLabels()
  if (label) labels[id] = label; else delete labels[id]
  localStorage.setItem("agentrune_session_labels", JSON.stringify(labels))
}
function getAutoLabels(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem("agentrune_session_autolabels") || "{}") } catch { return {} }
}
function setAutoLabelStorage(id: string, label: string) {
  const labels = getAutoLabels()
  if (!labels[id] && label) { labels[id] = label; localStorage.setItem("agentrune_session_autolabels", JSON.stringify(labels)) }
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
  onDeleteProject,
  onNextStep,
  onKillSession,
  onSessionInput,
  onCloudConnect,
  theme,
  toggleTheme,
  wsConnected,
}: ProjectOverviewProps) {
  const [now, setNow] = useState(Date.now())
  const [showNewSheet, setShowNewSheet] = useState(false)
  const [sheetProjectId, setSheetProjectId] = useState<string | null>(null)
  const [contextProjectId, setContextProjectId] = useState<string | null>(null)
  const [cloudDevices, setCloudDevices] = useState<CloudDevice[]>([])
  const [showDevices, setShowDevices] = useState(false)
  const [showAutomation, setShowAutomation] = useState(false)
  const [automationProjectId, setAutomationProjectId] = useState<string | null>(null)
  const [automationCounts, setAutomationCounts] = useState<Map<string, number>>(new Map())
  const [projectAutomations, setProjectAutomations] = useState<Array<{ id: string; name: string; prompt: string; enabled: boolean; schedule: { type: string; timeOfDay?: string; weekdays?: number[]; intervalMinutes?: number }; templateId?: string; lastResult?: { status: string; startedAt: number; finishedAt?: number } }>>([])
  const [automationsLoading, setAutomationsLoading] = useState(false)
  const [contextSessionId, setContextSessionId] = useState<string | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [sessionTab, setSessionTab] = useState<"sessions" | "schedules" | "templates">("sessions")
  const { t, locale } = useLocale()
  const speechLang = locale === "zh-TW" ? "zh-TW" : "en-US"
  const tplName = (tmpl: AutomationTemplate) => {
    const key = tmpl.id.replace("builtin_", "")
    const translated = t(`tpl.${key}`)
    return translated !== `tpl.${key}` ? translated : tmpl.name
  }
  const tplDesc = (tmpl: AutomationTemplate) => {
    const key = tmpl.id.replace("builtin_", "")
    const translated = t(`tpl.${key}.desc`)
    return translated !== `tpl.${key}.desc` ? translated : tmpl.description
  }
  const [pinnedTemplateIds, setPinnedTemplateIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("agentrune_pinned_templates") || "[]") } catch { return [] }
  })
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null)
  const [tplSearch, setTplSearch] = useState("")
  const [tplGroup, setTplGroup] = useState<string | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  // Panel navigation (persisted to localStorage)
  const [panel, _setPanel] = useState(() => {
    const saved = localStorage.getItem("agentrune_panel")
    return saved === "1" ? 1 : 0
  })
  const [selectedProjectForSessions, _setSelectedProject] = useState<string | null>(() =>
    localStorage.getItem("agentrune_panel_project")
  )
  const setPanel = (p: number) => {
    _setPanel(p)
    localStorage.setItem("agentrune_panel", String(p))
  }
  const setSelectedProjectForSessions = (id: string | null) => {
    _setSelectedProject(id)
    if (id) localStorage.setItem("agentrune_panel_project", id)
    else localStorage.removeItem("agentrune_panel_project")
  }
  const [replySessionId, setReplySessionId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState("")

  // Voice input — phases: null → recording → cleaning → result
  // Uses native Capacitor SpeechRecognition plugin (Android/iOS)
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null)
  const [voicePhase, setVoicePhase] = useState<"recording" | "cleaning" | "result" | null>(null)
  const [voiceText, setVoiceText] = useState("")
  const [voicePartial, setVoicePartial] = useState("")
  const latestPartialRef = useRef("")
  const accumulatedTextRef = useRef("")
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const partialListenerRef = useRef<any>(null)
  const voiceEditOriginal = useRef("")
  const srRef = useRef<any>(null) // cached SpeechRecognition plugin — NEVER await this
  const permGrantedRef = useRef(false)
  const isRecordingRef = useRef(false)
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [voiceDuration, setVoiceDuration] = useState(0)

  // Load plugin module once
  useEffect(() => {
    import("@capacitor-community/speech-recognition").then(mod => {
      srRef.current = mod.SpeechRecognition
    }).catch(() => {})
  }, [])

  // Fetch automation counts per project (for project card summary)
  useEffect(() => {
    const serverUrl = localStorage.getItem("agentrune_server") || ""
    if (!serverUrl || projects.length === 0) return
    const counts = new Map<string, number>()
    Promise.all(projects.map(async (p) => {
      try {
        const res = await fetch(`${serverUrl}/api/automations/${p.id}`)
        if (res.ok) {
          const autos: { enabled: boolean }[] = await res.json()
          const enabled = autos.filter((a) => a.enabled).length
          if (enabled > 0) counts.set(p.id, enabled)
        }
      } catch { /* ignore */ }
    })).then(() => setAutomationCounts(new Map(counts)))
  }, [projects])

  // Fetch automations for selected project when Schedules tab is active
  useEffect(() => {
    if (sessionTab !== "schedules" || !selectedProjectForSessions) return
    const serverUrl = localStorage.getItem("agentrune_server") || ""
    if (!serverUrl) return
    setAutomationsLoading(true)
    fetch(`${serverUrl}/api/automations/${selectedProjectForSessions}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setProjectAutomations(Array.isArray(data) ? data : []))
      .catch(() => setProjectAutomations([]))
      .finally(() => setAutomationsLoading(false))
  }, [sessionTab, selectedProjectForSessions, showAutomation])

  const voiceCleanup = () => {
    if (voiceTimerRef.current) { clearInterval(voiceTimerRef.current); voiceTimerRef.current = null }
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null }
    partialListenerRef.current = null
  }

  // Auto-restart recognition when Android silence timeout kills it
  const voiceAutoRestart = () => {
    const SR = srRef.current
    if (!SR || !isRecordingRef.current) return
    if (latestPartialRef.current.trim()) {
      accumulatedTextRef.current = (accumulatedTextRef.current + " " + latestPartialRef.current).trim()
      latestPartialRef.current = ""
    }
    isRecordingRef.current = false
    setTimeout(() => {
      try { SR.start({ language: speechLang, partialResults: true, popup: false, maxResults: 3 }) } catch {}
      isRecordingRef.current = true
      if (watchdogRef.current) clearTimeout(watchdogRef.current)
      watchdogRef.current = setTimeout(voiceAutoRestart, 3000)
    }, 300)
  }

  const startVoice = (sessionId: string) => {
    const SR = srRef.current
    if (!SR) return

    voiceCleanup()
    latestPartialRef.current = ""
    accumulatedTextRef.current = ""
    setVoicePartial("")
    voiceEditOriginal.current = ""
    setVoiceSessionId(sessionId)
    setVoiceText("")
    setVoicePhase("recording")
    if (navigator.vibrate) navigator.vibrate(30)

    // Start timer immediately
    setVoiceDuration(0)
    const startTime = Date.now()
    voiceTimerRef.current = setInterval(() => {
      setVoiceDuration(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    const doStart = () => {
      const needsStop = isRecordingRef.current
      if (needsStop) { try { SR.stop() } catch {} }
      isRecordingRef.current = false

      const delay = needsStop ? 600 : 50
      setTimeout(() => {
        try {
          SR.addListener("partialResults", (data: { matches: string[] }) => {
            if (data.matches?.[0]) {
              latestPartialRef.current = data.matches[0]
              const displayText = (accumulatedTextRef.current + " " + data.matches[0]).trim()
              setVoicePartial(displayText)
            }
            // Reset watchdog on every partial result
            if (watchdogRef.current) clearTimeout(watchdogRef.current)
            watchdogRef.current = setTimeout(voiceAutoRestart, 3000)
          })
        } catch {}
        setTimeout(() => {
          try { SR.start({ language: speechLang, partialResults: true, popup: false, maxResults: 3 }) } catch {}
          isRecordingRef.current = true
          watchdogRef.current = setTimeout(voiceAutoRestart, 3000)
        }, 100)
      }, delay)
    }

    if (permGrantedRef.current) {
      doStart()
    } else {
      try {
        Promise.resolve(SR.checkPermissions()).then((perms: any) => {
          if (perms?.speechRecognition === "granted") {
            permGrantedRef.current = true
            doStart()
          } else {
            Promise.resolve(SR.requestPermissions()).then((req: any) => {
              if (req?.speechRecognition === "granted") { permGrantedRef.current = true; doStart() }
              else { voiceCleanup(); setVoicePhase("result"); setVoiceText("[需要麥克風權限]") }
            }).catch(() => { permGrantedRef.current = true; doStart() })
          }
        }).catch(() => { permGrantedRef.current = true; doStart() })
      } catch { permGrantedRef.current = true; doStart() }
    }
  }

  const callCleanupAPI = async (text: string, aid: string): Promise<string> => {
    const serverUrl = localStorage.getItem("agentrune_server") || ""
    if (!serverUrl) return text
    try {
      const res = await fetch(`${serverUrl}/api/voice-cleanup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, agentId: aid }),
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) { const data = await res.json(); return data.cleaned || text }
    } catch {}
    return text
  }

  const stopVoice = async () => {
    voiceCleanup()
    const SR = srRef.current
    if (SR && isRecordingRef.current) { try { SR.stop() } catch {} }
    isRecordingRef.current = false
    const raw = (accumulatedTextRef.current + " " + latestPartialRef.current).trim()
    accumulatedTextRef.current = ""
    if (!raw) { setVoiceText(""); setVoicePhase("result"); return }
    setVoicePhase("cleaning")
    const session = activeSessions.find(s => s.id === voiceSessionId)
    const aid = session?.agentId || "claude"
    const isEdit = !!voiceEditOriginal.current
    if (isEdit) {
      const serverUrl = localStorage.getItem("agentrune_server") || ""
      try {
        const res = await fetch(`${serverUrl}/api/voice-edit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ original: voiceEditOriginal.current, instruction: raw }),
          signal: AbortSignal.timeout(30000),
        })
        if (res.ok) {
          const data = await res.json()
          setVoiceText(data.edited || voiceEditOriginal.current)
          setVoicePhase("result"); return
        }
      } catch {}
      setVoiceText(voiceEditOriginal.current); setVoicePhase("result"); return
    }
    const cleaned = await callCleanupAPI(raw, aid)
    setVoiceText(cleaned)
    setVoicePhase("result")
  }

  const startVoiceEdit = () => {
    voiceEditOriginal.current = voiceText
    // Re-use startVoice with current session (it handles stop + restart)
    if (voiceSessionId) startVoice(voiceSessionId)
  }

  const sendVoice = () => {
    if (voiceSessionId && voiceText.trim() && onSessionInput) {
      onSessionInput(voiceSessionId, `[語音指令] ${voiceText.trim()}\n`)
      if (navigator.vibrate) navigator.vibrate(20)
    }
    voiceEditOriginal.current = ""
    setVoiceSessionId(null)
    setVoiceText("")
    setVoicePhase(null)
  }

  const cancelVoice = () => {
    voiceCleanup()
    const SR = srRef.current
    if (SR && isRecordingRef.current) { try { SR.stop() } catch {} }
    isRecordingRef.current = false
    latestPartialRef.current = ""
    voiceEditOriginal.current = ""
    setVoicePartial("")
    setVoiceSessionId(null)
    setVoiceText("")
    setVoicePhase(null)
  }
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchDeltaX = useRef(0)
  const swipingPanel = useRef(false)

  // Android back button — close overlays first
  useEffect(() => {
    const handler = (e: Event) => {
      if (multiSelectMode) { setMultiSelectMode(false); setSelectedSessionIds(new Set()); e.preventDefault(); return }
      if (renamingSessionId) { setRenamingSessionId(null); e.preventDefault(); return }
      if (contextSessionId) { setContextSessionId(null); e.preventDefault(); return }
      if (voiceSessionId) { cancelVoice(); e.preventDefault(); return }
      if (contextProjectId) { setContextProjectId(null); e.preventDefault(); return }
      if (replySessionId) { setReplySessionId(null); setReplyText(""); e.preventDefault(); return }
      if (showDevices) { setShowDevices(false); e.preventDefault(); return }
      if (showNewSheet) { setShowNewSheet(false); e.preventDefault(); return }
      if (showAutomation) { setShowAutomation(false); e.preventDefault(); return }
      if (panel === 1) { setPanel(0); e.preventDefault(); return }
    }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [voiceSessionId, contextProjectId, contextSessionId, renamingSessionId, replySessionId, showDevices, multiSelectMode, panel, showNewSheet, showAutomation])

  // Listen for voice trigger from MissionControl
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const sid = detail?.sessionId
      if (sid && !voiceSessionId) startVoice(sid)
    }
    document.addEventListener("agentrune:voice", handler)
    return () => document.removeEventListener("agentrune:voice", handler)
  }, [voiceSessionId])

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
  const getProjectSummary = (sessions: AppSession[]): string => {
    let latestText = ""
    let latestTs = 0
    for (const s of sessions) {
      const events = sessionEvents.get(s.id) || []
      const summary = getEventSummary(events)
      const ts = events.length > 0 ? events[events.length - 1].timestamp : 0
      if (summary && ts > latestTs) {
        latestText = summary
        latestTs = ts
      }
    }
    return latestText
  }

  const handleProjectTap = (projectId: string) => {
    const sessions = sessionsByProject.get(projectId) || []
    if (sessions.length === 0) {
      setSheetProjectId(projectId)
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

  const TAB_ORDER: Array<"sessions" | "schedules" | "templates"> = ["sessions", "schedules", "templates"]

  const handleTouchEnd = () => {
    if (!swipingPanel.current) return
    const threshold = 50
    if (panel === 1) {
      // In Panel 1: swipe between tabs
      const currentIdx = TAB_ORDER.indexOf(sessionTab)
      if (touchDeltaX.current < -threshold && currentIdx < TAB_ORDER.length - 1) {
        // Swipe left → next tab
        setSessionTab(TAB_ORDER[currentIdx + 1])
      } else if (touchDeltaX.current > threshold && currentIdx > 0) {
        // Swipe right → previous tab
        setSessionTab(TAB_ORDER[currentIdx - 1])
      }
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
  const autoLabels = getAutoLabels()

  // Auto-label sessions from first meaningful event summary
  useEffect(() => {
    for (const s of activeSessions) {
      if (labels[s.id] || autoLabels[s.id]) continue
      const events = sessionEvents.get(s.id) || []
      const summary = getEventSummary(events)
      if (summary && summary.length > 3) {
        const autoLabel = summary.length > 40 ? summary.slice(0, 40) + "..." : summary
        setAutoLabelStorage(s.id, autoLabel)
      }
    }
  }, [activeSessions, sessionEvents])

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
                {!wsConnected ? (
                  <>
                    <div style={{
                      width: 40, height: 40, borderRadius: "50%",
                      border: "3px solid var(--glass-border)",
                      borderTopColor: "#37ACC0",
                      animation: "spin 1s linear infinite",
                    }} />
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#37ACC0" }}>{t("overview.waitingForConnection")}</div>
                    <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
                  </>
                ) : (
                  <>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>No projects</div>
                  </>
                )}
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
                      {summary.length > 120 ? summary.slice(0, 120) + "..." : summary}
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

                  {/* Schedule + blocked indicators */}
                  {(() => {
                    const autoCount = automationCounts.get(project.id) || 0
                    const blockedCount = sessions.filter(s => {
                      const events = sessionEvents.get(s.id) || []
                      return getSessionStatus(events) === "blocked"
                    }).length
                    return (
                      <div style={{
                        display: "flex", gap: 10, marginLeft: 18, marginTop: 6,
                        fontSize: 11, color: "var(--text-secondary)",
                      }}>
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            setAutomationProjectId(project.id)
                            setShowAutomation(true)
                          }}
                          style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                          {autoCount > 0
                            ? <><span style={{ color: "#37ACC0" }}>{autoCount}</span> {t("automation.schedulesActive") || "schedules"}</>
                            : <span style={{ opacity: 0.6 }}>{t("automation.addSchedule") || "Add schedule"}</span>
                          }
                        </span>
                        {blockedCount > 0 && (
                          <span style={{ display: "flex", alignItems: "center", gap: 3, color: "#f59e0b" }}>
                            {blockedCount} blocked
                          </span>
                        )}
                      </div>
                    )
                  })()}
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
                {projects.find(p => p.id === selectedProjectForSessions)?.name || t("sessions.title")}
              </div>
              <div style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                fontWeight: 500,
                marginTop: 4,
              }}>
                {(() => {
                  const sessions = selectedProjectForSessions
                    ? (sessionsByProject.get(selectedProjectForSessions) || [])
                    : []
                  return `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`
                })()}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {multiSelectMode ? (
                <button
                  onClick={() => { setMultiSelectMode(false); setSelectedSessionIds(new Set()) }}
                  style={{
                    padding: "8px 16px", borderRadius: 20,
                    background: "var(--glass-bg)",
                    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--text-secondary)",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {t("sessions.cancel") || "Cancel"}
                </button>
              ) : (
                <>
                  {/* Theme toggle */}
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
                    {theme === "dark" ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                        <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                      </svg>
                    )}
                  </button>
                  {/* New schedule button */}
                  <button
                    onClick={() => {
                      setAutomationProjectId(selectedProjectForSessions)
                      setShowAutomation(true)
                      setTimeout(() => window.dispatchEvent(new CustomEvent("agentrune:automationAdd")), 100)
                    }}
                    style={{
                      width: 40, height: 40, borderRadius: "50%",
                      background: "var(--glass-bg)",
                      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                      border: "1px solid var(--glass-border)",
                      boxShadow: "var(--glass-shadow)",
                      color: "var(--text-secondary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer",
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /><line x1="15" y1="1" x2="15" y2="5" opacity="0.5" /><line x1="13" y1="3" x2="17" y2="3" opacity="0.5" /></svg>
                  </button>
                  {/* New session button */}
                  <button
                    onClick={() => {
                      setSheetProjectId(selectedProjectForSessions)
                      setShowNewSheet(true)
                    }}
                    style={{
                      width: 40, height: 40, borderRadius: "50%",
                      background: "var(--glass-bg)",
                      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                      border: "1px solid var(--glass-border)",
                      boxShadow: "var(--glass-shadow)",
                      color: "var(--text-primary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", fontSize: 20, fontWeight: 300,
                    }}
                  >
                    +
                  </button>
                </>
              )}
            </div>
          </div>
          {/* 3-tab pill: Sessions | Schedules | Templates */}
          <div style={{
            display: "flex", justifyContent: "center", padding: "6px 0 8px",
          }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 2,
              padding: "3px 4px", borderRadius: 10,
              background: "var(--icon-bg)",
              border: "none",
            }}>
              {([
                { key: "sessions" as const, label: t("sessions.tabSessions") || "Sessions" },
                { key: "schedules" as const, label: t("sessions.tabSchedules") || "Schedules" },
                { key: "templates" as const, label: t("sessions.tabTemplates") || "Templates" },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSessionTab(key)}
                  style={{
                    padding: "4px 14px", borderRadius: 8, fontSize: 11,
                    border: "none", cursor: "pointer",
                    background: sessionTab === key ? "var(--glass-border)" : "transparent",
                    color: sessionTab === key ? "var(--text-primary)" : "var(--text-secondary)",
                    fontWeight: sessionTab === key ? 700 : 500,
                    opacity: sessionTab === key ? 1 : 0.4,
                    transition: "all 0.3s ease",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px 12px 40px",
          }}>
            {/* ── Schedules Tab ── */}
            {sessionTab === "schedules" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 4px" }}>
                {automationsLoading && (
                  <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)", opacity: 0.5 }}>Loading...</div>
                )}

                {!automationsLoading && projectAutomations.length === 0 && (
                  <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", gap: 12, minHeight: 200,
                    color: "var(--text-secondary)",
                  }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
                      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{t("schedules.empty") || "No schedules yet"}</div>
                    <div style={{ fontSize: 12, opacity: 0.5 }}>{t("schedules.emptyHint") || "Tap the clock button to create one"}</div>
                  </div>
                )}

                {!automationsLoading && projectAutomations.map((auto) => {
                  const scheduleLabel = auto.schedule.type === "daily"
                    ? `${auto.schedule.timeOfDay || "09:00"} ${(auto.schedule.weekdays || []).map((d: number) => ["Su","Mo","Tu","We","Th","Fr","Sa"][d]).join(" ")}`
                    : `Every ${auto.schedule.intervalMinutes || 30}min`
                  return (
                    <div key={auto.id} style={{
                      padding: "12px 14px", borderRadius: 14,
                      border: auto.enabled ? "1px solid rgba(55,172,192,0.25)" : "1px solid var(--glass-border)",
                      background: "var(--glass-bg)",
                      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                      opacity: auto.enabled ? 1 : 0.5,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {/* Toggle */}
                        <button
                          onClick={async () => {
                            const serverUrl = localStorage.getItem("agentrune_server") || ""
                            try {
                              await fetch(`${serverUrl}/api/automations/${selectedProjectForSessions}/${auto.id}`, {
                                method: "PATCH", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ enabled: !auto.enabled }),
                              })
                              setProjectAutomations((prev) => prev.map((a) => a.id === auto.id ? { ...a, enabled: !a.enabled } : a))
                            } catch {}
                          }}
                          style={{
                            width: 40, height: 22, borderRadius: 11, padding: 2,
                            border: "none",
                            background: auto.enabled ? "#37ACC0" : "var(--glass-border)",
                            cursor: "pointer", transition: "background 0.2s",
                            display: "flex", alignItems: "center", flexShrink: 0,
                          }}
                        >
                          <div style={{
                            width: 18, height: 18, borderRadius: "50%",
                            background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                            transform: auto.enabled ? "translateX(18px)" : "translateX(0)",
                            transition: "transform 0.2s",
                          }} />
                        </button>

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {auto.name}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                            {scheduleLabel}
                          </div>
                        </div>

                        {/* Edit button */}
                        <button
                          onClick={() => {
                            setAutomationProjectId(selectedProjectForSessions)
                            setShowAutomation(true)
                            // TODO: pass edit ID to AutomationSheet
                          }}
                          style={{
                            width: 30, height: 30, borderRadius: 8,
                            border: "1px solid var(--glass-border)", background: "transparent",
                            color: "var(--text-secondary)", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>

                        {/* Delete button */}
                        <button
                          onClick={async () => {
                            const serverUrl = localStorage.getItem("agentrune_server") || ""
                            try {
                              await fetch(`${serverUrl}/api/automations/${selectedProjectForSessions}/${auto.id}`, { method: "DELETE" })
                              setProjectAutomations((prev) => prev.filter((a) => a.id !== auto.id))
                            } catch {}
                          }}
                          style={{
                            width: 30, height: 30, borderRadius: 8,
                            border: "none", background: "transparent",
                            color: "var(--text-secondary)", opacity: 0.4,
                            cursor: "pointer", display: "flex",
                            alignItems: "center", justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>

                      {/* Last result */}
                      {auto.lastResult && (
                        <div style={{
                          marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--glass-border)",
                          fontSize: 10, color: "var(--text-secondary)", display: "flex", gap: 8,
                        }}>
                          <span style={{
                            color: auto.lastResult.status === "success" ? "#22c55e" : "#ef4444",
                            fontWeight: 600,
                          }}>
                            {auto.lastResult.status === "success" ? "OK" : "FAIL"}
                          </span>
                          <span>{new Date(auto.lastResult.startedAt).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── Templates Tab ── */}
            {sessionTab === "templates" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 4px" }}>
                {/* Search bar */}
                <div style={{ position: "relative", marginBottom: 2 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", opacity: 0.6 }}>
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text" value={tplSearch} onChange={(e) => setTplSearch(e.target.value)}
                    placeholder={t("automation.searchTemplates") || "Search templates..."}
                    style={{
                      width: "100%", padding: "10px 14px 10px 34px", borderRadius: 12,
                      border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                      color: "var(--text-primary)", fontSize: 13, outline: "none", boxSizing: "border-box",
                    }}
                  />
                  {tplSearch && (
                    <button onClick={() => setTplSearch("")} style={{
                      position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4,
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Category chips */}
                <div style={{
                  display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6,
                  WebkitOverflowScrolling: "touch", scrollbarWidth: "none",
                }}>
                  <button onClick={() => setTplGroup(null)} style={{
                    padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer",
                    background: tplGroup === null ? "rgba(55, 172, 192, 0.15)" : "var(--icon-bg)",
                    color: tplGroup === null ? "#37ACC0" : "var(--text-secondary)",
                    fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
                  }}>
                    {t("automation.allCategories") || "All"}
                  </button>
                  {TEMPLATE_GROUPS.map((g) => (
                    <button key={g.key} onClick={() => setTplGroup(tplGroup === g.key ? null : g.key)} style={{
                      padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer",
                      background: tplGroup === g.key ? "rgba(55, 172, 192, 0.15)" : "var(--icon-bg)",
                      color: tplGroup === g.key ? "#37ACC0" : "var(--text-secondary)",
                      fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
                    }}>
                      {t(`tplGroup.${g.key}`) !== `tplGroup.${g.key}` ? t(`tplGroup.${g.key}`) : g.label}
                    </button>
                  ))}
                </div>

                {/* Template list — filtered */}
                {(() => {
                  const filtered = BUILTIN_TEMPLATES.filter((tmpl) => {
                    if (tplGroup && tmpl.group !== tplGroup) return false
                    if (tplSearch) {
                      const q = tplSearch.toLowerCase()
                      return tplName(tmpl).toLowerCase().includes(q)
                        || tplDesc(tmpl).toLowerCase().includes(q)
                        || (tmpl.tags || []).some((tag) => tag.includes(q))
                    }
                    return true
                  })

                  const renderCard = (tmpl: AutomationTemplate) => {
                    const isPinned = pinnedTemplateIds.includes(tmpl.id)
                    const isExpanded = expandedTemplateId === tmpl.id
                    return (
                      <div key={tmpl.id}>
                        <button
                          onClick={() => setExpandedTemplateId(isExpanded ? null : tmpl.id)}
                          style={{
                            width: "100%", textAlign: "left",
                            display: "flex", alignItems: "center", gap: 12,
                            padding: "12px 14px", borderRadius: isExpanded ? "14px 14px 0 0" : 14,
                            border: isPinned ? "1px solid rgba(55,172,192,0.25)" : "1px solid var(--glass-border)",
                            borderBottom: isExpanded ? "none" : undefined,
                            background: "var(--glass-bg)",
                            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ fontSize: 22, flexShrink: 0, width: 36, textAlign: "center" }}>{tmpl.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{tplName(tmpl)}</div>
                            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tplDesc(tmpl)}</div>
                          </div>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                        {isExpanded && (
                          <div style={{
                            padding: "10px 14px 12px", borderRadius: "0 0 14px 14px",
                            border: isPinned ? "1px solid rgba(55,172,192,0.25)" : "1px solid var(--glass-border)",
                            borderTop: "1px solid var(--glass-border)",
                            background: "var(--glass-bg)",
                            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                          }}>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 8 }}>
                              {tplDesc(tmpl)}
                            </div>
                            <div style={{
                              fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5,
                              background: "var(--icon-bg)", padding: "8px 10px", borderRadius: 10,
                              maxHeight: 120, overflowY: "auto", marginBottom: 10,
                              whiteSpace: "pre-wrap", wordBreak: "break-word",
                              fontFamily: "'JetBrains Mono', monospace", opacity: 0.8,
                            }}>
                              {tmpl.prompt}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              <button onClick={() => {
                                setExpandedTemplateId(null)
                                setAutomationProjectId(selectedProjectForSessions)
                                setShowAutomation(true)
                              }} style={{
                                padding: "6px 12px", borderRadius: 8,
                                border: "1px solid var(--glass-border)", background: "rgba(55,172,192,0.1)",
                                color: "#37ACC0", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                display: "flex", alignItems: "center", gap: 4,
                              }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                {t("templates.newSchedule") || "New Schedule"}
                              </button>
                              <button onClick={() => {
                                setExpandedTemplateId(null)
                                setSheetProjectId(selectedProjectForSessions)
                                setShowNewSheet(true)
                              }} style={{
                                padding: "6px 12px", borderRadius: 8,
                                border: "1px solid var(--glass-border)", background: "rgba(55,172,192,0.1)",
                                color: "var(--accent-primary)", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                display: "flex", alignItems: "center", gap: 4,
                              }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                                {t("templates.newSession") || "New Session"}
                              </button>
                              <button onClick={() => {
                                const next = isPinned ? pinnedTemplateIds.filter((id) => id !== tmpl.id) : [...pinnedTemplateIds, tmpl.id]
                                setPinnedTemplateIds(next)
                                localStorage.setItem("agentrune_pinned_templates", JSON.stringify(next))
                              }} style={{
                                padding: "6px 12px", borderRadius: 8,
                                border: "1px solid var(--glass-border)", background: isPinned ? "rgba(55,172,192,0.15)" : "transparent",
                                color: isPinned ? "#37ACC0" : "var(--text-secondary)", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                display: "flex", alignItems: "center", gap: 4,
                              }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                </svg>
                                {isPinned ? (t("templates.unpin") || "Unpin") : (t("templates.pin") || "Pin")}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  }

                  // When searching or filtering, flat list
                  if (tplSearch || tplGroup) {
                    return filtered.map(renderCard)
                  }

                  // Grouped display
                  return TEMPLATE_GROUPS.map((g) => {
                    const items = filtered.filter((tmpl) => tmpl.group === g.key)
                    if (items.length === 0) return null
                    return (
                      <div key={g.key} style={{ marginBottom: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1, opacity: 0.7 }}>
                          {t(`tplGroup.${g.key}`) !== `tplGroup.${g.key}` ? t(`tplGroup.${g.key}`) : g.label}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {items.map(renderCard)}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            )}

            {/* ── Sessions Tab ── */}
            {sessionTab === "sessions" && (() => {
              const sessions = selectedProjectForSessions
                ? (sessionsByProject.get(selectedProjectForSessions) || [])
                : []

              if (sessions.length === 0) {
                return (
                  <div style={{
                    flex: 1, display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: 16,
                    color: "var(--text-secondary)", minHeight: 200,
                  }}>
                    {!wsConnected ? (
                      <>
                        <div style={{
                          width: 40, height: 40, borderRadius: "50%",
                          border: "3px solid var(--glass-border)",
                          borderTopColor: "#37ACC0",
                          animation: "spin 1s linear infinite",
                        }} />
                        <div style={{ fontSize: 14, fontWeight: 500, color: "#37ACC0" }}>{t("overview.waitingForConnection")}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{t("sessions.noSessions")}</div>
                    )}
                    <button
                      onClick={() => {
                        setSheetProjectId(selectedProjectForSessions)
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

              return (
                <>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}>
                    {sessions.map((session) => {
                      const events = sessionEvents.get(session.id) || []
                      const status = getSessionStatus(events)
                      const dotStyle = STATUS_DOT[status] || STATUS_DOT.idle
                      const agentDef = AGENTS.find(a => a.id === session.agentId)
                      const label = labels[session.id]
                      const isBlocked = status === "blocked"
                      const summaryText = getEventSummary(events)
                      const statusLabel = status === "working" ? t("overview.statusWorking")
                        : status === "blocked" ? t("overview.statusBlocked")
                        : status === "done" ? t("overview.statusDone")
                        : ""

                      return (
                        <button
                          key={session.id}
                          onClick={() => {
                            if (longPressFired.current) return
                            if (multiSelectMode) {
                              setSelectedSessionIds(prev => {
                                const next = new Set(prev)
                                if (next.has(session.id)) next.delete(session.id); else next.add(session.id)
                                return next
                              })
                              return
                            }
                            if (isBlocked) {
                              setReplySessionId(session.id)
                              setExpandedSessionId(session.id)
                            } else {
                              onSelectSession(session.id)
                            }
                          }}
                          onTouchStart={() => {
                            longPressFired.current = false
                            longPressTimer.current = setTimeout(() => {
                              longPressFired.current = true
                              if (navigator.vibrate) navigator.vibrate(50)
                              setContextSessionId(session.id)
                            }, 500)
                          }}
                          onTouchEnd={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
                          onTouchMove={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
                          style={{
                            position: "relative",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            textAlign: "left",
                            aspectRatio: "1",
                            background: "var(--glass-bg)",
                            backdropFilter: "blur(20px)",
                            WebkitBackdropFilter: "blur(20px)",
                            borderRadius: 16,
                            border: isBlocked
                              ? "1.5px solid rgba(239,68,68,0.3)"
                              : "1px solid var(--glass-border)",
                            boxShadow: `inset 0 0 20px -6px ${dotStyle.glow}, var(--glass-shadow)`,
                            padding: 14,
                            cursor: "pointer",
                            transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                            overflow: "hidden",
                          }}
                        >
                          {/* Multi-select checkbox */}
                          {multiSelectMode && (
                            <div style={{
                              position: "absolute", top: 8, right: 8,
                              width: 22, height: 22, borderRadius: 6,
                              background: selectedSessionIds.has(session.id) ? "var(--accent-primary)" : "var(--glass-bg)",
                              border: selectedSessionIds.has(session.id) ? "2px solid var(--accent-primary)" : "2px solid var(--glass-border)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              transition: "all 0.2s",
                            }}>
                              {selectedSessionIds.has(session.id) && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </div>
                          )}
                          {/* Top: status dot + name */}
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                              <div style={{
                                width: 7, height: 7, borderRadius: "50%",
                                background: dotStyle.color,
                                boxShadow: dotStyle.shadow,
                                flexShrink: 0,
                              }} />
                              <div style={{
                                fontWeight: 600, fontSize: 13, color: "var(--text-primary)",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}>
                                {label || autoLabels[session.id] || agentDef?.name || session.agentId}
                              </div>
                            </div>
                            {/* Summary + next steps + tasks */}
                            {(() => {
                              const prog = getLatestProgress(events)
                              return (
                                <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5, overflow: "hidden" }}>
                                  {statusLabel && (
                                    <span style={{
                                      fontSize: 9, fontWeight: 700,
                                      textTransform: "uppercase" as const, letterSpacing: 0.5,
                                      color: dotStyle.color, marginRight: 4,
                                    }}>
                                      {statusLabel}
                                    </span>
                                  )}
                                  <span style={{
                                    display: "-webkit-box", WebkitLineClamp: 2,
                                    WebkitBoxOrient: "vertical" as never, overflow: "hidden",
                                  }}>
                                    {summaryText || t("mc.sessionStarted")}
                                  </span>
                                  {/* Next steps (max 2) */}
                                  {prog?.nextSteps && prog.nextSteps.length > 0 && (
                                    <div style={{ marginTop: 4, fontSize: 10, opacity: 0.8 }}>
                                      {prog.nextSteps.slice(0, 2).map((step, i) => (
                                        <div key={i} style={{ display: "flex", gap: 3, alignItems: "flex-start" }}>
                                          <span style={{ opacity: 0.5 }}>-</span>
                                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{step}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {/* Details (truncated, tap card to see full) */}
                                  {prog?.details && typeof prog.details === "string" && prog.details.length > 0 && (
                                    <div style={{
                                      marginTop: 3, fontSize: 9, opacity: 0.5,
                                      display: "-webkit-box", WebkitLineClamp: 2,
                                      WebkitBoxOrient: "vertical" as never, overflow: "hidden",
                                    }}>
                                      {prog.details}
                                    </div>
                                  )}
                                </div>
                              )
                            })()}
                          </div>
                          {/* Bottom: branch/id + time */}
                          <div style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            marginTop: 8,
                          }}>
                            <div style={{
                              fontSize: 10, color: "var(--text-secondary)", opacity: 0.6,
                              fontFamily: "'JetBrains Mono', monospace",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              maxWidth: "70%",
                            }}>
                              {session.worktreeBranch
                                ? session.worktreeBranch.replace(/^agentrune\//, "")
                                : session.id.slice(0, 6)}
                            </div>
                            {isBlocked ? (
                              <div style={{
                                fontSize: 9, fontWeight: 700,
                                padding: "2px 6px", borderRadius: 6,
                                background: "rgba(239,68,68,0.12)",
                                color: "#ef4444",
                              }}>
                                {t("sessions.blocked")}
                              </div>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); startVoice(session.id) }}
                                onTouchStart={(e) => e.stopPropagation()}
                                style={{
                                  width: 28, height: 28, borderRadius: 8,
                                  border: "1px solid var(--glass-border)",
                                  background: "var(--glass-bg)",
                                  backdropFilter: "blur(8px)",
                                  WebkitBackdropFilter: "blur(8px)",
                                  color: "var(--text-secondary)",
                                  cursor: "pointer",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  flexShrink: 0,
                                }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                  <line x1="12" y1="19" x2="12" y2="23" />
                                  <line x1="8" y1="23" x2="16" y2="23" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {/* Inline reply — shows below grid when a blocked session is tapped */}
                  {replySessionId && (
                    <div style={{
                      marginTop: 10,
                      padding: 12,
                      background: "var(--glass-bg)",
                      backdropFilter: "blur(20px)",
                      WebkitBackdropFilter: "blur(20px)",
                      borderRadius: 16,
                      border: "1.5px solid rgba(239,68,68,0.3)",
                    }}>
                      {/* Show full blocked message */}
                      {(() => {
                        const s = sessions.find(s => s.id === replySessionId)
                        const ev = sessionEvents.get(replySessionId) || []
                        const summaryTxt = getEventSummary(ev)
                        const lbl = s ? (labels[s.id] || AGENTS.find(a => a.id === s.agentId)?.name || s.agentId) : ""
                        return (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
                              {lbl}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                              {summaryTxt}
                            </div>
                          </div>
                        )
                      })()}
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          autoFocus
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleInlineReply(replySessionId) }}
                          placeholder={t("sessions.replyPlaceholder")}
                          style={{
                            flex: 1, padding: "8px 12px", borderRadius: 10,
                            border: "1px solid var(--glass-border)",
                            background: "var(--icon-bg)", color: "var(--text-primary)",
                            fontSize: 13, outline: "none", boxSizing: "border-box",
                          }}
                        />
                        <button
                          onClick={() => handleInlineReply(replySessionId)}
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
                        <button
                          onClick={() => { setReplySessionId(null); setReplyText("") }}
                          style={{
                            width: 34, height: 34, borderRadius: 10,
                            border: "1px solid var(--glass-border)",
                            background: "transparent",
                            color: "var(--text-secondary)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer", fontSize: 16,
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Multi-select action bar */}
      {multiSelectMode && (
        <div style={{
          position: "fixed",
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
          left: 12, right: 12,
          zIndex: 300,
          display: "flex", flexDirection: "column", gap: 8,
          padding: "12px 14px",
          borderRadius: 20,
          background: "var(--card-bg)",
          backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--glass-border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        }}>
          {/* Top row: count + select all */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginRight: "auto" }}>
              {selectedSessionIds.size} {t("sessions.selected")}
            </span>
            <button
              onClick={() => {
                const sessions = selectedProjectForSessions
                  ? (sessionsByProject.get(selectedProjectForSessions) || [])
                  : []
                setSelectedSessionIds(new Set(sessions.map(s => s.id)))
              }}
              style={{
                padding: "6px 12px", borderRadius: 10,
                border: "1px solid var(--glass-border)",
                background: "var(--glass-bg)",
                color: "var(--text-primary)", fontSize: 12, fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("sessions.selectAll") || "All"}
            </button>
          </div>
          {/* Action buttons row */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {/* Summary — show project summary */}
            <button
              disabled={selectedSessionIds.size === 0}
              onClick={() => {
                selectedSessionIds.forEach(id => onSessionInput?.(id, "/summary\n"))
                setMultiSelectMode(false)
                setSelectedSessionIds(new Set())
              }}
              style={{
                padding: "8px 12px", borderRadius: 10,
                border: "1px solid var(--glass-border)",
                background: "var(--glass-bg)",
                color: selectedSessionIds.size > 0 ? "var(--text-primary)" : "var(--text-secondary)",
                fontSize: 12, fontWeight: 600,
                cursor: selectedSessionIds.size > 0 ? "pointer" : "default",
                opacity: selectedSessionIds.size > 0 ? 1 : 0.4,
              }}
            >
              {t("sessions.batchSummary")}
            </button>
            {/* Next Step */}
            <button
              disabled={selectedSessionIds.size === 0}
              onClick={() => {
                selectedSessionIds.forEach(id => onSessionInput?.(id, "繼續下一步\n"))
                setMultiSelectMode(false)
                setSelectedSessionIds(new Set())
              }}
              style={{
                padding: "8px 12px", borderRadius: 10,
                border: "1px solid var(--glass-border)",
                background: "var(--glass-bg)",
                color: selectedSessionIds.size > 0 ? "var(--text-primary)" : "var(--text-secondary)",
                fontSize: 12, fontWeight: 600,
                cursor: selectedSessionIds.size > 0 ? "pointer" : "default",
                opacity: selectedSessionIds.size > 0 ? 1 : 0.4,
              }}
            >
              {t("sessions.batchNextStep")}
            </button>
            {/* Merge to main */}
            <button
              disabled={selectedSessionIds.size === 0}
              onClick={() => {
                selectedSessionIds.forEach(id => onSessionInput?.(id, "請合併到 main branch\n"))
                setMultiSelectMode(false)
                setSelectedSessionIds(new Set())
              }}
              style={{
                padding: "8px 12px", borderRadius: 10,
                border: "1px solid var(--glass-border)",
                background: "var(--glass-bg)",
                color: selectedSessionIds.size > 0 ? "var(--text-primary)" : "var(--text-secondary)",
                fontSize: 12, fontWeight: 600,
                cursor: selectedSessionIds.size > 0 ? "pointer" : "default",
                opacity: selectedSessionIds.size > 0 ? 1 : 0.4,
              }}
            >
              {t("sessions.batchMerge")}
            </button>
            {/* Terminate */}
            <button
              disabled={selectedSessionIds.size === 0}
              onClick={() => {
                selectedSessionIds.forEach(id => onKillSession?.(id))
                setSelectedSessionIds(new Set())
                setMultiSelectMode(false)
              }}
              style={{
                padding: "8px 12px", borderRadius: 10,
                border: "1px solid rgba(239,68,68,0.3)",
                background: "rgba(239,68,68,0.1)",
                color: selectedSessionIds.size > 0 ? "#ef4444" : "var(--text-secondary)",
                fontSize: 12, fontWeight: 700,
                cursor: selectedSessionIds.size > 0 ? "pointer" : "default",
                opacity: selectedSessionIds.size > 0 ? 1 : 0.4,
              }}
            >
              {t("sessions.killSelected")}
            </button>
          </div>
        </div>
      )}


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
                  setSheetProjectId(proj.id)
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

              {actionRow({
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
                label: t("overview.automations"),
                desc: t("overview.automationsDesc"),
                onClick: () => {
                  setContextProjectId(null)
                  setAutomationProjectId(contextProjectId)
                  setShowAutomation(true)
                },
              })}

              {actionRow({
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>,
                label: t("health.title"),
                desc: t("health.noData"),
                onClick: () => {
                  setContextProjectId(null)
                  window.dispatchEvent(new CustomEvent("agentrune:healthScan", {
                    detail: { projectId: contextProjectId },
                  }))
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

      {/* Session long-press context menu */}
      {contextSessionId && (() => {
        const session = activeSessions.find(s => s.id === contextSessionId)
        if (!session) return null
        const agentDef = AGENTS.find(a => a.id === session.agentId)
        const currentLabel = labels[contextSessionId] || autoLabels[contextSessionId] || agentDef?.name || session.agentId

        return (
          <>
            <div
              onClick={() => setContextSessionId(null)}
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
                {currentLabel}
              </div>

              {/* Rename */}
              {renamingSessionId === contextSessionId ? (
                <div style={{ padding: "8px 20px 16px", display: "flex", gap: 8 }}>
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && renameValue.trim()) {
                        setSessionLabelStorage(contextSessionId, renameValue.trim())
                        setRenamingSessionId(null)
                        setContextSessionId(null)
                      }
                    }}
                    placeholder={currentLabel}
                    style={{
                      flex: 1, padding: "10px 14px", borderRadius: 12,
                      border: "1px solid var(--glass-border)",
                      background: "var(--glass-bg)", color: "var(--text-primary)",
                      fontSize: 14, outline: "none",
                    }}
                  />
                  <button
                    onClick={() => {
                      if (renameValue.trim()) {
                        setSessionLabelStorage(contextSessionId, renameValue.trim())
                      }
                      setRenamingSessionId(null)
                      setContextSessionId(null)
                    }}
                    style={{
                      padding: "10px 16px", borderRadius: 12,
                      border: "none", background: "var(--accent-primary)",
                      color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    OK
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setRenameValue(labels[contextSessionId] || "")
                    setRenamingSessionId(contextSessionId)
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 16,
                    width: "100%", padding: "14px 20px",
                    background: "transparent", border: "none",
                    color: "var(--text-primary)", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--text-secondary)",
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{t("sessions.rename") || "Rename"}</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{t("sessions.renameDesc") || "Give this session a custom name"}</div>
                  </div>
                </button>
              )}

              {/* Open session */}
              <button
                onClick={() => { setContextSessionId(null); onSelectSession(contextSessionId) }}
                style={{
                  display: "flex", alignItems: "center", gap: 16,
                  width: "100%", padding: "14px 20px",
                  background: "transparent", border: "none",
                  color: "var(--text-primary)", cursor: "pointer", textAlign: "left",
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--text-secondary)",
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t("sessions.open") || "Open"}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{t("sessions.openDesc") || "Switch to this session"}</div>
                </div>
              </button>

              {/* Snapshot */}
              <button
                onClick={() => {
                  const name = `snap-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}`
                  if (onSessionInput) {
                    // Use WS to create snapshot — we don't have direct send here,
                    // so dispatch a custom event that App.tsx can handle
                    window.dispatchEvent(new CustomEvent("agentrune:snapshot", {
                      detail: { sessionId: contextSessionId, name },
                    }))
                  }
                  setContextSessionId(null)
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 16,
                  width: "100%", padding: "14px 20px",
                  background: "transparent", border: "none",
                  color: "var(--text-primary)", cursor: "pointer", textAlign: "left",
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--text-secondary)",
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t("snapshot.create")}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{t("snapshot.name")}</div>
                </div>
              </button>

              {/* Voice */}
              <button
                onClick={() => {
                  setContextSessionId(null)
                  startVoice(contextSessionId)
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 16,
                  width: "100%", padding: "14px 20px",
                  background: "transparent", border: "none",
                  color: "var(--text-primary)", cursor: "pointer", textAlign: "left",
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--text-secondary)",
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t("voice.tapToSpeak")}</div>
                </div>
              </button>

              {/* Schedule */}
              <button
                onClick={() => {
                  setContextSessionId(null)
                  setAutomationProjectId(session.projectId)
                  setShowAutomation(true)
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 16,
                  width: "100%", padding: "14px 20px",
                  background: "transparent", border: "none",
                  color: "var(--text-primary)", cursor: "pointer", textAlign: "left",
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--text-secondary)",
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t("automation.title")}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{t("automation.noAutomationsHint")}</div>
                </div>
              </button>

              {/* Kill session */}
              <button
                onClick={() => {
                  onKillSession?.(contextSessionId)
                  setContextSessionId(null)
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 16,
                  width: "100%", padding: "14px 20px",
                  background: "transparent", border: "none",
                  color: "#ef4444", cursor: "pointer", textAlign: "left",
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#ef4444",
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t("overview.killAll") || "Terminate"}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{t("sessions.killDesc") || "Stop this session"}</div>
                </div>
              </button>

              <button
                onClick={() => { setContextSessionId(null); setRenamingSessionId(null) }}
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
        selectedProject={sheetProjectId || selectedProjectForSessions || selectedProject}
        onClose={() => { setShowNewSheet(false); setSheetProjectId(null) }}
        onLaunch={onLaunch}
        onNewProject={onNewProject}
        onDeleteProject={onDeleteProject}
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
                  const url = device.tunnelUrl || `http://${device.localIp}:${device.port}`
                  const isOnline = device.status === "ONLINE"
                  const currentServer = localStorage.getItem("agentrune_server") || ""
                  const isConnected = (currentServer === url || currentServer === `http://${device.localIp}:${device.port}`) && !!localStorage.getItem("agentrune_cloud_token")
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
                          {device.tunnelUrl ? new URL(device.tunnelUrl).hostname : `${device.localIp}:${device.port}`}
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

      <AutomationSheet
        open={showAutomation}
        projectId={automationProjectId || ""}
        serverUrl={localStorage.getItem("agentrune_server") || ""}
        onClose={() => setShowAutomation(false)}
      />

      {/* Voice Overlay — single container, stopPropagation on interactive content */}
      {voiceSessionId && voicePhase && (
        <div onClick={cancelVoice} style={{
          position: "fixed", inset: 0, zIndex: 300,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        }}>
          {voicePhase === "recording" && (
            <>
              <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
                <div className="voice-orb voice-orb-teal" />
                <div className="voice-orb voice-orb-coral" />
                <div className="voice-orb voice-orb-purple" />
              </div>
              <div onClick={(e) => e.stopPropagation()} style={{
                position: "absolute", bottom: "calc(20vh + env(safe-area-inset-bottom, 0px))",
                left: 0, right: 0,
                display: "flex", flexDirection: "column", alignItems: "center",
              }}>
                {voicePartial && (
                  <div style={{
                    marginBottom: 20, padding: "10px 16px", borderRadius: 14,
                    background: "rgba(255,255,255,0.08)", backdropFilter: "blur(8px)",
                    color: "rgba(255,255,255,0.85)", fontSize: 15, lineHeight: 1.5,
                    maxHeight: 120, maxWidth: "80vw", overflow: "auto", textAlign: "left",
                  }}>
                    {voicePartial}
                  </div>
                )}
                <button onClick={(e) => { e.stopPropagation(); stopVoice() }} className="voice-stop-btn" style={{
                  width: 80, height: 80, borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.3)",
                  background: "rgba(255,255,255,0.1)",
                  backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                  color: "#fff", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 40px rgba(55,172,192,0.3), 0 0 80px rgba(251,129,132,0.15)",
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="white" stroke="none">
                    <rect x="5" y="5" width="14" height="14" rx="3" />
                  </svg>
                </button>
                <div style={{ marginTop: 16, color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: 500 }}>
                  {t("voice.tapToStop")}
                </div>
                <div style={{ marginTop: 8, color: "rgba(255,255,255,0.5)", fontSize: 24, fontWeight: 300, fontVariantNumeric: "tabular-nums" }}>
                  {Math.floor(voiceDuration / 60)}:{(voiceDuration % 60).toString().padStart(2, "0")}
                </div>
              </div>
            </>
          )}

          {voicePhase === "cleaning" && (
            <div onClick={(e) => e.stopPropagation()} style={{
              position: "absolute", inset: 0,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            }}>
              <span className="voice-spin" style={{
                width: 40, height: 40, border: "3px solid rgba(255,255,255,0.2)",
                borderTopColor: "#37ACC0", borderRadius: "50%", display: "inline-block",
              }} />
              <div style={{ marginTop: 16, color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: 500 }}>
                {t("voice.cleaning")}
              </div>
            </div>
          )}

          {voicePhase === "result" && (
            <div onClick={(e) => e.stopPropagation()} style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              borderRadius: "24px 24px 0 0",
              backgroundImage: "var(--sheet-bg)",
              backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
              border: "1px solid var(--glass-border)",
              boxShadow: "0 -8px 40px rgba(0,0,0,0.1)",
              padding: "16px 20px calc(16px + env(safe-area-inset-bottom, 0px))",
            }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--text-secondary)", opacity: 0.3, margin: "0 auto 12px" }} />
              {voiceText ? (
                <textarea value={voiceText} onChange={(e) => setVoiceText(e.target.value)} rows={4}
                  style={{
                    width: "100%", padding: "12px 14px", borderRadius: 14,
                    border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                    color: "var(--text-primary)", fontSize: 14, lineHeight: 1.5,
                    outline: "none", boxSizing: "border-box", resize: "none", marginBottom: 12,
                  }} />
              ) : (
                <div style={{ padding: "16px", textAlign: "center", color: "var(--text-secondary)", fontSize: 14, marginBottom: 12 }}>
                  {t("voice.noContent")}
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                {voiceText.trim() && (
                  <button onClick={startVoiceEdit} style={{
                    padding: "12px 16px", borderRadius: 14,
                    border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                    color: "#37ACC0", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    </svg>
                    {t("voice.tapToEdit")}
                  </button>
                )}
                <button onClick={() => { if (voiceSessionId) startVoice(voiceSessionId) }} style={{
                  flex: voiceText.trim() ? undefined : 1, padding: "12px 16px", borderRadius: 14,
                  border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                  color: "var(--text-secondary)", fontSize: 13, fontWeight: 500, cursor: "pointer",
                }}>
                  {t("voice.reRecord")}
                </button>
                {voiceText.trim() && (
                  <button onClick={sendVoice} style={{
                    flex: 1, padding: "12px", borderRadius: 14,
                    border: "1px solid rgba(251,129,132,0.4)",
                    background: "linear-gradient(135deg, rgba(251,129,132,0.18), rgba(208,152,153,0.14))",
                    color: "#FB8184", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    {t("voice.send")}
                  </button>
                )}
              </div>
            </div>
          )}

          <style>{`
            .voice-orb { position: absolute; width: 160px; height: 160px; border-radius: 50%; filter: blur(40px); will-change: transform, opacity; opacity: 0.8; }
            .voice-orb-teal { background: radial-gradient(circle, #37ACC0, rgba(52,119,146,0.4) 60%, transparent 80%); box-shadow: 0 0 60px rgba(55,172,192,0.5); animation: orbWander1 8s ease-in-out infinite, orbPulse 3s ease-in-out infinite; }
            .voice-orb-coral { background: radial-gradient(circle, #FB8184, rgba(208,152,153,0.4) 60%, transparent 80%); box-shadow: 0 0 60px rgba(251,129,132,0.5); animation: orbWander2 9s ease-in-out infinite, orbPulse 3.5s ease-in-out infinite 0.8s; }
            .voice-orb-purple { background: radial-gradient(circle, #a78bfa, rgba(139,92,246,0.3) 60%, transparent 80%); box-shadow: 0 0 50px rgba(139,92,246,0.4); width: 120px; height: 120px; animation: orbWander3 7s ease-in-out infinite, orbPulse 2.8s ease-in-out infinite 1.5s; }
            @keyframes orbPulse { 0%, 100% { transform: scale(1); filter: blur(40px); opacity: 0.7; } 30% { transform: scale(1.3); filter: blur(30px); opacity: 1; } 70% { transform: scale(0.85); filter: blur(50px); opacity: 0.5; } }
            @keyframes orbWander1 { 0% { top: 15%; left: 10%; } 20% { top: 60%; left: 65%; } 40% { top: 30%; left: 75%; } 60% { top: 70%; left: 20%; } 80% { top: 10%; left: 50%; } 100% { top: 15%; left: 10%; } }
            @keyframes orbWander2 { 0% { top: 70%; left: 75%; } 25% { top: 20%; left: 30%; } 50% { top: 50%; left: 5%; } 75% { top: 80%; left: 60%; } 100% { top: 70%; left: 75%; } }
            @keyframes orbWander3 { 0% { top: 40%; left: 45%; } 33% { top: 15%; left: 80%; } 66% { top: 75%; left: 15%; } 100% { top: 40%; left: 45%; } }
            .voice-stop-btn { animation: stopBtnGlow 2s ease-in-out infinite; }
            @keyframes stopBtnGlow { 0%, 100% { box-shadow: 0 0 40px rgba(55,172,192,0.3), 0 0 80px rgba(251,129,132,0.15); } 50% { box-shadow: 0 0 60px rgba(55,172,192,0.5), 0 0 100px rgba(251,129,132,0.25); } }
            @keyframes voiceSpin { to { transform: rotate(360deg); } }
            .voice-spin { animation: voiceSpin 0.8s linear infinite; }
          `}</style>
        </div>
      )}
    </div>
  )
}
