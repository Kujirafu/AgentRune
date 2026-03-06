import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import type { AgentEvent } from "../types"

interface DiffPanelProps {
  event: AgentEvent | null
  allDiffEvents: AgentEvent[]
  onClose: () => void
  onSelectEvent: (e: AgentEvent) => void
}

interface DiffLine {
  type: "same" | "add" | "del" | "mod"
  before?: string
  after?: string
}

function computeLineDiff(beforeText: string, afterText: string): DiffLine[] {
  const a = beforeText.split("\n")
  const b = afterText.split("\n")
  const m = a.length
  const n = b.length

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const stack: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      stack.push({ type: "same", before: a[i - 1], after: b[j - 1] })
      i--; j--
    } else if (i > 0 && j > 0 && dp[i - 1][j - 1] >= dp[i - 1][j] && dp[i - 1][j - 1] >= dp[i][j - 1]) {
      stack.push({ type: "mod", before: a[i - 1], after: b[j - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "add", after: b[j - 1] })
      j--
    } else {
      stack.push({ type: "del", before: a[i - 1] })
      i--
    }
  }
  stack.reverse()
  return stack
}

const SPRING = "cubic-bezier(0.22, 1, 0.36, 1)"
const COLORS = {
  addBg: "rgba(34, 197, 94, 0.15)",
  addText: "#22c55e",
  delBg: "rgba(239, 68, 68, 0.15)",
  delText: "#ef4444",
  dotBefore: "#ef4444",
  dotAfter: "#22c55e",
}

