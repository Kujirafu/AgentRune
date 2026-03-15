// PhaseGateSheet — Human intervention gate between crew phases
// Shows phase results summary + 4 action buttons (proceed / instructions / retry / abort)
import { useState, type ReactNode } from "react"
import type { PhaseGateRequest, PhaseGateAction } from "../data/automation-types"

interface PhaseGateSheetProps {
  gate: PhaseGateRequest
  onRespond: (action: PhaseGateAction, instructions?: string) => void
  t: (key: string) => string
}

// Lucide-style SVG icons
const _s = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }

const IconCheck = () => <svg {..._s}><polyline points="20 6 9 17 4 12"/></svg>
const IconMessageSquare = () => <svg {..._s}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
const IconRefresh = () => <svg {..._s}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
const IconSquare = () => <svg {..._s}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>

const ROLE_ICONS: Record<string, ReactNode> = {
  target: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  code: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  "shield-check": <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>,
  wrench: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
  brain: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44A2.5 2.5 0 012 17.5v0A2.5 2.5 0 014.5 15 2.5 2.5 0 012 12.5v0A2.5 2.5 0 014.5 10a2.5 2.5 0 01-2-4A2.5 2.5 0 019.5 2z"/><path d="M14.5 2A2.5 2.5 0 0012 4.5v15a2.5 2.5 0 004.96.44A2.5 2.5 0 0022 17.5v0a2.5 2.5 0 00-2.5-2.5A2.5 2.5 0 0022 12.5v0a2.5 2.5 0 00-2.5-2.5 2.5 2.5 0 002-4A2.5 2.5 0 0014.5 2z"/></svg>,
  search: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
}
function getRoleIcon(iconName: string): ReactNode {
  return ROLE_ICONS[iconName] || <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>
}

const STATUS_COLORS: Record<string, string> = {
  completed: "#22c55e",
  failed: "#ef4444",
  circuit_broken: "#f59e0b",
}

