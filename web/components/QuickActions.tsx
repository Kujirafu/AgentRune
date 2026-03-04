import { useLocale } from "../lib/i18n/index.js"

const ACTIONS = [
  { key: "quick.stop", seq: "\x03", accent: "red" as const },
  { key: null, label: "Tab", seq: "\t", accent: "" as const },
  { key: "quick.undo", seq: "\x1a", accent: "" as const },
  { key: "quick.clear", seq: "\x0c", accent: "" as const },
  { key: "quick.exit", seq: "\x04", accent: "amber" as const },
]

const ACCENT_STYLES = {
  red: {
    border: "1px solid rgba(239,68,68,0.25)",
    background: "rgba(239,68,68,0.08)",
    color: "#ef4444",
  },
  amber: {
    border: "1px solid rgba(245,158,11,0.25)",
    background: "rgba(245,158,11,0.08)",
    color: "#f59e0b",
  },
  "": {
    border: "1px solid var(--glass-border)",
    background: "var(--glass-bg)",
    color: "var(--text-secondary)",
  },
}

interface QuickActionsProps {
  onAction: (seq: string) => void
}

export function QuickActions({ onAction }: QuickActionsProps) {
  const { t } = useLocale()
  return (
    <div style={{
      display: "flex",
      gap: 6,
      padding: "8px 12px",
      overflowX: "auto",
      flexShrink: 0,
      WebkitOverflowScrolling: "touch" as never,
      scrollbarWidth: "none",
      msOverflowStyle: "none",
    }}>
      {ACTIONS.map((a) => {
        const style = ACCENT_STYLES[a.accent]
        return (
          <button
            key={a.key || a.label}
            onClick={() => onAction(a.seq)}
            style={{
              flexShrink: 0,
              padding: "8px 16px",
              borderRadius: 14,
              border: style.border,
              background: style.background,
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: "var(--glass-shadow)",
              color: style.color,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              minWidth: 44,
              textAlign: "center",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              letterSpacing: 0.3,
            }}
          >
            {a.key ? t(a.key) : a.label}
          </button>
        )
      })}
    </div>
  )
}
