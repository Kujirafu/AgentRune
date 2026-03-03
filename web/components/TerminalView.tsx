import { useState, useEffect, useRef, useCallback } from "react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import type { Project, ProjectSettings, SmartAction } from "../lib/types"
import { AGENTS } from "../lib/types"
import { getSettings, saveSettings, addRecentCommand, getRecentCommands } from "../lib/storage"
import { detectPromptActions, isIdle, isMobile } from "../lib/detect"
import { AnsiParser } from "../lib/ansi-parser"
import { SettingsSheet } from "./SettingsSheet"
import { SmartSuggestions } from "./SmartSuggestions"
import { QuickActions } from "./QuickActions"
import { InputBar } from "./InputBar"
import { DetailPanel } from "./DetailPanel"
import { FileBrowser } from "./FileBrowser"

interface TerminalViewProps {
  project: Project
  agentId: string
  sessionToken: string
  send: (msg: Record<string, unknown>) => void
  on: (type: string, handler: (msg: Record<string, unknown>) => void) => void
  onBack: () => void
}

interface IdleSuggestion {
  label: string
  description?: string
  command: string
  icon?: string
}

export function TerminalView({ project, agentId, send, on, onBack }: TerminalViewProps) {
  const [settings, setSettings] = useState<ProjectSettings>(() => getSettings(project.id))
  const [showSettings, setShowSettings] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [showBrowser, setShowBrowser] = useState(false)
  const [smartActions, setSmartActions] = useState<SmartAction[]>([])
  const [idleSuggestions, setIdleSuggestions] = useState<IdleSuggestion[]>([])
  const [sugMode, setSugMode] = useState<"prompt" | "idle" | "hidden">("hidden")
  const [kbHeight, setKbHeight] = useState(0)
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const promptReadyRef = useRef(false)
  const parserRef = useRef(new AnsiParser())

  // Force re-render for parser blocks
  const [, setParserTick] = useState(0)

  const agent = AGENTS.find((a) => a.id === agentId)

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

  // Keyboard height detection
  useEffect(() => {
    if (!isMobile || !window.visualViewport) return
    const vv = window.visualViewport
    const onResize = () => {
      const diff = window.innerHeight - vv.height
      setKbHeight(diff > 50 ? diff : 0)
    }
    vv.addEventListener("resize", onResize)
    return () => vv.removeEventListener("resize", onResize)
  }, [])

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
    sendInput(text + "\n")
    addRecentCommand(project.id, text)
  }, [sendInput, project.id])

  // Image paste handler
  const handleImagePaste = useCallback(async (base64: string, filename: string) => {
    try {
      const res = await fetch("/api/upload", {
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

  // Voice placeholder
  const handleVoice = useCallback(() => {
    // TODO: Integrate with Claude Voice API when available
    alert("Voice input coming soon — waiting for Claude Voice API")
  }, [])

  const buildIdleSuggestions = useCallback(async () => {
    const suggestions: IdleSuggestion[] = []

    if (agentId === "terminal") {
      suggestions.push(
        { label: "claude", description: "Start Claude Code", command: "claude", icon: "🤖" },
        { label: "codex", description: "Start Codex CLI", command: "codex", icon: "⚡" },
      )
    }

    try {
      const res = await fetch(`/api/projects/${project.id}/scripts`)
      if (res.ok) {
        const data = await res.json()
        const scripts = data.scripts || {}
        for (const key of ["dev", "start", "build", "test", "lint"]) {
          if (scripts[key]) {
            suggestions.push({
              label: `npm run ${key}`,
              description: scripts[key],
              command: `npm run ${key}`,
              icon: "📦",
            })
          }
        }
      }
    } catch {}

    const recent = getRecentCommands(project.id)
    for (const cmd of recent.slice(0, 3)) {
      if (!suggestions.find((s) => s.command === cmd)) {
        suggestions.push({ label: cmd, command: cmd, icon: "🕒" })
      }
    }

    for (const gc of [
      { label: "git status", command: "git status", icon: "📋" },
      { label: "git pull", command: "git pull", icon: "⬇" },
      { label: "git push", command: "git push", icon: "⬆" },
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

  // Refit on keyboard change
  useEffect(() => {
    if (fitRef.current) {
      setTimeout(() => {
        try {
          fitRef.current?.fit()
          if (xtermRef.current) {
            send({ type: "resize", cols: xtermRef.current.cols, rows: xtermRef.current.rows })
          }
        } catch {}
      }, 100)
    }
  }, [kbHeight, send])

  // Handle WS messages
  useEffect(() => {
    on("output", (msg) => {
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
    })

    on("scrollback", (msg) => {
      xtermRef.current?.write(msg.data as string)
    })

    on("attached", () => {
      if (!isMobile) xtermRef.current?.focus()

      if (agent) {
        const cmd = agent.command(settings)
        if (cmd) {
          const tryToSend = (attempts: number) => {
            if (promptReadyRef.current || attempts >= 10) {
              setTimeout(() => {
                send({ type: "input", data: cmd + "\n" })
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
    })

    on("exit", () => {
      xtermRef.current?.write("\r\n\x1b[33m[Session ended]\x1b[0m\r\n")
      setSugMode("hidden")
    })

    on("error", (msg) => {
      xtermRef.current?.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`)
    })
  }, [on, send, agent, settings, buildIdleSuggestions])

  // Attach on mount
  useEffect(() => {
    promptReadyRef.current = false
    parserRef.current.clear()
    send({ type: "attach", projectId: project.id, agentId })
  }, [project.id, send])

  const thinkingBlocks = parserRef.current.getThinkingBlocks()
  const codeBlocks = parserRef.current.getCodeBlocks()
  const toolBlocks = parserRef.current.getToolBlocks()
  const hasDetails = thinkingBlocks.length + codeBlocks.length + toolBlocks.length > 0

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        height: kbHeight > 0 ? `calc(100dvh - ${kbHeight}px)` : "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "#0f172a",
        color: "#e2e8f0",
        transition: "height 0.1s",
      }}
    >
      {/* Top bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
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
              {agent?.name || "Terminal"}
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
            {"⚡"} Bypass
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
            {"💭"} {thinkingBlocks.length + codeBlocks.length}
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
          {"⚙"}
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
        onVoice={handleVoice}
        onBrowse={() => setShowBrowser(true)}
        autoFocus={isMobile}
      />

      {/* Overlays */}
      <SettingsSheet
        open={showSettings}
        settings={settings}
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
