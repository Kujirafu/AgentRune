import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { getApiBase } from "../lib/storage"
import { useLocale } from "../lib/i18n/index.js"

const SPRING = "cubic-bezier(0.16, 1, 0.3, 1)"
const COLORS = {
  addBg: "rgba(34, 197, 94, 0.15)", addText: "#22c55e",
  delBg: "rgba(239, 68, 68, 0.15)", delText: "#ef4444",
  dotBefore: "#ef4444", dotAfter: "#22c55e",
}

interface GitFile { path: string; status: string; staged: boolean; xy: string }
interface GitPanelProps { open: boolean; projectId: string; onClose: () => void }
interface DiffLine { type: "same" | "add" | "del" | "mod"; before?: string; after?: string }

function computeLineDiff(beforeText: string, afterText: string): DiffLine[] {
  const a = beforeText.split("\n"), b = afterText.split("\n")
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  const stack: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) { stack.push({ type: "same", before: a[i - 1], after: b[j - 1] }); i--; j-- }
    else if (i > 0 && j > 0 && dp[i - 1][j - 1] >= dp[i - 1][j] && dp[i - 1][j - 1] >= dp[i][j - 1]) { stack.push({ type: "mod", before: a[i - 1], after: b[j - 1] }); i--; j-- }
    else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { stack.push({ type: "add", after: b[j - 1] }); j-- }
    else { stack.push({ type: "del", before: a[i - 1] }); i-- }
  }
  stack.reverse()
  return stack
}

