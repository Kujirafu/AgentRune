// Chain Builder — visual timeline editor for creating/editing skill chains
import { useState, useCallback, useEffect, useRef } from "react"
import type { ChainNode, ChainStepDef, ParallelGroup, ChainPhase, StepAgentConfig, SkillChainDef } from "../lib/skillChains"
import { isParallelGroup, BUILTIN_CHAINS, resolveChainText, getStepCount } from "../lib/skillChains"
import { useLocale } from "../lib/i18n"

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

function cycleStepAgent(step: ChainStepDef, agentIds: string[]): ChainStepDef {
  const current = step.agentConfig?.agentId
  const idx = current ? agentIds.indexOf(current) : -1
  const next = agentIds[(idx + 1) % agentIds.length]
  return { ...step, agentConfig: { agentId: next, model: AGENT_MODELS[next]?.[0] || "default" } }
}

function cycleStepModel(step: ChainStepDef): ChainStepDef {
  const agentId = step.agentConfig?.agentId
  if (!agentId) return step
  const models = AGENT_MODELS[agentId] || ["default"]
  const current = step.agentConfig?.model || "default"
  const idx = models.indexOf(current)
  const next = models[(idx + 1) % models.length]
  return { ...step, agentConfig: { ...step.agentConfig, model: next } }
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

  const [view, setView] = useState<"list" | "editor">("list")
  const [draft, setDraft] = useState<ChainDraft>({
    name: "", description: "", slug: "", steps: [],
  })
  const [showPalette, setShowPalette] = useState(false)
  const [insertIndex, setInsertIndex] = useState(-1)
  const [saving, setSaving] = useState(false)
  const [paletteSearch, setPaletteSearch] = useState("")
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [mcpResults, setMcpResults] = useState<McpSkillResult[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
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

  // ─── Fetch my chains on mount ───────────────────────────────
  useEffect(() => {
    if (view !== "list") return
    setMyChainsLoading(true)
    fetch("https://agentlore.vercel.app/api/chains?userId=me")
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => setMyChains(d.data || []))
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
  }, [])

  const removeStep = useCallback((id: string) => {
    setDraft(d => ({
      ...d,
      steps: d.steps.filter(n => getStepId(n) !== id),
    }))
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

  const createParallelGroup = useCallback((index: number) => {
    setDraft(d => {
      const steps = [...d.steps]
      const a = steps[index]
      const b = steps[index + 1]
      if (!a || !b || isParallelGroup(a) || isParallelGroup(b)) return d
      const pg: ParallelGroup = {
        type: "parallel",
        id: nextId("p"),
        phase: (a as ChainStepDef).phase,
        labelKey: "chain.step.parallelVerify",
        branches: [a as ChainStepDef, b as ChainStepDef],
        joinStrategy: "all",
      }
      steps.splice(index, 2, pg)
      return { ...d, steps }
    })
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

  const cycleAgent = useCallback((stepId: string) => {
    setDraft(d => ({
      ...d,
      steps: d.steps.map(node => {
        if (isParallelGroup(node)) {
          return {
            ...node,
            branches: node.branches.map(b =>
              b.id === stepId ? cycleStepAgent(b, agentIds) : b
            ),
          }
        }
        return (node as ChainStepDef).id === stepId
          ? cycleStepAgent(node as ChainStepDef, agentIds)
          : node
      }),
    }))
  }, [agentIds])

  const cycleModel = useCallback((stepId: string) => {
    setDraft(d => ({
      ...d,
      steps: d.steps.map(node => {
        if (isParallelGroup(node)) {
          return {
            ...node,
            branches: node.branches.map(b =>
              b.id === stepId ? cycleStepModel(b) : b
            ),
          }
        }
        return (node as ChainStepDef).id === stepId
          ? cycleStepModel(node as ChainStepDef)
          : node
      }),
    }))
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
    setPaletteSearch("")
    setMcpResults([])
    setShowPalette(true)
  }, [])

  const closePalette = useCallback(() => {
    setShowPalette(false)
    setMcpResults([])
  }, [])

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
    const step = createStepFromPalette(skill)
    addStep(insertIndex, step)
    closePalette()
  }, [insertIndex, addStep, closePalette])

  // Select an MCP skill result → create step
  const handleMcpSelect = useCallback((mcpSkill: McpSkillResult) => {
    const step: ChainStepDef = {
      id: nextId("s"),
      phase: inferMcpPhase(mcpSkill.skill),
      labelKey: mcpSkill.skill, // literal name (not i18n key)
      skillSelection: { lite: mcpSkill.skill, standard: mcpSkill.skill, deep: mcpSkill.skill },
      required: true,
      defaultDepth: "standard" as const,
    }
    addStep(insertIndex, step)
    closePalette()
  }, [insertIndex, addStep, closePalette])

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

  const handleSave = useCallback(async () => {
    if (!draft.name || draft.steps.length < 1) return
    setSaving(true)
    try {
      const apiBase = "https://agentlore.vercel.app"
      const method = draft.slug ? "PUT" : "POST"
      const url = draft.slug
        ? `${apiBase}/api/chains/${draft.slug}`
        : `${apiBase}/api/chains`
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          description: draft.description || draft.name,
          steps: draft.steps,
          forkedFrom: draft.forkedFromSlug,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }))
        console.error("[ChainBuilder] save failed:", err)
        return
      }
      const { data } = await res.json()
      setDraft(d => ({ ...d, slug: data.slug }))
    } finally {
      setSaving(false)
    }
  }, [draft])

  // ─── Delete handler ─────────────────────────────────────────
  const handleDeleteChain = useCallback(async (slug: string) => {
    if (!confirm(t("builder.deleteConfirm"))) return
    try {
      await fetch(`https://agentlore.vercel.app/api/chains/${slug}`, { method: "DELETE" })
      setMyChains(prev => prev.filter(c => c.slug !== slug))
    } catch { /* ignore */ }
  }, [t])

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
          {/* Step name */}
          <div style={{
            flex: 1, fontSize: 13, fontWeight: 600,
            color: "var(--text-primary)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {t(step.labelKey) || step.labelKey}
          </div>
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
          {/* Delete button */}
          <button
            onClick={() => removeStep(step.id)}
            style={{
              background: "none", border: "none", padding: 2,
              color: "var(--text-secondary)", cursor: "pointer",
              opacity: 0.5, display: "flex", alignItems: "center",
            }}
          >
            <XIcon size={12} />
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
            onClick={() => cycleAgent(step.id)}
            style={{
              fontSize: 10, fontWeight: 600,
              color: "var(--text-secondary)",
              background: "var(--glass-bg)",
              border: "1px solid var(--glass-border)",
              borderRadius: 4, padding: "2px 6px",
              cursor: "pointer",
            }}
          >
            {step.agentConfig?.agentId || t("builder.sessionDefault")}
          </button>
          {step.agentConfig?.agentId && (
            <button
              onClick={() => cycleModel(step.id)}
              style={{
                fontSize: 10, color: "var(--accent-primary)",
                background: "var(--accent-primary-bg)",
                border: "none", borderRadius: 4,
                padding: "2px 6px", cursor: "pointer",
              }}
            >
              {step.agentConfig.model || "default"}
            </button>
          )}
        </div>
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
      {/* Vertical line */}
      <div style={{
        width: 2, height: 16,
        background: "var(--glass-border)",
        borderRadius: 1,
      }} />
      {/* Branch button */}
      {index < draft.steps.length - 1 && !isParallelGroup(draft.steps[index]) && !isParallelGroup(draft.steps[index + 1]) && (
        <button
          onClick={() => createParallelGroup(index)}
          style={{
            fontSize: 9, fontWeight: 600,
            color: "var(--text-secondary)",
            background: "transparent",
            border: "1px dashed var(--glass-border)",
            borderRadius: 4, padding: "1px 6px",
            cursor: "pointer", margin: "2px 0",
            opacity: 0.5,
          }}
        >
          <GitForkIcon size={10} /> {t("builder.addBranch")}
        </button>
      )}
      {/* Vertical line */}
      <div style={{
        width: 2, height: 16,
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
        style={{
          border: `1px solid ${phaseColor.line}`,
          borderRadius: 12,
          padding: 10,
          background: phaseColor.bg,
          position: "relative",
        }}
      >
        {/* Parallel header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 8,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <GitForkIcon size={12} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>
              {t("chain.parallel.label")}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Join strategy toggle */}
            <button
              onClick={() => toggleJoinStrategy(pg.id)}
              style={{
                fontSize: 9, fontWeight: 700,
                color: pg.joinStrategy === "all" ? "#34d399" : "#fbbf24",
                background: pg.joinStrategy === "all" ? "#34d39918" : "#fbbf2418",
                border: "none", borderRadius: 4,
                padding: "2px 8px", cursor: "pointer",
                textTransform: "uppercase" as const,
              }}
            >
              {pg.joinStrategy === "all" ? t("builder.joinAll") : t("builder.joinAny")}
            </button>
            {/* Dissolve button */}
            <button
              onClick={() => dissolveParallelGroup(pg.id)}
              style={{
                background: "none", border: "none", padding: 2,
                color: "var(--text-secondary)", cursor: "pointer", opacity: 0.5,
              }}
            >
              <XIcon size={12} />
            </button>
          </div>
        </div>
        {/* Branch cards side by side */}
        <div style={{
          display: "flex", gap: 8,
        }}>
          {pg.branches.map(branch => renderStepCard(branch, index, true))}
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
        <button onClick={() => setView("list")} style={{
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
      </div>

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
          <div style={{
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
              {t("builder.palette.title")}
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
    </div>
  )
}
