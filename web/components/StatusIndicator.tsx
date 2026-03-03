// web/components/StatusIndicator.tsx
export type AgentStatus = "working" | "waiting" | "idle"

interface StatusIndicatorProps {
  status: AgentStatus
  agentName: string
}

const STATUS_CONFIG: Record<AgentStatus, { color: string; label: string; pulse: boolean }> = {
  working: { color: "#4ade80", label: "working...", pulse: true },
  waiting: { color: "#fbbf24", label: "waiting for you", pulse: true },
  idle: { color: "rgba(255,255,255,0.3)", label: "idle", pulse: false },
}

export function StatusIndicator({ status, agentName }: StatusIndicatorProps) {
  const config = STATUS_CONFIG[status]

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 16px",
      background: "rgba(255,255,255,0.02)",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
    }}>
      <div style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: config.color,
        boxShadow: config.pulse ? `0 0 8px ${config.color}` : "none",
        animation: config.pulse ? "pulse 2s ease-in-out infinite" : "none",
      }} />
      <span style={{
        fontSize: 12,
        color: config.color,
        fontWeight: 500,
      }}>
        {agentName} {config.label}
      </span>
    </div>
  )
}
