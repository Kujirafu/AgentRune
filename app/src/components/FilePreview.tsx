import { useState, useEffect, useCallback } from "react"
import { getApiBase } from "../lib/storage"
import { useLocale } from "../lib/i18n/index.js"
import { SpringOverlay } from "./SpringOverlay"

const SPRING = "cubic-bezier(0.16, 1, 0.3, 1)"

interface FilePreviewProps {
  open: boolean
  filePath: string | null
  onClose: () => void
}

export function FilePreview({ open, filePath, onClose }: FilePreviewProps) {
  const { t } = useLocale()
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [fileSize, setFileSize] = useState(0)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    if (!open || !filePath) return
    setLoading(true)
    setError("")
    setContent("")
    fetch(`${getApiBase()}/api/file?path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error)
        } else {
          setContent(data.content)
          setFileSize(data.size)
          setTruncated(data.truncated)
        }
      })
      .catch(() => setError("Failed to load file"))
      .finally(() => setLoading(false))
  }, [open, filePath])

  // Hardware back button via app:back
  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => { e.preventDefault(); onClose() }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [open, onClose])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  if (!filePath) return null

  const fileName = filePath.split(/[\\/]/).pop() || filePath
  const lines = content.split("\n")
  const sizeLabel = fileSize > 1024 ? `${(fileSize / 1024).toFixed(1)} KB` : `${fileSize} B`

  return (
    <SpringOverlay open={open}>
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      background: "var(--bg-gradient)",
      display: "flex", flexDirection: "column",
      color: "var(--text-primary)",
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0,
        background: "var(--glass-bg)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--glass-border)",
        paddingTop: "max(env(safe-area-inset-top), 12px)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 16px 10px",
        }}>
          <button
            onClick={handleClose}
            style={{
              width: 36, height: 36, borderRadius: 12,
              border: "1px solid var(--glass-border)",
              background: "var(--card-bg)",
              color: "var(--text-primary)",
              fontSize: 18, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {"\u2190"}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 15, fontWeight: 700,
              color: "var(--text-primary)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {fileName}
            </div>
          </div>
          <span style={{
            fontSize: 10, padding: "3px 8px", borderRadius: 8,
            background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
            color: "var(--text-secondary)", fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {sizeLabel}
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" as never }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)", opacity: 0.6 }}>
            Loading...
          </div>
        )}
        {error && (
          <div style={{ textAlign: "center", padding: 40, color: "#f87171" }}>
            {error}
          </div>
        )}
        {!loading && !error && (
          <div style={{
            margin: 12,
            background: "var(--card-bg)",
            borderRadius: 16,
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            border: "1px solid var(--glass-border)",
            overflow: "hidden",
          }}>
            <pre style={{
              margin: 0, padding: "12px 0", fontSize: 12,
              fontFamily: "'JetBrains Mono', monospace",
              color: "var(--text-secondary)",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              lineHeight: 1.7,
            }}>
              {lines.map((line, i) => (
                <div key={i} style={{ display: "flex", minHeight: "1.7em" }}>
                  <span style={{
                    display: "inline-block", width: 48, textAlign: "right",
                    paddingRight: 12, color: "var(--text-secondary)", opacity: 0.3,
                    flexShrink: 0, userSelect: "none",
                  }}>
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, paddingRight: 16 }}>{line || " "}</span>
                </div>
              ))}
            </pre>
            {truncated && (
              <div style={{
                padding: "12px 16px", textAlign: "center",
                borderTop: "1px solid var(--glass-border)",
                fontSize: 11, color: "#fbbf24", fontWeight: 600,
              }}>
                File truncated (showing first 500 lines)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </SpringOverlay>
  )
}
