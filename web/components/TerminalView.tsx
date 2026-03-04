import { useState, useEffect, useRef, useCallback } from "react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import type { Project, ProjectSettings, SmartAction } from "../lib/types"
import { AGENTS } from "../lib/types"
import { getSettings, saveSettings, addRecentCommand, getRecentCommands, getApiBase } from "../lib/storage"
import { detectPromptActions, isIdle, isMobile } from "../lib/detect"
import { commandSent } from "../lib/command-sent"
import { AnsiParser } from "../lib/ansi-parser"
import { SettingsSheet } from "./SettingsSheet"
import { SmartSuggestions } from "./SmartSuggestions"
import { QuickActions } from "./QuickActions"
import { InputBar } from "./InputBar"
import { DetailPanel } from "./DetailPanel"
import { FileBrowser } from "./FileBrowser"
import { useLocale } from "../lib/i18n/index.js"

interface TerminalViewProps {
  project: Project
  agentId: string
  sessionId?: string
  sessionToken: string
  send: (msg: Record<string, unknown>) => boolean
  on: (type: string, handler: (msg: Record<string, unknown>) => void) => (() => void)
  onBack: () => void
}

interface IdleSuggestion {
  label: string
  description?: string
  command: string
  icon?: string
}

export function TerminalView({ project, agentId, sessionId, send, on, onBack }: TerminalViewProps) {
  const { t } = useLocale()
  const [settings, setSettings] = useState<ProjectSettings>(() => getSettings(project.id))
  const [showSettings, setShowSettings] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [showBrowser, setShowBrowser] = useState(false)
  const [smartActions, setSmartActions] = useState<SmartAction[]>([])
  const [idleSuggestions, setIdleSuggestions] = useState<IdleSuggestion[]>([])
  const [sugMode, setSugMode] = useState<"prompt" | "idle" | "hidden">("hidden")
  const [viewH, setViewH] = useState(window.innerHeight)
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const promptReadyRef = useRef(false)
  const parserRef = useRef(new AnsiParser())

  // Force re-render for parser blocks
  const [, setParserTick] = useState(0)

  const agent = AGENTS.find((a) => a.id === agentId)

  // Track viewport height (keyboard-aware via visualViewport)
  useEffect(() => {
    const update = () => setViewH(window.visualViewport?.height ?? window.innerHeight)
    window.visualViewport?.addEventListener("resize", update)
    window.addEventListener("resize", update)
    return () => {
      window.visualViewport?.removeEventListener("resize", update)
      window.removeEventListener("resize", update)
    }
  }, [])

  // Swipe-to-open detail panel
  const touchStartRef = useRef({ x: 0, y: 0 })
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartRef.current.y)
    // Swipe left to open detail panel (at least 80px, mostly horizontal)
    if (dx < -80 && dy < 50) {
      setShowDetail(true)
    }
  }

  const handleSettingsChange = useCallback((newSettings: ProjectSettings) => {
    setSettings(newSettings)
    saveSettings(project.id, newSettings)
  }, [project.id])

  const sendInput = useCallback((data: string) => {
    send({ type: "input", data })
    setTimeout(() => {
      if (xtermRef.current) {
        const actions = detectPromptActions(xtermRef.current)
        if (actions.length > 0) {
          setSmartActions(actions)
          setSugMode("prompt")
        } else {
          setSmartActions([])
        }
      }
    }, 200)
  }, [send])

  const handleSendCommand = useCallback((text: string) => {
    if (text === "\x03") {
      sendInput(text)
      return
    }
    if (!text.trim()) return  // Don't send empty commands
    // Send text first, then Enter separately after a delay.
    // TUI apps like Claude Code process input as a stream — if text+\r arrives
    // as one chunk, \r gets treated as a newline in the input buffer instead of
    // triggering submission. Splitting them ensures \r is handled as Enter.
    sendInput(text)
    setTimeout(() => sendInput("\r"), 30)
    addRecentCommand(project.id, text)
  }, [sendInput, project.id])

  // Image paste handler
  const handleImagePaste = useCallback(async (base64: string, filename: string) => {
    try {
      const res = await fetch(`${getApiBase()}/api/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, data: base64, filename }),
      })
      if (res.ok) {
        const data = await res.json()
        // Paste the file path into terminal
        sendInput(data.path)
      }
    } catch {}
  }, [project.id, sendInput])

  const buildIdleSuggestions = useCallback(async () => {
    const suggestions: IdleSuggestion[] = []

    if (agentId === "terminal") {
      suggestions.push(
        { label: "claude", description: "Start Claude Code", command: "claude", icon: ">" },
        { label: "codex", description: "Start Codex CLI", command: "codex", icon: ">" },
      )
    }

    try {
      const res = await fetch(`${getApiBase()}/api/projects/${project.id}/scripts`)
      if (res.ok) {
        const data = await res.json()
        const scripts = data.scripts || {}
        for (const key of ["dev", "start", "build", "test", "lint"]) {
          if (scripts[key]) {
            suggestions.push({
              label: `npm run ${key}`,
              description: scripts[key],
              command: `npm run ${key}`,
              icon: "$",
            })
          }
        }
      }
    } catch {}

    const recent = getRecentCommands(project.id)
    for (const cmd of recent.slice(0, 3)) {
      if (!suggestions.find((s) => s.command === cmd)) {
        suggestions.push({ label: cmd, command: cmd, icon: "~" })
      }
    }

    for (const gc of [
      { label: "git status", command: "git status", icon: "+" },
      { label: "git pull", command: "git pull", icon: "v" },
      { label: "git push", command: "git push", icon: "^" },
    ]) {
      if (!suggestions.find((s) => s.command === gc.command)) {
        suggestions.push(gc)
      }
    }

    setIdleSuggestions(suggestions)
  }, [project.id, agentId])

  // Init xterm
  useEffect(() => {
    if (!termRef.current || xtermRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      fontSize: isMobile ? 12 : 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      disableStdin: isMobile,  // On mobile, InputBar handles all input
      theme: {
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
      },
      allowProposedApi: true,
      scrollback: 5000,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(termRef.current)

    requestAnimationFrame(() => {
      fit.fit()
      send({ type: "resize", cols: term.cols, rows: term.rows })
    })

    term.onData((data) => {
      send({ type: "input", data })
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
      term.dispose()
      xtermRef.current = null
    }
  }, [send])

  // Handle WS messages
  useEffect(() => {
    const unsubs: (() => void)[] = []

    unsubs.push(on("output", (msg) => {
      const data = msg.data as string
      xtermRef.current?.write(data)

      // Feed ANSI parser
      parserRef.current.feed(data)
      setParserTick((t) => t + 1)

      // Detect shell prompt
      if (/[$%>]\s*$/.test(data)) {
        promptReadyRef.current = true
      }

      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)

      setTimeout(() => {
        if (!xtermRef.current) return
        const actions = detectPromptActions(xtermRef.current)
        if (actions.length > 0) {
          setSmartActions(actions)
          setSugMode("prompt")
        } else {
          setSmartActions([])
          idleTimerRef.current = setTimeout(() => {
            if (xtermRef.current && isIdle(xtermRef.current)) {
              buildIdleSuggestions()
              setSugMode("idle")
            } else {
              setSugMode("hidden")
            }
          }, 500)
        }
      }, 100)
    }))

    unsubs.push(on("scrollback", (msg) => {
      xtermRef.current?.write(msg.data as string)
    }))

    unsubs.push(on("attached", (msg) => {
      if (!isMobile) xtermRef.current?.focus()

      // Don't send auto-command if session already existed on server (resumed)
      if (msg.resumed) return

      if (agent && sessionId && !commandSent.has(sessionId)) {
        const cmd = agent.command(settings)
        if (cmd) {
          commandSent.mark(sessionId)
          const tryToSend = (attempts: number) => {
            if (promptReadyRef.current || attempts >= 10) {
              setTimeout(() => {
                send({ type: "input", data: cmd })
                setTimeout(() => send({ type: "input", data: "\r" }), 30)
              }, 100)
            } else {
              setTimeout(() => tryToSend(attempts + 1), 200)
            }
          }
          setTimeout(() => tryToSend(0), 500)
        }
      }

      setTimeout(() => {
        if (xtermRef.current && isIdle(xtermRef.current)) {
          buildIdleSuggestions()
          setSugMode("idle")
        }
      }, 1500)
    }))

    unsubs.push(on("exit", () => {
      xtermRef.current?.write(`\r\n\x1b[33m[${t("terminal.sessionEnded")}]\x1b[0m\r\n`)
      setSugMode("hidden")
    }))

    unsubs.push(on("error", (msg) => {
      xtermRef.current?.write(`\r\n\x1b[31m[${t("terminal.error")}: ${msg.message}]\x1b[0m\r\n`)
    }))

    return () => { for (const u of unsubs) u() }
  }, [on, send, agent, settings, buildIdleSuggestions])

  // Android back button — close overlays first
  useEffect(() => {
    const handler = (e: Event) => {
      if (showBrowser) { setShowBrowser(false); e.preventDefault(); return }
      if (showSettings) { setShowSettings(false); e.preventDefault(); return }
      if (showDetail) { setShowDetail(false); e.preventDefault(); return }
    }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [showBrowser, showSettings, showDetail])

  // Attach on mount + re-attach on WS reconnect
  useEffect(() => {
    promptReadyRef.current = false
    parserRef.current.clear()
    const didAttach = send({ type: "attach", projectId: project.id, agentId, sessionId })

    // When WS reconnects, server loses session mapping — must re-attach
    // Skip if we already attached above (first connect)
    let firstOpen = !didAttach
    const unsub = on("__ws_open__", () => {
      if (firstOpen) {
        send({ type: "attach", projectId: project.id, agentId, sessionId })
      }
      firstOpen = true
    })
    return unsub
  }, [project.id, agentId, sessionId, send, on])

  const thinkingBlocks = parserRef.current.getThinkingBlocks()
  const codeBlocks = parserRef.current.getCodeBlocks()
  const toolBlocks = parserRef.current.getToolBlocks()
  const hasDetails = thinkingBlocks.length + codeBlocks.length + toolBlocks.length > 0

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        height: viewH,
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        background: "#0f172a",
        zIndex: 1,
        color: "#e2e8f0",
        // Force dark CSS vars so QuickActions/InputBar are visible on dark bg
        "--text-primary": "#f8fafc",
        "--text-secondary": "#94a3b8",
        "--glass-bg": "rgba(30, 41, 59, 0.3)",
        "--glass-border": "rgba(255, 255, 255, 0.08)",
        "--glass-shadow": "0 4px 24px rgba(0, 0, 0, 0.3)",
        "--accent-primary": "#38bdf8",
        "--icon-bg": "rgba(255, 255, 255, 0.03)",
      } as React.CSSProperties}
    >
      {/* Top bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        paddingTop: "calc(10px + env(safe-area-inset-top, 0px))",
        background: "rgba(30,41,59,0.75)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        flexShrink: 0,
        userSelect: "none",
      }}>
        <button
          onClick={onBack}
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(12px)",
            color: "rgba(255,255,255,0.6)",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          {"←"}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontWeight: 600,
            fontSize: 14,
            color: "#fff",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {project.name}
            <span style={{ color: "rgba(255,255,255,0.25)", margin: "0 6px", fontWeight: 300 }}>{"·"}</span>
            <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 400 }}>
              {agent?.name || t("agent.terminal.name")}
            </span>
          </div>
        </div>

        {settings.bypass && (
          <span style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            background: "rgba(251,191,36,0.15)",
            border: "1px solid rgba(251,191,36,0.2)",
            color: "#fbbf24",
            fontWeight: 600,
          }}>
            {t("mc.bypass")}
          </span>
        )}

        {/* Detail panel button (shows when there's content) */}
        {hasDetails && (
          <button
            onClick={() => setShowDetail(true)}
            style={{
              padding: "5px 10px",
              borderRadius: 8,
              border: "1px solid rgba(96,165,250,0.25)",
              background: "rgba(96,165,250,0.1)",
              color: "#60a5fa",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {"..."} {thinkingBlocks.length + codeBlocks.length}
          </button>
        )}

        <button
          onClick={() => setShowSettings(true)}
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(12px)",
            color: "rgba(255,255,255,0.6)",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
        </button>
      </div>

      {/* Terminal output */}
      <div
        ref={termRef}
        style={{ flex: 1, padding: 4, overflow: "hidden" }}
      />

      {/* Smart suggestions */}
      <SmartSuggestions
        actions={smartActions}
        idleSuggestions={idleSuggestions}
        mode={sugMode}
        onAction={sendInput}
      />

      {/* Quick actions */}
      <QuickActions onAction={sendInput} />

      {/* Input bar with image paste, voice, browse */}
      <InputBar
        onSend={handleSendCommand}
        onImagePaste={handleImagePaste}
        onBrowse={() => setShowBrowser(true)}
        autoFocus={isMobile}
        slashCommands={agent?.slashCommands}
      />

      {/* Overlays */}
      <SettingsSheet
        open={showSettings}
        settings={settings}
        agentId={agentId}
        onChange={handleSettingsChange}
        onClose={() => setShowSettings(false)}
      />

      <DetailPanel
        open={showDetail}
        onClose={() => setShowDetail(false)}
        thinkingBlocks={thinkingBlocks}
        codeBlocks={codeBlocks}
        toolBlocks={toolBlocks}
      />

      <FileBrowser
        open={showBrowser}
        onClose={() => setShowBrowser(false)}
        onSelectPath={(path) => {
          sendInput(path)
          setShowBrowser(false)
        }}
        initialPath={project.cwd}
      />
    </div>
  )
}
