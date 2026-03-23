import React, { useState, useEffect, useCallback } from "react"
import { buildApiUrl } from "../../../lib/storage"
import { ConfirmDialog } from "../ConfirmDialog"

interface GitFile {
  path: string
  status: string
  staged: boolean
  xy: string
}

interface GitBranch {
  name: string
  current: boolean
  isRemote: boolean
}

interface WorktreeInfo {
  path: string
  branch: string
  bare: boolean
}

interface GitToolProps {
  projectId: string | null
  theme: "light" | "dark"
  t: (key: string) => string
}

const STATUS_COLORS: Record<string, { dark: string; light: string }> = {
  modified:  { dark: "#fbbf24", light: "#ca8a04" },
  added:     { dark: "#4ade80", light: "#16a34a" },
  untracked: { dark: "#60a5fa", light: "#2563eb" },
  deleted:   { dark: "#f87171", light: "#dc2626" },
  renamed:   { dark: "#c084fc", light: "#9333ea" },
}

const STATUS_LABELS: Record<string, string> = {
  modified: "M",
  added: "A",
  untracked: "?",
  deleted: "D",
  renamed: "R",
}

// Side-by-side diff computation (LCS-based)
interface DiffRow {
  leftNum?: number
  leftLine?: string
  rightNum?: number
  rightLine?: string
  type: "same" | "remove" | "add"
}

function computeSideBySideDiff(before: string, after: string): DiffRow[] {
  const bl = before.split("\n")
  const al = after.split("\n")
  const MAX = 500
  const bLines = bl.length > MAX ? bl.slice(0, MAX) : bl
  const aLines = al.length > MAX ? al.slice(0, MAX) : al
  const m = bLines.length, n = aLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = bLines[i - 1] === aLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const ops: { type: "same" | "remove" | "add"; line: string }[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && bLines[i - 1] === aLines[j - 1]) {
      ops.unshift({ type: "same", line: bLines[i - 1] }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "add", line: aLines[j - 1] }); j--
    } else {
      ops.unshift({ type: "remove", line: bLines[i - 1] }); i--
    }
  }
  // Pair consecutive remove+add blocks into side-by-side "change" rows
  const rows: DiffRow[] = []
  let ln = 1, rn = 1
  let idx = 0
  while (idx < ops.length) {
    if (ops[idx].type === "same") {
      rows.push({ leftNum: ln++, leftLine: ops[idx].line, rightNum: rn++, rightLine: ops[idx].line, type: "same" })
      idx++
    } else {
      // Collect consecutive removes then adds
      const removes: string[] = []
      const adds: string[] = []
      while (idx < ops.length && ops[idx].type === "remove") {
        removes.push(ops[idx].line); idx++
      }
      while (idx < ops.length && ops[idx].type === "add") {
        adds.push(ops[idx].line); idx++
      }
      // Zip them into paired rows
      const maxLen = Math.max(removes.length, adds.length)
      for (let k = 0; k < maxLen; k++) {
        const hasLeft = k < removes.length
        const hasRight = k < adds.length
        rows.push({
          leftNum: hasLeft ? ln++ : undefined,
          leftLine: hasLeft ? removes[k] : undefined,
          rightNum: hasRight ? rn++ : undefined,
          rightLine: hasRight ? adds[k] : undefined,
          type: hasLeft && hasRight ? "remove" : hasLeft ? "remove" : "add",
        })
      }
    }
  }
  return rows
}

