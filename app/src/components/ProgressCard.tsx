import { useState } from "react"
import type { AgentEvent } from "../types"

interface ProgressCardProps {
  event: AgentEvent
  onNextStep?: (step: string) => void
}

const STATUS_CONFIG = {
  done: { label: "Done", color: "rgba(74,222,128,0.8)", bg: "rgba(74,222,128,0.08)", border: "rgba(74,222,128,0.3)" },
  blocked: { label: "Blocked", color: "rgba(248,113,113,0.9)", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.3)" },
  in_progress: { label: "Working", color: "var(--accent-primary)", bg: "var(--accent-primary-bg)", border: "rgba(96,165,250,0.3)" },
} as const

export function ProgressCard({ event, onNextStep }: ProgressCardProps) {
  const [expanded, setExpanded] = useState(false)
  const p = event.progress
  if (!p) return null

  const cfg = STATUS_CONFIG[p.status]

  return (
    <div style={{
      background: "var(--card-bg)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      borderRadius: 20,
      border: `1px solid ${cfg.border}`,
      borderLeft: `3px solid ${cfg.color}`,
      boxShadow: "var(--glass-shadow)",
      padding: 16,
      transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
    }}>
      {/* Header: status badge + title */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{
          background: cfg.bg,
          color: cfg.color,
          padding: "3px 12px",
          borderRadius: 10,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.3,
          textTransform: "uppercase",
        }}>
          {cfg.label}
        </span>
        <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)", flex: 1 }}>
          {p.title}
        </span>
      </div>

      {/* Summary */}
      <div style={{
        fontSize: 13,
        fontWeight: 500,
        color: "var(--text-secondary)",
        marginBottom: p.nextSteps.length > 0 || p.details ? 12 : 0,
        lineHeight: 1.5,
      }}>
        {p.summary}
      </div>

      {/* Next steps */}
      {p.nextSteps.length > 0 && (
        <div style={{ marginBottom: p.details ? 8 : 0 }}>
          <div style={{
            fontSize: 10,
            color: "var(--text-secondary)",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 1.5,
            marginBottom: 8,
          }}>
            Next steps
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {p.nextSteps.map((step, i) => (
              <button
                key={i}
                onClick={() => onNextStep?.(step)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "var(--accent-primary-bg)",
                  border: "1px solid rgba(96,165,250,0.2)",
                  borderRadius: 12,
                  padding: "10px 14px",
                  color: "var(--accent-primary)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                {step}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Expand/collapse details */}
      {p.details && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              padding: "4px 0",
              opacity: 0.7,
            }}
          >
            {expanded ? "Hide details" : "Show details"}
          </button>
          {expanded && (
            <div style={{
              marginTop: 8,
              padding: 14,
              background: "var(--icon-bg)",
              border: "1px solid var(--glass-border)",
              borderRadius: 14,
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--text-secondary)",
              whiteSpace: "pre-wrap",
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {p.details}
            </div>
          )}
        </>
      )}
    </div>
  )
}
