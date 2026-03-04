// web/components/DiffPanel.tsx
import { useState, useRef } from "react"
import ReactMarkdown from "react-markdown"
import type { AgentEvent } from "../../shared/types"

interface DiffPanelProps {
  event: AgentEvent | null
  onClose: () => void
}

function isMarkdownFile(path: string): boolean {
  return path.endsWith(".md") || path.endsWith(".mdx")
}

const MD_STYLES = `
.diff-md p { font-size: 13px; color: rgba(226,232,240,0.8); margin: 0 0 8px; line-height: 1.6; }
.diff-md h1,.diff-md h2,.diff-md h3 { font-size: 14px; font-weight: 700; color: #e2e8f0; margin: 12px 0 6px; }
.diff-md code { font-family: 'JetBrains Mono', monospace; font-size: 11px; background: rgba(255,255,255,0.08); border-radius: 4px; padding: 1px 5px; }
.diff-md pre { background: rgba(255,255,255,0.04); border-radius: 10px; padding: 12px; overflow-x: auto; margin: 8px 0; }
.diff-md pre code { background: transparent; padding: 0; }
.diff-md ul, .diff-md ol { padding-left: 18px; font-size: 13px; color: rgba(226,232,240,0.7); }
.diff-md li { margin-bottom: 4px; }
.diff-md a { color: #60a5fa; text-decoration: none; }
.diff-md blockquote { border-left: 3px solid rgba(96,165,250,0.4); margin: 8px 0; padding: 4px 12px; color: rgba(226,232,240,0.5); }
`

function DiffContent({ content, side, filePath }: { content: string; side: "before" | "after"; filePath: string }) {
  if (isMarkdownFile(filePath)) {
    return (
      <div className="diff-md" style={{ padding: "12px 16px" }}>
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    )
  }

  const lines = content.split("\n")
  const highlightColor = side === "before"
    ? "rgba(248,113,113,0.10)"
    : "rgba(74,222,128,0.10)"

  return (
    <pre style={{
      margin: 0,
      padding: "12px 16px",
      fontSize: 12,
      fontFamily: "'JetBrains Mono', monospace",
      color: "rgba(255,255,255,0.75)",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      lineHeight: 1.6,
    }}>
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            background: highlightColor,
            borderRadius: 3,
            padding: "0 4px",
            marginBottom: 1,
          }}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  )
}

export function DiffPanel({ event, onClose }: DiffPanelProps) {
  const [page, setPage] = useState<"before" | "after">("after")
  const touchStartX = useRef(0)
  const open = event !== null

  const filePath = event?.diff?.filePath || event?.title?.replace(/^(Edited|Created) /, "") || "File"
  const fileName = filePath.split(/[\\/]/).pop() || filePath

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (dx > 80) {
      if (page === "after") {
        setPage("before")
      } else {
        onClose()
      }
    } else if (dx < -80) {
      if (page === "before") setPage("after")
    }
  }

  const hasDiff = !!event?.diff

  return (
    <>
      <style>{MD_STYLES}</style>

      {open && (
        <div
          onClick={onClose}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(2px)",
            zIndex: 200,
          }}
        />
      )}

      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          position: "fixed",
          top: 0, right: 0, bottom: 0,
          width: "85vw",
          maxWidth: 420,
          zIndex: 201,
          background: "rgba(15,23,42,0.95)",
          backdropFilter: "blur(32px)",
          WebkitBackdropFilter: "blur(32px)",
          borderLeft: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.3)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.3s ease-out",
          display: "flex",
          flexDirection: "column",
          color: "#e2e8f0",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 16px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13,
              fontWeight: 600,
              color: "rgba(255,255,255,0.7)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              marginRight: 8,
            }}>
              {fileName}
            </div>
            <button
              onClick={onClose}
              style={{
                width: 30, height: 30, borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.4)",
                fontSize: 14, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}
            >✕</button>
          </div>

          {hasDiff && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginBottom: 12,
            }}>
              <button
                onClick={() => setPage("before")}
                style={{
                  padding: "6px 16px", borderRadius: 8,
                  border: page === "before" ? "1px solid rgba(248,113,113,0.4)" : "1px solid rgba(255,255,255,0.08)",
                  background: page === "before" ? "rgba(248,113,113,0.12)" : "transparent",
                  color: page === "before" ? "#f87171" : "rgba(255,255,255,0.35)",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >Before</button>
              <div style={{ display: "flex", gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: page === "before" ? "#f87171" : "rgba(255,255,255,0.15)" }} />
                <div style={{ width: 6, height: 6, borderRadius: 3, background: page === "after" ? "#4ade80" : "rgba(255,255,255,0.15)" }} />
              </div>
              <button
                onClick={() => setPage("after")}
                style={{
                  padding: "6px 16px", borderRadius: 8,
                  border: page === "after" ? "1px solid rgba(74,222,128,0.4)" : "1px solid rgba(255,255,255,0.08)",
                  background: page === "after" ? "rgba(74,222,128,0.12)" : "transparent",
                  color: page === "after" ? "#4ade80" : "rgba(255,255,255,0.35)",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >After</button>
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" as never }}>
          {!hasDiff ? (
            <div style={{ padding: "16px", fontSize: 12, color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace" }}>
              {event?.detail || "Diff not available"}
            </div>
          ) : (
            <DiffContent
              content={page === "before" ? (event!.diff!.before || "(empty)") : (event!.diff!.after || "(empty)")}
              side={page}
              filePath={filePath}
            />
          )}
        </div>

        {/* Swipe hint */}
        <div style={{
          padding: "8px",
          textAlign: "center",
          fontSize: 10,
          color: "rgba(255,255,255,0.12)",
          flexShrink: 0,
          borderTop: "1px solid rgba(255,255,255,0.04)",
        }}>
          {hasDiff ? "← swipe to switch  ·  swipe right on Before to close" : "swipe right to close"}
        </div>
      </div>
    </>
  )
}
