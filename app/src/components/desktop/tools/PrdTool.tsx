import React, { useState, useEffect, useCallback, Suspense } from "react"
import { getApiBase } from "../../../lib/storage"
import type { PrdItem, PrdSummary, PrdPriority, Task } from "../../../types"
import { lazyRetry } from "../../../lib/lazy-retry"

const StandardsContent = lazyRetry(() => import("../../StandardsPage").then(m => ({ default: m.StandardsContent })))

const PRIORITY_LABELS: Record<PrdPriority, { label: string; color: string; bg: string }> = {
  p0: { label: "P0", color: "#FB8184", bg: "rgba(239,68,68,0.12)" },
  p1: { label: "P1", color: "#D09899", bg: "rgba(245,158,11,0.12)" },
  p2: { label: "P2", color: "#37ACC0", bg: "rgba(55,172,192,0.12)" },
  p3: { label: "P3", color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  pending: { bg: "rgba(148,163,184,0.1)", text: "#94a3b8", border: "rgba(148,163,184,0.2)" },
  in_progress: { bg: "rgba(96,165,250,0.1)", text: "#60a5fa", border: "rgba(96,165,250,0.2)" },
  done: { bg: "rgba(34,197,94,0.1)", text: "#BDD1C6", border: "rgba(34,197,94,0.2)" },
  completed: { bg: "rgba(34,197,94,0.1)", text: "#BDD1C6", border: "rgba(34,197,94,0.2)" },
  skipped: { bg: "rgba(148,163,184,0.06)", text: "#64748b", border: "rgba(148,163,184,0.15)" },
}

const isDone = (s: string) => s === "done" || s === "completed"
const isFinished = (s: string) => isDone(s) || s === "skipped"

interface PrdToolProps {
  projectId: string | null
  send: (msg: Record<string, unknown>) => boolean
  theme: "light" | "dark"
  t: (key: string) => string
}

export function PrdTool({ projectId, send, theme, t }: PrdToolProps) {
  const dark = theme === "dark"
  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const border = dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)"
  const cardBg = dark ? "rgba(30,41,59,0.6)" : "rgba(255,255,255,0.8)"

  const [tab, setTab] = useState<"prd" | "tasks" | "standards">("prd")
  const [prdList, setPrdList] = useState<PrdSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedPrdId, setSelectedPrdId] = useState<string | null>(null)
  const [selectedPrd, setSelectedPrd] = useState<PrdItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createGoal, setCreateGoal] = useState("")
  const [createPriority, setCreatePriority] = useState<PrdPriority>("p1")
  const [processing, setProcessing] = useState(false)
  const [prdTaskGroups, setPrdTaskGroups] = useState<{ prdId: string; prdTitle: string; priority: PrdPriority; tasks: Task[] }[]>([])
  const [standaloneTasks, setStandaloneTasks] = useState<Task[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [showAddTask, setShowAddTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState("")
  const [newTaskDesc, setNewTaskDesc] = useState("")
  const [addingTask, setAddingTask] = useState(false)

  const base = getApiBase()

  // --- API ---
  const fetchPrdList = useCallback(() => {
    if (!projectId) return
    setLoading(true)
    fetch(`${base}/api/prd/${encodeURIComponent(projectId)}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setPrdList(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId, base])

  const fetchPrdDetail = useCallback((prdId: string) => {
    if (!projectId) return
    setDetailLoading(true)
    fetch(`${base}/api/prd/${encodeURIComponent(projectId)}/${encodeURIComponent(prdId)}`)
      .then(r => r.json())
      .then(data => { if (data?.id) setSelectedPrd(data) })
      .catch(() => {})
      .finally(() => setDetailLoading(false))
  }, [projectId, base])

  const fetchAllTasks = useCallback(() => {
    if (!projectId) return
    setTasksLoading(true)
    Promise.all([
      fetch(`${base}/api/prd/${encodeURIComponent(projectId)}`).then(r => r.json()).then(async (list: PrdSummary[]) => {
        if (!Array.isArray(list) || list.length === 0) return []
        const details = await Promise.all(
          list.filter(p => p.tasksTotal > 0).map(p =>
            fetch(`${base}/api/prd/${encodeURIComponent(projectId)}/${encodeURIComponent(p.id)}`).then(r => r.json()).catch(() => null)
          )
        )
        return details.filter((d): d is PrdItem => d?.id && d?.tasks?.length > 0).map(d => ({
          prdId: d.id, prdTitle: d.title, priority: d.priority, tasks: d.tasks,
        }))
      }).catch(() => [] as { prdId: string; prdTitle: string; priority: PrdPriority; tasks: Task[] }[]),
      fetch(`${base}/api/tasks/${encodeURIComponent(projectId)}`).then(r => r.json()).then((data: any) => data?.tasks || []).catch(() => []),
    ]).then(([groups, standalone]) => {
      setPrdTaskGroups(groups)
      setStandaloneTasks(standalone)
    }).finally(() => setTasksLoading(false))
  }, [projectId, base])

  const updatePrdField = useCallback((prdId: string, body: Record<string, unknown>) => {
    if (!projectId) return
    fetch(`${base}/api/prd/${encodeURIComponent(projectId)}/${encodeURIComponent(prdId)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(r => r.json()).then(data => {
      if (data?.id) setSelectedPrd(data)
      fetchPrdList()
    }).catch(() => {})
  }, [projectId, base, fetchPrdList])

  const updateTaskStatus = useCallback((prdId: string, taskId: number, status: string) => {
    if (!projectId) return
    fetch(`${base}/api/prd/${encodeURIComponent(projectId)}/${encodeURIComponent(prdId)}/tasks/${taskId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(r => r.json()).then(data => {
      if (data?.prdAutoCompleted) {
        fetchPrdDetail(prdId); fetchPrdList(); fetchAllTasks()
      } else if (data?.task) {
        if (selectedPrd) {
          setSelectedPrd(prev => prev ? { ...prev, tasks: prev.tasks.map(t => t.id === taskId ? { ...t, status: data.task.status } : t) } : prev)
        }
        setPrdTaskGroups(prev => prev.map(g =>
          g.prdId === prdId ? { ...g, tasks: g.tasks.map(t => t.id === taskId ? { ...t, status: data.task.status } : t) } : g
        ))
        fetchPrdList()
      }
    }).catch(() => {})
  }, [projectId, base, selectedPrd, fetchPrdDetail, fetchPrdList, fetchAllTasks])

  const updateStandaloneTask = useCallback((taskId: number, body: Record<string, unknown>) => {
    if (!projectId) return
    fetch(`${base}/api/tasks/${encodeURIComponent(projectId)}/${taskId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(() => fetchAllTasks()).catch(() => {})
  }, [projectId, base, fetchAllTasks])

  const handleAddStandaloneTask = useCallback(() => {
    if (!projectId || !newTaskTitle.trim()) return
    setAddingTask(true)
    const newTask: Task = {
      id: Date.now(),
      title: newTaskTitle.trim(),
      description: newTaskDesc.trim(),
      status: "pending",
      dependsOn: [],
    }
    const updatedTasks = [...standaloneTasks, newTask]
    fetch(`${base}/api/tasks/${encodeURIComponent(projectId)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: updatedTasks }),
    }).then(() => {
      setNewTaskTitle("")
      setNewTaskDesc("")
      setShowAddTask(false)
      fetchAllTasks()
    }).catch(() => {}).finally(() => setAddingTask(false))
  }, [projectId, base, newTaskTitle, newTaskDesc, standaloneTasks, fetchAllTasks])

  const handleCreatePrd = useCallback(() => {
    if (!createGoal.trim() || !send) return
    setProcessing(true)
    const prompt = `I want to build: ${createGoal.trim()}\n\nPlease create a PRD for this. Ask me clarifying questions one at a time to refine the requirements, then generate a structured plan with tasks. Set priority to ${createPriority}.`
    send({ type: "input", data: prompt })
    setTimeout(() => send({ type: "input", data: "\r" }), 500)
    setTimeout(() => { setProcessing(false); setShowCreate(false); setCreateGoal(""); fetchPrdList() }, 3000)
  }, [createGoal, createPriority, send, fetchPrdList])

  // --- Effects ---
  useEffect(() => { fetchPrdList(); fetchAllTasks() }, [fetchPrdList, fetchAllTasks])
  useEffect(() => {
    const handler = () => { if (!document.hidden) { fetchPrdList(); fetchAllTasks() } }
    document.addEventListener("visibilitychange", handler)
    return () => document.removeEventListener("visibilitychange", handler)
  }, [fetchPrdList, fetchAllTasks])
  useEffect(() => {
    const handler = () => fetchAllTasks()
    window.addEventListener("tasks_changed", handler)
    return () => window.removeEventListener("tasks_changed", handler)
  }, [fetchAllTasks])
  useEffect(() => {
    const handler = () => { fetchPrdList(); if (selectedPrd) fetchPrdDetail(selectedPrd.id) }
    window.addEventListener("prd_changed", handler)
    return () => window.removeEventListener("prd_changed", handler)
  }, [fetchPrdList, fetchPrdDetail, selectedPrd])

  // --- Helpers ---
  const toggleTaskStatus = (prdId: string, task: Task) => {
    const cycle: Record<string, string> = { pending: "in_progress", in_progress: "done", done: "pending", skipped: "pending" }
    updateTaskStatus(prdId, task.id, cycle[task.status] || "pending")
  }

  if (!projectId) {
    return (
      <div style={{ fontSize: 13, color: textSecondary, textAlign: "center", padding: 40 }}>
        {t("prd.selectProject") || "Select a project to view PRD"}
      </div>
    )
  }

  const PriorityBadge = ({ p, onClick }: { p: PrdPriority; onClick?: () => void }) => {
    const info = PRIORITY_LABELS[p] || PRIORITY_LABELS.p1
    return (
      <button onClick={e => { e.stopPropagation(); onClick?.() }}
        style={{ padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 800, background: info.bg, color: info.color, border: "none", cursor: onClick ? "pointer" : "default", letterSpacing: 0.5, fontFamily: "'JetBrains Mono', monospace" }}>
        {info.label}
      </button>
    )
  }

  // --- Render ---
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Tab bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 2, padding: "0 0 12px",
        borderBottom: `1px solid ${border}`, flexShrink: 0,
      }}>
        {(["prd", "tasks", "standards"] as const).map(key => {
          const labels: Record<string, string> = {
            prd: t("prd.tabTitle") || "PRD",
            tasks: t("tasks.tabTitle") || "Tasks",
            standards: t("standards.title") || "Standards",
          }
          const active = tab === key
          const counts: Record<string, string> = {
            prd: prdList.filter(p => p.status === "active").length > 0 ? ` (${prdList.filter(p => p.status === "active").length})` : "",
            tasks: (() => {
              const allT = [...prdTaskGroups.flatMap(g => g.tasks), ...standaloneTasks]
              const pending = allT.filter(tk => tk.status !== "done" && tk.status !== "skipped").length
              return pending > 0 ? ` (${pending})` : ""
            })(),
            standards: "",
          }
          return (
            <button key={key} onClick={() => setTab(key)}
              style={{
                padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: active ? (dark ? "rgba(55,172,192,0.12)" : "rgba(55,172,192,0.08)") : "transparent",
                color: active ? "#37ACC0" : textSecondary,
                border: active ? "1px solid rgba(55,172,192,0.25)" : "1px solid transparent",
                cursor: "pointer", fontFamily: "inherit",
              }}>
              {labels[key]}{counts[key]}
            </button>
          )
        })}
        <div style={{ flex: 1 }} />
        <button onClick={() => { fetchPrdList(); fetchAllTasks() }}
          style={{
            padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: "transparent", color: textSecondary, border: `1px solid ${border}`,
            cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4,
          }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", marginTop: 1 }}>
        {tab === "prd" && (
          <>
            {/* Sidebar: PRD list */}
            <div style={{
              width: 280, flexShrink: 0, borderRight: `1px solid ${border}`,
              display: "flex", flexDirection: "column", overflow: "hidden",
            }}>
              <div style={{ padding: "12px 12px 8px", flexShrink: 0 }}>
                <button onClick={() => { setShowCreate(true); setSelectedPrdId(null); setSelectedPrd(null) }}
                  style={{
                    width: "100%", padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 700,
                    background: "linear-gradient(135deg, #37ACC0, #347792)", color: "#fff",
                    border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(55,172,192,0.2)",
                  }}>
                  + {t("prd.newPlan") || "New Plan"}
                </button>
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: "0 12px 12px" }}>
                {loading ? (
                  <div style={{ fontSize: 12, color: textSecondary, textAlign: "center", padding: 20 }}>Loading...</div>
                ) : prdList.length === 0 ? (
                  <div style={{ fontSize: 12, color: textSecondary, textAlign: "center", padding: 20, opacity: 0.5 }}>
                    No PRDs yet
                  </div>
                ) : (
                  prdList.map(prd => {
                    const progress = prd.tasksTotal > 0 ? ((prd.tasksDone + (prd.tasksSkipped || 0)) / prd.tasksTotal) * 100 : 0
                    const done = isDone(prd.status)
                    const selected = selectedPrdId === prd.id && !showCreate
                    return (
                      <div key={prd.id} onClick={() => { setSelectedPrdId(prd.id); fetchPrdDetail(prd.id); setShowCreate(false) }}
                        style={{
                          padding: "10px 12px", borderRadius: 8, cursor: "pointer", marginBottom: 6,
                          background: selected ? (dark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.06)") : "transparent",
                          border: `1px solid ${selected ? "rgba(55,172,192,0.25)" : "transparent"}`,
                          opacity: done ? 0.6 : 1, transition: "all 0.15s ease",
                        }}
                        onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = dark ? "rgba(30,41,59,0.5)" : "rgba(241,245,249,0.8)" }}
                        onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = "transparent" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <PriorityBadge p={prd.priority} />
                          <div style={{
                            flex: 1, fontSize: 12, fontWeight: 600, color: textPrimary,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            textDecoration: done ? "line-through" : "none",
                          }}>
                            {prd.title}
                          </div>
                        </div>
                        {prd.tasksTotal > 0 && (
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                              <span style={{ fontSize: 10, color: textSecondary, opacity: 0.6 }}>{prd.tasksDone}/{prd.tasksTotal}</span>
                              <span style={{ fontSize: 10, color: textSecondary, opacity: 0.4, fontFamily: "'JetBrains Mono', monospace" }}>{Math.round(progress)}%</span>
                            </div>
                            <div style={{ height: 3, borderRadius: 2, background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
                              <div style={{ height: "100%", borderRadius: 2, width: `${progress}%`, background: done ? "#BDD1C6" : "linear-gradient(90deg, #37ACC0, #347792)", transition: "width 0.3s ease" }} />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Main: Detail */}
            <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
              {showCreate ? renderCreateForm() : selectedPrd ? renderDetail() : renderEmptyState()}
            </div>
          </>
        )}

        {tab === "tasks" && (
          <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
            {renderTasksTab()}
          </div>
        )}

        {tab === "standards" && (
          <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
            <Suspense fallback={<div style={{ fontSize: 12, color: textSecondary, textAlign: "center", padding: 40 }}>Loading...</div>}>
              <StandardsContent />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  )

  // --- Sub-renderers ---

  function renderEmptyState() {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", opacity: 0.6 }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={textSecondary} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16 }}>
          <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
        </svg>
        <div style={{ fontSize: 15, fontWeight: 600, color: textPrimary, marginBottom: 6 }}>
          {prdList.length === 0 ? (t("prd.onboardTitle") || "Plan before you build") : "Select a PRD"}
        </div>
        <div style={{ fontSize: 12, color: textSecondary, maxWidth: 300, textAlign: "center", lineHeight: 1.5 }}>
          {prdList.length === 0
            ? (t("prd.onboardDesc") || "Describe your idea in one sentence. The agent will ask questions, then generate a full plan with tasks.")
            : "Choose a PRD from the list, or create a new one"
          }
        </div>
      </div>
    )
  }

  function renderCreateForm() {
    return (
      <div style={{ maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <button onClick={() => setShowCreate(false)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: textSecondary, display: "flex" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: textPrimary, margin: 0 }}>
            {t("prd.newPlan") || "New Plan"}
          </h3>
        </div>
        <div style={{ fontSize: 12, color: textSecondary, marginBottom: 12, lineHeight: 1.5 }}>
          {t("prd.inputHint") || "Describe what you want to build. The agent will ask follow-up questions."}
        </div>
        <textarea value={createGoal} onChange={e => setCreateGoal(e.target.value)}
          placeholder={t("prd.inputPlaceholder") || 'e.g. "Add a dark mode toggle to settings"'}
          rows={3} autoFocus
          style={{
            width: "100%", padding: 12, borderRadius: 8, fontSize: 13,
            border: `1px solid ${dark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.15)"}`,
            background: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
            color: textPrimary, resize: "vertical", outline: "none", fontFamily: "inherit", lineHeight: 1.5,
            boxSizing: "border-box",
          }} />
        <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: textSecondary, opacity: 0.6, fontWeight: 600 }}>Priority:</span>
          {(["p0", "p1", "p2", "p3"] as PrdPriority[]).map(p => {
            const info = PRIORITY_LABELS[p]
            return (
              <button key={p} onClick={() => setCreatePriority(p)}
                style={{
                  padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700,
                  background: createPriority === p ? info.bg : "transparent",
                  color: createPriority === p ? info.color : textSecondary,
                  border: `1px solid ${createPriority === p ? info.color + "40" : "transparent"}`,
                  cursor: "pointer", fontFamily: "'JetBrains Mono', monospace",
                  opacity: createPriority === p ? 1 : 0.5,
                }}>
                {info.label}
              </button>
            )
          })}
        </div>
        <button onClick={handleCreatePrd} disabled={!createGoal.trim() || processing}
          style={{
            marginTop: 16, padding: "10px 24px", borderRadius: 8, fontSize: 13, fontWeight: 700,
            background: "linear-gradient(135deg, #37ACC0, #347792)", color: "#fff",
            border: "none", cursor: "pointer", opacity: (!createGoal.trim() || processing) ? 0.4 : 1,
          }}>
          {processing ? "..." : (t("prd.startPlanning") || "Start Planning")}
        </button>
      </div>
    )
  }

  function renderDetail() {
    if (detailLoading || !selectedPrd) {
      return <div style={{ fontSize: 12, color: textSecondary, textAlign: "center", padding: 40 }}>Loading...</div>
    }
    const prd = selectedPrd
    const tasks = prd.tasks
    const doneCount = tasks.filter(tk => isDone(tk.status)).length
    const totalCount = tasks.length
    const skippedCount = tasks.filter(tk => tk.status === "skipped").length

    const sectionStyle: React.CSSProperties = {
      padding: "14px 16px", borderRadius: 10, marginBottom: 12,
      background: dark ? "rgba(55,172,192,0.04)" : "rgba(55,172,192,0.03)",
      border: `1px solid ${dark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.08)"}`,
    }
    const labelStyle: React.CSSProperties = {
      fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1,
      color: "#37ACC0", marginBottom: 8, opacity: 0.8,
    }

    const cyclePriority = () => {
      const cycle: PrdPriority[] = ["p0", "p1", "p2", "p3"]
      const next = cycle[(cycle.indexOf(prd.priority) + 1) % cycle.length]
      updatePrdField(prd.id, { priority: next })
    }

    return (
      <div style={{ maxWidth: 720 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <PriorityBadge p={prd.priority} onClick={cyclePriority} />
          <h3 style={{ flex: 1, fontSize: 18, fontWeight: 700, color: textPrimary, margin: 0 }}>
            {prd.title}
          </h3>
          {isDone(prd.status) ? (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 5, background: "rgba(34,197,94,0.12)", color: "#BDD1C6" }}>DONE</span>
          ) : (
            <button onClick={() => updatePrdField(prd.id, { status: "done" })}
              style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 5, background: "transparent", color: textSecondary, border: `1px solid ${border}`, cursor: "pointer", fontFamily: "inherit" }}>
              Mark Done
            </button>
          )}
        </div>

        {/* Progress */}
        {totalCount > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: textSecondary }}>{t("prd.progress") || "Progress"}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: doneCount === totalCount ? "#BDD1C6" : "#37ACC0", fontFamily: "'JetBrains Mono', monospace" }}>
                {doneCount}/{totalCount}{skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}
              </span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }}>
              <div style={{
                height: "100%", borderRadius: 3,
                width: `${totalCount > 0 ? ((doneCount + skippedCount) / totalCount) * 100 : 0}%`,
                background: (doneCount + skippedCount) === totalCount ? "#BDD1C6" : "linear-gradient(90deg, #37ACC0, #347792)",
                transition: "width 0.3s ease",
              }} />
            </div>
          </div>
        )}

        {/* Goal */}
        {prd.goal && (
          <div style={sectionStyle}>
            <div style={labelStyle}>{t("prd.goal") || "Goal"}</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: textPrimary }}>{prd.goal}</div>
          </div>
        )}

        {/* Decisions */}
        {prd.decisions.length > 0 && (
          <div style={sectionStyle}>
            <div style={labelStyle}>{t("prd.decisions") || "Decisions"}</div>
            {prd.decisions.map((d: any, i: number) => (
              <div key={i} style={{
                padding: "8px 10px", borderRadius: 6, marginBottom: 6,
                background: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)",
                border: `1px solid ${dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"}`,
              }}>
                {typeof d === "string" ? (
                  <div style={{ fontSize: 12, color: textPrimary, lineHeight: 1.5 }}>{d}</div>
                ) : (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: textSecondary, marginBottom: 3 }}>Q: {d.question}</div>
                    <div style={{ fontSize: 12, color: textPrimary, lineHeight: 1.5 }}>A: {d.answer}</div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Approaches */}
        {prd.approaches.length > 0 && (
          <div style={sectionStyle}>
            <div style={labelStyle}>{t("prd.approaches") || "Approaches"}</div>
            {prd.approaches.map((a: any, i: number) => {
              if (typeof a === "string") return (
                <div key={i} style={{ padding: "8px 10px", borderRadius: 6, marginBottom: 6, fontSize: 12, color: textPrimary, lineHeight: 1.5, background: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)", border: `1px solid ${dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"}` }}>{a}</div>
              )
              return (
                <div key={i} style={{
                  padding: "10px 12px", borderRadius: 8, marginBottom: 6,
                  background: a.adopted ? (dark ? "rgba(55,172,192,0.06)" : "rgba(55,172,192,0.04)") : (dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)"),
                  border: `1px solid ${a.adopted ? "rgba(55,172,192,0.2)" : dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: textPrimary }}>{a.name}</span>
                    {a.adopted && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "rgba(55,172,192,0.15)", color: "#37ACC0", textTransform: "uppercase" }}>Adopted</span>}
                  </div>
                  {(a.pros || []).map((p: string, j: number) => (
                    <div key={`p${j}`} style={{ fontSize: 12, color: "#BDD1C6", lineHeight: 1.5, display: "flex", gap: 4 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ flexShrink: 0, marginTop: 3 }}><polyline points="20 6 9 17 4 12" /></svg>
                      <span>{p}</span>
                    </div>
                  ))}
                  {(a.cons || []).map((c: string, j: number) => (
                    <div key={`c${j}`} style={{ fontSize: 12, color: dark ? "#f87171" : "#dc2626", lineHeight: 1.5, display: "flex", gap: 4 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ flexShrink: 0, marginTop: 3 }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      <span>{c}</span>
                    </div>
                  ))}
                  {a.techNote && <div style={{ marginTop: 4, fontSize: 11, color: textSecondary, opacity: 0.6, fontStyle: "italic" }}>Tech: {a.techNote}</div>}
                </div>
              )
            })}
          </div>
        )}

        {/* Scope */}
        {prd.scope && ((prd.scope.included?.length || 0) > 0 || (prd.scope.excluded?.length || 0) > 0) && (
          <div style={sectionStyle}>
            <div style={labelStyle}>{t("prd.scope") || "Scope"}</div>
            {(prd.scope.included || []).map((item: string, i: number) => (
              <div key={`in${i}`} style={{ fontSize: 12, color: "#BDD1C6", lineHeight: 1.7, display: "flex", gap: 5 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ flexShrink: 0, marginTop: 4 }}><polyline points="20 6 9 17 4 12" /></svg>
                <span>{item}</span>
              </div>
            ))}
            {(prd.scope.excluded || []).map((item: string, i: number) => (
              <div key={`ex${i}`} style={{ fontSize: 12, color: textSecondary, opacity: 0.5, lineHeight: 1.7, display: "flex", gap: 5 }}>
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
            const isFirst = idx === tasks.findIndex(tk => tk.status === "pending") && task.status === "pending"
            return (
              <div key={task.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                borderBottom: idx < tasks.length - 1 ? `1px solid ${dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"}` : "none",
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 6,
                  background: isFirst ? "rgba(55,172,192,0.15)" : sc.bg,
                  border: `1px solid ${isFirst ? "rgba(55,172,192,0.3)" : sc.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, color: isFirst ? "#37ACC0" : sc.text,
                  fontFamily: "'JetBrains Mono', monospace", flexShrink: 0,
                }}>
                  {idx + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: textPrimary,
                    textDecoration: isFinished(task.status) ? "line-through" : "none",
                    opacity: isFinished(task.status) ? 0.5 : 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {task.title}
                  </div>
                  {isFirst && <div style={{ fontSize: 9, fontWeight: 700, color: "#37ACC0", marginTop: 1, textTransform: "uppercase", letterSpacing: 1 }}>NEXT</div>}
                </div>
                {task.priority && <PriorityBadge p={task.priority} />}
                <button onClick={() => toggleTaskStatus(prd.id, task)}
                  style={{
                    padding: "3px 8px", borderRadius: 5, background: sc.bg,
                    border: `1px solid ${sc.border}`, color: sc.text,
                    fontSize: 9, fontWeight: 700, cursor: "pointer", flexShrink: 0,
                    textTransform: "uppercase", fontFamily: "inherit",
                  }}>
                  {task.status === "in_progress" ? "WIP" : task.status === "skipped" ? "SKIP" : task.status}
                </button>
                {task.status !== "skipped" && !isDone(task.status) && (
                  <button onClick={() => updateTaskStatus(prd.id, task.id, "skipped")}
                    style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: textSecondary, opacity: 0.3, display: "flex" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
              </div>
            )
          })}
          {tasks.length === 0 && (
            <div style={{ fontSize: 12, color: textSecondary, opacity: 0.5, textAlign: "center", padding: 8 }}>No tasks yet</div>
          )}
        </div>
      </div>
    )
  }

  function renderTasksTab() {
    if (tasksLoading) return <div style={{ fontSize: 12, color: textSecondary, textAlign: "center", padding: 40 }}>Loading...</div>
    if (prdTaskGroups.length === 0 && standaloneTasks.length === 0) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 40 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={textSecondary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
            <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
          <div style={{ fontSize: 14, fontWeight: 600, color: textPrimary }}>{t("tasks.emptyTitle") || "No tasks yet"}</div>
          <div style={{ fontSize: 12, color: textSecondary, opacity: 0.6 }}>{t("tasks.emptyDesc") || "Create a PRD to generate tasks"}</div>
        </div>
      )
    }

    return (
      <div style={{ display: "grid", gridTemplateColumns: prdTaskGroups.length > 1 ? "1fr 1fr" : "1fr", gap: 12, maxWidth: 900 }}>
        {prdTaskGroups.map(group => {
          const doneCount = group.tasks.filter(tk => isDone(tk.status)).length
          return (
            <div key={group.prdId} style={{
              borderRadius: 10, overflow: "hidden",
              background: cardBg, border: `1px solid ${border}`,
            }}>
              <div style={{
                padding: "8px 14px", display: "flex", alignItems: "center", gap: 6,
                background: dark ? "rgba(30,41,59,0.4)" : "rgba(241,245,249,0.6)",
                borderBottom: `1px solid ${border}`,
              }}>
                <PriorityBadge p={group.priority} />
                <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {group.prdTitle}
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: doneCount === group.tasks.length ? "#BDD1C6" : textSecondary, fontFamily: "'JetBrains Mono', monospace" }}>
                  {doneCount}/{group.tasks.length}
                </span>
              </div>
              {group.tasks.map((task, idx) => {
                const sc = STATUS_COLORS[task.status] || STATUS_COLORS.pending
                return (
                  <div key={task.id} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "7px 14px",
                    borderTop: idx > 0 ? `1px solid ${dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"}` : "none",
                  }}>
                    <button onClick={() => toggleTaskStatus(group.prdId, task)}
                      style={{
                        width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                        background: sc.bg, border: `1px solid ${sc.border}`,
                        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                      }}>
                      {isDone(task.status) && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={sc.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      )}
                      {task.status === "in_progress" && (
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: sc.text }} />
                      )}
                    </button>
                    <span style={{
                      flex: 1, fontSize: 12, color: textPrimary,
                      textDecoration: isFinished(task.status) ? "line-through" : "none",
                      opacity: isFinished(task.status) ? 0.5 : 1,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {task.title}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}

        <div style={{
          borderRadius: 10, overflow: "hidden",
          background: cardBg, border: `1px solid ${border}`,
        }}>
          <div style={{
            padding: "8px 14px", display: "flex", alignItems: "center", gap: 8,
            background: dark ? "rgba(30,41,59,0.4)" : "rgba(241,245,249,0.6)",
            borderBottom: `1px solid ${border}`,
          }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: textSecondary }}>
              {t("tasks.manual") || "Standalone Tasks"}
            </span>
            <button onClick={() => setShowAddTask(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                background: showAddTask ? "rgba(55,172,192,0.12)" : "transparent",
                color: showAddTask ? "#37ACC0" : textSecondary,
                border: `1px solid ${showAddTask ? "rgba(55,172,192,0.25)" : border}`,
                cursor: "pointer", fontFamily: "inherit",
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t("tasks.addQuick") || "Add Task"}
            </button>
          </div>

          {/* Inline add-task form */}
          {showAddTask && (
            <div style={{
              padding: "12px 14px",
              background: dark ? "rgba(55,172,192,0.04)" : "rgba(55,172,192,0.03)",
              borderBottom: `1px solid ${dark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.08)"}`,
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}>
              <input
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                placeholder={t("tasks.titlePlaceholder") || "Task title"}
                autoFocus
                onKeyDown={e => { if (e.key === "Enter" && newTaskTitle.trim()) handleAddStandaloneTask(); if (e.key === "Escape") { setShowAddTask(false); setNewTaskTitle(""); setNewTaskDesc("") } }}
                style={{
                  width: "100%", padding: "8px 10px", borderRadius: 6, fontSize: 12,
                  border: `1px solid ${dark ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.15)"}`,
                  background: dark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.7)",
                  color: textPrimary, outline: "none", fontFamily: "inherit",
                  boxSizing: "border-box",
                }}
              />
              <textarea
                value={newTaskDesc}
                onChange={e => setNewTaskDesc(e.target.value)}
                placeholder={t("tasks.descPlaceholder") || "Description (optional)"}
                rows={2}
                onKeyDown={e => { if (e.key === "Escape") { setShowAddTask(false); setNewTaskTitle(""); setNewTaskDesc("") } }}
                style={{
                  width: "100%", padding: "8px 10px", borderRadius: 6, fontSize: 12,
                  border: `1px solid ${dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.15)"}`,
                  background: dark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.5)",
                  color: textPrimary, outline: "none", fontFamily: "inherit",
                  resize: "vertical", marginTop: 6, lineHeight: 1.5,
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
                <button onClick={() => { setShowAddTask(false); setNewTaskTitle(""); setNewTaskDesc("") }}
                  style={{
                    padding: "5px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: "transparent", color: textSecondary,
                    border: `1px solid ${border}`, cursor: "pointer", fontFamily: "inherit",
                  }}>
                  {t("tasks.cancel") || "Cancel"}
                </button>
                <button onClick={handleAddStandaloneTask}
                  disabled={!newTaskTitle.trim() || addingTask}
                  style={{
                    padding: "5px 14px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: "linear-gradient(135deg, #37ACC0, #347792)", color: "#fff",
                    border: "none", cursor: "pointer", fontFamily: "inherit",
                    opacity: (!newTaskTitle.trim() || addingTask) ? 0.4 : 1,
                  }}>
                  {addingTask ? "..." : (t("tasks.add") || "Add")}
                </button>
              </div>
            </div>
          )}

          {standaloneTasks.map((task, idx) => {
            const sc = STATUS_COLORS[task.status] || STATUS_COLORS.pending
            return (
              <div key={task.id} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "7px 14px",
                borderTop: idx > 0 ? `1px solid ${dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)"}` : "none",
              }}>
                <button onClick={() => {
                  const cycle: Record<string, string> = { pending: "in_progress", in_progress: "done", done: "pending", skipped: "pending" }
                  updateStandaloneTask(task.id, { status: cycle[task.status] || "pending" })
                }}
                  style={{
                    width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                    background: sc.bg, border: `1px solid ${sc.border}`,
                    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                  }}>
                  {isDone(task.status) && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={sc.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </button>
                <span style={{
                  flex: 1, fontSize: 12, color: textPrimary,
                  textDecoration: isFinished(task.status) ? "line-through" : "none",
                  opacity: isFinished(task.status) ? 0.5 : 1,
                }}>
                  {task.title}
                </span>
              </div>
            )
          })}

          {standaloneTasks.length === 0 && !showAddTask && (
            <div style={{ padding: "16px 14px", fontSize: 12, color: textSecondary, opacity: 0.5, textAlign: "center" }}>
              {t("tasks.emptyDesc") || "No standalone tasks yet"}
            </div>
          )}
        </div>
      </div>
    )
  }
}