export default function PhaseGateSheet({ gate, onRespond, t }: PhaseGateSheetProps) {
  const [mode, setMode] = useState<"main" | "instructions" | "retry">("main")
  const [instructions, setInstructions] = useState("")
  const [sending, setSending] = useState(false)

  const tokenPct = gate.tokenBudget > 0 ? Math.min(100, Math.round((gate.totalTokensUsed / gate.tokenBudget) * 100)) : 0

  const handleAction = (action: PhaseGateAction) => {
    setSending(true)
    const instr = instructions.trim() || undefined
    onRespond(action, instr)
  }

  return (
    <>
      {/* Backdrop — no click dismiss, must respond via buttons */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 99, background: "rgba(0,0,0,0.35)" }}
      />

      {/* Sheet — no swipe dismiss */}
      <div
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100,
          maxHeight: "80dvh", borderRadius: "20px 20px 0 0",
          background: "var(--glass-bg, rgba(255,255,255,0.95))",
          backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          boxShadow: "0 -4px 30px rgba(0,0,0,0.15)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(0,0,0,0.15)" }} />
        </div>

        {/* Header */}
        <div style={{ padding: "8px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>
              {t("phaseGate.title")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              {gate.automationName}
            </div>
          </div>
          <div style={{
            padding: "4px 10px", borderRadius: 8,
            background: "rgba(55,172,192,0.1)",
            fontSize: 11, fontWeight: 600, color: "#37ACC0",
          }}>
            {t("phaseGate.waiting")}
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>

          {/* Phase status badges */}
          <div style={{
            display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap",
          }}>
            <div style={{
              padding: "6px 12px", borderRadius: 8,
              background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)",
              fontSize: 12, fontWeight: 600, color: "#22c55e",
            }}>
              {t("phaseGate.phaseCompleted").replace("{n}", String(gate.completedPhase))}
            </div>
            <div style={{
              padding: "6px 12px", borderRadius: 8,
              background: "rgba(55,172,192,0.08)", border: "1px solid rgba(55,172,192,0.2)",
              fontSize: 12, fontWeight: 600, color: "#37ACC0",
            }}>
              {t("phaseGate.nextPhase").replace("{n}", String(gate.nextPhase))}
            </div>
          </div>

          {/* Token progress bar */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>
              {t("phaseGate.tokensUsed")
                .replace("{used}", gate.totalTokensUsed.toLocaleString())
                .replace("{budget}", gate.tokenBudget.toLocaleString())}
            </div>
            <div style={{
              height: 6, borderRadius: 3,
              background: "var(--glass-border, rgba(0,0,0,0.08))",
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%", borderRadius: 3,
                width: `${tokenPct}%`,
                background: tokenPct > 80 ? "#f59e0b" : "#37ACC0",
                transition: "width 0.3s ease",
              }} />
            </div>
          </div>

          {/* Phase results */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {gate.phaseResults.map((r) => (
              <div key={r.roleId} style={{
                padding: "10px 12px", borderRadius: 12,
                border: "1px solid var(--glass-border)",
                background: "var(--glass-bg)",
                display: "flex", alignItems: "flex-start", gap: 10,
              }}>
                {/* Role avatar */}
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                  background: r.color, display: "flex",
                  alignItems: "center", justifyContent: "center",
                }}>
                  {getRoleIcon(r.icon)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                      {r.roleName}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                      color: STATUS_COLORS[r.status] || "var(--text-secondary)",
                      background: `${STATUS_COLORS[r.status] || "var(--text-secondary)"}15`,
                    }}>
                      {r.status}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 12, color: "var(--text-secondary)", marginTop: 4,
                    lineHeight: 1.4,
                    display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as never,
                    overflow: "hidden",
                  }}>
                    {r.outputSummary}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Instructions input (shown for proceed_with_instructions or retry_with_instructions) */}
          {(mode === "instructions" || mode === "retry") && (
            <div style={{ marginBottom: 14 }}>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={mode === "instructions"
                  ? t("phaseGate.instructionsPlaceholder")
                  : t("phaseGate.retryInstructionsPlaceholder")}
                rows={3}
                autoFocus
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 12,
                  border: "1px solid var(--glass-border)",
                  background: "var(--glass-bg)",
                  color: "var(--text-primary)", fontSize: 13,
                  outline: "none", boxSizing: "border-box",
                  fontFamily: "inherit", lineHeight: 1.5, resize: "vertical",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => { setMode("main"); setInstructions("") }}
                  style={{
                    flex: 1, padding: "10px", borderRadius: 10,
                    border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                    fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", cursor: "pointer",
                  }}
                >
                  {t("app.cancel")}
                </button>
                <button
                  onClick={() => handleAction(
                    mode === "instructions" ? "proceed_with_instructions" : (instructions.trim() ? "retry_with_instructions" : "retry")
                  )}
                  disabled={sending || (mode === "instructions" && !instructions.trim())}
                  style={{
                    flex: 1, padding: "10px", borderRadius: 10,
                    border: "none", background: "#37ACC0",
                    fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer",
                    opacity: sending || (mode === "instructions" && !instructions.trim()) ? 0.5 : 1,
                  }}
                >
                  {mode === "instructions" ? t("phaseGate.proceedWithInstructions") : t("phaseGate.retry")}
                </button>
              </div>
            </div>
          )}

          {/* Action buttons (main mode) */}
          {mode === "main" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Proceed */}
              <button
                onClick={() => handleAction("proceed")}
                disabled={sending}
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: 12,
                  border: "none", background: "#37ACC0",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  fontSize: 14, fontWeight: 600, color: "#fff", cursor: "pointer",
                  opacity: sending ? 0.5 : 1,
                }}
              >
                <IconCheck /> {t("phaseGate.proceed")}
              </button>

              {/* Proceed with instructions */}
              <button
                onClick={() => setMode("instructions")}
                disabled={sending}
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: 12,
                  border: "1px solid rgba(55,172,192,0.3)", background: "rgba(55,172,192,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  fontSize: 14, fontWeight: 600, color: "#37ACC0", cursor: "pointer",
                  opacity: sending ? 0.5 : 1,
                }}
              >
                <IconMessageSquare /> {t("phaseGate.proceedWithInstructions")}
              </button>

              {/* Retry */}
              <button
                onClick={() => setMode("retry")}
                disabled={sending}
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: 12,
                  border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  fontSize: 14, fontWeight: 600, color: "var(--text-primary)", cursor: "pointer",
                  opacity: sending ? 0.5 : 1,
                }}
              >
                <IconRefresh /> {t("phaseGate.retry")}
              </button>

              {/* Abort */}
              <button
                onClick={() => handleAction("abort")}
                disabled={sending}
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: 12,
                  border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.04)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  fontSize: 14, fontWeight: 600, color: "#ef4444", cursor: "pointer",
                  opacity: sending ? 0.5 : 1,
                }}
              >
                <IconSquare /> {t("phaseGate.abort")}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
