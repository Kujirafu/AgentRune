import React from "react"
import type { AppSession } from "../../types"
import { AGENTS } from "../../types"
import type { SessionDecisionDigest } from "../../lib/session-summary"
import type { EnhancedRoutedInstruction } from "../../lib/command-router"

interface RoutingPreviewProps {
  routes: EnhancedRoutedInstruction[]
  sessions: AppSession[]
  digests: Map<string, SessionDecisionDigest>
  onConfirm: () => void
  onCancel: () => void
  theme: "light" | "dark"
  t: (key: string) => string
}

export function RoutingPreview({
  routes, sessions, digests, onConfirm, onCancel, theme, t,
}: RoutingPreviewProps) {
  const dark = theme === "dark"
  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const border = dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)"
  const bg = dark ? "rgba(30,41,59,0.8)" : "rgba(241,245,249,0.9)"

  if (routes.length === 0) return null

  return (
    <div style={{
      padding: "8px 16px",
      background: bg,
      borderTop: `1px solid ${border}`,
      backdropFilter: "blur(16px)",
      WebkitBackdropFilter: "blur(16px)",
    }}>
      <div style={{ fontSize: 9, color: textSecondary, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Routing Preview
      </div>
      {routes.map((route, i) => {
        const session = route.sessionId ? sessions.find(s => s.id === route.sessionId) : null
        const digest = route.sessionId ? digests.get(route.sessionId) : null
        const agentId = route.agents?.[0] || session?.agentId
        const agentDef = agentId ? AGENTS.find(a => a.id === agentId) : null
        const model = route.models?.[0]
        const rawIdx = session ? sessions.findIndex(s => s.id === session.id) : -1
        const sessionIdx = rawIdx >= 0 ? rawIdx + 1 : null

        return (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "3px 0", fontSize: 10,
          }}>
            {/* Session # */}
            <span style={{
              width: 16, height: 16, borderRadius: 4,
              background: dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.08)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 700, color: textSecondary, flexShrink: 0,
            }}>
              {sessionIdx || "?"}
            </span>
            {/* Agent */}
            <span style={{ color: "#6ee7b7", fontWeight: 600, fontSize: 9 }}>
              {agentDef?.name || agentId || "Auto"}
            </span>
            {/* Model + reasoning */}
            {model && (
              <span style={{ color: "#37ACC0", fontSize: 9, fontWeight: 500 }}>
                {model}
              </span>
            )}
            {/* Instruction */}
            <span style={{ flex: 1, color: textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {route.instruction}
            </span>
            {/* New session badge */}
            {!route.sessionId && (
              <span style={{ fontSize: 8, color: "#D09899", fontWeight: 600, padding: "1px 4px", borderRadius: 3, background: "rgba(245,158,11,0.1)" }}>
                NEW
              </span>
            )}
          </div>
        )
      })}
      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            padding: "3px 10px", fontSize: 10, fontWeight: 600,
            borderRadius: 5, border: `1px solid ${border}`,
            background: "transparent", cursor: "pointer", color: textSecondary,
          }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          style={{
            padding: "3px 10px", fontSize: 10, fontWeight: 600,
            borderRadius: 5, border: "none",
            background: "#37ACC0", cursor: "pointer", color: "#ffffff",
          }}
        >
          Confirm
        </button>
      </div>
    </div>
  )
}