export function GitPanel({ open, projectId, onClose }: GitPanelProps) {
  const { t } = useLocale()
  const [branch, setBranch] = useState("")
  const [files, setFiles] = useState<GitFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffBefore, setDiffBefore] = useState("")
  const [diffAfter, setDiffAfter] = useState("")
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffPage, setDiffPage] = useState<0 | 1>(1)
  const slideRef = useRef<HTMLDivElement>(null)
  const [commitMsg, setCommitMsg] = useState("")
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const fetchStatus = useCallback(() => {
    setLoading(true); setError("")
    fetch(`${getApiBase()}/api/git/status?project=${encodeURIComponent(projectId)}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data) => { if (data.error) setError(data.error); else { setBranch(data.branch); setFiles(data.files) } })
      .catch((e) => setError(`Failed to fetch git status: ${e.message}`))
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => { if (open) { fetchStatus(); setSelectedFile(null); setCommitResult(null) } }, [open, fetchStatus])

  useEffect(() => {
    if (!open) return
    history.pushState({ gitPanel: true }, "")
    const handler = () => { if (selectedFile) setSelectedFile(null); else onClose() }
    window.addEventListener("popstate", handler)
    return () => window.removeEventListener("popstate", handler)
  }, [open, onClose, selectedFile])

  const handleClose = useCallback(() => { onClose(); history.back() }, [onClose])

  const openDiff = useCallback((filePath: string) => {
    setSelectedFile(filePath); setDiffLoading(true); setDiffPage(1)
    if (slideRef.current) { slideRef.current.style.transition = "none"; slideRef.current.style.transform = "translateX(-100%)" }
    fetch(`${getApiBase()}/api/git/diff?project=${encodeURIComponent(projectId)}&file=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((data) => { setDiffBefore(data.before || ""); setDiffAfter(data.after || "") })
      .catch(() => { setDiffBefore(""); setDiffAfter("Error loading diff") })
      .finally(() => setDiffLoading(false))
  }, [projectId])

  const handleCommit = useCallback(() => {
    if (!commitMsg.trim()) return
    setCommitting(true); setCommitResult(null)
    fetch(`${getApiBase()}/api/git/commit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: projectId, message: commitMsg.trim() }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setCommitResult({ ok: false, msg: data.error })
        else { setCommitResult({ ok: true, msg: `Committed: ${data.hash}` }); setCommitMsg(""); fetchStatus() }
      })
      .catch(() => setCommitResult({ ok: false, msg: "Commit failed" }))
      .finally(() => setCommitting(false))
  }, [projectId, commitMsg, fetchStatus])

  const diffLines = useMemo(() => {
    if (!selectedFile) return []
    return computeLineDiff(diffBefore, diffAfter)
  }, [selectedFile, diffBefore, diffAfter])

  const dragRef = useRef({ startX: 0, dir: "", dragging: false, offset: 0, time: 0 })
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragRef.current = { startX: e.touches[0].clientX, dir: "", dragging: false, offset: 0, time: Date.now() }
  }, [])
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const d = dragRef.current; const dx = e.touches[0].clientX - d.startX
    if (!d.dir) { if (Math.abs(dx) > 8) d.dir = "h"; else return }
    if (d.dir === "h") {
      e.preventDefault(); d.dragging = true
      let offset = dx; if ((diffPage === 0 && dx > 0) || (diffPage === 1 && dx < 0)) offset = dx * 0.15
      d.offset = offset
      if (slideRef.current) { slideRef.current.style.transition = "none"; slideRef.current.style.transform = `translateX(calc(${-diffPage * 100}% + ${offset}px))` }
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
      if (slideRef.current) { slideRef.current.style.transition = `transform 0.4s ${SPRING}`; slideRef.current.style.transform = `translateX(${-p * 100}%)` }
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
          if ((line.type === "add" && isBefore) || (line.type === "del" && !isBefore))
            return <div key={i} style={{ padding: "0 16px", minHeight: "1.7em", background: "var(--icon-bg)", opacity: 0.5 }}> </div>
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

  if (!open) return null

  const statusColor: Record<string, string> = { modified: "#60a5fa", added: "#22c55e", untracked: "#22c55e", deleted: "#ef4444", renamed: "#fbbf24" }
  const statusLabel: Record<string, string> = { modified: "M", added: "A", untracked: "?", deleted: "D", renamed: "R" }

  if (selectedFile) {
    const fileName = selectedFile.split(/[\\/]/).pop() || selectedFile
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "var(--bg-gradient)", display: "flex", flexDirection: "column", color: "var(--text-primary)" }}>
        <div style={{ flexShrink: 0, background: "var(--glass-bg)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderBottom: "1px solid var(--glass-border)", paddingTop: "max(env(safe-area-inset-top), 12px)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 8px" }}>
            <button onClick={() => { setSelectedFile(null); history.back() }} style={{ width: 36, height: 36, borderRadius: 12, border: "1px solid var(--glass-border)", background: "var(--card-bg)", color: "var(--text-primary)", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{"\u2190"}</button>
            <div style={{ flex: 1, fontSize: 15, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</div>
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
            <div ref={slideRef} style={{ display: "flex", width: "200%", height: "100%", transform: "translateX(-100%)", willChange: "transform" }}>
              <div style={{ width: "50%", height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch" as never }}>
                <div style={{ margin: 12, background: "var(--card-bg)", borderRadius: 16, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid var(--glass-border)", overflow: "hidden" }}>{renderDiffLines("before")}</div>
              </div>
              <div style={{ width: "50%", height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch" as never }}>
                <div style={{ margin: 12, background: "var(--card-bg)", borderRadius: 16, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid var(--glass-border)", overflow: "hidden" }}>{renderDiffLines("after")}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "var(--bg-gradient)", display: "flex", flexDirection: "column", color: "var(--text-primary)", animation: `fadeSlideUp 0.3s ${SPRING}` }}>
      <div style={{ flexShrink: 0, background: "var(--glass-bg)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderBottom: "1px solid var(--glass-border)", paddingTop: "max(env(safe-area-inset-top), 12px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 10px" }}>
          <button onClick={handleClose} style={{ width: 36, height: 36, borderRadius: 12, border: "1px solid var(--glass-border)", background: "var(--card-bg)", color: "var(--text-primary)", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{"\u2190"}</button>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 600 }}>Git</div>
          {branch && (
            <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, background: "var(--card-bg)", border: "1px solid var(--glass-border)", color: "var(--text-secondary)", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: -1, marginRight: 4 }}>
                <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              {branch}
            </span>
          )}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8, WebkitOverflowScrolling: "touch" as never }}>
        {loading && <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)", opacity: 0.6 }}>Loading...</div>}
        {error && <div style={{ textAlign: "center", padding: 40, color: "#f87171" }}>{error}</div>}
        {!loading && !error && files.length === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-secondary)", opacity: 0.5 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Working tree clean</div>
            <div style={{ fontSize: 12, marginTop: 8, opacity: 0.7 }}>No changes to commit</div>
          </div>
        )}
        {files.map((f) => {
          const fileName = f.path.split(/[\\/]/).pop() || f.path
          const dirPath = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""
          return (
            <button key={f.path} onClick={() => openDiff(f.path)} style={{
              padding: "14px 16px", borderRadius: 16,
              border: "1px solid var(--glass-border)", borderLeft: `4px solid ${statusColor[f.status] || "#60a5fa"}`,
              background: "var(--glass-bg)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
              boxShadow: "var(--glass-shadow)", color: "var(--text-primary)", textAlign: "left",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 12, transition: `all 0.2s ${SPRING}`,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</div>
                {dirPath && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2, opacity: 0.6 }}>{dirPath}</div>}
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: `${statusColor[f.status] || "#60a5fa"}20`, color: statusColor[f.status] || "#60a5fa", fontFamily: "'JetBrains Mono', monospace" }}>
                {statusLabel[f.status] || f.xy}
              </span>
            </button>
          )
        })}
      </div>
      {files.length > 0 && (
        <div style={{ flexShrink: 0, padding: "12px 16px", paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))", background: "var(--glass-bg)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderTop: "1px solid var(--glass-border)" }}>
          {commitResult && (
            <div style={{ padding: "8px 12px", borderRadius: 10, marginBottom: 8, fontSize: 12, fontWeight: 600, background: commitResult.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: commitResult.ok ? "#22c55e" : "#ef4444", border: `1px solid ${commitResult.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` }}>
              {commitResult.msg}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCommit() }}
              placeholder="Commit message..." style={{ flex: 1, padding: "12px 16px", borderRadius: 14, border: "1px solid var(--glass-border)", background: "var(--icon-bg)", color: "var(--text-primary)", fontSize: 14, outline: "none", fontFamily: "'JetBrains Mono', monospace" }} />
            <button onClick={handleCommit} disabled={committing || !commitMsg.trim()} style={{
              padding: "12px 20px", borderRadius: 14, border: "none",
              background: commitMsg.trim() ? "var(--accent-primary)" : "var(--glass-bg)",
              color: commitMsg.trim() ? "#fff" : "var(--text-secondary)",
              fontSize: 13, fontWeight: 700, cursor: commitMsg.trim() ? "pointer" : "default",
              opacity: committing ? 0.5 : 1, flexShrink: 0,
            }}>
              {committing ? "..." : "Commit"}
            </button>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.5, marginTop: 6, textAlign: "center" }}>
            {files.length} file{files.length > 1 ? "s" : ""} changed — Stage All & Commit
          </div>
        </div>
      )}
    </div>
  )
}
