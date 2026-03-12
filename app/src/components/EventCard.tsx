// web/components/EventCard.tsx
import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { createPortal } from "react-dom"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useLocale } from "../lib/i18n/index.js"
import type { AgentEvent } from "../types"

interface EventCardProps {
  event: AgentEvent
  onDecision?: (input: string) => void
  onQuote?: (text: string) => void
  onSaveObsidian?: (text: string) => void
  onViewDiff?: (event: AgentEvent) => void
  onPreviewImage?: (url: string) => void
  apiBase?: string
  projectId?: string
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
  response: "event.response",
  user_message: "event.userMessage",
  session_summary: "event.sessionSummary",
  progress_report: "event.progressReport",
}

/** Strip ANSI escape codes from text for clean display */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[78]/g, "")
    .replace(/\x1b\([A-Z]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
}

/** Strip Claude Code status bar metadata from text */
function stripStatusBar(s: string): string {
  return s
    .replace(/[*\u2217\u2234]\s*[A-Z][a-zA-Z]*ing\b[^\n\u276F]*/g, "")
    .replace(/\(running\s+stop\s+hooks[^)]*\)/gi, "")
    .replace(/\(\d+\.?\d*s\s*\u00B7[^)]*\)/g, "")
    .replace(/\(\d+\.?\d*s\s*[\u00B7.]\s*[\u2191\u2193]?\s*\d[\d,]*\s*tokens?\)/gi, "")
    .replace(/[\u2191\u2193]\s*\d[\d,]*\s*tokens?[^\u276F]*/gi, "")
    .replace(/thought\s+for\s+\d+s/gi, "")
    .replace(/\d+\s*tokens?\s*used/gi, "")
    .replace(/[\u276F>$%]\s*$/, "")
    .replace(/[^\S\n\r]{2,}/g, " ")
    .trim()
}

