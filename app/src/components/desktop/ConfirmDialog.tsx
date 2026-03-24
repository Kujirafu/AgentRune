import React, { useEffect } from "react"

export interface ConfirmDialogProps {
  open: boolean
  theme: "light" | "dark"
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open, theme, title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const dark = theme === "dark"

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel()
      if (e.key === "Enter") onConfirm()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onCancel, onConfirm])

  if (!open) return null

  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const glassBg = dark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.92)"
  const glassBorder = dark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.18)"
  const confirmBg = danger ? "#FB8184" : "#37ACC0"

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onCancel}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      />
      {/* Dialog */}
      <div style={{
        position: "fixed",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 201,
        width: "min(360px, 85vw)",
        borderRadius: 14,
        background: glassBg,
        backdropFilter: "blur(40px) saturate(1.4)",
        WebkitBackdropFilter: "blur(40px) saturate(1.4)",
        border: `1px solid ${glassBorder}`,
        boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
        padding: 20,
        color: textPrimary,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}>
        {/* Warning icon */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{
            width: 32, height: 32, borderRadius: 8,
            background: danger
              ? (dark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.08)")
              : (dark ? "rgba(55,172,192,0.12)" : "rgba(55,172,192,0.08)"),
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke={danger ? "#FB8184" : "#37ACC0"}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
        </div>

        {message && (
          <div style={{
            fontSize: 13, color: textSecondary, lineHeight: 1.6,
            marginBottom: 16, paddingLeft: 42,
          }}>
            {message}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "8px 16px", borderRadius: 8,
              border: `1px solid ${glassBorder}`,
              background: "transparent",
              color: textSecondary, fontSize: 12, fontWeight: 500,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {cancelLabel || "Cancel"}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: confirmBg,
              color: "#fff", fontSize: 12, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </>
  )
}
