import type { SmartAction } from "../types"

interface IdleSuggestion {
  label: string
  description?: string
  command: string
  icon?: string
}

interface SmartSuggestionsProps {
  actions: SmartAction[]
  idleSuggestions: IdleSuggestion[]
  mode: "prompt" | "idle" | "hidden"
  onAction: (input: string) => void
}

export function SmartSuggestions({ actions, idleSuggestions, mode, onAction }: SmartSuggestionsProps) {
  if (mode === "hidden") return null

  return (
    <div style={{
      padding: "6px 10px",
      background: "rgba(15,23,42,0.9)",
      backdropFilter: "blur(16px)",
      borderTop: "1px solid rgba(255,255,255,0.06)",
      flexShrink: 0,
      maxHeight: 200,
      overflowY: "auto",
      WebkitOverflowScrolling: "touch" as never,
    }}>
      {mode === "prompt" && actions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={() => onAction(action.input)}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 12,
                border: `1px solid ${
                  action.style === "primary"
                    ? "rgba(96,165,250,0.3)"
                    : action.style === "danger"
                    ? "rgba(248,113,113,0.3)"
                    : "rgba(255,255,255,0.08)"
                }`,
                background:
                  action.style === "primary"
                    ? "rgba(96,165,250,0.1)"
                    : action.style === "danger"
                    ? "rgba(248,113,113,0.08)"
                    : "rgba(255,255,255,0.03)",
                backdropFilter: "blur(8px)",
                color:
                  action.style === "primary"
                    ? "#60a5fa"
                    : action.style === "danger"
                    ? "#f87171"
                    : "#e2e8f0",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s",
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {mode === "idle" && idleSuggestions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {idleSuggestions.map((sug, i) => (
            <button
              key={i}
              onClick={() => onAction(sug.command + "\n")}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.03)",
                backdropFilter: "blur(8px)",
                color: "#e2e8f0",
                fontSize: 13,
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{
                fontSize: 16,
                flexShrink: 0,
                width: 28,
                textAlign: "center",
              }}>
                {sug.icon || ">"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 500,
                  fontSize: 13,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {sug.label}
                </div>
                {sug.description && (
                  <div style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.3)",
                    marginTop: 2,
                  }}>
                    {sug.description}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