export function DiffPanel({ event, allDiffEvents, onClose, onSelectEvent }: DiffPanelProps) {
  const [page, setPage] = useState<0 | 1>(1)
  const slideRef = useRef<HTMLDivElement>(null)
  const beforeScrollRef = useRef<HTMLDivElement>(null)
  const afterScrollRef = useRef<HTMLDivElement>(null)
  const tabRowRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef({ startX: 0, startY: 0, direction: "", isDragging: false, offset: 0, startTime: 0 })

  const open = event !== null
  const hasDiff = !!event?.diff

  const filePath = event?.diff?.filePath || event?.title?.replace(/^(Edited|Created) /, "") || "File"
  const _fileName = filePath.split(/[\\/]/).pop() || filePath

  const diffLines = useMemo(() => {
    if (!event?.diff) return []
    return computeLineDiff(event.diff.before || "", event.diff.after || "")
  }, [event?.diff?.before, event?.diff?.after])

  const goToPage = useCallback((p: 0 | 1) => {
    if (slideRef.current) {
      slideRef.current.style.transition = `transform 0.4s ${SPRING}`
      slideRef.current.style.transform = `translateX(${-p * 100}%)`
    }
    if (p === 0 && afterScrollRef.current && beforeScrollRef.current) {
      beforeScrollRef.current.scrollTop = afterScrollRef.current.scrollTop
    } else if (p === 1 && beforeScrollRef.current && afterScrollRef.current) {
      afterScrollRef.current.scrollTop = beforeScrollRef.current.scrollTop
    }
    setPage(p)
  }, [])

  useEffect(() => {
    if (event) {
      setPage(1)
      if (slideRef.current) {
        slideRef.current.style.transition = "none"
        slideRef.current.style.transform = "translateX(-100%)"
      }
    }
  }, [event])

  useEffect(() => {
    if (!tabRowRef.current || !event) return
    const idx = allDiffEvents.findIndex(e => e === event)
    const btn = tabRowRef.current.children[idx] as HTMLElement | undefined
    btn?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" })
  }, [event, allDiffEvents])

  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => { e.preventDefault(); onClose() }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [open, onClose])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragRef.current = {
      startX: e.touches[0].clientX, startY: e.touches[0].clientY,
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
      let offset = dx
      if ((page === 0 && dx > 0) || (page === 1 && dx < 0)) offset = dx * 0.15
      d.offset = offset
      if (slideRef.current) {
        slideRef.current.style.transition = "none"
        slideRef.current.style.transform = `translateX(calc(${-page * 100}% + ${offset}px))`
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

  const renderLines = (side: "before" | "after") => {
    if (diffLines.length === 0) {
      const content = side === "before" ? (event?.diff?.before || "(empty)") : (event?.diff?.after || "(empty)")
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

    return (
      <pre style={{
        margin: 0, padding: "12px 0", fontSize: 12,
        fontFamily: "'JetBrains Mono', monospace",
        color: "var(--text-secondary)", whiteSpace: "pre-wrap",
        wordBreak: "break-word", lineHeight: 1.7,
      }}>
        {diffLines.map((line, i) => {
          const isBefore = side === "before"
          if ((line.type === "add" && isBefore) || (line.type === "del" && !isBefore)) {
            return (
              <div key={i} style={{
                padding: "0 16px", minHeight: "1.7em",
                background: "var(--icon-bg)", opacity: 0.5,
              }}>
                {" "}
              </div>
            )
          }
          const text = isBefore ? (line.before ?? "") : (line.after ?? "")
          let bg = "transparent"
          let color = "var(--text-secondary)"
          if (line.type === "add") { bg = COLORS.addBg; color = COLORS.addText }
          else if (line.type === "del") { bg = COLORS.delBg; color = COLORS.delText }
          else if (line.type === "mod") {
            bg = isBefore ? COLORS.delBg : COLORS.addBg
            color = isBefore ? COLORS.delText : COLORS.addText
          }
          return (
            <div key={i} style={{ padding: "0 16px", background: bg, color, minHeight: "1.7em" }}>
              {text || " "}
            </div>
          )
        })}
      </pre>
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
      <div style={{
        flexShrink: 0, background: "var(--glass-bg)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--glass-border)",
        paddingTop: "max(env(safe-area-inset-top), 12px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 8px" }}>
          <button onClick={onClose} style={{
            width: 36, height: 36, borderRadius: 12,
            border: "1px solid var(--glass-border)", background: "var(--card-bg)",
            color: "var(--text-primary)", fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            {"\u2190"}
          </button>
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
            Diff View
          </div>
        </div>

        {allDiffEvents.length > 1 && (
          <div ref={tabRowRef} style={{
            display: "flex", gap: 6, padding: "4px 16px 8px",
            overflowX: "auto", WebkitOverflowScrolling: "touch" as never,
            scrollbarWidth: "none", msOverflowStyle: "none",
          }}>
            {allDiffEvents.map((ev) => {
              const fp = ev.diff?.filePath || ev.title?.replace(/^(Edited|Created) /, "") || "?"
              const fn = fp.split(/[\\/]/).pop() || fp
              const active = ev === event
              return (
                <button key={ev.id} onClick={() => onSelectEvent(ev)} style={{
                  flexShrink: 0, padding: "5px 14px", borderRadius: 20, border: "none",
                  background: active ? "var(--accent-primary)" : "var(--card-bg)",
                  color: active ? "#fff" : "var(--text-secondary)",
                  fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
                  cursor: "pointer", whiteSpace: "nowrap",
                }}>
                  {fn}
                </button>
              )
            })}
          </div>
        )}

        {hasDiff && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, paddingBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: page === 0 ? COLORS.dotBefore : "var(--text-secondary)", opacity: page === 0 ? 1 : 0.4 }}>Before</span>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: page === 0 ? COLORS.dotBefore : "var(--glass-border)", transition: "background 0.3s" }} />
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: page === 1 ? COLORS.dotAfter : "var(--glass-border)", transition: "background 0.3s" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: page === 1 ? COLORS.dotAfter : "var(--text-secondary)", opacity: page === 1 ? 1 : 0.4 }}>After</span>
          </div>
        )}
      </div>

      {hasDiff ? (
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div ref={slideRef} style={{
            display: "flex", width: "200%", height: "100%",
            transform: "translateX(-100%)", willChange: "transform",
          }}>
            <div ref={beforeScrollRef} style={{ width: "50%", height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch" as never }}>
              <div style={{ margin: "12px 12px", background: "var(--card-bg)", borderRadius: 16, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid var(--glass-border)", overflow: "hidden" }}>
                {renderLines("before")}
              </div>
            </div>
            <div ref={afterScrollRef} style={{ width: "50%", height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch" as never }}>
              <div style={{ margin: "12px 12px", background: "var(--card-bg)", borderRadius: 16, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid var(--glass-border)", overflow: "hidden" }}>
                {renderLines("after")}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, padding: 16, overflowY: "auto", fontSize: 13, color: "var(--text-secondary)", fontFamily: "'JetBrains Mono', monospace" }}>
          {event?.detail || "Diff not available"}
        </div>
      )}
    </div>
  )
}
