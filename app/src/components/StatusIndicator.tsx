import { useLocale } from "../lib/i18n/index.js"

export type AgentStatus = "working" | "waiting" | "idle"

interface StatusIndicatorProps {
  status: AgentStatus
  agentName: string
}

const STATUS_LABEL_KEYS: Record<AgentStatus, string> = {
  working: "status.working",
  waiting: "status.waiting",
  idle: "status.idle",
}

export function StatusIndicator({ status, agentName }: StatusIndicatorProps) {
  const { t } = useLocale()
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
