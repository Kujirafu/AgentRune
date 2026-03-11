// Chain Builder — visual timeline editor for creating/editing skill chains
import { useState, useCallback, useEffect, useRef } from "react"
import type { ChainNode, ChainStepDef, ParallelGroup, ChainPhase, StepAgentConfig, SkillChainDef } from "../lib/skillChains"
import { isParallelGroup, BUILTIN_CHAINS, resolveChainText, getStepCount } from "../lib/skillChains"
import { useLocale } from "../lib/i18n"
import { useSwipeToDismiss } from "../hooks/useSwipeToDismiss"

// ─── Types ──────────────────────────────────────────────────────

interface ChainBuilderProps {
  onBack: () => void
  t: (key: string) => string
}

interface ChainDraft {
  name: string
  description: string
  slug: string
  steps: ChainNode[]
  forkedFromSlug?: string
}

// ─── Constants ──────────────────────────────────────────────────

const PHASE_COLORS: Record<ChainPhase, { dot: string; line: string; bg: string }> = {
  design:    { dot: "#a78bfa", line: "#a78bfa40", bg: "#a78bfa18" },
  implement: { dot: "#60a5fa", line: "#60a5fa40", bg: "#60a5fa18" },
  verify:    { dot: "#34d399", line: "#34d39940", bg: "#34d39918" },
  ship:      { dot: "#fbbf24", line: "#fbbf2440", bg: "#fbbf2418" },
}

const AGENT_MODELS: Record<string, string[]> = {
  claude: ["sonnet", "opus", "haiku"],
  codex: ["default", "gpt-5"],
  cursor: ["default"],
  gemini: ["default"],
  aider: ["default"],
  cline: ["default"],
  openclaw: ["default"],
  terminal: ["default"],
}

// Built-in quick-access skills (shown at top of palette before MCP search)
const PALETTE_SKILLS: Array<{ id: string; labelKey: string; phase: ChainPhase }> = [
  { id: "brainstorm", labelKey: "chain.step.brainstorm", phase: "design" },
  { id: "plan", labelKey: "chain.step.plan", phase: "design" },
  { id: "architecture", labelKey: "chain.step.brainstorm", phase: "design" },
  { id: "tdd", labelKey: "chain.step.tdd", phase: "implement" },
  { id: "fix", labelKey: "chain.step.fix", phase: "implement" },
  { id: "review", labelKey: "chain.step.review", phase: "verify" },
  { id: "security", labelKey: "chain.step.security", phase: "verify" },
  { id: "test", labelKey: "chain.step.test", phase: "verify" },
  { id: "debug", labelKey: "chain.step.debug", phase: "verify" },
  { id: "commit", labelKey: "chain.step.commit", phase: "ship" },
  { id: "pr", labelKey: "chain.step.pr", phase: "ship" },
  { id: "doc", labelKey: "chain.step.doc", phase: "ship" },
  { id: "deploy", labelKey: "chain.step.implement", phase: "ship" },
]

// MCP skill search result (reuses InputBar's SkillCard interface)
interface McpSkillResult {
  skill: string
  trigger: string
  steps: string[]
  confidence: number
}

// AgentLore MCP endpoint for find_skills
const AGENTLORE_MCP_URL = "https://agentlore.vercel.app/api/mcp"

// ─── SVG Icons ──────────────────────────────────────────────────

const ArrowLeftIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>
  </svg>
)

const GitBranchIcon = ({ size = 48 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
  </svg>
)

const PlusIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14"/><path d="M12 5v14"/>
  </svg>
)

const XIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
  </svg>
)

const BotIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
  </svg>
)

const SearchIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
  </svg>
)

const GitForkIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
    <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>
  </svg>
)

const GripIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
    <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
  </svg>
)

const FilePlusIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
    <path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 12v6"/>
  </svg>
)

const TrashIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>
  </svg>
)

// ─── Helpers ────────────────────────────────────────────────────

let _idCounter = 0
function nextId(prefix = "s"): string {
  return `${prefix}${Date.now()}-${++_idCounter}`
}

function createStepFromPalette(skill: typeof PALETTE_SKILLS[number]): ChainStepDef {
  return {
    id: nextId("s"),
    phase: skill.phase,
    labelKey: skill.labelKey,
    skillSelection: {
      lite: skill.id,
      standard: skill.id,
      deep: skill.id,
    },
    required: true,
    defaultDepth: "standard" as const,
  }
}

// Infer phase from MCP skill name (heuristic)
function inferMcpPhase(skillId: string): ChainPhase {
  if (/security|audit|pentest|scan|lint|review|test|debug|validate|check/.test(skillId)) return "verify"
  if (/deploy|release|ci|cd|docker|k8s|helm|ship|commit|pr|doc|changelog/.test(skillId)) return "ship"
  if (/plan|architect|design|brainstorm|research|analyze|strategy/.test(skillId)) return "design"
  return "implement"
}

function getStepId(node: ChainNode): string {
  return isParallelGroup(node) ? node.id : (node as ChainStepDef).id
}

// ─── Component ──────────────────────────────────────────────────

