// web/components/PlanPanel.tsx — Plan panel (multi-PRD + Standards)
import React, { useState, useEffect, useCallback, useRef } from "react"
import { getApiBase } from "../lib/storage"
import { useLocale } from "../lib/i18n/index.js"
import type { PrdItem, PrdSummary, PrdPriority, Task } from "../types"
import { StandardsContent } from "./StandardsPage"

const SPRING = "cubic-bezier(0.16, 1, 0.3, 1)"

interface PlanPanelProps {
  projectId: string
  send?: (msg: Record<string, unknown>) => boolean
}

const PRIORITY_LABELS: Record<PrdPriority, { label: string; color: string; bg: string }> = {
  p0: { label: "P0", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  p1: { label: "P1", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  p2: { label: "P2", color: "#37ACC0", bg: "rgba(55,172,192,0.12)" },
  p3: { label: "P3", color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  pending: { bg: "rgba(148,163,184,0.1)", text: "#94a3b8", border: "rgba(148,163,184,0.2)" },
  in_progress: { bg: "rgba(96,165,250,0.1)", text: "#60a5fa", border: "rgba(96,165,250,0.2)" },
  done: { bg: "rgba(34,197,94,0.1)", text: "#22c55e", border: "rgba(34,197,94,0.2)" },
  skipped: { bg: "rgba(148,163,184,0.06)", text: "#64748b", border: "rgba(148,163,184,0.15)" },
}

export const PlanPanel = React.memo(function PlanPanel({ projectId, send }: PlanPanelProps) {
  const { t } = useLocale()
  const isDark = document.documentElement.classList.contains("dark")
  const [activeTab, setActiveTab] = useState<"prd" | "standards" | "constraints" | "audit">("prd")

  // ── PRD list ──
  const [prdList, setPrdList] = useState<PrdSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedPrdId, setSelectedPrdId] = useState<string | null>(null)
  const [selectedPrd, setSelectedPrd] = useState<PrdItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // ── Create PRD ──
  const [showCreate, setShowCreate] = useState(false)
  const [createGoal, setCreateGoal] = useState("")
  const [createPriority, setCreatePriority] = useState<PrdPriority>("p1")
  const [processing, setProcessing] = useState(false)

  // ── Constraints ──
  const [constraints, setConstraints] = useState<{ source: string; severity: string; title: string; description: string; ref?: string }[]>([])
  const [constraintsLoading, setConstraintsLoading] = useState(false)
  const [selectedAutoId, setSelectedAutoId] = useState<string | null>(null)
  const [automationList, setAutomationList] = useState<{ id: string; name: string; trustProfile?: string; sandboxLevel?: string }[]>([])

  // ── Audit ──
  const [auditEntries, setAuditEntries] = useState<{ timestamp: number; action: string; automationName?: string; detail: Record<string, unknown> }[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  const fetchAuditLog = useCallback(() => {
    setAuditLoading(true)
    fetch(`${getApiBase()}/api/audit/recent?limit=50`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAuditEntries(data) })
      .catch(() => setAuditEntries([]))
      .finally(() => setAuditLoading(false))
  }, [])

  const fetchAutomations = useCallback(() => {
    fetch(`${getApiBase()}/api/automations/${encodeURIComponent(projectId)}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAutomationList(data) })
      .catch(() => {})
  }, [projectId])

  const fetchConstraints = useCallback((autoId: string) => {
    setConstraintsLoading(true)
    fetch(`${getApiBase()}/api/automations/${encodeURIComponent(projectId)}/${encodeURIComponent(autoId)}/constraints`)
      .then(r => r.json())
      .then(data => { if (data?.constraints) setConstraints(data.constraints) })
      .catch(() => setConstraints([]))
      .finally(() => setConstraintsLoading(false))
  }, [projectId])

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchPrdList = useCallback(() => {
    setLoading(true)
    fetch(`${getApiBase()}/api/prd/${encodeURIComponent(projectId)}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setPrdList(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  const fetchPrdDetail = useCallback((prdId: string) => {
    setDetailLoading(true)
    fetch(`${getApiBase()}/api/prd/${encodeURIComponent(projectId)}/${encodeURIComponent(prdId)}`)
      .then(r => r.json())
      .then(data => { if (data?.id) setSelectedPrd(data) })
      .catch(() => {})
      .finally(() => setDetailLoading(false))
  }, [projectId])

  useEffect(() => { fetchPrdList() }, [fetchPrdList])

  // Refresh list when tab becomes visible (e.g. after agent generates PRD)
  useEffect(() => {
    const handler = () => { if (!document.hidden) fetchPrdList() }
    document.addEventListener("visibilitychange", handler)
    return () => document.removeEventListener("visibilitychange", handler)
  }, [fetchPrdList])

  // Auto-refresh when PRD changes via WS (agent creates/updates PRD via API)
  useEffect(() => {
    const handler = () => { fetchPrdList(); if (selectedPrd) fetchPrdDetail(selectedPrd.id) }
    window.addEventListener("prd_changed", handler)
    return () => window.removeEventListener("prd_changed", handler)
  }, [fetchPrdList, fetchPrdDetail, selectedPrd])

  const openPrd = useCallback((prdId: string) => {
    setSelectedPrdId(prdId)
    fetchPrdDetail(prdId)
  }, [fetchPrdDetail])

  const closePrd = useCallback(() => {
    setSelectedPrdId(null)
    setSelectedPrd(null)
    fetchPrdList()
  }, [fetchPrdList])

  // ── PRD actions ──
  const updatePrdField = useCallback((prdId: string, body: Record<string, unknown>) => {
    fetch(`${getApiBase()}/api/prd/${encodeURIComponent(projectId)}/${encodeURIComponent(prdId)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(r => r.json()).then(data => {
      if (data?.id) setSelectedPrd(data)
      fetchPrdList()
    }).catch(() => {})
  }, [projectId, fetchPrdList])

  const updateTaskStatus = useCallback((prdId: string, taskId: number, status: string) => {
    fetch(`${getApiBase()}/api/prd/${encodeURIComponent(projectId)}/${encodeURIComponent(prdId)}/tasks/${taskId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(r => r.json()).then(data => {
      if (data?.prdAutoCompleted) {
        // PRD auto-completed, refresh detail + list
        fetchPrdDetail(prdId)
        fetchPrdList()
      } else if (data?.task && selectedPrd) {
        // Update task in local state
        setSelectedPrd(prev => {
          if (!prev) return prev
          return {
            ...prev,
            tasks: prev.tasks.map(t => t.id === taskId ? { ...t, status: data.task.status } : t),
            updatedAt: Date.now(),
          }
        })
      }
    }).catch(() => {})
  }, [projectId, selectedPrd, fetchPrdDetail, fetchPrdList])

  const handleCreatePrd = useCallback(() => {
    if (!createGoal.trim() || !send) return
    setProcessing(true)
    const prompt = `I want to build: ${createGoal.trim()}\n\nPlease create a PRD (Product Requirements Document) for this. Ask me clarifying questions one at a time to refine the requirements, then generate a structured plan with tasks. Set priority to ${createPriority}.`
    send({ type: "input", data: prompt })
    setTimeout(() => send({ type: "input", data: "\r" }), 500)
    setTimeout(() => { setProcessing(false); setShowCreate(false); setCreateGoal(""); fetchPrdList() }, 3000)
  }, [createGoal, createPriority, send, fetchPrdList])

  const toggleTaskStatus = useCallback((task: Task) => {
    if (!selectedPrdId) return
    const cycle: Record<string, string> = { pending: "in_progress", in_progress: "done", done: "pending", skipped: "pending" }
    updateTaskStatus(selectedPrdId, task.id, cycle[task.status] || "pending")
  }, [selectedPrdId, updateTaskStatus])

  const skipTask = useCallback((taskId: number) => {
    if (!selectedPrdId) return
    updateTaskStatus(selectedPrdId, taskId, "skipped")
  }, [selectedPrdId, updateTaskStatus])

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

  const cardBg = isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)"

  // ── Priority badge ──
  const PriorityBadge = ({ p, onCycle }: { p: PrdPriority; onCycle?: () => void }) => {
    const info = PRIORITY_LABELS[p] || PRIORITY_LABELS.p1
    return (
      <button onClick={e => { e.stopPropagation(); onCycle?.() }}
        style={{ padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 800, background: info.bg, color: info.color, border: "none", cursor: onCycle ? "pointer" : "default", letterSpacing: 0.5, fontFamily: "'JetBrains Mono', monospace" }}>
        {info.label}
      </button>
    )
  }

  // ── PRD Detail View ──
  const renderPrdDetail = () => {
    if (detailLoading || !selectedPrd) return <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)", opacity: 0.5 }}>Loading...</div>

    const prd = selectedPrd
    const tasks = prd.tasks
    const doneCount = tasks.filter(t => t.status === "done").length
    const skippedCount = tasks.filter(t => t.status === "skipped").length
    const totalCount = tasks.length

    const cyclePriority = () => {
      const cycle: PrdPriority[] = ["p0", "p1", "p2", "p3"]
      const next = cycle[(cycle.indexOf(prd.priority) + 1) % cycle.length]
      updatePrdField(prd.id, { priority: next })
    }

    return (
      <>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <button onClick={closePrd} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-secondary)", display: "flex" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{prd.title}</div>
          </div>
          <PriorityBadge p={prd.priority} onCycle={cyclePriority} />
          {prd.status === "done" ? (
            <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>DONE</span>
          ) : (
            <button onClick={() => updatePrdField(prd.id, { status: "done" })}
              style={{ fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: "transparent", color: "var(--text-secondary)", border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`, cursor: "pointer", opacity: 0.6 }}>
              Mark Done
            </button>
          )}
        </div>

        {/* Progress */}
        {totalCount > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", opacity: 0.6 }}>
                {t("prd.progress") || "Progress"}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: doneCount === totalCount ? "#22c55e" : "#37ACC0", fontFamily: "'JetBrains Mono', monospace" }}>
                {doneCount}/{totalCount}{skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}
              </span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
              <div style={{
                height: "100%", borderRadius: 2,
                width: `${totalCount > 0 ? ((doneCount + skippedCount) / totalCount) * 100 : 0}%`,
                background: (doneCount + skippedCount) === totalCount ? "linear-gradient(90deg, #22c55e, #37ACC0)" : "linear-gradient(90deg, #37ACC0, #347792)",
                transition: `width 0.5s ${SPRING}`,
              }} />
            </div>
          </div>
        )}

        {/* Goal */}
        {prd.goal && (
          <div style={sectionStyle}>
            <div style={labelStyle}>{t("prd.goal") || "Goal"}</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-primary)" }}>{prd.goal}</div>
          </div>
        )}

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

        {/* Tasks */}
        <div style={sectionStyle}>
          <div style={labelStyle}>{t("prd.tasks") || "Tasks"}</div>
          {tasks.map((task, idx) => {
            const sc = STATUS_COLORS[task.status] || STATUS_COLORS.pending
            const isFirst = idx === tasks.findIndex(t => t.status === "pending") && task.status === "pending"
            return (
              <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: idx < tasks.length - 1 ? `1px solid ${isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"}` : "none" }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: isFirst ? "rgba(55,172,192,0.15)" : sc.bg, border: `1px solid ${isFirst ? "rgba(55,172,192,0.3)" : sc.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: isFirst ? "#37ACC0" : sc.text, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                  {idx + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", textDecoration: task.status === "done" || task.status === "skipped" ? "line-through" : "none", opacity: task.status === "done" || task.status === "skipped" ? 0.5 : 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {task.title}
                  </div>
                  {isFirst && <div style={{ fontSize: 8, fontWeight: 700, color: "#37ACC0", marginTop: 1, textTransform: "uppercase", letterSpacing: 1 }}>NEXT</div>}
                </div>
                {task.priority && <PriorityBadge p={task.priority} />}
                <button onClick={() => toggleTaskStatus(task)}
                  style={{ padding: "2px 7px", borderRadius: 5, background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text, fontSize: 8, fontWeight: 700, cursor: "pointer", flexShrink: 0, textTransform: "uppercase" }}>
                  {task.status === "in_progress" ? "WIP" : task.status === "skipped" ? "SKIP" : task.status}
                </button>
                {task.status !== "skipped" && task.status !== "done" && (
                  <button onClick={() => skipTask(task.id)}
                    style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: "var(--text-secondary)", opacity: 0.4, display: "flex" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
              </div>
            )
          })}
          {tasks.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-secondary)", opacity: 0.5, textAlign: "center", padding: 8 }}>
              No tasks yet
            </div>
          )}
        </div>
      </>
    )
  }

  // ── PRD List View ──
  const renderPrdList = () => {
    if (loading) return <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)", opacity: 0.5 }}>Loading...</div>

    // Show detail if selected
    if (selectedPrdId) return renderPrdDetail()

    // Show create form
    if (showCreate) {
      return (
        <div style={{ ...sectionStyle, marginBottom: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <button onClick={() => setShowCreate(false)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-secondary)", display: "flex" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{t("prd.newPlan") || "New Plan"}</div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
            {t("prd.inputHint") || "Just write one sentence about what you want. The agent will ask follow-up questions to fill in the details."}
          </div>
          <textarea value={createGoal} onChange={e => setCreateGoal(e.target.value)}
            placeholder={t("prd.inputPlaceholder") || 'e.g. "Add a dark mode toggle to settings"'}
            rows={2} autoFocus
            style={{ width: "100%", padding: 12, borderRadius: 10, fontSize: 13, border: `1px solid ${isDark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.15)"}`, background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", color: "var(--text-primary)", resize: "vertical", outline: "none", fontFamily: "inherit", lineHeight: 1.5 }} />
          {/* Priority selector */}
          <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.6, fontWeight: 600 }}>Priority:</span>
            {(["p0", "p1", "p2", "p3"] as PrdPriority[]).map(p => {
              const info = PRIORITY_LABELS[p]
              return (
                <button key={p} onClick={() => setCreatePriority(p)}
                  style={{ padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700, background: createPriority === p ? info.bg : "transparent", color: createPriority === p ? info.color : "var(--text-secondary)", border: `1px solid ${createPriority === p ? info.color + "40" : isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", opacity: createPriority === p ? 1 : 0.5 }}>
                  {info.label}
                </button>
              )
            })}
          </div>
          <button onClick={handleCreatePrd} disabled={!createGoal.trim() || processing}
            style={{ width: "100%", marginTop: 12, padding: "12px 0", borderRadius: 12, fontSize: 13, fontWeight: 700, background: "linear-gradient(135deg, #37ACC0, #347792)", color: "#fff", border: "none", cursor: "pointer", opacity: (!createGoal.trim() || processing) ? 0.4 : 1, boxShadow: "0 2px 12px rgba(55,172,192,0.25)" }}>
            {processing ? "..." : (t("prd.startPlanning") || "Start Planning")}
          </button>
        </div>
      )
    }

    // Empty state
    if (prdList.length === 0) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: "24px 16px" }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: isDark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.08)", border: `1px solid ${isDark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.12)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
            </svg>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
              {t("prd.onboardTitle") || "Plan before you build"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 260, opacity: 0.7 }}>
              {t("prd.onboardDesc") || "Describe your idea in one sentence. The agent will ask you questions, then generate a full plan with tasks."}
            </div>
          </div>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 0 }}>
            {[
              { icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z", label: t("prd.step1") || "You describe your idea" },
              { icon: "M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01", label: t("prd.step2") || "Agent asks follow-up questions" },
              { icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11", label: t("prd.step3") || "Plan + tasks auto-generated" },
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px", position: "relative" }}>
                {i < 2 && <div style={{ position: "absolute", left: 19, top: 36, width: 1, height: 16, background: isDark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)" }} />}
                <div style={{ width: 28, height: 28, borderRadius: 8, background: isDark ? "rgba(55,172,192,0.08)" : "rgba(55,172,192,0.06)", border: `1px solid ${isDark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={s.icon}/></svg>
                </div>
                <span style={{ fontSize: 12, color: "var(--text-primary)", opacity: 0.8 }}>{s.label}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setShowCreate(true)}
            style={{ width: "100%", maxWidth: 260, padding: "14px 0", borderRadius: 14, fontSize: 14, fontWeight: 700, background: "linear-gradient(135deg, #37ACC0, #347792)", color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 4px 16px rgba(55,172,192,0.3)", transition: `transform 0.2s ${SPRING}` }}>
            {t("prd.startButton") || "Start a Plan"}
          </button>
        </div>
      )
    }

    // PRD list
    return (
      <>
        {/* New PRD button */}
        <button onClick={() => setShowCreate(true)}
          style={{ width: "100%", padding: "10px 0", borderRadius: 10, fontSize: 12, fontWeight: 700, background: "linear-gradient(135deg, #37ACC0, #347792)", color: "#fff", border: "none", cursor: "pointer", marginBottom: 10, boxShadow: "0 2px 8px rgba(55,172,192,0.2)" }}>
          + {t("prd.newPlan") || "New Plan"}
        </button>

        {prdList.map((prd) => {
          const progress = prd.tasksTotal > 0 ? ((prd.tasksDone + (prd.tasksSkipped || 0)) / prd.tasksTotal) * 100 : 0
          const isDone = prd.status === "done"
          return (
            <div key={prd.id} onClick={() => openPrd(prd.id)}
              style={{
                padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                background: isDone ? (isDark ? "rgba(34,197,94,0.04)" : "rgba(34,197,94,0.03)") : cardBg,
                border: `1px solid ${isDone ? "rgba(34,197,94,0.15)" : isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)"}`,
                backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                opacity: isDone ? 0.7 : 1,
                transition: `all 0.2s ${SPRING}`,
                marginBottom: 8,
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <PriorityBadge p={prd.priority} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: isDone ? "line-through" : "none" }}>
                    {prd.title}
                  </div>
                </div>
                {isDone && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                )}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3, flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
              </div>
              {/* Progress bar */}
              {prd.tasksTotal > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.5 }}>
                      {prd.tasksDone}/{prd.tasksTotal} tasks
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.4, fontFamily: "'JetBrains Mono', monospace" }}>
                      {Math.round(progress)}%
                    </span>
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
                    <div style={{
                      height: "100%", borderRadius: 2,
                      width: `${progress}%`,
                      background: isDone ? "#22c55e" : "linear-gradient(90deg, #37ACC0, #347792)",
                      transition: `width 0.5s ${SPRING}`,
                    }} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </>
    )
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, padding: "4px 16px 8px", flexShrink: 0 }}>
        <button onClick={() => { setActiveTab("prd"); setSelectedPrdId(null); setSelectedPrd(null) }} style={tabStyle(activeTab === "prd")}>
          PRD {prdList.filter(p => p.status === "active").length > 0 ? `(${prdList.filter(p => p.status === "active").length})` : ""}
        </button>
        <button onClick={() => setActiveTab("standards")} style={tabStyle(activeTab === "standards")}>
          {t("standards.title") || "Standards"}
        </button>
        <button onClick={() => { setActiveTab("constraints"); fetchAutomations() }} style={tabStyle(activeTab === "constraints")}>
          {t("trust.constraints") || "Constraints"}
        </button>
        <button onClick={() => { setActiveTab("audit"); fetchAuditLog() }} style={tabStyle(activeTab === "audit")}>
          Audit
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {activeTab === "prd" && renderPrdList()}
        {activeTab === "standards" && <StandardsContent />}
        {activeTab === "constraints" && (
          <div>
            {/* Automation selector */}
            {automationList.length > 0 ? (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, fontWeight: 600 }}>
                  Select automation
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {automationList.map(a => (
                    <button key={a.id} onClick={() => { setSelectedAutoId(a.id); fetchConstraints(a.id) }} style={{
                      padding: "4px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
                      border: selectedAutoId === a.id ? "1.5px solid #37ACC0" : "1px solid var(--glass-border)",
                      background: selectedAutoId === a.id ? "rgba(55,172,192,0.1)" : "transparent",
                      color: selectedAutoId === a.id ? "#37ACC0" : "var(--text-secondary)",
                    }}>
                      {a.name}
                      {a.trustProfile && <span style={{ fontSize: 9, marginLeft: 4, opacity: 0.7 }}>({a.trustProfile})</span>}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "center", padding: 20 }}>
                No automations found
              </div>
            )}

            {/* Constraint list */}
            {constraintsLoading && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Loading...</div>}
            {!constraintsLoading && selectedAutoId && constraints.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "center", padding: 20 }}>
                {t("trust.constraints.empty") || "No constraints"}
              </div>
            )}
            {!constraintsLoading && constraints.map((c, i) => {
              const severityColors: Record<string, string> = { error: "#ef4444", warning: "#f59e0b", info: "#94a3b8" }
              const sourceLabel = t(`trust.constraints.source.${c.source}`) || c.source
              return (
                <div key={i} style={{
                  padding: "8px 10px", borderRadius: 8, marginBottom: 4,
                  border: `1px solid ${severityColors[c.severity] || "#94a3b8"}30`,
                  background: `${severityColors[c.severity] || "#94a3b8"}08`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                      background: `${severityColors[c.severity] || "#94a3b8"}20`,
                      color: severityColors[c.severity] || "#94a3b8",
                      textTransform: "uppercase",
                    }}>{c.severity}</span>
                    <span style={{ fontSize: 9, color: "var(--text-secondary)" }}>[{sourceLabel}]</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>{c.title}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>{c.description}</div>
                </div>
              )
            })}
          </div>
        )}
        {activeTab === "audit" && (
          <div>
            {auditLoading && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Loading...</div>}
            {!auditLoading && auditEntries.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "center", padding: 20 }}>
                No audit entries
              </div>
            )}
            {!auditLoading && auditEntries.map((entry, i) => {
              const actionColors: Record<string, string> = {
                automation_started: "#37ACC0",
                automation_completed: "#22c55e",
                daily_limit_reached: "#f59e0b",
                plan_review_requested: "#37ACC0",
                plan_review_approved: "#22c55e",
                plan_review_denied: "#ef4444",
                plan_review_timeout: "#f59e0b",
                runtime_violation: "#ef4444",
                runtime_halt: "#ef4444",
                trust_profile_changed: "#94a3b8",
                permission_granted: "#22c55e",
                permission_denied: "#ef4444",
              }
              const color = actionColors[entry.action] || "#94a3b8"
              const time = new Date(entry.timestamp)
              const timeStr = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}:${time.getSeconds().toString().padStart(2, "0")}`
              return (
                <div key={i} style={{
                  padding: "6px 10px", borderRadius: 8, marginBottom: 3,
                  border: `1px solid ${color}20`,
                  background: `${color}06`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 3,
                      background: `${color}20`, color,
                      fontFamily: "monospace",
                    }}>{entry.action.replace(/_/g, " ")}</span>
                    <span style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: "monospace" }}>{timeStr}</span>
                    {entry.automationName && (
                      <span style={{ fontSize: 10, color: "var(--text-primary)", fontWeight: 600 }}>{entry.automationName}</span>
                    )}
                  </div>
                  {Object.keys(entry.detail).length > 0 && (
                    <div style={{ fontSize: 9, color: "var(--text-secondary)", marginTop: 2, fontFamily: "monospace" }}>
                      {Object.entries(entry.detail).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})
