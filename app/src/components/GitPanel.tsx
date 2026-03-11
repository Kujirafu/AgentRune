// web/components/GitPanel.tsx
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { getApiBase } from "../lib/storage"
import { useLocale } from "../lib/i18n/index.js"
import { useSwipeToDismiss } from "../hooks/useSwipeToDismiss"
import { SpringOverlay } from "./SpringOverlay"

const SPRING = "cubic-bezier(0.16, 1, 0.3, 1)"
const COLORS = {
  addBg: "rgba(34, 197, 94, 0.15)",
  addText: "#22c55e",
  delBg: "rgba(239, 68, 68, 0.15)",
  delText: "#ef4444",
  dotBefore: "#ef4444",
  dotAfter: "#22c55e",
}

interface GitFile {
  path: string
  status: string
  staged: boolean
  xy: string
}

interface BranchInfo {
  name: string
  current: boolean
  isRemote: boolean
}

interface WorktreeInfo {
  path: string
  branch: string
  bare: boolean
}

interface GitPanelProps {
  open: boolean
  projectId: string
  onClose: () => void
  onNewSession?: (branch: string) => void
}

// LCS diff (same as DiffPanel)
interface DiffLine {
  type: "same" | "add" | "del" | "mod"
  before?: string
  after?: string
}

function computeLineDiff(beforeText: string, afterText: string): DiffLine[] {
  const a = beforeText.split("\n")
  const b = afterText.split("\n")
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  const stack: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      stack.push({ type: "same", before: a[i - 1], after: b[j - 1] }); i--; j--
    } else if (i > 0 && j > 0 && dp[i - 1][j - 1] >= dp[i - 1][j] && dp[i - 1][j - 1] >= dp[i][j - 1]) {
      stack.push({ type: "mod", before: a[i - 1], after: b[j - 1] }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "add", after: b[j - 1] }); j--
    } else {
      stack.push({ type: "del", before: a[i - 1] }); i--
    }
  }
  stack.reverse()
  return stack
}

type Tab = "changes" | "branches" | "worktrees"

