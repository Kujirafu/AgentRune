// web/components/EventCard.tsx
import { useState } from "react"
import type { AgentEvent } from "../../shared/types"

interface EventCardProps {
  event: AgentEvent
  onDecision?: (input: string) => void
}

const STATUS_COLORS: Record<string, string> = {
  waiting: "rgba(250,204,21,0.6)",   // yellow
  in_progress: "rgba(96,165,250,0.6)", // blue
  completed: "rgba(74,222,128,0.6)",   // green
  failed: "rgba(248,113,113,0.6)",     // red
}

const STATUS_ICONS: Record<string, string> = {
  waiting: "\u26A0\uFE0F",
  in_progress: "\uD83D\uDD04",
  completed: "\u2705",
  failed: "\u274C",
}

const TYPE_LABELS: Record<string, string> = {
  file_edit: "File Edit",
  file_create: "New File",
  file_delete: "Delete File",
  command_run: "Command",
  test_result: "Test Result",
  install_package: "Install",
  decision_request: "Decision Needed",
  error: "Error",
  info: "Info",
  session_summary: "Summary",
}

export function EventCard({ event, onDecision }: EventCardProps) {
  const [expanded, setExpanded] = useState(false)

  const borderColor = STATUS_COLORS[event.status] || STATUS_COLORS.in_progress
  const icon = STATUS_ICONS[event.status] || "\u{1F4CB}"

  return (
    <div
      onClick={() => !event.decision && setExpanded(!expanded)}
      style={{
        padding: 16,
        borderRadius: 20,
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderLeft: `4px solid ${borderColor}`,
        cursor: event.decision ? "default" : "pointer",
        transition: "all 0.2s ease",
        animation: "fadeSlideUp 0.3s ease-out",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: event.detail || event.decision ? 8 : 0 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#e2e8f0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {event.title}
          </div>
        </div>
        <span style={{
          fontSize: 10,
          color: "rgba(255,255,255,0.25)",
          fontWeight: 500,
          flexShrink: 0,
        }}>
          {TYPE_LABELS[event.type] || event.type}
        </span>
      </div>

      {/* Detail */}
      {event.detail && (
        <div style={{
          fontSize: 12,
          color: "rgba(255,255,255,0.5)",
          fontFamily: "'JetBrains Mono', monospace",
          marginLeft: 24,
        }}>
          {event.detail}
        </div>
      )}

      {/* Decision buttons */}
      {event.decision && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, marginLeft: 24 }}>
          {event.decision.options.map((opt) => (
            <button
              key={opt.label}
              onClick={() => onDecision?.(opt.input)}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 12,
                border: opt.style === "danger"
                  ? "1px solid rgba(248,113,113,0.3)"
                  : "1px solid rgba(96,165,250,0.3)",
                background: opt.style === "danger"
                  ? "rgba(248,113,113,0.08)"
                  : "rgba(96,165,250,0.08)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                color: opt.style === "danger" ? "#f87171" : "#60a5fa",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Expanded raw output */}
      {expanded && event.raw && (
        <div style={{
          marginTop: 12,
          marginLeft: 24,
          padding: 12,
          borderRadius: 12,
          background: "rgba(0,0,0,0.3)",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: "rgba(255,255,255,0.5)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          maxHeight: 200,
          overflow: "auto",
        }}>
          {event.raw}
        </div>
      )}
    </div>
  )
}
