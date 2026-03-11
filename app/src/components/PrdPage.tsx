import { useState, useEffect, useCallback } from "react"
import { getApiBase } from "../lib/storage"
import { useLocale } from "../lib/i18n/index.js"
import type { TaskStore, Task, Prd } from "../types"
import { SpringOverlay } from "./SpringOverlay"

const SPRING = "cubic-bezier(0.16, 1, 0.3, 1)"

interface PrdPageProps {
  open: boolean
  projectId: string
  projectName: string
  onClose: () => void
  onStartTask?: (description: string) => void
  theme: "light" | "dark"
}

export function PrdPage({ open, projectId, projectName, onClose, onStartTask, theme }: PrdPageProps) {
  const { t } = useLocale()
  const [store, setStore] = useState<TaskStore | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedTask, setExpandedTask] = useState<number | null>(null)

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

  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => { e.preventDefault(); onClose() }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [open, onClose])

  const toggleStatus = useCallback((taskId: number) => {
    if (!store) return
    const task = store.tasks.find((t) => t.id === taskId)
    if (!task) return
    const next = task.status === "pending" ? "in_progress" : task.status === "in_progress" ? "done" : "pending"
    fetch(`${getApiBase()}/api/tasks/${encodeURIComponent(projectId)}/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).then(() => {
      setStore((prev) => {
        if (!prev) return prev
        return { ...prev, tasks: prev.tasks.map((t) => t.id === taskId ? { ...t, status: next } : t), updatedAt: Date.now() }
      })
    }).catch(() => {})
  }, [store, projectId])

  const prd = store?.prd
  const tasks = store?.tasks || []
  const doneCount = tasks.filter((t) => t.status === "done").length
  const totalCount = tasks.length
  const hasContent = prd || totalCount > 0

  const sectionStyle = (isDark: boolean): React.CSSProperties => ({
    borderRadius: 14,
    padding: "14px 16px",
    background: isDark ? "rgba(55,172,192,0.06)" : "rgba(55,172,192,0.04)",
    border: `1px solid ${isDark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)"}`,
    backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
    marginBottom: 12,
  })

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 1.2,
    color: "#37ACC0", marginBottom: 8, opacity: 0.8,
  }

  const statusColors: Record<string, { bg: string; text: string; border: string }> = {
    pending: { bg: "rgba(148,163,184,0.1)", text: "#94a3b8", border: "rgba(148,163,184,0.2)" },
    in_progress: { bg: "rgba(96,165,250,0.1)", text: "#60a5fa", border: "rgba(96,165,250,0.2)" },
    done: { bg: "rgba(34,197,94,0.1)", text: "#22c55e", border: "rgba(34,197,94,0.2)" },
  }

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
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px" }}>
          <button onClick={onClose}
            style={{
              width: 36, height: 36, borderRadius: 12,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)", color: "var(--text-primary)",
              fontSize: 18, cursor: "pointer", display: "flex",
              alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("overview.viewPrd") || "Plan"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", opacity: 0.7 }}>
              {projectName}
            </div>
          </div>
          {totalCount > 0 && (
            <span style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 20,
              background: doneCount === totalCount ? "rgba(34,197,94,0.1)" : "rgba(55,172,192,0.1)",
              border: `1px solid ${doneCount === totalCount ? "rgba(34,197,94,0.2)" : "rgba(55,172,192,0.2)"}`,
              color: doneCount === totalCount ? "#22c55e" : "#37ACC0",
              fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
            }}>
              {doneCount}/{totalCount}
            </span>
          )}
        </div>
        {/* Progress bar */}
        {totalCount > 0 && (
          <div style={{ padding: "0 16px 10px" }}>
            <div style={{
              height: 3, borderRadius: 2,
              background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
            }}>
              <div style={{
                height: "100%", borderRadius: 2,
                width: `${(doneCount / totalCount) * 100}%`,
                background: doneCount === totalCount
                  ? "linear-gradient(90deg, #22c55e, #37ACC0)"
                  : "linear-gradient(90deg, #37ACC0, #347792)",
                transition: `width 0.5s ${SPRING}`,
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{
        flex: 1, overflowY: "auto", padding: 16,
        WebkitOverflowScrolling: "touch" as never,
      }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)", opacity: 0.5 }}>
            Loading...
          </div>
        )}

        {!loading && !hasContent && (
          <div style={{
            textAlign: "center", padding: "60px 20px",
            color: "var(--text-secondary)", opacity: 0.5,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t("prd.empty") || "No plan yet"}</div>
            <div style={{ fontSize: 12, opacity: 0.6, lineHeight: 1.6, maxWidth: 260 }}>
              {t("prd.emptyHint") || "Start a session and describe what you want to build. The agent will guide you through creating a plan automatically."}
            </div>
          </div>
        )}

        {!loading && prd && (
          <>
            {/* Goal */}
            <div style={sectionStyle(theme === "dark")}>
              <div style={labelStyle}>{t("prd.goal") || "Goal"}</div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-primary)" }}>
                {prd.goal}
              </div>
            </div>

            {/* Decisions */}
            {prd.decisions.length > 0 && (
              <div style={sectionStyle(theme === "dark")}>
                <div style={labelStyle}>{t("prd.decisions") || "Decisions"}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {prd.decisions.map((d, i) => (
                    <div key={i} style={{
                      padding: "10px 12px", borderRadius: 10,
                      background: theme === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                      border: `1px solid ${theme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"}`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                        Q: {d.question}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5 }}>
                        A: {d.answer}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Approaches */}
            {prd.approaches.length > 0 && (
              <div style={sectionStyle(theme === "dark")}>
                <div style={labelStyle}>{t("prd.approaches") || "Approaches"}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {prd.approaches.map((a, i) => (
                    <div key={i} style={{
                      padding: "12px 14px", borderRadius: 10,
                      background: a.adopted
                        ? (theme === "dark" ? "rgba(55,172,192,0.08)" : "rgba(55,172,192,0.06)")
                        : (theme === "dark" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)"),
                      border: a.adopted
                        ? `1.5px solid ${theme === "dark" ? "rgba(55,172,192,0.3)" : "rgba(55,172,192,0.25)"}`
                        : `1px solid ${theme === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                          {a.name}
                        </span>
                        {a.adopted && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                            background: theme === "dark" ? "rgba(55,172,192,0.2)" : "rgba(55,172,192,0.15)",
                            color: "#37ACC0", textTransform: "uppercase", letterSpacing: 0.5,
                          }}>
                            {t("prd.adopted") || "Adopted"}
                          </span>
                        )}
                      </div>
                      {a.pros.length > 0 && (
                        <div style={{ marginBottom: 4 }}>
                          {a.pros.map((p, j) => (
                            <div key={j} style={{ fontSize: 12, color: "#22c55e", lineHeight: 1.6, display: "flex", gap: 6 }}>
                              <span style={{ flexShrink: 0 }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 3 }}><polyline points="20 6 9 17 4 12" /></svg>
                              </span>
                              <span>{p}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {a.cons.length > 0 && (
                        <div>
                          {a.cons.map((c, j) => (
                            <div key={j} style={{ fontSize: 12, color: theme === "dark" ? "#f87171" : "#dc2626", lineHeight: 1.6, display: "flex", gap: 6 }}>
                              <span style={{ flexShrink: 0 }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 3 }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                              </span>
                              <span>{c}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {a.techNote && (
                        <div style={{
                          marginTop: 6, fontSize: 10, color: "var(--text-secondary)", opacity: 0.6,
                          fontStyle: "italic",
                        }}>
                          {t("prd.techNote") || "Tech"}: {a.techNote}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Scope */}
            {(prd.scope.included.length > 0 || prd.scope.excluded.length > 0) && (
              <div style={sectionStyle(theme === "dark")}>
                <div style={labelStyle}>{t("prd.scope") || "Scope"}</div>
                {prd.scope.included.length > 0 && (
                  <div style={{ marginBottom: prd.scope.excluded.length > 0 ? 8 : 0 }}>
                    {prd.scope.included.map((item, i) => (
                      <div key={i} style={{ fontSize: 13, color: "#22c55e", lineHeight: 1.8, display: "flex", gap: 6 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 4 }}><polyline points="20 6 9 17 4 12" /></svg>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                )}
                {prd.scope.excluded.length > 0 && (
                  <div>
                    {prd.scope.excluded.map((item, i) => (
                      <div key={i} style={{ fontSize: 13, color: "var(--text-secondary)", opacity: 0.6, lineHeight: 1.8, display: "flex", gap: 6 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 4 }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Tasks section */}
        {!loading && totalCount > 0 && (
          <div style={{ marginTop: prd ? 4 : 0 }}>
            <div style={{
              ...labelStyle,
              marginBottom: 10, paddingLeft: 2,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span>{t("prd.tasks") || "Tasks"}</span>
              <span style={{
                fontSize: 11, fontWeight: 700,
                color: doneCount === totalCount ? "#22c55e" : "#37ACC0",
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: 0,
              }}>
                {doneCount}/{totalCount}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tasks.map((task, idx) => {
                const sc = statusColors[task.status] || statusColors.pending
                const isExpanded = expandedTask === task.id
                const isFirst = idx === 0 && task.status === "pending"

                return (
                  <div
                    key={task.id}
                    onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                    style={{
                      padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                      border: isFirst
                        ? "1.5px solid rgba(55,172,192,0.4)"
                        : `1px solid ${sc.border}`,
                      background: theme === "dark" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)",
                      backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                      {/* Title */}
                      <div style={{ flex: 1, minWidth: 0 }}>
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
                            NEXT
                          </div>
                        )}
                      </div>
                      {/* Status pill */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleStatus(task.id) }}
                        style={{
                          padding: "3px 8px", borderRadius: 6,
                          background: sc.bg, border: `1px solid ${sc.border}`,
                          color: sc.text, fontSize: 9, fontWeight: 700,
                          cursor: "pointer", flexShrink: 0, textTransform: "uppercase",
                        }}
                      >
                        {task.status === "in_progress" ? "WIP" : task.status}
                      </button>
                    </div>
                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--glass-border)" }}>
                        {task.description && (
                          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: onStartTask && task.status === "pending" ? 10 : 0 }}>
                            {task.description}
                          </div>
                        )}
                        {onStartTask && task.status === "pending" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onStartTask(task.description || task.title); toggleStatus(task.id) }}
                            style={{
                              width: "100%", padding: 10, borderRadius: 10,
                              border: "none", background: "#37ACC0", color: "#fff",
                              fontSize: 12, fontWeight: 700, cursor: "pointer",
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
            </div>
          </div>
        )}
      </div>
    </div>
    </SpringOverlay>
  )
}
