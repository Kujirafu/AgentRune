// components/UnifiedPanel.tsx
// Unified home screen: 3 top-level tabs (Projects / Schedules / Templates)
// Replaces the 2-panel ProjectOverview with a single vertical-scrolling page.
import React, { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import type { Project, AppSession, AgentEvent, ProgressReport } from "../types"
import { AGENTS } from "../types"
import { NewSessionSheet } from "./NewSessionSheet"
import { AutomationSheet } from "./AutomationSheet"
import AutomationReportSheet from "./AutomationReportSheet"
import { BUILTIN_TEMPLATES } from "../data/builtin-templates"
import { CHAIN_TEMPLATES, BUILTIN_CREWS } from "../data/builtin-crews"
import type { AutomationResult, AutomationTemplate } from "../data/automation-types"
import type { ChainDepth } from "../lib/skillChains"
import { BUILTIN_CHAINS, isParallelGroup, resolveChainText, estimateTokens, getStepCount } from "../lib/skillChains"
import { useLocale } from "../lib/i18n"
import { trackProjectSwitch, trackTabSwitch } from "../lib/analytics"
import { ChainBuilder } from "./ChainBuilder"
import { PrdPage } from "./PrdPage"
import { buildApiUrl, canUseApi } from "../lib/storage"
import { buildAutomationReport } from "../lib/automation-report"

// --- Crew role icons (Lucide SVG, white on colored circle) ---
const _s = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "#fff", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
const CREW_ROLE_ICONS: Record<string, React.ReactNode> = {
  target: <svg {..._s}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  code: <svg {..._s}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  "shield-check": <svg {..._s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>,
  wrench: <svg {..._s}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
  megaphone: <svg {..._s}><path d="M3 11l18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/></svg>,
  rocket: <svg {..._s}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/></svg>,
  "shield-alert": <svg {..._s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  bug: <svg {..._s}><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M2 10h4"/><path d="M18 10h4"/><path d="M2 14h4"/><path d="M18 14h4"/><path d="M6 6l-2-2"/><path d="M18 6l2-2"/></svg>,
  brain: <svg {..._s}><path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44A2.5 2.5 0 012 17.5v0A2.5 2.5 0 014.5 15 2.5 2.5 0 012 12.5v0A2.5 2.5 0 014.5 10a2.5 2.5 0 01-2-4A2.5 2.5 0 019.5 2z"/><path d="M14.5 2A2.5 2.5 0 0012 4.5v15a2.5 2.5 0 004.96.44A2.5 2.5 0 0022 17.5v0a2.5 2.5 0 00-2.5-2.5A2.5 2.5 0 0022 12.5v0a2.5 2.5 0 00-2.5-2.5 2.5 2.5 0 002-4A2.5 2.5 0 0014.5 2z"/></svg>,
  search: <svg {..._s}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  "check-circle": <svg {..._s}><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  lightbulb: <svg {..._s}><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>,
  boxes: <svg {..._s}><path d="M2.97 12.92A2 2 0 002 14.63v3.24a2 2 0 001.02 1.75l3.5 1.99a2 2 0 001.96.01l3.5-1.97a2 2 0 001.02-1.75v-3.24a2 2 0 00-.97-1.71L7.58 11a2 2 0 00-2.05.01z"/></svg>,
  "test-tubes": <svg {..._s}><path d="M9 2v17.5A2.5 2.5 0 0011.5 22v0a2.5 2.5 0 002.5-2.5V2"/><path d="M20 2v17.5a2.5 2.5 0 01-2.5 2.5v0a2.5 2.5 0 01-2.5-2.5V2"/></svg>,
  "pen-tool": <svg {..._s}><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>,
  "layout-list": <svg {..._s}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  "file-text": <svg {..._s}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  lock: <svg {..._s}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  "trending-up": <svg {..._s}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  "clipboard-list": <svg {..._s}><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>,
  scale: <svg {..._s}><line x1="12" y1="3" x2="12" y2="21"/><path d="M4 8l4 6H0L4 8z"/><path d="M20 8l4 6h-8l4-6z"/><line x1="4" y1="3" x2="20" y2="3"/></svg>,
}
function getCrewRoleIcon(iconName: string) {
  return CREW_ROLE_ICONS[iconName] || <svg {..._s}><circle cx="12" cy="12" r="10"/></svg>
}

// Template type classifiers (shared between filter chips and grouping)
const isCrew = (tmpl: AutomationTemplate) => tmpl.category === "crew" && (tmpl.crew?.roles?.length || 0) > 1
const isChain = (tmpl: AutomationTemplate) => tmpl.id.startsWith("chain_")
const isPrompt = (tmpl: AutomationTemplate) => !isChain(tmpl) && !isCrew(tmpl)

// Map builtin template IDs → { CREW_ROLE_ICONS key, circle color }
const BUILTIN_TPL_ICON: Record<string, { icon: string; color: string }> = {
  scan_commits: { icon: "search", color: "#37ACC0" },
  release_notes: { icon: "clipboard-list", color: "#347792" },
  standup: { icon: "lightbulb", color: "#f59e0b" },
  pr_review: { icon: "search", color: "#347792" },
  ci_failures: { icon: "wrench", color: "#f59e0b" },
  test_coverage: { icon: "test-tubes", color: "#3b82f6" },
  dep_check: { icon: "boxes", color: "#a78bfa" },
  security_scan: { icon: "shield-check", color: "#ef4444" },
  env_audit: { icon: "lock", color: "#ef4444" },
  dead_code: { icon: "pen-tool", color: "#3b82f6" },
  todo_sweep: { icon: "clipboard-list", color: "#f59e0b" },
  type_safety: { icon: "lock", color: "#3b82f6" },
  weekly_summary: { icon: "file-text", color: "#347792" },
  changelog: { icon: "pen-tool", color: "#347792" },
  api_docs: { icon: "code", color: "#37ACC0" },
  onboarding_doc: { icon: "file-text", color: "#22c55e" },
  perf_audit: { icon: "trending-up", color: "#a78bfa" },
  bundle_size: { icon: "boxes", color: "#a78bfa" },
  error_digest: { icon: "shield-alert", color: "#FB8184" },
  db_migration: { icon: "boxes", color: "#FB8184" },
  skill_suggest: { icon: "target", color: "#37ACC0" },
  agentlore_sync: { icon: "brain", color: "#37ACC0" },
  agentlore_skill_audit: { icon: "wrench", color: "#37ACC0" },
  release_check: { icon: "check-circle", color: "#22c55e" },
}

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

interface UnifiedPanelProps {
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
  send?: (msg: Record<string, unknown>) => boolean
  theme: "light" | "dark"
  toggleTheme: () => void
  wsConnected?: boolean
  onOpenBuilder?: () => void
}

// --- Helpers (migrated from ProjectOverview) ---

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

function isLabelNoise(title: string): boolean {
  if (/^\d[\d,]*\s*tokens?\s*(used|remaining|total)?$/i.test(title)) return true
  if (title === "Token usage") return true
  if (/^Thinking\.{0,3}$/i.test(title)) return true
  if (/^Processing\.{0,3}$/i.test(title)) return true
  if (/^初始化/i.test(title)) return true
  if (/^工作階段已(開始|結束)$/i.test(title)) return true
  if (/^Session (started|ended|resumed)/i.test(title)) return true
  if (/^Permission requested/i.test(title)) return true
  if (/^Agent is requesting/i.test(title)) return true
  if (/^Compacting context/i.test(title)) return true
  if (/^HANDOFF/i.test(title)) return true
  if (/^Claude Code is compress/i.test(title)) return true
  if (/^\.{2,}$/.test(title)) return true
  if (/^Waiting/i.test(title)) return true
  return false
}

function getEventSummary(events: AgentEvent[]): string {
  const prog = getLatestProgress(events)
  if (prog?.summary && !isLabelNoise(prog.summary)) return prog.summary
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.id.startsWith("usr_")) continue
    if (e.type === "token_usage") continue
    if (e.title && isLabelNoise(e.title)) continue
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

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .trim()
}

function getSessionLabel(events: AgentEvent[]): string {
  const summary = getEventSummary(events)
  if (summary) return stripMarkdown(summary)
  const firstUser = events.find(e => e.id.startsWith("usr_"))
  if (firstUser?.title && !isLabelNoise(firstUser.title)) return stripMarkdown(firstUser.title)
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

function getAutomationResultMeta(status: AutomationResult["status"]): { label: string; color: string } {
  if (status === "success") return { label: "OK", color: "#22c55e" }
  if (status === "timeout") return { label: "TIMEOUT", color: "#f59e0b" }
  if (status === "pending_reauth") return { label: "REAUTH", color: "#FB7185" }
  if (status === "interrupted") return { label: "INTERRUPTED", color: "#f97316" }
  if (status === "skipped_no_action" || status === "skipped_no_confirmation" || status === "skipped_daily_limit") {
    return { label: "SKIPPED", color: "#94a3b8" }
  }
  if (status === "blocked_by_risk") return { label: "BLOCKED", color: "#ef4444" }
  return { label: "FAIL", color: "#ef4444" }
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
  const existing = labels[id]
  if ((!existing && label) || (existing && isLabelNoise(existing) && label && !isLabelNoise(label))) {
    labels[id] = label
    localStorage.setItem("agentrune_session_autolabels", JSON.stringify(labels))
  }
}

// --- Component ---

export function UnifiedPanel({
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
  send,
  theme,
  toggleTheme,
  wsConnected,
  onOpenBuilder,
}: UnifiedPanelProps) {
  // --- Locale ---
  const { t, locale } = useLocale()
  const speechLang = locale === "zh-TW" ? "zh-TW" : "en-US"

  // --- Template helpers ---
  const tplName = (tmpl: AutomationTemplate) => {
    if (tmpl.id.startsWith("chain_")) {
      const slug = tmpl.id.replace("chain_", "")
      const ck = `chain.${slug}.name`
      const ct = t(ck)
      return ct !== ck ? ct : slug
    }
    if (tmpl.category === "crew") {
      const pk = tmpl.id.replace("crew_", "")
      const ck = `crew.preset.${pk}`
      const ct = t(ck)
      return ct !== ck ? ct : tmpl.name
    }
    const key = tmpl.id.replace("builtin_", "")
    const translated = t(`tpl.${key}`)
    return translated !== `tpl.${key}` ? translated : tmpl.name
  }
  const tplDesc = (tmpl: AutomationTemplate) => {
    if (tmpl.id.startsWith("chain_")) {
      const slug = tmpl.id.replace("chain_", "")
      const ck = `chain.${slug}.desc`
      const ct = t(ck)
      if (ct !== ck) {
        const tokens = tmpl.crew?.tokenBudget
        return tokens ? `${ct} · ${tokens.toLocaleString()} tokens` : ct
      }
      return tmpl.description
    }
    if (tmpl.category === "crew") {
      const pk = tmpl.id.replace("crew_", "")
      const ck = `crew.preset.${pk}.desc`
      const ct = t(ck)
      return ct !== ck ? ct : tmpl.description
    }
    const key = tmpl.id.replace("builtin_", "")
    const translated = t(`tpl.${key}.desc`)
    return translated !== `tpl.${key}.desc` ? translated : tmpl.description
  }

  // --- Core state ---
  const [now, setNow] = useState(Date.now())
  const [activeTab, setActiveTabRaw] = useState<"projects" | "schedules" | "templates">("projects")
  const setActiveTab = useCallback((tab: "projects" | "schedules" | "templates") => {
    setActiveTabRaw(tab)
    trackTabSwitch(tab, "unified_panel")
  }, [])
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())
  const [summaryCache, setSummaryCache] = useState<Map<string, { text: string; timestamp: number }>>(new Map())
  const [summaryLoading, setSummaryLoading] = useState<Set<string>>(new Set())

  // --- Migrated state ---
  const [showNewSheet, setShowNewSheet] = useState(false)
  const [sheetProjectId, setSheetProjectId] = useState<string | null>(null)
  const [contextProjectId, setContextProjectId] = useState<string | null>(null)
  const [cloudDevices, setCloudDevices] = useState<CloudDevice[]>([])
  const [showDevices, setShowDevices] = useState(false)
  const [showAutomation, setShowAutomation] = useState(false)
  const [automationProjectId, setAutomationProjectId] = useState<string | null>(null)
  const [editingAutomation, setEditingAutomation] = useState<typeof projectAutomations[0] | null>(null)
  const [automationCounts, setAutomationCounts] = useState<Map<string, number>>(new Map())
  const [projectAutomations, setProjectAutomations] = useState<Array<{ id: string; projectId: string; name: string; prompt: string; enabled: boolean; schedule: { type: string; timeOfDay?: string; weekdays?: number[]; intervalMinutes?: number }; templateId?: string; agentId?: string; runMode?: string; skill?: string; nextRunAt?: number; lastResult?: { status: string; startedAt: number; finishedAt?: number; duration?: number } }>>([])
  const [automationsLoading, setAutomationsLoading] = useState(false)
  const [expandedResults, setExpandedResults] = useState<string | null>(null)
  const [resultsData, setResultsData] = useState<Map<string, AutomationResult[]>>(new Map())
  const [resultReportTarget, setResultReportTarget] = useState<{ automationId: string; automationName: string; resultId: string } | null>(null)
  const [contextSessionId, setContextSessionId] = useState<string | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [projectRenameValue, setProjectRenameValue] = useState("")
  const [prdProjectId, setPrdProjectId] = useState<string | null>(null)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const [pinnedTemplateIds, setPinnedTemplateIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("agentrune_pinned_templates") || "[]") } catch { return [] }
  })
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null)
  const [tplSearch, setTplSearch] = useState("")
  const [tplTypeFilter, setTplTypeFilter] = useState<"all" | "chain" | "prompt" | "crew">("all")
  const [showNewPicker, setShowNewPicker] = useState(false)
  const [chainDepths, setChainDepths] = useState<Record<string, ChainDepth>>({})
  const [chainEditSlug, setChainEditSlug] = useState<string | null>(null)
  const [replySessionId, setReplySessionId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState("")

  // Long press
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  // Voice state
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null)
  const [voicePhase, setVoicePhase] = useState<"recording" | "cleaning" | "result" | null>(null)
  const [voiceText, setVoiceText] = useState("")
  const [voicePartial, setVoicePartial] = useState("")
  const latestPartialRef = useRef("")
  const accumulatedTextRef = useRef("")
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const partialListenerRef = useRef<any>(null)
  const voiceEditOriginal = useRef("")
  const srRef = useRef<any>(null)
  const permGrantedRef = useRef(false)
  const isRecordingRef = useRef(false)
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [voiceDuration, setVoiceDuration] = useState(0)

  // Swipe
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const touchDeltaX = useRef(0)
  const swipingPanel = useRef(false)
  const insideScrollContainer = useRef(false)

  // Persist session scroll positions per project
  const sessionScrollPositions = useRef<Map<string, number>>(new Map())

  // --- Load speech plugin ---
  useEffect(() => {
    import("@capacitor-community/speech-recognition").then(mod => {
      srRef.current = mod.SpeechRecognition
    }).catch(() => {})
  }, [])

  // --- Fetch automation counts ---
  useEffect(() => {
    const serverUrl = localStorage.getItem("agentrune_server") || ""
    if (!canUseApi(serverUrl) || projects.length === 0) return
    const counts = new Map<string, number>()
    Promise.all(projects.map(async (p) => {
      try {
        const res = await fetch(buildApiUrl(`/api/automations/${p.id}`, serverUrl))
        if (res.ok) {
          const autos: { enabled: boolean }[] = await res.json()
          const enabled = autos.filter((a) => a.enabled).length
          if (enabled > 0) counts.set(p.id, enabled)
        }
      } catch { /* ignore */ }
    })).then(() => setAutomationCounts(new Map(counts)))
  }, [projects])

  // --- Fetch automations for schedules tab ---
  useEffect(() => {
    if (activeTab !== "schedules") return
    const serverUrl = localStorage.getItem("agentrune_server") || ""
    if (!canUseApi(serverUrl)) return
    setAutomationsLoading(true)
    // Fetch for all projects
    Promise.all(projects.map(async (p) => {
      try {
        const res = await fetch(buildApiUrl(`/api/automations/${p.id}`, serverUrl))
        if (res.ok) return { projectId: p.id, items: await res.json() }
      } catch {}
      return { projectId: p.id, items: [] }
    })).then((results) => {
      const all: typeof projectAutomations = []
      for (const r of results) {
        if (Array.isArray(r.items)) {
          for (const item of r.items) all.push({ ...item, projectId: r.projectId })
        }
      }
      setProjectAutomations(all)
    }).finally(() => setAutomationsLoading(false))
  }, [activeTab, projects, showAutomation])

  // --- Timer ---
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(interval)
  }, [])

  // --- Cloud devices ---
  useEffect(() => {
    const token = localStorage.getItem("agentrune_phone_token")
    if (!token) return
    fetch(AGENTLORE_DEVICES_URL, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setCloudDevices(d.data?.devices ?? []))
      .catch(() => {})
  }, [])

  // --- Auto-label sessions ---
  const labels = getSessionLabels()
  const autoLabels = getAutoLabels()
  const prevAutoLabelStatusRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const prevStatuses = prevAutoLabelStatusRef.current
    for (const s of activeSessions) {
      if (labels[s.id]) continue
      const events = sessionEvents.get(s.id) || []
      const status = getSessionStatus(events)
      const prevStatus = prevStatuses.get(s.id)
      const sessionJustFinished = prevStatus === "working" && (status === "idle" || status === "done")
      prevStatuses.set(s.id, status)

      const existing = autoLabels[s.id]
      // Update if: no label yet, or session just finished (refresh with latest)
      if (existing && !isLabelNoise(existing) && !sessionJustFinished) continue
      const summary = getSessionLabel(events)
      if (summary && summary.length > 3) {
        const autoLabel = summary.length > 40 ? summary.slice(0, 40) + "..." : summary
        setAutoLabelStorage(s.id, autoLabel)
      }
    }
  }, [activeSessions, sessionEvents])

  // --- Group sessions by project ---
  const sessionsByProject = new Map<string, AppSession[]>()
  for (const s of activeSessions) {
    const list = sessionsByProject.get(s.projectId) || []
    list.push(s)
    sessionsByProject.set(s.projectId, list)
  }

  // --- Project helpers ---
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

  const getProjectSummary = (sessions: AppSession[]): string => {
    let latestText = ""
    let latestTs = 0
    for (const s of sessions) {
      const events = sessionEvents.get(s.id) || []
      const summary = getEventSummary(events)
      const ts = events.length > 0 ? events[events.length - 1].timestamp : 0
      if (summary && ts > latestTs) { latestText = summary; latestTs = ts }
    }
    return stripMarkdown(latestText)
  }

  // --- Summary auto-fetch ---
  const fetchSummary = useCallback(async (projectId: string) => {
    const cached = summaryCache.get(projectId)
    const MIN_INTERVAL = 5 * 60 * 1000
    if (cached && Date.now() - cached.timestamp < MIN_INTERVAL) return
    if (summaryLoading.has(projectId)) return

    const sessions = sessionsByProject.get(projectId) || []
    if (sessions.length === 0) return

    // Check if there are new events since last fetch
    let latestEventTs = 0
    for (const s of sessions) {
      const events = sessionEvents.get(s.id) || []
      if (events.length > 0) {
        const ts = events[events.length - 1].timestamp
        if (ts > latestEventTs) latestEventTs = ts
      }
    }
    if (cached && latestEventTs <= cached.timestamp) return

    const serverUrl = localStorage.getItem("agentrune_server") || ""
    if (!canUseApi(serverUrl)) return

    setSummaryLoading(prev => new Set(prev).add(projectId))
    try {
      const res = await fetch(buildApiUrl("/api/project-summary", serverUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        const data = await res.json()
        setSummaryCache(prev => {
          const next = new Map(prev)
          next.set(projectId, { text: data.summary || "", timestamp: Date.now() })
          return next
        })
      }
    } catch { /* ignore */ }
    setSummaryLoading(prev => {
      const next = new Set(prev)
      next.delete(projectId)
      return next
    })
  }, [summaryCache, summaryLoading, sessionsByProject, sessionEvents])

  // Use ref to always call latest fetchSummary without causing effect re-runs
  const fetchSummaryRef = useRef(fetchSummary)
  fetchSummaryRef.current = fetchSummary

  // Fetch summaries once when projects tab first loads, then only on-demand (refresh button)
  const sessionCount = activeSessions.length
  const summaryFetchedRef = useRef(false)
  useEffect(() => {
    if (activeTab !== "projects") return
    if (projects.length === 0) return
    if (summaryFetchedRef.current) return
    summaryFetchedRef.current = true
    for (const p of projects) {
      fetchSummaryRef.current(p.id)
    }
  }, [activeTab, projects.length])

  // Track sessions that finished while user wasn't looking, fetch summary when app resumes
  const prevSessionStatusRef = useRef<Map<string, string>>(new Map())
  const pendingSummaryProjects = useRef<Set<string>>(new Set())
  useEffect(() => {
    const prev = prevSessionStatusRef.current
    for (const s of activeSessions) {
      const events = sessionEvents.get(s.id) || []
      const status = getSessionStatus(events)
      const prevStatus = prev.get(s.id)
      if (prevStatus === "working" && (status === "idle" || status === "done")) {
        pendingSummaryProjects.current.add(s.projectId)
      }
      prev.set(s.id, status)
    }
  }, [activeSessions, sessionEvents])

  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return
      const pending = pendingSummaryProjects.current
      if (pending.size === 0) return
      for (const pid of pending) {
        setSummaryCache(c => { const n = new Map(c); n.delete(pid); return n })
        fetchSummaryRef.current(pid)
      }
      pending.clear()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [])

  // --- Voice system ---
  const voiceCleanup = () => {
    if (voiceTimerRef.current) { clearInterval(voiceTimerRef.current); voiceTimerRef.current = null }
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null }
    partialListenerRef.current = null
  }

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
              else { voiceCleanup(); setVoicePhase("result"); setVoiceText("[Need microphone permission]") }
            }).catch(() => { permGrantedRef.current = true; doStart() })
          }
        }).catch(() => { permGrantedRef.current = true; doStart() })
      } catch { permGrantedRef.current = true; doStart() }
    }
  }

  const callCleanupAPI = async (text: string, aid: string): Promise<string> => {
    const serverUrl = localStorage.getItem("agentrune_server") || ""
    try {
      const res = await fetch(buildApiUrl("/api/voice-cleanup", serverUrl), {
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
        const res = await fetch(buildApiUrl("/api/voice-edit", serverUrl), {
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


  // --- Android back button ---
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
      if (activeTab !== "projects") { setActiveTab("projects"); e.preventDefault(); return }
    }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [voiceSessionId, contextProjectId, contextSessionId, renamingSessionId, replySessionId, showDevices, multiSelectMode, showNewSheet, showAutomation, activeTab])

  // Voice trigger from MissionControl
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const sid = detail?.sessionId
      if (sid && !voiceSessionId) startVoice(sid)
    }
    document.addEventListener("agentrune:voice", handler)
    return () => document.removeEventListener("agentrune:voice", handler)
  }, [voiceSessionId])

  // --- Swipe handlers ---
  const TAB_ORDER: Array<"projects" | "schedules" | "templates"> = ["projects", "schedules", "templates"]

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea")) return
    // Check if touch started inside a horizontal scroll container (session cards)
    insideScrollContainer.current = !!(e.target as HTMLElement).closest("[data-hscroll]")
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchDeltaX.current = 0
    swipingPanel.current = false
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    // If inside a horizontal scroll container, never trigger tab swipe
    if (insideScrollContainer.current) return
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
    insideScrollContainer.current = false
    if (!swipingPanel.current) return
    const threshold = 50
    const currentIdx = TAB_ORDER.indexOf(activeTab)
    if (touchDeltaX.current < -threshold && currentIdx < TAB_ORDER.length - 1) {
      setActiveTab(TAB_ORDER[currentIdx + 1])
    } else if (touchDeltaX.current > threshold && currentIdx > 0) {
      setActiveTab(TAB_ORDER[currentIdx - 1])
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

  // Toggle expanded session
  const toggleExpandSession = (sessionId: string) => {
    setExpandedSessions(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  // --- Inline SVG icons ---
  const MicIcon = ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )

  const ClockIcon = ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  )

  const MoreIcon = ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
    </svg>
  )

  const PlusIcon = ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )

  const RefreshIcon = ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )

  const ChevronDownIcon = ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )

  const ChevronUpIcon = ({ size = 14 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  )

  // --- Action row helper for context menus ---
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

  // ============================
  // RENDER
  // ============================
  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        height: "100dvh",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-primary)",
      }}
    >
      {/* ========== Header ========== */}
      <div style={{
        padding: "calc(env(safe-area-inset-top, 0px) + 16px) 20px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div>
          <div style={{
            fontSize: 28, fontWeight: 700,
            color: "var(--text-primary)",
            letterSpacing: "-0.5px",
          }}>
            AgentRune
          </div>
          <div style={{
            fontSize: 12, color: "var(--text-secondary)",
            fontWeight: 500, marginTop: 4,
          }}>
            {t(projects.length !== 1 ? "count.projects" : "count.project", { count: String(projects.length) })} · {t(activeSessions.length !== 1 ? "count.sessions" : "count.session", { count: String(activeSessions.length) })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {/* Connection status */}
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
              cursor: "pointer", position: "relative",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <div style={{
              position: "absolute", bottom: 2, right: 2,
              width: 8, height: 8, borderRadius: "50%",
              background: wsConnected ? "#22c55e" : "#ef4444",
              boxShadow: wsConnected ? "0 0 4px rgba(34,197,94,0.6)" : "0 0 4px rgba(239,68,68,0.6)",
              border: "1.5px solid var(--card-bg)",
            }} />
          </button>
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
        </div>
      </div>

      {/* ========== Tab Bar ========== */}
      <div style={{
        display: "flex", justifyContent: "center", padding: "6px 0 8px",
        flexShrink: 0,
      }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 2,
          padding: "3px 4px", borderRadius: 10,
          background: "var(--icon-bg)",
          border: "none",
        }}>
          {([
            { key: "projects" as const, label: t("sessions.tabSessions") || "Projects" },
            { key: "schedules" as const, label: t("sessions.tabSchedules") || "Schedules" },
            { key: "templates" as const, label: t("sessions.tabTemplates") || "Templates" },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: "4px 14px", borderRadius: 8, fontSize: 11,
                border: "none", cursor: "pointer",
                background: activeTab === key ? "var(--glass-border)" : "transparent",
                color: activeTab === key ? "var(--text-primary)" : "var(--text-secondary)",
                fontWeight: activeTab === key ? 700 : 500,
                opacity: activeTab === key ? 1 : 0.4,
                transition: "all 0.3s ease",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ========== Tab Content ========== */}
      <div style={{
        flex: 1,
        overflow: "hidden",
        position: "relative",
      }}>
        <div style={{
          display: "flex",
          width: "300%",
          height: "100%",
          transform: `translateX(-${TAB_ORDER.indexOf(activeTab) * (100 / 3)}%)`,
          transition: "transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
        }}>

          {/* ========== Projects Tab ========== */}
          <div style={{
            width: "100%",
            height: "100%",
            overflowY: "auto",
            padding: "8px 16px 40px",
          }}>
            {projects.length === 0 && (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 16, color: "var(--text-secondary)", minHeight: 300,
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
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{t("count.noProjects")}</div>
                  </>
                )}
                <button
                  onClick={() => setShowNewSheet(true)}
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
                  {t("overview.startNewSession")}
                </button>
              </div>
            )}

            {projects.map((project) => {
              const sessions = sessionsByProject.get(project.id) || []
              const sessionCount = sessions.length
              const status = sessionCount > 0 ? getProjectStatus(sessions) : "idle"
              const dotStyle = STATUS_DOT[status] || STATUS_DOT.idle
              const cached = summaryCache.get(project.id)
              const isLoadingSummary = summaryLoading.has(project.id)

              return (
                <div key={project.id} style={{
                  marginBottom: 20,
                  borderRadius: 16,
                  background: theme === "dark"
                    ? "rgba(52,119,146,0.08)"   // #347792 tinted glass — dark
                    : "rgba(189,209,198,0.15)",  // #BDD1C6 tinted glass — light
                  backdropFilter: "blur(24px) saturate(1.4)", WebkitBackdropFilter: "blur(24px) saturate(1.4)",
                  border: theme === "dark"
                    ? "1px solid rgba(55,172,192,0.12)"   // #37ACC0 tint border
                    : "1px solid rgba(52,119,146,0.1)",
                  boxShadow: theme === "dark"
                    ? "0 4px 24px -4px rgba(0,0,0,0.3), 0 0 0 0.5px rgba(55,172,192,0.06)"
                    : "0 4px 24px -4px rgba(52,119,146,0.08), 0 0 0 0.5px rgba(52,119,146,0.04)",
                  overflow: "hidden",
                  paddingBottom: 12,
                }}>
                    {/* Project header row */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "14px 14px 0",
                    }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: dotStyle.color, boxShadow: dotStyle.shadow,
                        flexShrink: 0,
                      }} />
                      <div style={{
                        flex: 1, fontWeight: 700, fontSize: 16,
                        color: "var(--text-primary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {project.name}
                      </div>
                      {/* Refresh summary button */}
                      <button
                        onClick={() => {
                          setSummaryCache(prev => {
                            const next = new Map(prev)
                            next.delete(project.id)
                            return next
                          })
                          fetchSummary(project.id)
                        }}
                        style={{
                          width: 30, height: 30, borderRadius: 8,
                          background: "transparent",
                          border: "1px solid var(--glass-border)",
                          color: "var(--text-secondary)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", flexShrink: 0,
                        }}
                      >
                        <RefreshIcon size={14} />
                      </button>
                      {/* [...] button */}
                      <button
                        onClick={() => { trackProjectSwitch(project.id); setContextProjectId(project.id) }}
                        style={{
                          width: 30, height: 30, borderRadius: 8,
                          background: "transparent",
                          border: "1px solid var(--glass-border)",
                          color: "var(--text-secondary)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", flexShrink: 0,
                        }}
                      >
                        <MoreIcon size={14} />
                      </button>
                      {/* Schedule button */}
                      <button
                        onClick={() => {
                          setAutomationProjectId(project.id)
                          setShowAutomation(true)
                        }}
                        style={{
                          width: 30, height: 30, borderRadius: 8,
                          background: "transparent",
                          border: "1px solid var(--glass-border)",
                          color: "var(--text-secondary)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", flexShrink: 0,
                        }}
                      >
                        <ClockIcon size={14} />
                      </button>
                      {/* + button */}
                      <button
                        onClick={() => {
                          setSheetProjectId(project.id)
                          setShowNewSheet(true)
                        }}
                        style={{
                          width: 30, height: 30, borderRadius: 8,
                          background: "transparent",
                          border: "1px solid var(--glass-border)",
                          color: "var(--text-secondary)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", flexShrink: 0,
                        }}
                      >
                        <PlusIcon size={14} />
                      </button>
                    </div>

                    {/* Project summary + next steps (same card, below header) */}
                    <div style={{ padding: "10px 14px 14px" }}>
                      {/* Summary */}
                      <div style={{
                        fontSize: 13, color: "var(--text-secondary)",
                        lineHeight: 1.5, minHeight: 18,
                        display: "-webkit-box", WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical" as never, overflow: "hidden",
                      }}>
                        {isLoadingSummary ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{
                              width: 12, height: 12, border: "2px solid var(--glass-border)",
                              borderTopColor: dotStyle.color, borderRadius: "50%",
                              display: "inline-block", animation: "spin 1s linear infinite",
                            }} />
                            {t("unified.generatingSummary")}
                          </span>
                        ) : cached?.text ? (
                          cached.text.length > 200 ? cached.text.slice(0, 200) + "..." : cached.text
                        ) : (
                          <span style={{ opacity: 0.5 }}>
                            {sessionCount > 0 ? (() => {
                              const s = getProjectSummary(sessions)
                              return s ? (s.length > 200 ? s.slice(0, 200) + "..." : s) : t("mc.sessionStarted")
                            })() : t("overview.tapToStart")}
                          </span>
                        )}
                      </div>

                      {/* Next Steps from all sessions */}
                      {sessions.length > 0 && (() => {
                        const steps: { agentName: string; step: string }[] = []
                        for (const s of sessions) {
                          const events = sessionEvents.get(s.id) || []
                          const prog = getLatestProgress(events)
                          const agentDef = AGENTS.find(a => a.id === s.agentId)
                          const name = labels[s.id] || autoLabels[s.id] || agentDef?.name || s.agentId
                          if (prog?.nextSteps) {
                            for (const step of prog.nextSteps.slice(0, 2)) {
                              steps.push({ agentName: name, step })
                            }
                          }
                        }
                        if (steps.length === 0) return null
                        return (
                          <div style={{ marginTop: 6 }}>
                            {steps.slice(0, 4).map((s, i) => (
                              <div key={i} style={{
                                display: "flex", gap: 4, fontSize: 11,
                                color: "var(--text-secondary)", lineHeight: 1.5, opacity: 0.8,
                              }}>
                                <span style={{ fontWeight: 600, flexShrink: 0, color: "var(--text-primary)", opacity: 0.6 }}>
                                  {s.agentName}:
                                </span>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {s.step}
                                </span>
                              </div>
                            ))}
                          </div>
                        )
                      })()}

                  </div>

                  {/* --- Recessed tray for session cards --- */}
                  {sessionCount > 0 && (
                    <div style={{
                      margin: "4px 10px 0",
                      borderRadius: 12,
                      background: theme === "dark"
                        ? "rgba(0,0,0,0.2)"
                        : "rgba(52,119,146,0.04)",
                      boxShadow: theme === "dark"
                        ? "inset 0 2px 8px rgba(0,0,0,0.35), inset 0 0 2px rgba(0,0,0,0.15)"
                        : "inset 0 2px 8px rgba(52,119,146,0.08), inset 0 0 2px rgba(0,0,0,0.03)",
                      border: theme === "dark"
                        ? "1px solid rgba(255,255,255,0.03)"
                        : "1px solid rgba(52,119,146,0.06)",
                      padding: "8px 8px",
                    }}>
                    <div
                      data-hscroll
                      ref={(el) => {
                        if (el) {
                          const saved = sessionScrollPositions.current.get(project.id)
                          if (saved !== undefined && Math.abs(el.scrollLeft - saved) > 2) {
                            el.scrollLeft = saved
                          }
                        }
                      }}
                      onScroll={(e) => {
                        sessionScrollPositions.current.set(project.id, (e.target as HTMLElement).scrollLeft)
                      }}
                      style={{
                        display: "flex", gap: 8,
                        overflowX: "auto",
                        scrollSnapType: "x mandatory",
                        WebkitOverflowScrolling: "touch",
                        scrollbarWidth: "none",
                      }}
                    >
                      {sessions.map((session) => {
                        const events = sessionEvents.get(session.id) || []
                        const sessionStatus = getSessionStatus(events)
                        const sDot = STATUS_DOT[sessionStatus] || STATUS_DOT.idle
                        const agentDef = AGENTS.find(a => a.id === session.agentId)
                        const rawAutoLabel = autoLabels[session.id]
                        const label = labels[session.id] || (rawAutoLabel && !isLabelNoise(rawAutoLabel) ? rawAutoLabel : null) || agentDef?.name || session.agentId
                        const summaryText = getSessionLabel(events)
                        const isExpanded = expandedSessions.has(session.id)
                        const prog = getLatestProgress(events)

                        return (
                          <div
                            key={session.id}
                            style={{
                              width: "calc(50vw - 28px)",
                              minWidth: "calc(50vw - 28px)",
                              scrollSnapAlign: "start",
                              flexShrink: 0,
                            }}
                          >
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                if (longPressFired.current) return
                                onSelectSession(session.id)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault()
                                  if (longPressFired.current) return
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
                                width: "100%",
                                textAlign: "left",
                                background: "var(--glass-bg)",
                                backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                                borderRadius: 14,
                                border: sessionStatus === "blocked"
                                  ? "1.5px solid rgba(239,68,68,0.3)"
                                  : "1px solid var(--glass-border)",
                                boxShadow: `inset 0 0 20px -6px ${sDot.glow}, var(--glass-shadow)`,
                                padding: 12,
                                cursor: "pointer",
                                transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                              }}
                            >
                              {/* Status + agent name */}
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                <div style={{
                                  width: 7, height: 7, borderRadius: "50%",
                                  background: sDot.color, boxShadow: sDot.shadow,
                                  flexShrink: 0,
                                }} />
                                <div style={{
                                  fontWeight: 600, fontSize: 12, color: "var(--text-primary)",
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>
                                  {label}
                                </div>
                              </div>

                              {/* Progress summary */}
                              <div style={{
                                fontSize: 11, color: "var(--text-secondary)",
                                lineHeight: 1.4,
                                display: "-webkit-box", WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical" as never, overflow: "hidden",
                                marginBottom: 8, minHeight: 30,
                              }}>
                                {summaryText || t("mc.sessionStarted")}
                              </div>

                              {/* Expanded metadata */}
                              {isExpanded && (
                                <div style={{
                                  fontSize: 10, color: "var(--text-secondary)",
                                  lineHeight: 1.5, marginBottom: 8,
                                  borderTop: "1px solid var(--glass-border)",
                                  paddingTop: 6,
                                }}>
                                  <div>Started: {events.length > 0 ? new Date(events[0].timestamp).toLocaleString() : "N/A"}</div>
                                  <div>Messages: {events.length}</div>
                                  <div>Files: {events.filter(e => e.type === "file_edit" || e.type === "file_create").length}</div>
                                  {session.worktreeBranch && (
                                    <div style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                                      {session.worktreeBranch.replace(/^agentrune\//, "")}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Bottom row: expand + voice */}
                              <div style={{
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                              }}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleExpandSession(session.id) }}
                                  onTouchStart={(e) => e.stopPropagation()}
                                  style={{
                                    width: 24, height: 24, borderRadius: 6,
                                    border: "1px solid var(--glass-border)",
                                    background: "transparent",
                                    color: "var(--text-secondary)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    cursor: "pointer", opacity: 0.6,
                                  }}
                                >
                                  {isExpanded ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); startVoice(session.id) }}
                                  onTouchStart={(e) => e.stopPropagation()}
                                  style={{
                                    width: 36, height: 36, borderRadius: "50%",
                                    background: "rgba(59,130,246,0.15)",
                                    border: "1px solid rgba(59,130,246,0.3)",
                                    color: "#3b82f6",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    cursor: "pointer", flexShrink: 0,
                                  }}
                                >
                                  <MicIcon size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    </div>
                  )}

                  {/* No sessions — small dashed card in tray */}
                  {sessionCount === 0 && (
                    <div style={{
                      margin: "4px 10px 0",
                      borderRadius: 12,
                      background: theme === "dark"
                        ? "rgba(0,0,0,0.2)"
                        : "rgba(52,119,146,0.04)",
                      boxShadow: theme === "dark"
                        ? "inset 0 2px 8px rgba(0,0,0,0.35), inset 0 0 2px rgba(0,0,0,0.15)"
                        : "inset 0 2px 8px rgba(52,119,146,0.08), inset 0 0 2px rgba(0,0,0,0.03)",
                      border: theme === "dark"
                        ? "1px solid rgba(255,255,255,0.03)"
                        : "1px solid rgba(52,119,146,0.06)",
                      padding: "8px 8px",
                    }}>
                      <button
                        onClick={() => {
                          setSheetProjectId(project.id)
                          setShowNewSheet(true)
                        }}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          gap: 6,
                          width: "calc(50vw - 28px)",
                          padding: "14px 12px",
                          background: "transparent",
                          border: "1.5px dashed var(--glass-border)",
                          borderRadius: 14,
                          color: "var(--text-secondary)",
                          cursor: "pointer",
                        }}
                      >
                        <PlusIcon size={16} />
                        <span style={{ fontSize: 12 }}>{t("overview.newSession")}</span>
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            {/* New session button — always visible at bottom of project list */}
            {projects.length > 0 && (
              <button
                onClick={() => setShowNewSheet(true)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  width: "100%", padding: "12px 16px", marginTop: 4, borderRadius: 14,
                  border: "1.5px dashed rgba(55,172,192,0.4)",
                  background: "rgba(55,172,192,0.06)",
                  backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                  color: "#37ACC0", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", transition: "all 0.2s",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t("overview.newSession") || "New Session"}
              </button>
            )}
          </div>

          {/* ========== Schedules Tab ========== */}
          <div style={{
            width: "100%",
            height: "100%",
            overflowY: "auto",
            padding: "8px 16px 40px",
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 4px" }}>
              {/* Add schedule button */}
              <button
                onClick={() => {
                  if (!automationProjectId && projects.length > 0) setAutomationProjectId(projects[0].id)
                  setEditingAutomation(null)
                  setShowAutomation(true)
                }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  padding: "12px 16px", borderRadius: 14,
                  border: "1.5px dashed rgba(55,172,192,0.4)",
                  background: "rgba(55,172,192,0.06)",
                  backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                  color: "#37ACC0", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", transition: "all 0.2s",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t("schedules.add") || "New Schedule"}
              </button>

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
                  : `${t("automation.every")} ${auto.schedule.intervalMinutes || 30} ${t("automation.minutes")}`
                // Countdown to next trigger
                let countdown = ""
                if (auto.enabled && auto.nextRunAt) {
                  const diff = auto.nextRunAt - now
                  if (diff > 0) {
                    const mins = Math.floor(diff / 60000)
                    if (mins >= 60) {
                      const h = Math.floor(mins / 60)
                      const m = mins % 60
                      countdown = m > 0 ? `${h}h ${m}m` : `${h}h`
                    } else {
                      countdown = `${mins}m`
                    }
                  }
                }
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
                            await fetch(buildApiUrl(`/api/automations/${auto.projectId}/${auto.id}`, serverUrl), {
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
                          background: "var(--card-bg)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                          transform: auto.enabled ? "translateX(18px)" : "translateX(0)",
                          transition: "transform 0.2s",
                        }} />
                      </button>
                      <div
                        onClick={() => {
                          setAutomationProjectId(auto.projectId)
                          setEditingAutomation(auto)
                          setShowAutomation(true)
                        }}
                        style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {auto.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2, display: "flex", gap: 6, alignItems: "center" }}>
                          <span>{scheduleLabel}</span>
                          {countdown && <span style={{ color: "#37ACC0", fontWeight: 600, fontSize: 10 }}>({countdown})</span>}
                        </div>
                      </div>
                      {/* Delete */}
                      <button
                        onClick={async () => {
                          const serverUrl = localStorage.getItem("agentrune_server") || ""
                          try {
                            await fetch(buildApiUrl(`/api/automations/${auto.projectId}/${auto.id}`, serverUrl), { method: "DELETE" })
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
                    {/* Last result summary + expand toggle */}
                    {auto.lastResult && (
                      <div style={{ marginTop: 8, borderTop: "1px solid var(--glass-border)" }}>
                        <button
                          onClick={async () => {
                            if (expandedResults === auto.id) {
                              setExpandedResults(null)
                              return
                            }
                            setExpandedResults(auto.id)
                            // Fetch results if not cached
                            if (!resultsData.has(auto.id)) {
                              const serverUrl = localStorage.getItem("agentrune_server") || ""
                              try {
                                const res = await fetch(buildApiUrl(`/api/automations/${auto.projectId}/${auto.id}/results`, serverUrl))
                                if (res.ok) {
                                  const data = await res.json()
                                  setResultsData(prev => new Map(prev).set(auto.id, data))
                                }
                              } catch {}
                            }
                          }}
                          style={{
                            width: "100%", padding: "8px 0 4px", border: "none", background: "transparent",
                            display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                            fontSize: 10, color: "var(--text-secondary)",
                          }}
                        >
                          <span style={{
                            color: auto.lastResult.status === "success" ? "#22c55e" : "#ef4444",
                            fontWeight: 600,
                          }}>
                            {auto.lastResult.status === "success" ? "OK" : "FAIL"}
                          </span>
                          <span>{new Date(auto.lastResult.startedAt).toLocaleString()}</span>
                          {auto.lastResult.duration != null && (
                            <span style={{ opacity: 0.6 }}>
                              {auto.lastResult.duration > 60000
                                ? `${Math.floor(auto.lastResult.duration / 60000)}m ${Math.round((auto.lastResult.duration % 60000) / 1000)}s`
                                : `${Math.round(auto.lastResult.duration / 1000)}s`}
                            </span>
                          )}
                          <span style={{ marginLeft: "auto", opacity: 0.4, transition: "transform 0.2s", transform: expandedResults === auto.id ? "rotate(180deg)" : "rotate(0)" }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </span>
                        </button>
                        {/* Expanded results list */}
                        {expandedResults === auto.id && (
                          <div style={{
                            display: "flex", flexDirection: "column", gap: 4, padding: "4px 0 4px",
                            maxHeight: 300, overflowY: "auto",
                          }}>
                            {!resultsData.has(auto.id) && (
                              <div style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.5, padding: 8 }}>Loading...</div>
                            )}
                            {(resultsData.get(auto.id) || []).slice().reverse().map((r) => {
                              const resultMeta = getAutomationResultMeta(r.status)
                              const report = buildAutomationReport(r, locale === "zh-TW" ? "zh-TW" : "en")
                              const dur = r.finishedAt - r.startedAt
                              const durStr = dur > 60000
                                ? `${Math.floor(dur / 60000)}m ${Math.round((dur % 60000) / 1000)}s`
                                : `${Math.round(dur / 1000)}s`
                              return (
                                <button
                                  key={r.id}
                                  onClick={() => setResultReportTarget({ automationId: auto.id, automationName: auto.name, resultId: r.id })}
                                  style={{
                                    padding: "10px 10px 9px",
                                    borderRadius: 10,
                                    background: "var(--bg-secondary, rgba(0,0,0,0.05))",
                                    fontSize: 10,
                                    border: "1px solid var(--glass-border)",
                                    textAlign: "left",
                                    cursor: "pointer",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{
                                      width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                                      background: resultMeta.color,
                                    }} />
                                    <span style={{ fontWeight: 700, color: resultMeta.color }}>
                                      {resultMeta.label}
                                    </span>
                                    <span style={{ color: "var(--text-secondary)" }}>{durStr}</span>
                                    <span style={{ marginLeft: "auto", color: "var(--text-secondary)", opacity: 0.6 }}>
                                      {new Date(r.startedAt).toLocaleString()}
                                    </span>
                                  </div>
                                  <div style={{
                                    padding: "9px 10px",
                                    borderRadius: 8,
                                    background: "rgba(255,255,255,0.45)",
                                    color: "var(--text-primary)",
                                    fontSize: 11,
                                    lineHeight: 1.55,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                  }}>
                                    {report.summary || "已產生完整報告，點擊查看詳細結果。"}
                                  </div>
                                  <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 8,
                                    color: "#37ACC0",
                                    fontSize: 11,
                                    fontWeight: 700,
                                  }}>
                                    <span>查看完整報告</span>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                      <polyline points="14 2 14 8 20 8" />
                                      <line x1="16" y1="13" x2="8" y2="13" />
                                      <line x1="16" y1="17" x2="8" y2="17" />
                                    </svg>
                                  </div>
                                </button>
                              )
                            })}
                            {resultsData.has(auto.id) && (resultsData.get(auto.id) || []).length === 0 && (
                              <div style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.5, padding: 8, textAlign: "center" }}>
                                {t("automation.noResults") || "No results yet"}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ========== Templates Tab ========== */}
          <div style={{
            width: "100%",
            height: "100%",
            overflowY: "auto",
            padding: "8px 16px 40px",
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 4px" }}>
              {/* New Workflow button */}
              <button
                onClick={() => setShowNewPicker(!showNewPicker)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  width: "100%", padding: "10px 16px", borderRadius: 12,
                  border: "1.5px dashed rgba(55,172,192,0.4)",
                  background: "rgba(55,172,192,0.06)",
                  color: "#37ACC0", fontSize: 13, fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t("templates.create")}
              </button>

              {/* New Workflow type picker */}
              {showNewPicker && (
                <div style={{
                  display: "flex", flexDirection: "column", gap: 6,
                  padding: 12, borderRadius: 14,
                  border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                  backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 2 }}>
                    {t("templates.createTitle")}
                  </div>
                  {/* Skills Chain */}
                  <button onClick={() => {
                    setShowNewPicker(false)
                    setChainEditSlug("__new__")
                  }} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    borderRadius: 10, border: "1px solid var(--glass-border)", background: "transparent",
                    cursor: "pointer", textAlign: "left",
                  }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: "rgba(55,172,192,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/><path d="M7 11v2a2 2 0 0 0 2 2h2"/><path d="M15 13v-2a2 2 0 0 0-2-2h-2"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{t("templates.createChain")}</div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{t("templates.createChainDesc")}</div>
                    </div>
                  </button>
                  {/* Prompt */}
                  <button onClick={() => {
                    setShowNewPicker(false)
                    if (!automationProjectId && projects.length > 0) setAutomationProjectId(projects[0].id)
                    setEditingAutomation(null)
                    setShowAutomation(true)
                  }} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    borderRadius: 10, border: "1px solid var(--glass-border)", background: "transparent",
                    cursor: "pointer", textAlign: "left",
                  }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: "rgba(52,119,146,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#347792" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{t("templates.createPrompt")}</div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{t("templates.createPromptDesc")}</div>
                    </div>
                  </button>
                  {/* Crew */}
                  <button onClick={() => {
                    setShowNewPicker(false)
                    if (!automationProjectId && projects.length > 0) setAutomationProjectId(projects[0].id)
                    const crewData: any = {
                      id: "__new__", name: "", prompt: "",
                      enabled: true, schedule: { type: "daily", timeOfDay: "03:00" },
                      crew: {
                        roles: [{
                          id: `role_${Date.now()}`, nameKey: "", prompt: "",
                          persona: { tone: "", focus: "", style: "" },
                          icon: "code", color: "#37ACC0", phase: 1, estimatedTokens: 3000,
                        }],
                        tokenBudget: 10000, phaseDelayMinutes: 0,
                      },
                    }
                    setEditingAutomation(crewData)
                    setShowAutomation(true)
                  }} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    borderRadius: 10, border: "1px solid var(--glass-border)", background: "transparent",
                    cursor: "pointer", textAlign: "left",
                  }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: "rgba(251,129,132,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FB8184" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{t("templates.createCrew")}</div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{t("templates.createCrewDesc")}</div>
                    </div>
                  </button>
                </div>
              )}

              {/* Type filter */}
              <div style={{
                display: "flex", alignItems: "center", gap: 0,
                padding: "5px 10px", borderRadius: 10,
                background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                overflowX: "auto", scrollbarWidth: "none",
              }}>
                {([
                  { key: "all" as const, label: t("templates.filterAll"), icon: null },
                  { key: "crew" as const, label: t("templates.filterCrew"), icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
                  { key: "chain" as const, label: t("templates.filterChain"), icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/><path d="M7 11v2a2 2 0 0 0 2 2h2"/><path d="M15 13v-2a2 2 0 0 0-2-2h-2"/></svg> },
                  { key: "prompt" as const, label: t("templates.filterPrompt"), icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/></svg> },
                ]).map(f => (
                  <button key={f.key} onClick={() => setTplTypeFilter(f.key)} style={{
                    padding: "4px 8px", borderRadius: 8, border: "none", cursor: "pointer",
                    background: tplTypeFilter === f.key ? "rgba(55,172,192,0.18)" : "transparent",
                    color: tplTypeFilter === f.key ? "#37ACC0" : "var(--text-secondary)",
                    fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
                    display: "flex", alignItems: "center", gap: 3,
                  }}>
                    {f.icon}
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div style={{ position: "relative" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", opacity: 0.6 }}>
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text" value={tplSearch} onChange={(e) => setTplSearch(e.target.value)}
                  placeholder={t("automation.searchTemplates") || "Search templates..."}
                  style={{
                    width: "100%", padding: "9px 14px 9px 34px", borderRadius: 10,
                    border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                    color: "var(--text-primary)", fontSize: 12, outline: "none", boxSizing: "border-box",
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

              {/* Template list */}
              {(() => {
                const allTemplates = [...BUILTIN_TEMPLATES, ...BUILTIN_CREWS, ...CHAIN_TEMPLATES]
                const filtered = allTemplates.filter((tmpl) => {
                  // Type filter
                  if (tplTypeFilter === "chain" && !isChain(tmpl)) return false
                  if (tplTypeFilter === "prompt" && !isPrompt(tmpl)) return false
                  if (tplTypeFilter === "crew" && !isCrew(tmpl)) return false
                  // Group filter (only when type=all or type=prompt)
                  // scene filter removed
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
                  const roles = tmpl.crew?.roles || []
                  const isChain = tmpl.id.startsWith("chain_")
                  const isMultiCrew = tmpl.category === "crew" && roles.length > 1
                  // isChain = single-role skill chain template (tap → ChainBuilder)
                  // isMultiCrew = multi-role crew (tap → expand to see roles)
                  // neither = pure prompt template (tap → expand to see prompt)
                  const chainSlug = isChain ? tmpl.id.replace("chain_", "") : (isMultiCrew ? null : roles[0]?.skillChainSlug)
                  const chain = chainSlug ? BUILTIN_CHAINS.find(c => c.slug === chainSlug) : null
                  const depth = chainDepths[tmpl.id] || "standard"

                  // ─── Chain card: tap opens ChainBuilder, action buttons inline ───
                  if (isChain && chain) {
                    return (
                      <div key={tmpl.id} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "12px 14px", borderRadius: 14,
                        border: isPinned ? "1px solid rgba(55,172,192,0.25)" : "1px solid var(--glass-border)",
                        background: "var(--glass-bg)",
                        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                        cursor: "pointer",
                      }} onClick={() => setChainEditSlug(chainSlug!)}>
                        {/* Chain pipeline icon */}
                        <div style={{
                          width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                          background: "rgba(55,172,192,0.15)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/><path d="M7 11v2a2 2 0 0 0 2 2h2"/><path d="M15 13v-2a2 2 0 0 0-2-2h-2"/>
                          </svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{tplName(tmpl)}</div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {getStepCount(chain)} {t("crew.chainSteps")} · {estimateTokens(chain, depth).toLocaleString()} tokens
                          </div>
                        </div>
                        {/* Inline action buttons */}
                        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                          {/* Schedule */}
                          <button onClick={(e) => {
                            e.stopPropagation()
                            if (!automationProjectId && projects.length > 0) setAutomationProjectId(projects[0].id)
                            const editData: any = {
                              id: "__new__", name: tplName(tmpl), prompt: "",
                              templateId: tmpl.id, enabled: true,
                              schedule: { type: "daily", timeOfDay: "03:00" },
                            }
                            if (tmpl.crew) editData.crew = JSON.parse(JSON.stringify(tmpl.crew))
                            setEditingAutomation(editData as typeof projectAutomations[0])
                            setShowAutomation(true)
                          }} style={{
                            width: 30, height: 30, borderRadius: 8, border: "none",
                            background: "rgba(55,172,192,0.06)", color: "var(--text-secondary)",
                            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                          }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          </button>
                          {/* Pin */}
                          <button onClick={(e) => {
                            e.stopPropagation()
                            const next = isPinned ? pinnedTemplateIds.filter((id) => id !== tmpl.id) : [...pinnedTemplateIds, tmpl.id]
                            setPinnedTemplateIds(next)
                            localStorage.setItem("agentrune_pinned_templates", JSON.stringify(next))
                          }} style={{
                            width: 30, height: 30, borderRadius: 8, border: "none",
                            background: isPinned ? "rgba(55,172,192,0.15)" : "transparent",
                            color: isPinned ? "#37ACC0" : "var(--text-secondary)",
                            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                          }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    )
                  }

                  // ─── Multi-role crew and pure prompt: expandable cards ───
                  return (
                    <div key={tmpl.id}>
                      <button
                        onClick={() => setExpandedTemplateId(isExpanded ? null : tmpl.id)}
                        style={{
                          width: "100%", textAlign: "left",
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "12px 14px", borderRadius: isExpanded ? "14px 14px 0 0" : 14,
                          border: isPinned ? "1px solid rgba(55,172,192,0.25)" : "1px solid var(--glass-border)",
                          borderBottom: isExpanded ? "none" : undefined,
                          background: "var(--glass-bg)",
                          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                          cursor: "pointer",
                        }}
                      >
                        {/* Icon: role avatars for multi-crew, prompt icon for builtin */}
                        {isMultiCrew ? (
                          <div style={{ display: "flex", flexShrink: 0 }}>
                            {roles.slice(0, 3).map((r, i) => (
                              <div key={r.id} style={{
                                width: 28, height: 28, borderRadius: "50%",
                                background: r.color, border: "2px solid var(--glass-bg)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                marginLeft: i === 0 ? 0 : -6, zIndex: 10 - i,
                              }}>
                                {getCrewRoleIcon(r.icon)}
                              </div>
                            ))}
                            {roles.length > 3 && (
                              <div style={{
                                width: 28, height: 28, borderRadius: "50%",
                                background: "var(--text-secondary)", border: "2px solid var(--glass-bg)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                marginLeft: -6, color: "#fff", fontSize: 9, fontWeight: 700,
                              }}>+{roles.length - 3}</div>
                            )}
                          </div>
                        ) : (() => {
                          const bk = tmpl.id.replace("builtin_", "")
                          const bi = BUILTIN_TPL_ICON[bk]
                          const iconColor = bi?.color || "#37ACC0"
                          return (
                            <div style={{
                              width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                              background: iconColor,
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              {bi ? getCrewRoleIcon(bi.icon) : (
                                /* Prompt/document icon for generic templates */
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/>
                                  <polyline points="14 2 14 8 20 8"/>
                                  <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                                </svg>
                              )}
                            </div>
                          )
                        })()}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{tplName(tmpl)}</div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {isMultiCrew
                              ? `${roles.length} ${t("fireCrew.roles")} · ${(tmpl.crew?.tokenBudget || 0).toLocaleString()} tokens`
                              : tplDesc(tmpl)
                            }
                          </div>
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
                          {/* Description */}
                          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 8 }}>
                            {tplDesc(tmpl)}
                          </div>

                          {/* Crew: role list */}
                          {isMultiCrew && (
                            <div style={{ marginBottom: 8 }}>
                              {roles.map(r => (
                                <div key={r.id} style={{
                                  display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
                                  borderBottom: "1px solid var(--glass-border)",
                                }}>
                                  <div style={{
                                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                                    background: r.color, display: "flex", alignItems: "center", justifyContent: "center",
                                  }}>
                                    {getCrewRoleIcon(r.icon)}
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>
                                      {t(r.nameKey) !== r.nameKey ? t(r.nameKey) : r.nameKey}
                                    </div>
                                    <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                                      {t("crew.phase").replace("{n}", String(r.phase))} · {(r.estimatedTokens || 0).toLocaleString()} tokens
                                      {r.skillChainSlug && ` · ${r.skillChainSlug}`}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Builtin: prompt preview */}
                          {!isMultiCrew && tmpl.prompt && (
                            <div style={{
                              fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5,
                              background: "var(--icon-bg)", padding: "8px 10px", borderRadius: 10,
                              maxHeight: 120, overflowY: "auto", marginBottom: 10,
                              whiteSpace: "pre-wrap", wordBreak: "break-word",
                              fontFamily: "'JetBrains Mono', monospace", opacity: 0.8,
                            }}>
                              {tmpl.prompt}
                            </div>
                          )}

                          {/* Action buttons */}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {/* Edit */}
                            <button onClick={(e) => {
                              e.stopPropagation()
                              setExpandedTemplateId(null)
                              if (!automationProjectId && projects.length > 0) setAutomationProjectId(projects[0].id)
                              const editData: any = {
                                id: "__new__", name: tplName(tmpl), prompt: tmpl.prompt || "",
                                templateId: tmpl.id, enabled: true,
                                schedule: { type: "daily", timeOfDay: "03:00" },
                              }
                              if (isMultiCrew && tmpl.crew) {
                                editData.crew = JSON.parse(JSON.stringify(tmpl.crew))
                              }
                              setEditingAutomation(editData as typeof projectAutomations[0])
                              setShowAutomation(true)
                            }} style={{
                              padding: "6px 12px", borderRadius: 8,
                              border: "1px solid var(--glass-border)", background: "transparent",
                              color: "var(--text-secondary)", fontSize: 11, fontWeight: 600, cursor: "pointer",
                              display: "flex", alignItems: "center", gap: 4,
                            }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                              {t("templates.edit")}
                            </button>
                            {/* Schedule */}
                            <button onClick={(e) => {
                              e.stopPropagation()
                              setExpandedTemplateId(null)
                              if (!automationProjectId && projects.length > 0) setAutomationProjectId(projects[0].id)
                              const schedData: any = {
                                id: "__new__", name: tplName(tmpl), prompt: tmpl.prompt || "",
                                templateId: tmpl.id, enabled: true,
                                schedule: { type: "daily", timeOfDay: "03:00" },
                              }
                              if (isMultiCrew && tmpl.crew) {
                                schedData.crew = JSON.parse(JSON.stringify(tmpl.crew))
                              }
                              setEditingAutomation(schedData as typeof projectAutomations[0])
                              setShowAutomation(true)
                            }} style={{
                              padding: "6px 12px", borderRadius: 8,
                              border: "1px solid var(--glass-border)", background: "rgba(55,172,192,0.1)",
                              color: "#37ACC0", fontSize: 11, fontWeight: 600, cursor: "pointer",
                              display: "flex", alignItems: "center", gap: 4,
                            }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                              {t("templates.newSchedule")}
                            </button>
                            {/* Pin */}
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

                // When search active, flat list
                if (tplSearch) {
                  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{filtered.map(renderCard)}</div>
                }

                // Group by type: Crew → Chain → Prompt (priority order)
                const typeGroups = [
                  { key: "crew", label: t("templates.filterCrew"), test: isCrew },
                  { key: "chain", label: t("templates.filterChain"), test: isChain },
                  { key: "prompt", label: t("templates.filterPrompt"), test: isPrompt },
                ]
                return typeGroups.map((g) => {
                  const items = filtered.filter(g.test)
                  if (items.length === 0) return null
                  return (
                    <div key={g.key} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#37ACC0", marginBottom: 8, letterSpacing: 0.5 }}>
                        {g.label}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {items.map(renderCard)}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* ========== Overlays ========== */}

      {/* Project context menu */}
      {contextProjectId && (() => {
        const proj = projects.find(p => p.id === contextProjectId)
        const sessions = sessionsByProject.get(contextProjectId) || []
        if (!proj) return null

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
                icon: <PlusIcon size={18} />,
                label: t("overview.newSession"),
                desc: t("overview.startSessionIn", { name: proj.name }),
                onClick: () => {
                  setSheetProjectId(proj.id)
                  setContextProjectId(null)
                  setShowNewSheet(true)
                },
              })}

              {actionRow({
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
                label: t("overview.viewPrd"),
                desc: t("prd.viewDesc") || "View plan and task progress",
                onClick: () => {
                  setPrdProjectId(proj.id)
                  setContextProjectId(null)
                },
              })}

              {actionRow({
                icon: <ClockIcon size={18} />,
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

              {sessions.filter(s => s.worktreeBranch).length > 0 && actionRow({
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 009 9" /></svg>,
                label: t("unified.mergeToMain"),
                desc: t("unified.mergeAllDesc") || "Merge all session worktrees to main",
                onClick: () => {
                  sessions.filter(s => s.worktreeBranch).forEach(s => {
                    send?.({ type: "merge_worktree", sessionId: s.id })
                  })
                  setContextProjectId(null)
                },
              })}

              {actionRow({
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
                label: t("unified.renameProject"),
                desc: "",
                onClick: () => {
                  setProjectRenameValue(proj.name)
                  setRenamingProjectId(proj.id)
                  setContextProjectId(null)
                },
              })}

              {sessions.length > 0 && actionRow({
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>,
                label: t("overview.killAll"),
                desc: t(sessions.length !== 1 ? "count.sessions" : "count.session", { count: String(sessions.length) }),
                color: "#ef4444",
                onClick: () => {
                  sessions.forEach(s => onKillSession?.(s.id))
                  setContextProjectId(null)
                },
              })}

              <div style={{ height: 1, background: "var(--glass-border)", margin: "4px 20px" }} />

              {actionRow({
                icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>,
                label: t("unified.closeProject"),
                desc: t("unified.closeProjectDesc") || "Remove from panel",
                color: "#f59e0b",
                onClick: () => {
                  sessions.forEach(s => onKillSession?.(s.id))
                  onDeleteProject?.(contextProjectId)
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

      {/* Project rename dialog */}
      {renamingProjectId && (
        <>
          <div
            onClick={() => setRenamingProjectId(null)}
            style={{
              position: "fixed", inset: 0, zIndex: 400,
              background: "rgba(0,0,0,0.5)",
              backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
            }}
          />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            zIndex: 401, width: "min(320px, 85vw)",
            background: "var(--card-bg)",
            backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
            border: "1px solid var(--glass-border)",
            borderRadius: 16, padding: 20,
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
              {t("unified.renameProject")}
            </div>
            <input
              autoFocus
              value={projectRenameValue}
              onChange={(e) => setProjectRenameValue(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && projectRenameValue.trim()) {
                  const serverUrl = localStorage.getItem("agentrune_server") || ""
                  try {
                    await fetch(buildApiUrl(`/api/projects/${renamingProjectId}`, serverUrl), {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: projectRenameValue.trim() }),
                    })
                    // Update local projects array
                    const proj = projects.find(p => p.id === renamingProjectId)
                    if (proj) (proj as any).name = projectRenameValue.trim()
                  } catch {}
                  setRenamingProjectId(null)
                }
              }}
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14,
                borderRadius: 10, border: "1px solid var(--glass-border)",
                background: "var(--glass-bg)",
                color: "var(--text-primary)", outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button
                onClick={() => setRenamingProjectId(null)}
                style={{
                  padding: "8px 16px", fontSize: 13, fontWeight: 600,
                  borderRadius: 8, border: "1px solid var(--glass-border)",
                  background: "transparent", color: "var(--text-secondary)", cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!projectRenameValue.trim()) return
                  const serverUrl = localStorage.getItem("agentrune_server") || ""
                  try {
                    await fetch(buildApiUrl(`/api/projects/${renamingProjectId}`, serverUrl), {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: projectRenameValue.trim() }),
                    })
                    const proj = projects.find(p => p.id === renamingProjectId)
                    if (proj) (proj as any).name = projectRenameValue.trim()
                  } catch {}
                  setRenamingProjectId(null)
                }}
                style={{
                  padding: "8px 16px", fontSize: 13, fontWeight: 600,
                  borderRadius: 8, border: "none",
                  background: "#37ACC0", color: "#fff", cursor: "pointer",
                }}
              >
                OK
              </button>
            </div>
          </div>
        </>
      )}

      {/* Session context menu */}
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
                      if (renameValue.trim()) setSessionLabelStorage(contextSessionId, renameValue.trim())
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

              {/* Open */}
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
                  window.dispatchEvent(new CustomEvent("agentrune:snapshot", {
                    detail: { sessionId: contextSessionId, name },
                  }))
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
                  <MicIcon size={18} />
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
                  <ClockIcon size={18} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t("automation.title")}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{t("automation.noAutomationsHint")}</div>
                </div>
              </button>

              {/* Merge worktree */}
              {session.worktreeBranch && (
                <button
                  onClick={() => {
                    send?.({ type: "merge_worktree", sessionId: contextSessionId })
                    setContextSessionId(null)
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 16,
                    width: "100%", padding: "14px 20px",
                    background: "transparent", border: "none",
                    color: "#22c55e", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#22c55e",
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{t("mc.mergeWorktree") || "Merge Worktree"}</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{t("mc.mergeWorktreeDesc") || "Merge this branch to main"}</div>
                  </div>
                </button>
              )}

              {/* Discard worktree */}
              {session.worktreeBranch && (
                <button
                  onClick={() => {
                    send?.({ type: "discard_worktree", sessionId: contextSessionId })
                    setContextSessionId(null)
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 16,
                    width: "100%", padding: "14px 20px",
                    background: "transparent", border: "none",
                    color: "#f59e0b", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#f59e0b",
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{t("mc.discardWorktree") || "Discard Worktree"}</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{t("mc.discardWorktreeDesc") || "Delete worktree and discard changes"}</div>
                  </div>
                </button>
              )}

              <div style={{ height: 1, margin: "2px 20px", background: "var(--glass-border)" }} />

              {/* Kill */}
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
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t("overview.killThis") || "Terminate"}</div>
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

      {/* NewSessionSheet */}
      <NewSessionSheet
        open={showNewSheet}
        projects={projects}
        selectedProject={sheetProjectId || selectedProject}
        onClose={() => { setShowNewSheet(false); setSheetProjectId(null) }}
        onLaunch={onLaunch}
        onNewProject={onNewProject}
        onDeleteProject={onDeleteProject}
      />

      {/* Device sheet */}
      <AnimatePresence>
      {showDevices && (
        <>
          <motion.div
            key="dev-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.2 }}
            onClick={() => setShowDevices(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 200,
              background: "rgba(0,0,0,0.4)",
              backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
            }}
          />
          <motion.div
            key="dev-sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", transition: { duration: 0.2, ease: "easeIn" } }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
            style={{
              position: "fixed",
              bottom: 0, left: 0, right: 0, zIndex: 201,
              background: "var(--card-bg)",
              backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
              borderTop: "1px solid var(--glass-border)",
              borderRadius: "24px 24px 0 0",
              padding: "20px 20px calc(20px + env(safe-area-inset-bottom, 0px))",
              maxHeight: "70dvh", overflowY: "auto",
            }}
          >
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
                  const isConnected = wsConnected && (currentServer === url || currentServer === `http://${device.localIp}:${device.port}`)
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
                        border: isConnected ? "1.5px solid rgba(74, 222, 128, 0.4)" : "1px solid var(--glass-border)",
                        background: isConnected ? "rgba(74, 222, 128, 0.06)" : "var(--glass-bg)",
                        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                        cursor: "pointer", textAlign: "left",
                        color: "var(--text-primary)", transition: "all 0.2s",
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

            {/* Manual input */}
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
          </motion.div>
        </>
      )}
      </AnimatePresence>

      <AutomationReportSheet
        open={!!resultReportTarget}
        automationName={resultReportTarget?.automationName || ""}
        results={resultsData.get(resultReportTarget?.automationId || "") || []}
        selectedResultId={resultReportTarget?.resultId || null}
        onSelectResult={(resultId) => setResultReportTarget((prev) => prev ? { ...prev, resultId } : prev)}
        onClose={() => setResultReportTarget(null)}
      />

      {/* AutomationSheet */}
      <AutomationSheet
        open={showAutomation}
        projectId={automationProjectId || selectedProject || (projects.length > 0 ? projects[0].id : "")}
        serverUrl={localStorage.getItem("agentrune_server") || ""}
        onClose={() => { setShowAutomation(false); setEditingAutomation(null) }}
        initialEdit={editingAutomation}
        onLaunchSession={() => {
          setShowAutomation(false)
          setEditingAutomation(null)
          onLaunch(automationProjectId || selectedProject || "", "claude")
        }}
      />

      {/* Plan Page */}
      <PrdPage
        open={!!prdProjectId}
        projectId={prdProjectId || ""}
        projectName={projects.find(p => p.id === prdProjectId)?.name || ""}
        onClose={() => setPrdProjectId(null)}
        theme={theme}
      />

      {/* Voice Overlay */}
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
                    <MicIcon size={14} />
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

      {/* Chain editor overlay */}
      {chainEditSlug && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "var(--bg-primary)" }}>
          <ChainBuilder
            initialSlug={chainEditSlug}
            onBack={() => setChainEditSlug(null)}
            t={t}
            onSchedule={(slug) => {
              setChainEditSlug(null)
              if (!automationProjectId && projects.length > 0) setAutomationProjectId(projects[0].id)
              const chainTpl = CHAIN_TEMPLATES.find(ct => ct.id === `chain_${slug}`)
              const editData: any = {
                id: "__new__", name: chainTpl ? tplName(chainTpl) : slug, prompt: "",
                templateId: chainTpl?.id || slug, enabled: true,
                schedule: { type: "daily", timeOfDay: "03:00" },
              }
              setEditingAutomation(editData as typeof projectAutomations[0])
              setShowAutomation(true)
            }}
          />
        </div>
      )}
    </div>
  )
}
