import { useState, useEffect, useCallback } from "react"
import { getApiBase } from "../lib/storage"
import { useLocale } from "../lib/i18n/index.js"
import type { Task, TaskStore } from "../types"

const SPRING = "cubic-bezier(0.16, 1, 0.3, 1)"

interface TaskBoardProps {
  open: boolean
  projectId: string
  onClose: () => void
  onStartTask?: (description: string) => void
  send?: (msg: Record<string, unknown>) => boolean
}

export function TaskBoard({ open, projectId, onClose, onStartTask, send }: TaskBoardProps) {
  const { t } = useLocale()
  const [store, setStore] = useState<TaskStore | null>(null)
  const [loading, setLoading] = useState(false)
  const [requirement, setRequirement] = useState("")
  const [processing, setProcessing] = useState(false)
  const [expandedTask, setExpandedTask] = useState<number | null>(null)

  const fetchTasks = useCallback(() => {
    setLoading(true)
    fetch(`${getApiBase()}/api/tasks/${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data) => { if (data) setStore(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => { if (open) fetchTasks() }, [open, fetchTasks])

  useEffect(() => {
    if (!open) return
    history.pushState({ taskBoard: true }, "")
    const handler = () => onClose()
    window.addEventListener("popstate", handler)
    return () => window.removeEventListener("popstate", handler)
  }, [open, onClose])

  const handleClose = useCallback(() => { onClose(); history.back() }, [onClose])

  const handleBreakdown = useCallback(() => {
    if (!requirement.trim() || !send) return
    setProcessing(true)
    const prompt = `Break down this requirement into numbered implementation tasks. Return ONLY a JSON array, no other text. Format: [{"id":1,"title":"...","description":"...","dependsOn":[]}]. Keep tasks atomic and actionable. Requirement:\n\n${requirement.trim()}`
    send({ type: "input", data: prompt })
    setTimeout(() => send({ type: "input", data: "\r" }), 50)
    setTimeout(() => {
      setProcessing(false)
      const newStore: TaskStore = { projectId, requirement: requirement.trim(), tasks: [], createdAt: Date.now(), updatedAt: Date.now() }
      setStore(newStore)
      fetch(`${getApiBase()}/api/tasks/${encodeURIComponent(projectId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newStore),
      }).catch(() => {})
    }, 1000)
  }, [requirement, send, projectId])

  const [showAddTasks, setShowAddTasks] = useState(false)
  const [tasksJson, setTasksJson] = useState("")
  const handleImportTasks = useCallback(() => {
    try {
      const jsonMatch = tasksJson.match(/\[[\s\S]*\]/)
      if (!jsonMatch) throw new Error("No JSON array found")
      const tasks: Task[] = JSON.parse(jsonMatch[0]).map((t: Partial<Task>, i: number) => ({
        id: t.id || i + 1, title: t.title || `Task ${i + 1}`, description: t.description || "",
        status: "pending" as const, dependsOn: t.dependsOn || [],
      }))
      const newStore: TaskStore = { projectId, requirement: store?.requirement || "", tasks, createdAt: store?.createdAt || Date.now(), updatedAt: Date.now() }
      setStore(newStore); setShowAddTasks(false); setTasksJson("")
      fetch(`${getApiBase()}/api/tasks/${encodeURIComponent(projectId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newStore),
      }).catch(() => {})
    } catch { alert("Invalid JSON format. Paste the JSON array from agent output.") }
  }, [tasksJson, projectId, store])

  const toggleStatus = useCallback((taskId: number) => {
    if (!store) return
    const task = store.tasks.find((t) => t.id === taskId)
    if (!task) return
    const next = task.status === "pending" ? "in_progress" : task.status === "in_progress" ? "done" : "pending"
    fetch(`${getApiBase()}/api/tasks/${encodeURIComponent(projectId)}/${taskId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }),
    }).then((r) => r.json()).then(() => {
      setStore((prev) => {
        if (!prev) return prev
        return { ...prev, tasks: prev.tasks.map((t) => t.id === taskId ? { ...t, status: next } : t), updatedAt: Date.now() }
      })
    }).catch(() => {})
  }, [store, projectId])

  const handleStartTask = useCallback((task: Task) => {
    if (onStartTask) onStartTask(task.description || task.title)
    toggleStatus(task.id)
  }, [onStartTask, toggleStatus])

  if (!open) return null

  const statusColors: Record<string, { bg: string; text: string; border: string }> = {
    pending: { bg: "rgba(148,163,184,0.1)", text: "#94a3b8", border: "rgba(148,163,184,0.2)" },
    in_progress: { bg: "rgba(96,165,250,0.1)", text: "#60a5fa", border: "rgba(96,165,250,0.2)" },
    done: { bg: "rgba(34,197,94,0.1)", text: "#22c55e", border: "rgba(34,197,94,0.2)" },
  }

  const hasTasks = store && store.tasks.length > 0
  const doneCount = store?.tasks.filter((t) => t.status === "done").length || 0
  const totalCount = store?.tasks.length || 0

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "var(--bg-gradient)", display: "flex", flexDirection: "column", color: "var(--text-primary)", animation: `fadeSlideUp 0.3s ${SPRING}` }}>
      <div style={{ flexShrink: 0, background: "var(--glass-bg)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderBottom: "1px solid var(--glass-border)", paddingTop: "max(env(safe-area-inset-top), 12px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 10px" }}>
          <button onClick={handleClose} style={{ width: 36, height: 36, borderRadius: 12, border: "1px solid var(--glass-border)", background: "var(--card-bg)", color: "var(--text-primary)", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{"\u2190"}</button>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 600 }}>Tasks</div>
          {hasTasks && (
            <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, background: doneCount === totalCount ? "rgba(34,197,94,0.1)" : "rgba(96,165,250,0.1)", border: `1px solid ${doneCount === totalCount ? "rgba(34,197,94,0.2)" : "rgba(96,165,250,0.2)"}`, color: doneCount === totalCount ? "#22c55e" : "#60a5fa", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
              {doneCount}/{totalCount}
            </span>
          )}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12, WebkitOverflowScrolling: "touch" as never }}>
        {loading && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)", opacity: 0.6 }}>Loading...</div>}
        {!loading && !hasTasks && !showAddTasks && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "20px 0" }}>
            {store?.requirement && (
              <div style={{ padding: 16, borderRadius: 16, background: "var(--glass-bg)", border: "1px solid var(--glass-border)", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", opacity: 0.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Requirement</div>
                {store.requirement}
              </div>
            )}
            <textarea value={requirement} onChange={(e) => setRequirement(e.target.value)} placeholder="Describe what you want to build..." rows={6} style={{ width: "100%", padding: 16, borderRadius: 16, border: "1px solid var(--glass-border)", background: "var(--icon-bg)", color: "var(--text-primary)", fontSize: 14, outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.6 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleBreakdown} disabled={processing || !requirement.trim()} style={{ flex: 1, padding: "14px 20px", borderRadius: 14, border: "none", background: requirement.trim() ? "var(--accent-primary)" : "var(--glass-bg)", color: requirement.trim() ? "#fff" : "var(--text-secondary)", fontSize: 14, fontWeight: 700, cursor: requirement.trim() ? "pointer" : "default", opacity: processing ? 0.5 : 1 }}>
                {processing ? "Sending to Agent..." : "Break Down Tasks"}
              </button>
              {store?.requirement && (
                <button onClick={() => setShowAddTasks(true)} style={{ padding: "14px 16px", borderRadius: 14, border: "1px solid var(--glass-border)", background: "var(--glass-bg)", color: "var(--text-secondary)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Import JSON</button>
              )}
            </div>
          </div>
        )}
        {showAddTasks && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>Paste the JSON task array from the agent's response:</div>
            <textarea value={tasksJson} onChange={(e) => setTasksJson(e.target.value)} placeholder={'[{"id":1,"title":"...","description":"...","dependsOn":[]}]'} rows={8} style={{ width: "100%", padding: 16, borderRadius: 16, border: "1px solid var(--glass-border)", background: "var(--icon-bg)", color: "var(--text-primary)", fontSize: 12, outline: "none", resize: "vertical", fontFamily: "'JetBrains Mono', monospace", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowAddTasks(false)} style={{ flex: 1, padding: 14, borderRadius: 14, border: "1px solid var(--glass-border)", background: "transparent", color: "var(--text-secondary)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleImportTasks} style={{ flex: 1, padding: 14, borderRadius: 14, border: "none", background: "var(--accent-primary)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Import</button>
            </div>
          </div>
        )}
        {hasTasks && !showAddTasks && store.tasks.map((task) => {
          const sc = statusColors[task.status] || statusColors.pending
          const deps = task.dependsOn.filter((d) => d > 0)
          const depsComplete = deps.every((d) => store.tasks.find((t) => t.id === d)?.status === "done")
          const canStart = task.status === "pending" && depsComplete
          const isExpanded = expandedTask === task.id
          return (
            <div key={task.id} style={{ padding: 16, borderRadius: 16, border: `1px solid ${sc.border}`, background: "var(--glass-bg)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: "var(--glass-shadow)", transition: `all 0.2s ${SPRING}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }} onClick={() => setExpandedTask(isExpanded ? null : task.id)}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: sc.bg, border: `1px solid ${sc.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: sc.text, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>#{task.id}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", textDecoration: task.status === "done" ? "line-through" : "none", opacity: task.status === "done" ? 0.6 : 1 }}>{task.title}</div>
                  {deps.length > 0 && <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2, opacity: 0.6 }}>After #{deps.join(", #")}</div>}
                </div>
                <button onClick={(e) => { e.stopPropagation(); toggleStatus(task.id) }} style={{ padding: "4px 10px", borderRadius: 8, background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text, fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0, textTransform: "uppercase" }}>
                  {task.status === "in_progress" ? "WIP" : task.status}
                </button>
              </div>
              {isExpanded && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--glass-border)" }}>
                  {task.description && <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>{task.description}</div>}
                  {canStart && onStartTask && (
                    <button onClick={() => handleStartTask(task)} style={{ width: "100%", padding: "12px", borderRadius: 12, border: "none", background: "var(--accent-primary)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Start This Task</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {hasTasks && !showAddTasks && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setRequirement(store?.requirement || ""); setShowAddTasks(false) }} style={{ flex: 1, padding: "14px", borderRadius: 14, border: "1px dashed var(--text-secondary)", background: "transparent", color: "var(--text-secondary)", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: 0.6 }}>+ Add Requirement</button>
            <button onClick={() => setShowAddTasks(true)} style={{ padding: "14px 16px", borderRadius: 14, border: "1px dashed var(--text-secondary)", background: "transparent", color: "var(--text-secondary)", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: 0.6 }}>Import JSON</button>
          </div>
        )}
      </div>
    </div>
  )
}
