import { useState, useEffect, useRef, useCallback } from "react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebglAddon } from "@xterm/addon-webgl"
import "@xterm/xterm/css/xterm.css"
import type { Project, ProjectSettings, SmartAction } from "../types"
import { AGENTS } from "../types"
import { getSettings, saveSettings, addRecentCommand, getRecentCommands, getApiBase, getAutoSaveKeysEnabled, getAutoSaveKeysPath } from "../lib/storage"
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
  resumeSessionId?: string  // Claude Code session ID to resume (--resume <id>)
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

function stripAnsiForDetection(str: string): string {
  return str
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/[\x00-\x08\x0b-\x1f]/g, "")
}

export function TerminalView({ project, agentId, sessionId, resumeSessionId, send, on, onBack }: TerminalViewProps) {
  const { t, locale } = useLocale()
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

  // Force re-render for parser blocks (debounced to avoid jank during scroll)
  const [, setParserTick] = useState(0)
  const parserTickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScreenTextRef = useRef("")
  const codexRecoverLaunchAtRef = useRef<Record<string, number>>({})

  const agent = AGENTS.find((a) => a.id === agentId)
  const showDangerBadge = (agentId === "claude" && settings.bypass) || (agentId === "codex" && settings.codexMode === "danger-full-access")

  const launchAgentCommand = useCallback((force: boolean = false) => {
    if (!agent || !sessionId) return
    if (!force && commandSent.has(sessionId)) return
    let cmd = agent.command({ ...settings, locale })
    if (!cmd) return
    // Inject --resume <id> for agents that support it
    if (resumeSessionId) {
      if (agentId === "claude") {
        cmd = cmd.replace(/^claude\b/, `claude --resume ${resumeSessionId}`)
      } else if (agentId === "codex") {
        cmd = cmd.replace(/^codex\b/, `codex --resume ${resumeSessionId}`)
      }
      // Gemini/Aider/Cursor: no CLI --resume flag, use /resume after launch
    }
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
  }, [agent, agentId, sessionId, resumeSessionId, settings, send])

  const shouldRecoverCodexSession = useCallback((): boolean => {
    if (agentId !== "codex") return false
    const tail = lastScreenTextRef.current.slice(-2500)
    if (!tail) return false
    const looksCodex = /(OpenAI\s+Codex|\/model\s+to\s+change|gpt-[\w.-]*codex|codex\s+xhigh)/i.test(tail)
    const looksShell = /(PS\s+[A-Z]:\\[^\n>]*>|[A-Z]:\\[^\n>]*>\s*$|[$%#>]\s*$)/m.test(tail)
    return looksShell && !looksCodex
  }, [agentId])

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
    // Swipe left to open detail panel (at least 150px, mostly horizontal, strict angle)
    if (dx < -150 && dy < 30) {
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
    if (text === "\r") { sendInput(text); return } // Enter key for TUI navigation
    if (!text.trim()) return  // Don't send empty commands
    // Send text first, then Enter separately after a delay.
    // TUI apps like Claude Code process input as a stream ??if text+\r arrives
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
        { label: "codex", description: "Start Codex CLI", command: "codex --no-alt-screen", icon: ">" },
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
      scrollback: 2000,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(termRef.current)

    // WebGL renderer ??significantly faster scrolling and rendering
    let webglAddon: WebglAddon | null = null
    try {
      webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => { try { webglAddon?.dispose() } catch {} })
      term.loadAddon(webglAddon)
    } catch {
      webglAddon = null
      // WebGL not available ??falls back to canvas 2D
    }
    // Store ref for safe cleanup
    ;(term as any)._webglAddon = webglAddon

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

    // Mobile touch scroll: xterm disableStdin=true may break touch scrolling
    // We manually translate vertical touch drags into scrollLines() calls
    // with sensitivity multiplier and momentum/inertia for smooth scrolling
    if (isMobile) {
      const el = termRef.current
      let touchY = 0
      let accum = 0
      let velocity = 0
      let lastTime = 0
      let momentumId = 0
      const lineH = term.options.fontSize ? term.options.fontSize * 1.0 : 14
      const sensitivity = 3.5 // scroll 3.5x faster than finger movement

      const stopMomentum = () => {
        if (momentumId) { cancelAnimationFrame(momentumId); momentumId = 0 }
      }

      const onTouchStart = (e: TouchEvent) => {
        stopMomentum()
        touchY = e.touches[0].clientY
        accum = 0
        velocity = 0
        lastTime = Date.now()
      }
      const onTouchMove = (e: TouchEvent) => {
        const now = Date.now()
        const dt = Math.max(now - lastTime, 1)
        const dy = touchY - e.touches[0].clientY // positive = scroll down
        touchY = e.touches[0].clientY
        lastTime = now

        // Track velocity for momentum (pixels per ms)
        velocity = 0.7 * velocity + 0.3 * (dy / dt)

        accum += dy * sensitivity
        const lines = Math.trunc(accum / lineH)
        if (lines !== 0) {
          term.scrollLines(lines)
          accum -= lines * lineH
        }
        // Always prevent default in terminal area to avoid browser intercepting scroll
        e.preventDefault()
      }
      const onTouchEnd = () => {
        // Momentum: continue scrolling with decaying velocity
        let v = velocity * sensitivity // px/ms scaled
        const friction = 0.95
        const tick = () => {
          v *= friction
          if (Math.abs(v) < 0.01) { momentumId = 0; return }
          accum += v * 16 // ~16ms per frame
          const lines = Math.trunc(accum / lineH)
          if (lines !== 0) {
            term.scrollLines(lines)
            accum -= lines * lineH
          }
          momentumId = requestAnimationFrame(tick)
        }
        if (Math.abs(v) > 0.05) {
          momentumId = requestAnimationFrame(tick)
        }
      }
      el.addEventListener("touchstart", onTouchStart, { passive: true })
      el.addEventListener("touchmove", onTouchMove, { passive: false })
      el.addEventListener("touchend", onTouchEnd, { passive: true })

      return () => {
        stopMomentum()
        resizeObs.disconnect()
        el.removeEventListener("touchstart", onTouchStart)
        el.removeEventListener("touchmove", onTouchMove)
        el.removeEventListener("touchend", onTouchEnd)
        try { (term as any)._webglAddon?.dispose() } catch {}
        try { term.dispose() } catch {}
        xtermRef.current = null
      }
    }

    return () => {
      resizeObs.disconnect()
      try { (term as any)._webglAddon?.dispose() } catch {}
      try { term.dispose() } catch {}
      xtermRef.current = null
    }
  }, [send])

  // Handle WS messages
  useEffect(() => {
    const unsubs: (() => void)[] = []

    unsubs.push(on("output", (msg) => {
      const data = msg.data as string
      xtermRef.current?.write(data)

      // Feed ANSI parser (debounce re-render to avoid scroll jank)
      parserRef.current.feed(data)
      if (!parserTickTimer.current) {
        parserTickTimer.current = setTimeout(() => {
          parserTickTimer.current = null
          setParserTick((t) => t + 1)
        }, 300)
      }

      // Keep a recent plain-text snapshot for resumed-session health checks.
      const plain = stripAnsiForDetection(data)
      lastScreenTextRef.current = (lastScreenTextRef.current + "\n" + plain).slice(-8000)

      // Detect shell prompt
      const promptRe = agentId === "codex"
        ? /(?:[$%>#]|[\u203A\u276F\u00BB])\s*$/
        : /[$%>]\s*$/
      if (promptRe.test(plain)) {
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
      const scrollback = msg.data as string
      lastScreenTextRef.current = stripAnsiForDetection(scrollback).slice(-8000)
      // Clear terminal before writing scrollback to avoid duplicate content on reconnect
      xtermRef.current?.clear()
      xtermRef.current?.write(scrollback, () => {
        // Scroll after xterm finishes rendering the write buffer
        xtermRef.current?.scrollToBottom()
      })
      // Fallback: also scroll after a delay in case write callback does not fire
      setTimeout(() => xtermRef.current?.scrollToBottom(), 300)
    }))

    unsubs.push(on("attached", (msg) => {
      if (!isMobile) xtermRef.current?.focus()
      // Scroll to bottom after attach ??use multiple delays since scrollback arrives separately
      setTimeout(() => xtermRef.current?.scrollToBottom(), 100)
      setTimeout(() => xtermRef.current?.scrollToBottom(), 500)
      setTimeout(() => xtermRef.current?.scrollToBottom(), 1000)

      const resumed = Boolean(msg.resumed)
      const shouldRecoverCodex = resumed && shouldRecoverCodexSession()

      if (!resumed) {
        launchAgentCommand(false)
      } else if (shouldRecoverCodex && sessionId) {
        const last = codexRecoverLaunchAtRef.current[sessionId] || 0
        if (Date.now() - last >= 8000) {
          codexRecoverLaunchAtRef.current[sessionId] = Date.now()
          launchAgentCommand(true)
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
  }, [on, send, agent, settings, buildIdleSuggestions, launchAgentCommand, shouldRecoverCodexSession, sessionId, agentId])

  // Android back button ??close overlays first
  useEffect(() => {
    const handler = (e: Event) => {
      if (showBrowser) { setShowBrowser(false); e.preventDefault(); return }
      if (showSettings) { setShowSettings(false); e.preventDefault(); return }
      if (showDetail) { setShowDetail(false); e.preventDefault(); return }
    }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [showBrowser, showSettings, showDetail])

  // Attach on mount + re-attach on every WS reconnect.
  // Re-attaching is idempotent and keeps WS->session mapping correct after reconnect.
  useEffect(() => {
    promptReadyRef.current = false
    parserRef.current.clear()
    lastScreenTextRef.current = ""

    const attach = () => send({ type: "attach", projectId: project.id, agentId, sessionId, autoSaveKeys: getAutoSaveKeysEnabled(), autoSaveKeysPath: getAutoSaveKeysPath(), isAgentResume: !!resumeSessionId, claudeSessionId: resumeSessionId || undefined })
    attach()

    const unsub = on("__ws_open__", () => {
      attach()
    })
    return unsub
  }, [project.id, agentId, sessionId, send, on])

  const thinkingBlocks = parserRef.current.getThinkingBlocks()
  const codeBlocks = parserRef.current.getCodeBlocks()
  const toolBlocks = parserRef.current.getToolBlocks()
  const urlEntries = parserRef.current.getUrlBlocks()
  const hasDetails = thinkingBlocks.length + codeBlocks.length + toolBlocks.length + urlEntries.length > 0

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
        background: "rgba(15,23,42,0.97)",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
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
            color: "rgba(255,255,255,0.6)",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          {"<"}
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
            <span style={{ color: "rgba(255,255,255,0.25)", margin: "0 6px", fontWeight: 300 }}>{"|"}</span>
            <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 400 }}>
              {agent?.name || t("agent.terminal.name")}
            </span>
          </div>
        </div>

        {showDangerBadge && (
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
            {"..."} {thinkingBlocks.length + codeBlocks.length + toolBlocks.length + urlEntries.length}
          </button>
        )}

        <button
          onClick={() => setShowSettings(true)}
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)",
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
        style={{ flex: 1, padding: 4, overflow: "hidden", willChange: "transform" }}
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
        urlEntries={urlEntries}
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




