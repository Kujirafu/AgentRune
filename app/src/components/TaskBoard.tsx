// web/components/TaskBoard.tsx
import { useState, useEffect, useCallback, useRef } from "react"
import { getApiBase } from "../lib/storage"
import { useLocale } from "../lib/i18n/index.js"
import type { Task, TaskStore } from "../types"
import { SpringOverlay } from "./SpringOverlay"
import { StandardsContent } from "./StandardsPage"

const SPRING = "cubic-bezier(0.16, 1, 0.3, 1)"

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  pending: { bg: "rgba(148,163,184,0.1)", text: "#94a3b8", border: "rgba(148,163,184,0.2)" },
  in_progress: { bg: "rgba(96,165,250,0.1)", text: "#60a5fa", border: "rgba(96,165,250,0.2)" },
  done: { bg: "rgba(34,197,94,0.1)", text: "#22c55e", border: "rgba(34,197,94,0.2)" },
}

interface TaskBoardProps {
  open: boolean
  projectId: string
  onClose: () => void
  onStartTask?: (description: string) => void
  send?: (msg: Record<string, unknown>) => boolean
}

export function TaskBoard({ open, projectId, onClose, onStartTask, send }: TaskBoardProps) {
  const { t } = useLocale()
  const [activeTab, setActiveTab] = useState<"tasks" | "standards">("tasks")
  const [store, setStore] = useState<TaskStore | null>(null)
  const [loading, setLoading] = useState(false)
  const [requirement, setRequirement] = useState("")
  const [processing, setProcessing] = useState(false)
  const [expandedTask, setExpandedTask] = useState<number | null>(null)

  // Drag state for touch reorder
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const dragStartY = useRef(0)
  const dragCurrentY = useRef(0)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dragOffset, setDragOffset] = useState(0)

  const fetchTasks = useCallback(() => {
    setLoading(true)
    fetch(`${getApiBase()}/api/tasks/${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data) => { if (data) setStore(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    if (open) fetchTasks()
  }, [open, fetchTasks])

  // Hardware back via app:back
  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => { e.preventDefault(); onClose() }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [open, onClose])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  // Save store to server
  const saveStore = useCallback((newStore: TaskStore) => {
    setStore(newStore)
    fetch(`${getApiBase()}/api/tasks/${encodeURIComponent(projectId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newStore),
    }).catch(() => {})
  }, [projectId])

  // AI task breakdown
  const handleBreakdown = useCallback(() => {
    if (!requirement.trim() || !send) return
    setProcessing(true)
    const prompt = `Break down this requirement into numbered implementation tasks. Return ONLY a JSON array, no other text. Format: [{"id":1,"title":"...","description":"...","dependsOn":[]}]. Keep tasks atomic and actionable. Requirement:\n\n${requirement.trim()}`
    send({ type: "input", data: prompt })
    setTimeout(() => send({ type: "input", data: "\r" }), 50)
    setTimeout(() => {
      setProcessing(false)
      const newStore: TaskStore = {
        projectId,
        requirement: requirement.trim(),
        tasks: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      saveStore(newStore)
    }, 1000)
  }, [requirement, send, projectId, saveStore])

  // Add tasks from agent response (user pastes JSON)
  const [showAddTasks, setShowAddTasks] = useState(false)
  const [tasksJson, setTasksJson] = useState("")
  const handleImportTasks = useCallback(() => {
    try {
      const jsonMatch = tasksJson.match(/\[[\s\S]*\]/)
      if (!jsonMatch) throw new Error("No JSON array found")
      const tasks: Task[] = JSON.parse(jsonMatch[0]).map((t: Partial<Task>, i: number) => ({
        id: t.id || i + 1,
        title: t.title || `Task ${i + 1}`,
        description: t.description || "",
        status: "pending" as const,
        dependsOn: t.dependsOn || [],
      }))
      const newStore: TaskStore = {
        projectId,
        requirement: store?.requirement || "",
        tasks,
        createdAt: store?.createdAt || Date.now(),
        updatedAt: Date.now(),
      }
      saveStore(newStore)
      setShowAddTasks(false)
      setTasksJson("")
    } catch {
      alert("Invalid JSON format. Paste the JSON array from agent output.")
    }
  }, [tasksJson, projectId, store, saveStore])

  // Toggle task status
  const toggleStatus = useCallback((taskId: number) => {
    if (!store) return
    const task = store.tasks.find((t) => t.id === taskId)
    if (!task) return
    const next = task.status === "pending" ? "in_progress" : task.status === "in_progress" ? "done" : "pending"
    fetch(`${getApiBase()}/api/tasks/${encodeURIComponent(projectId)}/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    })
      .then((r) => r.json())
      .then(() => {
        setStore((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            tasks: prev.tasks.map((t) => t.id === taskId ? { ...t, status: next } : t),
            updatedAt: Date.now(),
          }
        })
      })
      .catch(() => {})
  }, [store, projectId])

  // Delete task
  const deleteTask = useCallback((taskId: number) => {
    if (!store) return
    const newStore: TaskStore = {
      ...store,
      tasks: store.tasks.filter((t) => t.id !== taskId),
      updatedAt: Date.now(),
    }
    saveStore(newStore)
  }, [store, saveStore])

  // Move task up/down (reorder)
  const moveTask = useCallback((idx: number, direction: -1 | 1) => {
    if (!store) return
    const tasks = [...store.tasks]
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= tasks.length) return
    ;[tasks[idx], tasks[newIdx]] = [tasks[newIdx], tasks[idx]]
    const newStore: TaskStore = { ...store, tasks, updatedAt: Date.now() }
    saveStore(newStore)
  }, [store, saveStore])

  // Touch drag handlers for reorder
  const handleDragStart = useCallback((idx: number, y: number) => {
    setDragIdx(idx)
    dragStartY.current = y
    dragCurrentY.current = y
    setDragOffset(0)
  }, [])

  const handleDragMove = useCallback((y: number) => {
    if (dragIdx === null) return
    dragCurrentY.current = y
    setDragOffset(y - dragStartY.current)
  }, [dragIdx])

  const handleDragEnd = useCallback(() => {
    if (dragIdx === null || !store) { setDragIdx(null); setDragOffset(0); return }
    // Calculate how many rows to move based on offset
    const rowHeight = 72 // approximate task row height
    const steps = Math.round(dragOffset / rowHeight)
    if (steps !== 0) {
      const tasks = [...store.tasks]
      const newIdx = Math.max(0, Math.min(tasks.length - 1, dragIdx + steps))
      if (newIdx !== dragIdx) {
        const [moved] = tasks.splice(dragIdx, 1)
        tasks.splice(newIdx, 0, moved)
        const newStore: TaskStore = { ...store, tasks, updatedAt: Date.now() }
        saveStore(newStore)
      }
    }
    setDragIdx(null)
    setDragOffset(0)
  }, [dragIdx, dragOffset, store, saveStore])

  // Start a task
  const handleStartTask = useCallback((task: Task) => {
    if (onStartTask) onStartTask(task.description || task.title)
    toggleStatus(task.id)
  }, [onStartTask, toggleStatus])

  const statusColors = STATUS_COLORS

  const hasTasks = store && store.tasks.length > 0
  const doneCount = store?.tasks.filter((t) => t.status === "done").length || 0
  const totalCount = store?.tasks.length || 0

  return (
    <SpringOverlay open={open}>
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      background: "var(--bg-gradient)",
      display: "flex", flexDirection: "column",
      color: "var(--text-primary)",
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, background: "var(--glass-bg)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--glass-border)",
        paddingTop: "max(env(safe-area-inset-top), 12px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 10px" }}>
          <button onClick={handleClose}
            style={{ width: 36, height: 36, borderRadius: 12, border: "1px solid var(--glass-border)", background: "var(--card-bg)", color: "var(--text-primary)", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 600 }}>
            {activeTab === "tasks" ? "Tasks" : (t("standards.title") || "Standards")}
          </div>
          {activeTab === "tasks" && hasTasks && (
            <span style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 20,
              background: doneCount === totalCount ? "rgba(34,197,94,0.1)" : "rgba(96,165,250,0.1)",
              border: `1px solid ${doneCount === totalCount ? "rgba(34,197,94,0.2)" : "rgba(96,165,250,0.2)"}`,
              color: doneCount === totalCount ? "#22c55e" : "#60a5fa",
              fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
            }}>
              {doneCount}/{totalCount}
            </span>
          )}
        </div>
        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 4, padding: "0 16px 8px" }}>
          {(["tasks", "standards"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: "pointer", transition: "all 0.2s",
              background: activeTab === tab ? "var(--accent-primary-bg, rgba(55,172,192,0.12))" : "transparent",
              color: activeTab === tab ? "var(--accent-primary, #37ACC0)" : "var(--text-secondary)",
              border: activeTab === tab ? "1px solid var(--accent-primary, #37ACC0)" : "1px solid var(--glass-border)",
            }}>
              {tab === "tasks" ? "Tasks" : (t("standards.title") || "Standards")}
            </button>
          ))}
        </div>
        {/* Queue hint */}
        {activeTab === "tasks" && hasTasks && (
          <div style={{ padding: "0 16px 8px", fontSize: 10, color: "var(--text-secondary)", opacity: 0.6 }}>
            {t("tasks.queueHint") || "Top = next to execute. Drag or use arrows to reorder."}
          </div>
        )}
      </div>

      {/* Standards tab */}
      {activeTab === "standards" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 16, WebkitOverflowScrolling: "touch" as never }}>
          <StandardsContent />
        </div>
      )}

      {/* Tasks tab - Body */}
      {activeTab === "tasks" && <div
        style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8, WebkitOverflowScrolling: "touch" as never }}
        onTouchMove={(e) => { if (dragIdx !== null) { e.preventDefault(); handleDragMove(e.touches[0].clientY) } }}
        onTouchEnd={() => handleDragEnd()}
      >
        {loading && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)", opacity: 0.6 }}>Loading...</div>}

        {/* Empty state */}
        {!loading && !hasTasks && !showAddTasks && (
          !onStartTask ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)", opacity: 0.5 }}>
              {store?.requirement ? (
                <div style={{
                  padding: 16, borderRadius: 16, textAlign: "left",
                  background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                  fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                    Requirement
                  </div>
                  {store.requirement}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
                    <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                  </svg>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{t("tasks.empty") || "No tasks yet"}</div>
                  <div style={{ fontSize: 12, opacity: 0.6 }}>{t("tasks.emptyHint") || "Use the Task toggle in the input bar to add tasks"}</div>
                </div>
              )}
            </div>
          ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "20px 0" }}>
            {store?.requirement && (
              <div style={{
                padding: 16, borderRadius: 16,
                background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6,
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", opacity: 0.5, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                  Requirement
                </div>
                {store.requirement}
              </div>
            )}
            <textarea
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder="Describe what you want to build..."
              rows={6}
              style={{
                width: "100%", padding: 16, borderRadius: 16,
                border: "1px solid var(--glass-border)",
                background: "var(--icon-bg)",
                color: "var(--text-primary)",
                fontSize: 14, outline: "none",
                resize: "vertical", boxSizing: "border-box",
                lineHeight: 1.6,
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleBreakdown}
                disabled={processing || !requirement.trim()}
                style={{
                  flex: 1, padding: "14px 20px", borderRadius: 14,
                  border: "none",
                  background: requirement.trim() ? "var(--accent-primary)" : "var(--glass-bg)",
                  color: requirement.trim() ? "#fff" : "var(--text-secondary)",
                  fontSize: 14, fontWeight: 700, cursor: requirement.trim() ? "pointer" : "default",
                  opacity: processing ? 0.5 : 1,
                }}
              >
                {processing ? "Sending to Agent..." : "Break Down Tasks"}
              </button>
              {store?.requirement && (
                <button
                  onClick={() => setShowAddTasks(true)}
                  style={{
                    padding: "14px 16px", borderRadius: 14,
                    border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)", color: "var(--text-secondary)",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Import JSON
                </button>
              )}
            </div>
          </div>
          )
        )}

        {/* Import JSON modal */}
        {showAddTasks && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Paste the JSON task array from the agent's response:
            </div>
            <textarea
              value={tasksJson}
              onChange={(e) => setTasksJson(e.target.value)}
              placeholder={'[{"id":1,"title":"...","description":"...","dependsOn":[]}]'}
              rows={8}
              style={{
                width: "100%", padding: 16, borderRadius: 16,
                border: "1px solid var(--glass-border)",
                background: "var(--icon-bg)", color: "var(--text-primary)",
                fontSize: 12, outline: "none", resize: "vertical",
                fontFamily: "'JetBrains Mono', monospace",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowAddTasks(false)}
                style={{ flex: 1, padding: 14, borderRadius: 14, border: "1px solid var(--glass-border)", background: "transparent", color: "var(--text-secondary)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={handleImportTasks}
                style={{ flex: 1, padding: 14, borderRadius: 14, border: "none", background: "var(--accent-primary)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Import
              </button>
            </div>
          </div>
        )}

        {/* Task list — ordered queue */}
        {hasTasks && !showAddTasks && store.tasks.map((task, idx) => {
          const sc = statusColors[task.status] || statusColors.pending
          const isExpanded = expandedTask === task.id
          const isDragging = dragIdx === idx
          const isFirst = idx === 0 && task.status === "pending"

          return (
            <div
              key={task.id}
              style={{
                padding: "12px 14px", borderRadius: 14,
                border: isFirst
                  ? "1.5px solid rgba(55,172,192,0.4)"
                  : `1px solid ${sc.border}`,
                background: isDragging ? "var(--card-bg)" : "var(--glass-bg)",
                backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
                boxShadow: isDragging ? "0 8px 32px rgba(0,0,0,0.3)" : "var(--glass-shadow)",
                transition: isDragging ? "none" : `all 0.2s ${SPRING}`,
                transform: isDragging ? `translateY(${dragOffset}px) scale(1.02)` : "none",
                zIndex: isDragging ? 10 : 1,
                position: "relative",
                opacity: isDragging ? 0.9 : 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {/* Drag handle — long press to drag */}
                <div
                  onTouchStart={(e) => {
                    const y = e.touches[0].clientY
                    longPressTimer.current = setTimeout(() => handleDragStart(idx, y), 200)
                  }}
                  onTouchEnd={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current) }}
                  style={{
                    width: 24, display: "flex", flexDirection: "column", alignItems: "center",
                    gap: 2, cursor: "grab", flexShrink: 0, padding: "4px 0",
                    color: "var(--text-secondary)", opacity: 0.4,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                    <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                    <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                  </svg>
                </div>

                {/* Order number */}
                <div style={{
                  width: 26, height: 26, borderRadius: 8,
                  background: isFirst ? "rgba(55,172,192,0.15)" : sc.bg,
                  border: `1px solid ${isFirst ? "rgba(55,172,192,0.3)" : sc.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700,
                  color: isFirst ? "#37ACC0" : sc.text,
                  fontFamily: "'JetBrains Mono', monospace",
                  flexShrink: 0,
                }}>
                  {idx + 1}
                </div>

                {/* Title — tap to expand */}
                <div
                  style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                  onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                >
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
                    textDecoration: task.status === "done" ? "line-through" : "none",
                    opacity: task.status === "done" ? 0.5 : 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {task.title}
                  </div>
                  {isFirst && task.status === "pending" && (
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#37ACC0", marginTop: 2, textTransform: "uppercase", letterSpacing: 1 }}>
                      {t("tasks.next") || "NEXT"}
                    </div>
                  )}
                </div>

                {/* Reorder arrows */}
                <div style={{ display: "flex", flexDirection: "column", gap: 0, flexShrink: 0 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveTask(idx, -1) }}
                    disabled={idx === 0}
                    style={{
                      width: 24, height: 20, border: "none", background: "transparent",
                      color: idx === 0 ? "transparent" : "var(--text-secondary)",
                      cursor: idx === 0 ? "default" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      padding: 0,
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveTask(idx, 1) }}
                    disabled={idx === store.tasks.length - 1}
                    style={{
                      width: 24, height: 20, border: "none", background: "transparent",
                      color: idx === store.tasks.length - 1 ? "transparent" : "var(--text-secondary)",
                      cursor: idx === store.tasks.length - 1 ? "default" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      padding: 0,
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>

                {/* Status pill */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleStatus(task.id) }}
                  style={{
                    padding: "3px 8px", borderRadius: 6,
                    background: sc.bg, border: `1px solid ${sc.border}`,
                    color: sc.text, fontSize: 9, fontWeight: 700,
                    cursor: "pointer", flexShrink: 0,
                    textTransform: "uppercase",
                  }}
                >
                  {task.status === "in_progress" ? "WIP" : task.status}
                </button>

                {/* Delete X */}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteTask(task.id) }}
                  style={{
                    width: 26, height: 26, borderRadius: 8,
                    border: "none", background: "transparent",
                    color: "var(--text-secondary)", opacity: 0.4,
                    cursor: "pointer", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    flexShrink: 0, padding: 0,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--glass-border)" }}>
                  {task.description && (
                    <div style={{
                      fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6,
                      marginBottom: 10,
                    }}>
                      {task.description}
                    </div>
                  )}
                  {task.status === "pending" && onStartTask && (
                    <button
                      onClick={() => handleStartTask(task)}
                      style={{
                        width: "100%", padding: "10px", borderRadius: 10,
                        border: "none",
                        background: "var(--accent-primary)",
                        color: "#fff",
                        fontSize: 12, fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {t("tasks.startNow") || "Start Now"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* Add more tasks button */}
        {hasTasks && !showAddTasks && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => { setRequirement(store?.requirement || ""); setShowAddTasks(false) }}
              style={{
                flex: 1, padding: "12px", borderRadius: 12,
                border: "1px dashed var(--text-secondary)",
                background: "transparent", color: "var(--text-secondary)",
                fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: 0.5,
              }}
            >
              + Add Requirement
            </button>
            <button
              onClick={() => setShowAddTasks(true)}
              style={{
                padding: "12px 14px", borderRadius: 12,
                border: "1px dashed var(--text-secondary)",
                background: "transparent", color: "var(--text-secondary)",
                fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: 0.5,
              }}
            >
              Import JSON
            </button>
          </div>
        )}
      </div>}
    </div>
    </SpringOverlay>
  )
}
