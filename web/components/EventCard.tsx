// web/components/EventCard.tsx
import { useState, useRef, useCallback } from "react"
import { useLocale } from "../lib/i18n/index.js"
import type { AgentEvent } from "../../shared/types"

interface EventCardProps {
  event: AgentEvent
  onDecision?: (input: string) => void
  onQuote?: (text: string) => void
  onSaveObsidian?: (text: string) => void
}

const STATUS_COLORS: Record<string, string> = {
  waiting: "rgba(250,204,21,0.6)",   // yellow
  in_progress: "rgba(96,165,250,0.6)", // blue
  completed: "rgba(74,222,128,0.6)",   // green
  failed: "rgba(248,113,113,0.6)",     // red
}


const TYPE_LABEL_KEYS: Record<string, string> = {
  file_edit: "event.fileEdit",
  file_create: "event.fileCreate",
  file_delete: "event.fileDelete",
  command_run: "event.commandRun",
  test_result: "event.testResult",
  install_package: "event.installPackage",
  decision_request: "event.decisionRequest",
  error: "event.error",
  info: "event.info",
  session_summary: "event.sessionSummary",
}

/** Strip ANSI escape codes from text for clean display */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[78DMEHcn]/g, "")
    .replace(/\x1b\(B/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
}

/** Strip Claude Code status bar metadata from text */
function stripStatusBar(s: string): string {
  return s
    .replace(/[*\u2217\u2234]\s*[A-Z][a-zA-Z]*ing\b[^❯]*/g, "")
    .replace(/\(running\s+stop\s+hooks[^)]*\)/gi, "")
    .replace(/\(\d+\.?\d*s\s*·[^)]*\)/g, "")
    .replace(/\(\d+\.?\d*s\s*[·.]\s*[↑↓]?\s*\d[\d,]*\s*tokens?\)/gi, "")
    .replace(/[↑↓]\s*\d[\d,]*\s*tokens?[^❯]*/gi, "")
    .replace(/thought\s+for\s+\d+s/gi, "")
    .replace(/\d+\s*tokens?\s*used/gi, "")
    .replace(/[❯>$%]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

/** Extract file path from event title */
function extractPath(title: string): string | null {
  // Patterns: "Read /path", "Edited /path", "Created /path", "讀取 /path"
  const m = title.match(/(?:Read|Edited|Created|讀取|已編輯|已建立)\s+(.+)/i)
  if (m) return m[1].trim()
  // Windows paths: C:\... or Unix paths: /...
  const pm = title.match(/([A-Z]:\\[^\s]+|\/[\w\-./]+)/i)
  if (pm) return pm[1]
  return null
}

/** Extract URL from text */
function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)]+/)
  return m ? m[0] : null
}

