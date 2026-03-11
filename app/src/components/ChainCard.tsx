import { useState } from "react"
import type { SkillChainDef, ChainDepth, ChainPhase, ChainNode } from "../lib/skillChains"
import { estimateTokens, formatChainInstructions, HIGH_COMPLEXITY_THRESHOLD, isParallelGroup, getStepCount, resolveChainText } from "../lib/skillChains"

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
  collapsed?: boolean   // start collapsed when showing multiple suggestions
  relevance?: number    // 0-1 match score, shown as badge
  onFork?: (chain: SkillChainDef) => void
}

export function ChainCard({ chain, onSend, t, collapsed, relevance, onFork }: ChainCardProps) {
  const [depth, setDepth] = useState<ChainDepth>("lite")
  const [expanded, setExpanded] = useState(!collapsed)

  const tokens = estimateTokens(chain, depth)
  const desc = resolveChainText(chain.descKey, t)
  const stepCount = getStepCount(chain)

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
        {/* Relevance badge — only for keyword/prefix matches */}
        {relevance != null && relevance < 1 && (
          <span style={{
            fontSize: 9, flexShrink: 0,
            padding: "1px 5px", borderRadius: 4,
            background: "var(--accent-primary-bg)",
            color: "var(--accent-primary)",
            fontWeight: 600,
          }}>
            {Math.round(relevance * 100)}%
          </span>
        )}
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
            {chain.steps.map((node, i) => {
              const isLast = i === chain.steps.length - 1

              if (isParallelGroup(node)) {
                const colors = PHASE_COLORS[node.phase]
                return (
                  <div key={node.id}>
                    {/* Fork connector — top line splits */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 0,
                      paddingLeft: 10, paddingRight: 10, height: 20,
                    }}>
                      <div style={{ flex: 1, height: 1.5, background: "var(--glass-border)" }} />
                      <span style={{
                        fontSize: 9, fontWeight: 600,
                        color: colors.text, opacity: 0.8,
                        padding: "0 6px", textTransform: "uppercase",
                      }}>
                        {t("chain.parallel.label")} · {t(`chain.parallel.${node.joinStrategy}`)}
                      </span>
                      <div style={{ flex: 1, height: 1.5, background: "var(--glass-border)" }} />
                    </div>

                    {/* Parallel branches — horizontal layout */}
                    <div style={{
                      display: "flex", gap: 8, padding: "4px 6px",
                      borderLeft: `1.5px solid ${colors.dot}`,
                      borderRight: `1.5px solid ${colors.dot}`,
                      marginLeft: 10, marginRight: 10, borderRadius: 4,
                    }}>
                      {node.branches.map((branch) => {
                        const bColors = PHASE_COLORS[branch.phase]
                        return (
                          <div key={branch.id} style={{
                            flex: 1, display: "flex", alignItems: "center", gap: 5,
                            padding: "4px 6px", borderRadius: 6,
                            background: "var(--glass-bg)",
                            border: "1px solid var(--glass-border)",
                          }}>
                            <div style={{
                              width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                              ...(branch.required
                                ? { background: bColors.dot }
                                : { border: `2px solid ${bColors.dot}`, background: "transparent" }
                              ),
                            }} />
                            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>
                              {t(branch.labelKey)}
                            </span>
                            {!branch.required && (
                              <span style={{
                                fontSize: 8, color: "var(--text-secondary)",
                                opacity: 0.5, fontStyle: "italic",
                              }}>
                                {t("chain.optional")}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Merge connector */}
                    {!isLast && (
                      <div style={{ display: "flex", justifyContent: "center", height: 12 }}>
                        <div style={{ width: 1.5, height: "100%", background: "var(--glass-border)" }} />
                      </div>
                    )}
                  </div>
                )
              }

              // Single step — standard rendering
              const step = node
              const colors = PHASE_COLORS[step.phase]
              const label = t(step.labelKey)
              const phase = t(`chain.phase.${step.phase}`)

              return (
                <div key={step.id} style={{ display: "flex", alignItems: "stretch", minHeight: 28 }}>
                  <div style={{
                    width: 20, display: "flex", flexDirection: "column", alignItems: "center",
                    flexShrink: 0,
                  }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: "50%", marginTop: 5,
                      ...(step.required
                        ? { background: colors.dot }
                        : { border: `2px solid ${colors.dot}`, background: "transparent" }
                      ),
                      flexShrink: 0,
                    }} />
                    {!isLast && (
                      <div style={{
                        width: 1.5, flex: 1, background: "var(--glass-border)",
                        marginTop: 2, marginBottom: 2,
                      }} />
                    )}
                  </div>
                  <div style={{
                    flex: 1, display: "flex", alignItems: "center", gap: 6,
                    paddingLeft: 6, paddingBottom: isLast ? 0 : 4,
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                      {label}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 500, color: colors.text, opacity: 0.8,
                      textTransform: "uppercase", letterSpacing: 0.5,
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

          {/* High-complexity warning */}
          {tokens >= HIGH_COMPLEXITY_THRESHOLD && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 6,
              padding: "6px 10px", marginBottom: 8,
              borderRadius: 8,
              border: "1px solid var(--warning-border, #f59e0b33)",
              background: "var(--warning-bg, #f59e0b0a)",
            }}>
              {/* Lucide alert-triangle SVG */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warning-text, #f59e0b)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <span style={{
                fontSize: 10, color: "var(--warning-text, #f59e0b)",
                lineHeight: 1.4,
              }}>
                {t("chain.highComplexity")}
              </span>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            {onFork && (
              <button
                onClick={() => onFork(chain)}
                style={{
                  padding: "8px 12px", borderRadius: 10,
                  border: "1px solid var(--glass-border)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  fontSize: 12, fontWeight: 600,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 5,
                }}
              >
                {/* Lucide git-fork SVG */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/>
                  <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>
                </svg>
                {t("chain.fork")}
              </button>
            )}
            <button
              onClick={handleStart}
              style={{
                flex: 1,
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
        </div>
      )}
    </div>
  )
}
