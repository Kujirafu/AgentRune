// web/components/MissionControl.tsx
import { useState, useEffect, useRef, useCallback } from "react"
import type { Project, ProjectSettings, AppSession } from "../lib/types"
import type { AgentEvent } from "../../shared/types"
import { AGENTS } from "../lib/types"
import { getSettings, saveSettings, addRecentCommand } from "../lib/storage"
import { EventCard } from "./EventCard"
import type { AgentStatus } from "./StatusIndicator"
import { QuickActions } from "./QuickActions"
import { InputBar } from "./InputBar"
import { SettingsSheet } from "./SettingsSheet"
import { FileBrowser } from "./FileBrowser"
import { isMobile } from "../lib/detect"
import { AnsiParser, type OutputBlock } from "../lib/ansi-parser"
import { useLocale } from "../lib/i18n/index.js"

// iOS-like spring curve
const SPRING = "cubic-bezier(0.32, 0.72, 0, 1)"

interface MissionControlProps {
  project: Project
  agentId: string
  sessionId?: string
  sessionToken: string
  send: (msg: Record<string, unknown>) => boolean
  on: (type: string, handler: (msg: Record<string, unknown>) => void) => (() => void)
  onBack: () => void
  onOpenTerminal: () => void
  projects: Project[]
  activeSessions: AppSession[]
  onSwitchSession: (sessionId: string) => void
  onKillSession: (sessionId: string) => void
  onOpenSessionTerminal: (sessionId: string) => void
  theme?: "light" | "dark"
  toggleTheme?: () => void
}

// Session label helpers (localStorage-backed)
function getSessionLabels(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem("agentrune_session_labels") || "{}") } catch { return {} }
}
function setSessionLabelStorage(id: string, label: string) {
  const labels = getSessionLabels()
  if (label) labels[id] = label; else delete labels[id]
  localStorage.setItem("agentrune_session_labels", JSON.stringify(labels))
}

