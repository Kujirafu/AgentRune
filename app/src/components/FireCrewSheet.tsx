// FireCrewSheet — Session-triggered fire-and-forget crew execution
// User picks a crew template, fires it with current session context
import { useState, type ReactNode } from "react"
import { BUILTIN_CREWS } from "../data/builtin-crews"
import { BUILTIN_CHAINS, isParallelGroup, resolveChainText } from "../lib/skillChains"
import type { CrewConfig } from "../data/automation-types"
import { useSwipeToDismiss } from "../hooks/useSwipeToDismiss"
import { trackCrewStart } from "../lib/analytics"

interface FireCrewSheetProps {
  open: boolean
  onClose: () => void
  t: (key: string) => string
  serverUrl: string
  projectId: string
  sessionId: string | null
  sessionSummary?: string
}

// --- Lucide-style SVG icons for crew role avatars ---
const _s = { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "#fff", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
const CREW_ROLE_ICONS: Record<string, ReactNode> = {
  target: <svg {..._s}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  code: <svg {..._s}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  "shield-check": <svg {..._s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>,
  lock: <svg {..._s}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  wrench: <svg {..._s}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
  megaphone: <svg {..._s}><path d="M3 11l18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/></svg>,
  "trending-up": <svg {..._s}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  rocket: <svg {..._s}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/></svg>,
  "shield-alert": <svg {..._s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  bug: <svg {..._s}><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M2 10h4"/><path d="M18 10h4"/><path d="M2 14h4"/><path d="M18 14h4"/><path d="M6 6l-2-2"/><path d="M18 6l2-2"/></svg>,
  brain: <svg {..._s}><path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44A2.5 2.5 0 012 17.5v0A2.5 2.5 0 014.5 15 2.5 2.5 0 012 12.5v0A2.5 2.5 0 014.5 10a2.5 2.5 0 01-2-4A2.5 2.5 0 019.5 2z"/><path d="M14.5 2A2.5 2.5 0 0012 4.5v15a2.5 2.5 0 004.96.44A2.5 2.5 0 0022 17.5v0a2.5 2.5 0 00-2.5-2.5A2.5 2.5 0 0022 12.5v0a2.5 2.5 0 00-2.5-2.5 2.5 2.5 0 002-4A2.5 2.5 0 0014.5 2z"/></svg>,
  search: <svg {..._s}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  "check-circle": <svg {..._s}><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  lightbulb: <svg {..._s}><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>,
  boxes: <svg {..._s}><path d="M2.97 12.92A2 2 0 002 14.63v3.24a2 2 0 001.02 1.75l3.5 1.99a2 2 0 001.96.01l3.5-1.97a2 2 0 001.02-1.75v-3.24a2 2 0 00-.97-1.71L7.58 11a2 2 0 00-2.05.01z"/></svg>,
  "test-tubes": <svg {..._s}><path d="M9 2v17.5A2.5 2.5 0 0011.5 22v0a2.5 2.5 0 002.5-2.5V2"/><path d="M20 2v17.5a2.5 2.5 0 01-2.5 2.5v0a2.5 2.5 0 01-2.5-2.5V2"/></svg>,
  "pen-tool": <svg {..._s}><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>,
  "layout-list": <svg {..._s}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  "file-text": <svg {..._s}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  scale: <svg {..._s}><line x1="12" y1="3" x2="12" y2="21"/><path d="M4 8l4 6H0L4 8z"/><path d="M20 8l4 6h-8l4-6z"/><line x1="4" y1="3" x2="20" y2="3"/></svg>,
  "clipboard-list": <svg {..._s}><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>,
}
function getCrewRoleIcon(iconName: string): ReactNode {
  return CREW_ROLE_ICONS[iconName] || <svg {..._s}><circle cx="12" cy="12" r="10"/></svg>
}

// Lucide play icon
const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
)

export default function FireCrewSheet({ open, onClose, t, serverUrl, projectId, sessionId, sessionSummary }: FireCrewSheetProps) {
  const [firing, setFiring] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [phaseGate, setPhaseGate] = useState(false)
  const { sheetRef, handlers } = useSwipeToDismiss({ onDismiss: onClose })

  const handleFire = async (crew: CrewConfig, templateName: string) => {
    setFiring(true)
    setResult(null)

    // Serialize skill chain workflows for each role
    const serializedCrew: CrewConfig = {
      ...crew,
      phaseGate,
      roles: crew.roles.map(r => {
        if (!r.skillChainSlug) return r
        const chain = BUILTIN_CHAINS.find(c => c.slug === r.skillChainSlug)
        if (!chain) return r
        const lines: string[] = []
        let stepNum = 1
        for (const node of chain.steps) {
          if (isParallelGroup(node)) {
            const branchTexts = node.branches.map(b => {
              const label = resolveChainText(b.labelKey, t)
              return b.hint ? `${label} [${b.hint}]` : label
            })
            lines.push(`${stepNum}. [PARALLEL] ${branchTexts.join(" + ")}`)
          } else {
            const suffix = node.required ? "" : " (optional)"
            const hint = node.hint ? `\n   Checklist: ${node.hint}` : ""
            lines.push(`${stepNum}. ${resolveChainText(node.labelKey, t)}${suffix}${hint}`)
          }
          stepNum++
        }
        return { ...r, skillChainWorkflow: lines.join("\n") }
      }),
    }

    try {
      const res = await fetch(`${serverUrl}/api/automations/${projectId}/fire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crew: serializedCrew,
          name: templateName,
          sessionContext: sessionSummary || undefined,
        }),
      })
      if (res.ok) {
        trackCrewStart(templateName, crew.roles.length, crew.tokenBudget)
        setResult({ ok: true, msg: t("fireCrew.success") })
        setTimeout(onClose, 1500)
      } else {
        const data = await res.json().catch(() => ({}))
        setResult({ ok: false, msg: data.error || "Failed" })
      }
    } catch {
      setResult({ ok: false, msg: "Network error" })
    }
    setFiring(false)
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 99,
          background: "rgba(0,0,0,0.35)",
        }}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        {...handlers}
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100,
          maxHeight: "75dvh", borderRadius: "20px 20px 0 0",
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
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>
            {t("fireCrew.title")}
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "var(--text-secondary)",
            fontSize: 14, cursor: "pointer", padding: "4px 8px",
          }}>
            {t("app.cancel")}
          </button>
        </div>

        {/* Session context badge — only show that context is attached, not raw event titles */}
        {sessionId && (
          <div style={{ padding: "0 16px 8px" }}>
            <div style={{
              fontSize: 11, color: "var(--text-secondary)", padding: "6px 10px",
              borderRadius: 8, background: "rgba(55,172,192,0.08)",
              border: "1px solid rgba(55,172,192,0.15)",
            }}>
              {t("fireCrew.contextAttached")}
            </div>
          </div>
        )}

        {/* Phase Gate toggle + Template list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
          {/* Phase Gate toggle */}
          <button
            onClick={() => setPhaseGate(!phaseGate)}
            style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              padding: "10px 12px", marginBottom: 10, borderRadius: 10,
              border: `1px solid ${phaseGate ? "rgba(55,172,192,0.3)" : "var(--glass-border)"}`,
              background: phaseGate ? "rgba(55,172,192,0.06)" : "var(--glass-bg)",
              cursor: "pointer", textAlign: "left",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={phaseGate ? "#37ACC0" : "var(--text-secondary)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: phaseGate ? "#37ACC0" : "var(--text-primary)" }}>
                {t("crew.phaseGate")}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 1 }}>
                {t("crew.phaseGateDesc")}
              </div>
            </div>
            <div style={{
              width: 34, height: 20, borderRadius: 10, padding: 2,
              background: phaseGate ? "#37ACC0" : "rgba(0,0,0,0.15)",
              transition: "background 0.2s",
              display: "flex", alignItems: "center",
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: "50%", background: "#fff",
                transform: phaseGate ? "translateX(14px)" : "translateX(0)",
                transition: "transform 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
              }} />
            </div>
          </button>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {BUILTIN_CREWS.map((tmpl) => {
              // tmpl.name is raw id like "overnight_sprint", tmpl.crew has the CrewConfig
              const presetKey = tmpl.name // e.g. "overnight_sprint"
              const nameKey = `crew.preset.${presetKey}`
              const descKey = `crew.preset.${presetKey}.desc`
              const name = t(nameKey) !== nameKey ? t(nameKey) : presetKey
              const desc = t(descKey) !== descKey ? t(descKey) : ""
              if (!tmpl.crew) return null
              return (
                <button
                  key={tmpl.id}
                  disabled={firing}
                  onClick={() => handleFire(tmpl.crew!, name)}
                  style={{
                    width: "100%", textAlign: "left",
                    padding: "12px 14px", borderRadius: 14,
                    border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)",
                    cursor: firing ? "default" : "pointer",
                    opacity: firing ? 0.5 : 1,
                    display: "flex", alignItems: "center", gap: 12,
                  }}
                >
                  {/* Role icons — use role-specific Lucide icons */}
                  <div style={{ display: "flex" }}>
                    {tmpl.crew.roles.slice(0, 3).map((role, i) => (
                      <div key={role.id} style={{
                        width: 28, height: 28, borderRadius: "50%",
                        background: role.color, display: "flex",
                        alignItems: "center", justifyContent: "center",
                        marginLeft: i > 0 ? -6 : 0,
                        border: "2px solid var(--card-bg)",
                        zIndex: 3 - i,
                      }}>
                        {getCrewRoleIcon(role.icon)}
                      </div>
                    ))}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{name}</div>
                    {desc && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{desc}</div>}
                    <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2 }}>
                      {tmpl.crew.roles.length} {t("fireCrew.roles")} · ~{tmpl.crew.tokenBudget.toLocaleString()} tok
                    </div>
                  </div>
                  <PlayIcon />
                </button>
              )
            })}
          </div>

          {/* Result toast */}
          {result && (
            <div style={{
              marginTop: 12, padding: "10px 14px", borderRadius: 10,
              background: result.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
              color: result.ok ? "#22c55e" : "#ef4444",
              fontSize: 13, fontWeight: 600, textAlign: "center",
            }}>
              {result.msg}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