export function ChainBuilder({ onBack, t: tProp }: ChainBuilderProps) {
  const { t: tLocale } = useLocale()
  const t = tProp || tLocale

  const [view, setView] = useState<"list" | "editor" | "executing">("list")
  const [draft, setDraft] = useState<ChainDraft>({
    name: "", description: "", slug: "", steps: [],
  })
  const [showPalette, setShowPalette] = useState(false)
  const [insertIndex, setInsertIndex] = useState(-1)
  // "branch:<stepIndex>" means adding a branch to step at stepIndex (creates parallel group)
  const [paletteMode, setPaletteMode] = useState<"insert" | "branch" | "replace">("insert")
  const [branchTargetIndex, setBranchTargetIndex] = useState(-1)
  const [replaceStepId, setReplaceStepId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [paletteSearch, setPaletteSearch] = useState("")
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [mcpResults, setMcpResults] = useState<McpSkillResult[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const [showAgentPicker, setShowAgentPicker] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; onConfirm: () => void } | null>(null)
  // ─── Execution state ───────────────────────────────────────
  const [executionId, setExecutionId] = useState<string | null>(null)
  const [executionStatus, setExecutionStatus] = useState<string>("QUEUED")
  const [executionStep, setExecutionStep] = useState(0)
  const [branchRuns, setBranchRuns] = useState<Array<{
    id: string; parallelGroupId: string; branchIndex: number
    status: string; stepSnapshot: Record<string, unknown>
    output?: Record<string, unknown>; error?: string; tokenCount?: number
    startedAt?: string; completedAt?: string
  }>>([])
  const [executionError, setExecutionError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mcpDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // ─── My Chains state ────────────────────────────────────────
  const [myChains, setMyChains] = useState<Array<{ slug: string; name: string; description: string; steps: ChainNode[]; status: string }>>([])
  const [myChainsLoading, setMyChainsLoading] = useState(true)

  // ─── Fork data from sessionStorage ────────────────────────────
  useEffect(() => {
    const forkData = sessionStorage.getItem("chain-builder-fork")
    if (forkData) {
      sessionStorage.removeItem("chain-builder-fork")
      try {
        const chain = JSON.parse(forkData)
        const name = resolveChainText(chain.nameKey || chain.name || "", t)
        setDraft({
          name: (name || chain.name || chain.nameKey || "") + " (custom)",
          description: chain.description || chain.descKey || "",
          slug: "",
          steps: chain.steps || [],
          forkedFromSlug: chain.slug,
        })
        setView("editor")
      } catch { /* ignore */ }
    }
  }, [])

  // ─── Android back button ────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      // Close overlays first (innermost → outermost)
      if (confirmDialog) { setConfirmDialog(null); return }
      if (showPalette) { setShowPalette(false); setMcpResults([]); return }
      if (showAgentPicker) { setShowAgentPicker(null); return }
      if (view === "executing") {
        // From executing → back to editor (stop polling)
        if (pollRef.current) clearTimeout(pollRef.current)
        setView("editor")
        return
      }
      if (view === "editor") {
        if (dirty) {
          setConfirmDialog({
            title: t("builder.unsavedConfirm"),
            onConfirm: () => { setDirty(false); setView("list") },
          })
        } else {
          setView("list")
        }
        return
      }
      onBack()
    }
    document.addEventListener("app:back", handler, true)
    return () => document.removeEventListener("app:back", handler, true)
  }, [view, dirty, showPalette, showAgentPicker, confirmDialog, onBack, t])

  // ─── Fetch my chains on mount ───────────────────────────────
  useEffect(() => {
    if (view !== "list") return
    setMyChainsLoading(true)
    const token = localStorage.getItem("agentrune_phone_token")
    fetch("https://agentlore.vercel.app/api/chains?userId=me", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => {
        const chains = d.data?.chains ?? d.data
        setMyChains(Array.isArray(chains) ? chains : [])
      })
      .catch(() => setMyChains([]))
      .finally(() => setMyChainsLoading(false))
  }, [view])

  // ─── Step manipulation ────────────────────────────────────────

  const addStep = useCallback((index: number, step: ChainStepDef) => {
    setDraft(d => {
      const steps = [...d.steps]
      steps.splice(index, 0, step)
      return { ...d, steps }
    })
    setDirty(true)
  }, [])

  const removeStep = useCallback((id: string) => {
    setDraft(d => ({
      ...d,
      steps: d.steps.map(n => {
        // If it's a parallel group, try to remove the branch from it
        if (isParallelGroup(n)) {
          const remaining = (n as ParallelGroup).branches.filter(b => b.id !== id)
          if (remaining.length < (n as ParallelGroup).branches.length) {
            // Removed a branch — if only 1 left, dissolve to single step
            if (remaining.length <= 1) return remaining[0] || null
            return { ...n, branches: remaining }
          }
        }
        return n
      }).filter((n): n is ChainNode => n !== null && getStepId(n) !== id),
    }))
    setDirty(true)
  }, [])

  const moveStep = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    setDraft(d => {
      const steps = [...d.steps]
      const [moved] = steps.splice(fromIndex, 1)
      steps.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, moved)
      return { ...d, steps }
    })
  }, [])

  // Replace a step's skill in-place (keeps position, agent config, etc.)
  const replaceStep = useCallback((stepId: string, newSkill: typeof PALETTE_SKILLS[number]) => {
    setDraft(d => ({
      ...d,
      steps: d.steps.map(n => {
        if (!isParallelGroup(n) && (n as ChainStepDef).id === stepId) {
          return { ...(n as ChainStepDef), labelKey: newSkill.labelKey, phase: newSkill.phase, skillSelection: { lite: newSkill.id, standard: newSkill.id, deep: newSkill.id } }
        }
        return n
      }),
    }))
    setDirty(true)
  }, [])

  // Open palette in "replace" mode — user picks a skill to swap with existing step
  const startReplace = useCallback((stepId: string) => {
    setReplaceStepId(stepId)
    setPaletteMode("replace")
    setPaletteSearch("")
    setMcpResults([])
    setShowPalette(true)
  }, [])

  // Open palette in "branch" mode — user picks a skill to run in parallel with step at index
  const startAddBranch = useCallback((index: number) => {
    setBranchTargetIndex(index)
    setPaletteMode("branch")
    setPaletteSearch("")
    setMcpResults([])
    setShowPalette(true)
  }, [])

  // Actually create the parallel group once user picks a skill from palette
  const addBranchToStep = useCallback((index: number, newStep: ChainStepDef) => {
    setDraft(d => {
      const steps = [...d.steps]
      const target = steps[index]
      if (!target) return d
      if (isParallelGroup(target)) {
        // Add branch to existing parallel group
        if (target.branches.length >= 4) return d // max branches
        return {
          ...d,
          steps: steps.map((n, i) =>
            i === index && isParallelGroup(n)
              ? { ...n, branches: [...n.branches, newStep] }
              : n
          ),
        }
      }
      // Convert single step + new step into parallel group
      const pg: ParallelGroup = {
        type: "parallel",
        id: nextId("p"),
        phase: (target as ChainStepDef).phase,
        labelKey: "chain.step.parallelVerify",
        branches: [target as ChainStepDef, newStep],
        joinStrategy: "all",
      }
      steps.splice(index, 1, pg)
      return { ...d, steps }
    })
    setDirty(true)
  }, [])

  const dissolveParallelGroup = useCallback((pgId: string) => {
    setDraft(d => {
      const steps: ChainNode[] = []
      for (const node of d.steps) {
        if (isParallelGroup(node) && node.id === pgId) {
          steps.push(...node.branches)
        } else {
          steps.push(node)
        }
      }
      return { ...d, steps }
    })
  }, [])

  const toggleJoinStrategy = useCallback((pgId: string) => {
    setDraft(d => ({
      ...d,
      steps: d.steps.map(n =>
        isParallelGroup(n) && n.id === pgId
          ? { ...n, joinStrategy: n.joinStrategy === "all" ? "any" as const : "all" as const }
          : n
      ),
    }))
  }, [])

  // ─── Agent/Model cycling ──────────────────────────────────────

  const agentIds = Object.keys(AGENT_MODELS)

  const setStepAgent = useCallback((stepId: string, agentId: string, model: string) => {
    setDraft(d => ({
      ...d,
      steps: d.steps.map(node => {
        if (isParallelGroup(node)) {
          return {
            ...node,
            branches: node.branches.map(b =>
              b.id === stepId ? { ...b, agentConfig: { agentId, model } } : b
            ),
          }
        }
        return (node as ChainStepDef).id === stepId
          ? { ...(node as ChainStepDef), agentConfig: { agentId, model } }
          : node
      }),
    }))
    setDirty(true)
    setShowAgentPicker(null)
  }, [])

  // ─── Drag reorder (long press) ────────────────────────────────

  const handleTouchStart = useCallback((index: number) => {
    dragTimerRef.current = setTimeout(() => {
      setDragIndex(index)
    }, 500)
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (dragTimerRef.current) {
      clearTimeout(dragTimerRef.current)
      dragTimerRef.current = null
    }
    if (dragIndex !== null && dropIndex !== null) {
      moveStep(dragIndex, dropIndex)
    }
    setDragIndex(null)
    setDropIndex(null)
  }, [dragIndex, dropIndex, moveStep])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragIndex === null) {
      if (dragTimerRef.current) {
        clearTimeout(dragTimerRef.current)
        dragTimerRef.current = null
      }
      return
    }
    const touch = e.touches[0]
    const elements = document.elementsFromPoint(touch.clientX, touch.clientY)
    for (const el of elements) {
      const idx = (el as HTMLElement).dataset?.nodeIndex
      if (idx !== undefined) {
        setDropIndex(Number(idx))
        return
      }
    }
  }, [dragIndex])

  // ─── Palette ──────────────────────────────────────────────────

  const openPalette = useCallback((index: number) => {
    setInsertIndex(index)
    setPaletteMode("insert")
    setPaletteSearch("")
    setMcpResults([])
    setShowPalette(true)
  }, [])

  const closePalette = useCallback(() => {
    setShowPalette(false)
    setMcpResults([])
  }, [])

  // Swipe-to-dismiss for palette sheet
  const { sheetRef: paletteRef, handlers: paletteSwipeHandlers } = useSwipeToDismiss({ onDismiss: closePalette })

  // MCP skill search — debounced, triggers on 2+ chars
  const searchMcpSkills = useCallback((query: string) => {
    if (mcpDebounce.current) clearTimeout(mcpDebounce.current)
    if (query.length < 2) { setMcpResults([]); return }
    setMcpLoading(true)
    mcpDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(AGENTLORE_MCP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: "find_skills", arguments: { query, limit: 10 } }),
        })
        const data = await res.json()
        const textPayload = data.result?.[0]?.text || data.content?.[0]?.text || "{}"
        const parsed = JSON.parse(textPayload)
        setMcpResults(parsed.skills || [])
      } catch {
        setMcpResults([])
      } finally {
        setMcpLoading(false)
      }
    }, 400)
  }, [])

  // Handle palette search input — filter built-in + search MCP
  const handlePaletteSearchChange = useCallback((query: string) => {
    setPaletteSearch(query)
    searchMcpSkills(query)
  }, [searchMcpSkills])

  const handlePaletteSelect = useCallback((skill: typeof PALETTE_SKILLS[number]) => {
    if (paletteMode === "replace" && replaceStepId) {
      replaceStep(replaceStepId, skill)
    } else if (paletteMode === "branch") {
      const step = createStepFromPalette(skill)
      addBranchToStep(branchTargetIndex, step)
    } else {
      const step = createStepFromPalette(skill)
      addStep(insertIndex, step)
    }
    closePalette()
  }, [insertIndex, paletteMode, branchTargetIndex, replaceStepId, addStep, addBranchToStep, replaceStep, closePalette])

  // Select an MCP skill result → create step
  const handleMcpSelect = useCallback((mcpSkill: McpSkillResult) => {
    if (paletteMode === "replace" && replaceStepId) {
      replaceStep(replaceStepId, { id: mcpSkill.skill, labelKey: mcpSkill.skill, phase: inferMcpPhase(mcpSkill.skill) })
    } else {
      const step: ChainStepDef = {
        id: nextId("s"),
        phase: inferMcpPhase(mcpSkill.skill),
        labelKey: mcpSkill.skill, // literal name (not i18n key)
        skillSelection: { lite: mcpSkill.skill, standard: mcpSkill.skill, deep: mcpSkill.skill },
        required: true,
        defaultDepth: "standard" as const,
      }
      if (paletteMode === "branch") {
        addBranchToStep(branchTargetIndex, step)
      } else {
        addStep(insertIndex, step)
      }
    }
    closePalette()
  }, [insertIndex, paletteMode, branchTargetIndex, replaceStepId, addStep, addBranchToStep, replaceStep, closePalette])

  const filteredSkills = paletteSearch
    ? PALETTE_SKILLS.filter(s =>
        s.id.toLowerCase().includes(paletteSearch.toLowerCase()) ||
        t(s.labelKey).toLowerCase().includes(paletteSearch.toLowerCase())
      )
    : PALETTE_SKILLS

  const groupedSkills = (["design", "implement", "verify", "ship"] as ChainPhase[]).map(phase => ({
    phase,
    skills: filteredSkills.filter(s => s.phase === phase),
  })).filter(g => g.skills.length > 0)

  // ─── Save handler ─────────────────────────────────────────────

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = localStorage.getItem("agentrune_phone_token")
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (token) headers["Authorization"] = `Bearer ${token}`
    return headers
  }, [])

  const handleSave = useCallback(async () => {
    if (!draft.name || draft.steps.length < 1) return
    setSaving(true)
    setSaveResult(null)
    try {
      const apiBase = "https://agentlore.vercel.app"
      const method = draft.slug ? "PUT" : "POST"
      const url = draft.slug
        ? `${apiBase}/api/chains/${draft.slug}`
        : `${apiBase}/api/chains`
      const desc = draft.description || draft.name
      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: draft.name,
          description: desc.length < 20 ? desc.padEnd(20, " — AI workflow chain") : desc,
          steps: draft.steps,
          forkedFrom: draft.forkedFromSlug,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }))
        setSaveResult({ ok: false, msg: err.error || err.message || `HTTP ${res.status}` })
        return
      }
      const { data } = await res.json()
      setDraft(d => ({ ...d, slug: data.slug }))
      setDirty(false)
      setSaveResult({ ok: true, msg: t("builder.saved") || "Saved!" })
      setTimeout(() => setSaveResult(null), 3000)
    } catch (e) {
      setSaveResult({ ok: false, msg: e instanceof Error ? e.message : "Network error" })
    } finally {
      setSaving(false)
    }
  }, [draft, t, getAuthHeaders])

  // ─── Execute handler ────────────────────────────────────────
  const handleExecute = useCallback(async () => {
    if (!draft.slug) {
      setSaveResult({ ok: false, msg: t("builder.saveFirst") })
      return
    }
    setExecutionError(null)
    setExecutionStatus("QUEUED")
    setExecutionStep(0)
    setBranchRuns([])
    setView("executing")

    try {
      const apiBase = "https://agentlore.vercel.app"
      // Collect agent model from first step that has one, or session default
      const firstStepWithAgent = draft.steps.find(s => {
        if (isParallelGroup(s)) return false
        return (s as ChainStepDef).agentConfig?.model
      }) as ChainStepDef | undefined
      const agentModel = firstStepWithAgent?.agentConfig?.model

      const res = await fetch(`${apiBase}/api/chains/${draft.slug}/executions`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          depth: "standard",
          agentModel: agentModel ?? undefined,
          agentConfig: { preserveUserSelections: true },
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to start" }))
        setExecutionError(err.error || `HTTP ${res.status}`)
        setExecutionStatus("FAILED")
        return
      }
      const { data } = await res.json()
      setExecutionId(data.id)
      setExecutionStatus(data.status)
      if (data.branchRuns) setBranchRuns(data.branchRuns)
      // Start polling
      startPolling(data.id)
    } catch (e) {
      setExecutionError(e instanceof Error ? e.message : "Network error")
      setExecutionStatus("FAILED")
    }
  }, [draft, t, getAuthHeaders])

  const startPolling = useCallback((execId: string) => {
    if (pollRef.current) clearTimeout(pollRef.current)
    const poll = async () => {
      try {
        const res = await fetch(
          `https://agentlore.vercel.app/api/chains/${draft.slug}/executions/${execId}`,
          { headers: getAuthHeaders() },
        )
        if (!res.ok) return
        const { data } = await res.json()
        setExecutionStatus(data.status)
        setExecutionStep(data.currentStep ?? 0)
        if (data.branchRuns) setBranchRuns(data.branchRuns)
        if (data.error) setExecutionError(data.error)
        // Keep polling if still running
        if (data.status === "QUEUED" || data.status === "RUNNING") {
          pollRef.current = setTimeout(poll, 2000)
        }
      } catch {
        // Retry on network error
        pollRef.current = setTimeout(poll, 5000)
      }
    }
    pollRef.current = setTimeout(poll, 1500)
  }, [draft.slug, getAuthHeaders])

  // Cleanup polling on unmount or view change
  useEffect(() => {
    return () => { if (pollRef.current) clearTimeout(pollRef.current) }
  }, [])

  const handleCancelExecution = useCallback(async () => {
    if (!executionId || !draft.slug) return
    try {
      await fetch(
        `https://agentlore.vercel.app/api/chains/${draft.slug}/executions/${executionId}`,
        {
          method: "PATCH",
          headers: getAuthHeaders(),
          body: JSON.stringify({ status: "CANCELLED" }),
        },
      )
      setExecutionStatus("CANCELLED")
      if (pollRef.current) clearTimeout(pollRef.current)
    } catch { /* ignore */ }
  }, [executionId, draft.slug, getAuthHeaders])

  // ─── Delete handler ─────────────────────────────────────────
  const handleDeleteChain = useCallback((slug: string) => {
    setConfirmDialog({
      title: t("builder.deleteConfirm"),
      onConfirm: async () => {
        try {
          await fetch(`https://agentlore.vercel.app/api/chains/${slug}`, {
            method: "DELETE",
            headers: getAuthHeaders(),
          })
          setMyChains(prev => prev.filter(c => c.slug !== slug))
        } catch { /* ignore */ }
      },
    })
  }, [t, getAuthHeaders])

  // ─── Load chain into editor ─────────────────────────────────
  const loadChainToEditor = useCallback((chain: { name: string; description: string; slug: string; steps: ChainNode[]; forkedFromSlug?: string }) => {
    setDraft({
      name: chain.name,
      description: chain.description,
      slug: chain.slug,
      steps: chain.steps || [],
      forkedFromSlug: chain.forkedFromSlug,
    })
    setView("editor")
  }, [])

  // ─── Fork built-in chain ───────────────────────────────────
  const forkBuiltinChain = useCallback((chain: SkillChainDef) => {
    const name = resolveChainText(chain.nameKey, t)
    setDraft({
      name: (name || chain.nameKey) + " (custom)",
      description: resolveChainText(chain.descKey, t) || chain.descKey,
      slug: "",
      steps: chain.steps,
      forkedFromSlug: chain.slug,
    })
    setView("editor")
  }, [t])

  // ─── Render helpers ───────────────────────────────────────────

  const renderStepCard = (step: ChainStepDef, index: number, inParallel = false) => {
    const phaseColor = PHASE_COLORS[step.phase] || PHASE_COLORS.design
    const isDragging = dragIndex !== null && !inParallel

    return (
      <div
        key={step.id}
        data-node-index={inParallel ? undefined : index}
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--glass-border)",
          borderRadius: 10,
          padding: "10px 12px",
          position: "relative",
          opacity: isDragging && dragIndex === index ? 0.5 : 1,
          transition: "opacity 0.15s ease",
          minWidth: inParallel ? 120 : undefined,
          flex: inParallel ? 1 : undefined,
        }}
        onTouchStart={inParallel ? undefined : () => handleTouchStart(index)}
        onTouchEnd={inParallel ? undefined : handleTouchEnd}
      >
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Phase dot */}
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: phaseColor.dot,
            boxShadow: `0 0 6px ${phaseColor.dot}60`,
            flexShrink: 0,
          }} />
          {/* Grip handle */}
          {!inParallel && (
            <div style={{ color: "var(--text-secondary)", opacity: 0.4, flexShrink: 0 }}>
              <GripIcon size={12} />
            </div>
          )}
          {/* Step name — tap to replace skill */}
          <button
            onClick={(e) => { e.stopPropagation(); startReplace(step.id) }}
            onTouchStart={(e) => e.stopPropagation()}
            style={{
              flex: 1, fontSize: 13, fontWeight: 600,
              color: "var(--text-primary)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              background: "none", border: "none", padding: 0,
              cursor: "pointer", textAlign: "left",
            }}
          >
            {t(step.labelKey) || step.labelKey}
          </button>
          {/* Phase badge */}
          <div style={{
            fontSize: 9, fontWeight: 600, textTransform: "uppercase" as const,
            color: phaseColor.dot,
            background: phaseColor.bg,
            padding: "2px 6px", borderRadius: 4,
            letterSpacing: "0.5px",
          }}>
            {t(`builder.phase.${step.phase}`)}
          </div>
          {/* Make parallel button (only for non-parallel steps) */}
          {!inParallel && (
            <button
              onClick={() => startAddBranch(index)}
              title={t("builder.makeBranch")}
              style={{
                background: "none", border: "none", padding: 2,
                color: "var(--text-secondary)", cursor: "pointer",
                opacity: 0.5, display: "flex", alignItems: "center",
              }}
            >
              <GitForkIcon size={12} />
            </button>
          )}
          {/* Delete button */}
          <button
            onClick={(e) => { e.stopPropagation(); removeStep(step.id) }}
            onTouchStart={(e) => e.stopPropagation()}
            style={{
              background: "none", border: "none", padding: 6,
              color: "var(--text-secondary)", cursor: "pointer",
              opacity: 0.5, display: "flex", alignItems: "center",
              margin: -4,
            }}
          >
            <XIcon size={14} />
          </button>
        </div>

        {/* Agent/Model selector */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          marginTop: 8, paddingTop: 6,
          borderTop: "1px solid var(--glass-border)",
        }}>
          <BotIcon size={12} />
          <button
            onClick={() => setShowAgentPicker(showAgentPicker === step.id ? null : step.id)}
            style={{
              fontSize: 10, fontWeight: 600,
              color: step.agentConfig?.agentId ? "var(--accent-primary)" : "var(--text-secondary)",
              background: "var(--glass-bg)",
              border: "1px solid var(--glass-border)",
              borderRadius: 4, padding: "2px 6px",
              cursor: "pointer",
            }}
          >
            {step.agentConfig?.agentId
              ? `${step.agentConfig.agentId} / ${step.agentConfig.model || "default"}`
              : t("builder.sessionDefault")}
          </button>
        </div>
        {/* Agent picker — flat chip grid */}
        {showAgentPicker === step.id && (
          <div style={{
            marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4,
          }}>
            {/* Session default */}
            {(() => {
              const isActive = !step.agentConfig?.agentId
              return (
                <button
                  key="__auto__"
                  onClick={() => { setStepAgent(step.id, "", ""); setShowAgentPicker(null) }}
                  style={{
                    fontSize: 10, fontWeight: 600, padding: "4px 8px",
                    borderRadius: 6, cursor: "pointer",
                    border: isActive ? "1px solid var(--accent-primary)" : "1px solid var(--glass-border)",
                    background: isActive ? "var(--accent-primary-bg)" : "transparent",
                    color: isActive ? "var(--accent-primary)" : "var(--text-secondary)",
                  }}
                >
                  {t("builder.inheritSession")}
                </button>
              )
            })()}
            {/* Agent · Model chips */}
            {agentIds.flatMap(aid =>
              (AGENT_MODELS[aid] || ["default"]).map(model => {
                const isActive = step.agentConfig?.agentId === aid && step.agentConfig?.model === model
                return (
                  <button
                    key={`${aid}-${model}`}
                    onClick={() => { setStepAgent(step.id, aid, model); setShowAgentPicker(null) }}
                    style={{
                      fontSize: 10, fontWeight: 600, padding: "4px 8px",
                      borderRadius: 6, cursor: "pointer",
                      border: isActive ? "1px solid var(--accent-primary)" : "1px solid var(--glass-border)",
                      background: isActive ? "var(--accent-primary-bg)" : "transparent",
                      color: isActive ? "var(--accent-primary)" : "var(--text-secondary)",
                    }}
                  >
                    {aid === "terminal" ? "terminal" : `${aid} · ${model}`}
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>
    )
  }

  const renderInsertButton = (index: number) => (
    <div key={`insert-${index}`} style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "4px 0",
    }}>
      <button
        onClick={() => openPalette(index)}
        style={{
          width: 24, height: 24, borderRadius: "50%",
          border: "1px dashed var(--glass-border)",
          background: "transparent",
          color: "var(--accent-primary)",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          opacity: 0.6,
          transition: "opacity 0.15s ease",
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={e => (e.currentTarget.style.opacity = "0.6")}
      >
        <PlusIcon size={12} />
      </button>
    </div>
  )

  const renderConnectionLine = (index: number) => (
    <div key={`conn-${index}`} style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "2px 0",
    }}>
      <div style={{
        width: 2, height: 20,
        background: "var(--glass-border)",
        borderRadius: 1,
      }} />
    </div>
  )

  const renderParallelGroup = (pg: ParallelGroup, index: number) => {
    const phaseColor = PHASE_COLORS[pg.phase] || PHASE_COLORS.design

    return (
      <div
        key={pg.id}
        data-node-index={index}
        style={{ position: "relative" }}
      >
        {/* Fork split indicator */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: 6, padding: "4px 0 8px",
        }}>
          <div style={{ flex: 1, height: 1, background: phaseColor.line }} />
          <div style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "2px 8px", borderRadius: 10,
            background: phaseColor.bg,
            border: `1px solid ${phaseColor.line}`,
          }}>
            <GitForkIcon size={10} />
            <span style={{ fontSize: 9, fontWeight: 700, color: phaseColor.dot, textTransform: "uppercase" }}>
              {pg.joinStrategy === "all" ? t("builder.joinAll") : t("builder.joinAny")}
            </span>
            <button
              onClick={() => toggleJoinStrategy(pg.id)}
              style={{
                background: "none", border: "none", padding: 0,
                color: "var(--text-secondary)", cursor: "pointer", fontSize: 9,
                opacity: 0.6,
              }}
            >
              ↔
            </button>
            <button
              onClick={() => dissolveParallelGroup(pg.id)}
              style={{
                background: "none", border: "none", padding: 0,
                color: "var(--text-secondary)", cursor: "pointer", opacity: 0.4,
              }}
            >
              <XIcon size={10} />
            </button>
          </div>
          <div style={{ flex: 1, height: 1, background: phaseColor.line }} />
        </div>

        {/* Branch cards — horizontal scroll when overflow */}
        <div style={{
          display: "flex", gap: 8,
          overflowX: "auto",
          WebkitOverflowScrolling: "touch" as never,
          scrollSnapType: "x mandatory",
          paddingBottom: 4,
          msOverflowStyle: "none",
          scrollbarWidth: "none",
        }}>
          {pg.branches.map(branch => (
            <div key={branch.id} style={{
              flex: "0 0 auto",
              width: pg.branches.length <= 2 ? undefined : "min(45%, 160px)",
              minWidth: pg.branches.length <= 2 ? 0 : 120,
              ...(pg.branches.length <= 2 ? { flex: 1 } : {}),
              scrollSnapAlign: "start",
            }}>
              {/* Vertical line into branch */}
              <div style={{ display: "flex", justifyContent: "center", paddingBottom: 4 }}>
                <div style={{ width: 2, height: 10, background: phaseColor.line, borderRadius: 1 }} />
              </div>
              {renderStepCard(branch, index, true)}
            </div>
          ))}
          {/* Add branch button */}
          <button
            onClick={() => startAddBranch(index)}
            style={{
              flex: "0 0 40px",
              minWidth: 40, borderRadius: 10,
              border: `1px dashed ${phaseColor.line}`,
              background: "transparent",
              color: phaseColor.dot,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: 0.6,
              scrollSnapAlign: "start",
            }}
          >
            <PlusIcon size={16} />
          </button>
        </div>
        {/* Scroll hint dots */}
        {pg.branches.length > 2 && (
          <div style={{
            display: "flex", justifyContent: "center", gap: 4, padding: "4px 0 0",
          }}>
            {pg.branches.map((_, i) => (
              <div key={i} style={{
                width: 4, height: 4, borderRadius: "50%",
                background: phaseColor.dot, opacity: 0.3,
              }} />
            ))}
          </div>
        )}

        {/* Merge indicator */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "8px 0 4px",
        }}>
          <div style={{ flex: 1, height: 1, background: phaseColor.line }} />
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: phaseColor.dot,
            boxShadow: `0 0 6px ${phaseColor.dot}40`,
          }} />
          <div style={{ flex: 1, height: 1, background: phaseColor.line }} />
        </div>
      </div>
    )
  }

  const renderTimeline = () => {
    const nodes: React.ReactNode[] = []

    // Insert button at the very top
    nodes.push(renderInsertButton(0))

    draft.steps.forEach((node, i) => {
      // Drop indicator
      if (dragIndex !== null && dropIndex === i && dropIndex !== dragIndex) {
        nodes.push(
          <div key={`drop-${i}`} style={{
            height: 3, background: "var(--accent-primary)",
            borderRadius: 2, margin: "2px 0",
          }} />
        )
      }

      if (isParallelGroup(node)) {
        nodes.push(renderParallelGroup(node, i))
      } else {
        nodes.push(renderStepCard(node as ChainStepDef, i))
      }

      // Connection line + insert button between nodes
      if (i < draft.steps.length - 1) {
        nodes.push(renderConnectionLine(i))
        nodes.push(renderInsertButton(i + 1))
      }
    })

    return nodes
  }

  // ─── Render ───────────────────────────────────────────────────

  // ─── Executing View ──────────────────────────────────────────
  if (view === "executing") {
    const isRunning = executionStatus === "QUEUED" || executionStatus === "RUNNING"
    const isDone = executionStatus === "COMPLETED" || executionStatus === "FAILED" || executionStatus === "CANCELLED"
    const statusKey = `builder.execution${executionStatus.charAt(0) + executionStatus.slice(1).toLowerCase()}` as string
    const statusColor = executionStatus === "COMPLETED" ? "#34d399"
      : executionStatus === "FAILED" ? "#FB8184"
      : executionStatus === "CANCELLED" ? "#94a3b8"
      : "#37ACC0"

    // Group branches by parallel group
    const groupedBranches = branchRuns.reduce<Record<string, typeof branchRuns>>((acc, br) => {
      if (!acc[br.parallelGroupId]) acc[br.parallelGroupId] = []
      acc[br.parallelGroupId].push(br)
      return acc
    }, {})

    return (
      <div style={{
        height: "100dvh", display: "flex", flexDirection: "column",
        background: "var(--bg-primary)", color: "var(--text-primary)",
      }}>
        {/* Top bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px",
          borderBottom: "1px solid var(--glass-border)",
          background: "var(--glass-bg)",
          backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
          flexShrink: 0,
        }}>
          <button onClick={() => {
            if (pollRef.current) clearTimeout(pollRef.current)
            setView("editor")
          }} style={{
            background: "none", border: "none", color: "var(--text-primary)",
            padding: 4, cursor: "pointer", display: "flex", alignItems: "center",
          }}>
            <ArrowLeftIcon />
          </button>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>{draft.name}</span>
          {/* Status badge */}
          <span style={{
            padding: "4px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700,
            background: `${statusColor}18`, color: statusColor,
            border: `1px solid ${statusColor}30`,
          }}>
            {t(statusKey) || executionStatus}
          </span>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {/* Error banner */}
          {executionError && (
            <div style={{
              padding: "10px 14px", borderRadius: 12, marginBottom: 12,
              background: "rgba(251,129,132,0.08)", border: "1px solid rgba(251,129,132,0.2)",
              color: "#FB8184", fontSize: 13,
            }}>
              {executionError}
            </div>
          )}

          {/* Sequential progress */}
          <div style={{
            padding: "12px 16px", borderRadius: 14, marginBottom: 12,
            background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
          }}>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8, fontWeight: 600 }}>
              {(t("builder.sequentialStep") || "Step {current}/{total}")
                .replace("{current}", String(executionStep + 1))
                .replace("{total}", String(draft.steps.length))}
            </div>
            {/* Progress bar */}
            <div style={{
              height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)",
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%", borderRadius: 2,
                background: statusColor,
                width: `${draft.steps.length > 0 ? ((executionStep + (isDone ? 1 : 0)) / draft.steps.length) * 100 : 0}%`,
                transition: "width 0.5s ease",
              }} />
            </div>
          </div>

          {/* Timeline with execution status overlay */}
          {draft.steps.map((step, i) => {
            const isParallel = isParallelGroup(step)
            const stepDef = step as ChainStepDef
            const stepDone = i < executionStep || (isDone && executionStatus === "COMPLETED")
            const stepActive = i === executionStep && isRunning
            const phaseColor = isParallel ? "#60a5fa" : PHASE_COLORS[stepDef.phase]?.dot ?? "#94a3b8"

            return (
              <div key={isParallel ? `pg-${i}` : stepDef.id} style={{ display: "flex", gap: 12, marginBottom: 8 }}>
                {/* Timeline dot + line */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 20 }}>
                  <div style={{
                    width: 12, height: 12, borderRadius: "50%", marginTop: 12, flexShrink: 0,
                    background: stepDone ? phaseColor : stepActive ? `${phaseColor}80` : "rgba(255,255,255,0.1)",
                    border: stepActive ? `2px solid ${phaseColor}` : "none",
                    boxShadow: stepActive ? `0 0 8px ${phaseColor}40` : "none",
                  }} />
                  {i < draft.steps.length - 1 && (
                    <div style={{ width: 2, flex: 1, background: stepDone ? `${phaseColor}60` : "rgba(255,255,255,0.06)" }} />
                  )}
                </div>

                {/* Step card */}
                <div style={{
                  flex: 1, padding: "10px 14px", borderRadius: 12, marginBottom: 4,
                  background: stepActive ? `${phaseColor}08` : "var(--glass-bg)",
                  border: `1px solid ${stepActive ? `${phaseColor}30` : "var(--glass-border)"}`,
                  opacity: stepDone ? 0.6 : 1,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {isParallel ? t("builder.parallelRunning") : (t(stepDef.labelKey) || stepDef.labelKey)}
                  </div>

                  {/* Agent/model info */}
                  {!isParallel && stepDef.agentConfig && (
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                      {stepDef.agentConfig.agentId}{stepDef.agentConfig.model ? ` / ${stepDef.agentConfig.model}` : ""}
                    </div>
                  )}

                  {/* Parallel branches */}
                  {isParallel && (() => {
                    const pg = step as ParallelGroup
                    const pgBranches = groupedBranches[pg.id ?? `pg-${i}`] ?? []
                    return (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                        {pg.branches.map((branch, bi) => {
                          const branchDef = branch as ChainStepDef
                          const branchRun = pgBranches.find(b => b.branchIndex === bi)
                          const branchStatus = branchRun?.status ?? "QUEUED"
                          const branchColor = branchStatus === "COMPLETED" ? "#34d399"
                            : branchStatus === "FAILED" ? "#FB8184"
                            : branchStatus === "RUNNING" ? "#37ACC0"
                            : "var(--text-secondary)"
                          return (
                            <div key={branchDef.id ?? `b-${bi}`} style={{
                              padding: "8px 12px", borderRadius: 10,
                              background: "rgba(255,255,255,0.03)",
                              border: `1px solid ${branchStatus === "RUNNING" ? `${branchColor}30` : "rgba(255,255,255,0.05)"}`,
                              display: "flex", alignItems: "center", gap: 8,
                            }}>
                              {/* Status indicator */}
                              <div style={{
                                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                                background: branchColor,
                                boxShadow: branchStatus === "RUNNING" ? `0 0 6px ${branchColor}` : "none",
                              }} />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 12, fontWeight: 600 }}>
                                  {t(branchDef.labelKey) || branchDef.labelKey}
                                </div>
                                {branchDef.agentConfig && (
                                  <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                                    {branchDef.agentConfig.agentId}{branchDef.agentConfig.model ? ` / ${branchDef.agentConfig.model}` : ""}
                                  </div>
                                )}
                              </div>
                              <span style={{ fontSize: 10, color: branchColor, fontWeight: 600 }}>
                                {t(`builder.execution${branchStatus.charAt(0) + branchStatus.slice(1).toLowerCase()}`) || branchStatus}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}

                  {/* Completed checkmark */}
                  {stepDone && (
                    <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span style={{ fontSize: 10, color: "#34d399", fontWeight: 600 }}>{t("builder.executionCompleted")}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Bottom bar */}
        <div style={{
          padding: "12px 16px calc(env(safe-area-inset-bottom, 0px) + 12px)",
          borderTop: "1px solid var(--glass-border)",
          background: "var(--glass-bg)",
          display: "flex", gap: 10,
        }}>
          {isRunning ? (
            <button onClick={handleCancelExecution} style={{
              flex: 1, padding: "12px 0", borderRadius: 12,
              border: "1px solid rgba(251,129,132,0.3)",
              background: "rgba(251,129,132,0.08)",
              color: "#FB8184", fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}>
              {t("builder.cancelExecution")}
            </button>
          ) : (
            <button onClick={() => {
              if (pollRef.current) clearTimeout(pollRef.current)
              setView("editor")
            }} style={{
              flex: 1, padding: "12px 0", borderRadius: 12,
              border: "1px solid var(--glass-border)",
              background: "var(--glass-bg)",
              color: "var(--text-primary)", fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}>
              {t("builder.backToEditor")}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ─── List View ──────────────────────────────────────────────
  if (view === "list") {
    return (
      <div style={{
        height: "100dvh", display: "flex", flexDirection: "column",
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
      }}>
        {/* Top bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px",
          borderBottom: "1px solid var(--glass-border)",
          background: "var(--glass-bg)",
          backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
          flexShrink: 0,
        }}>
          <button onClick={onBack} style={{
            background: "none", border: "none", color: "var(--text-primary)",
            padding: 4, cursor: "pointer", display: "flex", alignItems: "center",
          }}>
            <ArrowLeftIcon />
          </button>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>
            {t("builder.title")}
          </span>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {/* New Chain button */}
          <button
            onClick={() => {
              setDraft({ name: "", description: "", slug: "", steps: [] })
              setView("editor")
            }}
            style={{
              width: "100%", padding: 14, borderRadius: 10,
              border: "2px dashed var(--accent-primary)",
              background: "transparent",
              color: "var(--accent-primary)",
              fontSize: 14, fontWeight: 700,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              marginBottom: 20,
            }}
          >
            <FilePlusIcon size={18} />
            {t("builder.newChain")}
          </button>

          {/* My Chains section */}
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            color: "var(--text-secondary)", letterSpacing: 1,
            padding: "0 0 8px",
          }}>
            {t("builder.myChains")}
          </div>

          {myChainsLoading ? (
            <div style={{ padding: "20px 0", textAlign: "center", fontSize: 13, color: "var(--text-secondary)", opacity: 0.6 }}>
              {t("builder.loading")}
            </div>
          ) : myChains.length === 0 ? (
            <div style={{ padding: "20px 0", textAlign: "center", fontSize: 13, color: "var(--text-secondary)", opacity: 0.5 }}>
              {t("builder.noChains")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {myChains.map(chain => (
                <div
                  key={chain.slug}
                  style={{
                    background: "var(--glass-bg)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 10,
                  }}
                  onClick={() => loadChainToEditor(chain)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {chain.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                      {t("builder.steps").replace("{count}", String(chain.steps?.length || 0))}
                    </div>
                  </div>
                  {/* Status badge */}
                  <span style={{
                    fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                    padding: "2px 8px", borderRadius: 4,
                    ...(chain.status === "PUBLISHED"
                      ? { color: "#34d399", background: "#34d39918" }
                      : { color: "var(--text-secondary)", background: "var(--glass-bg)", border: "1px solid var(--glass-border)" }
                    ),
                  }}>
                    {chain.status || "DRAFT"}
                  </span>
                  {/* Delete button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteChain(chain.slug) }}
                    style={{
                      background: "none", border: "none", padding: 4,
                      color: "var(--text-secondary)", cursor: "pointer", opacity: 0.5,
                      display: "flex", alignItems: "center",
                    }}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Built-in Templates section */}
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            color: "var(--text-secondary)", letterSpacing: 1,
            padding: "8px 0 8px",
            borderTop: "1px solid var(--glass-border)",
            marginTop: 4,
          }}>
            {t("builder.templates")}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {BUILTIN_CHAINS.map(chain => {
              const name = resolveChainText(chain.nameKey, t)
              const stepCount = getStepCount(chain)
              return (
                <div
                  key={chain.slug}
                  style={{
                    background: "var(--glass-bg)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    display: "flex", alignItems: "center", gap: 10,
                  }}
                >
                  {/* Chain link icon */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {name || chain.slug}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                      {t("builder.steps").replace("{count}", String(stepCount))}
                    </div>
                  </div>
                  {/* Fork button */}
                  <button
                    onClick={() => forkBuiltinChain(chain)}
                    style={{
                      padding: "5px 10px", borderRadius: 8,
                      border: "1px solid var(--glass-border)",
                      background: "transparent",
                      color: "var(--text-secondary)",
                      fontSize: 11, fontWeight: 600,
                      cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 4,
                    }}
                  >
                    <GitForkIcon size={12} />
                    {t("chain.fork")}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ─── Editor View ────────────────────────────────────────────
  return (
    <div
      onTouchMove={handleTouchMove}
      style={{
        height: "100dvh", display: "flex", flexDirection: "column",
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
      }}
    >
      {/* ═══ Top bar ═══ */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px",
        borderBottom: "1px solid var(--glass-border)",
        background: "var(--glass-bg)",
        backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
        flexShrink: 0,
      }}>
        <button onClick={() => {
          if (dirty) {
            setConfirmDialog({
              title: t("builder.unsavedConfirm"),
              onConfirm: () => { setDirty(false); setView("list") },
            })
            return
          }
          setDirty(false)
          setView("list")
        }} style={{
          background: "none", border: "none", color: "var(--text-primary)",
          padding: 4, cursor: "pointer", display: "flex", alignItems: "center",
        }}>
          <ArrowLeftIcon />
        </button>
        <input
          value={draft.name}
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          placeholder={t("builder.namePlaceholder")}
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: "var(--text-primary)", fontSize: 16, fontWeight: 700,
            fontFamily: "inherit",
          }}
        />
        <button
          onClick={handleSave}
          disabled={saving || !draft.name || draft.steps.length < 1}
          style={{
            padding: "6px 14px", borderRadius: 8,
            background: "var(--accent-primary)", color: "#fff",
            border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer",
            opacity: (saving || !draft.name || draft.steps.length < 1) ? 0.4 : 1,
            transition: "opacity 0.15s ease",
          }}
        >
          {saving ? "..." : t("builder.save")}
        </button>
        <button
          onClick={handleExecute}
          disabled={saving || !draft.slug || draft.steps.length < 1}
          style={{
            padding: "6px 14px", borderRadius: 8,
            background: "#37ACC0", color: "#fff",
            border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer",
            opacity: (saving || !draft.slug || draft.steps.length < 1) ? 0.4 : 1,
            transition: "opacity 0.15s ease",
            display: "flex", alignItems: "center", gap: 4,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="5,3 19,12 5,21" />
          </svg>
          {t("builder.execute")}
        </button>
      </div>

      {/* Save feedback */}
      {saveResult && (
        <div style={{
          padding: "6px 16px", fontSize: 12, fontWeight: 600,
          background: saveResult.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
          color: saveResult.ok ? "#22c55e" : "#ef4444",
          borderBottom: `1px solid ${saveResult.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
          textAlign: "center",
        }}>
          {saveResult.msg}
        </div>
      )}

      {/* ═══ Timeline area ═══ */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {draft.steps.length === 0 ? (
          <>
            {/* Empty state */}
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", height: "50%", gap: 12, opacity: 0.5,
            }}>
              <GitBranchIcon size={48} />
              <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                {t("builder.empty")}
              </span>
            </div>
            {/* Add first step button */}
            <button
              onClick={() => openPalette(0)}
              style={{
                width: "100%", padding: 12, borderRadius: 10,
                border: "1px dashed var(--glass-border)", background: "transparent",
                color: "var(--accent-primary)", fontSize: 12, fontWeight: 600,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <PlusIcon size={14} />
              {t("builder.addStep")}
            </button>
          </>
        ) : (
          <>
            {renderTimeline()}
            {/* Add step button at bottom */}
            <div style={{ padding: "8px 0" }}>
              <button
                onClick={() => openPalette(draft.steps.length)}
                style={{
                  width: "100%", padding: 10, borderRadius: 10,
                  border: "1px dashed var(--glass-border)", background: "transparent",
                  color: "var(--accent-primary)", fontSize: 12, fontWeight: 600,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                <PlusIcon size={14} />
                {t("builder.addStep")}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ═══ Step Palette Bottom Sheet ═══ */}
      {showPalette && (
        <>
          {/* Backdrop */}
          <div
            onClick={closePalette}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.4)",
              zIndex: 100,
            }}
          />
          {/* Sheet */}
          <div
            ref={paletteRef}
            {...paletteSwipeHandlers}
            style={{
            position: "fixed", bottom: 0, left: 0, right: 0,
            maxHeight: "70dvh",
            background: "var(--glass-bg)",
            backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
            border: "1px solid var(--glass-border)",
            borderRadius: "16px 16px 0 0",
            boxShadow: "var(--glass-shadow)",
            zIndex: 101,
            display: "flex", flexDirection: "column",
            animation: "slideUp 0.25s ease-out",
          }}>
            {/* Handle */}
            <div style={{
              display: "flex", justifyContent: "center", padding: "10px 0 4px",
            }}>
              <div style={{
                width: 36, height: 4, borderRadius: 2,
                background: "var(--glass-border)",
              }} />
            </div>
            {/* Title */}
            <div style={{
              padding: "4px 16px 8px", fontSize: 15, fontWeight: 700,
              color: "var(--text-primary)",
            }}>
              {paletteMode === "branch" ? t("builder.addBranch") : paletteMode === "replace" ? (t("builder.replaceSkill") || "Replace Skill") : t("builder.palette.title")}
            </div>
            {/* Search */}
            <div style={{
              margin: "0 16px 8px", display: "flex", alignItems: "center", gap: 8,
              background: "var(--card-bg)", border: "1px solid var(--glass-border)",
              borderRadius: 8, padding: "6px 10px",
            }}>
              <SearchIcon size={14} />
              <input
                value={paletteSearch}
                onChange={e => handlePaletteSearchChange(e.target.value)}
                placeholder={t("builder.palette.search")}
                autoFocus
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit",
                }}
              />
            </div>
            {/* Skills list */}
            <div style={{
              flex: 1, overflowY: "auto", padding: "0 16px 16px",
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
            }}>
              {/* Built-in skills */}
              {groupedSkills.map(group => {
                const pc = PHASE_COLORS[group.phase]
                return (
                  <div key={group.phase}>
                    {/* Phase section header */}
                    <div style={{
                      fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const,
                      color: pc.dot, letterSpacing: "0.5px",
                      padding: "10px 0 4px",
                    }}>
                      {t(`builder.phase.${group.phase}`)}
                    </div>
                    {/* Skill items */}
                    {group.skills.map(skill => (
                      <button
                        key={skill.id}
                        onClick={() => handlePaletteSelect(skill)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          width: "100%", padding: "10px 8px",
                          background: "transparent", border: "none",
                          color: "var(--text-primary)", cursor: "pointer",
                          borderRadius: 8,
                          textAlign: "left",
                        }}
                      >
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: pc.dot,
                          boxShadow: `0 0 4px ${pc.dot}60`,
                          flexShrink: 0,
                        }} />
                        <span style={{ fontSize: 13, fontWeight: 500 }}>
                          {t(skill.labelKey) || skill.id}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              })}

              {/* MCP search results (from AgentLore find_skills) */}
              {(mcpLoading || mcpResults.length > 0) && (
                <div>
                  <div style={{
                    fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const,
                    color: "var(--accent-primary)", letterSpacing: "0.5px",
                    padding: "14px 0 4px",
                    borderTop: "1px solid var(--glass-border)",
                    marginTop: 8,
                  }}>
                    {/* Lucide globe SVG inline */}
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
                      </svg>
                      AgentLore Skills ({mcpLoading ? "..." : mcpResults.length})
                    </span>
                  </div>
                  {mcpLoading && (
                    <div style={{ padding: "12px 8px", fontSize: 12, color: "var(--text-secondary)", opacity: 0.6 }}>
                      {t("builder.palette.searching")}
                    </div>
                  )}
                  {mcpResults.map(skill => {
                    const phase = inferMcpPhase(skill.skill)
                    const pc = PHASE_COLORS[phase]
                    return (
                      <button
                        key={skill.skill}
                        onClick={() => handleMcpSelect(skill)}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: 10,
                          width: "100%", padding: "10px 8px",
                          background: "transparent", border: "none",
                          color: "var(--text-primary)", cursor: "pointer",
                          borderRadius: 8,
                          textAlign: "left",
                        }}
                      >
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: pc.dot,
                          boxShadow: `0 0 4px ${pc.dot}60`,
                          flexShrink: 0,
                          marginTop: 4,
                        }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{skill.skill}</div>
                          <div style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.7, marginTop: 2 }}>
                            {skill.trigger}
                          </div>
                          {skill.confidence > 0 && (
                            <span style={{
                              fontSize: 9, color: "var(--accent-primary)",
                              background: "var(--accent-primary-bg)",
                              padding: "1px 5px", borderRadius: 4,
                              marginTop: 3, display: "inline-block",
                            }}>
                              {Math.round(skill.confidence * 100)}% match
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          {/* Animation keyframes */}
          <style>{`
            @keyframes slideUp {
              from { transform: translateY(100%); }
              to { transform: translateY(0); }
            }
          `}</style>
        </>
      )}

      {/* App-style confirm dialog */}
      {confirmDialog && (
        <div onClick={() => setConfirmDialog(null)} style={{
          position: "fixed", inset: 0, zIndex: 10001,
          background: "rgba(0,0,0,0.45)",
          backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 32,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            backgroundImage: "var(--sheet-bg, linear-gradient(135deg, rgba(26,26,46,0.95), rgba(15,15,30,0.98)))",
            backdropFilter: "blur(40px) saturate(1.5)", WebkitBackdropFilter: "blur(40px) saturate(1.5)",
            border: "1px solid var(--glass-border, rgba(255,255,255,0.1))",
            borderRadius: 20, padding: "28px 24px 20px",
            maxWidth: 300, width: "100%", textAlign: "center",
            boxShadow: "0 8px 40px rgba(0,0,0,0.3)",
          }}>
            {/* Icon */}
            <div style={{
              width: 44, height: 44, borderRadius: 14, margin: "0 auto 16px",
              background: "rgba(251,129,132,0.12)", border: "1px solid rgba(251,129,132,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FB8184" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary, #fff)", marginBottom: 20, lineHeight: 1.5 }}>
              {confirmDialog.title}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmDialog(null)} style={{
                flex: 1, padding: "11px 0", borderRadius: 12,
                border: "1px solid var(--glass-border, rgba(255,255,255,0.1))",
                background: "var(--glass-bg, rgba(255,255,255,0.05))",
                color: "var(--text-secondary, rgba(255,255,255,0.6))",
                fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}>
                {t("app.cancel") || "Cancel"}
              </button>
              <button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null) }} style={{
                flex: 1, padding: "11px 0", borderRadius: 12,
                border: "1px solid rgba(251,129,132,0.3)",
                background: "rgba(251,129,132,0.12)",
                color: "#FB8184",
                fontSize: 14, fontWeight: 700, cursor: "pointer",
              }}>
                {t("app.confirm") || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
