import { useEffect, useRef, useCallback } from "react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebglAddon } from "@xterm/addon-webgl"
import "@xterm/xterm/css/xterm.css"
import type { AppSession } from "../../types"
import type { SessionDecisionDigest } from "../../lib/session-summary"
import { buildSessionAttachMessage } from "../../lib/session-attach"
import { getSettings, getAutoSaveKeysEnabled, getAutoSaveKeysPath } from "../../lib/storage"

export interface DesktopTerminalPanelProps {
  session: AppSession
  digest: SessionDecisionDigest | undefined
  send: (msg: Record<string, unknown>) => boolean
  on: (type: string, handler: (msg: Record<string, unknown>) => void) => (() => void)
  sessionToken: string
  theme: "light" | "dark"
  locale: string
  onKill?: () => void
  onCollapse?: () => void
  /** When true, hide header/summary — parent component provides them */
  embedded?: boolean
}

const statusColor: Record<string, string> = {
  blocked: "#ef4444", working: "#3b82f6", idle: "#94a3b8", done: "#22c55e",
}

export function DesktopTerminalPanel({
  session, digest, send, on, sessionToken, theme, locale, onKill, onCollapse, embedded,
}: DesktopTerminalPanelProps) {
  const dark = theme === "dark"
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const attachedRef = useRef(false)

  const status = digest?.status || "idle"
  const label = digest?.displayLabel || session.agentId
  const color = statusColor[status] || "#94a3b8"

  const textSecondary = dark ? "#94a3b8" : "#64748b"

  // Send session_input scoped to this session
  const sendSessionInput = useCallback((data: string) => {
    send({ type: "session_input", sessionId: session.id, data })
  }, [send, session.id])

  // Init xterm
  useEffect(() => {
    if (!termRef.current || xtermRef.current) return

    const xtermTheme = dark ? {
      background: "#0f172a",
      foreground: "#e2e8f0",
      cursor: "#60a5fa",
      selectionBackground: "#334155",
      black: "#1e293b",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#e2e8f0",
    } : {
      background: "#f8fafc",
      foreground: "#1e293b",
      cursor: "#37ACC0",
      selectionBackground: "#cbd5e1",
      black: "#e2e8f0",
      red: "#dc2626",
      green: "#16a34a",
      yellow: "#ca8a04",
      blue: "#2563eb",
      magenta: "#9333ea",
      cyan: "#0891b2",
      white: "#1e293b",
    }

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: xtermTheme,
      allowProposedApi: true,
      scrollback: 2000,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(termRef.current)

    // WebGL renderer
    let webglAddon: WebglAddon | null = null
    try {
      webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => { try { webglAddon?.dispose() } catch {} })
      term.loadAddon(webglAddon)
    } catch {
      webglAddon = null
    }
    ;(term as any)._webglAddon = webglAddon

    requestAnimationFrame(() => {
      fit.fit()
      send({ type: "resize", cols: term.cols, rows: term.rows })
    })

    term.onData((data) => {
      sendSessionInput(data)
    })

    xtermRef.current = term
    fitRef.current = fit

    const resizeObs = new ResizeObserver(() => {
      try {
        fit.fit()
        send({ type: "resize", cols: term.cols, rows: term.rows })
      } catch {}
    })
    resizeObs.observe(termRef.current)

    return () => {
      resizeObs.disconnect()
      try { (term as any)._webglAddon?.dispose() } catch {}
      try { term.dispose() } catch {}
      xtermRef.current = null
      fitRef.current = null
    }
  }, [dark]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle WS messages for this session
  useEffect(() => {
    const unsubs: (() => void)[] = []

    unsubs.push(on("output", (msg) => {
      if (msg.sessionId !== session.id) return
      const data = msg.data as string
      xtermRef.current?.write(data)
    }))

    unsubs.push(on("scrollback", (msg) => {
      if (msg.sessionId !== session.id) return
      const scrollback = msg.data as string
      xtermRef.current?.clear()
      xtermRef.current?.write(scrollback, () => {
        xtermRef.current?.scrollToBottom()
      })
      setTimeout(() => xtermRef.current?.scrollToBottom(), 300)
    }))

    unsubs.push(on("attached", (msg) => {
      if (msg.sessionId !== session.id) return
      xtermRef.current?.focus()
      setTimeout(() => xtermRef.current?.scrollToBottom(), 100)
      setTimeout(() => xtermRef.current?.scrollToBottom(), 500)
    }))

    unsubs.push(on("exit", (msg) => {
      if (msg.sessionId !== session.id) return
      xtermRef.current?.write("\r\n\x1b[33m[Session ended]\x1b[0m\r\n")
    }))

    unsubs.push(on("error", (msg) => {
      if (msg.sessionId !== session.id) return
      xtermRef.current?.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`)
    }))

    return () => { for (const u of unsubs) u() }
  }, [on, session.id])

  // Attach to session on mount + re-attach on WS reconnect
  useEffect(() => {
    if (attachedRef.current) return
    attachedRef.current = true

    const attach = () => send(buildSessionAttachMessage({
      projectId: session.projectId,
      agentId: session.agentId,
      sessionId: session.id,
      autoSaveKeys: getAutoSaveKeysEnabled(),
      autoSaveKeysPath: getAutoSaveKeysPath(),
      shouldResumeAgent: session.status === "recoverable",
      settings: getSettings(session.projectId),
      locale,
    }))
    attach()

    const unsub = on("__ws_open__", () => { attach() })
    return () => { unsub(); attachedRef.current = false }
  }, [session.id, session.projectId, session.agentId, send, on, locale])

  const summary = digest?.summary || ""
  const nextAction = digest?.nextAction || ""
  const statusLabel: Record<string, string> = {
    blocked: "Blocked", working: "Working", idle: "Idle", done: "Done",
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {!embedded && (
        <>
          {/* Header — status + label + actions */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 12px",
            borderBottom: `1px solid ${dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.12)"}`,
            flexShrink: 0,
          }}>
            <span style={{
              fontSize: 11, fontWeight: 600,
              padding: "2px 8px", borderRadius: 4,
              background: `${color}18`, color,
              flexShrink: 0,
            }}>
              {statusLabel[status] || status}
            </span>
            <span style={{
              fontSize: 13, fontWeight: 600,
              color: dark ? "#e2e8f0" : "#1e293b",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              flex: 1,
            }}>
              {label}
            </span>
            {onKill && (
              <button
                onClick={(e) => { e.stopPropagation(); onKill() }}
                title="Kill session"
                style={{
                  width: 24, height: 24, borderRadius: 5, border: "none",
                  background: "transparent", cursor: "pointer", color: textSecondary,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#ef4444" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = textSecondary }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
            {onCollapse && (
              <button
                onClick={(e) => { e.stopPropagation(); onCollapse() }}
                title="Collapse"
                style={{
                  width: 24, height: 24, borderRadius: 5, border: "none",
                  background: "transparent", cursor: "pointer", color: textSecondary,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
            )}
          </div>

          {/* Summary bar */}
          {(summary || nextAction) && (
            <div style={{
              padding: "6px 12px",
              borderBottom: `1px solid ${dark ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.08)"}`,
              background: dark ? "rgba(15,23,42,0.4)" : "rgba(248,250,252,0.6)",
              flexShrink: 0,
            }}>
              {summary && (
                <div style={{
                  fontSize: 12, color: dark ? "#cbd5e1" : "#475569",
                  lineHeight: 1.5,
                  overflow: "hidden", textOverflow: "ellipsis",
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                } as React.CSSProperties}>
                  {summary}
                </div>
              )}
              {nextAction && (
                <div style={{
                  fontSize: 11, color: dark ? "#94a3b8" : "#64748b",
                  marginTop: summary ? 3 : 0,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  Next: {nextAction}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Terminal container */}
      <div
        ref={termRef}
        style={{
          flex: 1,
          padding: 2,
          overflow: "hidden",
          background: dark ? "#0f172a" : "#f8fafc",
          borderRadius: "0 0 8px 8px",
        }}
      />
    </div>
  )
}
