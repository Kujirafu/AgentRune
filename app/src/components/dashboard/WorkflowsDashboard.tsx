import React from "react"
import { BUILTIN_CREWS, CHAIN_TEMPLATES } from "../../data/builtin-crews"
import { BUILTIN_CHAINS, getStepCount } from "../../lib/skillChains"
import type { AutomationTemplate } from "../../data/automation-types"

interface WorkflowsDashboardProps {
  theme: "light" | "dark"
  t: (key: string) => string
  onFireCrew: () => void
  onOpenChainBuilder: () => void
}

// Lucide-style SVG props
const _s = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }

const CREW_ICONS: Record<string, React.ReactNode> = {
  rocket: <svg {..._s}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/></svg>,
  megaphone: <svg {..._s}><path d="M3 11l18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/></svg>,
  target: <svg {..._s}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  wrench: <svg {..._s}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
  scale: <svg {..._s}><line x1="12" y1="3" x2="12" y2="21"/><path d="M4 8l4 6H0L4 8z"/><path d="M20 8l4 6h-8l4-6z"/><line x1="4" y1="3" x2="20" y2="3"/></svg>,
  search: <svg {..._s}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
}

function getCrewIcon(tmpl: AutomationTemplate): React.ReactNode {
  const iconName = tmpl.crew?.roles?.[0]?.icon || "rocket"
  return CREW_ICONS[iconName] || CREW_ICONS.rocket
}

export function WorkflowsDashboard({
  theme,
  t,
  onFireCrew,
  onOpenChainBuilder,
}: WorkflowsDashboardProps) {
  const dark = theme === "dark"
  const cardBg = dark ? "rgba(30,41,59,0.7)" : "rgba(255,255,255,0.8)"
  const cardBorder = dark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.15)"
  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"

  const resolveCrewName = (tmpl: AutomationTemplate) => {
    const pk = tmpl.id.replace("crew_", "")
    const ck = `crew.preset.${pk}`
    const ct = t(ck)
    return ct !== ck ? ct : tmpl.name
  }

  const resolveCrewDesc = (tmpl: AutomationTemplate) => {
    const pk = tmpl.id.replace("crew_", "")
    const ck = `crew.preset.${pk}.desc`
    const ct = t(ck)
    return ct !== ck ? ct : tmpl.description
  }

  const resolveChainName = (tmpl: AutomationTemplate) => {
    const slug = tmpl.id.replace("chain_", "")
    const ck = `chain.${slug}.name`
    const ct = t(ck)
    return ct !== ck ? ct : slug
  }

  const resolveChainDesc = (tmpl: AutomationTemplate) => {
    const slug = tmpl.id.replace("chain_", "")
    const ck = `chain.${slug}.desc`
    const ct = t(ck)
    return ct !== ck ? ct : tmpl.description
  }

  return (
    <div style={{ padding: "0 24px 24px" }}>
      {/* Crew Templates */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: textPrimary,
          marginBottom: 12, letterSpacing: 0.3,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          {t("dash.crewTemplates")}
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 10,
        }}>
          {BUILTIN_CREWS.map((tmpl) => (
            <div
              key={tmpl.id}
              onClick={onFireCrew}
              style={{
                padding: "14px 16px", borderRadius: 12, cursor: "pointer",
                background: cardBg,
                backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                border: `1px solid ${cardBorder}`,
                transition: "box-shadow 0.2s, transform 0.15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 16px ${dark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.08)"}` }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ""; (e.currentTarget as HTMLElement).style.boxShadow = "" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: `${tmpl.crew?.roles?.[0]?.color || "#37ACC0"}20`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: tmpl.crew?.roles?.[0]?.color || "#37ACC0",
                }}>
                  {getCrewIcon(tmpl)}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: textPrimary }}>
                    {resolveCrewName(tmpl)}
                  </div>
                  <div style={{ fontSize: 11, color: textSecondary }}>
                    {tmpl.crew?.roles?.length || 0} roles
                  </div>
                </div>
              </div>
              <div style={{
                fontSize: 12, color: textSecondary, lineHeight: 1.4,
                overflow: "hidden", display: "-webkit-box",
                WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any,
              }}>
                {resolveCrewDesc(tmpl)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Skill Chains */}
      <div>
        <div style={{
          fontSize: 13, fontWeight: 600, color: textPrimary,
          marginBottom: 12, letterSpacing: 0.3,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          {t("dash.skillChains")}
          <span style={{ fontSize: 11, color: textSecondary, fontWeight: 400 }}>
            ({CHAIN_TEMPLATES.length})
          </span>
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 8,
        }}>
          {CHAIN_TEMPLATES.slice(0, 12).map((tmpl) => {
            const chain = BUILTIN_CHAINS.find((c) => c.slug === tmpl.id.replace("chain_", ""))
            const stepCount = chain ? getStepCount(chain) : 0
            return (
              <div
                key={tmpl.id}
                onClick={onOpenChainBuilder}
                style={{
                  padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                  background: cardBg,
                  backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                  border: `1px solid ${cardBorder}`,
                  display: "flex", alignItems: "center", gap: 10,
                  transition: "box-shadow 0.2s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = `0 2px 12px ${dark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.06)"}` }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: textPrimary,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {resolveChainName(tmpl)}
                  </div>
                  <div style={{ fontSize: 11, color: textSecondary }}>
                    {stepCount > 0 ? `${stepCount} steps` : ""}
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, flexShrink: 0 }}>
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            )
          })}
        </div>
        {CHAIN_TEMPLATES.length > 12 && (
          <button
            onClick={onOpenChainBuilder}
            style={{
              marginTop: 10, padding: "8px 16px", borderRadius: 8,
              border: `1px solid ${cardBorder}`, background: "transparent",
              color: "#37ACC0", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            {t("dash.skillChains")} ({CHAIN_TEMPLATES.length})
          </button>
        )}
      </div>
    </div>
  )
}
