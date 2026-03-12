// components/AutomationSheet.tsx
// Alarm-clock style scheduling sheet with template support
import { useState, useEffect, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useLocale } from "../lib/i18n"
import { AGENTS } from "../types"
import { BUILTIN_TEMPLATES, TEMPLATE_GROUPS } from "../data/builtin-templates"
import type { AutomationConfig, AutomationSchedule, AutomationResult, AutomationTemplate } from "../data/automation-types"
import type { ReactNode } from "react"
import { useSwipeToDismiss } from "../hooks/useSwipeToDismiss"

// --- Lucide-style SVG icons for each template (by template id suffix) ---
const TEMPLATE_ICONS: Record<string, ReactNode> = {
  scan_commits: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  release_notes: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  standup: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  pr_review: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  ci_failures: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
  test_coverage: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>,
  dep_check: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  security_scan: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  env_audit: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
  dead_code: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>,
  todo_sweep: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  type_safety: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  weekly_summary: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6z"/></svg>,
  changelog: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  api_docs: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  onboarding_doc: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>,
  perf_audit: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  bundle_size: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  error_digest: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  db_migration: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
  skill_suggest: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>,
  release_check: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
}

/** Lucide-style SVG icon for custom templates (document with lines) */
const CUSTOM_TEMPLATE_ICON: ReactNode = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>

/** Get icon for a template by its id */
function getTemplateIcon(tmpl: AutomationTemplate): ReactNode {
  if (tmpl.category === "custom") return CUSTOM_TEMPLATE_ICON
  const key = tmpl.id.replace("builtin_", "")
  return TEMPLATE_ICONS[key] || <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
}

// --- Group label i18n keys ---
const GROUP_I18N: Record<string, string> = {
  git: "Git",
  ci: "CI",
  security: "Security",
  quality: "Quality",
  docs: "Docs",
  perf: "Perf",
  monitoring: "Monitor",
  learning: "Learn",
}

interface AutomationSheetProps {
  open: boolean
  projectId: string
  serverUrl: string
  onClose: () => void
  /** When provided, open directly into edit mode for this automation */
  initialEdit?: { id: string; name: string; prompt: string; skill?: string; templateId?: string; schedule: { type: string; timeOfDay?: string; weekdays?: number[]; intervalMinutes?: number }; runMode?: string; agentId?: string; bypass?: boolean } | null
}

// --- Weekday labels ---
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

// --- SVG Icons ---

function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function IconChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

// --- Toggle Switch ---

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!checked) }}
      style={{
        width: 44, height: 24, borderRadius: 12, padding: 2,
        border: "none",
        background: checked ? "#37ACC0" : "var(--glass-border, #334155)",
        cursor: "pointer", transition: "background 0.2s",
        display: "flex", alignItems: "center", flexShrink: 0,
      }}
    >
      <div style={{
        width: 20, height: 20, borderRadius: "50%", background: "#fff",
        transform: checked ? "translateX(20px)" : "translateX(0)",
        transition: "transform 0.2s",
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      }} />
    </button>
  )
}

// --- Pill toggle ---

