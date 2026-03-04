// web/components/StatusIndicator.tsx
import { useLocale } from "../lib/i18n/index.js"

export type AgentStatus = "working" | "waiting" | "idle"

interface StatusIndicatorProps {
  status: AgentStatus
  agentName: string
}

const STATUS_CONFIG: Record<AgentStatus, { color: string; pulse: boolean }> = {
  working: { color: "#4ade80", pulse: true },
  waiting: { color: "#fbbf24", pulse: true },
  idle: { color: "var(--text-secondary)", pulse: false },
}

const STATUS_LABEL_KEYS: Record<AgentStatus, string> = {
  working: "status.working",
  waiting: "status.waiting",
  idle: "status.idle",
}

export function StatusIndicator({ status, agentName }: StatusIndicatorProps) {
  const { t } = useLocale()
  const config = STATUS_CONFIG[status]
  const label = t(STATUS_LABEL_KEYS[status])

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "6px 16px",
      flexShrink: 0,
    }}>
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px",
        borderRadius: 20,
        background: "var(--glass-bg)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--glass-border)",
        boxShadow: "var(--glass-shadow)",
      }}>
        <div style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: config.color,
          boxShadow: config.pulse ? `0 0 8px ${config.color}` : "none",
          animation: config.pulse ? "pulse 2s ease-in-out infinite" : "none",
        }} />
        <span style={{
          fontSize: 11,
          color: "var(--text-secondary)",
          fontWeight: 600,
          letterSpacing: 0.3,
        }}>
          {agentName} {label}
        </span>
      </div>
    </div>
  )
}