export function MissionControl({
  project,
  agentId,
  sessionId,
  send,
  on,
  onBack,
  onOpenTerminal,
  projects,
  activeSessions,
  onSwitchSession,
  onKillSession,
  onOpenSessionTerminal,
  theme,
  toggleTheme,
}: MissionControlProps) {
  const { t } = useLocale()
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle")
  const [wsConnected, setWsConnected] = useState(true)
  const [settings, setSettings] = useState<ProjectSettings>(() => getSettings(project.id))
  const [showSettings, setShowSettings] = useState(false)
  const [showBrowser, setShowBrowser] = useState(false)
  const [contextSession, setContextSession] = useState<string | null>(null)
  const [renamingSession, setRenamingSession] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [sessionLabels, setSessionLabels] = useState<Record<string, string>>(getSessionLabels)
  const [panel, setPanel] = useState(1) // 0=sessions, 1=main, 2=thinking
  const [viewH, setViewH] = useState(window.innerHeight)
  const scrollRef = useRef<HTMLDivElement>(null)
  const slideRef = useRef<HTMLDivElement>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const promptReadyRef = useRef(false)
  const agent = AGENTS.find((a) => a.id === agentId)

  // Client-side event detection state (parses "output" WS messages directly)
  const parseStateRef = useRef({
    lastPermission: 0,
    lastTestResult: 0,
    seenTools: new Set<string>(),
    pending: "",
    isThinking: false,
  })
  // AnsiParser for structured output blocks (thinking/code/tools)
  const parserRef = useRef(new AnsiParser())
  const [parsedBlocks, setParsedBlocks] = useState<OutputBlock[]>([])
  const [detailTab, setDetailTab] = useState<"thinking" | "code" | "tools">("thinking")
  // Cumulative token counter
  const [usageTokens, setUsageTokens] = useState<{ input: number; output: number }>({ input: 0, output: 0 })
  const [showProjectUsage, setShowProjectUsage] = useState(false)
  const projectTotalTokens = useRef<{ input: number; output: number }>({ input: 0, output: 0 })

  // Long-press for session context menu
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  const onSessionPointerDown = useCallback((sid: string) => {
    longPressFired.current = false
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      setContextSession(sid)
      if (navigator.vibrate) navigator.vibrate(50)
    }, 500)
  }, [])
  const onSessionPointerUp = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
  }, [])
  const onSessionPointerMove = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
  }, [])

  // Swipe gesture refs
  const dragRef = useRef({
    startX: 0, startY: 0, lastX: 0, lastY: 0,
    direction: "" as "" | "h" | "v",
    isDragging: false, offset: 0,
  })

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

  // Auto-scroll to bottom (newest at bottom, chat-style)
  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
  }, [events])

  // Set initial slide position
  useEffect(() => {
    if (slideRef.current) {
      slideRef.current.style.transform = "translateX(-100vw)"
    }
  }, [])

  const goToPanel = useCallback((p: number) => {
    if (slideRef.current) {
      slideRef.current.style.transition = `transform 0.5s ${SPRING}`
      slideRef.current.style.transform = `translateX(${-p * 100}vw)`
    }
    setPanel(p)
  }, [])

  // ─── Swipe gesture handlers ───
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragRef.current = {
      startX: e.touches[0].clientX, startY: e.touches[0].clientY,
      lastX: e.touches[0].clientX, lastY: e.touches[0].clientY,
      direction: "", isDragging: false, offset: 0,
    }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const d = dragRef.current
    const dx = e.touches[0].clientX - d.startX
    const dy = e.touches[0].clientY - d.startY

    if (!d.direction) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        d.direction = Math.abs(dx) > Math.abs(dy) ? "h" : "v"
      }
      return
    }

    // Track last position for vertical swipe detection
    d.lastX = e.touches[0].clientX
    d.lastY = e.touches[0].clientY

    if (d.direction === "h") {
      e.preventDefault()
      d.isDragging = true

      // Rubber band at edges
      let offset = dx
      const p = panel
      if ((p === 0 && dx > 0) || (p === 2 && dx < 0)) {
        offset = dx * 0.15
      }
      d.offset = offset

      if (slideRef.current) {
        slideRef.current.style.transition = "none"
        slideRef.current.style.transform = `translateX(calc(${-p * 100}vw + ${offset}px))`
      }
    }
  }, [panel])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const d = dragRef.current
    if (d.direction === "h" && d.isDragging) {
      const threshold = window.innerWidth * 0.25
      let newPanel = panel
      if (d.offset > threshold && panel > 0) newPanel = panel - 1
      else if (d.offset < -threshold && panel < 2) newPanel = panel + 1

      if (slideRef.current) {
        slideRef.current.style.transition = `transform 0.5s ${SPRING}`
        slideRef.current.style.transform = `translateX(${-newPanel * 100}vw)`
      }
      if (newPanel !== panel) setPanel(newPanel)
    }
    // Swipe-up → open file browser (on main panel)
    // Use changedTouches for accurate end position (touchmove may not fire reliably)
    if (d.direction === "v" && panel === 1) {
      const endY = e.changedTouches[0]?.clientY ?? d.lastY
      const endX = e.changedTouches[0]?.clientX ?? d.lastX
      const dy = d.startY - endY
      const dx = Math.abs(endX - d.startX)
      // Only trigger when started from bottom 45% of screen (avoids conflict with event list scroll)
      if (dy > 60 && dx < 80 && d.startY > viewH * 0.55) {
        setShowBrowser(true)
      }
    }
    dragRef.current = { startX: 0, startY: 0, lastX: 0, lastY: 0, direction: "", isDragging: false, offset: 0 }
  }, [panel, viewH])

  // ─── Settings ───
  const handleSettingsChange = useCallback((newSettings: ProjectSettings) => {
    const prev = settings
    setSettings(newSettings)
    saveSettings(project.id, newSettings)

    // Send settings changes to running Claude session
    if (agentId === "claude") {
      // Model change → /model <name>
      if (newSettings.model !== prev.model) {
        send({ type: "input", data: `/model ${newSettings.model}` })
        setTimeout(() => send({ type: "input", data: "\r" }), 50)
      }
      // Plan mode toggle → shift+tab (\x1b[Z)
      if (newSettings.planMode !== prev.planMode) {
        send({ type: "input", data: "\x1b[Z" })
      }
    }
  }, [project.id, settings, agentId, send])

  // ─── Input ───
  const sendInput = useCallback((data: string): boolean => {
    return send({ type: "input", data })
  }, [send])

  const handleSendCommand = useCallback((text: string) => {
    if (text === "\x03") { sendInput(text); return }
    if (!text.trim()) return

    // Send text first, then Enter separately after a delay.
    // TUI apps like Claude Code process input as a stream — if text+\r arrives
    // as one chunk, \r gets treated as a newline in the input buffer instead of
    // triggering submission. Splitting them ensures \r is handled as Enter.
    const sent = sendInput(text)
    if (!sent) {
      setEvents(prev => [...prev, {
        id: `err_${Date.now()}`,
        timestamp: Date.now(),
        type: "error" as const,
        status: "failed" as const,
        title: t("mc.sendFailed"),
        detail: t("mc.sendFailedDetail"),
      }])
      return
    }
    setTimeout(() => sendInput("\r"), 30)

    // Insert user message as event for message-output correspondence
    setEvents(prev => [...prev, {
      id: `usr_${Date.now()}`,
      timestamp: Date.now(),
      type: "info" as const,
      status: "completed" as const,
      title: text.length > 60 ? text.slice(0, 60) + "..." : text,
    }].slice(-100))

    setAgentStatus("working")

    addRecentCommand(project.id, text)
  }, [sendInput, project.id])

  const handleDecision = useCallback((eventId: string, input: string) => {
    // For inputs with escape sequences (menu arrow navigation), send each key separately
    const parts = input.match(/\x1b\[[A-Z]|\r|[^\x1b\r]+/g) || [input]
    parts.forEach((part, i) => {
      setTimeout(() => sendInput(part), i * 30)
    })
    setEvents((prev) =>
      prev.map((e) => e.id === eventId ? { ...e, status: "completed" as const } : e)
    )
  }, [sendInput])

  // ─── Quote: prepend quoted text to next command ───
  const [quotedText, setQuotedText] = useState("")
  const handleQuote = useCallback((text: string) => {
    setQuotedText(`> ${text}\n`)
    if (navigator.vibrate) navigator.vibrate(20)
  }, [])

  // ─── Save to Obsidian with auto-categorization ───
  const handleSaveObsidian = useCallback((text: string, event?: AgentEvent) => {
    const now = new Date()
    const dateStr = now.toISOString().slice(0, 10)
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

    // Auto-categorize based on event type
    let folder = "AgentRune/Notes"
    let tags = "agent-rune"
    if (event) {
      switch (event.type) {
        case "file_edit": case "file_create": case "file_delete":
          folder = "AgentRune/Changes"
          tags = "agent-rune, changelog"
          break
        case "error":
          folder = "AgentRune/Bugs"
          tags = "agent-rune, bug"
          break
        case "command_run":
          folder = "AgentRune/Commands"
          tags = "agent-rune, command"
          break
        case "test_result":
          folder = "AgentRune/Tests"
          tags = "agent-rune, test"
          break
        case "decision_request":
          folder = "AgentRune/Tasks"
          tags = "agent-rune, task"
          break
      }
    }

    const title = `${dateStr} ${event?.title?.slice(0, 40) || "Note"}`
    const body = [
      `---`,
      `tags: [${tags}]`,
      `date: ${dateStr}`,
      `time: ${timeStr}`,
      `project: ${project.name}`,
      `agent: ${agentId}`,
      `---`,
      ``,
      text,
    ].join("\n")

    // Use Obsidian URI protocol to create note
    const uri = `obsidian://new?vault=&file=${encodeURIComponent(`${folder}/${title}`)}&content=${encodeURIComponent(body)}`
    window.open(uri, "_system")
    if (navigator.vibrate) navigator.vibrate(20)
  }, [project.name, agentId])

  // ─── WS messages ───
  useEffect(() => {
    const unsubs: (() => void)[] = []

    // Server-side events (supplementary log only)
    unsubs.push(on("event", () => {}))

    // Replay stored events on re-attach (from server adapter)
    unsubs.push(on("events_replay", (msg) => {
      const replayed = (msg.events as AgentEvent[]) || []
      if (replayed.length > 0) {
        // Merge with existing client-side events (server events as fallback)
        setEvents(prev => {
          if (prev.length > 0) return prev // Client already has events
          return replayed.slice().sort((a, b) => a.timestamp - b.timestamp)
        })
        const latest = replayed[replayed.length - 1]
        if (latest?.type === "decision_request" && latest.status === "waiting") {
          setAgentStatus("waiting")
        } else if (latest?.status === "in_progress") {
          setAgentStatus("working")
        }
      }
    }))
    unsubs.push(on("output", (msg) => {
      const data = msg.data as string
      if (/[$%>❯]\s*$/.test(data)) promptReadyRef.current = true
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      setAgentStatus("working")

      // Strip ANSI for pattern matching
      const stripped = data
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b[78DMEHcn]/g, "")
        .replace(/\x1b\(B/g, "")
      const ps = parseStateRef.current
      const now = Date.now()
      const text = ps.pending + stripped
      ps.pending = ""

      const mkId = () => `c_${now}_${Math.random().toString(36).slice(2, 7)}`

      // ─── Tool call events (the ONLY action events we generate) ───
      const toolPatterns: [RegExp, AgentEvent["type"], (m: RegExpMatchArray) => string][] = [
        [/●\s*Read\(([^)]+)\)/, "info", m => t("mc.read", { path: m[1] })],
        [/●\s*Edit\(([^)]+)\)/, "file_edit", m => t("mc.edited", { path: m[1] })],
        [/●\s*Write\(([^)]+)\)/, "file_create", m => t("mc.created", { path: m[1] })],
        [/●\s*Bash\(([^)]*)\)/, "command_run", () => t("mc.runCommand")],
        [/●\s*(Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit|Skill|TaskCreate|TaskUpdate|TaskList|TaskGet)\(/, "info", m => m[1]],
      ]

      for (const [pattern, type, titleFn] of toolPatterns) {
        const m = text.match(pattern)
        if (m) {
          const sig = m[0].slice(0, 60)
          if (!ps.seenTools.has(sig)) {
            ps.seenTools.add(sig)
            if (ps.seenTools.size > 200) {
              const oldest = [...ps.seenTools].slice(0, 100)
              for (const k of oldest) ps.seenTools.delete(k)
            }
            setEvents(prev => [...prev, {
              id: mkId(), timestamp: now,
              type,
              status: "in_progress" as const,
              title: titleFn(m),
            }].slice(-100))
          }
        }
      }

      // ─── Decision: Permission prompt (y/n/a) ───
      if (now - ps.lastPermission > 5000 &&
          (/\(y\/n\/a\)/.test(text) || (/allow/i.test(text) && /\(y\/n\)/.test(text)))) {
        ps.lastPermission = now
        const detail = text.replace(/[\r\n]+/g, " ").replace(/[\x00-\x1f]/g, " ").trim().slice(0, 200)
        setEvents(prev => [...prev, {
          id: mkId(), timestamp: now,
          type: "decision_request" as const,
          status: "waiting" as const,
          title: t("mc.needsAuth"),
          detail,
          decision: {
            options: [
              { label: t("mc.allowOnce"), input: "y", style: "primary" as const },
              { label: t("mc.alwaysAllow"), input: "a", style: "primary" as const },
              { label: t("mc.deny"), input: "n", style: "danger" as const },
            ],
          },
        }].slice(-100))
        setAgentStatus("waiting")
        if (navigator.vibrate) navigator.vibrate([200, 100, 200])
      }

      // ─── Interactive menu detection (numbered list + "Enter to select") ───
      if (/enter to select/i.test(text) || /\u2191\u2193\s*to navigate/i.test(text)) {
        const lines = text.split(/[\r\n]+/)
        const rawOptions: { label: string; index: number }[] = []
        let currentSelection = 0

        for (let li = 0; li < lines.length; li++) {
          const line = lines[li].replace(/[\x00-\x1f]/g, " ").trim()
          const m = line.match(/^(?:\u276F\s*)?(\d+)\.\s+(.+)/)
          if (m) {
            rawOptions.push({ label: m[2].trim(), index: rawOptions.length })
            if (/\u276F/.test(lines[li])) currentSelection = rawOptions.length - 1
          }
        }

        // Filter out generic input options (user can just type in InputBar)
        const filteredOptions = rawOptions.filter(o => {
          const l = o.label.toLowerCase()
          return !/^type\s+(something|a message|here)/i.test(l)
            && !/^chat\s+(about|with)/i.test(l)
            && !/^(enter|write)\s+(a|your|custom)/i.test(l)
        })

        if (filteredOptions.length >= 2) {
          setEvents(prev => {
            // Don't duplicate if menu already exists within 10s
            const recent = prev.find(e =>
              e.type === "decision_request" && e.status === "waiting" && now - e.timestamp < 10000)
            if (recent) return prev
            return [...prev, {
              id: mkId(), timestamp: now,
              type: "decision_request" as const,
              status: "waiting" as const,
              title: t("mc.selectOption"),
              decision: {
                options: filteredOptions.slice(0, 6).map((o) => {
                  // Calculate arrow key moves from current selection to this option's original index
                  const origIdx = rawOptions.indexOf(o)
                  const moves = origIdx - currentSelection
                  let keys = ""
                  if (moves > 0) keys = "\x1b[B".repeat(moves)
                  else if (moves < 0) keys = "\x1b[A".repeat(-moves)
                  return {
                    label: o.label.slice(0, 40),
                    input: keys + "\r",
                    style: "primary" as const,
                  }
                }),
              },
            }].slice(-100)
          })
          setAgentStatus("waiting")
        }
      }

      // ─── Test results ───
      if (now - ps.lastTestResult > 10000 &&
          (/tests?\s+passed/i.test(text) || /\d+\s+passing/i.test(text))) {
        ps.lastTestResult = now
        const passMatch = text.match(/(\d+)\s+(?:tests?\s+)?pass/i)
        const failMatch = text.match(/(\d+)\s+(?:tests?\s+)?fail/i)
        setEvents(prev => [...prev, {
          id: mkId(), timestamp: now,
          type: "test_result" as const,
          status: failMatch ? "failed" as const : "completed" as const,
          title: t("event.testResult"),
          detail: failMatch
            ? t("mc.testFailed", { pass: passMatch?.[1] || "?", fail: failMatch[1] })
            : t("mc.testPassed", { pass: passMatch?.[1] || "?" }),
        }].slice(-100))
      }

      // ─── Feed raw output to AnsiParser for structured blocks ───
      parserRef.current.feed(data)
      setParsedBlocks(parserRef.current.getBlocks())

      // ─── Parse usage from status bar: ↓ N tokens (input), ↑ N tokens (output) ───
      const inputMatch = text.match(/↓\s*(\d[\d,]*)\s*tokens?/i)
      const outputMatch = text.match(/↑\s*(\d[\d,]*)\s*tokens?/i)
      if (inputMatch || outputMatch) {
        setUsageTokens(prev => {
          const newInput = inputMatch ? Math.max(prev.input, parseInt(inputMatch[1].replace(/,/g, ""), 10)) : prev.input
          const newOutput = outputMatch ? Math.max(prev.output, parseInt(outputMatch[1].replace(/,/g, ""), 10)) : prev.output
          // Accumulate delta into project total
          projectTotalTokens.current.input += newInput - prev.input
          projectTotalTokens.current.output += newOutput - prev.output
          return { input: newInput, output: newOutput }
        })
      }

      // ─── Thinking phase detection ───
      // Status animation markers mean Claude is still thinking → suppress plain text accumulation
      if (/[✦✱∗∴]\s*[A-Z]/i.test(text) || /\d+s\s*·/.test(text) || /thinking|whirring/i.test(text) || /thought\s+for\s+\d+s/i.test(text)) {
        ps.isThinking = true
      }

      // ─── Claude response detection (● followed by text, NOT a tool call) ───
      const isToolLine = /●\s*(?:Read|Edit|Write|Bash|Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit|Skill|TaskCreate|TaskUpdate|TaskList|TaskGet)\(/.test(text)
      const responseMatch = text.match(/●\s*(.{4,})/)
      let responseHandled = false
      if (responseMatch && !isToolLine && now - ps.lastPermission > 3000) {
        ps.isThinking = false // ● response means thinking is done
        // Strip status bar noise — NO greedy tails, each regex only matches its own noise
        let respText = responseMatch[1]
          .replace(/[\x00-\x1f]/g, " ")
          // Thinking animation verbs: ✦ Frolicking… ∗ Schlepping… (NO greedy tail)
          .replace(/[✦✱∗∴*]\s*[A-Z][a-z]+(?:-[a-z]+)*…/g, "")
          // Timing metadata: (4s · ↓ 76…) (NO greedy .* tail)
          .replace(/\(\d+\.?\d*s\s*·[^)]*\)?/g, "")
          .replace(/[↑↓]\s*\d[\d,]*\s*tokens?/gi, "")
          .replace(/\d+\s*tokens?\s*(?:used|consumed)/gi, "")
          .replace(/thought\s+for\s+\d+s/gi, "")
          .replace(/plan\s+mode\s+(?:on|off)/gi, "")
          .replace(/shift\+tab/gi, "")
          // Status fragments: (running…) (running tests) etc.
          .replace(/\(running[^)]*\)?/gi, "")
          .replace(/\(loading[^)]*\)?/gi, "")
          .replace(/\s{2,}/g, " ")
          .trim()
        if (respText.length > 3 && !/^thinking\.{0,3}$/i.test(respText) && !/^\d+\s*tokens/i.test(respText)) {
          const sig = "resp:" + respText.slice(0, 40)
          if (!ps.seenTools.has(sig)) {
            ps.seenTools.add(sig)
            const evtId = mkId()
            setEvents(prev => [...prev, {
              id: evtId, timestamp: now,
              type: "info" as const,
              status: "completed" as const,
              title: respText.length > 80 ? respText.slice(0, 80) + "…" : respText,
              detail: respText.length > 80 ? respText.slice(0, 400) : undefined,
            }].slice(-100))
          }
          responseHandled = true
          ps.pending = "" // Response captured — don't re-trigger on resize/redraw
        }
      }
      // Only save ● to pending if we couldn't extract a response yet (● arrived but text comes in next chunk)
      if (!responseHandled && /●/.test(text) && !isToolLine) {
        const bulletIdx = text.lastIndexOf("●")
        ps.pending = text.slice(Math.max(0, bulletIdx)).slice(0, 500)
      }

      // Tool calls reset thinking state
      if (isToolLine) {
        ps.isThinking = false
      }

      // Idle detection
      idleTimerRef.current = setTimeout(() => {
        if (promptReadyRef.current) {
          setAgentStatus("idle")

        }
      }, 1500)
    }))
    // Parse scrollback for recent events when switching from terminal view
    unsubs.push(on("scrollback", (msg) => {
      const data = msg.data as string
      if (!data || data.length < 10) return
      const clean = data
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b[78DMEHcn]/g, "")
        .replace(/\x1b\(B/g, "")
      // Extract recent tool calls from scrollback (last 4000 chars)
      const tail = clean.slice(-4000)
      const historyEvents: AgentEvent[] = []
      const now = Date.now()
      const mkHId = (i: number) => `h_${now}_${i}`

      // Find tool calls in history (same tool list as live parser)
      const toolRe = /●\s*(Read|Edit|Write|Bash|Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit|Skill|TaskCreate|TaskUpdate|TaskList|TaskGet)\(([^)]*)\)/g
      let tm
      let idx = 0
      while ((tm = toolRe.exec(tail)) !== null) {
        const typeMap: Record<string, AgentEvent["type"]> = {
          Read: "info", Edit: "file_edit", Write: "file_create",
          Bash: "command_run", Glob: "info", Grep: "info", Agent: "info",
          WebFetch: "info", WebSearch: "info", NotebookEdit: "info",
          Skill: "info", TaskCreate: "info", TaskUpdate: "info",
          TaskList: "info", TaskGet: "info",
        }
        historyEvents.push({
          id: mkHId(idx++), timestamp: now - 10000 + idx * 100,
          type: typeMap[tm[1]] || "info",
          status: "completed",
          title: tm[1] === "Read" ? t("mc.read", { path: tm[2] }) : tm[1] === "Edit" ? t("mc.edited", { path: tm[2] }) :
            tm[1] === "Write" ? t("mc.created", { path: tm[2] }) : tm[1] === "Bash" ? t("mc.ranCommand") : tm[1],
          detail: tm[2]?.slice(0, 100) || undefined,
        })
      }

      if (historyEvents.length > 0) {
        // Show most recent 10 tool calls from history
        const recent = historyEvents.slice(-10)
        setEvents(prev => prev.length > 0 ? prev : recent)
      }
    }))
    // TerminalView handles attach + auto-command
    unsubs.push(on("attached", () => {}))
    unsubs.push(on("exit", () => {
      setAgentStatus("idle")
  
      setEvents((prev) => [...prev, {
        id: `evt_exit_${Date.now()}`, timestamp: Date.now(),
        type: "info", status: "completed", title: t("mc.sessionEnded"),
      }])
    }))

    // Track WS connection status
    unsubs.push(on("__ws_open__", () => setWsConnected(true)))
    unsubs.push(on("__ws_close__", () => setWsConnected(false)))

    return () => {
      for (const u of unsubs) u()
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }
  }, [on, send, agent, settings])

  // Android back button — close overlays first
  useEffect(() => {
    const handler = (e: Event) => {
      if (renamingSession) { setRenamingSession(null); e.preventDefault(); return }
      if (contextSession) { setContextSession(null); e.preventDefault(); return }
      if (showBrowser) { setShowBrowser(false); e.preventDefault(); return }
      if (showSettings) { setShowSettings(false); e.preventDefault(); return }
    }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [showBrowser, showSettings, contextSession, renamingSession])

  // TerminalView (always mounted) handles attach + auto-command.
  // MissionControl just listens for WS messages — no attach needed.

  // ─── Filtered events: only well-defined actions (no text accumulator noise) ───
  const mainEvents = events.filter((e) => {
    if (e.id.startsWith("usr_")) return true
    if (!["file_edit", "file_create", "file_delete", "command_run",
      "decision_request", "error", "test_result", "info", "session_summary"].includes(e.type)) return false
    // Filter noise that leaked through as events
    const title = e.title || ""
    if (/\d+\s*tokens/i.test(title)) return false
    if (/^thinking\.{0,3}$/i.test(title)) return false
    if (/^claude\s+responded/i.test(title)) return false
    // Status bar symbols at start: ✦ ∗ ∴ * followed by word
    if (/^[✦✱∗∴*]\s*[A-Z]/i.test(title)) return false
    // Timing metadata: (4s · ...) or ↓ N tokens
    if (/\(\d+\.?\d*s\s*·/.test(title)) return false
    if (/[↑↓]\s*\d/.test(title)) return false
    // Any title containing … that's short (status animation verb)
    if (title.length < 60 && /…/.test(title) && !/[。？！，、]/.test(title)) return false
    if (/plan\s+mode/i.test(title)) return false
    if (/shift\+tab/i.test(title)) return false
    // Box-drawing / separator chars anywhere in title
    if (/[─━═┄┈╌╍┅┉▬▭▮▯❯│┃┆┊╎║╏┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬]/.test(title)) return false
    // Shell banners, MCP noise, paths
    if (/powershell|著作權|microsoft\s+co/i.test(title)) return false
    if (/mcp\s+server|needs?\s+auth|\/mcp\b/i.test(title)) return false
    if (/[A-Z]:\\[\w\\]/i.test(title)) return false
    return true
  })


  return (
    <>
      {/* Screen-border white breathing glow — visible when agent is working */}
      {agentStatus === "working" && (
        <div style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          pointerEvents: "none",
          borderRadius: 0,
          animation: "borderGlow 2.5s ease-in-out infinite",
          boxShadow: "inset 0 0 18px 1px rgba(255, 255, 255, 0.08), inset 0 0 4px 0px rgba(255, 255, 255, 0.15)",
        }} />
      )}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          height: viewH,
          width: "100vw",
          overflow: "hidden",
          zIndex: 1,
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* ─── 3-Panel Slider ─── */}
        <div
          ref={slideRef}
          style={{
            display: "flex",
            height: "100%",
            willChange: "transform",
          }}
        >
          {/* ════ Panel 0: Sessions ════ */}
          <div style={{ width: "100vw", flexShrink: 0, height: "100%", display: "flex", flexDirection: "column" }}>
            {/* Header */}
            <div style={{
              padding: "12px 16px",
              paddingTop: "calc(12px + env(safe-area-inset-top, 0px))",
              background: "var(--glass-bg)",
              backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
              borderBottom: "1px solid var(--glass-border)",
              boxShadow: "var(--glass-shadow)",
              flexShrink: 0,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: "var(--text-primary)", letterSpacing: -0.3 }}>
                {t("mc.sessions")}
              </div>
              <button onClick={() => goToPanel(1)} style={glassBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>

            {/* Session list */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              {activeSessions.map((s) => {
                const isCurrent = s.id === sessionId
                const proj = projects.find((p) => p.id === s.projectId)
                const agentDef = AGENTS.find((a) => a.id === s.agentId)
                const label = sessionLabels[s.id]
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      if (longPressFired.current) return
                      if (!isCurrent) { onSwitchSession(s.id); goToPanel(1) }
                    }}
                    onTouchStart={() => onSessionPointerDown(s.id)}
                    onTouchEnd={onSessionPointerUp}
                    onTouchMove={onSessionPointerMove}
                    onContextMenu={(e) => { e.preventDefault(); setContextSession(s.id) }}
                    style={{
                      padding: "16px 20px",
                      borderRadius: 20,
                      border: isCurrent
                        ? "1.5px solid var(--accent-primary)"
                        : "1px solid var(--glass-border)",
                      background: isCurrent ? "var(--accent-primary-bg)" : "var(--card-bg)",
                      backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                      boxShadow: isCurrent ? "0 4px 16px rgba(59,130,246,0.15)" : "var(--glass-shadow)",
                      color: "var(--text-primary)",
                      textAlign: "left",
                      cursor: "pointer",
                      transition: `all 0.3s ${SPRING}`,
                      display: "flex", alignItems: "center", gap: 16,
                    }}
                  >
                    {/* Icon box — 48x48, matches LaunchPad */}
                    <div style={{
                      width: 48, height: 48, borderRadius: 14,
                      background: "var(--icon-bg)",
                      border: "1px solid var(--glass-border)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                      color: isCurrent ? "var(--accent-primary)" : "var(--text-primary)",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                      position: "relative",
                    }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                      </svg>
                      {/* Live dot */}
                      <div style={{
                        position: "absolute", bottom: -2, right: -2,
                        width: 10, height: 10, borderRadius: "50%",
                        background: isCurrent ? "var(--accent-primary)" : "#4ade80",
                        boxShadow: `0 0 6px ${isCurrent ? "var(--accent-primary)" : "#4ade80"}`,
                        border: "2px solid var(--card-bg)",
                      }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
                        {label || (proj?.name || s.projectId)}
                        {isCurrent && <span style={{ fontSize: 11, color: "var(--accent-primary)", marginLeft: 8, fontWeight: 500 }}>{t("mc.current")}</span>}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>
                        {agentDef?.name || s.agentId}
                        {label && <span style={{ opacity: 0.7 }}> · {proj?.name || s.projectId}</span>}
                      </div>
                    </div>
                    {/* Tap for options */}
                    <div
                      onClick={(ev) => { ev.stopPropagation(); setContextSession(s.id) }}
                      onTouchStart={(ev) => ev.stopPropagation()}
                      style={{ padding: 8, margin: -8, flexShrink: 0, cursor: "pointer" }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                        <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
                      </svg>
                    </div>
                  </button>
                )
              })}

              {activeSessions.length === 0 && (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)", opacity: 0.5 }}>
                  <div style={{ marginBottom: 16 }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{t("mc.noSessions")}</div>
                  <div style={{ fontSize: 12, marginTop: 8, opacity: 0.7 }}>
                    {t("mc.launchFromPad")}
                  </div>
                </div>
              )}

              <button
                onClick={onBack}
                style={{
                  padding: "16px 20px",
                  borderRadius: 20,
                  border: "1px dashed var(--text-secondary)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  textAlign: "center",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  opacity: 0.6,
                  transition: `all 0.3s ${SPRING}`,
                }}
              >
                {t("mc.backToLaunchpad")}
              </button>
            </div>
          </div>

          {/* ════ Panel 1: Main MissionControl ════ */}
          <div style={{ width: "100vw", flexShrink: 0, height: "100%", display: "flex", flexDirection: "column" }}>
            {/* Top bar */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "12px 16px",
              paddingTop: "calc(12px + env(safe-area-inset-top, 0px))",
              background: "var(--glass-bg)",
              backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
              borderBottom: "1px solid var(--glass-border)",
              boxShadow: "var(--glass-shadow)",
              flexShrink: 0, userSelect: "none",
            }}>
              <button onClick={onBack} style={glassBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: -0.3 }}>
                  {project.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500, marginTop: 1, opacity: 0.8 }}>
                  {agent?.name || "Terminal"}
                </div>
              </div>
              <button
                onClick={() => setShowProjectUsage(prev => !prev)}
                style={{
                  fontSize: 10, padding: "4px 10px", borderRadius: 10,
                  background: showProjectUsage ? "rgba(74,222,128,0.08)" : "rgba(96,165,250,0.08)",
                  border: showProjectUsage ? "1px solid rgba(74,222,128,0.2)" : "1px solid rgba(96,165,250,0.2)",
                  color: showProjectUsage ? "#4ade80" : "var(--accent-primary)", fontWeight: 600, letterSpacing: 0.3,
                  fontFamily: "'JetBrains Mono', monospace", cursor: "pointer",
                }}
              >
                {(() => {
                  const tokens = showProjectUsage ? projectTotalTokens.current : usageTokens
                  const prefix = showProjectUsage ? "Σ " : ""
                  if (tokens.input > 0 || tokens.output > 0) {
                    const inp = tokens.input > 0 ? `↓${tokens.input >= 1000 ? `${(tokens.input / 1000).toFixed(1)}k` : tokens.input}` : ""
                    const out = tokens.output > 0 ? `↑${tokens.output >= 1000 ? `${(tokens.output / 1000).toFixed(1)}k` : tokens.output}` : ""
                    return `${prefix}${inp}${inp && out ? " " : ""}${out}`
                  }
                  return "Usage"
                })()}
              </button>
              {settings.bypass && (
                <span style={{ fontSize: 10, padding: "4px 10px", borderRadius: 10, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)", color: "#f59e0b", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  {t("mc.bypass")}
                </span>
              )}
              {toggleTheme && (
                <button onClick={toggleTheme} style={glassBtn}>
                  {theme === "dark" ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  )}
                </button>
              )}
              <button onClick={onOpenTerminal} style={glassBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </button>
              <button onClick={() => setShowSettings(true)} style={glassBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </div>

            {/* ─── Status indicator ─── */}
            {/* Connection lost */}
            {!wsConnected && (
              <div style={{
                padding: "8px 16px",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                background: "rgba(248, 113, 113, 0.06)",
                borderBottom: "1px solid rgba(248, 113, 113, 0.15)",
                flexShrink: 0,
              }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f87171", animation: "pulse 1s ease-in-out infinite" }} />
                <span style={{ fontSize: 11, color: "#f87171", fontWeight: 600, opacity: 0.9 }}>{t("mc.reconnecting")}</span>
              </div>
            )}

            {/* Idle: green dot pill / Waiting: amber pill */}
            {(agentStatus === "idle" || agentStatus === "waiting") && (
              <div style={{
                padding: "6px 16px",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 10,
                  padding: "6px 16px", borderRadius: 14,
                  background: "var(--glass-bg)",
                  backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                  border: `1px solid ${agentStatus === "waiting" ? "rgba(251,191,36,0.3)" : "var(--glass-border)"}`,
                  boxShadow: "var(--glass-shadow)",
                  animation: agentStatus === "waiting" ? "breathe 2s ease-in-out infinite" : "none",
                }}>
                  {agentStatus === "waiting" ? (
                    <>
                      <div style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: "#fbbf24",
                        boxShadow: "0 0 8px #fbbf24",
                        animation: "pulse 2s ease-in-out infinite",
                      }} />
                      <span style={{ fontSize: 11, color: "#fbbf24", fontWeight: 600 }}>
                        {t("status.waiting")}
                      </span>
                    </>
                  ) : (
                    <>
                      <div style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: "#4ade80",
                        boxShadow: "0 0 6px #4ade80",
                      }} />
                      <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500, opacity: 0.7 }}>
                        {t("status.idle")}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Page indicator — 3 panels */}
            <div style={{ display: "flex", justifyContent: "center", gap: 6, padding: "4px 0", flexShrink: 0 }}>
              {[t("mc.sessions"), t("mc.events"), t("mc.details")].map((label, i) => (
                <button
                  key={i}
                  onClick={() => goToPanel(i)}
                  style={{
                    padding: "3px 10px",
                    borderRadius: 8,
                    border: "none",
                    background: i === panel ? "var(--accent-primary)" : "transparent",
                    color: i === panel ? "#fff" : "var(--text-secondary)",
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                    opacity: i === panel ? 1 : 0.5,
                    transition: `all 0.3s ${SPRING}`,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Event stream — independent scrollable area, newest at bottom */}
            <div
              ref={scrollRef}
              style={{
                flex: 1, overflowY: "auto", padding: 16,
                minHeight: 0,
                display: "flex", flexDirection: "column", gap: 12,
                WebkitOverflowScrolling: "touch" as never,
                overscrollBehavior: "contain" as never,
              }}
            >
              {mainEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onDecision={event.decision ? (input) => handleDecision(event.id, input) : undefined}
                  onQuote={handleQuote}
                  onSaveObsidian={(text) => handleSaveObsidian(text, event)}
                />
              ))}
              {mainEvents.length === 0 && (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)", opacity: 0.5 }}>
                  <div style={{ marginBottom: 16 }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{t("mc.waitingActivity")}</div>
                  <div style={{ fontSize: 12, marginTop: 8, opacity: 0.7 }}>
                    {t("mc.swipeToSwitch")}
                  </div>
                </div>
              )}
            </div>

            <QuickActions onAction={sendInput} />
            <InputBar
              onSend={handleSendCommand}
              autoFocus={isMobile}
              slashCommands={agent?.slashCommands}
              onBrowse={() => setShowBrowser(true)}
              prefill={quotedText}
              onPrefillConsumed={() => setQuotedText("")}
            />
          </div>

          {/* ════ Panel 2: Detail (Thinking / Code / Tools) ════ */}
          <div style={{ width: "100vw", flexShrink: 0, height: "100%", display: "flex", flexDirection: "column" }}>
            {/* Header + Tabs */}
            <div style={{
              padding: "12px 16px",
              paddingTop: "calc(12px + env(safe-area-inset-top, 0px))",
              background: "var(--glass-bg)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              borderBottom: "1px solid var(--glass-border)",
              boxShadow: "var(--glass-shadow)",
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <button onClick={() => goToPanel(1)} style={glassBtn}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: "var(--text-primary)", letterSpacing: -0.3 }}>
                  {t("detail.title")}
                </div>
              </div>
              {/* Tab bar */}
              <div style={{
                display: "flex", gap: 4, padding: 3, borderRadius: 10,
                background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
              }}>
                {([
                  { id: "thinking" as const, label: t("detail.thinking"), blocks: parsedBlocks.filter(b => {
                    if (b.type !== "thinking" && b.type !== "text") return false
                    const c = b.content.trim()
                    if (c.length < 4) return false
                    if (/[─━═┄┈╌╍┅┉▬▭▮▯│┃┆┊╎║╏┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬·]/.test(c)) return false
                    if (/…/.test(c)) return false
                    if (/claude|anthropic|sonnet|opus|haiku/i.test(c)) return false
                    if (/v\d+\.\d+/i.test(c)) return false
                    if (/remote.control|is active|Code in CLI|mcp|needs?\s+auth|session_/i.test(c)) return false
                    if (/powershell|著作權|microsoft|copyright/i.test(c)) return false
                    if (/https?:\/\//i.test(c)) return false
                    if (/[A-Z]:\\[\w\\]/i.test(c)) return false
                    if (/~[\\\/]\w/.test(c)) return false
                    if (/\d+\s*tokens?/i.test(c)) return false
                    if (/thinking|whirring/i.test(c)) return false
                    if (/plan\s+mode|shift\+tab/i.test(c)) return false
                    if (/^[❯>$%#]/.test(c)) return false
                    if (/^\/\w/.test(c)) return false
                    return true
                  }) },
                  { id: "code" as const, label: t("detail.code"), blocks: parsedBlocks.filter(b => b.type === "code" || b.type === "diff") },
                  { id: "tools" as const, label: t("detail.tools"), blocks: parsedBlocks.filter(b => b.type === "tool") },
                ]).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setDetailTab(tab.id)}
                    style={{
                      flex: 1, padding: "7px 6px", borderRadius: 8, border: "none",
                      background: detailTab === tab.id ? "var(--accent-primary)" : "transparent",
                      color: detailTab === tab.id ? "#fff" : "var(--text-secondary)",
                      fontSize: 12, fontWeight: detailTab === tab.id ? 700 : 500,
                      cursor: "pointer", transition: "all 0.2s",
                    }}
                  >
                    {tab.label}
                    {tab.blocks.length > 0 && (
                      <span style={{
                        marginLeft: 4, fontSize: 10, padding: "1px 5px", borderRadius: 6,
                        background: detailTab === tab.id ? "rgba(255,255,255,0.2)" : "var(--glass-bg)",
                      }}>
                        {tab.blocks.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Block content */}
            {(() => {
              const activeBlocks = (() => {
                if (detailTab === "code") return parsedBlocks.filter(b => b.type === "code" || b.type === "diff")
                if (detailTab === "tools") return parsedBlocks.filter(b => b.type === "tool")
                return parsedBlocks
                  .filter(b => b.type === "thinking" || b.type === "text")
                  .filter(b => {
                    const c = b.content.trim()
                    if (c.length < 4) return false
                    if (/[─━═┄┈╌╍┅┉▬▭▮▯│┃┆┊╎║╏┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬·]/.test(c)) return false
                    if (/…/.test(c)) return false
                    if (/claude|anthropic|sonnet|opus|haiku/i.test(c)) return false
                    if (/v\d+\.\d+/i.test(c)) return false
                    if (/remote.control|is active|Code in CLI|mcp|needs?\s+auth|session_/i.test(c)) return false
                    if (/powershell|著作權|microsoft|copyright/i.test(c)) return false
                    if (/https?:\/\//i.test(c)) return false
                    if (/[A-Z]:\\[\w\\]/i.test(c)) return false
                    if (/~[\\\/]\w/.test(c)) return false
                    if (/\d+\s*tokens?/i.test(c)) return false
                    if (/thinking|whirring/i.test(c)) return false
                    if (/plan\s+mode|shift\+tab/i.test(c)) return false
                    if (/^[❯>$%#]/.test(c)) return false
                    if (/^\/\w/.test(c)) return false
                    return true
                  })
              })()
              return (
                <div style={{ flex: 1, overflowY: "auto", padding: 16, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  {activeBlocks.map((block, i) => (
                    <div
                      key={i}
                      style={{
                        padding: 14, borderRadius: 14,
                        background: "var(--glass-bg)",
                        backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
                        border: "1px solid var(--glass-border)",
                        boxShadow: "var(--glass-shadow)",
                      }}
                    >
                      <pre style={{
                        margin: 0, fontSize: 12,
                        fontFamily: "'JetBrains Mono', monospace",
                        color: "var(--text-primary)",
                        whiteSpace: "pre-wrap", wordBreak: "break-word",
                        lineHeight: 1.6,
                      }}>
                        {block.content}
                      </pre>
                      <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 8, opacity: 0.5 }}>
                        {new Date(block.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                  {activeBlocks.length === 0 && (
                    <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)", opacity: 0.5 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>
                        {detailTab === "thinking" && t("detail.noThinking")}
                        {detailTab === "code" && t("detail.noCode")}
                        {detailTab === "tools" && t("detail.noTools")}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Settings overlay — outside swipe container */}
      <SettingsSheet
        open={showSettings}
        settings={settings}
        agentId={agentId}
        onChange={handleSettingsChange}
        onClose={() => setShowSettings(false)}
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

      {/* ─── Session context menu (action sheet) ─── */}
      {contextSession && (() => {
        const s = activeSessions.find((x) => x.id === contextSession)
        if (!s) return null
        const isCurrent = s.id === sessionId
        const proj = projects.find((p) => p.id === s.projectId)
        const agentDef = AGENTS.find((a) => a.id === s.agentId)
        const label = sessionLabels[s.id]

        const actionRow = (opts: { icon: React.ReactNode; label: string; desc: string; color?: string; onClick: () => void }) => (
          <button
            onClick={opts.onClick}
            style={{
              display: "flex", alignItems: "center", gap: 16,
              width: "100%", padding: "14px 20px",
              background: "transparent", border: "none",
              color: opts.color || "var(--text-primary)",
              cursor: "pointer", textAlign: "left",
              transition: `all 0.2s ${SPRING}`,
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: "var(--icon-bg)", border: "1px solid var(--glass-border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, color: opts.color || "var(--text-primary)",
            }}>{opts.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{opts.label}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, marginTop: 2 }}>{opts.desc}</div>
            </div>
          </button>
        )

        return (
          <div
            onClick={() => setContextSession(null)}
            style={{
              position: "fixed", inset: 0, zIndex: 200,
              display: "flex", alignItems: "flex-end", justifyContent: "center",
              background: "rgba(0,0,0,0.45)",
              animation: "fadeSlideUp 0.2s ease-out",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%", maxWidth: 400, margin: "0 16px",
                paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
              }}
            >
              {/* Session info + options card */}
              <div style={{
                borderRadius: 20, overflow: "hidden",
                background: "var(--card-bg)",
                backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)",
                border: "1px solid var(--glass-border)",
                boxShadow: "var(--glass-shadow)",
              }}>
                {/* Session header */}
                <div style={{
                  padding: "20px 20px 14px",
                  borderBottom: "1px solid var(--glass-border)",
                  display: "flex", alignItems: "center", gap: 14,
                }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 14,
                    background: "var(--icon-bg)", border: "1px solid var(--glass-border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, color: "var(--text-primary)",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                    position: "relative",
                  }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                    <div style={{
                      position: "absolute", bottom: -2, right: -2,
                      width: 10, height: 10, borderRadius: "50%",
                      background: "#4ade80", boxShadow: "0 0 6px #4ade80",
                      border: "2px solid var(--card-bg)",
                    }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>
                      {label || (proj?.name || s.projectId)}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500, marginTop: 2 }}>
                      {agentDef?.name || s.agentId}
                      {label && <span style={{ opacity: 0.7 }}> · {proj?.name || s.projectId}</span>}
                      {isCurrent && <span style={{ color: "var(--accent-primary)", marginLeft: 6 }}>{t("mc.inUse")}</span>}
                    </div>
                  </div>
                </div>

                {/* Action rows */}
                <div style={{ padding: "6px 0" }}>
                  {!isCurrent && actionRow({
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>,
                    label: t("mc.switch"),
                    desc: t("mc.switchDesc"),
                    onClick: () => { onSwitchSession(s.id); goToPanel(1); setContextSession(null) },
                  })}
                  {actionRow({
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>,
                    label: t("mc.openTerminal"),
                    desc: t("mc.openTerminalDesc"),
                    onClick: () => { onOpenSessionTerminal(s.id); setContextSession(null) },
                  })}
                  {actionRow({
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
                    label: t("mc.rename"),
                    desc: t("mc.renameDesc"),
                    onClick: () => { setRenameValue(label || ""); setRenamingSession(s.id); setContextSession(null) },
                  })}
                  <div style={{ height: 1, margin: "2px 20px", background: "var(--glass-border)" }} />
                  {actionRow({
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>,
                    label: t("mc.killSession"),
                    desc: t("mc.killSessionDesc"),
                    color: "#ef4444",
                    onClick: () => {
                      onKillSession(s.id)
                      setContextSession(null)
                      if (isCurrent) onBack()
                    },
                  })}
                </div>
              </div>

              {/* Cancel button */}
              <button
                onClick={() => setContextSession(null)}
                style={{
                  width: "100%", marginTop: 10,
                  padding: "16px", borderRadius: 20,
                  border: "1px solid var(--glass-border)",
                  background: "var(--card-bg)",
                  backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)",
                  boxShadow: "var(--glass-shadow)",
                  color: "var(--text-primary)",
                  fontSize: 16, fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                {t("mc.cancelAction")}
              </button>
            </div>
          </div>
        )
      })()}

      {/* ─── Rename dialog ─── */}
      {renamingSession && (
        <div
          onClick={() => setRenamingSession(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 250,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.45)",
            animation: "fadeSlideUp 0.2s ease-out",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "calc(100% - 40px)", maxWidth: 360,
              padding: 24, borderRadius: 20,
              background: "var(--card-bg)",
              backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)",
              border: "1px solid var(--glass-border)",
              boxShadow: "var(--glass-shadow)",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: "var(--text-primary)" }}>
              {t("mc.renameSession")}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, fontWeight: 500 }}>
              {t("mc.renameSessionLabel")}
            </div>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSessionLabelStorage(renamingSession, renameValue.trim())
                  setSessionLabels(getSessionLabels())
                  setRenamingSession(null)
                }
              }}
              placeholder={t("mc.sessionLabelPlaceholder")}
              style={{
                width: "100%", padding: "14px 16px", borderRadius: 14,
                border: "1px solid var(--glass-border)",
                background: "var(--icon-bg)",
                color: "var(--text-primary)",
                fontSize: 15, outline: "none", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button
                onClick={() => setRenamingSession(null)}
                style={{
                  flex: 1, padding: "12px", borderRadius: 14,
                  border: "1px solid var(--glass-border)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >
                {t("mc.cancelAction")}
              </button>
              <button
                onClick={() => {
                  setSessionLabelStorage(renamingSession, renameValue.trim())
                  setSessionLabels(getSessionLabels())
                  setRenamingSession(null)
                }}
                style={{
                  flex: 1, padding: "12px", borderRadius: 14,
                  border: "none",
                  background: "var(--accent-primary)",
                  color: "#fff",
                  fontSize: 14, fontWeight: 700, cursor: "pointer",
                }}
              >
                {t("mc.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Shared button style ───
const glassBtn: React.CSSProperties = {
  width: 38, height: 38, borderRadius: 12,
  border: "1px solid var(--glass-border)",
  background: "var(--glass-bg)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  boxShadow: "var(--glass-shadow)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0,
}
