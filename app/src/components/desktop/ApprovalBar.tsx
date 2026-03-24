import React from "react"
import type { PhaseGateRequest, PendingReauthRequest, PhaseGateAction } from "../../data/automation-types"

interface ApprovalBarProps {
  pendingPhaseGate: PhaseGateRequest | null
  pendingReauthQueue: PendingReauthRequest[]
  onPhaseGateRespond: (action: PhaseGateAction, instructions?: string, reviewNote?: string) => void
  onReauth: (automationId: string) => void
  theme: "light" | "dark"
}

export function ApprovalBar({
  pendingPhaseGate, pendingReauthQueue,
  onPhaseGateRespond, onReauth, theme,
}: ApprovalBarProps) {
  const dark = theme === "dark"
  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const border = dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)"

  const hasItems = !!pendingPhaseGate || pendingReauthQueue.length > 0
  if (!hasItems) return null

  return (
    <div style={{
      padding: "6px 16px",
      borderTop: `1px solid ${border}`,
      display: "flex", flexWrap: "wrap", gap: 6,
    }}>
      {/* Phase gate approval */}
      {pendingPhaseGate && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 10px", borderRadius: 6,
          background: dark ? "rgba(239,68,68,0.06)" : "rgba(239,68,68,0.04)",
          border: "1px solid rgba(239,68,68,0.15)",
          fontSize: 10,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FB8184" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span style={{ color: textPrimary, fontWeight: 500 }}>
            {pendingPhaseGate.automationName} — Phase {pendingPhaseGate.completedPhase}/{pendingPhaseGate.nextPhase}
          </span>
          <button
            onClick={() => onPhaseGateRespond("proceed")}
            style={{
              padding: "2px 8px", fontSize: 9, fontWeight: 600,
              borderRadius: 4, border: "none",
              background: "#BDD1C6", color: "#fff", cursor: "pointer",
            }}
          >
            Approve
          </button>
          <button
            onClick={() => onPhaseGateRespond("abort")}
            style={{
              padding: "2px 8px", fontSize: 9, fontWeight: 600,
              borderRadius: 4, border: `1px solid ${border}`,
              background: "transparent", color: "#FB8184", cursor: "pointer",
            }}
          >
            Reject
          </button>
        </div>
      )}

      {/* Reauth requests */}
      {pendingReauthQueue.map((req) => (
        <div key={req.automationId} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 10px", borderRadius: 6,
          background: dark ? "rgba(245,158,11,0.06)" : "rgba(245,158,11,0.04)",
          border: "1px solid rgba(245,158,11,0.15)",
          fontSize: 10,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D09899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span style={{ color: textPrimary, fontWeight: 500 }}>
            {req.automationName} — {req.violationType}
          </span>
          <button
            onClick={() => onReauth(req.automationId)}
            style={{
              padding: "2px 8px", fontSize: 9, fontWeight: 600,
              borderRadius: 4, border: "none",
              background: "#D09899", color: "#fff", cursor: "pointer",
            }}
          >
            Re-auth
          </button>
        </div>
      ))}
    </div>
  )
}
