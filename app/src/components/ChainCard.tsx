import { useState } from "react"
import type { SkillChainDef, ChainDepth, ChainPhase } from "../lib/skillChains"
import { estimateTokens, formatChainInstructions } from "../lib/skillChains"

// Phase colors — distinct for dark/light via CSS vars, fallback to hardcoded
const PHASE_COLORS: Record<ChainPhase, { dot: string; text: string }> = {
  design:    { dot: "#a78bfa", text: "#c4b5fd" },
  implement: { dot: "#60a5fa", text: "#93c5fd" },
  verify:    { dot: "#34d399", text: "#6ee7b7" },
  ship:      { dot: "#fbbf24", text: "#fcd34d" },
}

interface ChainCardProps {
  chain: SkillChainDef
  onSend: (instructions: string, display: string) => void
  t: (key: string) => string
}

export function ChainCard({ chain, onSend, t }: ChainCardProps) {
  const [depth, setDepth] = useState<ChainDepth>("lite")
  const [expanded, setExpanded] = useState(true)

  const tokens = estimateTokens(chain, depth)
  const name = t(chain.nameKey)
  const desc = t(chain.descKey)
  const stepCount = chain.steps.length

  const handleStart = () => {
    const instructions = formatChainInstructions(chain, depth, t)
    onSend(instructions, `/${chain.slug}`)
  }

  // Depth button styles
  const depthBtn = (d: ChainDepth) => ({
    flex: 1,
    padding: "5px 0",
    border: depth === d ? "1px solid var(--accent-primary)" : "1px solid var(--glass-border)",
    borderRadius: 6,
    background: depth === d ? "var(--accent-primary-bg)" : "transparent",
    color: depth === d ? "var(--accent-primary)" : "var(--text-secondary)",
    fontSize: 11,
    fontWeight: depth === d ? 700 : 400,
    cursor: "pointer",
  })

  return (
    <div style={{
      borderRadius: 10,
      border: "1px solid var(--glass-border)",
      background: "var(--glass-bg)",
      overflow: "hidden",
      marginBottom: 6,
    }}>
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          padding: "8px 12px",
          border: "none",
          background: "transparent",
          color: "var(--text-primary)",
          cursor: "pointer",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {/* Chain icon — Lucide link SVG */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 700, fontSize: 13,
          color: "var(--accent-primary)",
          flexShrink: 0,
        }}>
          /{chain.slug}
        </span>
        <span style={{
          fontSize: 11, color: "var(--text-secondary)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          flex: 1,
        }}>
          {desc}
        </span>
        <span style={{
          fontSize: 9, flexShrink: 0,
          color: "var(--text-secondary)", opacity: 0.7,
        }}>
          {t("chain.steps").replace("{count}", String(stepCount))}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expanded — pipeline + depth + start */}
      {expanded && (
        <div style={{ padding: "0 14px 12px" }}>
          {/* Pipeline visualization */}
          <div style={{ marginBottom: 10 }}>
            {chain.steps.map((step, i) => {
              const colors = PHASE_COLORS[step.phase]
              const label = t(step.labelKey)
              const phase = t(`chain.phase.${step.phase}`)
              const isLast = i === chain.steps.length - 1

              return (
                <div key={step.id} style={{ display: "flex", alignItems: "stretch", minHeight: 28 }}>
                  {/* Left: dot + connector line */}
                  <div style={{
                    width: 20, display: "flex", flexDirection: "column", alignItems: "center",
                    flexShrink: 0,
                  }}>
                    {/* Dot: filled = required, ring = optional */}
                    <div style={{
                      width: 10, height: 10, borderRadius: "50%",
                      marginTop: 5,
                      ...(step.required
                        ? { background: colors.dot }
                        : { border: `2px solid ${colors.dot}`, background: "transparent" }
                      ),
                      flexShrink: 0,
                    }} />
                    {/* Connector line */}
                    {!isLast && (
                      <div style={{
                        width: 1.5, flex: 1,
                        background: "var(--glass-border)",
                        marginTop: 2, marginBottom: 2,
                      }} />
                    )}
                  </div>

                  {/* Right: label + phase + optional tag */}
                  <div style={{
                    flex: 1, display: "flex", alignItems: "center", gap: 6,
                    paddingLeft: 6, paddingBottom: isLast ? 0 : 4,
                  }}>
                    <span style={{
                      fontSize: 12, fontWeight: 600,
                      color: "var(--text-primary)",
                    }}>
                      {label}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 500,
                      color: colors.text, opacity: 0.8,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}>
                      {phase}
                    </span>
                    {!step.required && (
                      <span style={{
                        fontSize: 9, color: "var(--text-secondary)",
                        opacity: 0.5, fontStyle: "italic",
                      }}>
                        {t("chain.optional")}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Depth selector */}
          <div style={{
            display: "flex", gap: 6, marginBottom: 8,
          }}>
            <button onClick={() => setDepth("lite")} style={depthBtn("lite")}>
              {t("chain.depth.lite")}
            </button>
            <button onClick={() => setDepth("standard")} style={depthBtn("standard")}>
              {t("chain.depth.standard")}
            </button>
            <button onClick={() => setDepth("deep")} style={depthBtn("deep")}>
              {t("chain.depth.deep")}
            </button>
          </div>

          {/* Token estimate */}
          <div style={{
            fontSize: 10, color: "var(--text-secondary)",
            textAlign: "center", marginBottom: 8, opacity: 0.7,
          }}>
            {t("chain.estTokens").replace("{count}", String(tokens))}
          </div>

          {/* Start button */}
          <button
            onClick={handleStart}
            style={{
              width: "100%",
              padding: "8px 12px", borderRadius: 10,
              border: "1px solid var(--accent-primary)",
              background: "var(--accent-primary-bg)",
              color: "var(--accent-primary)",
              fontSize: 12, fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {t("chain.start")} /{chain.slug}
          </button>
        </div>
      )}
    </div>
  )
}
