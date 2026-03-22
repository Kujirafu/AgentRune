import React, { useState, useEffect } from "react"

export interface NewProjectDialogProps {
  open: boolean
  theme: "light" | "dark"
  t: (key: string) => string
  onCreateProject: (name: string, cwd: string) => Promise<void>
  onClose: () => void
}

export function NewProjectDialog({
  open, theme, t, onCreateProject, onClose,
}: NewProjectDialogProps) {
  const dark = theme === "dark"
  const [name, setName] = useState("")
  const [cwd, setCwd] = useState("")
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open) { setName(""); setCwd(""); setCreating(false) }
  }, [open])

  // Esc to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onClose])

  if (!open) return null

  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const glassBg = dark ? "rgba(15,23,42,0.92)" : "rgba(255,255,255,0.92)"
  const glassBorder = dark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.18)"
  const inputBg = dark ? "rgba(30,41,59,0.6)" : "rgba(241,245,249,0.8)"
  const canCreate = name.trim() && cwd.trim() && !creating

  const handleCreate = async () => {
    if (!canCreate) return
    setCreating(true)
    try {
      await onCreateProject(name.trim(), cwd.trim())
      onClose()
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
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
        width: "min(400px, 90vw)",
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
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
          {t("newSession.newProject")}
        </div>

        {/* Name */}
        <div style={{ marginBottom: 12 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: textSecondary,
            textTransform: "uppercase", letterSpacing: 1, marginBottom: 6,
          }}>
            {t("newSession.projectName")}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="My Project"
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate() }}
            style={{
              width: "100%", padding: "8px 12px", borderRadius: 8,
              border: `1px solid ${glassBorder}`,
              background: inputBg, color: textPrimary,
              fontSize: 12, fontFamily: "inherit",
              outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {/* CWD */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: textSecondary,
            textTransform: "uppercase", letterSpacing: 1, marginBottom: 6,
          }}>
            {t("newSession.projectPath")}
          </div>
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="C:\\Users\\..."
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate() }}
            style={{
              width: "100%", padding: "8px 12px", borderRadius: 8,
              border: `1px solid ${glassBorder}`,
              background: inputBg, color: textPrimary,
              fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
              outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            style={{
              flex: 1, padding: "10px",
              borderRadius: 8, border: "none",
              background: canCreate ? "#37ACC0" : (dark ? "rgba(148,163,184,0.2)" : "rgba(148,163,184,0.15)"),
              color: canCreate ? "#fff" : textSecondary,
              fontSize: 12, fontWeight: 700,
              cursor: canCreate ? "pointer" : "default",
            }}
          >
            {creating ? t("newSession.creating") : t("newSession.create")}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: `1px solid ${glassBorder}`,
              background: "transparent",
              color: textSecondary, fontSize: 12, fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {t("newSession.cancel")}
          </button>
        </div>
      </div>
    </>
  )
}
