import { useEffect, useMemo, useState } from "react"
import type { PendingReauthRequest } from "../data/automation-types"

interface ReauthSheetProps {
  request: PendingReauthRequest
  onRespond: (action: "approve" | "deny", opts?: { noExpiry?: boolean; reviewNote?: string }) => void
  t: (key: string, params?: Record<string, string>) => string
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
}

function IconShield() {
  return (
    <svg {...iconProps}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  )
}

function IconClock() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function IconKey() {
  return (
    <svg {...iconProps}>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M13 15.5h8" />
      <path d="M17 12.5v6" />
      <path d="M20 12.5v3" />
    </svg>
  )
}

function formatReviewEta(ms: number | undefined, t: ReauthSheetProps["t"]): string | null {
  if (!ms || ms <= 0) return null
  if (ms < 60_000) return t("reauth.reviewEtaSeconds", { n: String(Math.max(1, Math.round(ms / 1000))) })
  return t("reauth.reviewEtaMinutes", { n: String(Math.max(1, Math.ceil(ms / 60_000))) })
}

export default function ReauthSheet({ request, onRespond, t }: ReauthSheetProps) {
  const desktop = typeof window !== "undefined" && (window.innerWidth >= 900 || !!(window as any).electronAPI)
  const [reviewNote, setReviewNote] = useState("")
  const [sending, setSending] = useState(false)
  const reviewEta = useMemo(() => formatReviewEta(request.estimatedReviewMs, t), [request.estimatedReviewMs, t])

  useEffect(() => {
    const blockBack = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }

    document.addEventListener("app:back", blockBack, true)
    return () => document.removeEventListener("app:back", blockBack, true)
  }, [])

  const respond = (action: "approve" | "deny", opts?: { noExpiry?: boolean }) => {
    setSending(true)
    onRespond(action, {
      noExpiry: opts?.noExpiry === true,
      reviewNote: reviewNote.trim() || undefined,
    })
  }

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 109, background: "rgba(0,0,0,0.42)" }} />
      <div
        style={{
          position: "fixed",
          zIndex: 110,
          background: "var(--glass-bg, rgba(255,255,255,0.96))",
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          ...(desktop ? {
            top: "50%", left: "50%", right: "auto", bottom: "auto",
            transform: "translate(-50%, -50%)",
            width: "min(560px, 90vw)",
            maxHeight: "80vh",
            borderRadius: 16,
            boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
          } : {
            bottom: 0, left: 0, right: 0,
            maxHeight: "82dvh",
            borderRadius: "22px 22px 0 0",
            boxShadow: "0 -10px 40px rgba(0,0,0,0.22)",
          }),
        }}
      >
        {!desktop && (
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(0,0,0,0.15)" }} />
        </div>
        )}

        <div style={{ padding: "8px 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>
              {t("reauth.title")}
            </div>
            <div style={{ marginTop: 2, fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {request.automationName}
            </div>
          </div>
          <div style={{
            padding: "4px 10px",
            borderRadius: 999,
            background: "rgba(251,113,133,0.12)",
            color: "#e11d48",
            fontSize: 11,
            fontWeight: 700,
          }}>
            {t("reauth.blocked")}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
          <div style={{
            padding: "12px 13px",
            borderRadius: 14,
            background: "rgba(251,113,133,0.08)",
            border: "1px solid rgba(251,113,133,0.18)",
            color: "var(--text-primary)",
            lineHeight: 1.55,
            fontSize: 13,
            marginBottom: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "#e11d48" }}>
              <IconShield />
              {t("reauth.summary")}
            </div>
            <div style={{ marginTop: 8, color: "var(--text-secondary)" }}>
              {request.violationDescription}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
            <div style={{
              borderRadius: 12,
              border: "1px solid var(--glass-border)",
              background: "var(--glass-bg)",
              padding: "11px 12px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)", fontSize: 11, fontWeight: 700 }}>
                <IconKey />
                {t("reauth.permissionLabel")}
              </div>
              <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600, color: "var(--text-primary)", wordBreak: "break-word" }}>
                {request.permissionKey}
              </div>
            </div>

            {reviewEta ? (
              <div style={{
                borderRadius: 12,
                border: "1px solid rgba(55,172,192,0.18)",
                background: "rgba(55,172,192,0.08)",
                padding: "11px 12px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#37ACC0", fontSize: 11, fontWeight: 700 }}>
                  <IconClock />
                  {t("reauth.reviewHint")}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>
                  {t("reauth.reviewEta", { time: reviewEta })}
                </div>
              </div>
            ) : null}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
              {t("reauth.reviewNoteLabel")}
            </div>
            <textarea
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              rows={3}
              autoFocus
              placeholder={t("reauth.reviewNotePlaceholder")}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid var(--glass-border)",
                background: "var(--glass-bg)",
                color: "var(--text-primary)",
                fontSize: 13,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
                lineHeight: 1.5,
                resize: "vertical",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={() => respond("approve")}
              disabled={sending}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 12,
                border: "none",
                background: "#37ACC0",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                opacity: sending ? 0.5 : 1,
              }}
            >
              {t("reauth.approveOnce")}
            </button>

            <button
              onClick={() => respond("approve", { noExpiry: true })}
              disabled={sending}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid rgba(55,172,192,0.28)",
                background: "rgba(55,172,192,0.06)",
                color: "#37ACC0",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                opacity: sending ? 0.5 : 1,
              }}
            >
              {t("reauth.approveSession")}
            </button>

            <button
              onClick={() => respond("deny")}
              disabled={sending}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid rgba(239,68,68,0.22)",
                background: "rgba(239,68,68,0.08)",
                color: "#dc2626",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                opacity: sending ? 0.5 : 1,
              }}
            >
              {t("reauth.deny")}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