function PillToggle({ options, value, onChange }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{
      display: "flex", gap: 0,
      background: "rgba(0,0,0,0.06)", borderRadius: 10, padding: 3,
    }}>
      {options.map((opt) => (
        <button key={opt.value} onClick={() => onChange(opt.value)} style={{
          flex: 1, padding: "6px 14px", borderRadius: 8,
          border: "none",
          background: value === opt.value ? "#37ACC0" : "transparent",
          color: value === opt.value ? "#fff" : "#52667a",
          fontSize: 12, fontWeight: 600, cursor: "pointer",
          transition: "all 0.2s",
        }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// --- Weekday circles ---

function WeekdayPicker({ selected, onChange }: { selected: number[]; onChange: (days: number[]) => void }) {
  const toggle = (day: number) => {
    if (selected.includes(day)) {
      onChange(selected.filter((d) => d !== day))
    } else {
      onChange([...selected, day].sort())
    }
  }
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
      {WEEKDAY_LABELS.map((label, i) => {
        const active = selected.includes(i)
        return (
          <button key={i} onClick={() => toggle(i)} style={{
            width: 34, height: 34, borderRadius: "50%",
            border: active ? "2px solid #37ACC0" : "1px solid var(--glass-border)",
            background: active ? "rgba(55,172,192,0.15)" : "transparent",
            color: active ? "#37ACC0" : "var(--text-secondary)",
            fontSize: 11, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.2s",
          }}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

// --- Status dot ---

function StatusDot({ status }: { status?: string }) {
  const color = status === "success" ? "#22c55e" : status === "timeout" ? "#f59e0b" : status === "failed" ? "#ef4444" : "var(--text-secondary)"
  return <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
}

// --- Keyword matching for proactive template suggestion ---

const KEYWORD_MAP: Record<string, string[]> = {
  builtin_scan_commits: ["commit", "bug", "scan", "diff", "review"],
  builtin_release_notes: ["release", "notes", "changelog", "pr", "merge"],
  builtin_standup: ["standup", "daily", "yesterday", "status", "morning"],
  builtin_pr_review: ["pr", "pull request", "review", "risk"],
  builtin_ci_failures: ["ci", "pipeline", "test", "fail", "flaky"],
  builtin_test_coverage: ["test", "coverage", "untested", "gap"],
  builtin_dep_check: ["dependency", "outdated", "upgrade", "npm", "package"],
  builtin_security_scan: ["security", "secret", "xss", "injection", "vulnerability"],
  builtin_env_audit: ["env", "environment", "variable", ".env", "config"],
  builtin_dead_code: ["dead", "unused", "import", "export", "cleanup"],
  builtin_todo_sweep: ["todo", "fixme", "hack", "comment"],
  builtin_type_safety: ["type", "any", "typescript", "null", "assertion"],
  builtin_weekly_summary: ["weekly", "summary", "report", "update"],
  builtin_changelog: ["changelog", "update", "log", "version"],
  builtin_api_docs: ["api", "doc", "endpoint", "swagger", "openapi"],
  builtin_onboarding_doc: ["onboarding", "guide", "readme", "setup", "new developer"],
  builtin_perf_audit: ["performance", "perf", "slow", "optimize", "n+1"],
  builtin_bundle_size: ["bundle", "size", "chunk", "build", "webpack", "vite"],
  builtin_error_digest: ["error", "log", "crash", "warning", "exception"],
  builtin_db_migration: ["migration", "database", "schema", "index", "prisma"],
  builtin_skill_suggest: ["skill", "learn", "improve", "growth"],
  builtin_release_check: ["release", "check", "deploy", "tag", "pre-release"],
}

function matchTemplates(input: string): AutomationTemplate[] {
  if (!input || input.length < 2) return []
  const lower = input.toLowerCase()
  const scores = new Map<string, number>()
  for (const [templateId, keywords] of Object.entries(KEYWORD_MAP)) {
    let score = 0
    for (const kw of keywords) {
      if (lower.includes(kw)) score += kw.length
    }
    if (score > 0) scores.set(templateId, score)
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => BUILTIN_TEMPLATES.find((t) => t.id === id))
    .filter(Boolean) as AutomationTemplate[]
}

// --- Recommended templates (top picks for empty state) ---
const RECOMMENDED_IDS = [
  "builtin_scan_commits",
  "builtin_standup",
  "builtin_security_scan",
  "builtin_dep_check",
  "builtin_test_coverage",
  "builtin_weekly_summary",
]

// --- Template i18n helpers ---

function useTemplateI18n() {
  const { t } = useLocale()
  return {
    tplName: (tmpl: AutomationTemplate) => {
      const key = tmpl.id.replace("builtin_", "")
      const translated = t(`tpl.${key}`)
      return translated !== `tpl.${key}` ? translated : tmpl.name
    },
    tplDesc: (tmpl: AutomationTemplate) => {
      const key = tmpl.id.replace("builtin_", "")
      const translated = t(`tpl.${key}.desc`)
      return translated !== `tpl.${key}.desc` ? translated : tmpl.description
    },
  }
}

// --- Main Component ---

export function AutomationSheet({ open, projectId, serverUrl, onClose, initialEdit }: AutomationSheetProps) {
  const { t } = useLocale()
  const { tplName, tplDesc } = useTemplateI18n()
  const [automations, setAutomations] = useState<AutomationConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState<"list" | "add" | "templates" | "pick">("list")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [results, setResults] = useState<AutomationResult[]>([])
  const [loadingResults, setLoadingResults] = useState(false)

  // Add/edit form state
  const [editId, setEditId] = useState<string | null>(null)
  const [formName, setFormName] = useState("")
  const [formPrompt, setFormPrompt] = useState("")
  const [formSkill, setFormSkill] = useState("")
  const [formTemplateId, setFormTemplateId] = useState<string | null>(null)
  const [formScheduleType, setFormScheduleType] = useState<"daily" | "interval">("daily")
  const [formTimeOfDay, setFormTimeOfDay] = useState("09:00")
  const [formWeekdays, setFormWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [formInterval, setFormInterval] = useState("30")
  const [formRunMode, setFormRunMode] = useState<"local" | "worktree">("local")
  const [formAgentId, setFormAgentId] = useState("claude")
  const [formModel, setFormModel] = useState("")
  const [formBypass, setFormBypass] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Template browsing
  const [templateTab, setTemplateTab] = useState<"all" | "pinned" | "recommended">("all")
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [templateSearch, setTemplateSearch] = useState("")
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("agentrune_pinned_templates") || "[]") } catch { return [] }
  })

  // Custom templates (localStorage)
  const [customTemplates, setCustomTemplates] = useState<AutomationTemplate[]>(() => {
    try { return JSON.parse(localStorage.getItem("agentrune_custom_templates") || "[]") } catch { return [] }
  })

  // Sheet ref for scroll reset
  const sheetRef = useRef<HTMLDivElement>(null)
  const { handlers: swipeHandlers } = useSwipeToDismiss({ onDismiss: onClose, sheetRef })

  // Fullscreen prompt editor
  const [promptExpanded, setPromptExpanded] = useState(false)

  // Toast
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  // Prompt keyword match suggestions
  const promptMatches = matchTemplates(formPrompt)

  const fetchAutomations = useCallback(async () => {
    if (!serverUrl || !projectId) return
    setLoading(true)
    try {
      const res = await fetch(`${serverUrl}/api/automations/${projectId}`)
      if (res.ok) setAutomations(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [serverUrl, projectId])

  useEffect(() => {
    if (open) {
      if (initialEdit) {
        setEditId(initialEdit.id)
        setFormName(initialEdit.name)
        setFormPrompt(initialEdit.prompt || "")
        setFormSkill(initialEdit.skill || "")
        setFormTemplateId(initialEdit.templateId || null)
        setFormScheduleType((initialEdit.schedule.type as "daily" | "interval") || "daily")
        setFormTimeOfDay(initialEdit.schedule.timeOfDay || "09:00")
        setFormWeekdays(initialEdit.schedule.weekdays || [1, 2, 3, 4, 5])
        setFormInterval(String(initialEdit.schedule.intervalMinutes || 30))
        setFormRunMode((initialEdit.runMode as "local" | "worktree") || "local")
        setFormAgentId(initialEdit.agentId || "claude")
        setFormModel((initialEdit as any).model || "")
        setFormBypass(!!initialEdit.bypass)
        setPage("add")
      } else {
        setPage("pick")
      }
      setExpandedId(null)
    }
  }, [open, initialEdit])

  // Scroll to top when page changes
  useEffect(() => {
    if (sheetRef.current) sheetRef.current.scrollTop = 0
  }, [page])

  // Back button — directly close (list/templates pages moved to Panel 1 tabs)
  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [open, page, onClose])

  // --- Handlers ---

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await fetch(`${serverUrl}/api/automations/${projectId}/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
      setAutomations((prev) => prev.map((a) => a.id === id ? { ...a, enabled } : a))
    } catch { /* ignore */ }
  }

  const handleDelete = async (id: string) => {
    try {
      await fetch(`${serverUrl}/api/automations/${projectId}/${id}`, { method: "DELETE" })
      setAutomations((prev) => prev.filter((a) => a.id !== id))
      if (expandedId === id) setExpandedId(null)
    } catch { /* ignore */ }
  }

  const handleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    setLoadingResults(true)
    try {
      const res = await fetch(`${serverUrl}/api/automations/${projectId}/${id}/results`)
      if (res.ok) setResults(await res.json())
      else setResults([])
    } catch { setResults([]) }
    setLoadingResults(false)
  }

  const openAddForm = (template?: AutomationTemplate) => {
    setEditId(null)
    setFormName(template?.name || "")
    setFormPrompt(template?.prompt || "")
    setFormSkill(template?.skill || "")
    setFormTemplateId(template?.id || null)
    setFormScheduleType("daily")
    setFormTimeOfDay("09:00")
    setFormWeekdays([1, 2, 3, 4, 5])
    setFormInterval("30")
    setFormRunMode("local")
    setFormAgentId("claude")
    setFormModel("")
    setFormBypass(false)
    setPage("add")
  }

  const handleSubmit = async () => {
    if (!formName.trim() || !formPrompt.trim()) return
    setSubmitting(true)

    const schedule: AutomationSchedule = { type: formScheduleType }
    if (formScheduleType === "daily") {
      schedule.timeOfDay = formTimeOfDay
      schedule.weekdays = formWeekdays
    } else {
      schedule.intervalMinutes = parseInt(formInterval) || 30
    }

    const body = {
      name: formName.trim(),
      prompt: formPrompt.trim(),
      skill: formSkill.trim() || undefined,
      templateId: formTemplateId || undefined,
      schedule,
      runMode: formRunMode,
      agentId: formAgentId,
      model: formModel || undefined,
      bypass: formBypass || undefined,
      enabled: true,
    }

    try {
      if (editId) {
        const res = await fetch(`${serverUrl}/api/automations/${projectId}/${editId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        if (res.ok) {
          const updated = await res.json()
          setAutomations((prev) => prev.map((a) => a.id === editId ? updated : a))
          showToast(t("automation.updated") || "Schedule updated")
          onClose()
        } else {
          console.error("[AutomationSheet] PATCH failed:", res.status, await res.text().catch(() => ""))
          showToast(`Save failed (${res.status})`, 3000)
        }
      } else {
        const res = await fetch(`${serverUrl}/api/automations/${projectId}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        if (res.ok) {
          const auto = await res.json()
          setAutomations((prev) => [...prev, auto])
          showToast(t("automation.created") || "Schedule created")
          onClose()
        } else {
          console.error("[AutomationSheet] POST failed:", res.status, await res.text().catch(() => ""))
          showToast(`Create failed (${res.status})`, 3000)
        }
      }
    } catch (err) {
      console.error("[AutomationSheet] fetch error:", err)
      showToast("Network error", 3000)
    }
    setSubmitting(false)
  }

  const togglePin = (templateId: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(templateId) ? prev.filter((id) => id !== templateId) : [...prev, templateId]
      localStorage.setItem("agentrune_pinned_templates", JSON.stringify(next))
      return next
    })
  }

  const saveAsCustomTemplate = () => {
    if (!formName.trim() || !formPrompt.trim()) return
    const id = `custom_${Date.now()}`
    const tmpl: AutomationTemplate = {
      id,
      name: formName.trim(),
      description: formPrompt.trim().slice(0, 100) + (formPrompt.length > 100 ? "..." : ""),
      icon: "",
      prompt: formPrompt.trim(),
      skill: formSkill.trim() || undefined,
      category: "custom",
      visibility: "private",
      rating: 0,
      ratingCount: 0,
      pinCount: 0,
      tags: [],
      group: "custom",
      createdAt: Date.now(),
    }
    const next = [...customTemplates, tmpl]
    setCustomTemplates(next)
    localStorage.setItem("agentrune_custom_templates", JSON.stringify(next))
    showToast(t("automation.templateSaved") || "Template saved")
  }

  const deleteCustomTemplate = (id: string) => {
    const next = customTemplates.filter((t) => t.id !== id)
    setCustomTemplates(next)
    localStorage.setItem("agentrune_custom_templates", JSON.stringify(next))
    // Also unpin if pinned
    if (pinnedIds.includes(id)) togglePin(id)
    showToast(t("automation.templateDeleted") || "Template deleted")
  }

  // Merge builtin + custom for display
  const allTemplates = [...BUILTIN_TEMPLATES, ...customTemplates]

  // --- Formatters ---

  const formatSchedule = (s: AutomationSchedule): string => {
    if (s.type === "daily") {
      const days = (s.weekdays || []).map((d) => WEEKDAY_LABELS[d]).join(" ")
      return `${s.timeOfDay || "09:00"} ${days}`
    }
    if (s.type === "interval") return `${t("automation.every")} ${s.intervalMinutes || 30} ${t("automation.minutes")}`
    return s.type
  }

  const formatTime = (ts: number): string => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60_000).toFixed(1)}m`
  }

  return (
    <AnimatePresence>
      {open && (
      <>
      {/* Backdrop */}
      <motion.div
        key="auto-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.15 } }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        }}
      />

      {/* Sheet */}
      <motion.div
        key="auto-sheet"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%", transition: { duration: 0.2, ease: "easeIn" } }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        ref={sheetRef} {...swipeHandlers}
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 201,
          background: "#e5ddd5",
          borderTop: "1px solid rgba(0,0,0,0.08)", borderRadius: "24px 24px 0 0",
          padding: "20px 20px calc(20px + env(safe-area-inset-bottom, 0px))",
          maxHeight: "85dvh", overflowY: "auto",
          color: "#1e293b",
        }}
      >
        {/* Handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#94a3b8", opacity: 0.3, margin: "0 auto 20px" }} />

        {page === "pick" ? (
          /* ======================== TEMPLATE PICKER (entry page) ======================== */
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1e293b" }}>
                {t("automation.newAutomation") || "New Schedule"}
              </div>
            </div>

            {/* Manual create button — top entry */}
            <button onClick={() => openAddForm()} style={{
              display: "flex", alignItems: "center", gap: 12,
              width: "100%", padding: "14px 16px", borderRadius: 14,
              border: "1.5px dashed #c8bfb6", background: "transparent",
              cursor: "pointer", textAlign: "left", marginBottom: 12,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: "#ddd5cc", border: "1px solid #c8bfb6",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#64748b",
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1e293b" }}>
                  {t("automation.manualCreate") || "Manual"}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  {t("automation.manualCreateDesc") || "Start from scratch"}
                </div>
              </div>
            </button>

            {/* Search bar */}
            <div style={{ position: "relative", marginBottom: 10 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text" value={templateSearch} onChange={(e) => setTemplateSearch(e.target.value)}
                placeholder={t("automation.searchTemplates") || "Search templates..."}
                style={{
                  width: "100%", padding: "10px 14px 10px 34px", borderRadius: 12,
                  border: "1px solid #c8bfb6", background: "#ddd5cc",
                  color: "#1e293b", fontSize: 13, outline: "none", boxSizing: "border-box",
                }}
              />
              {templateSearch && (
                <button onClick={() => setTemplateSearch("")} style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 4,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            {/* Category filter chips */}
            <div style={{
              display: "flex", gap: 6, overflowX: "auto", paddingBottom: 10, marginBottom: 4,
              WebkitOverflowScrolling: "touch", scrollbarWidth: "none",
            }}>
              <button onClick={() => setSelectedGroup(null)} style={{
                padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer",
                background: selectedGroup === null ? "rgba(55, 172, 192, 0.15)" : "#ddd5cc",
                color: selectedGroup === null ? "#37ACC0" : "#64748b",
                fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
              }}>
                {t("automation.allCategories") || "All"}
              </button>
              {customTemplates.length > 0 && (
                <button onClick={() => setSelectedGroup(selectedGroup === "custom" ? null : "custom")} style={{
                  padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer",
                  background: selectedGroup === "custom" ? "rgba(55, 172, 192, 0.15)" : "#ddd5cc",
                  color: selectedGroup === "custom" ? "#37ACC0" : "#64748b",
                  fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  {t("automation.myTemplates") || "My Templates"}
                </button>
              )}
              {TEMPLATE_GROUPS.map((g) => (
                <button key={g.key} onClick={() => setSelectedGroup(selectedGroup === g.key ? null : g.key)} style={{
                  padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer",
                  background: selectedGroup === g.key ? "rgba(55, 172, 192, 0.15)" : "#ddd5cc",
                  color: selectedGroup === g.key ? "#37ACC0" : "#64748b",
                  fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  {t(`tplGroup.${g.key}`) !== `tplGroup.${g.key}` ? t(`tplGroup.${g.key}`) : g.label}
                </button>
              ))}
            </div>

            {/* Template list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "50dvh", overflowY: "auto" }}>
              {(() => {
                const filtered = allTemplates.filter((tmpl) => {
                  if (selectedGroup && tmpl.group !== selectedGroup) return false
                  if (templateSearch) {
                    const q = templateSearch.toLowerCase()
                    return tplName(tmpl).toLowerCase().includes(q)
                      || tplDesc(tmpl).toLowerCase().includes(q)
                      || (tmpl.tags || []).some((tag) => tag.includes(q))
                  }
                  return true
                })

                const pinnedTemplates = filtered.filter((tmpl) => pinnedIds.includes(tmpl.id))
                const customFiltered = filtered.filter((tmpl) => tmpl.category === "custom")

                if (templateSearch || selectedGroup) {
                  return filtered.map((tmpl) => (
                    <PickCard key={tmpl.id} tmpl={tmpl} tplName={tplName} tplDesc={tplDesc} onUse={() => openAddForm(tmpl)} icon={tmpl.category === "custom" ? undefined : getTemplateIcon(tmpl)} pinned={pinnedIds.includes(tmpl.id)} onTogglePin={() => togglePin(tmpl.id)} onDelete={tmpl.category === "custom" ? () => deleteCustomTemplate(tmpl.id) : undefined} />
                  ))
                }

                return (
                  <>
                    {/* Pinned section */}
                    {pinnedTemplates.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#37ACC0", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
                          {t("automation.pinned") || "Pinned"}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {pinnedTemplates.map((tmpl) => (
                            <PickCard key={tmpl.id} tmpl={tmpl} tplName={tplName} tplDesc={tplDesc} onUse={() => openAddForm(tmpl)} icon={tmpl.category === "custom" ? undefined : getTemplateIcon(tmpl)} pinned onTogglePin={() => togglePin(tmpl.id)} onDelete={tmpl.category === "custom" ? () => deleteCustomTemplate(tmpl.id) : undefined} />
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Custom templates section */}
                    {customFiltered.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#37ACC0", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
                          {t("automation.myTemplates") || "My Templates"}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {customFiltered.map((tmpl) => (
                            <PickCard key={tmpl.id} tmpl={tmpl} tplName={tplName} tplDesc={tplDesc} onUse={() => openAddForm(tmpl)} pinned={pinnedIds.includes(tmpl.id)} onTogglePin={() => togglePin(tmpl.id)} onDelete={() => deleteCustomTemplate(tmpl.id)} />
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Grouped display */}
                    {TEMPLATE_GROUPS.map((g) => {
                      const items = filtered.filter((tmpl) => tmpl.group === g.key && tmpl.category !== "custom")
                      if (items.length === 0) return null
                      return (
                        <div key={g.key} style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
                            {t(`tplGroup.${g.key}`) !== `tplGroup.${g.key}` ? t(`tplGroup.${g.key}`) : g.label}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {items.map((tmpl) => (
                              <PickCard key={tmpl.id} tmpl={tmpl} tplName={tplName} tplDesc={tplDesc} onUse={() => openAddForm(tmpl)} icon={getTemplateIcon(tmpl)} pinned={pinnedIds.includes(tmpl.id)} onTogglePin={() => togglePin(tmpl.id)} />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </>
                )
              })()}
            </div>
          </>
        ) : page === "list" ? (
          /* ======================== LIST PAGE ======================== */
          <>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                {t("automation.title")}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setPage("templates")} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "8px 12px", borderRadius: 12,
                  border: "1px solid var(--glass-border)", background: "transparent",
                  color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
                  {t("automation.templates") || "Templates"}
                </button>
                <button onClick={() => openAddForm()} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "8px 12px", borderRadius: 12,
                  border: "1px solid var(--glass-border)", background: "#37ACC0",
                  color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}>
                  <IconPlus /> {t("automation.add")}
                </button>
              </div>
            </div>

            {/* Automation list */}
            {loading ? (
              <div style={{ textAlign: "center", color: "var(--text-secondary)", padding: 20, fontSize: 13 }}>
                {t("automation.loading")}
              </div>
            ) : automations.length === 0 ? (
              /* Empty state */
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, marginBottom: 12 }}>
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
                <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 4 }}>
                  {t("automation.noAutomations") || "No schedules yet"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", opacity: 0.6, marginBottom: 20 }}>
                  {t("automation.noAutomationsHint")}
                </div>
                <button onClick={() => openAddForm()} style={{
                  padding: "10px 24px", borderRadius: 12,
                  border: "1px solid var(--glass-border)", background: "#37ACC0",
                  color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}>
                  <IconPlus /> {t("automation.newAutomation") || "New Schedule"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {automations.map((auto) => {
                  const isExpanded = expandedId === auto.id
                  const statusColor = auto.lastRunStatus === "success" ? "#22c55e" : auto.lastRunStatus === "timeout" ? "#f59e0b" : auto.lastRunStatus === "failed" ? "#ef4444" : undefined
                  return (
                    <div key={auto.id} style={{
                      borderRadius: 16,
                      border: `1px solid ${auto.enabled ? "var(--glass-border)" : "rgba(100,100,100,0.15)"}`,
                      background: "var(--glass-bg)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                      overflow: "hidden",
                      opacity: auto.enabled ? 1 : 0.55,
                      transition: "opacity 0.2s",
                    }}>
                      {/* Alarm-clock card row */}
                      <div onClick={() => handleExpand(auto.id)} style={{
                        display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", cursor: "pointer",
                      }}>
                        {/* Time display */}
                        <div style={{ minWidth: 60, flexShrink: 0 }}>
                          <div style={{
                            fontSize: auto.schedule.type === "daily" ? 26 : 16,
                            fontWeight: 300, fontFamily: "'Inter', system-ui, sans-serif",
                            color: auto.enabled ? "var(--text-primary)" : "var(--text-secondary)",
                            lineHeight: 1,
                            letterSpacing: "-0.5px",
                          }}>
                            {auto.schedule.type === "daily" ? (auto.schedule.timeOfDay || "09:00") : `${auto.schedule.intervalMinutes || 30}m`}
                          </div>
                          {/* Weekday dots */}
                          {auto.schedule.type === "daily" && (
                            <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
                              {WEEKDAY_LABELS.map((label, i) => {
                                const active = (auto.schedule.weekdays || []).includes(i)
                                return (
                                  <div key={i} style={{
                                    fontSize: 8, fontWeight: active ? 700 : 400,
                                    color: active ? "#37ACC0" : "var(--text-secondary)",
                                    opacity: active ? 1 : 0.4,
                                  }}>
                                    {label}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>

                        {/* Name + prompt preview + last run */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 14, fontWeight: 600,
                            color: auto.enabled ? "var(--text-primary)" : "var(--text-secondary)",
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}>
                            {auto.name}
                          </div>
                          <div style={{
                            fontSize: 11, color: "var(--text-secondary)", marginTop: 2,
                            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                            overflow: "hidden", lineHeight: 1.4,
                          }}>
                            {auto.prompt || auto.command || "—"}
                          </div>
                          {/* Last run status bar */}
                          {auto.lastRunAt && (
                            <div style={{
                              display: "flex", alignItems: "center", gap: 5, marginTop: 4, fontSize: 10,
                            }}>
                              <StatusDot status={auto.lastRunStatus} />
                              <span style={{ color: statusColor, fontWeight: 600 }}>
                                {auto.lastRunStatus === "success" ? "OK" : auto.lastRunStatus === "timeout" ? "Timeout" : auto.lastRunStatus === "failed" ? "Failed" : "—"}
                              </span>
                              <span style={{ color: "var(--text-secondary)", opacity: 0.6 }}>
                                {formatTime(auto.lastRunAt)}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Toggle + chevron */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Toggle checked={auto.enabled} onChange={(v) => handleToggle(auto.id, v)} />
                          <IconChevron expanded={isExpanded} />
                        </div>
                      </div>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div style={{ borderTop: "1px solid var(--glass-border)", padding: "12px 16px" }}>
                          {/* Prompt full text */}
                          <div style={{
                            fontSize: 12, color: "var(--text-secondary)",
                            background: "var(--icon-bg)", padding: "10px 12px", borderRadius: 10,
                            marginBottom: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5,
                            maxHeight: 120, overflowY: "auto",
                          }}>
                            {auto.prompt || auto.command}
                          </div>

                          {/* Meta tags */}
                          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                            {auto.agentId && (
                              <span style={{
                                fontSize: 10, padding: "3px 8px", borderRadius: 6,
                                background: "var(--icon-bg)", color: "var(--text-secondary)", fontWeight: 600,
                              }}>
                                {AGENTS.find((a) => a.id === auto.agentId)?.name || auto.agentId}
                                {(auto as any).model ? ` · ${(auto as any).model}` : ""}
                              </span>
                            )}
                            <span style={{
                              fontSize: 10, padding: "3px 8px", borderRadius: 6,
                              background: "var(--icon-bg)", color: "var(--text-secondary)", fontWeight: 600,
                            }}>
                              {auto.runMode === "worktree" ? "Worktree" : "Local"}
                            </span>
                            {auto.schedule.type === "interval" && (
                              <span style={{
                                fontSize: 10, padding: "3px 8px", borderRadius: 6,
                                background: "var(--icon-bg)", color: "var(--text-secondary)", fontWeight: 600,
                              }}>
                                Every {auto.schedule.intervalMinutes}min
                              </span>
                            )}
                          </div>

                          {/* Action buttons: Edit + Delete */}
                          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                            <button onClick={(e) => {
                              e.stopPropagation()
                              setEditId(auto.id)
                              setFormName(auto.name)
                              setFormPrompt(auto.prompt || auto.command || "")
                              setFormSkill(auto.skill || "")
                              setFormTemplateId(auto.templateId || null)
                              setFormScheduleType(auto.schedule.type)
                              setFormTimeOfDay(auto.schedule.timeOfDay || "09:00")
                              setFormWeekdays(auto.schedule.weekdays || [1,2,3,4,5])
                              setFormInterval(String(auto.schedule.intervalMinutes || 30))
                              setFormRunMode(auto.runMode || "local")
                              setFormAgentId(auto.agentId || "claude")
                              setFormModel((auto as any).model || "")
                              setFormBypass(!!(auto as any).bypass)
                              setPage("add")
                            }} style={{
                              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                              padding: "8px 0", borderRadius: 10,
                              border: "1px solid var(--glass-border)", background: "transparent",
                              color: "var(--text-primary)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                            }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              {t("automation.edit") || "Edit"}
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); handleDelete(auto.id) }} style={{
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                              padding: "8px 16px", borderRadius: 10,
                              border: "1px solid rgba(239,68,68,0.3)", background: "transparent",
                              color: "#ef4444", fontSize: 12, fontWeight: 600, cursor: "pointer",
                            }}>
                              <IconTrash /> {t("automation.delete")}
                            </button>
                          </div>

                          {/* Recent results */}
                          <div style={{
                            fontSize: 11, fontWeight: 700, color: "var(--text-secondary)",
                            textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8,
                          }}>
                            {t("automation.recentResults")}
                          </div>

                          {loadingResults ? (
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: 8 }}>{t("automation.loading")}</div>
                          ) : results.length === 0 ? (
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: 8, opacity: 0.6 }}>{t("automation.noResults")}</div>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {results.slice(-5).reverse().map((r) => {
                                const lines = (r.output || "").trim().split("\n")
                                const summary = lines.length > 3 ? lines.slice(0, 3).join("\n") + `\n... (${lines.length} lines)` : r.output
                                return (
                                  <div key={r.id} style={{
                                    padding: "10px 12px", borderRadius: 10,
                                    border: "1px solid var(--glass-border)", background: "var(--icon-bg)",
                                  }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <StatusDot status={r.status} />
                                        <span style={{
                                          fontSize: 11, fontWeight: 600,
                                          color: r.status === "success" ? "#22c55e" : r.status === "timeout" ? "#f59e0b" : "#ef4444",
                                        }}>
                                          {r.status === "success" ? "Success" : r.status === "timeout" ? "Timeout" : "Failed"}
                                        </span>
                                      </div>
                                      <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                                        {new Date(r.startedAt).toLocaleDateString([], { month: "short", day: "numeric" })} {formatTime(r.startedAt)} · {formatDuration(r.finishedAt - r.startedAt)}
                                      </div>
                                    </div>
                                    {r.output && (
                                      <div style={{
                                        fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                                        color: "var(--text-secondary)", maxHeight: 100, overflowY: "auto",
                                        whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.4,
                                        background: "rgba(0,0,0,0.15)", padding: "6px 8px", borderRadius: 6,
                                      }}>
                                        {summary}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : page === "templates" ? (
          /* ======================== TEMPLATES PAGE ======================== */
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setPage("list")} style={{
                  background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4,
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                  {t("automation.templates") || "Templates"}
                </div>
              </div>
            </div>

            {/* Search bar */}
            <div style={{ position: "relative", marginBottom: 12 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text" value={templateSearch} onChange={(e) => setTemplateSearch(e.target.value)}
                placeholder={t("automation.searchTemplates") || "Search templates..."}
                style={{
                  width: "100%", padding: "10px 14px 10px 34px", borderRadius: 12,
                  border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                  backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
                  color: "var(--text-primary)", fontSize: 13, outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {templateSearch && (
                <button onClick={() => setTemplateSearch("")} style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: 4,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            {/* Tab: All / Pinned */}
            <div style={{ display: "flex", gap: 0, marginBottom: 10, background: "var(--icon-bg)", borderRadius: 10, padding: 3 }}>
              {(["all", "pinned"] as const).map((tab) => (
                <button key={tab} onClick={() => setTemplateTab(tab)} style={{
                  flex: 1, padding: "6px 0", borderRadius: 8, border: "none", cursor: "pointer",
                  background: templateTab === tab ? "var(--glass-border)" : "transparent",
                  color: templateTab === tab ? "var(--text-primary)" : "var(--text-secondary)",
                  fontSize: 12, fontWeight: 600, transition: "all 0.2s",
                }}>
                  {tab === "all" ? (t("automation.allTemplates") || "All") : `Pinned (${pinnedIds.length})`}
                </button>
              ))}
            </div>

            {/* Category filter chips */}
            <div style={{
              display: "flex", gap: 6, overflowX: "auto", paddingBottom: 10, marginBottom: 4,
              WebkitOverflowScrolling: "touch", scrollbarWidth: "none",
            }}>
              <button onClick={() => setSelectedGroup(null)} style={{
                padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer",
                background: selectedGroup === null ? "rgba(55, 172, 192, 0.15)" : "var(--icon-bg)",
                color: selectedGroup === null ? "#37ACC0" : "var(--text-secondary)",
                fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
                transition: "all 0.2s",
              }}>
                {t("automation.allCategories") || "All"}
              </button>
              {TEMPLATE_GROUPS.map((g) => (
                <button key={g.key} onClick={() => setSelectedGroup(selectedGroup === g.key ? null : g.key)} style={{
                  padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer",
                  background: selectedGroup === g.key ? "rgba(55, 172, 192, 0.15)" : "var(--icon-bg)",
                  color: selectedGroup === g.key ? "#37ACC0" : "var(--text-secondary)",
                  fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
                  transition: "all 0.2s",
                }}>
                  {g.label}
                </button>
              ))}
            </div>

            {/* Template list — grouped by category */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "50dvh", overflowY: "auto" }}>
              {(() => {
                // Filter templates
                const filtered = BUILTIN_TEMPLATES.filter((tmpl) => {
                  if (templateTab === "pinned" && !pinnedIds.includes(tmpl.id)) return false
                  if (selectedGroup && tmpl.group !== selectedGroup) return false
                  if (templateSearch) {
                    const q = templateSearch.toLowerCase()
                    return tmpl.name.toLowerCase().includes(q)
                      || tmpl.description.toLowerCase().includes(q)
                      || (tmpl.tags || []).some((tag) => tag.includes(q))
                  }
                  return true
                })

                // When searching or filtering by single group, show flat list
                if (templateSearch || selectedGroup) {
                  return filtered.map((tmpl) => (
                    <TemplateCard key={tmpl.id} tmpl={tmpl} isPinned={pinnedIds.includes(tmpl.id)}
                      tplName={tplName} tplDesc={tplDesc} t={t}
                      onPin={() => {
                        const isPinned = pinnedIds.includes(tmpl.id)
                        const next = isPinned ? pinnedIds.filter((id) => id !== tmpl.id) : [...pinnedIds, tmpl.id]
                        setPinnedIds(next)
                        localStorage.setItem("agentrune_pinned_templates", JSON.stringify(next))
                      }}
                      onUse={() => openAddForm(tmpl)}
                    />
                  ))
                }

                // Group by category
                return TEMPLATE_GROUPS.map((g) => {
                  const groupTemplates = filtered.filter((tmpl) => tmpl.group === g.key)
                  if (groupTemplates.length === 0) return null
                  return (
                    <div key={g.key} style={{ marginBottom: 8 }}>
                      <div style={{
                        fontSize: 11, fontWeight: 700, color: "#37ACC0",
                        textTransform: "uppercase", letterSpacing: 1,
                        padding: "6px 2px 4px", borderBottom: "1px solid rgba(55, 172, 192, 0.1)",
                        marginBottom: 6,
                      }}>
                        {g.label}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {groupTemplates.map((tmpl) => (
                          <TemplateCard key={tmpl.id} tmpl={tmpl} isPinned={pinnedIds.includes(tmpl.id)}
                            tplName={tplName} tplDesc={tplDesc} t={t}
                            onPin={() => {
                              const isPinned = pinnedIds.includes(tmpl.id)
                              const next = isPinned ? pinnedIds.filter((id) => id !== tmpl.id) : [...pinnedIds, tmpl.id]
                              setPinnedIds(next)
                              localStorage.setItem("agentrune_pinned_templates", JSON.stringify(next))
                            }}
                            onUse={() => openAddForm(tmpl)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </>
        ) : (
          /* ======================== ADD/EDIT PAGE ======================== */
          <>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                {t("automation.newAutomation")}
              </div>
            </div>

            {/* 1. Name */}
            <input
              value={formName} onChange={(e) => setFormName(e.target.value)}
              placeholder={t("automation.namePlaceholder")}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.12)", background: "rgba(255,255,255,0.6)",
                color: "#1e293b", fontSize: 14, outline: "none",
                boxSizing: "border-box", marginBottom: 10,
              }}
            />

            {/* 2. Prompt input — collapsed when template applied, full when manual */}
            {formTemplateId ? (
              <div
                onClick={() => setFormTemplateId(null)}
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.12)", background: "rgba(255,255,255,0.6)",
                  color: "#52667a", fontSize: 12, lineHeight: 1.4,
                  boxSizing: "border-box", marginBottom: 0, cursor: "pointer",
                  overflow: "hidden", maxHeight: 40,
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as never,
                }}
              >
                {formPrompt || t("automation.promptPlaceholder")}
              </div>
            ) : (
              <div style={{ position: "relative", width: "100%" }}>
                <textarea
                  value={formPrompt} onChange={(e) => setFormPrompt(e.target.value)}
                  placeholder={t("automation.promptPlaceholder") || "Describe what the agent should do..."}
                  rows={3}
                  style={{
                    width: "100%", padding: "10px 14px", paddingRight: 36, borderRadius: 12,
                    border: promptMatches.length > 0 ? "1.5px solid rgba(55,172,192,0.4)" : "1px solid rgba(0,0,0,0.12)",
                    background: "rgba(255,255,255,0.6)",
                    color: "#1e293b", fontSize: 13, outline: "none",
                    boxSizing: "border-box", marginBottom: 0, resize: "vertical",
                    fontFamily: "inherit", lineHeight: 1.5,
                  }}
                />
                {/* Expand button */}
                <button
                  type="button"
                  onClick={() => setPromptExpanded(true)}
                  style={{
                    position: "absolute", top: 8, right: 8,
                    width: 24, height: 24, borderRadius: 6,
                    border: "none", background: "transparent",
                    color: formPrompt.length > 50 ? "#37ACC0" : "rgba(0,0,0,0.25)",
                    cursor: "pointer", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    opacity: formPrompt.length > 50 ? 1 : 0.6,
                    transition: "all 0.2s",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                </button>
              </div>
            )}

            {/* 2b. Keyword-matched template suggestions — appears as user types */}
            {promptMatches.length > 0 && !formTemplateId && (
              <div style={{
                marginTop: 6, marginBottom: 10, padding: "8px 10px", borderRadius: 10,
                background: "rgba(55,172,192,0.06)", border: "1px solid rgba(55,172,192,0.15)",
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#37ACC0", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
                  {t("automation.suggestions") || "We have templates for this"}
                </div>
                {promptMatches.map((tmpl) => (
                  <button key={tmpl.id} onClick={() => {
                    setFormTemplateId(tmpl.id)
                    setFormName(tmpl.name)
                    setFormPrompt(tmpl.prompt)
                    setFormSkill(tmpl.skill || "")
                  }} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", padding: "6px 8px", borderRadius: 8,
                    border: "none", background: "transparent",
                    cursor: "pointer", textAlign: "left", marginBottom: 2,
                  }}>
                    <span style={{ flexShrink: 0, color: "#37ACC0" }}>{getTemplateIcon(tmpl)}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{tplName(tmpl)}</span>
                    <span style={{ fontSize: 10, color: "#37ACC0" }}>{t("automation.useThis") || "Use"}</span>
                  </button>
                ))}
              </div>
            )}

            {/* 2c. Applied template indicator */}
            {formTemplateId && (
              <div style={{
                marginTop: 6, marginBottom: 10, padding: "6px 10px", borderRadius: 8,
                background: "rgba(55,172,192,0.08)", border: "1px solid rgba(55,172,192,0.15)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <span style={{ fontSize: 11, color: "#37ACC0", display: "flex", alignItems: "center", gap: 6 }}>
                  {(() => {
                    const applied = allTemplates.find((t) => t.id === formTemplateId)
                    if (!applied) return null
                    return <>{getTemplateIcon(applied)} {tplName(applied)}</>
                  })()}
                </span>
                <button onClick={() => { setFormTemplateId(null); setFormPrompt(""); setFormName("") }} style={{
                  border: "none", background: "transparent", color: "var(--text-secondary)",
                  fontSize: 10, cursor: "pointer", padding: "2px 6px",
                }}>
                  {t("automation.cancel")}
                </button>
              </div>
            )}

            {/* Browse templates link — always visible when no template applied */}
            {!formTemplateId && (
              <div style={{ marginTop: 6, marginBottom: 10 }}>
                <button onClick={() => setTemplateTab(templateTab === "all" ? "recommended" : "all")} style={{
                  border: "none", background: "transparent", color: "#37ACC0",
                  fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 600,
                }}>
                  {templateTab === "all"
                    ? (t("automation.hideTemplates") || "Hide templates")
                    : (t("automation.browseTemplates") || "Browse templates")}
                </button>
              </div>
            )}

            {/* 2d. Template browser (expandable) */}
            {templateTab === "all" && !formTemplateId && (
              <div style={{ marginBottom: 14 }}>
                {/* Search */}
                <input
                  value={templateSearch} onChange={(e) => setTemplateSearch(e.target.value)}
                  placeholder={t("automation.searchTemplates") || "Search templates..."}
                  style={{
                    width: "100%", padding: "8px 12px", borderRadius: 10,
                    border: "1px solid var(--glass-border)", background: "var(--icon-bg)",
                    color: "var(--text-primary)", fontSize: 12, outline: "none",
                    boxSizing: "border-box", marginBottom: 8,
                  }}
                />
                {/* Template list */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                  {allTemplates
                    .filter((tmpl) => {
                      if (!templateSearch) return true
                      const q = templateSearch.toLowerCase()
                      return tmpl.name.toLowerCase().includes(q)
                        || tmpl.description.toLowerCase().includes(q)
                        || tplName(tmpl).toLowerCase().includes(q)
                        || tplDesc(tmpl).toLowerCase().includes(q)
                        || (tmpl.tags || []).some((tag) => tag.includes(q))
                    })
                    .map((tmpl) => {
                      const isPinned = pinnedIds.includes(tmpl.id)
                      return (
                        <div key={tmpl.id} style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 10px", borderRadius: 10,
                          border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                          cursor: "pointer",
                        }} onClick={() => {
                          setFormTemplateId(tmpl.id)
                          setFormName(tmpl.name)
                          setFormPrompt(tmpl.prompt)
                          setFormSkill(tmpl.skill || "")
                          setTemplateTab("recommended")
                        }}>
                          <span style={{ flexShrink: 0, color: "#37ACC0" }}>{getTemplateIcon(tmpl)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{tplName(tmpl)}</div>
                            <div style={{
                              fontSize: 10, color: "var(--text-secondary)", marginTop: 1,
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                            }}>{tplDesc(tmpl)}</div>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); togglePin(tmpl.id) }} style={{
                            border: "none", background: "transparent", padding: 0,
                            color: isPinned ? "#37ACC0" : "var(--text-secondary)",
                            fontSize: 14, cursor: "pointer", opacity: isPinned ? 1 : 0.4,
                            flexShrink: 0,
                          }}>
                            {isPinned ? "\u2605" : "\u2606"}
                          </button>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}

            {/* 4. Schedule (alarm-clock style) */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>
                {t("automation.schedule")}
              </div>

              <PillToggle
                options={[
                  { value: "daily", label: t("automation.daily") || "Daily" },
                  { value: "interval", label: t("automation.interval") },
                ]}
                value={formScheduleType}
                onChange={(v) => setFormScheduleType(v as "daily" | "interval")}
              />

              {formScheduleType === "daily" ? (
                <div style={{ marginTop: 12 }}>
                  {/* Time picker */}
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                    <input type="time" value={formTimeOfDay} onChange={(e) => setFormTimeOfDay(e.target.value)} style={{
                      fontSize: 32, fontWeight: 300, fontFamily: "'Inter', system-ui, sans-serif",
                      background: "transparent", border: "none", color: "#1e293b",
                      textAlign: "center", outline: "none", letterSpacing: "-1px",
                    }} />
                  </div>
                  {/* Weekday picker */}
                  <WeekdayPicker selected={formWeekdays} onChange={setFormWeekdays} />
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, justifyContent: "center" }}>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("automation.every")}</span>
                  <input type="number" value={formInterval} onChange={(e) => setFormInterval(e.target.value)} min="1" style={{
                    width: 60, padding: "8px 10px", borderRadius: 10, textAlign: "center",
                    border: "1px solid rgba(0,0,0,0.12)", background: "rgba(255,255,255,0.6)",
                    color: "#1e293b", fontSize: 14, outline: "none",
                  }} />
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("automation.minutes")}</span>
                </div>
              )}
            </div>

            {/* 5. Execution environment */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>
                {t("automation.execution") || "Execution"}
              </div>

              <PillToggle
                options={[
                  { value: "local", label: t("automation.local") || "Local" },
                  { value: "worktree", label: t("automation.worktree") || "Worktree" },
                ]}
                value={formRunMode}
                onChange={(v) => setFormRunMode(v as "local" | "worktree")}
              />

              {/* Agent selector */}
              <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto" }}>
                {AGENTS.map((agent) => {
                  const active = formAgentId === agent.id
                  return (
                    <button key={agent.id} onClick={() => setFormAgentId(agent.id)} style={{
                      padding: "6px 12px", borderRadius: 8, flexShrink: 0,
                      border: active ? "1.5px solid #37ACC0" : "1px solid var(--glass-border)",
                      background: active ? "rgba(55,172,192,0.12)" : "transparent",
                      color: active ? "#37ACC0" : "var(--text-secondary)",
                      fontSize: 11, fontWeight: 600, cursor: "pointer",
                    }}>
                      {agent.name}
                    </button>
                  )
                })}
              </div>

              {/* Model selector (agent-specific) */}
              {formAgentId === "claude" && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6, fontWeight: 600 }}>Model</div>
                  <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                    {[
                      { id: "", label: "Default" },
                      { id: "sonnet", label: "Sonnet" },
                      { id: "opus", label: "Opus" },
                      { id: "haiku", label: "Haiku" },
                    ].map((m) => {
                      const active = formModel === m.id
                      return (
                        <button key={m.id} onClick={() => setFormModel(m.id)} style={{
                          padding: "6px 12px", borderRadius: 8, flexShrink: 0,
                          border: active ? "1.5px solid #37ACC0" : "1px solid var(--glass-border)",
                          background: active ? "rgba(55,172,192,0.12)" : "transparent",
                          color: active ? "#37ACC0" : "var(--text-secondary)",
                          fontSize: 11, fontWeight: 600, cursor: "pointer",
                        }}>
                          {m.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 5.5 Bypass toggle */}
            <label style={{
              display: "flex", alignItems: "center", gap: 8, marginTop: 4,
              cursor: "pointer", fontSize: 13, color: "var(--text-primary)",
            }} onClick={() => setFormBypass(!formBypass)}>
              <div style={{
                width: 18, height: 18, borderRadius: 4,
                border: formBypass ? "none" : "1.5px solid var(--text-secondary)",
                background: formBypass ? "#37ACC0" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s ease",
                flexShrink: 0,
              }}>
                {formBypass && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </div>
              <div>
                <span style={{ fontWeight: 600 }}>{t("settings.bypass") || "Bypass Mode"}</span>
                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 6 }}>
                  {t("settings.bypassDesc") || "Skip all permission confirmations"}
                </span>
              </div>
            </label>

            {/* 6. Buttons */}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={handleSubmit} disabled={!formName.trim() || !formPrompt.trim() || submitting} style={{
                flex: 1, padding: "12px 16px", borderRadius: 12,
                border: "none", background: "#37ACC0",
                color: "#fff", fontSize: 14, fontWeight: 700,
                cursor: formName.trim() && formPrompt.trim() ? "pointer" : "default",
                opacity: formName.trim() && formPrompt.trim() ? 1 : 0.4,
              }}>
                {submitting ? (editId ? t("automation.saving") : t("automation.creating")) : (editId ? t("automation.save") : t("automation.create"))}
              </button>
              {!formTemplateId && formPrompt.trim() && formName.trim() && (
                <button onClick={saveAsCustomTemplate} style={{
                  padding: "12px 14px", borderRadius: 12,
                  border: "1px solid rgba(55,172,192,0.3)", background: "rgba(55,172,192,0.08)",
                  color: "#37ACC0", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  {t("automation.saveTemplate") || "Save"}
                </button>
              )}
              <button onClick={() => setPage("list")} style={{
                padding: "12px 16px", borderRadius: 12,
                border: "1px solid var(--glass-border)", background: "transparent",
                color: "var(--text-secondary)", fontSize: 13, fontWeight: 500, cursor: "pointer",
              }}>
                {t("automation.cancel")}
              </button>
            </div>
          </>
        )}
      </motion.div>

      {/* Fullscreen prompt editor */}
      {promptExpanded && (
        <div
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
            zIndex: 250,
            display: "flex", flexDirection: "column",
            padding: "calc(env(safe-area-inset-top, 16px) + 12px) 16px calc(env(safe-area-inset-bottom, 16px) + 12px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <button onClick={() => setPromptExpanded(false)} style={{
              width: 36, height: 36, borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)",
              color: "rgba(255,255,255,0.7)",
              fontSize: 16, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              {"←"}
            </button>
            <div style={{ flex: 1, fontSize: 16, fontWeight: 600, color: "#fff" }}>
              {t("automation.editPrompt") || "Edit Prompt"}
            </div>
          </div>
          <textarea
            autoFocus
            value={formPrompt}
            onChange={(e) => setFormPrompt(e.target.value)}
            placeholder={t("automation.promptPlaceholder") || "Describe what the agent should do..."}
            style={{
              flex: 1, padding: 16, borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)",
              color: "#fff", fontSize: 15,
              fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
              outline: "none", resize: "none", lineHeight: 1.5,
            }}
          />
          <button
            onClick={() => setPromptExpanded(false)}
            style={{
              marginTop: 12, padding: "14px 0", borderRadius: 14,
              border: "none",
              background: formPrompt.trim() ? "#37ACC0" : "rgba(255,255,255,0.1)",
              color: formPrompt.trim() ? "#fff" : "rgba(255,255,255,0.4)",
              fontSize: 16, fontWeight: 600, cursor: "pointer",
            }}
          >
            {t("automation.done") || "Done"}
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 16px)",
          left: "50%", transform: "translateX(-50%)", zIndex: 300,
          padding: "10px 20px", borderRadius: 12,
          background: "rgba(34,197,94,0.9)", color: "#fff",
          fontSize: 13, fontWeight: 600,
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          animation: "fadeIn 0.2s ease-out",
        }}>
          {toast}
        </div>
      )}
    </>
      )}
    </AnimatePresence>
  )
}

/** Reusable template card for the templates page */
function TemplateCard({ tmpl, isPinned, tplName, tplDesc, t, onPin, onUse }: {
  tmpl: AutomationTemplate
  isPinned: boolean
  tplName: (t: AutomationTemplate) => string
  tplDesc: (t: AutomationTemplate) => string
  t: (key: string) => string
  onPin: () => void
  onUse: () => void
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 14px", borderRadius: 14,
      border: "1px solid var(--glass-border)",
      background: "var(--glass-bg)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
    }}>
      <div style={{ flexShrink: 0, width: 32, display: "flex", alignItems: "center", justifyContent: "center", color: "#37ACC0" }}>{getTemplateIcon(tmpl)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{tplName(tmpl)}</div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as never }}>{tplDesc(tmpl)}</div>
        {tmpl.tags && tmpl.tags.length > 0 && (
          <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
            {tmpl.tags.slice(0, 3).map((tag) => (
              <span key={tag} style={{
                padding: "1px 6px", borderRadius: 6, fontSize: 9, fontWeight: 600,
                background: "rgba(55, 172, 192, 0.08)", color: "rgba(55, 172, 192, 0.7)",
                letterSpacing: 0.3,
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button onClick={onPin} style={{
          width: 30, height: 30, borderRadius: 8, border: "none",
          background: isPinned ? "rgba(55,172,192,0.15)" : "transparent",
          color: isPinned ? "#37ACC0" : "var(--text-secondary)",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
        <button onClick={onUse} style={{
          padding: "4px 12px", borderRadius: 8,
          border: "1px solid rgba(55, 172, 192, 0.2)", background: "rgba(55, 172, 192, 0.06)",
          color: "#37ACC0", fontSize: 11, fontWeight: 600, cursor: "pointer",
          transition: "all 0.2s",
        }}>
          {t("automation.useThis") || "Use"}
        </button>
      </div>
    </div>
  )
}

/** Simple pick card for the pick page — solid colors, no backdrop blur */
function PickCard({ tmpl, tplName, tplDesc, onUse, icon, pinned, onTogglePin, onDelete }: {
  tmpl: AutomationTemplate
  tplName: (t: AutomationTemplate) => string
  tplDesc: (t: AutomationTemplate) => string
  onUse: () => void
  icon?: ReactNode
  pinned?: boolean
  onTogglePin?: () => void
  onDelete?: () => void
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0,
      width: "100%", borderRadius: 14,
      border: "1px solid #c8bfb6", background: "#ddd5cc",
    }}>
      <button onClick={onUse} style={{
        display: "flex", alignItems: "center", gap: 12,
        flex: 1, minWidth: 0, padding: "12px 8px 12px 14px",
        background: "none", border: "none", cursor: "pointer", textAlign: "left",
      }}>
        <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 10, background: "rgba(55,172,192,0.08)", display: "flex", alignItems: "center", justifyContent: "center", color: "#37ACC0" }}>
          {icon || CUSTOM_TEMPLATE_ICON}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>{tplName(tmpl)}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tplDesc(tmpl)}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      {onTogglePin && (
        <button onClick={(e) => { e.stopPropagation(); onTogglePin() }} style={{
          flexShrink: 0, width: 36, height: "100%", padding: "0 8px 0 0",
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: pinned ? "#37ACC0" : "#c8bfb6",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      )}
      {onDelete && (
        <button onClick={(e) => { e.stopPropagation(); onDelete() }} style={{
          flexShrink: 0, width: 32, height: "100%", padding: "0 6px 0 0",
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#ef4444",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      )}
    </div>
  )
}