/** Extract file path from event title */
function extractPath(title: string): string | null {
  // Patterns: "Read /path", "Edited /path", "Created /path", "\u8B80\u53D6 /path"
  const m = title.match(/(?:Read|Edited|Created|\u8B80\u53D6|\u5DF2\u7DE8\u8F2F|\u5DF2\u5EFA\u7ACB)\s+(.+)/i)
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

function looksLikeMarkdown(text: string): boolean {
  return /#{1,3} |[*_]{2}|\*[^*]+\*|`[^`]+`|^\s*[-*] /m.test(text)
}

/** Extract image URL from user message text containing upload paths */
function extractImageUrl(text: string, apiBase?: string, projectId?: string): string | null {
  if (!apiBase || !projectId) return null
  // Match paths like .../.agentrune/uploads/1234_photo.png
  const m = text.match(/[^\s]*\.agentrune[/\\]uploads[/\\]([^\s"']+\.(?:png|jpg|jpeg|gif|webp))/i)
  if (m) return `${apiBase}/api/uploads/${projectId}/${m[1].replace(/\\/g, "/").split("/").pop()}`
  // Match [Image: source: path] pattern
  const im = text.match(/\[Image:\s*source:\s*([^\]]+\.(?:png|jpg|jpeg|gif|webp))\]/i)
  if (im) {
    const fn = im[1].replace(/\\/g, "/").split("/").pop()
    return `${apiBase}/api/uploads/${projectId}/${fn}`
  }
  return null
}

export function EventCard({ event, onDecision, onQuote, onSaveObsidian, onViewDiff, onPreviewImage, apiBase, projectId }: EventCardProps) {
  const { t } = useLocale()
  const [expanded, setExpanded] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  const touchStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const [detailExpanded, setDetailExpanded] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)
  const [detailOverflow, setDetailOverflow] = useState(false)
  const rawDetail = event.detail ? stripStatusBar(stripAnsi(event.detail)) : ""
  // If detail starts with title, strip the duplicate prefix instead of hiding entire detail
  const cleanDetail = (() => {
    if (!rawDetail) return ""
    if (!event.title) return rawDetail
    const titleBase = event.title.replace(/\.\.\.$/, "")
    if (rawDetail.startsWith(titleBase)) {
      const rest = rawDetail.slice(titleBase.length).trim()
      return rest || ""
    }
    return rawDetail
  })()

  // Convert custom XML tags (e.g. <prd_output>) to markdown code fences
  const renderedDetail = useMemo(() => {
    if (!cleanDetail) return ""
    return cleanDetail.replace(
      /<(\w+)>\s*(\{[\s\S]*?\})\s*<\/\1>/g,
      (_match, _tag, json) => {
        try {
          const formatted = JSON.stringify(JSON.parse(json), null, 2)
          return "\n```json\n" + formatted + "\n```\n"
        } catch {
          return "\n```\n" + json.trim() + "\n```\n"
        }
      }
    )
  }, [cleanDetail])

  useEffect(() => {
    if (detailRef.current && !detailExpanded) {
      setDetailOverflow(detailRef.current.scrollHeight > 120)
    }
  }, [cleanDetail, detailExpanded])
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
    // Ignore touches near screen edges (Android back gesture zones, ~30px)
    const screenW = window.innerWidth
    if (pos.x < 30 || pos.x > screenW - 30) return
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
    if (!event.decision) {
      setExpanded(!expanded)
      setDetailExpanded(!expanded) // sync detail expansion with card expansion
    }
  }, [expanded, event.decision])

  // Context menu actions
  const menuActions = [
    { key: "copy", label: t("event.copy"), action: () => copyText(fullText) },
    ...(filePath ? [{ key: "path", label: t("event.copyPath"), action: () => copyText(filePath) }] : []),
    ...(url ? [{ key: "url", label: t("event.copyUrl"), action: () => copyText(url) }] : []),
    ...(onQuote ? [{ key: "quote", label: t("event.quote"), action: () => onQuote(event.title) }] : []),
    ...(onSaveObsidian ? [{ key: "obsidian", label: t("event.saveObsidian"), action: () => onSaveObsidian(fullText) }] : []),
  ]

  // User messages \u2014 distinct chat-bubble style with long-press support + expandable
  const hasDetail = isUserMsg && !!event.detail
  const userImgUrl = isUserMsg ? (extractImageUrl(event.title, apiBase, projectId) || extractImageUrl(event.detail || "", apiBase, projectId)) : null
  if (isUserMsg) {
    // Strip the [Image: source: ...] text from display title
    const displayTitle = userImgUrl ? event.title.replace(/\[Image:\s*source:\s*[^\]]*\]/gi, "").trim() : event.title
    return (
      <>
        <div
          onClick={() => { if (hasDetail) setExpanded(!expanded) }}
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
            flexDirection: "column",
            gap: 4,
            userSelect: "none",
            WebkitUserSelect: "none",
            cursor: hasDetail ? "pointer" : "default",
          }}
        >
          {Array.isArray(event._images) && event._images.length > 0 ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", marginBottom: 4 }}>
              {event._images.map((img, i) => (
                <img
                  key={i}
                  src={img}
                  alt={`attached ${i + 1}`}
                  onClick={(e) => { e.stopPropagation(); onPreviewImage?.(img) }}
                  style={{ maxWidth: event._images!.length > 1 ? 140 : "100%", maxHeight: event._images!.length > 1 ? 100 : 200, borderRadius: 10, objectFit: "cover", border: "1px solid var(--glass-border)", cursor: onPreviewImage ? "pointer" : "default" }}
                />
              ))}
            </div>
          ) : userImgUrl ? (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
              <img
                src={userImgUrl}
                alt="uploaded"
                onClick={(e) => { e.stopPropagation(); onPreviewImage?.(userImgUrl!) }}
                style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 10, objectFit: "contain", cursor: onPreviewImage ? "pointer" : "default" }}
              />
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
            <span style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.5, flexShrink: 0 }}>
              {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            {(displayTitle || !userImgUrl) && (
              <span style={{
                fontSize: 13, fontWeight: 600, color: "var(--accent-primary)",
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {displayTitle || event.title}
                {hasDetail && !expanded && <span style={{ opacity: 0.5, marginLeft: 4 }}>{"\u25BC"}</span>}
              </span>
            )}
          </div>
          {expanded && event.detail && (
            <div style={{
              fontSize: 12,
              color: "var(--accent-primary)",
              fontFamily: "'JetBrains Mono', monospace",
              textAlign: "left",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              opacity: 0.85,
              padding: "6px 0 2px",
              borderTop: "1px solid rgba(59,130,246,0.15)",
              marginTop: 2,
            }}>
              {event.detail}
            </div>
          )}
        </div>
        {contextMenu && createPortal(<ContextMenuOverlay actions={menuActions} pos={contextMenu} onClose={closeMenu} />, document.body)}
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
          overflow: expanded ? "visible" : "hidden",
          maxWidth: "100%",
          flexShrink: 0,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: event.decision ? 8 : event.detail ? 4 : 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text-primary)",
              whiteSpace: "normal",
              wordBreak: "break-word",
              ...(expanded ? {} : {
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical" as never,
                overflow: "hidden",
              }),
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

        {/* Progress report fields (fallback when rendered via EventCard instead of ProgressCard) */}
        {event.progress && (
          <div style={{ marginTop: 4 }}>
            {event.progress.summary && (
              <div style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                lineHeight: 1.5,
                marginBottom: event.progress.nextSteps?.length ? 8 : 0,
              }}>
                {event.progress.summary}
              </div>
            )}
            {event.progress.nextSteps && event.progress.nextSteps.length > 0 && (
              <div style={{ marginBottom: event.progress.details ? 8 : 0 }}>
                <div style={{
                  fontSize: 10,
                  color: "var(--text-secondary)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 1.5,
                  marginBottom: 6,
                }}>
                  Next steps
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {event.progress.nextSteps.map((step, i) => (
                    <div key={i} style={{
                      fontSize: 13,
                      color: "var(--accent-primary)",
                      padding: "6px 10px",
                      background: "var(--accent-primary-bg, rgba(59,130,246,0.08))",
                      borderRadius: 8,
                      border: "1px solid rgba(96,165,250,0.15)",
                    }}>
                      {i + 1}. {step}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {event.progress.details && (
              <div style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                whiteSpace: "pre-wrap",
                lineHeight: 1.5,
                padding: "8px 10px",
                background: "var(--icon-bg, rgba(0,0,0,0.03))",
                borderRadius: 10,
                border: "1px solid var(--glass-border)",
              }}>
                {event.progress.details}
              </div>
            )}
          </div>
        )}

        {/* Detail \u2014 collapsible when content is long */}
        {cleanDetail && !event.progress && (
          <div>
            <div
              ref={detailRef}
              style={{
                fontSize: 13,
                color: "var(--text-primary)",
                maxHeight: detailExpanded ? "none" : 120,
                overflow: "hidden",
              }}
            >
                {cleanDetail.startsWith("__IMG__") ? (
                  <img
                    src={cleanDetail.slice(7)}
                    alt="uploaded"
                    onClick={(e) => { e.stopPropagation(); onPreviewImage?.(cleanDetail.slice(7)) }}
                    style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 10, objectFit: "contain", cursor: onPreviewImage ? "pointer" : "default" }}
                  />
                ) : Array.isArray(event._images) && event._images.length > 0 ? (
                  <div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      {event._images.map((img, i) => (
                        <img
                          key={i}
                          src={img}
                          alt={`attached ${i + 1}`}
                          onClick={(e) => { e.stopPropagation(); onPreviewImage?.(img) }}
                          style={{ maxWidth: 120, maxHeight: 90, borderRadius: 8, objectFit: "cover", border: "1px solid var(--glass-border)", cursor: onPreviewImage ? "pointer" : "default" }}
                        />
                      ))}
                    </div>
                    {cleanDetail && (
                      <div className="ec-md">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{renderedDetail}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                  <style>{`
                    .ec-md p { font-size: 13px; color: var(--text-primary); margin: 0 0 4px; line-height: 1.5; }
                    .ec-md code { font-family: 'JetBrains Mono', monospace; font-size: 11px; background: rgba(0,0,0,0.06); border-radius: 4px; padding: 1px 4px; }
                    html.dark .ec-md code { background: rgba(255,255,255,0.08); }
                    .ec-md pre { background: rgba(0,0,0,0.04); border-radius: 8px; padding: 8px 12px; margin: 4px 0; overflow-x: auto; }
                    html.dark .ec-md pre { background: rgba(255,255,255,0.04); }
                    .ec-md pre code { background: transparent; padding: 0; }
                    .ec-md ul, .ec-md ol { padding-left: 16px; font-size: 13px; color: var(--text-primary); margin: 0; }
                    .ec-md h1,.ec-md h2,.ec-md h3 { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 6px 0 2px; }
                    .ec-md a { color: var(--accent-primary); text-decoration: none; }
                    .ec-md table { border-collapse: collapse; font-size: 12px; width: 100%; margin: 6px 0; }
                    .ec-md th, .ec-md td { border: 1px solid var(--glass-border); padding: 4px 8px; text-align: left; }
                    .ec-md th { background: rgba(0,0,0,0.03); font-weight: 600; }
                    html.dark .ec-md th { background: rgba(255,255,255,0.05); }
                    .ec-md hr { border: none; border-top: 1px solid var(--glass-border); margin: 8px 0; }
                  `}</style>
                  <div className="ec-md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{renderedDetail}</ReactMarkdown>
                  </div>
                  </>
                )}
            </div>
            {/* Expand button when content overflows \u2014 separate row, no overlap */}
            {!detailExpanded && (detailOverflow || cleanDetail.length > 300) && (
              <div
                onClick={(e) => { e.stopPropagation(); setDetailExpanded(true) }}
                style={{
                  textAlign: "center", cursor: "pointer",
                  paddingTop: 4, marginTop: 2,
                  borderTop: "1px solid var(--glass-border, rgba(255,255,255,0.1))",
                }}
              >
                <span style={{ fontSize: 10, color: "var(--accent-primary)", fontWeight: 600, opacity: 0.8 }}>
                  {"\u25BC"} {t("event.showMore") || "Show more"}
                </span>
              </div>
            )}
            {detailExpanded && cleanDetail.length > 300 && (
              <div
                onClick={(e) => { e.stopPropagation(); setDetailExpanded(false) }}
                style={{ textAlign: "center", cursor: "pointer", paddingTop: 4 }}
              >
                <span style={{ fontSize: 10, color: "var(--accent-primary)", fontWeight: 600, opacity: 0.8 }}>
                  {"\u25B2"} {t("event.showLess") || "Show less"}
                </span>
              </div>
            )}
          </div>
        )}

        {/* View diff chip \u2014 only for file events that have actual diff data */}
        {(event.type === "file_edit" || event.type === "file_create") && event.diff && onViewDiff && (
          <div style={{ marginTop: 6 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onViewDiff(event) }}
              style={{
                padding: "3px 10px",
                borderRadius: 6,
                border: "1px solid rgba(96,165,250,0.25)",
                background: "rgba(96,165,250,0.07)",
                color: "rgba(96,165,250,0.8)",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {"\u25C8"} View diff
            </button>
          </div>
        )}

        {/* Decision buttons \u2014 vertical layout */}
        {event.decision && (() => {
          const selectedInput = (event as any)._selectedInput as string | undefined
          const isDecided = event.status === "completed" && !!selectedInput
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              {(event.decision!.options || []).map((opt) => {
                const isSelected = isDecided && opt.input === selectedInput
                const isOther = isDecided && !isSelected
                if (isOther) return null  // hide unselected options
                return (
                  <button
                    key={opt.label}
                    onClick={() => !isDecided && onDecision?.(opt.input)}
                    disabled={isDecided}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: 12,
                      border: isSelected
                        ? "2px solid rgba(74,222,128,0.6)"
                        : opt.style === "danger"
                        ? "1px solid rgba(248,113,113,0.3)"
                        : "1px solid rgba(59,130,246,0.3)",
                      background: isSelected
                        ? "rgba(74,222,128,0.12)"
                        : opt.style === "danger"
                        ? "rgba(248,113,113,0.1)"
                        : "rgba(59,130,246,0.1)",
                      color: isSelected
                        ? "#4ade80"
                        : opt.style === "danger" ? "#f87171" : "var(--accent-primary)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: isDecided ? "default" : "pointer",
                      transition: "all 0.3s ease",
                      textAlign: "left",
                      wordBreak: "break-word" as const,
                      whiteSpace: "pre-wrap",
                      overflow: "hidden",
                    }}
                  >
                    {isSelected ? "\u2713 " : ""}{opt.label}
                  </button>
                )
              })}
            </div>
          )
        })()}

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
      {contextMenu && createPortal(<ContextMenuOverlay actions={menuActions} pos={contextMenu} onClose={closeMenu} />, document.body)}
    </>
  )
}

// \u2500\u2500\u2500 Context menu overlay (LaunchPad design language) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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
  // Track when the menu opened \u2014 ignore touch events from the same gesture that opened it
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
          userSelect: "none",
          WebkitUserSelect: "none",
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
