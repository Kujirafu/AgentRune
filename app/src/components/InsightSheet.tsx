// InsightSheet — glassmorphism popup showing rendered insight report with submit button
import { useState, useEffect } from "react"
import ReactMarkdown from "react-markdown"

interface InsightSheetProps {
  open: boolean
  onClose: () => void
  apiBase: string
  projectId?: string
  sessionId?: string
}

export function InsightSheet({ open, onClose, apiBase, projectId, sessionId }: InsightSheetProps) {
  const [markdown, setMarkdown] = useState("")
  const [title, setTitle] = useState("")
  const [sourceText, setSourceText] = useState("")
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{ status?: string; error?: string } | null>(null)
  const [empty, setEmpty] = useState(false)

  useEffect(() => {
    if (!open) return
    setMarkdown("")
    setTitle("")
    setSourceText("")
    setSubmitResult(null)
    setEmpty(false)
    generateInsight()
  }, [open])

  const generateInsight = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/api/insight/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, sessionId }),
      })
      const data = await res.json()
      if (data.empty) {
        setEmpty(true)
      } else {
        setMarkdown(data.markdown || "")
        setTitle(data.title || "Session Insight")
        setSourceText(data.sourceText || data.markdown || "")
      }
    } catch (err) {
      setMarkdown("Failed to generate insight report.")
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setSubmitResult(null)
    try {
      const res = await fetch(`${apiBase}/api/insight/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText, title }),
      })
      const data = await res.json()
      setSubmitResult(data)
    } catch (err) {
      setSubmitResult({ error: "Network error" })
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 100,
      display: "flex",
      flexDirection: "column",
      background: "var(--bg-gradient)",
      color: "var(--text-primary)",
      animation: "fadeSlideUp 0.3s ease-out",
    }}>
      {/* Header */}
      <div style={{
        padding: "48px 20px 16px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}>
        <div style={{ width: "100%", maxWidth: 500, display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onClose} style={glassBtnStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.3 }}>Insight Report</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
              Review before submitting to AgentLore
            </div>
          </div>
          {/* Submit button */}
          {!empty && !loading && !submitResult?.status && (
            <button
              onClick={handleSubmit}
              disabled={submitting || sourceText.length < 200}
              style={{
                padding: "8px 16px",
                borderRadius: 12,
                border: "1px solid rgba(55, 172, 192, 0.3)",
                background: submitting
                  ? "rgba(55, 172, 192, 0.05)"
                  : "rgba(55, 172, 192, 0.12)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                color: sourceText.length < 200 ? "var(--text-secondary)" : "#37ACC0",
                fontSize: 12,
                fontWeight: 600,
                cursor: submitting || sourceText.length < 200 ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.2s",
                flexShrink: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              {submitting ? "Submitting..." : "Submit"}
            </button>
          )}
          {/* Success/error badge */}
          {submitResult && (
            <div style={{
              padding: "6px 14px",
              borderRadius: 10,
              background: submitResult.error
                ? "rgba(239, 68, 68, 0.12)"
                : "rgba(55, 172, 192, 0.12)",
              border: `1px solid ${submitResult.error ? "rgba(239, 68, 68, 0.3)" : "rgba(55, 172, 192, 0.3)"}`,
              color: submitResult.error ? "#ef4444" : "#37ACC0",
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
            }}>
              {submitResult.error ? submitResult.error : "Submitted"}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflow: "auto",
        WebkitOverflowScrolling: "touch",
        padding: "0 20px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}>
        <div style={{
          width: "100%",
          maxWidth: 500,
          borderRadius: 16,
          border: "1px solid rgba(55, 172, 192, 0.15)",
          background: "rgba(55, 172, 192, 0.04)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          padding: "20px 24px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.1)",
        }}>
          {loading && (
            <div style={{
              textAlign: "center",
              color: "var(--text-secondary)",
              fontSize: 13,
              padding: "40px 0",
            }}>
              Generating insight report...
            </div>
          )}
          {empty && !loading && (
            <div style={{
              textAlign: "center",
              color: "var(--text-secondary)",
              fontSize: 13,
              padding: "40px 0",
            }}>
              No session events found. Start a session first.
            </div>
          )}
          {!loading && !empty && markdown && (
            <div className="insight-markdown" style={{
              fontSize: 13,
              lineHeight: 1.7,
              color: "var(--text-primary)",
            }}>
              <ReactMarkdown>{markdown}</ReactMarkdown>
            </div>
          )}
          {!loading && !empty && sourceText.length < 200 && sourceText.length > 0 && (
            <div style={{
              marginTop: 12,
              padding: "8px 12px",
              borderRadius: 8,
              background: "rgba(251, 129, 132, 0.08)",
              border: "1px solid rgba(251, 129, 132, 0.2)",
              color: "#FB8184",
              fontSize: 11,
              fontWeight: 500,
            }}>
              Content too short ({sourceText.length}/200 chars minimum). Add more session activity.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const glassBtnStyle: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 12,
  border: "1px solid var(--glass-border)",
  background: "var(--glass-bg)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  boxShadow: "var(--glass-shadow)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
}
