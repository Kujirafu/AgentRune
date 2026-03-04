import { useState, useEffect, useRef } from "react"
import { getApiBase } from "../lib/storage"
import { useLocale } from "../lib/i18n/index.js"

interface FileEntry {
  name: string
  path: string
  isDir: boolean
}

interface FileBrowserProps {
  open: boolean
  onClose: () => void
  onSelectPath: (path: string) => void
  initialPath?: string
}

export function FileBrowser({ open, onClose, onSelectPath, initialPath }: FileBrowserProps) {
  const { t } = useLocale()
  const [currentPath, setCurrentPath] = useState(initialPath || "")
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [parentPath, setParentPath] = useState("")
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [copied, setCopied] = useState("")
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")

  // Keep refs so the back-button handler always sees the latest values
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (open) {
      setLoadError(false)
      loadDir(currentPath || undefined)
    }
  }, [open])

  // Intercept Android hardware back button when overlay is visible
  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => {
      e.preventDefault() // cancels the event so App.tsx won't minimizeApp()
      onCloseRef.current()
    }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [open])

  const loadDir = async (path?: string) => {
    const base = getApiBase()
    if (!base) {
      setLoadError(true)
      setLoading(false)
      return
    }
    setLoadError(false)
    setLoading(true)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const url = path
        ? `${base}/api/browse?path=${encodeURIComponent(path)}`
        : `${base}/api/browse`
      const res = await fetch(url, { signal: controller.signal })
      if (res.ok) {
        const data = await res.json()
        setCurrentPath(data.path)
        setParentPath(data.parent)
        setEntries(data.entries)
      } else {
        setLoadError(true)
      }
    } catch {
      setLoadError(true)
    }
    clearTimeout(timeout)
    setLoading(false)
  }

  const handleSelect = (path: string) => {
    onSelectPath(path)
  }

  const handleCopy = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(path)
      setCopied(path)
      setTimeout(() => setCopied(""), 1500)
    } catch {
      onSelectPath(path)
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    const base = getApiBase()
    const folderPath = currentPath + "/" + newFolderName.trim()
    try {
      const res = await fetch(`${base}/api/mkdir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderPath }),
      })
      if (res.ok) {
        setNewFolderName("")
        setShowNewFolder(false)
        await loadDir(currentPath)
      }
    } catch {}
  }

  if (!open) return null

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 300,
      display: "flex",
      flexDirection: "column",
      background: "var(--bg-gradient)",
      color: "var(--text-primary)",
      animation: "fadeSlideUp 0.3s ease-out",
    }}>
      {/* Header — same as LaunchPad header area */}
      <div style={{
        padding: "48px 20px 16px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}>
        {/* Back button — top left */}
        <div style={{ width: "100%", maxWidth: 400, display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <button onClick={onClose} style={glassBtnStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.3 }}>{t("file.browseFiles")}</div>
          </div>
          <button
            onClick={() => { setShowNewFolder(!showNewFolder); setNewFolderName("") }}
            style={{
              ...glassBtnStyle,
              width: "auto",
              padding: "0 12px",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: showNewFolder ? "#4ade80" : "var(--text-secondary)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t("file.newFolder")}
          </button>
          <button
            onClick={(e) => handleCopy(currentPath, e)}
            style={{
              ...glassBtnStyle,
              width: "auto",
              padding: "0 16px",
              fontSize: 12,
              fontWeight: 600,
              color: copied === currentPath ? "#4ade80" : "var(--accent-primary)",
            }}
          >
            {copied === currentPath ? t("file.copied") : t("file.copyPath")}
          </button>
        </div>

        {/* Current path card — same style as LaunchPad logo card */}
        <div style={{
          width: "100%",
          maxWidth: 400,
          padding: "14px 20px",
          borderRadius: 16,
          background: "var(--glass-bg)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid var(--glass-border)",
          boxShadow: "var(--glass-shadow)",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12,
          color: "var(--text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {currentPath}
        </div>

        {/* New folder inline form */}
        {showNewFolder && (
          <div style={{
            width: "100%",
            maxWidth: 400,
            marginTop: 12,
            display: "flex",
            gap: 8,
          }}>
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder() }}
              placeholder={t("file.folderName")}
              autoFocus
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid var(--glass-border)",
                background: "var(--icon-bg)",
                color: "var(--text-primary)",
                fontSize: 14,
                fontFamily: "'JetBrains Mono', monospace",
                outline: "none",
              }}
            />
            <button
              onClick={handleCreateFolder}
              style={{
                padding: "10px 18px",
                borderRadius: 12,
                border: "none",
                background: "var(--accent-primary)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {t("file.create")}
            </button>
          </div>
        )}
      </div>

      {/* Section label + parent nav */}
      <div style={{ flexShrink: 0, padding: "0 20px", width: "100%", maxWidth: 440, margin: "0 auto" }}>
        <div style={sectionLabelStyle}>
          {t("file.contents")}
        </div>
        {parentPath && parentPath !== currentPath && (
          <button
            onClick={() => loadDir(parentPath)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              width: "100%",
              padding: "12px 20px",
              marginBottom: 8,
              borderRadius: 20,
              border: "1px dashed var(--text-secondary)",
              background: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              opacity: 0.6,
              transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 11 12 6 7 11" /><line x1="12" y1="18" x2="12" y2="6" />
            </svg>
            ..
          </button>
        )}
      </div>

      {/* File list — same card style as LaunchPad agent cards */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "0 20px 16px",
        width: "100%",
        maxWidth: 440,
        margin: "0 auto",
        WebkitOverflowScrolling: "touch" as never,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)", opacity: 0.5 }}>
            {t("file.loading")}
          </div>
        ) : loadError ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {t("file.loadError")}
            </div>
            <button
              onClick={() => loadDir(currentPath || undefined)}
              style={{
                marginTop: 16,
                padding: "10px 20px",
                borderRadius: 12,
                border: "1px solid var(--glass-border)",
                background: "var(--glass-bg)",
                color: "var(--accent-primary)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("file.retry")}
            </button>
          </div>
        ) : (
          <>
            {entries.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: "var(--text-secondary)", opacity: 0.5 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{t("file.emptyFolder")}</div>
              </div>
            )}

            {entries.map((entry) => (
              <button
                key={entry.path}
                onClick={() => {
                  if (entry.isDir) {
                    loadDir(entry.path)
                  } else {
                    handleSelect(entry.path)
                  }
                }}
                style={{
                  padding: "16px 20px",
                  borderRadius: 20,
                  border: "1px solid var(--glass-border)",
                  background: "var(--card-bg)",
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                  boxShadow: "var(--glass-shadow)",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                {/* Icon — 48x48 borderRadius 14, same as LaunchPad */}
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  background: "var(--icon-bg)",
                  color: entry.isDir ? "var(--text-primary)" : "var(--text-secondary)",
                  border: "1px solid var(--glass-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                }}>
                  {entry.isDir ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  )}
                </div>

                {/* Name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: 600,
                    fontSize: 16,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {entry.name}
                  </div>
                  {!entry.isDir && (
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500, marginTop: 2 }}>
                      {t("file.file")}
                    </div>
                  )}
                </div>

                {/* Action */}
                {entry.isDir ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, flexShrink: 0 }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                ) : (
                  <button
                    onClick={(e) => handleCopy(entry.path, e)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 12,
                      border: copied === entry.path ? "1px solid rgba(74,222,128,0.3)" : "1px solid var(--glass-border)",
                      background: copied === entry.path ? "rgba(74,222,128,0.1)" : "var(--glass-bg)",
                      backdropFilter: "blur(8px)",
                      WebkitBackdropFilter: "blur(8px)",
                      color: copied === entry.path ? "#4ade80" : "var(--text-secondary)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      flexShrink: 0,
                      transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    {copied === entry.path ? t("file.copied") : t("file.copy")}
                  </button>
                )}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Footer: Use this path */}
      <div style={{
        padding: "16px 20px",
        paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        flexShrink: 0,
        display: "flex",
        justifyContent: "center",
      }}>
        <button
          onClick={() => {
            onSelectPath(currentPath)
            onClose()
          }}
          style={{
            width: "100%",
            maxWidth: 400,
            padding: "14px",
            borderRadius: 14,
            border: "none",
            background: "var(--accent-primary)",
            color: "#fff",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {t("file.usePath")}
        </button>
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

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  marginBottom: 12,
}