export function EventCard({ event, onDecision, onQuote, onSaveObsidian }: EventCardProps) {
  const { t } = useLocale()
  const [expanded, setExpanded] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  const touchStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const cleanDetail = event.detail ? stripStatusBar(stripAnsi(event.detail)) : ""
  const cleanRaw = event.raw ? stripAnsi(event.raw) : ""

  const isUserMsg = event.id.startsWith("usr_")
  const borderColor = STATUS_COLORS[event.status] || STATUS_COLORS.in_progress

  // Extract actionable data
  const fullText = [event.title, cleanDetail].filter(Boolean).join("\n")
  const filePath = extractPath(event.title) || extractPath(cleanDetail)
  const url = extractUrl(fullText)

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for older WebViews
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      document.body.removeChild(ta)
    }
  }, [])

  const handleContextMenu = useCallback((x: number, y: number) => {
    if (navigator.vibrate) navigator.vibrate(30)
    setContextMenu({ x, y })
  }, [])

  const closeMenu = useCallback(() => setContextMenu(null), [])

  // Long press handlers (10px tolerance for natural finger jitter)
  const onPointerDown = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    longPressFired.current = false
    const pos = "touches" in e ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY }
    touchStartPos.current = pos
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      handleContextMenu(pos.x, pos.y)
    }, 500)
  }, [handleContextMenu])

  const onPointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const onPointerMove = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!longPressTimer.current) return
    const pos = "touches" in e ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY }
    const dx = pos.x - touchStartPos.current.x
    const dy = pos.y - touchStartPos.current.y
    if (dx * dx + dy * dy > 100) { // 10px radius
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleClick = useCallback(() => {
    if (longPressFired.current) return
    if (!event.decision) setExpanded(!expanded)
  }, [expanded, event.decision])

  // Context menu actions
  const menuActions = [
    { key: "copy", label: t("event.copy"), action: () => copyText(fullText) },
    ...(filePath ? [{ key: "path", label: t("event.copyPath"), action: () => copyText(filePath) }] : []),
    ...(url ? [{ key: "url", label: t("event.copyUrl"), action: () => copyText(url) }] : []),
    ...(onQuote ? [{ key: "quote", label: t("event.quote"), action: () => onQuote(event.title) }] : []),
    ...(onSaveObsidian ? [{ key: "obsidian", label: t("event.saveObsidian"), action: () => onSaveObsidian(fullText) }] : []),
  ]

  // User messages — distinct chat-bubble style with long-press support
  if (isUserMsg) {
    return (
      <>
        <div
          onTouchStart={onPointerDown}
          onTouchEnd={onPointerUp}
          onTouchMove={onPointerMove}
          onContextMenu={(e) => { e.preventDefault(); handleContextMenu(e.clientX, e.clientY) }}
          style={{
            padding: "6px 12px",
            borderRadius: 12,
            background: "rgba(59,130,246,0.08)",
            borderRight: "3px solid rgba(59,130,246,0.5)",
            animation: "fadeSlideUp 0.3s ease-out",
            textAlign: "right",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          <span style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.5, flexShrink: 0 }}>
            {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span style={{
            fontSize: 13, fontWeight: 600, color: "var(--accent-primary)",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {event.title}
          </span>
        </div>
        {contextMenu && <ContextMenuOverlay actions={menuActions} pos={contextMenu} onClose={closeMenu} />}
      </>
    )
  }

  return (
    <>
      <div
        onClick={handleClick}
        onTouchStart={onPointerDown}
        onTouchEnd={onPointerUp}
        onTouchMove={onPointerMove}
        onContextMenu={(e) => { e.preventDefault(); handleContextMenu(e.clientX, e.clientY) }}
        style={{
          padding: event.decision ? 16 : "8px 12px",
          borderRadius: event.decision ? 20 : 14,
          background: "var(--glass-bg)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid var(--glass-border)",
          borderLeft: `4px solid ${borderColor}`,
          boxShadow: "var(--glass-shadow)",
          cursor: event.decision ? "default" : "pointer",
          transition: "all 0.2s ease",
          animation: "fadeSlideUp 0.3s ease-out",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: event.decision ? 8 : event.detail ? 4 : 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: event.decision ? "normal" : "nowrap",
            }}>
              {event.title}
            </div>
          </div>
          <span style={{
            fontSize: 10,
            color: "var(--text-secondary)",
            fontWeight: 500,
            flexShrink: 0,
            opacity: 0.7,
          }}>
            {TYPE_LABEL_KEYS[event.type] ? t(TYPE_LABEL_KEYS[event.type]) : event.type}
          </span>
        </div>

        {/* Detail */}
        {cleanDetail && (
          <div style={{
            fontSize: 12,
            color: "var(--text-secondary)",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {cleanDetail}
          </div>
        )}

        {/* Decision buttons — vertical layout */}
        {event.decision && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
            {event.decision.options.map((opt) => (
              <button
                key={opt.label}
                onClick={() => onDecision?.(opt.input)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: opt.style === "danger"
                    ? "1px solid rgba(248,113,113,0.3)"
                    : "1px solid rgba(59,130,246,0.15)",
                  background: opt.style === "danger"
                    ? "rgba(248,113,113,0.08)"
                    : "rgba(59,130,246,0.05)",
                  color: opt.style === "danger" ? "#f87171" : "var(--accent-primary)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                  textAlign: "left",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Expanded raw output */}
        {expanded && cleanRaw && (
          <div style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            background: "var(--card-bg)",
            border: "1px solid var(--glass-border)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: 200,
            overflow: "auto",
          }}>
            {cleanRaw}
          </div>
        )}
      </div>
      {contextMenu && <ContextMenuOverlay actions={menuActions} pos={contextMenu} onClose={closeMenu} />}
    </>
  )
}

// ─── Context menu overlay (LaunchPad design language) ────────────

const SPRING = "cubic-bezier(0.16, 1, 0.3, 1)"

// Icon SVGs for menu items
const MENU_ICONS: Record<string, string> = {
  copy: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`,
  path: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`,
  url: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`,
  quote: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></svg>`,
  obsidian: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
}

interface MenuAction {
  key: string
  label: string
  action: () => void
}

function ContextMenuOverlay({ actions, pos, onClose }: {
  actions: MenuAction[]
  pos: { x: number; y: number }
  onClose: () => void
}) {
  // Track when the menu opened — ignore touch events from the same gesture that opened it
  const openedAt = useRef(Date.now())
  const menuW = 200
  const menuH = actions.length * 48 + 20
  const x = Math.min(Math.max(12, pos.x - menuW / 2), window.innerWidth - menuW - 12)
  const y = pos.y + menuH > window.innerHeight - 20 ? pos.y - menuH - 8 : pos.y + 8

  const handleBackdropTouch = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    // Ignore touchend from the same gesture that triggered long-press (finger still down)
    if (Date.now() - openedAt.current < 300) return
    onClose()
  }, [onClose])

  return (
    <div
      onClick={onClose}
      onTouchEnd={handleBackdropTouch}
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9999,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: y,
          left: x,
          width: menuW,
          background: "var(--glass-bg)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--glass-border)",
          borderRadius: 20,
          boxShadow: "var(--glass-shadow), 0 8px 32px rgba(0,0,0,0.12)",
          padding: 10,
          display: "flex",
          flexDirection: "column" as const,
          gap: 2,
          transition: `all 0.3s ${SPRING}`,
          animation: `ctxMenuIn 0.25s ${SPRING}`,
          transformOrigin: `${pos.x - x}px ${pos.y - y}px`,
        }}
      >
        {actions.map((a, i) => (
          <button
            key={a.key}
            onClick={() => { a.action(); onClose() }}
            onTouchEnd={(e) => { e.stopPropagation(); a.action(); onClose() }}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 14,
              border: "none",
              background: "transparent",
              color: "var(--text-primary)",
              fontSize: 14,
              fontWeight: 600,
              textAlign: "left",
              cursor: "pointer",
              transition: `all 0.3s ${SPRING}`,
              display: "flex",
              alignItems: "center",
              gap: 12,
              ...(i < actions.length - 1 ? {
                borderBottom: "1px solid var(--glass-border)",
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
              } : {}),
            }}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--icon-bg)"
            }}
            onPointerUp={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent"
            }}
            onPointerLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent"
            }}
          >
            <div
              style={{
                width: 32, height: 32, borderRadius: 10,
                background: "var(--icon-bg)",
                border: "1px solid var(--glass-border)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                color: "var(--accent-primary)",
                boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              }}
              dangerouslySetInnerHTML={{ __html: MENU_ICONS[a.key] || MENU_ICONS.copy }}
            />
            <span style={{ letterSpacing: -0.3 }}>{a.label}</span>
          </button>
        ))}
      </div>

      <style>{`
        @keyframes ctxMenuIn {
          from { opacity: 0; transform: scale(0.9) }
          to { opacity: 1; transform: scale(1) }
        }
      `}</style>
    </div>
  )
}
