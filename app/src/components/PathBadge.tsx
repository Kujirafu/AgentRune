// PathBadge — shows only the last folder/file name in a teal glassmorphism pill
// with a folder or file SVG icon (no emoji)

import React from "react"

interface PathBadgeProps {
  path: string
  style?: React.CSSProperties
  onClick?: () => void
}

/** Extract last segment from a path */
function lastSegment(p: string): string {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/** Guess if path is a file (has extension) or directory */
function isFile(p: string): boolean {
  const name = lastSegment(p)
  return name.includes(".") && !name.startsWith(".")
}

const iconStyle: React.CSSProperties = { flexShrink: 0 }

const FolderIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
)

const FileIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
)

const baseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 10px",
  borderRadius: 8,
  background: "rgba(55, 172, 192, 0.10)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid rgba(55, 172, 192, 0.20)",
  color: "#37ACC0",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "'JetBrains Mono', monospace",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  transition: "all 0.2s",
}

export const PathBadge = React.memo(function PathBadge({ path, style, onClick }: PathBadgeProps) {
  const name = lastSegment(path)
  const file = isFile(path)

  return (
    <span
      onClick={onClick}
      style={{
        ...baseStyle,
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
    >
      {file ? <FileIcon /> : <FolderIcon />}
      {name}
    </span>
  )
})
