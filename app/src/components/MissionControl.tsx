// web/components/MissionControl.tsx
import { useState, useEffect, useRef, useCallback } from "react"
import type { Project, ProjectSettings, AppSession } from "../types"
import type { AgentEvent } from "../types"
import { AGENTS } from "../types"
import { getSettings, saveSettings, addRecentCommand, getApiBase } from "../lib/storage"
import { EventCard } from "./EventCard"
import { ProgressCard } from "./ProgressCard"
import type { AgentStatus } from "./StatusIndicator"
import { QuickActions } from "./QuickActions"
import { InputBar } from "./InputBar"
import { SettingsSheet } from "./SettingsSheet"
import { FileBrowser } from "./FileBrowser"
import { FilePreview } from "./FilePreview"
import { GitPanel } from "./GitPanel"
import { TaskBoard } from "./TaskBoard"
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
  const [showGit, setShowGit] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [previewFile, setPreviewFile] = useState<string | null>(null)
  // Multi-session activity tracking
  const [sessionActivity, setSessionActivity] = useState<Record<string, { title: string; status: string; unread: number }>>({})
  const [sessionProgress, setSessionProgress] = useState<Record<string, AgentEvent>>({})
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
  const showDangerBadge = (agentId === "claude" && settings.bypass) || (agentId === "codex" && settings.codexMode === "danger-full-access")

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
      awaitingReplyRef.current = false
      replyBufferRef.current = ""
      lastParsedBlockCountRef.current = 0
      lastUserInputRef.current = ""
      if (replyFlushTimerRef.current) {
        clearTimeout(replyFlushTimerRef.current)
        replyFlushTimerRef.current = null
      }
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
  // Capture assistant text output and emit one event when response settles.
  const awaitingReplyRef = useRef(false)
  const replyBufferRef = useRef("")
  const lastReplySignatureRef = useRef("")
  const lastParsedBlockCountRef = useRef(0)
  const lastUserInputRef = useRef("")
  const replyFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Rolling buffer for TUI detection (accumulates stripped output, capped at 8KB)
  const tuiBufferRef = useRef("")
  const lastTuiMenuTime = useRef(0)
  // AnsiParser for structured output blocks (thinking/code/tools)
  const parserRef = useRef(new AnsiParser())
  const [parsedBlocks, setParsedBlocks] = useState<OutputBlock[]>([])
  // Merged code/diff blocks (consecutive diffs within 10s combined into one)
  const mergedCodeBlocks = (() => {
    const raw = parsedBlocks.filter((b) => b.type === "code" || b.type === "diff")
    const merged: OutputBlock[] = []
    for (const b of raw) {
      const prev = merged[merged.length - 1]
      if (prev && prev.type === "diff" && b.type === "diff" && b.timestamp - prev.timestamp < 10000) {
        prev.content += "\n" + b.content
      } else {
        merged.push({ ...b })
      }
    }
    return merged
  })()
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
      // Clear dedup state so restored content isn't filtered out
      parseStateRef.current.seenTools.clear()
      scrollbackProcessedRef.current = false
      tuiBufferRef.current = ""
      lastTuiMenuTime.current = 0
      // Request scrollback only (not full re-attach which sends events_replay too)
      send({ type: "scrollback_request" })
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
    direction: "" as "" | "h" | "v" | "blocked",
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

  // Auto-scroll to bottom only if user is near bottom (not scrolled up reading history)
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (!el) return
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distFromBottom < 150) {
        el.scrollTop = el.scrollHeight
      }
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

  // ?????? Swipe gesture handlers ??????
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Don't start swipe tracking when touching interactive elements (buttons, inputs, textareas)
    const tag = (e.target as HTMLElement).closest("input, textarea")
    const x = e.touches[0].clientX
    const screenW = window.innerWidth
    // Block swipe tracking near screen edges (Android back gesture zones)
    const isEdge = x < 30 || x > screenW - 30
    dragRef.current = {
      startX: x, startY: e.touches[0].clientY,
      lastX: x, lastY: e.touches[0].clientY,
      direction: (tag || isEdge) ? "blocked" : "", isDragging: false, offset: 0, startTime: Date.now(),
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
    // Swipe-up ??open file browser (on main panel)
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

  // ?????? Settings ??????
  const handleSettingsChange = useCallback((newSettings: ProjectSettings) => {
    const prev = settings
    setSettings(newSettings)
    saveSettings(project.id, newSettings)

    // Send settings changes to running Claude session
    if (agentId === "claude") {
      // Model change ??/model <name>
      if (newSettings.model !== prev.model) {
        send({ type: "input", data: `/model ${newSettings.model}` })
        setTimeout(() => send({ type: "input", data: "\r" }), 50)
      }
      // Plan mode toggle ??shift+tab (\x1b[Z)
      if (newSettings.planMode !== prev.planMode) {
        send({ type: "input", data: "\x1b[Z" })
      }
      // Fast mode toggle ??/fast
      if (newSettings.fastMode !== prev.fastMode) {
        send({ type: "input", data: "/fast" })
        setTimeout(() => send({ type: "input", data: "\r" }), 50)
      }
    }
  }, [project.id, settings, agentId, send])

  const normalizeAssistantChunk = useCallback((raw: string): string => {
    const isCodex = agentId === "codex"
    const lastUserInput = lastUserInputRef.current
    const lines = raw.replace(/\r/g, "\n").split("\n")
    const filtered: string[] = []
    let skipTipContinuation = false

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue

      if (skipTipContinuation) {
        skipTipContinuation = false
        if (isCodex) continue
      }

      const promptMatch = line.match(/^[>\u203A\u276F\u00BB$%#]\s*(.*)$/)
      if (promptMatch) {
        const promptText = promptMatch[1]?.trim() || ""
        if (!promptText) continue
        if (lastUserInput && (promptText === lastUserInput || promptText.includes(lastUserInput))) continue
        if (isCodex) continue
      }

      if (/^(model:|directory:)\s*/i.test(line)) continue
      if (/^Tip:/i.test(line)) {
        skipTipContinuation = true
        continue
      }
      if (/^Run \/\w+/i.test(line)) continue
      if (/^[\w.-]+\s*[\u00B7\u2022]\s*\d+%\s*left/i.test(line)) continue
      if (/^\/model\b/i.test(line)) continue

      // Claude Code banner / status bar / resume noise filters
      if (/Claude Code v\d/i.test(line)) continue
      if (/Opus \d|Sonnet \d|Haiku \d|Claude Max|Claude Pro/i.test(line)) continue
      if (/^~\/|^[A-Z]:\\|^\/[a-z]/i.test(line) && line.length < 80 && !/\u25cf/.test(line)) continue
      if (/^\/resume\b|^\/doctor\b|^\/fast\b|Resume a previous/i.test(line)) continue
      if (/Found \d+ settings issue|0 tokens/i.test(line)) continue
      if (/plan mode on|shift\+tab to cycle/i.test(line)) continue
      if (/Resume Session \(\d+ of \d+\)/i.test(line)) continue
      if (/^Ctrl\+[A-Z]|^Enter to select/i.test(line)) continue
      if (/^\$ node -e/i.test(line)) continue

      if (isCodex) {
        if (/^OpenAI\s+Codex\b/i.test(line)) continue
        if (/\/model\s+to\s+change/i.test(line)) continue
        if (/included in your plan for free/i.test(line)) continue
        if (/let['’]s build together/i.test(line)) continue
        if (/gpt-[\w.-]*codex[\w\s.-]*[\u00B7\u2022]\s*\d+%\s*left/i.test(line)) continue
        if (/^[~\-]+$/.test(line)) continue
        if (lastUserInput && line === lastUserInput) continue
      }

      filtered.push(line)
    }

    return filtered.join("\n").trim()
  }, [agentId])

  const flushAssistantReplyEvent = useCallback(() => {
    if (replyFlushTimerRef.current) {
      clearTimeout(replyFlushTimerRef.current)
      replyFlushTimerRef.current = null
    }
    const cleaned = normalizeAssistantChunk(replyBufferRef.current)
    replyBufferRef.current = ""
    awaitingReplyRef.current = false
    if (cleaned.length < 16) return
    const signature = cleaned.slice(0, 200)
    if (signature === lastReplySignatureRef.current) return
    lastReplySignatureRef.current = signature
    setEvents((prev) => [...prev, {
      id: `asst_${Date.now()}` ,
      timestamp: Date.now(),
      type: "info" as const,
      status: "completed" as const,
      title: cleaned.length > 72 ? cleaned.slice(0, 72) + "..." : cleaned,
      detail: cleaned.length > 72 ? cleaned : undefined,
    }].slice(-200))
  }, [normalizeAssistantChunk])


  // ?????? Input ??????
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
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText)
        setEvents(prev => [...prev, {
          id: `err_${Date.now()}`, timestamp: Date.now(),
          type: "error" as const, status: "failed" as const,
          title: t("mc.uploadFailed") || "Image upload failed",
          detail: `${res.status}: ${errText.slice(0, 200)}`,
        }].slice(-200))
        return
      }
      const data = await res.json()
      // Show upload event with image thumbnail
      setEvents(prev => [...prev, {
        id: `img_${Date.now()}`, timestamp: Date.now(),
        type: "info" as const, status: "completed" as const,
        title: t("mc.imageUploaded") || "Image uploaded",
        detail: `__IMG__${base64}`,
        raw: "",
      }].slice(-200))
      // Send the file path to terminal and press Enter to submit it
      sendInput(data.path)
      setTimeout(() => sendInput("\r"), 50)
    } catch (err) {
      setEvents(prev => [...prev, {
        id: `err_${Date.now()}`, timestamp: Date.now(),
        type: "error" as const, status: "failed" as const,
        title: t("mc.uploadFailed") || "Image upload failed",
        detail: err instanceof Error ? err.message : "Network error",
      }].slice(-200))
    }
  }, [project.id, sendInput, t, setEvents])

  const handleSendCommand = useCallback((text: string) => {
    if (text === "\x03") { sendInput(text); return }
    if (text === "\r") { sendInput(text); return } // Enter key for TUI navigation
    const trimmedInput = text.trim()
    if (!trimmedInput) return
    lastUserInputRef.current = trimmedInput
    // Don't accumulate reply buffer for TUI commands — they produce menu rendering, not text replies
    const isTuiCommand = /^\/(resume|status)\b/i.test(trimmedInput)
    awaitingReplyRef.current = !isTuiCommand
    replyBufferRef.current = ""
    lastParsedBlockCountRef.current = parserRef.current.getBlocks().length
    if (replyFlushTimerRef.current) {
      clearTimeout(replyFlushTimerRef.current)
      replyFlushTimerRef.current = null
    }

    // Send text first, then Enter separately after a delay.
    // TUI apps like Claude Code process input as a stream ??if text+\r arrives
    // as one chunk, \r gets treated as a newline in the input buffer instead of
    // triggering submission. Splitting them ensures \r is handled as Enter.
    const sent = sendInput(text)
    if (!sent) {
      awaitingReplyRef.current = false
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
    // Claude Code slash commands (e.g. /resume) need time for autocomplete to render
    // before pressing Enter. Regular text needs only a short delay.
    const enterDelay = text.startsWith("/") ? 300 : 30
    setTimeout(() => sendInput("\r"), enterDelay)

    // For TUI commands like /resume, re-attach ONCE after TUI renders to get scrollback.
    // Live ANSI parsing is unreliable due to cursor positioning.
    // Scrollback parsing is proven reliable (works on app restart).
    // Title-based dedup prevents event flooding from repeated scrollback.
    if (/^\/(resume|status)$/i.test(text.trim())) {
      scrollbackProcessedRef.current = false
      tuiBufferRef.current = ""
      lastTuiMenuTime.current = 0
    }

    // Insert user message as event for message-output correspondence
    setEvents(prev => [...prev, {
      id: `usr_${Date.now()}`,
      timestamp: Date.now(),
      type: "info" as const,
      status: "completed" as const,
      title: text.length > 60 ? text.slice(0, 60) + "..." : text,
      detail: text.length > 60 ? text : undefined,
    }].slice(-200))

    setAgentStatus("working")
    promptReadyRef.current = false  // Reset so idle timer doesn't fire until next prompt

    addRecentCommand(project.id, text)
  }, [sendInput, project.id])

  const handleDecision = useCallback((eventId: string, input: string) => {
    // For inputs with escape sequences (menu arrow navigation), send each key separately
    // TUI needs ~150ms between keys to re-render (30ms was too fast)
    const parts = input.match(/\x1b\[[A-Z]|\x1b|\r|[^\x1b\r]+/g) || [input]
    parts.forEach((part, i) => {
      setTimeout(() => sendInput(part), i * 150)
    })
    setEvents((prev) =>
      prev.map((e) => e.id === eventId ? { ...e, status: "completed" as const, _selectedInput: input } as any : e)
    )
    // Clear dedup state + allow fresh scrollback parsing for restored session content
    parseStateRef.current.seenTools.clear()
    tuiBufferRef.current = ""
    scrollbackProcessedRef.current = false
    // Request scrollback after session restore completes
    // reparse: true tells server to re-parse scrollback for events (tool calls, responses)
    // Two attempts: 3s (quick resume) and 8s (slow restore)
    setTimeout(() => {
      parseStateRef.current.seenTools.clear()
      scrollbackProcessedRef.current = false
      send({ type: "scrollback_request", reparse: true })
    }, 3000)
    setTimeout(() => {
      parseStateRef.current.seenTools.clear()
      scrollbackProcessedRef.current = false
      send({ type: "scrollback_request", reparse: true })
    }, 8000)
  }, [sendInput, send, project.id, agentId, sessionId])

  // ?????? Quote: prepend quoted text to next command ??????
  const [quotedText, setQuotedText] = useState("")
  const handleQuote = useCallback((text: string) => {
    setQuotedText(`> ${text}\n`)
    if (navigator.vibrate) navigator.vibrate(20)
  }, [])

  // ?????? Save to Obsidian with auto-categorization ??????
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

  // ?????? WS messages ??????
  useEffect(() => {
    const unsubs: (() => void)[] = []

    // Server-side events (from ParseEngine adapter)
    unsubs.push(on("event", (msg) => {
      const event = msg.event as AgentEvent
      if (!event) return
      // Filter tool events ??those belong in Details > Tools panel
      // No filtering — all events from server are meaningful (JSONL watcher + parse engine)
      setEvents(prev => {
        const existingIds = new Set(prev.map(e => e.id))
        if (existingIds.has(event.id)) return prev
        // For decision_request (e.g. Resume Session), check dedup by title
        if (event.type === "decision_request" && event.status === "waiting") {
          const existing = prev.find(e =>
            e.type === "decision_request" && e.status === "waiting" && e.title === event.title)
          if (existing) return prev
        }
        // Content dedup: "Claude responded" detail vs scrollback event title (same text, different source)
        const evtDetail = event.detail?.slice(0, 40) || ""
        const evtTitle = (event.title || "").slice(0, 40)
        for (const e of prev) {
          const pTitle = (e.title || "").slice(0, 40)
          const pDetail = (e.detail || "").slice(0, 40)
          if (evtTitle && pTitle && evtTitle === pTitle) return prev
          if (evtDetail && pTitle && evtDetail === pTitle) return prev
          if (evtTitle && pDetail && evtTitle === pDetail) return prev
        }
        return [...prev, event].slice(-100)
      })
      if (event.type === "decision_request" && event.status === "waiting") {
        setAgentStatus("waiting")
        if (navigator.vibrate) navigator.vibrate([200, 100, 200])
      }
      // Track last progress report for current session
      if (event.type === "progress_report" && event.progress && sessionId) {
        setSessionProgress(prev => ({ ...prev, [sessionId]: event }))
      }
    }))

    // Replay stored events on re-attach (from server adapter)
    unsubs.push(on("events_replay", (msg) => {
      const replayed = (msg.events as AgentEvent[]) || []
      const filtered = replayed
      if (filtered.length > 0) {
        // Merge server events with any client-side events (dedupe by id)
        setEvents(prev => {
          const existingIds = new Set(prev.map(e => e.id))
          const newEvents = filtered.filter(e => !existingIds.has(e.id))
          if (newEvents.length === 0) return prev
          return [...prev, ...newEvents]
        })
        const latest = filtered[filtered.length - 1]
        if (latest?.type === "decision_request" && latest.status === "waiting") {
          setAgentStatus("waiting")
        } else if (latest?.status === "in_progress") {
          setAgentStatus("working")
        }
      }
    }))
    unsubs.push(on("output", (msg) => {
      const data = msg.data as string
      const isPrompt = /(?:[$%>#]|[\u203A\u276F\u00BB])\s*$/.test(data)
      if (isPrompt) promptReadyRef.current = true
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)

      const stripped = data
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
        .replace(/[\x00-\x08\x0b-\x1f]/g, "")
      const text = stripped.trim()

      if (!isPrompt && text.length > 10) setAgentStatus("working")

      if (/(?:\(y\/n\/a\)|\(y\/n\))/i.test(text) && /(allow|approve|permission)/i.test(text)) {
        const detail = text.replace(/[\r\n]+/g, " ").trim().slice(0, 200)
        setEvents((prev) => [...prev, {
          id: `perm_${Date.now()}`,
          timestamp: Date.now(),
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
        }].slice(-200))
        setAgentStatus("waiting")
      }

      parserRef.current.feed(data)
      setParsedBlocks(parserRef.current.getBlocks())

      const blocks = parserRef.current.getBlocks()
      const newBlocks = blocks.slice(lastParsedBlockCountRef.current)
      lastParsedBlockCountRef.current = blocks.length

      if (awaitingReplyRef.current) {
        const blockChunk = newBlocks
          .filter((b) => b.type === "response" || b.type === "text")
          .map((b) => b.content)
          .join("\n")
        const rawCandidate = blockChunk || (agentId === "codex" ? "" : text)
        const candidate = normalizeAssistantChunk(rawCandidate)
        if (candidate && !replyBufferRef.current.includes(candidate)) {
          replyBufferRef.current = replyBufferRef.current
            ? `${replyBufferRef.current}\n${candidate}`
            : candidate
        }
        if (replyFlushTimerRef.current) clearTimeout(replyFlushTimerRef.current)
        replyFlushTimerRef.current = setTimeout(() => {
          flushAssistantReplyEvent()
        }, 900)
      }

      if (isPrompt && awaitingReplyRef.current) {
        flushAssistantReplyEvent()
      }

      const inMatch = text.match(/input[:\s]+(\d[\d,]*)\s*tokens?/i)
      const outMatch = text.match(/output[:\s]+(\d[\d,]*)\s*tokens?/i)
      if (inMatch || outMatch) {
        setUsageTokens((prev) => {
          const newInput = inMatch ? Math.max(prev.input, parseInt(inMatch[1].replace(/,/g, ""), 10)) : prev.input
          const newOutput = outMatch ? Math.max(prev.output, parseInt(outMatch[1].replace(/,/g, ""), 10)) : prev.output
          const deltaIn = newInput - prev.input
          const deltaOut = newOutput - prev.output
          if (deltaIn > 0) projectTotalTokens.current.input += deltaIn
          if (deltaOut > 0) projectTotalTokens.current.output += deltaOut
          return { input: newInput, output: newOutput }
        })
      }

      idleTimerRef.current = setTimeout(() => {
        if (promptReadyRef.current) setAgentStatus("idle")
      }, 1500)
    }))

    unsubs.push(on("scrollback", (msg) => {
      const data = msg.data as string
      if (!data) return
      parserRef.current.feed(data)
      setParsedBlocks(parserRef.current.getBlocks())
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

    // Multi-session activity tracking
    unsubs.push(on("session_activity", (msg) => {
      const sid = msg.sessionId as string
      if (sid === sessionId) return // ignore current session
      setSessionActivity((prev) => ({
        ...prev,
        [sid]: {
          title: msg.eventTitle as string || "",
          status: msg.agentStatus as string || "working",
          unread: (prev[sid]?.unread || 0) + 1,
        },
      }))
    }))

    // Track WS connection status + re-attach session on reconnect
    // Worktree operation results
    unsubs.push(on("worktree_result", (msg) => {
      const success = msg.success as boolean
      const message = msg.message as string
      setEvents(prev => [...prev, {
        id: `wt_${Date.now()}`, timestamp: Date.now(),
        type: "info" as const,
        status: success ? "completed" as const : "failed" as const,
        title: success ? message : (t("mc.worktreeFailed") + ": " + message),
      }].slice(-200))
    }))

    unsubs.push(on("__ws_open__", () => {
      setWsConnected(true)
      // Re-attach to session so server restores WS??????????ion mapping
      if (sessionId) {
        send({ type: "attach", projectId: project.id, agentId, sessionId })
      }
    }))
    unsubs.push(on("__ws_close__", () => setWsConnected(false)))

    return () => {
      for (const u of unsubs) u()
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
      if (replyFlushTimerRef.current) {
        clearTimeout(replyFlushTimerRef.current)
        replyFlushTimerRef.current = null
      }
    }
  }, [on, send, agent, settings, project.id, agentId, sessionId, t, normalizeAssistantChunk, flushAssistantReplyEvent])

  // Android back button ??close overlays first
  useEffect(() => {
    const handler = (e: Event) => {
      if (previewFile) { setPreviewFile(null); e.preventDefault(); return }
      if (showGit) { setShowGit(false); e.preventDefault(); return }
      if (showTasks) { setShowTasks(false); e.preventDefault(); return }
      if (renamingSession) { setRenamingSession(null); e.preventDefault(); return }
      if (contextSession) { setContextSession(null); e.preventDefault(); return }
      if (showBrowser) { setShowBrowser(false); e.preventDefault(); return }
      if (showSettings) { setShowSettings(false); e.preventDefault(); return }
      // Detail panel (panel 2) ??go back to main (panel 1)
      if (panel !== 1) { goToPanel(1); e.preventDefault(); return }
    }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [showBrowser, showSettings, contextSession, renamingSession, panel, goToPanel])

  // TerminalView (always mounted) handles attach + auto-command.
  // MissionControl just listens for WS messages ??no attach needed.

  // ?????? Filtered events: only well-defined actions (no text accumulator noise) ??????
    const mainEvents = events.filter((e) => {
    if (e.id.startsWith("usr_")) return true
    if (![
      "file_edit",
      "file_create",
      "file_delete",
      "command_run",
      "decision_request",
      "error",
      "test_result",
      "info",
      "response",
      "session_summary",
      "progress_report",
    ].includes(e.type)) return false
    if (!e.title && !e.detail) return false
    // Filter out noise from info events — keep only actionable/meaningful ones
    if (e.type === "info") {
      const t = e.title || ""
      const d = e.detail || ""
      const combined = t + " " + d
      // Noise: only skip truly useless status bar noise
      // NOTE: "Thinking..." and "Compacting context" are useful status — DO NOT filter them
      // Banner / status bar / TUI leak filter
      if (/Claude Code v\d/i.test(combined)) return false
      if (/Opus \d|Sonnet \d|Haiku \d|Claude Max|Claude Pro/i.test(combined)) return false
      if (/Resume Session \(\d+ of \d+\)/i.test(combined)) return false
      if (/plan mode on|shift\+tab to cycle/i.test(combined)) return false
      if (/Found \d+ settings issue|0 tokens/i.test(combined)) return false
      if (/^\$ node -e/i.test(t)) return false
    }
    return true
  })
return (
    <>
      {/* Status indicator overlay ??only when working/waiting */}
      {(agentStatus === "working" || agentStatus === "waiting") && (
        <div style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          pointerEvents: "none",
          animation: theme === "dark" ? "borderGlowBlue 2.5s ease-in-out infinite" : "borderGlowBlueLight 2.5s ease-in-out infinite",
          boxShadow: theme === "dark"
            ? "inset 0 0 20px 2px rgba(96,165,250,0.15), inset 0 0 5px 1px rgba(96,165,250,0.25)"
            : "inset 0 0 12px 2px rgba(255,127,80,0.2), inset 0 0 4px 1px rgba(255,127,80,0.3)",
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
        {/* ?????? 3-Panel Slider ?????? */}
        <div
          ref={slideRef}
          style={{
            display: "flex",
            height: "100%",
            willChange: "transform",
          }}
        >
          {/* ?????? Panel 0: Sessions ?????? */}
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
                      if (!isCurrent) {
                        // Clear unread count for this session
                        setSessionActivity((prev) => {
                          const copy = { ...prev }
                          if (copy[s.id]) copy[s.id] = { ...copy[s.id], unread: 0 }
                          return copy
                        })
                        onSwitchSession(s.id); goToPanel(1)
                      }
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
                    {/* Icon box ??48x48, matches LaunchPad */}
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
                      {/* Live dot ??shows activity status */}
                      {(() => {
                        const activity = sessionActivity[s.id]
                        const dotColor = isCurrent ? "var(--accent-primary)"
                          : activity?.status === "working" ? "#4ade80"
                          : activity?.status === "waiting" ? "#fbbf24"
                          : "#94a3b8"
                        const shouldPulse = !isCurrent && (activity?.status === "working" || activity?.status === "waiting")
                        return (
                          <div style={{
                            position: "absolute", bottom: -2, right: -2,
                            width: 10, height: 10, borderRadius: "50%",
                            background: dotColor,
                            boxShadow: `0 0 6px ${dotColor}`,
                            border: "2px solid var(--card-bg)",
                            animation: shouldPulse ? "pulse 2s ease-in-out infinite" : "none",
                          }} />
                        )
                      })()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
                        {label || (proj?.name || s.projectId)}
                        {isCurrent && <span style={{ fontSize: 11, color: "var(--accent-primary)", fontWeight: 500 }}>{t("mc.current")}</span>}
                        {/* Unread badge */}
                        {!isCurrent && sessionActivity[s.id]?.unread > 0 && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
                            background: "#ef4444", color: "#fff", lineHeight: "16px",
                          }}>
                            {sessionActivity[s.id].unread > 99 ? "99+" : sessionActivity[s.id].unread}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>
                        {agentDef?.name || s.agentId}
                        {label && <span style={{ opacity: 0.7 }}> ??{proj?.name || s.projectId}</span>}
                      </div>
                      {/* Inline progress summary */}
                      {(() => {
                        const prog = sessionProgress[s.id]?.progress
                        if (!prog) {
                          // Fallback to last event title
                          if (!isCurrent && sessionActivity[s.id]?.title) {
                            return (
                              <div style={{
                                fontSize: 11, color: "var(--text-secondary)", fontWeight: 500,
                                marginTop: 4, opacity: 0.6,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}>
                                {sessionActivity[s.id].title}
                              </div>
                            )
                          }
                          return null
                        }
                        const statusColor = prog.status === "done" ? "rgba(74,222,128,0.8)"
                          : prog.status === "blocked" ? "rgba(248,113,113,0.9)"
                          : "var(--accent-primary)"
                        return (
                          <div style={{
                            marginTop: 6, padding: "8px 10px",
                            background: "var(--icon-bg)",
                            border: "1px solid var(--glass-border)",
                            borderRadius: 10,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                              <div style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
                              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {prog.title}
                              </span>
                            </div>
                            <div style={{ fontSize: 10, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {prog.summary}
                            </div>
                          </div>
                        )
                      })()}
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

          {/* ?????? Panel 1: Main MissionControl ?????? */}
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
                  const prefix = showProjectUsage ? "??" : ""
                  if (tokens.input > 0 || tokens.output > 0) {
                    const fmtIn = tokens.input >= 1000 ? `${(tokens.input / 1000).toFixed(1)}k` : `${tokens.input}`
                    const fmtOut = tokens.output >= 1000 ? `${(tokens.output / 1000).toFixed(1)}k` : `${tokens.output}`
                    return `${prefix}??${fmtIn}  ??${fmtOut}`
                  }
                  return "Usage"
                })()}
              </button>
              {showDangerBadge && (
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
              {/* Git button with badge */}
              <button onClick={() => setShowGit(true)} onTouchStart={(e) => e.stopPropagation()} style={{ ...glassBtn, position: "relative" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
              </button>
              {/* Tasks button */}
              <button onClick={() => setShowTasks(true)} onTouchStart={(e) => e.stopPropagation()} style={glassBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                </svg>
              </button>
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

            {/* ?????? Status indicator (hidden when keyboard open to save space) ?????? */}
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

            {/* Page indicator ??3 panels (hidden when keyboard open) */}
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

            {/* Event stream ??independent scrollable area, newest at bottom */}
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
                event.type === "progress_report" ? (
                  <ProgressCard
                    key={event.id}
                    event={event}
                    onNextStep={(step) => handleSendCommand(step)}
                  />
                ) : (
                  <EventCard
                    key={event.id}
                    event={event}
                    onDecision={event.decision ? (input) => handleDecision(event.id, input) : undefined}
                    onQuote={handleQuote}
                    onSaveObsidian={(text) => handleSaveObsidian(text, event)}
                    onViewDiff={onEventDiff}
                  />
                )
              ))}
              {mainEvents.length === 0 && (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)", opacity: 0.5 }}>
                  <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}>
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

            {/* Input area ??padded above keyboard */}
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

          {/* ?????? Panel 2: Detail (Thinking / Code / Tools) ?????? */}
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
                  { id: "thinking" as const, label: t("detail.thinking"), count: parsedBlocks.filter(b => b.type === "thinking" || b.type === "response").length },
                  { id: "code" as const, label: "Diff", count: events.filter(e => e.type === "file_edit" || e.type === "file_create").length || parsedBlocks.filter(b => b.type === "tool" && /(?:Edit|Write)\(/.test(b.content)).length || mergedCodeBlocks.length },
                  { id: "tools" as const, label: t("detail.tools"), count: parsedBlocks.filter(b => b.type === "tool").length },
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
                    {tab.count > 0 && (
                      <span style={{
                        marginLeft: 4, fontSize: 10, padding: "1px 5px", borderRadius: 6,
                        background: detailTab === tab.id ? "rgba(255,255,255,0.2)" : "var(--glass-bg)",
                      }}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Block content */}
            {detailTab === "code" ? (() => {
              /* Diff tab ??file_edit events with DiffPanel, fallback to AnsiParser diff blocks */
              const fileEvents = events.filter(e => e.type === "file_edit" || e.type === "file_create")
              // Fallback: extract Edit/Write tool calls from AnsiParser tool blocks
              const toolEdits = fileEvents.length === 0
                ? parsedBlocks.filter(b => b.type === "tool" && /(?:Edit|Write)\(/.test(b.content)).map((b, i) => {
                    const pathMatch = b.content.match(/(?:Edit|Write)\(([^)]+)\)/)
                    return { id: `tb_${i}`, path: pathMatch?.[1] || "unknown", timestamp: b.timestamp, isWrite: /Write/.test(b.content) }
                  })
                : []
              const hasContent = fileEvents.length > 0 || toolEdits.length > 0 || mergedCodeBlocks.length > 0
              return (
                <div style={{ flex: 1, overflowY: "auto", padding: 16, minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Server-side file_edit events (with full diff data) */}
                  {fileEvents.map((evt) => (
                    <button
                      key={evt.id}
                      onClick={() => onEventDiff?.(evt)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 14px", borderRadius: 12,
                        background: "var(--glass-bg)",
                        border: "1px solid var(--glass-border)",
                        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                        cursor: "pointer", textAlign: "left", width: "100%",
                        transition: "all 0.2s",
                      }}
                    >
                      <span style={{ fontSize: 16, flexShrink: 0 }}>
                        {evt.type === "file_create" ? "+" : "-"}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 600, color: "var(--text-primary)",
                          fontFamily: "'JetBrains Mono', monospace",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {evt.diff?.filePath || evt.title?.replace(/^(Editing|Creating|Edited|Created)\s+/i, "")}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.6, marginTop: 2 }}>
                          {new Date(evt.timestamp).toLocaleTimeString()}
                          {evt.type === "file_create" && " ??new file"}
                        </div>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  ))}
                  {/* Fallback: tool-detected edits (no diff data, just file list) */}
                  {toolEdits.map((te) => (
                    <div key={te.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 14px", borderRadius: 12,
                      background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                    }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{te.isWrite ? "+" : "-"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {te.path}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.6, marginTop: 2 }}>
                          {new Date(te.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))}
                  {/* Final fallback: AnsiParser diff blocks (raw terminal diff) */}
                  {fileEvents.length === 0 && toolEdits.length === 0 && mergedCodeBlocks.map((block, i) => (
                    <div key={i} style={{
                      padding: 14, borderRadius: 14,
                      background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                      backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
                      boxShadow: "var(--glass-shadow)",
                    }}>
                      <pre style={{
                        margin: 0, fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                        color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6,
                      }}>
                        {block.content}
                      </pre>
                      <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 8, opacity: 0.5 }}>
                        {new Date(block.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                  {!hasContent && (
                    <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-secondary)", opacity: 0.5 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>
                        {t("detail.noCode") || "No file changes yet"}
                      </div>
                    </div>
                  )}
                </div>
              )
            })() : (() => {
              const activeBlocks = detailTab === "tools"
                ? parsedBlocks.filter(b => b.type === "tool")
                : parsedBlocks.filter(b => b.type === "thinking" || b.type === "response")
              return (
                <div
                  ref={(el) => {
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
                        {detailTab === "thinking" ? t("detail.noThinking") : t("detail.noTools")}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Settings overlay ??outside swipe container */}
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
        onPreviewFile={(path) => setPreviewFile(path)}
        initialPath={project.cwd}
      />

      <FilePreview
        open={previewFile !== null}
        filePath={previewFile}
        onClose={() => setPreviewFile(null)}
      />

      <GitPanel
        open={showGit}
        projectId={project.id}
        onClose={() => setShowGit(false)}
      />

      <TaskBoard
        open={showTasks}
        projectId={project.id}
        onClose={() => setShowTasks(false)}
        onStartTask={(desc) => {
          handleSendCommand(desc)
          setShowTasks(false)
        }}
        send={send}
      />

      {/* ?????? Session context menu (action sheet) ?????? */}
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
                      {label && <span style={{ opacity: 0.7 }}> ??{proj?.name || s.projectId}</span>}
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
                  {isCurrent && actionRow({
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9" /></svg>,
                    label: t("settings.title"),
                    desc: t("settings.model") + " / " + t("settings.mode"),
                    onClick: () => { setShowSettings(true); setContextSession(null) },
                  })}
                  {actionRow({
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>,
                    label: t("mc.watchOnComputer"),
                    desc: t("mc.watchOnComputerDesc"),
                    onClick: () => { send({ type: "start_watch", sessionId: s.id }); setContextSession(null) },
                  })}
                  <div style={{ height: 1, margin: "2px 20px", background: "var(--glass-border)" }} />
                  {actionRow({
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>,
                    label: t("mc.mergeWorktree"),
                    desc: t("mc.mergeWorktreeDesc"),
                    color: "#22c55e",
                    onClick: () => { send({ type: "merge_worktree", sessionId: s.id }); setContextSession(null) },
                  })}
                  {actionRow({
                    icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>,
                    label: t("mc.discardWorktree"),
                    desc: t("mc.discardWorktreeDesc"),
                    color: "#f59e0b",
                    onClick: () => { send({ type: "discard_worktree", sessionId: s.id }); setContextSession(null) },
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

      {/* ?????? Rename dialog ?????? */}
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

// ?????? Shared button style ??????
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
