// web/components/MissionControl.tsx
import { useState, useEffect, useRef, useCallback } from "react"
import type { Project, ProjectSettings, AppSession } from "../lib/types"
import type { AgentEvent } from "../../shared/types"
import { AGENTS } from "../lib/types"
import { getSettings, saveSettings, addRecentCommand, getApiBase } from "../lib/storage"
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
  onEventDiff?: (event: AgentEvent) => void
  onDiffEventsChange?: (events: AgentEvent[]) => void
  viewMode?: "board" | "terminal"
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
  onEventDiff,
  onDiffEventsChange,
  viewMode,
}: MissionControlProps) {
  const { t } = useLocale()
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle")
  const prevSessionIdRef = useRef(sessionId)
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
  const fullHeightRef = useRef(window.innerHeight)
  const keyboardH = Math.max(0, fullHeightRef.current - viewH)
  const scrollRef = useRef<HTMLDivElement>(null)
  const slideRef = useRef<HTMLDivElement>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const promptReadyRef = useRef(false)
  const scrollbackProcessedRef = useRef(false)
  const agent = AGENTS.find((a) => a.id === agentId)

  // Reset events when switching sessions
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId
      setEvents([])
      setAgentStatus("idle")
      parserRef.current = new AnsiParser()
      setParsedBlocks([])
      setUsageTokens({ input: 0, output: 0 })
      scrollbackProcessedRef.current = false
    }
  }, [sessionId])

  // Client-side event detection state (parses "output" WS messages directly)
  const parseStateRef = useRef({
    lastPermission: 0,
    lastTestResult: 0,
    seenTools: new Set<string>(),
    pending: "",
    isThinking: false,
  })
  // Rolling buffer for TUI detection (accumulates stripped output, capped at 8KB)
  const tuiBufferRef = useRef("")
  const lastTuiMenuTime = useRef(0)
  // AnsiParser for structured output blocks (thinking/code/tools)
  const parserRef = useRef(new AnsiParser())
  const [parsedBlocks, setParsedBlocks] = useState<OutputBlock[]>([])
  const [detailTab, setDetailTab] = useState<"thinking" | "code" | "tools">("thinking")
  // Cumulative token counter
  const [usageTokens, setUsageTokens] = useState<{ input: number; output: number }>({ input: 0, output: 0 })
  const [showProjectUsage, setShowProjectUsage] = useState(false)
  const projectTotalTokens = useRef<{ input: number; output: number }>({ input: 0, output: 0 })

  // When returning from terminal view to board, re-parse scrollback to catch
  // events that happened while user was in terminal (e.g. /resume session selection)
  const prevViewModeRef = useRef(viewMode)
  useEffect(() => {
    if (prevViewModeRef.current === "terminal" && viewMode === "board") {
      // Clear dedup state so restored session tool calls aren't filtered out
      parseStateRef.current.seenTools.clear()
      scrollbackProcessedRef.current = false
      tuiBufferRef.current = ""
      // Re-attach to get fresh scrollback and events
      send({ type: "attach", projectId: project.id, agentId, sessionId })
    }
    prevViewModeRef.current = viewMode
  }, [viewMode, send, project.id, agentId, sessionId])

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
    isDragging: false, offset: 0, startTime: 0,
  })

  // Track viewport height (keyboard-aware via visualViewport)
  useEffect(() => {
    const update = () => {
      const newH = window.visualViewport?.height ?? window.innerHeight
      setViewH(newH)
      // Only update fullHeight when height increases (keyboard closing, not opening)
      if (newH > fullHeightRef.current) fullHeightRef.current = newH
    }
    window.visualViewport?.addEventListener("resize", update)
    window.addEventListener("resize", update)
    return () => {
      window.visualViewport?.removeEventListener("resize", update)
      window.removeEventListener("resize", update)
    }
  }, [])

  // Auto-scroll to bottom when keyboard opens/closes
  useEffect(() => {
    if (keyboardH > 0) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
      })
    }
  }, [keyboardH])

  // Auto-scroll to bottom (newest at bottom, chat-style)
  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    })
  }, [events])

  // Report diff events to parent
  useEffect(() => {
    if (onDiffEventsChange) {
      const diffEvents = events.filter(e => e.diff)
      onDiffEventsChange(diffEvents)
    }
  }, [events, onDiffEventsChange])

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
      direction: "", isDragging: false, offset: 0, startTime: Date.now(),
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
      const threshold = window.innerWidth * 0.35
      const elapsed = Math.max(1, Date.now() - d.startTime)
      const velocity = Math.abs(d.offset) / elapsed // px/ms
      // Fast flick (>0.5 px/ms) needs only 60px; slow drag needs 35% screen width
      const triggered = Math.abs(d.offset) > threshold || (velocity > 0.5 && Math.abs(d.offset) > 60)
      let newPanel = panel
      if (triggered && d.offset > 0 && panel > 0) newPanel = panel - 1
      else if (triggered && d.offset < 0 && panel < 2) newPanel = panel + 1

      if (slideRef.current) {
        slideRef.current.style.transition = `transform 0.5s ${SPRING}`
        slideRef.current.style.transform = `translateX(${-newPanel * 100}vw)`
      }
      if (newPanel !== panel) setPanel(newPanel)
    }
    // Swipe-up → open file browser (on main panel)
    if (d.direction === "v" && panel === 1) {
      const endY = e.changedTouches[0]?.clientY ?? d.lastY
      const endX = e.changedTouches[0]?.clientX ?? d.lastX
      const dy = d.startY - endY
      const dx = Math.abs(endX - d.startX)
      // Higher threshold: 120px vertical, 40px horizontal tolerance, bottom 20% only
      if (dy > 120 && dx < 40 && d.startY > viewH * 0.80) {
        setShowBrowser(true)
      }
    }
    dragRef.current = { startX: 0, startY: 0, lastX: 0, lastY: 0, direction: "", isDragging: false, offset: 0, startTime: 0 }
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

  const handleImagePaste = useCallback(async (base64: string, filename: string) => {
    try {
      const res = await fetch(`${getApiBase()}/api/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, data: base64, filename }),
      })
      if (res.ok) {
        const data = await res.json()
        sendInput(data.path)
      }
    } catch {}
  }, [project.id, sendInput])

  const handleSendCommand = useCallback((text: string) => {
    if (text === "\x03") { sendInput(text); return }
    if (text === "\r") { sendInput(text); return } // Enter key for TUI navigation
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

    // For TUI commands like /resume, re-attach ONCE after TUI renders to get scrollback.
    // Live ANSI parsing is unreliable due to cursor positioning.
    // Scrollback parsing is proven reliable (works on app restart).
    // Title-based dedup prevents event flooding from repeated scrollback.
    if (/^\/(resume|status)$/i.test(text.trim())) {
      scrollbackProcessedRef.current = false // allow fresh scrollback parsing
      tuiBufferRef.current = "" // clear TUI buffer for fresh resume menu detection
      // Re-attach after TUI renders to parse scrollback for resume menu.
      // Two attempts: 2s (fast networks) and 5s (slow TUI render).
      // Dedup in scrollback handler prevents duplicate events.
      setTimeout(() => {
        scrollbackProcessedRef.current = false
        send({ type: "attach", projectId: project.id, agentId, sessionId })
      }, 2000)
      setTimeout(() => {
        scrollbackProcessedRef.current = false
        send({ type: "attach", projectId: project.id, agentId, sessionId })
      }, 5000)
    }

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
    // Clear dedup state + allow fresh scrollback parsing for restored session content
    parseStateRef.current.seenTools.clear()
    tuiBufferRef.current = ""
    scrollbackProcessedRef.current = false
    // Re-attach after decision to pick up restored session tool calls
    // Two attempts: 3s (quick resume) and 8s (slow restore)
    setTimeout(() => {
      parseStateRef.current.seenTools.clear()
      scrollbackProcessedRef.current = false
      send({ type: "attach", projectId: project.id, agentId, sessionId })
    }, 3000)
    setTimeout(() => {
      parseStateRef.current.seenTools.clear()
      scrollbackProcessedRef.current = false
      send({ type: "attach", projectId: project.id, agentId, sessionId })
    }, 8000)
  }, [sendInput, send, project.id, agentId, sessionId])

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
        // Merge server events with any client-side events (dedupe by id)
        setEvents(prev => {
          const existingIds = new Set(prev.map(e => e.id))
          const newEvents = replayed.filter(e => !existingIds.has(e.id))
          if (newEvents.length === 0) return prev
          return [...newEvents, ...prev].sort((a, b) => a.timestamp - b.timestamp)
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
      const isPrompt = /[$%>❯]\s*$/.test(data)
      if (isPrompt) promptReadyRef.current = true
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      // Only set "working" for substantial NEW content — NOT status bar redraws
      // Strip ANSI first to check actual visible content
      const visibleCheck = data
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b[78DMEHcn]/g, "")
        .replace(/\x1b\(B/g, "")
        .trim()
      const isStatusBar = /^[↑↓]\s*\d/.test(visibleCheck) || /^\d+s\s*·/.test(visibleCheck) ||
        /^\d+\s*tokens?/i.test(visibleCheck) || /^[✦✱∗∴]\s*[A-Z]/i.test(visibleCheck) ||
        /^thinking/i.test(visibleCheck) || /^thought\s+for/i.test(visibleCheck) ||
        /^\(\d+/.test(visibleCheck) || /^shift\+tab/i.test(visibleCheck)
      if (!isPrompt && !isStatusBar && visibleCheck.length > 10) setAgentStatus("working")

      // Strip ANSI for pattern matching
      // IMPORTANT: replace cursor positioning (\x1b[row;colH) with newline FIRST
      // so text from different screen positions doesn't concatenate directly
      // (critical for TUI menus like /resume where metadata is at fixed columns)
      const stripped = data
        .replace(/\x1b\[\d+;\d+H/g, "\n")
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b[78DMEHcn]/g, "")
        .replace(/\x1b\(B/g, "")
      const ps = parseStateRef.current
      const now = Date.now()
      const text = ps.pending + stripped
      ps.pending = ""

      const mkId = () => `c_${now}_${Math.random().toString(36).slice(2, 7)}`

      // ─── Tool call detection (for dedup + status tracking only) ───
      // Tool calls are shown in the Details > Tools panel via AnsiParser,
      // NOT in the main events panel.
      const toolRe = /●\s*(?:Read|Edit|Write|Bash|Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit|Skill|TaskCreate|TaskUpdate|TaskList|TaskGet)\(/
      const isToolCall = toolRe.test(text)
      if (isToolCall) {
        const sig = (text.match(toolRe)?.[0] || "").slice(0, 60)
        if (sig) {
          ps.seenTools.add(sig)
          if (ps.seenTools.size > 200) {
            const oldest = [...ps.seenTools].slice(0, 100)
            for (const k of oldest) ps.seenTools.delete(k)
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

      // ─── Interactive menu detection (numbered list + navigation hint OR ❯ cursor) ───
      if (/enter to select/i.test(text) || /\u2191\u2193\s*to navigate/i.test(text) || /\u276F\s*\d+\.\s/.test(text)) {
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

      // ─── TUI menu detection: /resume session picker ───
      // Accumulate stripped output into rolling buffer for multi-chunk TUI detection
      tuiBufferRef.current = (tuiBufferRef.current + stripped).slice(-8000)
      {
        const buf = tuiBufferRef.current
        // Use LAST occurrence (buffer may contain multiple /resume renders)
        const allMatches = [...buf.matchAll(/Resume Session\s*\((\d+)\s+(?:of\s+\d+|total)\)/gi)]
        const resumeMatch = allMatches.length > 0 ? allMatches[allMatches.length - 1] : null
        if (resumeMatch) {
          // Only search for session entries AFTER the LAST "Resume Session" header
          const headerEnd = (resumeMatch.index || 0) + resumeMatch[0].length
          const searchBuf = buf.slice(headerEnd)
          // Find "Search..." and start after it, or start from headerEnd
          const searchIdx = searchBuf.indexOf("Search...")
          const entriesBuf = searchIdx >= 0 ? searchBuf.slice(searchIdx + 9) : searchBuf

          // Parse session entries using metadata as anchors
          // Size restricted to digits+unit to avoid eating CJK chars.
          const metaRe = /(\d+\s+(?:minutes?|hours?|days?|seconds?)\s+ago)\s+[·•∙⋅]\s+(\S+)\s+[·•∙⋅]\s+(\d[\d.]*[KMGT]?B)/gi
          const metaMatches: { index: number; end: number; time: string; branch: string; size: string }[] = []
          let mm
          while ((mm = metaRe.exec(entriesBuf)) !== null) {
            metaMatches.push({ index: mm.index, end: mm.index + mm[0].length, time: mm[1], branch: mm[2], size: mm[3] })
          }
          // Build items: try to extract title between metadata entries,
          // but if title is empty (TUI cursor positioning ate it), use metadata as label
          const items: { label: string; meta: string; index: number }[] = []
          for (let i = 0; i < metaMatches.length; i++) {
            const prevEnd = i === 0 ? 0 : metaMatches[i - 1].end
            let title = entriesBuf.slice(prevEnd, metaMatches[i].index).replace(/[\x00-\x1f]/g, " ").trim()
            // Strip TUI box-drawing chars, cursor markers, bullets
            title = title.replace(/[─│┌┐└┘├┤┬┴┼╭╮╰╯╴╵╶╷━┃┏┓┗┛┣┫┳┻╋▀▄█▌▐░▒▓■□▪▫●○◆◇◈▲△▶▷◀◁∗✦✱∴❯→←↑↓↔↕⏎⎯]/g, " ")
            title = title.replace(/^[>\s·]+/, "").trim()
            title = title.replace(/^\d[\d.]*[KMGT]?B\s*/i, "").trim()
            if (/Resume Session|Search\.\.\.|Ctrl\+|Esc|enter to|navigate|PowerShell|Copyright|著作權/i.test(title)) title = ""
            // Skip /remote-control sessions — those are just AgentRune remote sessions
            if (/remote-control/i.test(title)) continue
            const meta = `${metaMatches[i].time} · ${metaMatches[i].branch} · ${metaMatches[i].size}`
            items.push({
              label: title.length > 3 ? title.slice(0, 60) : "",
              meta,
              index: i, // Use original TUI index for arrow key navigation
            })
          }
          // Cap at 8 options max
          const limitedItems = items.slice(0, 8)
          if (limitedItems.length > 0 && now - lastTuiMenuTime.current > 1000) {
            // Only set cooldown AFTER successfully finding items
            lastTuiMenuTime.current = now
            setEvents(prev => {
              // Don't duplicate if a waiting resume menu already exists
              const existing = prev.find(e =>
                e.type === "decision_request" && e.status === "waiting" && e.title?.includes("Resume Session"))
              if (existing) return prev
              return [...prev, {
                id: mkId(), timestamp: now,
                type: "decision_request" as const,
                status: "waiting" as const,
                title: `Resume Session (${resumeMatch[1]} total)`,
                decision: {
                  options: limitedItems.map((item) => ({
                    label: item.label ? `${item.label}\n${item.meta}` : item.meta,
                    input: "\x1b[B".repeat(item.index) + "\r",
                    style: "primary" as const,
                  })),
                },
              }].slice(-100)
            })
            setAgentStatus("waiting")
          }
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
        .replace(/\x1b\[\d+;\d+H/g, "\n")
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b[78DMEHcn]/g, "")
        .replace(/\x1b\(B/g, "")
      // Extract recent tool calls from scrollback (last 8000 chars)
      const tail = clean.slice(-8000)

      // Tool calls are shown in Details > Tools panel via AnsiParser.
      // From scrollback, extract Claude's text responses for the events panel.
      const shouldParse = !scrollbackProcessedRef.current
      scrollbackProcessedRef.current = true
      const now = Date.now()

      if (shouldParse) {
        // Find Claude's ● responses (NOT tool calls) from scrollback
        const toolCallRe = /●\s*(?:Read|Edit|Write|Bash|Glob|Grep|Agent|WebFetch|WebSearch|NotebookEdit|Skill|TaskCreate|TaskUpdate|TaskList|TaskGet)\(/
        const responseRe = /●\s*([^●\n]{5,})/g
        const responseEvents: AgentEvent[] = []
        let rm
        let idx = 0
        while ((rm = responseRe.exec(tail)) !== null) {
          // Skip tool call lines
          if (toolCallRe.test(rm[0])) continue
          let respText = rm[1]
            .replace(/[\x00-\x1f]/g, " ")
            .replace(/[✦✱∗∴*]\s*[A-Z][a-z]+(?:-[a-z]+)*…/g, "")
            .replace(/\(\d+\.?\d*s\s*·[^)]*\)?/g, "")
            .replace(/[↑↓]\s*\d[\d,]*\s*tokens?/gi, "")
            .replace(/thought\s+for\s+\d+s/gi, "")
            .replace(/\s{2,}/g, " ")
            .trim()
          if (respText.length > 5 && !/^thinking\.{0,3}$/i.test(respText) && !/^\d+\s*tokens/i.test(respText)) {
            responseEvents.push({
              id: `h_${now}_${idx++}`, timestamp: now - 10000 + idx * 100,
              type: "info",
              status: "completed",
              title: respText.length > 80 ? respText.slice(0, 80) + "…" : respText,
              detail: respText.length > 80 ? respText.slice(0, 400) : undefined,
            })
          }
        }
        if (responseEvents.length > 0) {
          const recent = responseEvents.slice(-10)
          setEvents(prev => {
            const existingTitles = new Set(prev.map(e => `${e.title}|${e.detail || ""}`))
            const newEvents = recent.filter(e => !existingTitles.has(`${e.title}|${e.detail || ""}`))
            if (newEvents.length === 0) return prev
            return [...newEvents, ...prev].sort((a, b) => a.timestamp - b.timestamp)
          })
        }
      }

      // ─── Resume TUI detection from scrollback (more reliable than live output) ───
      // Use the LAST occurrence (scrollback may contain multiple /resume renders)
      const allResumeMatches = [...tail.matchAll(/Resume Session\s*\((\d+)\s+(?:of\s+\d+|total)\)/gi)]
      const resumeMatch = allResumeMatches.length > 0 ? allResumeMatches[allResumeMatches.length - 1] : null
      if (resumeMatch) {
        const headerEnd = (resumeMatch.index || 0) + resumeMatch[0].length
        const searchBuf = tail.slice(headerEnd)
        const searchIdx = searchBuf.indexOf("Search...")
        const entriesBuf = searchIdx >= 0 ? searchBuf.slice(searchIdx + 9) : searchBuf
        const metaRe = /(\d+\s+(?:minutes?|hours?|days?|seconds?)\s+ago)\s+[·•∙⋅]\s+(\S+)\s+[·•∙⋅]\s+(\d[\d.]*[KMGT]?B)/gi
        const metaMatches: { index: number; end: number; time: string; branch: string; size: string }[] = []
        let smm
        while ((smm = metaRe.exec(entriesBuf)) !== null) {
          metaMatches.push({ index: smm.index, end: smm.index + smm[0].length, time: smm[1], branch: smm[2], size: smm[3] })
        }
        const resumeItems: { label: string; meta: string; index: number }[] = []
        for (let i = 0; i < metaMatches.length; i++) {
          const prevEnd = i === 0 ? 0 : metaMatches[i - 1].end
          let title = entriesBuf.slice(prevEnd, metaMatches[i].index).replace(/[\x00-\x1f]/g, " ").trim()
          title = title.replace(/[─│┌┐└┘├┤┬┴┼╭╮╰╯╴╵╶╷━┃┏┓┗┛┣┫┳┻╋▀▄█▌▐░▒▓■□▪▫●○◆◇◈▲△▶▷◀◁∗✦✱∴❯→←↑↓↔↕⏎⎯]/g, " ")
          title = title.replace(/^[>\s·]+/, "").trim()
          title = title.replace(/^\d[\d.]*[KMGT]?B\s*/i, "").trim()
          if (/Resume Session|Search\.\.\.|Ctrl\+|Esc|enter to|navigate|PowerShell|Copyright|著作權/i.test(title)) title = ""
          if (/remote-control/i.test(title)) continue
          const meta = `${metaMatches[i].time} · ${metaMatches[i].branch} · ${metaMatches[i].size}`
          resumeItems.push({ label: title.length > 3 ? title.slice(0, 60) : "", meta, index: i })
        }
        // Cap at 8 options max
        const limitedItems = resumeItems.slice(0, 8)
        if (limitedItems.length > 0) {
          const mkSId = () => `sb_${now}_${Math.random().toString(36).slice(2, 7)}`
          setEvents(prev => {
            const existing = prev.find(e => e.type === "decision_request" && e.status === "waiting" && e.title?.includes("Resume Session"))
            if (existing) return prev
            return [...prev, {
              id: mkSId(), timestamp: now,
              type: "decision_request" as const,
              status: "waiting" as const,
              title: `Resume Session (${resumeMatch[1]} total)`,
              decision: {
                options: limitedItems.map((item) => ({
                  label: item.label ? `${item.label}\n${item.meta}` : item.meta,
                  input: "\x1b[B".repeat(item.index) + "\r",
                  style: "primary" as const,
                })),
              },
            }].slice(-100)
          })
          setAgentStatus("waiting")
        }
      }
    }))
    // Show session start/resume event in Events panel (dedup within 10s)
    unsubs.push(on("attached", (msg) => {
      const resumed = msg.resumed as boolean
      const agentName = (msg.agentId as string) || "terminal"
      const title = resumed
        ? t("mc.sessionResumed") || `Session resumed (${agentName})`
        : t("mc.sessionStarted") || `Session started (${agentName})`
      setEvents((prev) => {
        const now = Date.now()
        const hasDupe = prev.some((e) =>
          e.type === "info" && e.title === title && (now - e.timestamp) < 30000
        )
        if (hasDupe) return prev
        return [...prev, {
          id: `evt_attach_${now}`, timestamp: now,
          type: "info" as const,
          status: "completed" as const,
          title,
        }]
      })
    }))
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
          animation: `${theme === "dark" ? "borderGlowDark" : "borderGlowLight"} 2.5s ease-in-out infinite`,
          boxShadow: theme === "dark"
            ? "inset 0 0 20px 2px rgba(255, 255, 255, 0.15), inset 0 0 5px 1px rgba(255, 255, 255, 0.25)"
            : "inset 0 0 20px 3px rgba(59, 130, 246, 0.4), inset 0 0 6px 1px rgba(59, 130, 246, 0.5)",
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
              <button onClick={() => goToPanel(1)} onTouchStart={(e) => e.stopPropagation()} style={glassBtn}>
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
              display: "flex", alignItems: "center", gap: 6,
              padding: "10px 12px",
              paddingTop: "calc(10px + env(safe-area-inset-top, 0px))",
              background: "var(--glass-bg)",
              backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
              borderBottom: "1px solid var(--glass-border)",
              boxShadow: "var(--glass-shadow)",
              flexShrink: 0, userSelect: "none",
            }}>
              <button onClick={onBack} onTouchStart={(e) => e.stopPropagation()} style={glassBtn}>
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
                onTouchStart={(e) => e.stopPropagation()}
                style={{
                  fontSize: 9, padding: "3px 7px", borderRadius: 8,
                  background: showProjectUsage ? "rgba(74,222,128,0.08)" : "rgba(96,165,250,0.08)",
                  border: showProjectUsage ? "1px solid rgba(74,222,128,0.2)" : "1px solid rgba(96,165,250,0.2)",
                  color: showProjectUsage ? "#4ade80" : "var(--accent-primary)", fontWeight: 600, letterSpacing: 0.2,
                  fontFamily: "'JetBrains Mono', monospace", cursor: "pointer", flexShrink: 0,
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
                <button onClick={() => { /* toggle in settings */ setShowSettings(true) }} onTouchStart={(e) => e.stopPropagation()} style={{ ...glassBtn, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)", color: "#f59e0b" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </button>
              )}
              {toggleTheme && (
                <button onClick={toggleTheme} onTouchStart={(e) => e.stopPropagation()} style={glassBtn}>
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
              <button onClick={onOpenTerminal} onTouchStart={(e) => e.stopPropagation()} style={glassBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </button>
              <button onClick={() => setShowSettings(true)} onTouchStart={(e) => e.stopPropagation()} style={glassBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </div>

            {/* ─── Status indicator (hidden when keyboard open to save space) ─── */}
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

            {/* Idle: green dot pill / Waiting: amber pill (hidden when keyboard open) */}
            {(agentStatus === "idle" || agentStatus === "waiting") && keyboardH === 0 && (
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

            {/* Page indicator — 3 panels (hidden when keyboard open) */}
            <div style={{ display: keyboardH === 0 ? "flex" : "none", justifyContent: "center", gap: 6, padding: "4px 0", flexShrink: 0 }}>
              {[t("mc.sessions"), t("mc.events"), t("mc.details")].map((label, i) => (
                <button
                  key={i}
                  onClick={() => goToPanel(i)}
                  onTouchStart={(e) => e.stopPropagation()}
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
                flex: 1, overflowY: "auto", overflowX: "hidden", padding: 16,
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
                  onViewDiff={onEventDiff}
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

            {/* Input area — padded above keyboard */}
            {keyboardH === 0 && <QuickActions onAction={sendInput} />}
            <InputBar
              onSend={handleSendCommand}
              onImagePaste={handleImagePaste}
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
                <button onClick={() => goToPanel(1)} onTouchStart={(e) => e.stopPropagation()} style={glassBtn}>
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
                <div
                  ref={(el) => {
                    // Auto-scroll detail panel to bottom when entering or new content arrives
                    if (el && panel === 2) {
                      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
                    }
                  }}
                  style={{ flex: 1, overflowY: "auto", padding: 16, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
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
  width: 32, height: 32, borderRadius: 10,
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