export function GitTool({ projectId, theme, t: _t }: GitToolProps) {
  const t = (key: string, fallback?: string) => _t(key) || fallback || key
  const dark = theme === "dark"
  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const border = dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)"
  const cardBg = dark ? "rgba(30,41,59,0.6)" : "rgba(255,255,255,0.8)"
  const headerBg = dark ? "rgba(30,41,59,0.4)" : "rgba(241,245,249,0.6)"

  const [branch, setBranch] = useState("")
  const [files, setFiles] = useState<GitFile[]>([])
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showBranches, setShowBranches] = useState(false)
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [diffContent, setDiffContent] = useState<{ before: string; after: string } | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [worktreeLoading, setWorktreeLoading] = useState(false)
  const [worktreeAction, setWorktreeAction] = useState("")
  const [showWorktrees, setShowWorktrees] = useState(false)
  const [forceDeleteTarget, setForceDeleteTarget] = useState<{ path: string; error: string } | null>(null)

  const fetchStatus = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(buildApiUrl(`/api/git/status?project=${projectId}`))
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setBranch(data.branch || "")
        setFiles(Array.isArray(data.files) ? data.files : [])
      }
    } catch {
      setError("Failed to fetch git status")
    }
    setLoading(false)
  }, [projectId])

  const fetchBranches = useCallback(async () => {
    if (!projectId) return
    try {
      const res = await fetch(buildApiUrl(`/api/git/branches?project=${projectId}`))
      const data = await res.json()
      setBranches(Array.isArray(data.branches) ? data.branches : [])
    } catch {
      setBranches([])
    }
  }, [projectId])

  const fetchWorktrees = useCallback(async () => {
    if (!projectId) return
    setWorktreeLoading(true)
    try {
      const res = await fetch(buildApiUrl(`/api/git/worktrees?project=${projectId}`))
      const data = await res.json()
      setWorktrees(Array.isArray(data.worktrees) ? data.worktrees : [])
    } catch {
      setWorktrees([])
    }
    setWorktreeLoading(false)
  }, [projectId])

  const deleteWorktree = useCallback(async (wtPath: string, force = false) => {
    if (!projectId) return
    setWorktreeAction(wtPath)
    try {
      const res = await fetch(buildApiUrl("/api/git/worktree-delete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectId, path: wtPath, force }),
      })
      const data = await res.json()
      if (data.error && !force) {
        setForceDeleteTarget({ path: wtPath, error: data.error })
        return
      } else {
        fetchWorktrees()
      }
    } catch {}
    setWorktreeAction("")
  }, [projectId, fetchWorktrees, t])

  const fetchDiff = useCallback(async (filePath: string) => {
    if (!projectId) return
    setDiffLoading(true)
    try {
      const res = await fetch(buildApiUrl(`/api/git/diff?project=${projectId}&file=${encodeURIComponent(filePath)}`))
      const data = await res.json()
      setDiffContent({ before: data.before || "", after: data.after || "" })
    } catch {
      setDiffContent(null)
    }
    setDiffLoading(false)
  }, [projectId])

  useEffect(() => {
    fetchStatus()
    fetchBranches()
    fetchWorktrees()
  }, [fetchStatus, fetchBranches, fetchWorktrees])

  const handleFileClick = (filePath: string) => {
    if (expandedFile === filePath) {
      setExpandedFile(null)
      setDiffContent(null)
    } else {
      setExpandedFile(filePath)
      fetchDiff(filePath)
    }
  }

  if (!projectId) {
    return (
      <div style={{ fontSize: 13, color: textSecondary, textAlign: "center", padding: 40 }}>
        Select a project to view Git status
      </div>
    )
  }

  const stagedFiles = files.filter(f => f.staged)
  const unstagedFiles = files.filter(f => !f.staged)
  const localBranches = branches.filter(b => !b.isRemote)
  const remoteBranches = branches.filter(b => b.isRemote)

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: textPrimary, margin: 0 }}>
          Git
        </h2>
        <button
          onClick={() => { fetchStatus(); fetchBranches(); fetchWorktrees() }}
          style={{
            padding: "6px 14px", fontSize: 12, fontWeight: 600,
            borderRadius: 6, border: `1px solid ${border}`,
            background: "transparent", color: textSecondary, cursor: "pointer",
            fontFamily: "inherit", flexShrink: 0, whiteSpace: "nowrap",
            display: "flex", alignItems: "center", gap: 4,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          {t("desktop.refresh")}
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: textSecondary, textAlign: "center", padding: 40 }}>{t("desktop.loading")}</div>
      ) : error ? (
        <div style={{ fontSize: 13, color: textSecondary, textAlign: "center", padding: 40 }}>
          {error}
        </div>
      ) : (
        <>
          {/* Current branch */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", borderRadius: 10, marginBottom: 14,
            background: cardBg, border: `1px solid ${border}`,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 01-9 9" />
            </svg>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, color: textSecondary, fontWeight: 600 }}>{t("git.currentBranch")}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: textPrimary, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {branch || "unknown"}
              </div>
            </div>
            <button
              onClick={() => setShowBranches(!showBranches)}
              style={{
                marginLeft: "auto", padding: "4px 10px", fontSize: 11, fontWeight: 600,
                borderRadius: 5, border: `1px solid ${border}`,
                background: showBranches ? (dark ? "rgba(55,172,192,0.1)" : "rgba(55,172,192,0.06)") : "transparent",
                color: showBranches ? "#37ACC0" : textSecondary,
                cursor: "pointer", fontFamily: "inherit",
                flexShrink: 0, whiteSpace: "nowrap",
                display: "flex", alignItems: "center",
              }}
            >
              {localBranches.length} branches
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4, verticalAlign: "middle", transform: showBranches ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>

          {/* Branch list (collapsible) */}
          {showBranches && (
            <div style={{
              borderRadius: 10, overflow: "hidden", marginBottom: 14,
              border: `1px solid ${border}`, background: cardBg,
            }}>
              {localBranches.length > 0 && (
                <>
                  <div style={{
                    padding: "6px 14px", fontSize: 11, fontWeight: 700,
                    color: textSecondary, background: headerBg,
                    textTransform: "uppercase", letterSpacing: 0.5,
                  }}>
                    {t("desktop.local")}
                  </div>
                  {localBranches.map(b => (
                    <div key={b.name} style={{
                      padding: "7px 14px", fontSize: 12,
                      color: b.current ? "#37ACC0" : textPrimary,
                      fontWeight: b.current ? 700 : 400,
                      fontFamily: "'JetBrains Mono', monospace",
                      borderTop: `1px solid ${border}`,
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      {b.current && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      {b.name}
                    </div>
                  ))}
                </>
              )}
              {remoteBranches.length > 0 && (
                <>
                  <div style={{
                    padding: "6px 14px", fontSize: 11, fontWeight: 700,
                    color: textSecondary, background: headerBg,
                    textTransform: "uppercase", letterSpacing: 0.5,
                    borderTop: `1px solid ${border}`,
                  }}>
                    {t("desktop.remote")} ({remoteBranches.length})
                  </div>
                  {remoteBranches.slice(0, 10).map(b => (
                    <div key={b.name} style={{
                      padding: "7px 14px", fontSize: 12,
                      color: textSecondary,
                      fontFamily: "'JetBrains Mono', monospace",
                      borderTop: `1px solid ${border}`,
                    }}>
                      {b.name}
                    </div>
                  ))}
                  {remoteBranches.length > 10 && (
                    <div style={{ padding: "6px 14px", fontSize: 11, color: textSecondary, borderTop: `1px solid ${border}` }}>
                      +{remoteBranches.length - 10} more
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Changed files summary */}
          <div style={{
            display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap",
          }}>
            <div style={{
              padding: "8px 14px", borderRadius: 8,
              background: cardBg, border: `1px solid ${border}`,
              fontSize: 13, color: textPrimary,
            }}>
              <span style={{ fontWeight: 700 }}>{files.length}</span>
              <span style={{ color: textSecondary, marginLeft: 6 }}>{t("desktop.changedFiles")}</span>
            </div>
            {stagedFiles.length > 0 && (
              <div style={{
                padding: "8px 14px", borderRadius: 8,
                background: dark ? "rgba(34,197,94,0.08)" : "rgba(34,197,94,0.06)",
                border: `1px solid ${dark ? "rgba(34,197,94,0.2)" : "rgba(34,197,94,0.15)"}`,
                fontSize: 13, color: dark ? "#4ade80" : "#16a34a",
              }}>
                <span style={{ fontWeight: 700 }}>{stagedFiles.length}</span>
                <span style={{ marginLeft: 6 }}>{t("desktop.staged")}</span>
              </div>
            )}
          </div>

          {/* File list */}
          {files.length === 0 ? (
            <div style={{
              padding: "30px 14px", borderRadius: 10, textAlign: "center",
              background: cardBg, border: `1px solid ${border}`,
              fontSize: 13, color: textSecondary,
            }}>
              {t("git.noChanges")}
            </div>
          ) : (
            <div style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${border}` }}>
              {/* Staged section */}
              {stagedFiles.length > 0 && (
                <>
                  <div style={{
                    padding: "6px 14px", fontSize: 11, fontWeight: 700,
                    color: dark ? "#4ade80" : "#16a34a", background: headerBg,
                    textTransform: "uppercase", letterSpacing: 0.5,
                  }}>
                    {t("desktop.stagedChanges")} ({stagedFiles.length})
                  </div>
                  {stagedFiles.map(f => renderFileRow(f))}
                </>
              )}
              {/* Unstaged section */}
              {unstagedFiles.length > 0 && (
                <>
                  <div style={{
                    padding: "6px 14px", fontSize: 11, fontWeight: 700,
                    color: textSecondary, background: headerBg,
                    textTransform: "uppercase", letterSpacing: 0.5,
                    ...(stagedFiles.length > 0 ? { borderTop: `1px solid ${border}` } : {}),
                  }}>
                    {t("git.changes")} ({unstagedFiles.length})
                  </div>
                  {unstagedFiles.map(f => renderFileRow(f))}
                </>
              )}
            </div>
          )}

          {/* Worktrees section */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginTop: 20, marginBottom: 10,
          }}>
            <button
              onClick={() => setShowWorktrees(!showWorktrees)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "none", border: "none", cursor: "pointer",
                fontSize: 14, fontWeight: 700, color: textPrimary, padding: 0,
                fontFamily: "inherit",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D09899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              Worktrees
              <span style={{ fontSize: 11, fontWeight: 600, color: textSecondary, marginLeft: 2 }}>
                ({worktrees.length})
              </span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showWorktrees ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>

          {showWorktrees && (
            <div style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${border}` }}>
              {worktreeLoading ? (
                <div style={{ padding: "20px 14px", textAlign: "center", fontSize: 12, color: textSecondary }}>Loading...</div>
              ) : worktrees.length === 0 ? (
                <div style={{ padding: "20px 14px", textAlign: "center", fontSize: 12, color: textSecondary, opacity: 0.5 }}>
                  {t("git.noWorktrees") || "No worktrees"}
                </div>
              ) : (
                worktrees.map((wt, i) => {
                  const dirName = wt.path.split(/[\\/]/).pop() || wt.path
                  const isMain = i === 0
                  return (
                    <div key={wt.path} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 14px", background: cardBg,
                      borderTop: i > 0 ? `1px solid ${border}` : "none",
                      borderLeft: `3px solid ${isMain ? "#37ACC0" : "#D09899"}`,
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isMain ? "#37ACC0" : "#D09899"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: textPrimary }}>
                          {dirName}
                        </div>
                        {wt.branch && (
                          <div style={{ fontSize: 11, color: textSecondary, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
                            </svg>
                            {wt.branch}
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: textSecondary, marginTop: 2, opacity: 0.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {wt.path}
                        </div>
                      </div>
                      {!isMain && (
                        <button
                          onClick={() => deleteWorktree(wt.path)}
                          disabled={worktreeAction === wt.path}
                          title={t("git.deleteWorktree") || "Delete worktree"}
                          style={{
                            width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                            border: `1px solid ${dark ? "rgba(239,68,68,0.2)" : "rgba(239,68,68,0.15)"}`,
                            background: dark ? "rgba(239,68,68,0.06)" : "rgba(239,68,68,0.04)",
                            color: "#FB8184", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            opacity: worktreeAction === wt.path ? 0.4 : 1,
                          }}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!forceDeleteTarget}
        theme={theme}
        title={t("git.forceDeleteWorktree") || "Delete failed. Force delete?"}
        message={forceDeleteTarget?.error}
        confirmLabel="Force Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          if (forceDeleteTarget) deleteWorktree(forceDeleteTarget.path, true)
          setForceDeleteTarget(null)
        }}
        onCancel={() => setForceDeleteTarget(null)}
      />
    </div>
  )

  function renderFileRow(file: GitFile) {
    const colors = STATUS_COLORS[file.status] || STATUS_COLORS.modified
    const statusColor = dark ? colors.dark : colors.light
    const isExpanded = expandedFile === file.path

    return (
      <div key={file.path}>
        <div
          onClick={() => handleFileClick(file.path)}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 14px", fontSize: 12,
            color: textPrimary, background: cardBg,
            borderTop: `1px solid ${border}`,
            cursor: "pointer",
            transition: "background 0.1s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = dark ? "rgba(30,41,59,0.9)" : "rgba(241,245,249,0.9)" }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = cardBg }}
        >
          {/* Status badge */}
          <span style={{
            fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
            padding: "1px 5px", borderRadius: 3,
            background: `${statusColor}18`, color: statusColor,
            flexShrink: 0,
          }}>
            {STATUS_LABELS[file.status] || file.xy || "?"}
          </span>
          {/* File path */}
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            flex: 1,
          }}>
            {file.path}
          </span>
          {/* Expand indicator */}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        {/* Inline diff preview */}
        {isExpanded && (
          <div style={{
            padding: "8px 14px",
            background: dark ? "rgba(15,23,42,0.8)" : "rgba(248,250,252,0.95)",
            borderTop: `1px solid ${border}`,
            maxHeight: 500, overflowY: "auto",
          }}>
            {diffLoading ? (
              <div style={{ fontSize: 11, color: textSecondary, padding: 8 }}>{t("desktop.loadingDiff")}</div>
            ) : diffContent ? (
              <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6 }}>
                {renderSimpleDiff(diffContent.before, diffContent.after)}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: textSecondary, padding: 8 }}>{t("desktop.noDiff")}</div>
            )}
          </div>
        )}
      </div>
    )
  }

  function renderSimpleDiff(before: string, after: string) {
    if (!before && !after) return <span style={{ color: textSecondary }}>{t("desktop.emptyFile")}</span>

    const removeColor = dark ? "rgba(248,113,113,0.08)" : "rgba(220,38,38,0.06)"
    const addColor = dark ? "rgba(74,222,128,0.08)" : "rgba(22,163,74,0.06)"
    const removeText = dark ? "#f87171" : "#dc2626"
    const addText = dark ? "#4ade80" : "#16a34a"
    const borderCol = dark ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.1)"
    const lineH = 20

    // New file — all green on right side
    if (!before) {
      const lines = after.split("\n").slice(0, 60)
      return (
        <div>
          <div style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: 11 }}>
            <span style={{ color: addText, fontWeight: 600 }}>{t("desktop.newFile")}</span>
            <span style={{ color: addText }}>+{after.split("\n").length} lines</span>
          </div>
          <div style={{ borderRadius: 6, overflow: "hidden", border: `1px solid ${borderCol}` }}>
            <div style={{ display: "flex" }}>
              <div style={{ flex: 1, borderRight: `1px solid ${borderCol}` }}>
                <div style={{ padding: "4px 8px", fontSize: 10, fontWeight: 600, color: textSecondary, opacity: 0.5, background: dark ? "rgba(30,41,59,0.4)" : "rgba(241,245,249,0.6)", borderBottom: `1px solid ${borderCol}` }}>{t("desktop.before")}</div>
                {lines.map((_, i) => <div key={i} style={{ height: lineH }} />)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ padding: "4px 8px", fontSize: 10, fontWeight: 600, color: addText, background: addColor, borderBottom: `1px solid ${borderCol}` }}>{t("desktop.after")}</div>
                {lines.map((line, i) => (
                  <div key={i} style={{ display: "flex", height: lineH, background: addColor, alignItems: "center" }}>
                    <span style={{ width: 36, textAlign: "right", paddingRight: 6, fontSize: 10, color: textSecondary, opacity: 0.4, flexShrink: 0, userSelect: "none" }}>{i + 1}</span>
                    <span style={{ flex: 1, fontSize: 11, color: addText, whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'JetBrains Mono', monospace" }}>{line}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {after.split("\n").length > 60 && (
            <div style={{ fontSize: 10, color: textSecondary, marginTop: 4 }}>... +{after.split("\n").length - 60} more lines</div>
          )}
        </div>
      )
    }

    // Deleted file — all red on left side
    if (!after) {
      const lines = before.split("\n").slice(0, 60)
      return (
        <div>
          <div style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: 11 }}>
            <span style={{ color: removeText, fontWeight: 600 }}>{t("desktop.deletedFile")}</span>
            <span style={{ color: removeText }}>-{before.split("\n").length} lines</span>
          </div>
          <div style={{ borderRadius: 6, overflow: "hidden", border: `1px solid ${borderCol}` }}>
            <div style={{ display: "flex" }}>
              <div style={{ flex: 1, borderRight: `1px solid ${borderCol}` }}>
                <div style={{ padding: "4px 8px", fontSize: 10, fontWeight: 600, color: removeText, background: removeColor, borderBottom: `1px solid ${borderCol}` }}>{t("desktop.before")}</div>
                {lines.map((line, i) => (
                  <div key={i} style={{ display: "flex", height: lineH, background: removeColor, alignItems: "center" }}>
                    <span style={{ width: 36, textAlign: "right", paddingRight: 6, fontSize: 10, color: textSecondary, opacity: 0.4, flexShrink: 0, userSelect: "none" }}>{i + 1}</span>
                    <span style={{ flex: 1, fontSize: 11, color: removeText, whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'JetBrains Mono', monospace" }}>{line}</span>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ padding: "4px 8px", fontSize: 10, fontWeight: 600, color: textSecondary, opacity: 0.5, background: dark ? "rgba(30,41,59,0.4)" : "rgba(241,245,249,0.6)", borderBottom: `1px solid ${borderCol}` }}>{t("desktop.after")}</div>
                {lines.map((_, i) => <div key={i} style={{ height: lineH }} />)}
              </div>
            </div>
          </div>
        </div>
      )
    }

    // Modified file — side-by-side diff
    const rows = computeSideBySideDiff(before, after)
    const added = rows.filter(r => r.type === "add").length
    const removed = rows.filter(r => r.type === "remove").length
    // Limit visible rows to keep UI responsive
    const visibleRows = rows.length > 200 ? rows.slice(0, 200) : rows

    return (
      <div>
        <div style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: 11 }}>
          <span style={{ color: removeText }}>-{removed}</span>
          <span style={{ color: addText }}>+{added}</span>
          <span style={{ color: textSecondary }}>({before.split("\n").length} / {after.split("\n").length} lines)</span>
        </div>
        <div style={{ borderRadius: 6, overflow: "hidden", border: `1px solid ${borderCol}` }}>
          <div style={{ display: "flex" }}>
            {/* Left (before) */}
            <div style={{ flex: 1, borderRight: `1px solid ${borderCol}`, overflow: "hidden" }}>
              <div style={{ padding: "4px 8px", fontSize: 10, fontWeight: 600, color: removeText, background: removeColor, borderBottom: `1px solid ${borderCol}` }}>{t("desktop.before")}</div>
              {visibleRows.map((row, i) => {
                const hasLeft = row.leftLine != null
                if (!hasLeft) return <div key={i} style={{ height: lineH, background: row.rightLine != null ? addColor : (dark ? "rgba(255,255,255,0.01)" : "rgba(0,0,0,0.01)") }} />
                const isChange = row.type !== "same"
                const bg = isChange ? removeColor : "transparent"
                return (
                  <div key={i} style={{ display: "flex", height: lineH, background: bg, alignItems: "center" }}>
                    <span style={{ width: 36, textAlign: "right", paddingRight: 6, fontSize: 10, color: textSecondary, opacity: 0.4, flexShrink: 0, userSelect: "none" }}>{row.leftNum}</span>
                    <span style={{ flex: 1, fontSize: 11, color: isChange ? removeText : (dark ? "#cbd5e1" : "#334155"), whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'JetBrains Mono', monospace" }}>{row.leftLine}</span>
                  </div>
                )
              })}
            </div>
            {/* Right (after) */}
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ padding: "4px 8px", fontSize: 10, fontWeight: 600, color: addText, background: addColor, borderBottom: `1px solid ${borderCol}` }}>{t("desktop.after")}</div>
              {visibleRows.map((row, i) => {
                const hasRight = row.rightLine != null
                if (!hasRight) return <div key={i} style={{ height: lineH, background: row.leftLine != null ? removeColor : (dark ? "rgba(255,255,255,0.01)" : "rgba(0,0,0,0.01)") }} />
                const isChange = row.type !== "same"
                const bg = isChange ? addColor : "transparent"
                return (
                  <div key={i} style={{ display: "flex", height: lineH, background: bg, alignItems: "center" }}>
                    <span style={{ width: 36, textAlign: "right", paddingRight: 6, fontSize: 10, color: textSecondary, opacity: 0.4, flexShrink: 0, userSelect: "none" }}>{row.rightNum}</span>
                    <span style={{ flex: 1, fontSize: 11, color: isChange ? addText : (dark ? "#cbd5e1" : "#334155"), whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'JetBrains Mono', monospace" }}>{row.rightLine}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        {rows.length > 200 && (
          <div style={{ fontSize: 10, color: textSecondary, marginTop: 4 }}>Showing first 200 of {rows.length} diff rows</div>
        )}
        {(before.split("\n").length > 500 || after.split("\n").length > 500) && (
          <div style={{ fontSize: 10, color: textSecondary, marginTop: 4 }}>Files capped at 500 lines for diff computation</div>
        )}
      </div>
    )
  }
}