export function GitPanel({ open, projectId, onClose, onNewSession }: GitPanelProps) {
  const { t } = useLocale()
  const [tab, setTab] = useState<Tab>("changes")
  const [branch, setBranch] = useState("")
  const [files, setFiles] = useState<GitFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  // Diff view
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffBefore, setDiffBefore] = useState("")
  const [diffAfter, setDiffAfter] = useState("")
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffPage, setDiffPage] = useState<0 | 1>(1)
  const slideRef = useRef<HTMLDivElement>(null)
  // Commit
  const [commitMsg, setCommitMsg] = useState("")
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<{ ok: boolean; msg: string } | null>(null)
  // Branches
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [branchLoading, setBranchLoading] = useState(false)
  const [branchAction, setBranchAction] = useState("")
  // Worktrees
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [worktreeLoading, setWorktreeLoading] = useState(false)
  const [worktreeAction, setWorktreeAction] = useState("")
  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; onConfirm: () => void } | null>(null)

  const api = getApiBase()

  const fetchStatus = useCallback(() => {
    setLoading(true)
    setError("")
    fetch(`${api}/api/git/status?project=${encodeURIComponent(projectId)}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data) => {
        if (data.error) setError(data.error)
        else { setBranch(data.branch); setFiles(data.files) }
      })
      .catch((e) => setError(`Failed: ${e.message}`))
      .finally(() => setLoading(false))
  }, [projectId, api])

  const fetchBranches = useCallback(() => {
    setBranchLoading(true)
    fetch(`${api}/api/git/branches?project=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data) => setBranches(data.branches || []))
      .catch(() => setBranches([]))
      .finally(() => setBranchLoading(false))
  }, [projectId, api])

  const fetchWorktrees = useCallback(() => {
    setWorktreeLoading(true)
    fetch(`${api}/api/git/worktrees?project=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data) => setWorktrees(data.worktrees || []))
      .catch(() => setWorktrees([]))
      .finally(() => setWorktreeLoading(false))
  }, [projectId, api])

  useEffect(() => {
    if (!open) return
    setSelectedFile(null)
    setCommitResult(null)
    fetchStatus()
    fetchBranches()
    fetchWorktrees()
  }, [open, fetchStatus, fetchBranches, fetchWorktrees])

  // Track selectedFile in ref so app:back handler always has latest value
  const selectedFileRef = useRef(selectedFile)
  selectedFileRef.current = selectedFile

  // Hardware back via app:back — use capture phase + stopImmediatePropagation
  // so MissionControl's handler doesn't also fire (which would close the entire panel
  // when we only want to close a diff sub-view)
  useEffect(() => {
    if (!open) return
    const onBack = (e: Event) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (selectedFileRef.current) setSelectedFile(null)
      else onClose()
    }
    document.addEventListener("app:back", onBack, true)
    return () => document.removeEventListener("app:back", onBack, true)
  }, [open, onClose])

  // Swipe-down to dismiss
  const { sheetRef: panelRef, handlers: swipeHandlers } = useSwipeToDismiss({ onDismiss: onClose })

  // Load diff for file
  const openDiff = useCallback((filePath: string) => {
    setSelectedFile(filePath)
    setDiffLoading(true)
    setDiffPage(1)
    if (slideRef.current) {
      slideRef.current.style.transition = "none"
      slideRef.current.style.transform = "translateX(-50%)"
    }
    fetch(`${api}/api/git/diff?project=${encodeURIComponent(projectId)}&file=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((data) => { setDiffBefore(data.before || ""); setDiffAfter(data.after || "") })
      .catch(() => { setDiffBefore(""); setDiffAfter("Error loading diff") })
      .finally(() => setDiffLoading(false))
  }, [projectId, api])

  // Commit
  const handleCommit = useCallback(() => {
    if (!commitMsg.trim()) return
    setCommitting(true)
    setCommitResult(null)
    fetch(`${api}/api/git/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: projectId, message: commitMsg.trim() }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setCommitResult({ ok: false, msg: data.error })
        else { setCommitResult({ ok: true, msg: `Committed: ${data.hash}` }); setCommitMsg(""); fetchStatus() }
      })
      .catch(() => setCommitResult({ ok: false, msg: "Commit failed" }))
      .finally(() => setCommitting(false))
  }, [projectId, commitMsg, fetchStatus, api])

  // Branch actions
  const handleDeleteBranch = useCallback((branchName: string, force = false) => {
    setBranchAction(branchName)
    fetch(`${api}/api/git/branch-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: projectId, branch: branchName, force }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          if (data.notMerged) {
            setConfirmDialog({
              title: t("git.forceDeleteBranch") || `${branchName} 尚未合併，確定要強制刪除？`,
              onConfirm: () => handleDeleteBranch(branchName, true),
            })
          } else {
            alert(data.error)
          }
        } else {
          fetchBranches()
        }
      })
      .catch(() => {})
      .finally(() => setBranchAction(""))
  }, [projectId, fetchBranches, api, t])

  const handleCheckout = useCallback((branchName: string) => {
    setBranchAction(branchName)
    fetch(`${api}/api/git/branch-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: projectId, branch: branchName }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) alert(data.error)
        else { fetchStatus(); fetchBranches() }
      })
      .catch(() => {})
      .finally(() => setBranchAction(""))
  }, [projectId, fetchStatus, fetchBranches, api])

  // Worktree actions
  const handleDeleteWorktree = useCallback((wtPath: string, force = false) => {
    setWorktreeAction(wtPath)
    fetch(`${api}/api/git/worktree-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: projectId, path: wtPath, force }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setConfirmDialog({
            title: t("git.forceDeleteWorktree") || `刪除失敗：${data.error}\n要強制刪除嗎？`,
            onConfirm: () => handleDeleteWorktree(wtPath, true),
          })
        } else {
          fetchWorktrees()
        }
      })
      .catch(() => {})
      .finally(() => setWorktreeAction(""))
  }, [projectId, fetchWorktrees, api, t])

  // Diff lines
  const diffLines = useMemo(() => {
    if (!selectedFile) return []
    return computeLineDiff(diffBefore, diffAfter)
  }, [selectedFile, diffBefore, diffAfter])

  // Diff swipe
  const dragRef = useRef({ startX: 0, dir: "", dragging: false, offset: 0, time: 0 })
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragRef.current = { startX: e.touches[0].clientX, dir: "", dragging: false, offset: 0, time: Date.now() }
  }, [])
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const d = dragRef.current
    const dx = e.touches[0].clientX - d.startX
    if (!d.dir) { if (Math.abs(dx) > 8) d.dir = "h"; else return }
    if (d.dir === "h") {
      e.preventDefault()
      d.dragging = true
      let offset = dx
      if ((diffPage === 0 && dx > 0) || (diffPage === 1 && dx < 0)) offset = dx * 0.15
      d.offset = offset
      if (slideRef.current) {
        slideRef.current.style.transition = "none"
        slideRef.current.style.transform = `translateX(calc(${-diffPage * 50}% + ${offset}px))`
      }
    }
  }, [diffPage])
  const onTouchEnd = useCallback(() => {
    const d = dragRef.current
    if (d.dir === "h" && d.dragging) {
      const threshold = window.innerWidth * 0.35
      const vel = Math.abs(d.offset) / Math.max(1, Date.now() - d.time)
      const triggered = Math.abs(d.offset) > threshold || (vel > 0.5 && Math.abs(d.offset) > 60)
      let p = diffPage
      if (triggered && d.offset > 0 && diffPage > 0) p = 0
      else if (triggered && d.offset < 0 && diffPage < 1) p = 1
      if (slideRef.current) {
        slideRef.current.style.transition = `transform 0.4s ${SPRING}`
        slideRef.current.style.transform = `translateX(${-p * 50}%)`
      }
      setDiffPage(p as 0 | 1)
    }
    dragRef.current = { startX: 0, dir: "", dragging: false, offset: 0, time: 0 }
  }, [diffPage])

  const renderDiffLines = (side: "before" | "after") => {
    if (diffLines.length === 0) {
      const content = side === "before" ? (diffBefore || "(empty)") : (diffAfter || "(empty)")
      return <pre style={{ margin: 0, padding: "12px 16px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.7 }}>{content}</pre>
    }
    return (
      <pre style={{ margin: 0, padding: "12px 0", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.7 }}>
        {diffLines.map((line, i) => {
          const isBefore = side === "before"
          if ((line.type === "add" && isBefore) || (line.type === "del" && !isBefore)) {
            return <div key={i} style={{ padding: "0 16px", minHeight: "1.7em", background: "var(--icon-bg)", opacity: 0.5 }}> </div>
          }
          const text = isBefore ? (line.before ?? "") : (line.after ?? "")
          let bg = "transparent", color = "var(--text-secondary)"
          if (line.type === "add") { bg = COLORS.addBg; color = COLORS.addText }
          else if (line.type === "del") { bg = COLORS.delBg; color = COLORS.delText }
          else if (line.type === "mod") { bg = isBefore ? COLORS.delBg : COLORS.addBg; color = isBefore ? COLORS.delText : COLORS.addText }
          return <div key={i} style={{ padding: "0 16px", background: bg, color, minHeight: "1.7em" }}>{text || " "}</div>
        })}
      </pre>
    )
  }

  // Tab swipe gesture (must be before early return to satisfy hooks rules)
  const TABS: Tab[] = ["changes", "branches", "worktrees"]
  const tabSwipeRef = useRef({ startX: 0, startY: 0, swiping: false })
  const onTabSwipeStart = useCallback((e: React.TouchEvent) => {
    tabSwipeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, swiping: false }
  }, [])
  const onTabSwipeEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - tabSwipeRef.current.startX
    const dy = e.changedTouches[0].clientY - tabSwipeRef.current.startY
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const idx = TABS.indexOf(tab)
      if (dx < 0 && idx < TABS.length - 1) setTab(TABS[idx + 1])
      else if (dx > 0 && idx > 0) setTab(TABS[idx - 1])
    }
  }, [tab])

  const statusColor: Record<string, string> = {
    modified: "#60a5fa",
    added: "#22c55e",
    untracked: "#22c55e",
    deleted: "#ef4444",
    renamed: "#fbbf24",
  }
  const statusLabel: Record<string, string> = {
    modified: "M", added: "A", untracked: "?", deleted: "D", renamed: "R",
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "8px 0", borderRadius: 10,
    border: "none", cursor: "pointer",
    background: active ? "var(--accent-primary)" : "transparent",
    color: active ? "#fff" : "var(--text-secondary)",
    fontSize: 12, fontWeight: 600,
    transition: "all 0.2s",
  })

  // Diff view
  if (selectedFile) {
    const fileName = selectedFile.split(/[\\/]/).pop() || selectedFile
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "var(--bg-gradient)",
        display: "flex", flexDirection: "column",
        color: "var(--text-primary)",
      }}>
        <div style={{
          flexShrink: 0, background: "var(--glass-bg)",
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid var(--glass-border)",
          paddingTop: "max(env(safe-area-inset-top), 12px)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 8px" }}>
            <button onClick={() => setSelectedFile(null)}
              style={{ width: 36, height: 36, borderRadius: 12, border: "1px solid var(--glass-border)", background: "var(--card-bg)", color: "var(--text-primary)", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {"←"}
            </button>
            <div style={{ flex: 1, fontSize: 15, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {fileName}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, paddingBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: diffPage === 0 ? COLORS.dotBefore : "var(--text-secondary)", opacity: diffPage === 0 ? 1 : 0.4 }}>Before</span>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: diffPage === 0 ? COLORS.dotBefore : "var(--glass-border)", transition: "background 0.3s" }} />
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: diffPage === 1 ? COLORS.dotAfter : "var(--glass-border)", transition: "background 0.3s" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: diffPage === 1 ? COLORS.dotAfter : "var(--text-secondary)", opacity: diffPage === 1 ? 1 : 0.4 }}>After</span>
          </div>
        </div>

        {diffLoading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", opacity: 0.6 }}>Loading diff...</div>
        ) : (
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
            <div ref={slideRef} style={{ display: "flex", width: "200%", height: "100%", transform: "translateX(-50%)", willChange: "transform" }}>
              <div style={{ width: "50%", height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch" as never }}>
                <div style={{ margin: 12, background: "var(--card-bg)", borderRadius: 16, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid var(--glass-border)", overflow: "hidden" }}>
                  {renderDiffLines("before")}
                </div>
              </div>
              <div style={{ width: "50%", height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch" as never }}>
                <div style={{ margin: 12, background: "var(--card-bg)", borderRadius: 16, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid var(--glass-border)", overflow: "hidden" }}>
                  {renderDiffLines("after")}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Tab content helpers
  const localBranches = branches.filter(b => !b.isRemote)
  const remoteBranches = branches.filter(b => b.isRemote)

  // Main view with tabs
  return (
    <SpringOverlay open={open}>
    <div
      ref={panelRef}
      {...swipeHandlers}
      style={{
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
        {/* Drag handle for swipe-to-dismiss */}
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: "var(--text-secondary)", opacity: 0.3,
          margin: "8px auto 0",
        }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 8px" }}>
          <button onClick={onClose}
            style={{ width: 36, height: 36, borderRadius: 12, border: "1px solid var(--glass-border)", background: "var(--card-bg)", color: "var(--text-primary)", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {"←"}
          </button>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 600 }}>Git</div>
          {branch && (
            <span style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 20,
              background: "var(--card-bg)", border: "1px solid var(--glass-border)",
              color: "var(--text-secondary)", fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -1, marginRight: 4 }}>
                <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              {branch}
            </span>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, padding: "4px 16px 10px", background: "var(--glass-bg)" }}>
          <button onClick={() => setTab("changes")} style={tabStyle(tab === "changes")}>
            {t("git.changes") || "Changes"} {files.length > 0 ? `(${files.length})` : ""}
          </button>
          <button onClick={() => setTab("branches")} style={tabStyle(tab === "branches")}>
            {t("git.branches") || "Branches"}
          </button>
          <button onClick={() => setTab("worktrees")} style={tabStyle(tab === "worktrees")}>
            {t("git.worktrees") || "Worktrees"}
          </button>
        </div>
      </div>

      {/* Tab content — swipe left/right to switch tabs */}
      <div onTouchStart={onTabSwipeStart} onTouchEnd={onTabSwipeEnd} style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8, WebkitOverflowScrolling: "touch" as never }}>

        {/* ── Changes tab ── */}
        {tab === "changes" && (<>
          {loading && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)", opacity: 0.6 }}>Loading...</div>}
          {error && <div style={{ textAlign: "center", padding: 40, color: "#f87171" }}>{error}</div>}
          {!loading && !error && files.length === 0 && (
            <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)", opacity: 0.5 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Working tree clean</div>
              <div style={{ fontSize: 12, marginTop: 8, opacity: 0.7 }}>{t("git.noChanges") || "No changes to commit"}</div>
            </div>
          )}
          {files.map((f) => {
            const fileName = f.path.split(/[\\/]/).pop() || f.path
            const dirPath = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""
            return (
              <button key={f.path} onClick={() => openDiff(f.path)} style={{
                padding: "14px 16px", borderRadius: 16,
                border: "1px solid var(--glass-border)",
                borderLeft: `4px solid ${statusColor[f.status] || "#60a5fa"}`,
                background: "var(--glass-bg)",
                backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
                boxShadow: "var(--glass-shadow)",
                color: "var(--text-primary)", textAlign: "left", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 12,
                transition: `all 0.2s ${SPRING}`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {fileName}
                  </div>
                  {dirPath && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2, opacity: 0.6 }}>{dirPath}</div>}
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                  background: `${statusColor[f.status] || "#60a5fa"}20`,
                  color: statusColor[f.status] || "#60a5fa",
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {statusLabel[f.status] || f.xy}
                </span>
              </button>
            )
          })}
        </>)}

        {/* ── Branches tab ── */}
        {tab === "branches" && (<>
          {branchLoading && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)", opacity: 0.6 }}>Loading...</div>}

          {/* Local branches */}
          {localBranches.length > 0 && (
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", opacity: 0.5, padding: "8px 4px 4px", textTransform: "uppercase", letterSpacing: 1 }}>
              Local
            </div>
          )}
          {localBranches.map((b) => (
            <div key={b.name} style={{
              padding: "12px 16px", borderRadius: 16,
              border: "1px solid var(--glass-border)",
              borderLeft: b.current ? "4px solid var(--accent-primary)" : "4px solid transparent",
              background: "var(--glass-bg)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={b.current ? "var(--accent-primary)" : "var(--text-secondary)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: b.current ? 700 : 500, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: b.current ? "var(--accent-primary)" : "var(--text-primary)" }}>
                  {b.name}
                </div>
                {b.current && <div style={{ fontSize: 10, color: "var(--accent-primary)", marginTop: 2 }}>{t("git.currentBranch") || "current"}</div>}
              </div>
              {/* Actions */}
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {/* New session on this branch */}
                {onNewSession && (
                  <button onClick={() => onNewSession(b.name)} title={t("git.newSessionOnBranch") || "New session"} style={{
                    width: 28, height: 28, borderRadius: 8,
                    border: "1px solid var(--glass-border)", background: "var(--card-bg)",
                    color: "var(--accent-primary)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                )}
                {/* Checkout (if not current) */}
                {!b.current && (
                  <button onClick={() => handleCheckout(b.name)} disabled={branchAction === b.name} title={t("git.checkout") || "Checkout"} style={{
                    width: 28, height: 28, borderRadius: 8,
                    border: "1px solid var(--glass-border)", background: "var(--card-bg)",
                    color: "var(--text-secondary)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: branchAction === b.name ? 0.4 : 1,
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 10 4 15 9 20" /><path d="M20 4v7a4 4 0 0 1-4 4H4" />
                    </svg>
                  </button>
                )}
                {/* Delete (if not current) */}
                {!b.current && (
                  <button onClick={() => {
                    setConfirmDialog({
                      title: `${t("git.deleteBranch") || "刪除 branch"} "${b.name}"？`,
                      onConfirm: () => handleDeleteBranch(b.name),
                    })
                  }} disabled={branchAction === b.name} title={t("git.delete") || "Delete"} style={{
                    width: 28, height: 28, borderRadius: 8,
                    border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)",
                    color: "#ef4444", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: branchAction === b.name ? 0.4 : 1,
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Remote branches */}
          {remoteBranches.length > 0 && (
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", opacity: 0.5, padding: "16px 4px 4px", textTransform: "uppercase", letterSpacing: 1 }}>
              Remote
            </div>
          )}
          {remoteBranches.map((b) => (
            <div key={b.name} style={{
              padding: "10px 16px", borderRadius: 16,
              border: "1px solid var(--glass-border)",
              background: "var(--glass-bg)", opacity: 0.7,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <div style={{ flex: 1, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-secondary)" }}>
                {b.name}
              </div>
            </div>
          ))}

          {!branchLoading && branches.length === 0 && (
            <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)", opacity: 0.5 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{t("git.noBranches") || "No branches found"}</div>
            </div>
          )}
        </>)}

        {/* ── Worktrees tab ── */}
        {tab === "worktrees" && (<>
          {worktreeLoading && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)", opacity: 0.6 }}>Loading...</div>}
          {worktrees.map((wt, i) => {
            const dirName = wt.path.split(/[\\/]/).pop() || wt.path
            const isMain = i === 0 // first worktree is the main repo
            return (
              <div key={wt.path} style={{
                padding: "14px 16px", borderRadius: 16,
                border: "1px solid var(--glass-border)",
                borderLeft: isMain ? "4px solid var(--accent-primary)" : "4px solid #f59e0b",
                background: "var(--glass-bg)",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isMain ? "var(--accent-primary)" : "#f59e0b"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {dirName}
                  </div>
                  {wt.branch && (
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
                      </svg>
                      {wt.branch}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2, opacity: 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {wt.path}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {/* New session on this worktree's branch */}
                  {onNewSession && wt.branch && (
                    <button onClick={() => onNewSession(wt.branch)} title={t("git.newSessionOnBranch") || "New session"} style={{
                      width: 28, height: 28, borderRadius: 8,
                      border: "1px solid var(--glass-border)", background: "var(--card-bg)",
                      color: "var(--accent-primary)", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                  )}
                  {/* Delete (not for main worktree) */}
                  {!isMain && (
                    <button onClick={() => {
                      setConfirmDialog({
                        title: `${t("git.deleteWorktree") || "刪除 worktree"} "${dirName}"？`,
                        onConfirm: () => handleDeleteWorktree(wt.path),
                      })
                    }} disabled={worktreeAction === wt.path} title={t("git.delete") || "Delete"} style={{
                      width: 28, height: 28, borderRadius: 8,
                      border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)",
                      color: "#ef4444", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      opacity: worktreeAction === wt.path ? 0.4 : 1,
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {!worktreeLoading && worktrees.length === 0 && (
            <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)", opacity: 0.5 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{t("git.noWorktrees") || "No worktrees"}</div>
            </div>
          )}
        </>)}
      </div>

      {/* Commit area (only on Changes tab with changes) */}
      {tab === "changes" && files.length > 0 && (
        <div style={{
          flexShrink: 0, padding: "12px 16px",
          paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
          background: "var(--glass-bg)",
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          borderTop: "1px solid var(--glass-border)",
        }}>
          {commitResult && (
            <div style={{
              padding: "8px 12px", borderRadius: 10, marginBottom: 8,
              fontSize: 12, fontWeight: 600,
              background: commitResult.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
              color: commitResult.ok ? "#22c55e" : "#ef4444",
              border: `1px solid ${commitResult.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
            }}>
              {commitResult.msg}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCommit() }}
              placeholder="Commit message..."
              style={{
                flex: 1, padding: "12px 16px", borderRadius: 14,
                border: "1px solid var(--glass-border)",
                background: "var(--icon-bg)",
                color: "var(--text-primary)",
                fontSize: 14, outline: "none",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            />
            <button
              onClick={handleCommit}
              disabled={committing || !commitMsg.trim()}
              style={{
                padding: "12px 20px", borderRadius: 14,
                border: "none",
                background: commitMsg.trim() ? "var(--accent-primary)" : "var(--glass-bg)",
                color: commitMsg.trim() ? "#fff" : "var(--text-secondary)",
                fontSize: 13, fontWeight: 700,
                cursor: commitMsg.trim() ? "pointer" : "default",
                opacity: committing ? 0.5 : 1,
                flexShrink: 0,
              }}
            >
              {committing ? "..." : "Commit"}
            </button>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.5, marginTop: 6, textAlign: "center" }}>
            {files.length} file{files.length > 1 ? "s" : ""} changed — Stage All & Commit
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmDialog && (
        <div onClick={() => setConfirmDialog(null)} style={{
          position: "fixed", inset: 0, zIndex: 10001,
          background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 32,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "var(--glass-bg, #1a1a2e)",
            backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
            border: "1px solid var(--glass-border, rgba(255,255,255,0.1))",
            borderRadius: 20, padding: "24px 20px 16px",
            maxWidth: 300, width: "100%", textAlign: "center",
          }}>
            <div style={{ fontSize: 14, color: "var(--text-primary, #fff)", marginBottom: 20, lineHeight: 1.5, whiteSpace: "pre-line" }}>
              {confirmDialog.title}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmDialog(null)} style={{
                flex: 1, padding: "10px 0", borderRadius: 12,
                border: "1px solid var(--glass-border, rgba(255,255,255,0.1))",
                background: "transparent",
                color: "var(--text-secondary, rgba(255,255,255,0.6))",
                fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}>
                {t("app.cancel") || "Cancel"}
              </button>
              <button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null) }} style={{
                flex: 1, padding: "10px 0", borderRadius: 12,
                border: "none",
                background: "rgba(239,68,68,0.15)",
                color: "#ef4444",
                fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}>
                {t("git.delete") || "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </SpringOverlay>
  )
}
