import { useState, useRef, useEffect } from "react"
import type { OutputBlock } from "../lib/ansi-parser"
import { useLocale } from "../lib/i18n/index.js"

type Tab = "thinking" | "code" | "tools"

interface DetailPanelProps {
  open: boolean
  onClose: () => void
  thinkingBlocks: OutputBlock[]
  codeBlocks: OutputBlock[]
  toolBlocks: OutputBlock[]
}

export function DetailPanel({ open, onClose, thinkingBlocks, codeBlocks, toolBlocks }: DetailPanelProps) {
  const { t } = useLocale()
  const [activeTab, setActiveTab] = useState<Tab>("thinking")
  const panelRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef(0)

  // Swipe to close (swipe right)
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (dx > 80) onClose() // swipe right to close
  }

  // Auto-scroll to bottom when new blocks arrive
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [thinkingBlocks, codeBlocks, toolBlocks, activeTab])

  const blocks =
    activeTab === "thinking" ? thinkingBlocks :
    activeTab === "code" ? codeBlocks :
    toolBlocks

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "thinking", label: t("detail.thinking"), count: thinkingBlocks.length },
    { id: "code", label: t("detail.code"), count: codeBlocks.length },
    { id: "tools", label: t("detail.tools"), count: toolBlocks.length },
  ]

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(2px)",
            zIndex: 200,
            transition: "opacity 0.3s",
          }}
        />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
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
        <div style={{
          padding: "14px 16px 0",
          flexShrink: 0,
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}>
            <div style={{
              fontFamily: "'Playfair Display', Georgia, serif",
              fontSize: 18,
              fontWeight: 700,
            }}>
              {t("detail.title")}
            </div>
            <button
              onClick={onClose}
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.4)",
                fontSize: 14,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {"✕"}
            </button>
          </div>

          {/* Tabs */}
          <div style={{
            display: "flex",
            gap: 4,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 10,
            padding: 3,
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  padding: "8px 6px",
                  borderRadius: 8,
                  border: "none",
                  background: activeTab === tab.id
                    ? "rgba(96,165,250,0.15)"
                    : "transparent",
                  color: activeTab === tab.id
                    ? "#60a5fa"
                    : "rgba(255,255,255,0.4)",
                  fontSize: 12,
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span style={{
                    marginLeft: 4,
                    fontSize: 10,
                    padding: "1px 5px",
                    borderRadius: 6,
                    background: activeTab === tab.id
                      ? "rgba(96,165,250,0.2)"
                      : "rgba(255,255,255,0.06)",
                  }}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div
          ref={contentRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 16px",
            WebkitOverflowScrolling: "touch" as never,
          }}
        >
          {blocks.length === 0 ? (
            <div style={{
              textAlign: "center",
              padding: "40px 20px",
              color: "rgba(255,255,255,0.2)",
              fontSize: 13,
            }}>
              {activeTab === "thinking" && t("detail.emptyThinking")}
              {activeTab === "code" && t("detail.emptyCode")}
              {activeTab === "tools" && t("detail.emptyTools")}
            </div>
          ) : (
            blocks.map((block, i) => (
              <div
                key={i}
                style={{
                  marginBottom: 8,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background:
                    block.type === "thinking" ? "rgba(251,191,36,0.06)" :
                    block.type === "diff" ? "rgba(74,222,128,0.06)" :
                    block.type === "tool" ? "rgba(96,165,250,0.06)" :
                    "rgba(255,255,255,0.03)",
                  border: `1px solid ${
                    block.type === "thinking" ? "rgba(251,191,36,0.12)" :
                    block.type === "diff" ? "rgba(74,222,128,0.12)" :
                    block.type === "tool" ? "rgba(96,165,250,0.12)" :
                    "rgba(255,255,255,0.06)"
                  }`,
                }}
              >
                <div style={{
                  fontSize: 9,
                  color: "rgba(255,255,255,0.2)",
                  marginBottom: 4,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}>
                  {block.type === "thinking" && t("detail.blockThinking")}
                  {block.type === "code" && t("detail.blockCode")}
                  {block.type === "diff" && t("detail.blockDiff")}
                  {block.type === "tool" && t("detail.blockTool")}
                  {block.type === "text" && t("detail.blockText")}
                </div>
                <pre style={{
                  margin: 0,
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: "rgba(255,255,255,0.7)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  lineHeight: 1.5,
                }}>
                  {block.content}
                </pre>
              </div>
            ))
          )}
        </div>

        {/* Swipe hint */}
        <div style={{
          padding: "8px",
          textAlign: "center",
          fontSize: 10,
          color: "rgba(255,255,255,0.15)",
          flexShrink: 0,
          borderTop: "1px solid rgba(255,255,255,0.04)",
        }}>
          {t("detail.swipeToClose")}
        </div>
      </div>
    </>
  )
}
