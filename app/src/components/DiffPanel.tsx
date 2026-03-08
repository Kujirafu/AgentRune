// web/components/DiffPanel.tsx
import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import type { AgentEvent } from "../types"
import { useLocale } from "../lib/i18n"

// ─── Types ──────────────────────────────────────────────────────
interface DiffPanelProps {
  event: AgentEvent | null
  allDiffEvents: AgentEvent[]
  onClose: () => void
  onSelectEvent: (e: AgentEvent) => void
  projectId?: string
  apiBase?: string
  onSendEdit?: (instruction: string) => void
  onVoiceInput?: (callback: (text: string) => void, label?: string) => void
}

interface DiffLine {
  type: "same" | "add" | "del" | "mod"
  before?: string
  after?: string
  lineIndex: number // global index in diffLines array
}

interface DiffHunk {
  id: number
  startIndex: number
  endIndex: number  // exclusive
  lines: DiffLine[]
  staged: boolean
}

interface InlineComment {
  lineIndex: number
  text: string
  timestamp: number
}

// ─── LCS-based line diff ────────────────────────────────────────
function computeLineDiff(beforeText: string, afterText: string): DiffLine[] {
  const a = beforeText.split("\n")
  const b = afterText.split("\n")
  const m = a.length
  const n = b.length

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack to produce diff
  const stack: DiffLine[] = []
  let i = m, j = n
  let idx = 0
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      stack.push({ type: "same", before: a[i - 1], after: b[j - 1], lineIndex: idx++ })
      i--; j--
    } else if (i > 0 && j > 0 && dp[i - 1][j - 1] >= dp[i - 1][j] && dp[i - 1][j - 1] >= dp[i][j - 1]) {
      stack.push({ type: "mod", before: a[i - 1], after: b[j - 1], lineIndex: idx++ })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "add", after: b[j - 1], lineIndex: idx++ })
      j--
    } else {
      stack.push({ type: "del", before: a[i - 1], lineIndex: idx++ })
      i--
    }
  }
  stack.reverse()
  // Reassign lineIndex after reverse
  for (let k = 0; k < stack.length; k++) stack[k].lineIndex = k
  return stack
}

// ─── Group diff lines into hunks ────────────────────────────────
function groupIntoHunks(lines: DiffLine[], contextLines = 3): DiffHunk[] {
  if (lines.length === 0) return []

  // Find changed regions
  const changedIndices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== "same") changedIndices.push(i)
  }

  if (changedIndices.length === 0) return []

  // Build hunks with context
  const hunks: DiffHunk[] = []
  let hunkStart = Math.max(0, changedIndices[0] - contextLines)
  let hunkEnd = Math.min(lines.length, changedIndices[0] + contextLines + 1)

  for (let i = 1; i < changedIndices.length; i++) {
    const newStart = Math.max(0, changedIndices[i] - contextLines)
    const newEnd = Math.min(lines.length, changedIndices[i] + contextLines + 1)

    if (newStart <= hunkEnd) {
      // Merge with current hunk
      hunkEnd = newEnd
    } else {
      // Save current hunk and start new one
      hunks.push({
        id: hunks.length,
        startIndex: hunkStart,
        endIndex: hunkEnd,
        lines: lines.slice(hunkStart, hunkEnd),
        staged: false,
      })
      hunkStart = newStart
      hunkEnd = newEnd
    }
  }

  // Push last hunk
  hunks.push({
    id: hunks.length,
    startIndex: hunkStart,
    endIndex: hunkEnd,
    lines: lines.slice(hunkStart, hunkEnd),
    staged: false,
  })

  return hunks
}

