// web/components/PlanPanel.tsx — Plan panel (PRD + Tasks + Standards)
import { useState, useEffect, useCallback, useRef } from "react"
import { getApiBase } from "../lib/storage"
import { useLocale } from "../lib/i18n/index.js"
import type { Task, TaskStore, Prd } from "../types"
import { StandardsContent } from "./StandardsPage"

const SPRING = "cubic-bezier(0.16, 1, 0.3, 1)"

interface PlanPanelProps {
  projectId: string
  send?: (msg: Record<string, unknown>) => boolean
}

export function PlanPanel({ projectId, send }: PlanPanelProps) {
  const { t } = useLocale()
  const isDark = document.documentElement.classList.contains("dark")
  const [activeTab, setActiveTab] = useState<"prd" | "tasks" | "standards">("prd")

  // ── Data ──
  const [store, setStore] = useState<TaskStore | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedTask, setExpandedTask] = useState<number | null>(null)
  const [requirement, setRequirement] = useState("")
  const [processing, setProcessing] = useState(false)
  const [showAddTasks, setShowAddTasks] = useState(false)
  const [jsonInput, setJsonInput] = useState("")
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchTasks = useCallback(() => {
    setLoading(true)
    fetch(`${getApiBase()}/api/tasks/${encodeURIComponent(projectId)}`)
      .then(r => r.json())
      .then(data => { if (data) setStore(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const saveStore = useCallback((newStore: TaskStore) => {
    setStore(newStore)
    fetch(`${getApiBase()}/api/tasks/${encodeURIComponent(projectId)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newStore),
    }).catch(() => {})
  }, [projectId])

  const toggleStatus = useCallback((taskId: number) => {
    if (!store) return
    const task = store.tasks.find(t => t.id === taskId)
    if (!task) return
    const next = task.status === "pending" ? "in_progress" as const : task.status === "in_progress" ? "done" as const : "pending" as const
    const newTasks = store.tasks.map(t => t.id === taskId ? { ...t, status: next } : t)
    saveStore({ ...store, tasks: newTasks, updatedAt: Date.now() })
  }, [store, saveStore])

  const moveTask = useCallback((idx: number, dir: -1 | 1) => {
    if (!store) return
    const tasks = [...store.tasks]
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= tasks.length) return
    ;[tasks[idx], tasks[newIdx]] = [tasks[newIdx], tasks[idx]]
    saveStore({ ...store, tasks, updatedAt: Date.now() })
  }, [store, saveStore])

  const handleBreakdown = useCallback(() => {
    if (!requirement.trim() || !send) return
    setProcessing(true)
    const prompt = `Break down this requirement into numbered implementation tasks. Return ONLY a JSON array, no other text. Format: [{"id":1,"title":"...","description":"...","dependsOn":[]}]. Keep tasks atomic and actionable. Requirement:\n\n${requirement.trim()}`
    send({ type: "input", data: prompt })
    setTimeout(() => send({ type: "input", data: "\r" }), 50)
    setTimeout(() => { setProcessing(false); fetchTasks() }, 3000)
  }, [requirement, send, fetchTasks])

  const importJson = useCallback(() => {
    try {
      const tasks = JSON.parse(jsonInput) as Task[]
      if (!Array.isArray(tasks)) return
      saveStore({ projectId, requirement: store?.requirement || "", tasks, createdAt: store?.createdAt || Date.now(), updatedAt: Date.now() })
      setJsonInput("")
      setShowAddTasks(false)
    } catch {}
  }, [jsonInput, projectId, store, saveStore])

  const prd = store?.prd
  const tasks = store?.tasks || []
  const doneCount = tasks.filter(t => t.status === "done").length
  const totalCount = tasks.length

  // ── Styles ──
  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "7px 0", borderRadius: 8, fontSize: 11, fontWeight: 600,
    cursor: "pointer", transition: "all 0.2s",
    background: active ? "var(--accent-primary-bg, rgba(55,172,192,0.12))" : "transparent",
    color: active ? "var(--accent-primary, #37ACC0)" : "var(--text-secondary)",
    border: active ? "1px solid var(--accent-primary, #37ACC0)" : "1px solid var(--glass-border)",
  })

  const sectionStyle: React.CSSProperties = {
    borderRadius: 14, padding: "14px 16px",
    background: isDark ? "rgba(55,172,192,0.06)" : "rgba(55,172,192,0.04)",
    border: `1px solid ${isDark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)"}`,
    backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
    marginBottom: 12,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 1.2,
    color: "#37ACC0", marginBottom: 8, opacity: 0.8,
  }

  const statusColors: Record<string, { bg: string; text: string; border: string }> = {
    pending: { bg: "rgba(148,163,184,0.1)", text: "#94a3b8", border: "rgba(148,163,184,0.2)" },
    in_progress: { bg: "rgba(96,165,250,0.1)", text: "#60a5fa", border: "rgba(96,165,250,0.2)" },
    done: { bg: "rgba(34,197,94,0.1)", text: "#22c55e", border: "rgba(34,197,94,0.2)" },
  }

  const cardBg = isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)"

  const [showPrdInput, setShowPrdInput] = useState(false)
  const [prdGoalInput, setPrdGoalInput] = useState("")

  const handleCreatePrd = useCallback(() => {
    if (!prdGoalInput.trim() || !send) return
    setProcessing(true)
    const prompt = `I want to build: ${prdGoalInput.trim()}\n\nPlease create a PRD (Product Requirements Document) for this. Ask me clarifying questions one at a time to refine the requirements, then generate a structured plan with tasks.`
    send({ type: "input", data: prompt })
    setTimeout(() => send({ type: "input", data: "\r" }), 500)
    setTimeout(() => { setProcessing(false); setShowPrdInput(false); setPrdGoalInput("") }, 3000)
  }, [prdGoalInput, send])

  // ── PRD Tab ──
  const renderPrd = () => {
    if (loading) return <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)", opacity: 0.5 }}>Loading...</div>

    if (!prd && totalCount === 0) {
      // Onboarding: show guided start
      if (showPrdInput) {
        return (
          <div style={{ ...sectionStyle, marginBottom: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <button onClick={() => setShowPrdInput(false)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-secondary)", display: "flex" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{t("prd.newPlan") || "New Plan"}</div>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
              {t("prd.inputHint") || "Just write one sentence about what you want. The agent will ask follow-up questions to fill in the details."}
            </div>
            <textarea value={prdGoalInput} onChange={e => setPrdGoalInput(e.target.value)}
              placeholder={t("prd.inputPlaceholder") || 'e.g. "Add a dark mode toggle to settings"'}
              rows={2} autoFocus
              style={{ width: "100%", padding: 12, borderRadius: 10, fontSize: 13, border: `1px solid ${isDark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.15)"}`, background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", color: "var(--text-primary)", resize: "vertical", outline: "none", fontFamily: "inherit", lineHeight: 1.5 }} />
            <button onClick={handleCreatePrd} disabled={!prdGoalInput.trim() || processing}
              style={{ width: "100%", marginTop: 10, padding: "12px 0", borderRadius: 12, fontSize: 13, fontWeight: 700, background: "linear-gradient(135deg, #37ACC0, #347792)", color: "#fff", border: "none", cursor: "pointer", opacity: (!prdGoalInput.trim() || processing) ? 0.4 : 1, boxShadow: "0 2px 12px rgba(55,172,192,0.25)" }}>
              {processing ? "..." : (t("prd.startPlanning") || "Start Planning")}
            </button>
          </div>
        )
      }

      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: "24px 16px" }}>
          {/* Hero icon */}
          <div style={{ width: 56, height: 56, borderRadius: 16, background: isDark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.08)", border: `1px solid ${isDark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.12)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
            </svg>
          </div>

          {/* Title + subtitle */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
              {t("prd.onboardTitle") || "Plan before you build"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 260, opacity: 0.7 }}>
              {t("prd.onboardDesc") || "Describe your idea in one sentence. The agent will ask you questions, then generate a full plan with tasks."}
            </div>
          </div>

          {/* How it works - 3 steps */}
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 0 }}>
            {[
              { step: "1", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z", label: t("prd.step1") || "You describe your idea" },
              { step: "2", icon: "M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01", label: t("prd.step2") || "Agent asks follow-up questions" },
              { step: "3", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11", label: t("prd.step3") || "Plan + tasks auto-generated" },
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", position: "relative" }}>
                {/* Step connector line */}
                {i < 2 && <div style={{ position: "absolute", left: 19, top: 36, width: 1, height: 16, background: isDark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)" }} />}
                <div style={{ width: 28, height: 28, borderRadius: 8, background: isDark ? "rgba(55,172,192,0.08)" : "rgba(55,172,192,0.06)", border: `1px solid ${isDark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={s.icon}/></svg>
                </div>
                <span style={{ fontSize: 12, color: "var(--text-primary)", opacity: 0.8 }}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button onClick={() => setShowPrdInput(true)}
            style={{ width: "100%", maxWidth: 260, padding: "14px 0", borderRadius: 14, fontSize: 14, fontWeight: 700, background: "linear-gradient(135deg, #37ACC0, #347792)", color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 4px 16px rgba(55,172,192,0.3)", transition: `transform 0.2s ${SPRING}` }}>
            {t("prd.startButton") || "Start a Plan"}
          </button>
        </div>
      )
    }

    return (
      <>
        {/* Progress bar */}
        {totalCount > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", opacity: 0.6 }}>
                {t("prd.progress") || "Progress"}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: doneCount === totalCount ? "#22c55e" : "#37ACC0", fontFamily: "'JetBrains Mono', monospace" }}>
                {doneCount}/{totalCount}
              </span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
              <div style={{
                height: "100%", borderRadius: 2,
                width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%`,
                background: doneCount === totalCount ? "linear-gradient(90deg, #22c55e, #37ACC0)" : "linear-gradient(90deg, #37ACC0, #347792)",
                transition: `width 0.5s ${SPRING}`,
              }} />
            </div>
          </div>
        )}

        {prd && (
          <>
            {/* Goal */}
            <div style={sectionStyle}>
              <div style={labelStyle}>{t("prd.goal") || "Goal"}</div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-primary)" }}>{prd.goal}</div>
            </div>

            {/* Decisions */}
            {prd.decisions.length > 0 && (
              <div style={sectionStyle}>
                <div style={labelStyle}>{t("prd.decisions") || "Decisions"}</div>
                {prd.decisions.map((d, i) => (
                  <div key={i} style={{ padding: "8px 10px", borderRadius: 8, background: cardBg, border: `1px solid ${isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"}`, marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 3 }}>Q: {d.question}</div>
                    <div style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.5 }}>A: {d.answer}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Approaches */}
            {prd.approaches.length > 0 && (
              <div style={sectionStyle}>
                <div style={labelStyle}>{t("prd.approaches") || "Approaches"}</div>
                {prd.approaches.map((a, i) => (
                  <div key={i} style={{
                    padding: "10px 12px", borderRadius: 10, marginBottom: 6,
                    background: a.adopted ? (isDark ? "rgba(55,172,192,0.08)" : "rgba(55,172,192,0.06)") : cardBg,
                    border: a.adopted ? `1.5px solid ${isDark ? "rgba(55,172,192,0.3)" : "rgba(55,172,192,0.25)"}` : `1px solid ${isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{a.name}</span>
                      {a.adopted && <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: isDark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.15)", color: "#37ACC0", textTransform: "uppercase" }}>{t("prd.adopted") || "Adopted"}</span>}
                    </div>
                    {a.pros.map((p, j) => (
                      <div key={`p${j}`} style={{ fontSize: 11, color: "#22c55e", lineHeight: 1.5, display: "flex", gap: 4 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ flexShrink: 0, marginTop: 3 }}><polyline points="20 6 9 17 4 12" /></svg>
                        <span>{p}</span>
                      </div>
                    ))}
                    {a.cons.map((c, j) => (
                      <div key={`c${j}`} style={{ fontSize: 11, color: isDark ? "#f87171" : "#dc2626", lineHeight: 1.5, display: "flex", gap: 4 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ flexShrink: 0, marginTop: 3 }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        <span>{c}</span>
                      </div>
                    ))}
                    {a.techNote && <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-secondary)", opacity: 0.6, fontStyle: "italic" }}>Tech: {a.techNote}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Scope */}
            {(prd.scope.included.length > 0 || prd.scope.excluded.length > 0) && (
              <div style={sectionStyle}>
                <div style={labelStyle}>{t("prd.scope") || "Scope"}</div>
                {prd.scope.included.map((item, i) => (
                  <div key={`in${i}`} style={{ fontSize: 12, color: "#22c55e", lineHeight: 1.7, display: "flex", gap: 5 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ flexShrink: 0, marginTop: 4 }}><polyline points="20 6 9 17 4 12" /></svg>
                    <span>{item}</span>
                  </div>
                ))}
                {prd.scope.excluded.map((item, i) => (
                  <div key={`ex${i}`} style={{ fontSize: 12, color: "var(--text-secondary)", opacity: 0.5, lineHeight: 1.7, display: "flex", gap: 5 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ flexShrink: 0, marginTop: 4 }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Quick task overview in PRD tab */}
        {totalCount > 0 && (
          <div style={sectionStyle}>
            <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between" }}>
              <span>{t("prd.tasks") || "Tasks"}</span>
              <button onClick={() => setActiveTab("tasks")} style={{ background: "none", border: "none", color: "#37ACC0", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
                {t("prd.viewAll") || "View All"}
              </button>
            </div>
            {tasks.slice(0, 5).map((task, idx) => {
              const sc = statusColors[task.status] || statusColors.pending
              return (
                <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: idx < Math.min(4, totalCount - 1) ? `1px solid ${isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"}` : "none" }}>
                  <div style={{ width: 20, height: 20, borderRadius: 6, background: sc.bg, border: `1px solid ${sc.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: sc.text, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                    {idx + 1}
                  </div>
                  <span style={{ flex: 1, fontSize: 12, color: "var(--text-primary)", textDecoration: task.status === "done" ? "line-through" : "none", opacity: task.status === "done" ? 0.5 : 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {task.title}
                  </span>
                  <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: sc.bg, color: sc.text, textTransform: "uppercase" }}>
                    {task.status === "in_progress" ? "WIP" : task.status}
                  </span>
                </div>
              )
            })}
            {totalCount > 5 && <div style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.5, marginTop: 4, textAlign: "center" }}>+{totalCount - 5} more</div>}
          </div>
        )}
      </>
    )
  }

  const [showBreakdown, setShowBreakdown] = useState(false)

  // ── Tasks Tab ──
  const renderTasks = () => (
    <>
      {!totalCount && !showBreakdown && (
        <div style={{ textAlign: "center", padding: "36px 20px", color: "var(--text-secondary)", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25, color: "#37ACC0" }}>
            <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{t("tasks.empty") || "No tasks yet"}</div>
            <div style={{ fontSize: 11, opacity: 0.5, lineHeight: 1.6, maxWidth: 220 }}>
              {t("tasks.emptyHint") || "Let AI break down your idea into actionable steps, or import tasks manually."}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 240 }}>
            <button onClick={() => setShowBreakdown(true)}
              style={{ padding: "12px 0", borderRadius: 12, fontSize: 13, fontWeight: 700, background: "linear-gradient(135deg, #37ACC0, #347792)", color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 2px 12px rgba(55,172,192,0.3)" }}>
              {t("tasks.aiBreakdown") || "AI Breakdown"}
            </button>
            <button onClick={() => setShowAddTasks(true)}
              style={{ padding: "10px 0", borderRadius: 10, fontSize: 12, background: "transparent", color: "var(--text-secondary)", border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`, cursor: "pointer", opacity: 0.6 }}>
              {t("tasks.importJson") || "Import JSON"}
            </button>
          </div>
        </div>
      )}

      {!totalCount && showBreakdown && (
        <div style={{ ...sectionStyle, marginBottom: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <button onClick={() => setShowBreakdown(false)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-secondary)", display: "flex" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{t("tasks.aiBreakdown") || "AI Breakdown"}</div>
          </div>
          <textarea value={requirement} onChange={e => setRequirement(e.target.value)} placeholder={t("tasks.breakdownPlaceholder") || "Describe what you want to build..."} rows={3}
            style={{ width: "100%", padding: 10, borderRadius: 8, fontSize: 12, border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`, background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", color: "var(--text-primary)", resize: "vertical", outline: "none", fontFamily: "inherit" }} />
          <button onClick={handleBreakdown} disabled={!requirement.trim() || processing}
            style={{ width: "100%", marginTop: 8, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, background: "linear-gradient(135deg, #37ACC0, #347792)", color: "#fff", border: "none", cursor: "pointer", opacity: (!requirement.trim() || processing) ? 0.4 : 1 }}>
            {processing ? "..." : (t("tasks.generate") || "Generate Tasks")}
          </button>
        </div>
      )}

      {showAddTasks && (
        <div style={sectionStyle}>
          <textarea value={jsonInput} onChange={e => setJsonInput(e.target.value)} placeholder='[{"id":1,"title":"...","description":"..."}]' rows={4}
            style={{ width: "100%", padding: 10, borderRadius: 8, fontSize: 11, border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`, background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", color: "var(--text-primary)", fontFamily: "'JetBrains Mono', monospace", resize: "vertical", outline: "none" }} />
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button onClick={importJson} style={{ flex: 1, padding: 8, borderRadius: 8, fontSize: 12, fontWeight: 600, background: "#37ACC0", color: "#fff", border: "none", cursor: "pointer" }}>Import</button>
            <button onClick={() => setShowAddTasks(false)} style={{ padding: "8px 12px", borderRadius: 8, fontSize: 12, background: "transparent", color: "var(--text-secondary)", border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {totalCount > 0 && showBreakdown && (
        <div style={{ ...sectionStyle, marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <button onClick={() => setShowBreakdown(false)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-secondary)", display: "flex" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{t("tasks.aiBreakdown") || "AI Breakdown"}</div>
          </div>
          <textarea value={requirement} onChange={e => setRequirement(e.target.value)} placeholder={t("tasks.breakdownPlaceholder") || "Describe what you want to build..."} rows={3}
            style={{ width: "100%", padding: 10, borderRadius: 8, fontSize: 12, border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`, background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", color: "var(--text-primary)", resize: "vertical", outline: "none", fontFamily: "inherit" }} />
          <button onClick={handleBreakdown} disabled={!requirement.trim() || processing}
            style={{ width: "100%", marginTop: 8, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, background: "linear-gradient(135deg, #37ACC0, #347792)", color: "#fff", border: "none", cursor: "pointer", opacity: (!requirement.trim() || processing) ? 0.4 : 1 }}>
            {processing ? "..." : (t("tasks.generate") || "Generate Tasks")}
          </button>
        </div>
      )}

      {tasks.map((task, idx) => {
        const sc = statusColors[task.status] || statusColors.pending
        const isExpanded = expandedTask === task.id
        const isFirst = idx === 0 && task.status === "pending"
        return (
          <div key={task.id} onClick={() => setExpandedTask(isExpanded ? null : task.id)}
            onTouchStart={() => { longPressTimer.current = setTimeout(() => { if (send) { send({ type: "input", data: task.description || task.title }); setTimeout(() => send({ type: "input", data: "\r" }), 500) } }, 800) }}
            onTouchEnd={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current) }}
            style={{
              padding: "12px 14px", borderRadius: 12, cursor: "pointer",
              border: isFirst ? "1.5px solid rgba(55,172,192,0.4)" : `1px solid ${sc.border}`,
              background: cardBg, backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, background: isFirst ? "rgba(55,172,192,0.15)" : sc.bg, border: `1px solid ${isFirst ? "rgba(55,172,192,0.3)" : sc.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: isFirst ? "#37ACC0" : sc.text, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                {idx + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", textDecoration: task.status === "done" ? "line-through" : "none", opacity: task.status === "done" ? 0.5 : 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {task.title}
                </div>
                {isFirst && <div style={{ fontSize: 9, fontWeight: 700, color: "#37ACC0", marginTop: 2, textTransform: "uppercase", letterSpacing: 1 }}>NEXT</div>}
              </div>
              <button onClick={(e) => { e.stopPropagation(); toggleStatus(task.id) }}
                style={{ padding: "3px 8px", borderRadius: 6, background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text, fontSize: 9, fontWeight: 700, cursor: "pointer", flexShrink: 0, textTransform: "uppercase" }}>
                {task.status === "in_progress" ? "WIP" : task.status}
              </button>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <button onClick={(e) => { e.stopPropagation(); moveTask(idx, -1) }} style={{ background: "none", border: "none", padding: 1, cursor: "pointer", color: "var(--text-secondary)", opacity: idx === 0 ? 0.2 : 0.6 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15"/></svg>
                </button>
                <button onClick={(e) => { e.stopPropagation(); moveTask(idx, 1) }} style={{ background: "none", border: "none", padding: 1, cursor: "pointer", color: "var(--text-secondary)", opacity: idx === totalCount - 1 ? 0.2 : 0.6 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
              </div>
            </div>
            {isExpanded && task.description && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--glass-border)" }}>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: send ? 8 : 0 }}>{task.description}</div>
                {send && task.status === "pending" && (
                  <button onClick={(e) => { e.stopPropagation(); send({ type: "input", data: task.description || task.title }); setTimeout(() => send({ type: "input", data: "\r" }), 500); toggleStatus(task.id) }}
                    style={{ width: "100%", padding: 10, borderRadius: 10, border: "none", background: "#37ACC0", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    {t("tasks.startNow") || "Start Now"}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {totalCount > 0 && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setShowBreakdown(true)} style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px dashed ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`, background: "transparent", color: "#37ACC0", fontSize: 11, cursor: "pointer", opacity: 0.6 }}>
            + {t("tasks.aiBreakdown") || "AI Breakdown"}
          </button>
          <button onClick={() => setShowAddTasks(true)} style={{ flex: 1, padding: 10, borderRadius: 8, border: `1px dashed ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`, background: "transparent", color: "var(--text-secondary)", fontSize: 11, cursor: "pointer", opacity: 0.5 }}>
            + {t("tasks.importJson") || "Import JSON"}
          </button>
        </div>
      )}
    </>
  )

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, padding: "4px 16px 8px", flexShrink: 0 }}>
        <button onClick={() => setActiveTab("prd")} style={tabStyle(activeTab === "prd")}>
          PRD
        </button>
        <button onClick={() => setActiveTab("tasks")} style={tabStyle(activeTab === "tasks")}>
          Tasks {totalCount > 0 ? `(${doneCount}/${totalCount})` : ""}
        </button>
        <button onClick={() => setActiveTab("standards")} style={tabStyle(activeTab === "standards")}>
          {t("standards.title") || "Standards"}
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {activeTab === "prd" && renderPrd()}
        {activeTab === "tasks" && renderTasks()}
        {activeTab === "standards" && <StandardsContent />}
      </div>
    </div>
  )
}