// ─── SVG Icons ──────────────────────────────────────────────────
function CheckIcon({ size = 16, color = "#22c55e" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function XIcon({ size = 16, color = "#ef4444" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function MessageIcon({ size = 14, color = "var(--text-secondary)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function CheckAllIcon({ size = 16, color = "#22c55e" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 6 7 17 2 12" />
      <polyline points="22 10 13 21 11 19" />
    </svg>
  )
}

function UndoIcon({ size = 16, color = "#ef4444" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  )
}

function SendIcon({ size = 16, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function MicIcon({ size = 16, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

// ─── Inline edit helpers ─────────────────────────────────────
function formatLineRef(lines: Set<number>): string {
  if (lines.size === 0) return ""
  const sorted = [...lines].sort((a, b) => a - b)
  const ranges: string[] = []
  let start = sorted[0], end = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i]
    } else {
      ranges.push(start === end ? `L${start}` : `L${start}-L${end}`)
      start = end = sorted[i]
    }
  }
  ranges.push(start === end ? `L${start}` : `L${start}-L${end}`)
  return ranges.join(", ")
}

// ─── Comment storage helpers ────────────────────────────────────
function getCommentKey(filePath: string): string {
  return `diff-comments:${filePath}`
}

function loadComments(filePath: string): InlineComment[] {
  try {
    const raw = localStorage.getItem(getCommentKey(filePath))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveComments(filePath: string, comments: InlineComment[]) {
  localStorage.setItem(getCommentKey(filePath), JSON.stringify(comments))
}

// ─── Constants ──────────────────────────────────────────────────
const SPRING = "cubic-bezier(0.22, 1, 0.36, 1)"
const COLORS = {
  addBg: "rgba(34, 197, 94, 0.15)",
  addText: "#22c55e",
  delBg: "rgba(239, 68, 68, 0.15)",
  delText: "#ef4444",
  dotBefore: "#ef4444",
  dotAfter: "#22c55e",
  stageBg: "rgba(34, 197, 94, 0.08)",
  stageBorder: "rgba(34, 197, 94, 0.25)",
  revertBg: "rgba(239, 68, 68, 0.08)",
  revertBorder: "rgba(239, 68, 68, 0.25)",
}

// ─── Component ──────────────────────────────────────────────────
export function DiffPanel({ event, allDiffEvents, onClose, onSelectEvent, projectId, apiBase, onSendEdit, onVoiceInput }: DiffPanelProps) {
  const { t, locale } = useLocale()
  const speechLang = locale === "zh-TW" ? "zh-TW" : "en-US"
  const [page, setPage] = useState<0 | 1>(1) // 0=before, 1=after
  const slideRef = useRef<HTMLDivElement>(null)
  const beforeScrollRef = useRef<HTMLDivElement>(null)
  const afterScrollRef = useRef<HTMLDivElement>(null)
  const tabRowRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ startX: 0, startY: 0, direction: "", isDragging: false, offset: 0, startTime: 0 })

  // Git API fallback: fetch diff when event.diff is missing
  const [gitDiff, setGitDiff] = useState<{ before: string; after: string } | null>(null)
  const [gitDiffLoading, setGitDiffLoading] = useState(false)
  const gitDiffFetchedRef = useRef<string | null>(null)

  // Hunk states
  const [hunkStates, setHunkStates] = useState<Record<number, "staged" | "reverted" | null>>({})
  const [actionLoading, setActionLoading] = useState<number | null>(null) // hunk id being processed
  const [actionAllLoading, setActionAllLoading] = useState<"stage" | "revert" | null>(null)

  // Inline comments
  const [comments, setComments] = useState<InlineComment[]>([])
  const [commentingLine, setCommentingLine] = useState<number | null>(null)
  const [commentDraft, setCommentDraft] = useState("")
  const commentInputRef = useRef<HTMLInputElement>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Inline edit state
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set())
  const [editInput, setEditInput] = useState("")
  const [editSent, setEditSent] = useState(false)
  const editInputRef = useRef<HTMLInputElement>(null)
  const lineDragRef = useRef<{ active: boolean; startLine: number; lastLine: number }>({ active: false, startLine: 0, lastLine: 0 })

  // Voice input for edit bar (MediaRecorder + Whisper)
  const [isListening, setIsListening] = useState(false)
  const diffRecorderRef = useRef<MediaRecorder | null>(null)
  const diffChunksRef = useRef<Blob[]>([])
  const diffStreamRef = useRef<MediaStream | null>(null)

  const stopDiffRecording = useCallback(() => {
    const recorder = diffRecorderRef.current
    diffRecorderRef.current = null
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop() } catch {}
    }
    const stream = diffStreamRef.current
    diffStreamRef.current = null
    if (stream) stream.getTracks().forEach(t => t.stop())
    setIsListening(false)
  }, [])

  const transcribeDiffAudio = useCallback(async (audioBlob: Blob) => {
    const serverUrl = localStorage.getItem("agentrune_server") || ""
    if (!serverUrl || audioBlob.size < 100) return
    try {
      const res = await fetch(`${serverUrl}/api/voice-transcribe`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: audioBlob,
      })
      if (res.ok) {
        const data = await res.json()
        setEditInput(prev => prev ? prev + " " + (data.cleaned || data.text || "") : (data.cleaned || data.text || ""))
      }
    } catch {}
  }, [])

  const toggleVoice = useCallback(async () => {
    // Use shared voice overlay from MissionControl
    if (onVoiceInput) {
      const lines = Array.from(selectedLines).sort((a, b) => a - b)
      const label = lines.length > 0
        ? `已選取 L${lines[0] + 1}~L${lines[lines.length - 1] + 1}`
        : undefined
      console.log("[DiffPanel Voice] Calling onVoiceInput, label:", label)
      onVoiceInput((text: string) => {
        console.log("[DiffPanel Voice] Got result:", text)
        setEditInput(prev => prev ? prev + " " + text : text)
      }, label)
      return
    }
    // Fallback: native speech recognition directly
    console.log("[DiffPanel Voice] No onVoiceInput, using native STT")
    try {
      const { SpeechRecognition } = await import("@capacitor-community/speech-recognition")
      const perms = await SpeechRecognition.checkPermissions()
      if (perms.speechRecognition !== "granted") {
        await SpeechRecognition.requestPermissions()
      }
      setIsListening(true)
      const result = await SpeechRecognition.start({ language: speechLang, partialResults: false, popup: false })
      setIsListening(false)
      if (result?.matches?.[0]) {
        setEditInput(prev => prev ? prev + " " + result.matches![0] : result.matches![0])
      }
    } catch (err: any) {
      console.error("[DiffPanel Voice] Native STT failed:", err)
      setIsListening(false)
    }
  }, [isListening, onVoiceInput, selectedLines])

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopDiffRecording() }
  }, [stopDiffRecording])

  const open = event !== null

  // File path helpers
  const filePath = event?.diff?.filePath || event?.title?.replace(/^(Edited|Created) /, "") || "File"
  const fileName = filePath.split(/[\\/]/).pop() || filePath

  // Load comments when file changes
  useEffect(() => {
    if (filePath && filePath !== "File") {
      setComments(loadComments(filePath))
    }
  }, [filePath])

  // Focus comment input when opening
  useEffect(() => {
    if (commentingLine !== null && commentInputRef.current) {
      commentInputRef.current.focus()
    }
  }, [commentingLine])

  // Fetch diff from git API when event.diff is missing
  useEffect(() => {
    if (!event || event.diff) { setGitDiff(null); return }
    if (!projectId || !apiBase) { setGitDiff(null); return }
    const fp = event.title?.replace(/^(Edited|Created) /, "") || ""
    if (!fp || fp === "File") { setGitDiff(null); return }
    const key = `${event.id}:${fp}`
    if (gitDiffFetchedRef.current === key) return
    gitDiffFetchedRef.current = key
    setGitDiffLoading(true)
    fetch(`${apiBase}/api/git/diff?project=${encodeURIComponent(projectId)}&file=${encodeURIComponent(fp)}`)
      .then(r => r.json())
      .then((data: { before?: string; after?: string }) => {
        if (data.before || data.after) {
          setGitDiff({ before: data.before || "", after: data.after || "" })
        } else {
          setGitDiff(null)
        }
      })
      .catch(() => setGitDiff(null))
      .finally(() => setGitDiffLoading(false))
  }, [event, projectId, apiBase])

  // Use event.diff if available, otherwise gitDiff
  const activeDiff = event?.diff || (gitDiff ? { filePath, before: gitDiff.before, after: gitDiff.after } : null)
  const hasDiff = !!activeDiff

  // ─── Compute diff lines & hunks ───────────────────────────────
  const diffLines = useMemo(() => {
    if (!activeDiff) return []
    return computeLineDiff(activeDiff.before || "", activeDiff.after || "")
  }, [activeDiff?.before, activeDiff?.after])

  const hunks = useMemo(() => groupIntoHunks(diffLines), [diffLines])

  // Compute line numbers for each DiffLine (1-based)
  const lineNumbers = useMemo(() => {
    const map = new Map<number, { beforeNum?: number; afterNum?: number }>()
    let bNum = 0, aNum = 0
    for (const line of diffLines) {
      const entry: { beforeNum?: number; afterNum?: number } = {}
      if (line.type === "same" || line.type === "mod" || line.type === "del") {
        bNum++
        entry.beforeNum = bNum
      }
      if (line.type === "same" || line.type === "mod" || line.type === "add") {
        aNum++
        entry.afterNum = aNum
      }
      map.set(line.lineIndex, entry)
    }
    return map
  }, [diffLines])

  // Reset hunk states when event changes
  useEffect(() => {
    setHunkStates({})
    setCommentingLine(null)
    setCommentDraft("")
    setSelectedLines(new Set())
  }, [event])

  // ─── Stage/Revert API calls ───────────────────────────────────
  const callGitAction = useCallback(async (action: "stage" | "revert", hunkIds?: number[]) => {
    if (!apiBase || !projectId) return
    const fp = activeDiff?.filePath || filePath
    if (!fp || fp === "File") return

    try {
      const resp = await fetch(`${apiBase}/api/git/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectId, filePath: fp, hunks: hunkIds }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || `${action} failed`)
      return true
    } catch {
      return false
    }
  }, [apiBase, projectId, activeDiff?.filePath, filePath])

  const handleHunkAction = useCallback(async (hunkId: number, action: "stage" | "revert") => {
    setActionLoading(hunkId)
    const ok = await callGitAction(action, [hunkId])
    if (ok) {
      setHunkStates(prev => ({ ...prev, [hunkId]: action === "stage" ? "staged" : "reverted" }))
    }
    setActionLoading(null)
  }, [callGitAction])

  const handleAllAction = useCallback(async (action: "stage" | "revert") => {
    setActionAllLoading(action)
    const ok = await callGitAction(action)
    if (ok) {
      const newStates: Record<number, "staged" | "reverted"> = {}
      for (const h of hunks) {
        newStates[h.id] = action === "stage" ? "staged" : "reverted"
      }
      setHunkStates(newStates)
    }
    setActionAllLoading(null)
  }, [callGitAction, hunks])

  // ─── Comment handlers ─────────────────────────────────────────
  const handleLongPressStart = useCallback((lineIndex: number) => {
    longPressRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(30)
      setCommentingLine(lineIndex)
      setCommentDraft("")
    }, 500)
  }, [])

  const handleLongPressEnd = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }, [])

  const submitComment = useCallback(() => {
    if (commentingLine === null || !commentDraft.trim()) return
    const newComment: InlineComment = {
      lineIndex: commentingLine,
      text: commentDraft.trim(),
      timestamp: Date.now(),
    }
    const updated = [...comments.filter(c => c.lineIndex !== commentingLine), newComment]
    setComments(updated)
    saveComments(filePath, updated)
    setCommentingLine(null)
    setCommentDraft("")
  }, [commentingLine, commentDraft, comments, filePath])

  const deleteComment = useCallback((lineIndex: number) => {
    const updated = comments.filter(c => c.lineIndex !== lineIndex)
    setComments(updated)
    saveComments(filePath, updated)
  }, [comments, filePath])

  // ─── Swipe position ───────────────────────────────────────────
  const goToPage = useCallback((p: 0 | 1) => {
    if (slideRef.current) {
      slideRef.current.style.transition = `transform 0.4s ${SPRING}`
      slideRef.current.style.transform = `translateX(${-p * 50}%)`
    }
    // Sync scroll
    if (p === 0 && afterScrollRef.current && beforeScrollRef.current) {
      beforeScrollRef.current.scrollTop = afterScrollRef.current.scrollTop
    } else if (p === 1 && beforeScrollRef.current && afterScrollRef.current) {
      afterScrollRef.current.scrollTop = beforeScrollRef.current.scrollTop
    }
    setPage(p)
  }, [])

  // Reset to After page when event changes
  useEffect(() => {
    if (event) {
      setPage(1)
      if (slideRef.current) {
        slideRef.current.style.transition = "none"
        slideRef.current.style.transform = "translateX(-50%)"
      }
    }
  }, [event])

  // Auto-scroll active tab into view
  useEffect(() => {
    if (!tabRowRef.current || !event) return
    const idx = allDiffEvents.findIndex(e => e === event)
    const btn = tabRowRef.current.children[idx] as HTMLElement | undefined
    btn?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" })
  }, [event, allDiffEvents])

  // ─── Hardware back (Android Capacitor) ─────────────────────
  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [open, onClose])

  // ─── Touch handlers (same pattern as MissionControl) ────────
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      direction: "", isDragging: false, offset: 0, startTime: Date.now(),
    }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const d = dragRef.current
    const dx = e.touches[0].clientX - d.startX
    const dy = e.touches[0].clientY - d.startY

    if (!d.direction) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        d.direction = Math.abs(dx) > Math.abs(dy) ? "h" : "v"
      }
      return
    }

    if (d.direction === "h") {
      e.preventDefault()
      d.isDragging = true
      // Rubber band at edges
      let offset = dx
      if ((page === 0 && dx > 0) || (page === 1 && dx < 0)) {
        offset = dx * 0.15
      }
      d.offset = offset
      if (slideRef.current) {
        slideRef.current.style.transition = "none"
        slideRef.current.style.transform = `translateX(calc(${-page * 50}% + ${offset}px))`
      }
    }
  }, [page])

  const onTouchEnd = useCallback(() => {
    const d = dragRef.current
    if (d.direction === "h" && d.isDragging) {
      const threshold = window.innerWidth * 0.35
      const elapsed = Math.max(1, Date.now() - d.startTime)
      const velocity = Math.abs(d.offset) / elapsed
      const triggered = Math.abs(d.offset) > threshold || (velocity > 0.5 && Math.abs(d.offset) > 60)
      let newPage = page
      if (triggered && d.offset > 0 && page > 0) newPage = 0 as 0 | 1
      else if (triggered && d.offset < 0 && page < 1) newPage = 1 as 0 | 1
      goToPage(newPage as 0 | 1)
    }
    dragRef.current = { startX: 0, startY: 0, direction: "", isDragging: false, offset: 0, startTime: 0 }
  }, [page, goToPage])

  // ─── Render hunk header bar ───────────────────────────────────
  const renderHunkHeader = (hunk: DiffHunk) => {
    const state = hunkStates[hunk.id]
    const isLoading = actionLoading === hunk.id
    const changedCount = hunk.lines.filter(l => l.type !== "same").length

    return (
      <div
        key={`hunk-header-${hunk.id}`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          background: state === "staged" ? COLORS.stageBg
            : state === "reverted" ? COLORS.revertBg
            : "var(--glass-bg)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--glass-border)",
          borderTop: hunk.id > 0 ? "1px solid var(--glass-border)" : "none",
          gap: 8,
          minHeight: 36,
          transition: "background 0.3s ease",
        }}
      >
        {/* Hunk info */}
        <div style={{
          fontSize: 10,
          fontWeight: 600,
          color: "var(--text-secondary)",
          fontFamily: "'JetBrains Mono', monospace",
          opacity: 0.7,
        }}>
          Hunk {hunk.id + 1} -- {changedCount} change{changedCount !== 1 ? "s" : ""}
          {state === "staged" && <span style={{ color: COLORS.addText, marginLeft: 6 }}>STAGED</span>}
          {state === "reverted" && <span style={{ color: COLORS.delText, marginLeft: 6 }}>REVERTED</span>}
        </div>

        {/* Action buttons */}
        {!state && apiBase && projectId && (
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => handleHunkAction(hunk.id, "stage")}
              disabled={isLoading}
              title="Stage this hunk"
              style={{
                width: 28, height: 28, borderRadius: 8,
                border: `1px solid ${COLORS.stageBorder}`,
                background: COLORS.stageBg,
                cursor: isLoading ? "wait" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: isLoading ? 0.5 : 1,
                transition: "all 0.2s ease",
              }}
            >
              <CheckIcon size={14} />
            </button>
            <button
              onClick={() => handleHunkAction(hunk.id, "revert")}
              disabled={isLoading}
              title="Revert this hunk"
              style={{
                width: 28, height: 28, borderRadius: 8,
                border: `1px solid ${COLORS.revertBorder}`,
                background: COLORS.revertBg,
                cursor: isLoading ? "wait" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: isLoading ? 0.5 : 1,
                transition: "all 0.2s ease",
              }}
            >
              <XIcon size={14} />
            </button>
          </div>
        )}
      </div>
    )
  }

  // ─── Inline edit: line selection handlers ────────────────────
  const handleLineNumberTap = useCallback((afterLineNum: number) => {
    setSelectedLines(prev => {
      const next = new Set(prev)
      if (next.has(afterLineNum)) {
        next.delete(afterLineNum)
      } else {
        next.add(afterLineNum)
      }
      return next
    })
  }, [])

  const handleLineDragStart = useCallback((afterLineNum: number) => {
    lineDragRef.current = { active: true, startLine: afterLineNum, lastLine: afterLineNum }
  }, [])

  const handleLineDragMove = useCallback((afterLineNum: number) => {
    if (!lineDragRef.current.active) return
    const { startLine } = lineDragRef.current
    if (afterLineNum === lineDragRef.current.lastLine) return
    lineDragRef.current.lastLine = afterLineNum
    const lo = Math.min(startLine, afterLineNum)
    const hi = Math.max(startLine, afterLineNum)
    setSelectedLines(() => {
      const next = new Set<number>()
      for (let i = lo; i <= hi; i++) next.add(i)
      return next
    })
  }, [])

  const handleLineDragEnd = useCallback(() => {
    lineDragRef.current.active = false
  }, [])

  const handleSendEdit = useCallback(() => {
    const instruction = editInput.trim()
    if (!instruction) return
    const fp = activeDiff?.filePath || filePath
    const lineRef = formatLineRef(selectedLines)
    const msg = lineRef
      ? `Edit ${fp} lines ${lineRef}: ${instruction}`
      : `Edit ${fp}: ${instruction}`
    onSendEdit?.(msg)
    setEditInput("")
    setSelectedLines(new Set())
    setEditSent(true)
    setTimeout(() => setEditSent(false), 2000)
  }, [editInput, selectedLines, activeDiff?.filePath, filePath, onSendEdit])

  // ─── Render diff lines for one side (hunk-aware) ──────────────
  const renderLines = (side: "before" | "after") => {
    if (diffLines.length === 0) {
      const content = side === "before" ? (activeDiff?.before || "(empty)") : (activeDiff?.after || "(empty)")
      return (
        <pre style={{
          margin: 0, padding: "12px 16px", fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          color: "var(--text-secondary)", whiteSpace: "pre-wrap",
          wordBreak: "break-word", lineHeight: 1.7,
        }}>
          {content}
        </pre>
      )
    }

    if (hunks.length === 0) {
      return (
        <pre style={{
          margin: 0, padding: "12px 16px", fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          color: "var(--text-secondary)", whiteSpace: "pre-wrap",
          wordBreak: "break-word", lineHeight: 1.7,
        }}>
          No changes
        </pre>
      )
    }

    const commentMap = new Map(comments.map(c => [c.lineIndex, c]))

    return (
      <div>
        {hunks.map((hunk) => (
          <div key={`hunk-${hunk.id}`}>
            {renderHunkHeader(hunk)}
            <pre style={{
              margin: 0, padding: "4px 0", fontSize: 12,
              fontFamily: "'JetBrains Mono', monospace",
              color: "var(--text-secondary)", whiteSpace: "pre-wrap",
              wordBreak: "break-word", lineHeight: 1.7,
            }}>
              {hunk.lines.map((line) => {
                const isBefore = side === "before"
                const globalIdx = line.lineIndex
                const nums = lineNumbers.get(globalIdx)
                const lineNum = isBefore ? nums?.beforeNum : nums?.afterNum

                // Placeholder line
                if ((line.type === "add" && isBefore) || (line.type === "del" && !isBefore)) {
                  return (
                    <div key={globalIdx} style={{
                      display: "flex", minHeight: "1.7em",
                      background: "var(--icon-bg)", opacity: 0.5,
                    }}>
                      <span style={{
                        width: 36, flexShrink: 0, textAlign: "right", paddingRight: 8,
                        userSelect: "none", WebkitUserSelect: "none",
                        color: "var(--text-secondary)", opacity: 0.3,
                        fontSize: 11,
                      }} />
                      <span style={{ flex: 1, padding: "0 8px" }}>{" "}</span>
                    </div>
                  )
                }

                // Content line
                const text = isBefore ? (line.before ?? "") : (line.after ?? "")

                let bg = "transparent"
                let color = "var(--text-secondary)"

                if (line.type === "add") {
                  bg = COLORS.addBg; color = COLORS.addText
                } else if (line.type === "del") {
                  bg = COLORS.delBg; color = COLORS.delText
                } else if (line.type === "mod") {
                  bg = isBefore ? COLORS.delBg : COLORS.addBg
                  color = isBefore ? COLORS.delText : COLORS.addText
                }

                // Check if hunk is acted on (dim if reverted)
                const hunkState = hunkStates[hunk.id]
                const dimmed = hunkState === "reverted" && line.type !== "same"

                const comment = commentMap.get(globalIdx)
                const isAfter = !isBefore
                const isSelected = isAfter && lineNum != null && selectedLines.has(lineNum)

                return (
                  <div key={globalIdx}>
                    <div
                      style={{
                        display: "flex",
                        background: isSelected ? "rgba(99, 102, 241, 0.10)" : bg,
                        color,
                        minHeight: "1.7em",
                        opacity: dimmed ? 0.3 : 1,
                        position: "relative",
                        transition: "opacity 0.3s ease, background 0.15s ease",
                        cursor: isAfter ? "pointer" : "default",
                      }}
                      onClick={isAfter && lineNum != null ? () => handleLineNumberTap(lineNum) : undefined}
                      onTouchStart={(e) => {
                        handleLongPressStart(globalIdx)
                        if (isAfter && lineNum != null) handleLineDragStart(lineNum)
                      }}
                      onTouchMove={isAfter && lineNum != null ? (e) => {
                        const touch = e.touches[0]
                        const el = document.elementFromPoint(touch.clientX, touch.clientY)
                        const num = el?.closest("[data-afterline]")?.getAttribute("data-afterline")
                        if (num) handleLineDragMove(parseInt(num))
                      } : undefined}
                      onTouchEnd={() => { handleLongPressEnd(); handleLineDragEnd() }}
                      onTouchCancel={() => { handleLongPressEnd(); handleLineDragEnd() }}
                      onMouseDown={() => handleLongPressStart(globalIdx)}
                      onMouseUp={handleLongPressEnd}
                      onMouseLeave={handleLongPressEnd}
                      data-afterline={isAfter ? lineNum : undefined}
                    >
                      {/* Line number column */}
                      <span
                        style={{
                          width: 36, flexShrink: 0, textAlign: "right", paddingRight: 8,
                          userSelect: "none", WebkitUserSelect: "none",
                          color: isSelected ? "var(--accent-primary)" : "var(--text-secondary)",
                          opacity: isSelected ? 1 : 0.4,
                          fontSize: 11,
                          fontWeight: isSelected ? 700 : 400,
                          transition: "color 0.15s, opacity 0.15s",
                        }}
                      >
                        {lineNum ?? ""}
                      </span>
                      {/* Code text */}
                      <span style={{ flex: 1, padding: "0 8px" }}>
                        {text || " "}
                      </span>
                      {/* Comment indicator bubble */}
                      {comment && !isBefore && (
                        <span
                          onClick={(e) => { e.stopPropagation(); deleteComment(globalIdx) }}
                          style={{
                            position: "absolute",
                            right: 8,
                            top: "50%",
                            transform: "translateY(-50%)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                          title={`${comment.text} (tap to delete)`}
                        >
                          <MessageIcon size={12} color="var(--accent-primary)" />
                        </span>
                      )}
                    </div>
                    {/* Inline comment display */}
                    {comment && !isBefore && (
                      <div style={{
                        padding: "6px 16px 6px 28px",
                        background: "rgba(99, 102, 241, 0.08)",
                        borderLeft: "3px solid var(--accent-primary)",
                        fontSize: 11,
                        color: "var(--text-secondary)",
                        fontFamily: "system-ui, sans-serif",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}>
                        <MessageIcon size={11} color="var(--accent-primary)" />
                        <span style={{ flex: 1 }}>{comment.text}</span>
                        <button
                          onClick={() => deleteComment(globalIdx)}
                          style={{
                            background: "none", border: "none",
                            cursor: "pointer", padding: 2,
                            display: "flex", alignItems: "center",
                          }}
                        >
                          <XIcon size={12} color="var(--text-secondary)" />
                        </button>
                      </div>
                    )}
                    {/* Comment input */}
                    {commentingLine === globalIdx && !isBefore && (
                      <div style={{
                        padding: "8px 16px 8px 28px",
                        background: "rgba(99, 102, 241, 0.06)",
                        borderLeft: "3px solid var(--accent-primary)",
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                      }}>
                        <input
                          ref={commentInputRef}
                          value={commentDraft}
                          onChange={(e) => setCommentDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitComment()
                            if (e.key === "Escape") { setCommentingLine(null); setCommentDraft("") }
                          }}
                          placeholder="Add note..."
                          style={{
                            flex: 1, padding: "6px 10px", borderRadius: 8,
                            border: "1px solid var(--glass-border)",
                            background: "var(--card-bg)",
                            color: "var(--text-primary)",
                            fontSize: 12, outline: "none",
                            fontFamily: "system-ui, sans-serif",
                          }}
                        />
                        <button
                          onClick={submitComment}
                          disabled={!commentDraft.trim()}
                          style={{
                            padding: "6px 10px", borderRadius: 8,
                            border: "none",
                            background: commentDraft.trim() ? "var(--accent-primary)" : "var(--glass-bg)",
                            color: commentDraft.trim() ? "#fff" : "var(--text-secondary)",
                            fontSize: 11, fontWeight: 600,
                            cursor: commentDraft.trim() ? "pointer" : "default",
                          }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => { setCommentingLine(null); setCommentDraft("") }}
                          style={{
                            background: "none", border: "none",
                            cursor: "pointer", padding: 2,
                            display: "flex", alignItems: "center",
                          }}
                        >
                          <XIcon size={14} color="var(--text-secondary)" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </pre>
          </div>
        ))}
      </div>
    )
  }

  if (!open) return null

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      background: "var(--bg-gradient)",
      display: "flex", flexDirection: "column",
      color: "var(--text-primary)",
    }}>
      {/* ─── Header ─────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        background: "var(--glass-bg)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--glass-border)",
        paddingTop: "max(env(safe-area-inset-top), 12px)",
      }}>
        {/* Title row */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 16px 8px",
        }}>
          <button
            onClick={onClose}
            style={{
              width: 36, height: 36, borderRadius: 12,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)",
              color: "var(--text-primary)",
              fontSize: 18, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div style={{
            fontSize: 17, fontWeight: 600,
            color: "var(--text-primary)",
            flex: 1,
          }}>
            Diff Review
          </div>
          {/* Stage All / Revert All buttons */}
          {hasDiff && hunks.length > 0 && apiBase && projectId && (
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => handleAllAction("stage")}
                disabled={!!actionAllLoading}
                title="Stage all changes"
                style={{
                  height: 32, paddingInline: 10, borderRadius: 10,
                  border: `1px solid ${COLORS.stageBorder}`,
                  background: COLORS.stageBg,
                  cursor: actionAllLoading ? "wait" : "pointer",
                  display: "flex", alignItems: "center", gap: 4,
                  opacity: actionAllLoading ? 0.5 : 1,
                  transition: "all 0.2s ease",
                  fontSize: 11, fontWeight: 600,
                  color: COLORS.addText,
                }}
              >
                <CheckAllIcon size={14} />
                <span>Stage All</span>
              </button>
              <button
                onClick={() => handleAllAction("revert")}
                disabled={!!actionAllLoading}
                title="Revert all changes"
                style={{
                  height: 32, paddingInline: 10, borderRadius: 10,
                  border: `1px solid ${COLORS.revertBorder}`,
                  background: COLORS.revertBg,
                  cursor: actionAllLoading ? "wait" : "pointer",
                  display: "flex", alignItems: "center", gap: 4,
                  opacity: actionAllLoading ? 0.5 : 1,
                  transition: "all 0.2s ease",
                  fontSize: 11, fontWeight: 600,
                  color: COLORS.delText,
                }}
              >
                <UndoIcon size={14} />
                <span>Revert All</span>
              </button>
            </div>
          )}
        </div>

        {/* File tabs */}
        {allDiffEvents.length > 1 && (
          <div
            ref={tabRowRef}
            style={{
              display: "flex", gap: 6,
              padding: "4px 16px 8px",
              overflowX: "auto",
              WebkitOverflowScrolling: "touch" as never,
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
          >
            {allDiffEvents.map((ev) => {
              const fp = ev.diff?.filePath || ev.title?.replace(/^(Edited|Created) /, "") || "?"
              const fn = fp.split(/[\\/]/).pop() || fp
              const active = ev === event
              return (
                <button
                  key={ev.id}
                  onClick={() => onSelectEvent(ev)}
                  style={{
                    flexShrink: 0,
                    padding: "5px 14px",
                    borderRadius: 20,
                    border: "none",
                    background: active ? "var(--accent-primary)" : "var(--card-bg)",
                    color: active ? "#fff" : "var(--text-secondary)",
                    fontSize: 12, fontWeight: 600,
                    fontFamily: "'JetBrains Mono', monospace",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fn}
                </button>
              )
            })}
          </div>
        )}

        {/* Panel switch pill */}
        {hasDiff && (
          <div style={{
            display: "flex", justifyContent: "center", paddingBottom: 8, paddingTop: 2,
          }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 2,
              padding: "3px 4px", borderRadius: 10,
              background: "var(--icon-bg)",
              border: "none",
            }}>
              <span style={{
                padding: "4px 14px", borderRadius: 8, fontSize: 11,
                background: page === 0 ? "var(--glass-border)" : "transparent",
                color: page === 0 ? COLORS.dotBefore : "var(--text-secondary)",
                fontWeight: page === 0 ? 700 : 500,
                opacity: page === 0 ? 1 : 0.4,
                transition: "all 0.3s ease",
              }}>
                Before
              </span>
              <span style={{
                padding: "4px 14px", borderRadius: 8, fontSize: 11,
                background: page === 1 ? "var(--glass-border)" : "transparent",
                color: page === 1 ? COLORS.dotAfter : "var(--text-secondary)",
                fontWeight: page === 1 ? 700 : 500,
                opacity: page === 1 ? 1 : 0.4,
                transition: "all 0.3s ease",
              }}>
                After
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ─── Body: 2-panel slider ───────────────────────────── */}
      {hasDiff ? (
        <div
          style={{ flex: 1, overflow: "hidden", position: "relative" }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div
            ref={slideRef}
            style={{
              display: "flex",
              width: "200%",
              height: "100%",
              transform: "translateX(-50%)",
              willChange: "transform",
            }}
          >
            {/* Before panel */}
            <div
              ref={beforeScrollRef}
              style={{
                width: "50%", height: "100%", overflowY: "auto",
                WebkitOverflowScrolling: "touch" as never,
              }}
            >
              <div style={{
                margin: "12px 12px",
                background: "var(--card-bg)",
                borderRadius: 16,
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                border: "1px solid var(--glass-border)",
                overflow: "hidden",
              }}>
                {renderLines("before")}
              </div>
            </div>

            {/* After panel */}
            <div
              ref={afterScrollRef}
              style={{
                width: "50%", height: "100%", overflowY: "auto",
                WebkitOverflowScrolling: "touch" as never,
              }}
            >
              <div style={{
                margin: "12px 12px",
                background: "var(--card-bg)",
                borderRadius: 16,
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                border: "1px solid var(--glass-border)",
                overflow: "hidden",
              }}>
                {renderLines("after")}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          flex: 1, padding: 16, overflowY: "auto",
          fontSize: 13, color: "var(--text-secondary)",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {gitDiffLoading ? "Loading diff..." : (event?.detail || "Diff not available")}
        </div>
      )}

      {/* ─── Inline Edit Bar ──────────────────────────────── */}
      {hasDiff && onSendEdit && (
        <div style={{
          flexShrink: 0,
          padding: "8px 12px",
          paddingBottom: "max(env(safe-area-inset-bottom), 8px)",
          background: "var(--glass-bg)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderTop: "1px solid var(--glass-border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          {/* Line reference chip */}
          {selectedLines.size > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "4px 8px", borderRadius: 8,
              border: "1px solid var(--accent-primary)",
              background: "rgba(99, 102, 241, 0.08)",
              fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              color: "var(--accent-primary)", fontWeight: 600,
              whiteSpace: "nowrap", flexShrink: 0,
            }}>
              <span>{formatLineRef(selectedLines)}</span>
              <button
                onClick={() => setSelectedLines(new Set())}
                style={{
                  background: "none", border: "none", padding: 0,
                  cursor: "pointer", display: "flex", alignItems: "center",
                  marginLeft: 2,
                }}
              >
                <XIcon size={10} color="var(--accent-primary)" />
              </button>
            </div>
          )}
          {/* Text input */}
          <input
            ref={editInputRef}
            value={editInput}
            onChange={(e) => setEditInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSendEdit() }}
            placeholder={selectedLines.size > 0 ? t("diff.editPlaceholder") : t("diff.editPlaceholderNoLines")}
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 10,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)",
              color: "var(--text-primary)",
              fontSize: 13, outline: "none",
              fontFamily: "system-ui, sans-serif",
              minWidth: 0,
            }}
          />
          {/* Voice button */}
          <button
            onClick={toggleVoice}
            style={{
              width: 34, height: 34, borderRadius: 10,
              border: isListening ? "2px solid var(--accent-primary)" : "1px solid var(--glass-border)",
              background: isListening ? "rgba(99, 102, 241, 0.15)" : "var(--glass-bg)",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
              animation: isListening ? "pulse 1.5s ease-in-out infinite" : "none",
            }}
          >
            <MicIcon size={14} color={isListening ? "var(--accent-primary)" : "var(--text-secondary)"} />
          </button>
          {/* Send button */}
          <button
            onClick={handleSendEdit}
            disabled={!editInput.trim()}
            style={{
              width: 34, height: 34, borderRadius: 10,
              border: "none",
              background: editInput.trim() ? "var(--accent-primary)" : "var(--glass-bg)",
              cursor: editInput.trim() ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
              opacity: editInput.trim() ? 1 : 0.5,
              transition: "all 0.2s ease",
            }}
          >
            <SendIcon size={14} color={editInput.trim() ? "#fff" : "var(--text-secondary)"} />
          </button>
        </div>
      )}

      {/* ─── "Sent to agent" toast ────────────────────────── */}
      {editSent && (
        <div style={{
          position: "absolute", bottom: 80, left: "50%",
          transform: "translateX(-50%)",
          padding: "8px 16px", borderRadius: 10,
          background: "var(--card-bg)",
          border: "1px solid var(--glass-border)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          fontSize: 12, color: "var(--text-secondary)",
          whiteSpace: "nowrap",
          animation: "fadeInOut 2s ease forwards",
        }}>
          {t("diff.sentToAgent")}
        </div>
      )}
    </div>
  )
}
