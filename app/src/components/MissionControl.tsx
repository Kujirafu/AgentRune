// web/components/MissionControl.tsx
import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import type { Project, ProjectSettings, AppSession } from "../types"
import type { AgentEvent } from "../types"
import { AGENTS } from "../types"
import { getSettings, saveSettings, addRecentCommand, getApiBase, getAutoSaveKeysEnabled, getAutoSaveKeysPath } from "../lib/storage"
import { EventCard } from "./EventCard"
import { ProgressCard } from "./ProgressCard"
import type { AgentStatus } from "./StatusIndicator"
import { InputBar } from "./InputBar"
import type { SendFlags } from "./InputBar"
import { lazy, Suspense } from "react"
const SettingsSheet = lazy(() => import("./SettingsSheet").then(m => ({ default: m.SettingsSheet })))
const FileBrowser = lazy(() => import("./FileBrowser").then(m => ({ default: m.FileBrowser })))
const FilePreview = lazy(() => import("./FilePreview").then(m => ({ default: m.FilePreview })))
const GitPanel = lazy(() => import("./GitPanel").then(m => ({ default: m.GitPanel })))
import { TaskBoard } from "./TaskBoard"
import { PlanPanel } from "./PlanPanel"
import { PathBadge } from "./PathBadge"
const InsightSheet = lazy(() => import("./InsightSheet").then(m => ({ default: m.InsightSheet })))
import { isMobile } from "../lib/detect"
import { AnsiParser, type OutputBlock } from "../lib/ansi-parser"
import { useLocale } from "../lib/i18n/index.js"

// iOS-like spring curve
const SPRING = "cubic-bezier(0.32, 0.72, 0, 1)"

// Module-level: attached files survive unmount/remount
const _fileDrafts = new Map<string, string[]>()

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
  onVoice?: () => void
  onRequestVoiceRef?: React.MutableRefObject<((callback: (text: string) => void, label?: string) => void) | null>
  wsConnected?: boolean
  onLaunchSession?: (projectId: string, agentId: string) => void
  onOpenBuilder?: () => void
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
  onVoice,
  onRequestVoiceRef,
  wsConnected = false,
  onLaunchSession,
  onOpenBuilder,
}: MissionControlProps) {
  const { t, locale } = useLocale()
  const speechLang = locale === "zh-TW" ? "zh-TW" : "en-US"
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle")
  const [initializing, setInitializing] = useState(false)
  const prevSessionIdRef = useRef(sessionId)
  const [settings, setSettings] = useState<ProjectSettings>(() => getSettings(project.id))
  const [showSettings, setShowSettings] = useState(false)
  const [showBrowser, setShowBrowser] = useState(false)
  const [showInsight, setShowInsight] = useState(false)
  const [showGit, setShowGit] = useState(false)
  const [previewFile, setPreviewFile] = useState<string | null>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  // Multi-session activity tracking
  const [sessionActivity, setSessionActivity] = useState<Record<string, { title: string; status: string; unread: number }>>({})
  const [sessionProgress, setSessionProgress] = useState<Record<string, AgentEvent>>({})
  const [contextSession, setContextSession] = useState<string | null>(null)
  const [renamingSession, setRenamingSession] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [sessionLabels, setSessionLabels] = useState<Record<string, string>>(getSessionLabels)
  const [worktreeBranch, setWorktreeBranch] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const showToast = useCallback((msg: string, duration = 3000) => { setToast(msg); setTimeout(() => setToast(null), duration) }, [])
  const [bypassConfirmPending, setBypassConfirmPending] = useState(false)
  // Track Claude's actual fast mode state (from output detection)
  const actualFastModeRef = useRef<boolean | null>(null)
  const [panel, setPanel] = useState(0) // 0=events(Live), 1=diff(Code), 2=plan
  const [viewH, setViewH] = useState(window.innerHeight)
  const fullHeightRef = useRef(window.innerHeight)
  const keyboardH = Math.max(0, fullHeightRef.current - viewH)
  const scrollRef = useRef<HTMLDivElement>(null)
  const slideRef = useRef<HTMLDivElement>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const promptReadyRef = useRef(false)
  const scrollbackProcessedRef = useRef(false)
  const pendingImagePathsRef = useRef<string[]>([])
  const [hasPendingImages, setHasPendingImages] = useState(false)

  // Voice overlay state — Native Speech Recognition (Capacitor plugin)
  const [voicePhase, setVoicePhase] = useState<"preparing" | "recording" | "cleaning" | "result" | null>(null)
  const [voiceText, setVoiceText] = useState("")
  const [voiceExpanded, setVoiceExpanded] = useState(false)
  const [voiceDuration, setVoiceDuration] = useState(0)
  const [voicePartialText, setVoicePartialText] = useState("")
  const mcTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const latestPartialRef = useRef("")
  const accumulatedTextRef = useRef("")
  const srModuleRef = useRef<any>(null)
  const permGrantedRef = useRef(false)
  const isRecordingRef = useRef(false)
  const userWantsRecordingRef = useRef(false) // true while user hasn't pressed stop
  const listenerAttachedRef = useRef(false)
  const lastSegmentTimeRef = useRef(0) // guard against rapid restart loops
  const voiceSeqRef = useRef(0) // sequence counter to cancel stale starts
  const voiceRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // cancellable restart

  // Eagerly load plugin + pre-check permissions + pre-attach listeners on mount
  useEffect(() => {
    import("@capacitor-community/speech-recognition").then(mod => {
      srModuleRef.current = mod.SpeechRecognition
      try {
        mod.SpeechRecognition.checkPermissions()
          .then((perms: any) => { if (perms?.speechRecognition === "granted") permGrantedRef.current = true })
          .catch(() => {})
      } catch {}
      // Pre-attach listeners so first record press has zero listener setup delay
      ensureListener()
    }).catch(() => {})
  }, [])

  const mcStopRecording = () => {
    if (mcTimerRef.current) { clearInterval(mcTimerRef.current); mcTimerRef.current = null }
  }

  // Attach listeners: partialResults for live display, listeningState for auto-restart
  const ensureListener = async () => {
    if (listenerAttachedRef.current) return
    const SR = srModuleRef.current
    if (!SR) return
    try {
      await SR.addListener("partialResults", (data: { matches: string[] }) => {
        if (data.matches?.[0]) {
          latestPartialRef.current = data.matches[0]
          const displayText = (accumulatedTextRef.current + " " + data.matches[0]).trim()
          setVoicePartialText(displayText)
          // If we're getting results, engine is definitely running — ensure recording phase
          setVoicePhase(prev => prev === "preparing" ? "recording" : prev)
          if (!mcTimerRef.current && userWantsRecordingRef.current) {
            const startTime = Date.now()
            mcTimerRef.current = setInterval(() => {
              setVoiceDuration(Math.floor((Date.now() - startTime) / 1000))
            }, 1000)
          }
        }
      })
      // listeningState: "started" = engine ready, "stopped" = silence timeout
      await SR.addListener("listeningState", (data: { status: string }) => {
        if (data.status === "started" && userWantsRecordingRef.current) {
          // Engine is ready — switch from "preparing" to "recording"
          setVoicePhase(prev => prev === "preparing" ? "recording" : prev)
          if (!mcTimerRef.current) {
            const startTime = Date.now()
            mcTimerRef.current = setInterval(() => {
              setVoiceDuration(Math.floor((Date.now() - startTime) / 1000))
            }, 1000)
          }
        }
        if (data.status === "stopped" && userWantsRecordingRef.current) {
          // Accumulate whatever we got from this segment
          const segment = latestPartialRef.current
          if (segment) {
            accumulatedTextRef.current = (accumulatedTextRef.current + " " + segment).trim()
            latestPartialRef.current = ""
            setVoicePartialText(accumulatedTextRef.current)
          }
          isRecordingRef.current = false
          // Minimal guard: prevent rapid loop if stopped fires immediately after start
          const now = Date.now()
          if (now - lastSegmentTimeRef.current < 100) return
          lastSegmentTimeRef.current = now
          // Schedule restart with cancellable timeout — mcStopVoice can clearTimeout to prevent beep
          if (voiceRestartTimerRef.current) clearTimeout(voiceRestartTimerRef.current)
          voiceRestartTimerRef.current = setTimeout(() => {
            voiceRestartTimerRef.current = null
            if (!userWantsRecordingRef.current) return
            const seq = voiceSeqRef.current
            SR.start({ language: speechLang, partialResults: true, popup: false, maxResults: 5 })
              .then(() => {
                if (voiceSeqRef.current !== seq) { try { SR.stop() } catch {} return }
                isRecordingRef.current = true
              })
              .catch(() => {})
          }, 80)
        }
      })
      listenerAttachedRef.current = true
    } catch {}
  }

  // Start recognition (full init — called once per voice session)
  const doStartRecognition = async () => {
    const SR = srModuleRef.current
    if (!SR) return
    await ensureListener()
    // If somehow already recording, stop first
    if (isRecordingRef.current) {
      try { SR.stop() } catch {}
      isRecordingRef.current = false
    }
    lastSegmentTimeRef.current = Date.now()
    isRecordingRef.current = true
    try {
      // Fire and forget — recognition starts ASAP
      SR.start({ language: speechLang, partialResults: true, popup: false, maxResults: 5 })
        .catch(() => {})
    } catch {}
  }

  const mcStartVoice = async () => {
    const SR = srModuleRef.current
    if (!SR) return

    // 1. Cancel any previous voice session
    mcStopRecording()
    voiceSeqRef.current++
    if (voiceRestartTimerRef.current) { clearTimeout(voiceRestartTimerRef.current); voiceRestartTimerRef.current = null }
    userWantsRecordingRef.current = true
    if (isRecordingRef.current) {
      try { SR.stop() } catch {}
      isRecordingRef.current = false
    }

    // 2. Reset state
    setVoiceText("")
    setVoicePartialText("")
    latestPartialRef.current = ""
    accumulatedTextRef.current = ""

    // 3. Show preparing phase — switch to "recording" when engine fires "started" or partialResults
    setVoicePhase("preparing")
    if (navigator.vibrate) navigator.vibrate(30)
    setVoiceDuration(0)
    // Fallback: if listeningState "started" never fires, force to recording after 1.5s
    setTimeout(() => {
      setVoicePhase(prev => prev === "preparing" ? "recording" : prev)
      if (!mcTimerRef.current && userWantsRecordingRef.current) {
        const startTime = Date.now()
        mcTimerRef.current = setInterval(() => {
          setVoiceDuration(Math.floor((Date.now() - startTime) / 1000))
        }, 1000)
      }
    }, 1500)

    // 4. Check permissions (only first time — fast path after that)
    if (!permGrantedRef.current) {
      try {
        const req = await SR.requestPermissions()
        permGrantedRef.current = req?.speechRecognition === "granted"
      } catch {
        permGrantedRef.current = true
      }
      if (!permGrantedRef.current) {
        mcStopRecording()
        userWantsRecordingRef.current = false
        setVoicePhase("result")
        setVoiceText("[需要麥克風權限]")
        return
      }
    }

    // 5. Start recognition — no awaits, fire ASAP
    doStartRecognition()
  }

  const mcStopVoice = async () => {
    mcStopRecording()
    userWantsRecordingRef.current = false
    isRecordingRef.current = false
    voiceSeqRef.current++
    // Cancel any pending restart timer — prevents SR.start() from firing after stop
    if (voiceRestartTimerRef.current) { clearTimeout(voiceRestartTimerRef.current); voiceRestartTimerRef.current = null }

    const SR = srModuleRef.current
    // Capture whatever partial text we have BEFORE stopping
    const partialText = (accumulatedTextRef.current + " " + latestPartialRef.current).trim()

    if (SR) {
      // seq counter prevents any pending doStartRecognitionQuiet from firing
      try {
        await Promise.race([SR.stop(), new Promise(r => setTimeout(r, 800))])
      } catch {}
      await new Promise(r => setTimeout(r, 200))
    }

    // Read again after the delay — listener may have updated refs
    const finalFromListener = (accumulatedTextRef.current + " " + latestPartialRef.current).trim()
    // Use whichever source has the most text
    const candidates = [partialText, finalFromListener].filter(Boolean)
    const finalText = candidates.sort((a, b) => b.length - a.length)[0] || ""

    accumulatedTextRef.current = ""
    latestPartialRef.current = ""
    const isEditMode = voiceEditModeRef.current
    voiceEditModeRef.current = false
    const originalText = voiceEditOriginalRef.current
    voiceEditOriginalRef.current = ""

    if (!finalText.trim()) {
      setVoiceText(isEditMode ? originalText : "")
      setVoicePhase("result")
      return
    }

    // Show raw text immediately, then clean in background
    setVoiceText(finalText)
    setVoicePhase("result")

    if (isEditMode && originalText) {
      // Fire cleanup in background — update when done
      mcApplyVoiceEdit(originalText, finalText).then((edited) => {
        if (edited && edited !== finalText) setVoiceText(edited)
      })
    } else {
      // Fire cleanup in background — update when done
      mcCleanupText(finalText).then((cleaned) => {
        if (cleaned && cleaned !== finalText) setVoiceText(cleaned)
      })
    }
  }

  // LLM cleanup — fast timeout, non-blocking
  const mcCleanupText = async (text: string): Promise<string> => {
    const serverUrl = localStorage.getItem("agentrune_server") || ""
    if (!serverUrl || !text.trim()) return text
    try {
      const res = await fetch(`${serverUrl}/api/voice-cleanup`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-id": agentId || "claude" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = await res.json()
        return data.cleaned || text
      }
    } catch {}
    return text
  }

  // Edit mode: record voice instruction to modify existing text
  const voiceEditOriginalRef = useRef("")
  const voiceEditModeRef = useRef(false)
  // External voice target — when set, voice result goes to callback instead of send
  const voiceTargetCallbackRef = useRef<((text: string) => void) | null>(null)
  const [voiceContextLabel, setVoiceContextLabel] = useState<string | null>(null)

  const mcStartVoiceEdit = () => {
    voiceEditOriginalRef.current = voiceText // save current text
    voiceEditModeRef.current = true
    mcStartVoice()
  }

  const mcApplyVoiceEdit = async (original: string, instruction: string): Promise<string> => {
    const serverUrl = localStorage.getItem("agentrune_server") || ""
    if (!serverUrl) return original
    try {
      const res = await fetch(`${serverUrl}/api/voice-edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ original, instruction }),
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) {
        const data = await res.json()
        return data.edited || original
      }
    } catch (err: any) {
      console.error("[Voice Edit] Apply failed:", err.message)
    }
    return original
  }

  const mcSendVoice = () => {
    if (voiceText.trim()) {
      const cb = voiceTargetCallbackRef.current
      if (cb) {
        cb(voiceText.trim())
        voiceTargetCallbackRef.current = null
      } else {
        handleSendCommand(`[語音指令] ${voiceText.trim()}`)
      }
      if (navigator.vibrate) navigator.vibrate(20)
    }
    setVoiceText("")
    setVoiceContextLabel(null)
    setVoicePhase(null)
  }

  // Expose voice request for external components (e.g. DiffPanel)
  useEffect(() => {
    if (onRequestVoiceRef) {
      onRequestVoiceRef.current = (callback: (text: string) => void, label?: string) => {
        voiceTargetCallbackRef.current = callback
        setVoiceContextLabel(label || null)
        mcStartVoice()
      }
      return () => { onRequestVoiceRef.current = null }
    }
  })

  const mcCancelVoice = () => {
    mcStopRecording()
    userWantsRecordingRef.current = false
    voiceSeqRef.current++
    if (voiceRestartTimerRef.current) { clearTimeout(voiceRestartTimerRef.current); voiceRestartTimerRef.current = null }
    const SR = srModuleRef.current
    if (SR) {
      Promise.race([SR.stop(), new Promise(r => setTimeout(r, 500))]).catch(() => {})
    }
    isRecordingRef.current = false
    voiceTargetCallbackRef.current = null
    setVoiceContextLabel(null)
    setVoiceText("")
    setVoicePhase(null)
  }

  const agent = AGENTS.find((a) => a.id === agentId)
  const showDangerBadge = (agentId === "claude" && settings.bypass) || (agentId === "codex" && settings.codexMode === "danger-full-access")

  // Reset events when switching sessions
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId
      setEvents([])
      setAgentStatus("idle")
      setInitializing(true) // Lock input until init_status:"done" or attached(resumed)
      parserRef.current = new AnsiParser()
      setParsedBlocks([])
      setUsageTokens({ input: 0, output: 0 })
      setWorktreeBranch(null)
      scrollbackProcessedRef.current = false
      // Safety timeout: auto-unlock after 45s to prevent stuck state
      const safetyTimer = setTimeout(() => setInitializing(false), 45000)
      return () => clearTimeout(safetyTimer)
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
  const freeTextPendingRef = useRef<string | null>(null)  // eventId when "Type custom response" was clicked
  // AnsiParser for structured output blocks (thinking/code/tools)
  const parserRef = useRef(new AnsiParser())
  const [parsedBlocks, setParsedBlocks] = useState<OutputBlock[]>([])
  const [apiKeyModal, setApiKeyModal] = useState<{ agentId: string; eventId: string } | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState("")
  const [apiKeySaving, setApiKeySaving] = useState(false)
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
  const [detailTab, setDetailTab] = useState<"events" | "code" | "thinking">("events")
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

  // Prevent document-level overscroll (Android WebView ignores CSS overscroll-behavior)
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      let el = e.target as HTMLElement | null
      while (el && el !== document.body && el !== document.documentElement) {
        const style = getComputedStyle(el)
        const isScrollable = (style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight
        if (isScrollable) return // inside a scrollable container — allow
        el = el.parentElement
      }
      // Not inside any scrollable element — prevent body overscroll
      if (e.cancelable) e.preventDefault()
    }
    document.addEventListener("touchmove", handler, { passive: false })
    return () => document.removeEventListener("touchmove", handler)
  }, [])

  // Track viewport height (keyboard-aware via visualViewport)
  // Uses CSS custom property for instant DOM update (no React render delay)
  const mcContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const update = () => {
      const newH = window.visualViewport?.height ?? window.innerHeight
      // Sync update: set CSS property directly on the container (no React re-render needed)
      if (mcContainerRef.current) {
        mcContainerRef.current.style.height = `${newH}px`
      }
      setViewH(newH)
      // Only update fullHeight when height increases (keyboard closing, not opening)
      if (newH > fullHeightRef.current) fullHeightRef.current = newH
    }
    window.visualViewport?.addEventListener("resize", update)
    window.visualViewport?.addEventListener("scroll", update)
    window.addEventListener("resize", update)
    return () => {
      window.visualViewport?.removeEventListener("resize", update)
      window.visualViewport?.removeEventListener("scroll", update)
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
      slideRef.current.style.transform = "translateX(0)"
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
    if (d.direction === "v" && panel === 0) {
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
      // Model change — clear current input first, then /model <name>
      if (newSettings.model !== prev.model) {
        // Ctrl+U clears the current input line in Claude Code TUI
        send({ type: "input", data: "\x15" })
        setTimeout(() => {
          send({ type: "input", data: `/model ${newSettings.model}` })
          setTimeout(() => send({ type: "input", data: "\r" }), 50)
        }, 100)
      }
      // Plan mode toggle ??shift+tab (\x1b[Z)
      if (newSettings.planMode !== prev.planMode) {
        send({ type: "input", data: "\x1b[Z" })
      }
      // Fast mode toggle — only send /fast if actual state differs from desired
      // Claude defaults to fast mode OFF in new conversations
      if (newSettings.fastMode !== prev.fastMode) {
        const actual = actualFastModeRef.current ?? false
        if (actual === newSettings.fastMode) {
          // Already in sync, just update settings without sending command
        } else {
          send({ type: "input", data: "\x15" }) // Ctrl+U clear line
          setTimeout(() => {
            send({ type: "input", data: "/fast" })
            setTimeout(() => send({ type: "input", data: "\r" }), 50)
          }, 100)
        }
      }
      // Bypass mode — CLI flag, restart session with new command
      if (newSettings.bypass !== prev.bypass && sessionId) {
        if (newSettings.bypass) {
          // Turning ON → require confirmation dialog first
          // Revert toggle immediately; it will be set after confirmation
          setSettings({ ...newSettings, bypass: false })
          saveSettings(project.id, { ...newSettings, bypass: false })
          setBypassConfirmPending(true)
        } else {
          // Turning OFF → execute immediately, no confirmation needed
          showToast(t("mc.bypassDisabled") || "Bypass disabled — restarting...", 3000)
          onKillSession(sessionId)
          setEvents([])
          setTimeout(() => onLaunchSession?.(project.id, agentId), 500)
        }
      }
    }
  }, [project.id, settings, agentId, sessionId, send, showToast, t, onKillSession, onLaunchSession])

  // Bypass confirmation handlers
  const confirmBypass = useCallback(() => {
    setBypassConfirmPending(false)
    const newSettings = { ...settings, bypass: true }
    setSettings(newSettings)
    saveSettings(project.id, newSettings)
    showToast(t("mc.bypassEnabled") || "Bypass enabled — restarting...", 3000)
    if (sessionId) {
      onKillSession(sessionId)
      setEvents([])
      setTimeout(() => onLaunchSession?.(project.id, agentId), 500)
    }
  }, [settings, project.id, sessionId, agentId, showToast, t, onKillSession, onLaunchSession])

  const cancelBypass = useCallback(() => {
    setBypassConfirmPending(false)
  }, [])

  // Agent responses now come from server-side JSONL watcher (type: "response" events)
  // — no more client-side PTY output parsing for reply accumulation.


  // ?????? Input ??????
  const sendInput = useCallback((data: string): boolean => {
    return send({ type: "input", data })
  }, [send])

  const uploadingCountRef = useRef(0)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const checkUploading = useCallback(() => uploadingCountRef.current > 0, [])

  const handleImagePaste = useCallback(async (base64: string, filename: string) => {
    uploadingCountRef.current++
    setIsUploadingImage(true)
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
      // Queue the path — will be sent together with the user's next message
      pendingImagePathsRef.current.push(data.path)
      setHasPendingImages(true)
    } catch (err) {
      setEvents(prev => [...prev, {
        id: `err_${Date.now()}`, timestamp: Date.now(),
        type: "error" as const, status: "failed" as const,
        title: t("mc.uploadFailed") || "Image upload failed",
        detail: err instanceof Error ? err.message : "Network error",
      }].slice(-200))
    } finally {
      uploadingCountRef.current--
      if (uploadingCountRef.current === 0) setIsUploadingImage(false)
    }
  }, [project.id, sendInput, t, setEvents])

  const handleSendCommand = useCallback((text: string, flags?: SendFlags, images?: string[]) => {
    if (text === "\x03") { sendInput(text); return }
    if (text === "\r") { sendInput(text); return } // Enter key for TUI navigation

    // Interrupt mode: Ctrl+C to stop, then send structured instruction
    // Agent should: 1) stop current work  2) save unfinished work as task  3) handle new message
    if (flags?.interrupt) {
      sendInput("\x03")
      const interruptInstruction = [
        `[INTERRUPT] Stop what you're doing.`,
        `1. Add your unfinished work to your task list (use TodoWrite) so you can resume later.`,
        `2. Then handle this message:\n\n${text}`,
      ].join("\n")
      setTimeout(() => handleSendCommand(interruptInstruction), 300)
      return
    }

    // Task mode: add task directly to Plan panel's task store AND send to agent
    if (flags?.task) {
      const taskText = text
      // Append to AgentRune task store (Plan panel)
      fetch(`${getApiBase()}/api/tasks/${encodeURIComponent(project.id)}`)
        .then(r => r.json())
        .then((store: import("../types").TaskStore | null) => {
          const existing = store?.tasks || []
          const nextId = existing.length > 0 ? Math.max(...existing.map(t => t.id)) + 1 : 1
          const newTask: import("../types").Task = {
            id: nextId,
            title: taskText.slice(0, 80),
            description: taskText,
            status: "pending",
            dependsOn: [],
          }
          return fetch(`${getApiBase()}/api/tasks/${encodeURIComponent(project.id)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tasks: [...existing, newTask] }),
          })
        })
        .catch(() => {})
      text = `[TASK] Add the following to your task list (use TodoWrite), then confirm: ${text}`
    }
    // Grab any pending image paths from successful HTTP uploads
    const pendingImages = pendingImagePathsRef.current.splice(0)
    let usedHttpPaths = false
    if (pendingImages.length > 0) {
      usedHttpPaths = true
      setHasPendingImages(false)
      const imagePaths = pendingImages.join(" ")
      text = text.trim()
        ? `${text} [Attached images — please read these files:] ${imagePaths}`
        : `[Attached images — please read these files:] ${imagePaths}`
    }
    // If HTTP upload failed but we have inline images, use WS fallback
    const wsImages = (!usedHttpPaths && images && images.length > 0) ? images : undefined

    const trimmedInput = text.trim()
    if (!trimmedInput && !wsImages) return

    // If user clicked "Type custom response", interrupt TUI menu first (Esc),
    // then send the typed text after a short delay
    const pendingFreeText = freeTextPendingRef.current
    if (pendingFreeText) {
      freeTextPendingRef.current = null
      sendInput("\x1b")  // Esc to dismiss TUI menu
      // Mark the decision event as completed
      setEvents((prev) =>
        prev.map((e) => e.id === pendingFreeText ? { ...e, status: "completed" as const, _selectedInput: "__FREE_TEXT__" } as any : e)
      )
      // Delay to let TUI process the Esc before sending text
      setTimeout(() => {
        sendInput(text)
        setTimeout(() => sendInput("\r"), 30)
      }, 300)
      // Continue to add user event below (don't return)
    }

    // Send text and \r as TWO separate WS messages.
    // This matches the pattern that works reliably (e.g., claude --resume sends
    // text and \r as separate messages, and PTY processes both correctly).
    const isSlash = text.startsWith("/")
    let sent: boolean
    if (!pendingFreeText && wsImages) {
      // WS fallback: send text + images (server saves images, appends paths)
      sent = send({ type: "input", data: text, images: wsImages })
      if (sent && !isSlash) setTimeout(() => sendInput("\r"), 500)
    } else if (!pendingFreeText) {
      sent = sendInput(text)
      if (sent && !isSlash) setTimeout(() => sendInput("\r"), 500)
    } else {
      sent = true
    }
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
    if (!pendingFreeText && isSlash) {
      setTimeout(() => sendInput("\r"), 300)
    }


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
    // Include image thumbnails if present (from WS inline or HTTP upload)
    const eventImages = images && images.length > 0 ? images : undefined
    const userEvent = {
      id: `usr_${Date.now()}`,
      timestamp: Date.now(),
      type: "info" as const,
      status: "completed" as const,
      title: text.length > 60 ? text.slice(0, 60) + "..." : text,
      detail: text.length > 60 ? text : undefined,
      _images: eventImages,
    }
    setEvents(prev => [...prev, userEvent].slice(-200))
    // Persist to server so it survives navigation (replayed via events_replay)
    if (sessionId) {
      send({ type: "store_event", sessionId, event: userEvent })
    }

    setAgentStatus("working")
    promptReadyRef.current = false  // Reset so idle timer doesn't fire until next prompt

    addRecentCommand(project.id, text)
  }, [sendInput, project.id])

  const handleDecision = useCallback((eventId: string, input: string) => {
    // Special actions: open URL in phone browser or copy URL
    if (input.startsWith("__open_url__")) {
      const url = input.slice("__open_url__".length)
      import("@capacitor/browser").then(({ Browser }) => {
        Browser.open({ url }).catch(() => window.open(url, "_blank"))
      }).catch(() => window.open(url, "_blank"))
      setEvents((prev) =>
        prev.map((e) => e.id === eventId ? { ...e, status: "completed" as const } : e)
      )
      return
    }
    if (input.startsWith("__copy_url__")) {
      const url = input.slice("__copy_url__".length)
      navigator.clipboard?.writeText(url).catch(() => {})
      setEvents((prev) =>
        prev.map((e) => e.id === eventId ? { ...e, status: "completed" as const } : e)
      )
      return
    }
    if (input.startsWith("__enter_api_key__")) {
      const targetAgentId = input.slice("__enter_api_key__".length)
      setApiKeyModal({ agentId: targetAgentId, eventId })
      setApiKeyInput("")
      return
    }
    if (input === "__FREE_TEXT__") {
      // Focus input bar — interrupt happens when user actually sends text
      freeTextPendingRef.current = eventId
      const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null
      if (textarea) {
        textarea.focus()
        textarea.scrollIntoView({ behavior: "smooth", block: "end" })
      }
      return  // Don't mark completed yet — wait for user to send
    }

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

  // Quote: prepend quoted text to next command
  const [quotedText, setQuotedText] = useState("")
  const handleQuote = useCallback((text: string) => {
    setQuotedText(`> ${text}\n`)
    if (navigator.vibrate) navigator.vibrate(20)
  }, [])

  // Attached files from FileBrowser — persisted across view switches
  const filesDraftKey = `mc_${project.id}_${sessionId || "default"}`
  const [attachedFiles, setAttachedFilesRaw] = useState<string[]>(() => _fileDrafts.get(filesDraftKey) || [])
  const setAttachedFiles = useCallback((val: string[] | ((prev: string[]) => string[])) => {
    setAttachedFilesRaw(prev => {
      const next = typeof val === "function" ? val(prev) : val
      _fileDrafts.set(filesDraftKey, next)
      return next
    })
  }, [filesDraftKey])

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
      setEvents(prev => {
        const existingIdx = prev.findIndex(e => e.id === event.id)
        if (existingIdx !== -1) {
          // Same ID: merge status update (e.g. in_progress → completed)
          const existing = prev[existingIdx]
          if (event.status && event.status !== existing.status) {
            const updated = [...prev]
            updated[existingIdx] = { ...existing, status: event.status }
            return updated
          }
          return prev
        }
        // For decision_request: dedup by ID, then by detail (same permission asked again)
        if (event.type === "decision_request") {
          if (prev.some(e => e.id === event.id)) return prev
          // Dedup by detail text — same permission prompt re-sent with different ID
          if (event.detail && prev.some(e =>
            e.type === "decision_request" && e.status === "waiting" && e.detail === event.detail
          )) return prev
        }
        // Content dedup: only for recent non-decision events (last 5)
        if (event.type !== "decision_request") {
          const evtTitle = (event.title || "").slice(0, 40)
          if (evtTitle) {
            const recentSlice = prev.slice(-5)
            for (const e of recentSlice) {
              const pTitle = (e.title || "").slice(0, 40)
              if (pTitle === evtTitle) return prev
            }
          }
        }
        // Insert in timestamp order (late-arriving events go to correct position)
        const merged = [...prev, event]
        if (event.timestamp < (prev[prev.length - 1]?.timestamp || 0)) {
          merged.sort((a, b) => a.timestamp - b.timestamp)
        }
        return merged.slice(-100)
      })
      if (event.type === "decision_request" && event.status === "waiting") {
        setAgentStatus("waiting")
        if (navigator.vibrate) navigator.vibrate([200, 100, 200])
      }
      // Track last progress report for current session
      if (event.type === "progress_report" && event.progress && sessionId) {
        setSessionProgress(prev => ({ ...prev, [sessionId]: event }))
      }
      // Note: initialization unlock is handled by init_status:"done" event, not response events.
      // Response events fire during init injection (agent processing the rules prompt),
      // which would prematurely unlock input.
      // Token usage from JSONL watcher
      if (event.type === "token_usage" && event.detail) {
        try {
          const { input, output } = JSON.parse(event.detail) as { input: number; output: number }
          setUsageTokens(prev => {
            const newInput = Math.max(prev.input, input)
            const newOutput = Math.max(prev.output, output)
            const deltaIn = newInput - prev.input
            const deltaOut = newOutput - prev.output
            if (deltaIn > 0) projectTotalTokens.current.input += deltaIn
            if (deltaOut > 0) projectTotalTokens.current.output += deltaOut
            return { input: newInput, output: newOutput }
          })
        } catch {}
      }
    }))

    // Replay stored events on re-attach (from server adapter)
    unsubs.push(on("events_replay", (msg) => {
      const replayed = (msg.events as AgentEvent[]) || []
      // Extract token usage from replay to restore Usage display
      const usageEvents = replayed.filter(e => e.type === "token_usage" && e.detail)
      if (usageEvents.length > 0) {
        let maxIn = 0, maxOut = 0
        for (const ue of usageEvents) {
          try {
            const { input, output } = JSON.parse(ue.detail!) as { input: number; output: number }
            if (input > maxIn) maxIn = input
            if (output > maxOut) maxOut = output
          } catch {}
        }
        if (maxIn > 0 || maxOut > 0) {
          setUsageTokens({ input: maxIn, output: maxOut })
          projectTotalTokens.current = { input: maxIn, output: maxOut }
        }
      }
      // Keep waiting decision_requests (still pending) — server already filters stale ones
      const filtered = replayed.filter(e => {
        if (e.type === "token_usage") return false
        if (e.type === "decision_request" && e.status !== "waiting") return false
        return true
      })
      if (filtered.length > 0) {
        // Merge server events with any client-side events (dedupe by id, sort by timestamp)
        setEvents(prev => {
          const existingIds = new Set(prev.map(e => e.id))
          const newEvents = filtered.filter(e => !existingIds.has(e.id))
          if (newEvents.length === 0) return prev
          return [...prev, ...newEvents].sort((a, b) => a.timestamp - b.timestamp)
        })
        const latest = filtered[filtered.length - 1]
        if (latest?.type === "decision_request" && latest.status === "waiting") {
          setAgentStatus("waiting")
        } else if (latest?.status === "completed") {
          setAgentStatus("idle")
        } else if (latest?.status === "in_progress") {
          setAgentStatus("working")
        }
      }
    }))
    unsubs.push(on("output", (msg) => {
      const data = msg.data as string
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)

      const stripped = data
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
        .replace(/[\x00-\x08\x0b-\x1f]/g, "")
      const text = stripped.trim()

      // Detect prompt on stripped text (raw data has trailing ANSI codes)
      const isPrompt = /(?:[$%>#]|[\u203A\u276F\u00BB])\s*$/.test(text)
      if (isPrompt) {
        promptReadyRef.current = true
        setInitializing(false)
      }

      if (!isPrompt && text.length > 10) setAgentStatus("working")

      // Sync fast mode state from Claude's actual output
      // Claude Code outputs "Fast mode ON" / "Fast mode OFF" (not enabled/disabled)
      if (/fast mode\s+on|快速模式已開啟/i.test(text)) {
        actualFastModeRef.current = true
        setSettings(prev => {
          if (prev.fastMode) return prev
          const next = { ...prev, fastMode: true }
          saveSettings(project.id, next)
          return next
        })
      } else if (/fast mode\s+off|快速模式已關閉/i.test(text)) {
        actualFastModeRef.current = false
        setSettings(prev => {
          if (!prev.fastMode) return prev
          const next = { ...prev, fastMode: false }
          saveSettings(project.id, next)
          return next
        })
      }

      // Permission detection is handled server-side (ParseEngine) only — no client-side
      // duplicate detection. Server emits decision_request events via the event stream.

      parserRef.current.feed(data)
      setParsedBlocks(parserRef.current.getBlocks())

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
      if (msg.worktreeBranch) setWorktreeBranch(msg.worktreeBranch as string)
      // Resumed sessions don't need initialization — unlock input immediately
      if (resumed) setInitializing(false)
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

    // Init status: lock/unlock input during injection
    unsubs.push(on("init_status", (msg) => {
      setInitializing(msg.phase === "injecting")
    }))

    unsubs.push(on("api_key_result", (msg) => {
      setApiKeySaving(false)
      if (msg.success) {
        setApiKeyModal(null)
        setApiKeyInput("")
        if (msg.restarted && msg.newSessionId) {
          // Session was restarted with the new API key — re-attach
          send({ type: "attach", projectId: project.id, agentId, sessionId: msg.newSessionId as string, autoSaveKeys: getAutoSaveKeysEnabled(), autoSaveKeysPath: getAutoSaveKeysPath() })
          setEvents(prev => [...prev, {
            id: `apikey_${Date.now()}`, timestamp: Date.now(),
            type: "info" as const, status: "completed" as const,
            title: t("mc.apiKeySaved"),
          }].slice(-200))
        }
      }
    }))

    unsubs.push(on("__ws_open__", () => {
      // Re-attach to session so server restores WS connection mapping
      if (sessionId) {
        send({ type: "attach", projectId: project.id, agentId, sessionId, autoSaveKeys: getAutoSaveKeysEnabled(), autoSaveKeysPath: getAutoSaveKeysPath() })
      }
    }))

    return () => {
      for (const u of unsubs) u()
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
    }
  }, [on, send, agent, settings, project.id, agentId, sessionId, t])

  // Android back button — close overlays first (innermost → outermost)
  useEffect(() => {
    const handler = (e: Event) => {
      // MissionControl is hidden when terminal is active — don't handle back
      if (viewMode === "terminal") return
      // Voice overlay is topmost — close it first
      if (voicePhase) {
        mcCancelVoice()
        e.preventDefault(); return
      }
      if (previewImageUrl) { setPreviewImageUrl(null); e.preventDefault(); return }
      if (previewFile) { setPreviewFile(null); e.preventDefault(); return }
      if (showGit) { setShowGit(false); e.preventDefault(); return }
      if (renamingSession) { setRenamingSession(null); e.preventDefault(); return }
      if (contextSession) { setContextSession(null); e.preventDefault(); return }
      if (showInsight) { setShowInsight(false); e.preventDefault(); return }
      if (showBrowser) { setShowBrowser(false); e.preventDefault(); return }
      if (showSettings) { setShowSettings(false); e.preventDefault(); return }
      // Terminal/Diff panel → go back to Events; Events panel → go back to ProjectOverview
      if (panel !== 0) { goToPanel(0); e.preventDefault(); return }
      onBack(); e.preventDefault()
    }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [viewMode, voicePhase, previewImageUrl, previewFile, showGit, showInsight, showBrowser, showSettings, contextSession, renamingSession, panel, goToPanel])

  // TerminalView (always mounted) handles attach + auto-command.
  // MissionControl just listens for WS messages ??no attach needed.

  // ?????? Filtered events: only well-defined actions (no text accumulator noise) ??????
    const mainEvents = useMemo(() => events.filter((e) => {
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
  }), [events])

    // L1 events: important actions only (memoized, used in render + empty check)
    const L1_TYPES = new Set(["progress_report", "decision_request", "response", "error", "file_edit", "file_create", "file_delete", "command_run"])
    const l1Events = useMemo(() => mainEvents.filter(
      e => L1_TYPES.has(e.type) || e.id.startsWith("usr_") || e.id.startsWith("init_")
    ), [mainEvents])
return (
    <>
      {/* Status indicator overlay ??only when working/waiting */}
      {(agentStatus === "working" || agentStatus === "waiting") && (
        <div style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          pointerEvents: "none",
          animation: theme === "dark" ? "borderGlowBlue 2s ease-in-out infinite" : "borderGlowTealLight 2s ease-in-out infinite",
          boxShadow: theme === "dark"
            ? "inset 0 0 30px 4px rgba(96,165,250,0.25), inset 0 0 8px 2px rgba(96,165,250,0.4)"
            : "inset 0 0 20px 4px rgba(55,172,192,0.25), inset 0 0 6px 2px rgba(55,172,192,0.4)",
        }} />
      )}
      <div
        ref={mcContainerRef}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: `${viewH}px`,
          overflow: "hidden",
          zIndex: 1,
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* 2-Panel Slider: Events ↔ Diff */}
        <div
          ref={slideRef}
          style={{
            display: "flex",
            height: "100%",
            willChange: "transform",
          }}
        >
          {/* Panel 0: Events */}
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
                <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500, marginTop: 1, opacity: 0.8, display: "flex", alignItems: "center", gap: 6 }}>
                  {agent?.name || "Terminal"}
                  {worktreeBranch && (
                    <span style={{
                      fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
                      padding: "1px 5px", borderRadius: 4,
                      background: "rgba(96,165,250,0.1)", color: "var(--accent-primary)",
                      border: "1px solid rgba(96,165,250,0.2)",
                      maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {worktreeBranch.replace(/^agentrune\//, "")}
                    </span>
                  )}
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
                  const prefix = showProjectUsage ? "T " : ""
                  if (tokens.input > 0 || tokens.output > 0) {
                    const fmtIn = tokens.input >= 1000 ? `${(tokens.input / 1000).toFixed(1)}k` : `${tokens.input}`
                    const fmtOut = tokens.output >= 1000 ? `${(tokens.output / 1000).toFixed(1)}k` : `${tokens.output}`
                    return <>{prefix}{fmtIn}↑ {fmtOut}↓</>
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
              {/* Git button with badge */}
              <button onClick={() => setShowGit(true)} onTouchStart={(e) => e.stopPropagation()} style={{ ...glassBtn, position: "relative" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
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
                background: "rgba(55, 172, 192, 0.06)",
                borderBottom: "1px solid rgba(55, 172, 192, 0.15)",
                flexShrink: 0,
              }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#37ACC0", animation: "pulse 1s ease-in-out infinite" }} />
                <span style={{ fontSize: 11, color: "#37ACC0", fontWeight: 600, opacity: 0.9 }}>{t("mc.connecting")}</span>
              </div>
            )}
            {/* Daemon role badge — shown when connected to release (fallback) daemon */}
            {wsConnected && localStorage.getItem("agentrune_daemon_role") === "release" && (
              <div style={{
                padding: "4px 16px",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                background: "rgba(251, 129, 132, 0.08)",
                borderBottom: "1px solid rgba(251, 129, 132, 0.15)",
                flexShrink: 0,
              }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#FB8184" }} />
                <span style={{ fontSize: 10, color: "#FB8184", fontWeight: 600, letterSpacing: "0.5px" }}>RELEASE DAEMON</span>
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
                  border: `1px solid ${agentStatus === "waiting" ? "rgba(55,172,192,0.3)" : "var(--glass-border)"}`,
                  boxShadow: "var(--glass-shadow)",
                  animation: agentStatus === "waiting" ? "breathe 2s ease-in-out infinite" : "none",
                }}>
                  {agentStatus === "waiting" ? (
                    <>
                      <div style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: "#37ACC0",
                        boxShadow: "0 0 8px #37ACC0",
                        animation: "pulse 2s ease-in-out infinite",
                      }} />
                      <span style={{ fontSize: 11, color: "#37ACC0", fontWeight: 600 }}>
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

            {/* Page indicator — subtle pill */}
            <div style={{
              display: "flex", justifyContent: "center", padding: "6px 0 4px", flexShrink: 0,
            }}>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 2,
                padding: "3px 4px", borderRadius: 10,
                background: "var(--icon-bg)",
                border: "none",
              }}>
                {[t("mc.events"), "Diff", "Plan"].map((label, i) => (
                  <button
                    key={i}
                    onClick={() => goToPanel(i)}
                    onTouchStart={(e) => e.stopPropagation()}
                    style={{
                      padding: "4px 14px",
                      borderRadius: 8,
                      border: "none",
                      background: i === panel ? "var(--glass-border)" : "transparent",
                      color: i === panel ? "var(--text-primary)" : "var(--text-secondary)",
                      fontSize: 11,
                      fontWeight: i === panel ? 700 : 500,
                      cursor: "pointer",
                      opacity: i === panel ? 1 : 0.4,
                      transition: `all 0.3s ${SPRING}`,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
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
              {/* L1: Important events only — progress, decisions, responses, errors, file edits */}
              {l1Events.map((event) => (
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
                    onDecision={event.type === "decision_request" && event.decision ? (input) => handleDecision(event.id, input) : undefined}
                    onQuote={handleQuote}
                    onSaveObsidian={(text) => handleSaveObsidian(text, event)}
                    onViewDiff={onEventDiff}
                    onPreviewImage={setPreviewImageUrl}
                    apiBase={getApiBase()}
                    projectId={project.id}
                  />
                )
              ))}
              {/* Thinking indicator — show when agent is working but no progress yet */}
              {agentStatus === "working" && (
                <div style={{
                  textAlign: "center",
                  padding: "16px 0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#37ACC0",
                      boxShadow: "0 0 8px rgba(55,172,192,0.5)",
                      animation: `typingDot 1.4s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              )}
              {l1Events.length === 0 && (
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
            {/* QuickActions removed — toolbar integrated into InputBar */}
            <InputBar
              onSend={handleSendCommand}
              onImagePaste={handleImagePaste}
              onVoice={mcStartVoice}
              onInsight={() => setShowInsight(true)}
              autoFocus={isMobile}
              slashCommands={agent?.slashCommands}
              onBrowse={() => setShowBrowser(true)}
              prefill={quotedText}
              onPrefillConsumed={() => setQuotedText("")}
              draftKey={`mc_${project.id}_${sessionId || "default"}`}
              attachedFiles={attachedFiles}
              onRemoveFile={(path) => setAttachedFiles((prev) => prev.filter((f) => f !== path))}
              disabled={initializing}
              disabledHint={t("mc.initializing") || "初始化中，請稍候…"}
              isUploadingImage={isUploadingImage}
              checkUploading={checkUploading}
              hasPendingImages={hasPendingImages}
              onOpenBuilder={onOpenBuilder}
            />
          </div>

          {/* Panel 1: Diff */}
          <div style={{ width: "100vw", flexShrink: 0, height: "100%", display: "flex", flexDirection: "column" }}>
            {/* Header — matches Events panel header */}
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
                <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500, marginTop: 1, opacity: 0.8, display: "flex", alignItems: "center", gap: 6 }}>
                  Diff
                  {(() => {
                    const count = events.filter(e => e.type === "file_edit" || e.type === "file_create").length
                      || parsedBlocks.filter(b => b.type === "tool" && /(?:Edit|Write)\(/.test(b.content)).length
                      || mergedCodeBlocks.length
                    return count > 0 ? (
                      <span style={{
                        fontSize: 9, padding: "1px 5px", borderRadius: 4,
                        background: "rgba(96,165,250,0.1)", color: "var(--accent-primary)",
                        border: "1px solid rgba(96,165,250,0.2)",
                        fontWeight: 600,
                      }}>
                        {count} {count === 1 ? "file" : "files"}
                      </span>
                    ) : null
                  })()}
                </div>
              </div>
              <button onClick={onOpenTerminal} onTouchStart={(e) => e.stopPropagation()} style={glassBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </button>
            </div>

            {/* Page indicator pill — matches Events panel */}
            <div style={{
              display: "flex", justifyContent: "center", padding: "6px 0 4px", flexShrink: 0,
            }}>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 2,
                padding: "3px 4px", borderRadius: 10,
                background: "var(--icon-bg)",
                border: "none",
              }}>
                {[t("mc.events"), "Diff", "Plan"].map((label, i) => (
                  <button
                    key={i}
                    onClick={() => goToPanel(i)}
                    onTouchStart={(e) => e.stopPropagation()}
                    style={{
                      padding: "4px 14px",
                      borderRadius: 8,
                      border: "none",
                      background: i === panel ? "var(--glass-border)" : "transparent",
                      color: i === panel ? "var(--text-primary)" : "var(--text-secondary)",
                      fontSize: 11,
                      fontWeight: i === panel ? 700 : 500,
                      cursor: "pointer",
                      opacity: i === panel ? 1 : 0.4,
                      transition: `all 0.3s ${SPRING}`,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Diff content */}
            {(() => {
              const fileEvents = events.filter(e => e.type === "file_edit" || e.type === "file_create")
              const toolEdits = fileEvents.length === 0
                ? parsedBlocks.filter(b => b.type === "tool" && /(?:Edit|Write)\(/.test(b.content)).map((b, i) => {
                    const pathMatch = b.content.match(/(?:Edit|Write)\(([^)]+)\)/)
                    return { id: `tb_${i}`, path: pathMatch?.[1] || "unknown", timestamp: b.timestamp, isWrite: /Write/.test(b.content) }
                  })
                : []
              const hasContent = fileEvents.length > 0 || toolEdits.length > 0 || mergedCodeBlocks.length > 0
              return (
                <div style={{ flex: 1, overflowY: "auto", padding: 16, minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
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
                        <PathBadge path={evt.diff?.filePath || evt.title?.replace(/^(Editing|Creating|Edited|Created)\s+/i, "") || "?"} />
                        <div style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.6, marginTop: 2 }}>
                          {new Date(evt.timestamp).toLocaleTimeString()}
                          {evt.type === "file_create" && " - new file"}
                        </div>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  ))}
                  {toolEdits.map((te) => (
                    <div key={te.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 14px", borderRadius: 12,
                      background: "var(--glass-bg)", border: "1px solid var(--glass-border)",
                    }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{te.isWrite ? "+" : "-"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <PathBadge path={te.path} />
                        <div style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.6, marginTop: 2 }}>
                          {new Date(te.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))}
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
            })()}
          </div>

          {/* Panel 2: Plan (Tasks + Standards) */}
          <div style={{ width: "100vw", flexShrink: 0, height: "100%", display: "flex", flexDirection: "column" }}>
            {/* Header */}
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
                <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)", letterSpacing: -0.3 }}>
                  {project.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500, marginTop: 1, opacity: 0.8 }}>
                  Plan
                </div>
              </div>
              {/* Header buttons */}
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

            {/* Page indicator */}
            <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 4px", flexShrink: 0 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "3px 4px", borderRadius: 10, background: "var(--icon-bg)", border: "none" }}>
                {[t("mc.events"), "Diff", "Plan"].map((label, i) => (
                  <button key={i} onClick={() => goToPanel(i)} onTouchStart={(e) => e.stopPropagation()}
                    style={{ padding: "4px 14px", borderRadius: 8, border: "none", background: i === panel ? "var(--glass-border)" : "transparent", color: i === panel ? "var(--text-primary)" : "var(--text-secondary)", fontSize: 11, fontWeight: i === panel ? 700 : 500, cursor: "pointer", opacity: i === panel ? 1 : 0.4, transition: `all 0.3s ${SPRING}` }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Plan content: Tasks + Standards tabs */}
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <PlanPanel projectId={project.id} send={send} />
            </div>
          </div>

        </div>
      </div>

      {/* Settings overlay ??outside swipe container */}
      <Suspense fallback={null}>
      {showSettings && <SettingsSheet
        open={showSettings}
        settings={settings}
        agentId={agentId}
        onChange={handleSettingsChange}
        onClose={() => setShowSettings(false)}
        send={send}
        on={on}
        theme={document.documentElement.classList.contains("dark") ? "dark" : "light"}
        toggleTheme={toggleTheme}
      />}

      {showInsight && <InsightSheet
        open={showInsight}
        onClose={() => setShowInsight(false)}
        apiBase={getApiBase()}
        projectId={project.id}
        sessionId={sessionId}
      />}

      {showBrowser && <FileBrowser
        open={showBrowser}
        onClose={() => setShowBrowser(false)}
        onSelectPath={(path) => {
          setAttachedFiles((prev) => prev.includes(path) ? prev : [...prev, path])
          setShowBrowser(false)
        }}
        onPreviewFile={(path) => setPreviewFile(path)}
        initialPath={attachedFiles.length > 0 ? attachedFiles[attachedFiles.length - 1].replace(/[/\\][^/\\]+$/, "") : project.cwd}
      />}

      {previewFile !== null && <FilePreview
        open={previewFile !== null}
        filePath={previewFile}
        onClose={() => setPreviewFile(null)}
      />}

      {showGit && <GitPanel
        open={showGit}
        projectId={project.id}
        onClose={() => setShowGit(false)}
        onNewSession={onLaunchSession ? (branchName) => {
          setShowGit(false)
          onLaunchSession(project.id, agentId)
        } : undefined}
      />}
      </Suspense>

      {/* Image preview overlay */}
      {previewImageUrl && createPortal(
        <div
          onClick={() => setPreviewImageUrl(null)}
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.9)",
            zIndex: 10000,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, cursor: "pointer",
            animation: "fadeSlideUp 0.25s ease-out",
          }}
        >
          <img
            src={previewImageUrl}
            alt="preview"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "100%", maxHeight: "100%",
              objectFit: "contain", borderRadius: 12,
              cursor: "default",
              animation: "springSlideUp 0.5s ease-out",
            }}
          />
          <button onClick={() => setPreviewImageUrl(null)} style={{
            position: "absolute", top: 16, right: 16,
            width: 40, height: 40, borderRadius: 20,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(0,0,0,0.5)", color: "#fff",
            fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}>
            {"\u2715"}
          </button>
        </div>,
        document.body
      )}

      {/* Session context menu (action sheet) */}
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
              animation: "springSlideUp 0.45s ease-out",
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
                    {s.worktreeBranch && (
                      <div style={{
                        fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                        color: "var(--accent-primary)", opacity: 0.8, marginTop: 2,
                      }}>
                        {s.worktreeBranch.replace(/^agentrune\//, "")}
                      </div>
                    )}
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

      {/* Bypass confirmation dialog */}
      {bypassConfirmPending && (
        <div
          onClick={cancelBypass}
          style={{
            position: "fixed", inset: 0, zIndex: 260,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.45)",
            animation: "springSlideUp 0.45s ease-out",
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
              {t("mc.bypassConfirmTitle") || "Enable Bypass Mode?"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, fontWeight: 500, lineHeight: 1.5 }}>
              {t("mc.bypassConfirmDesc") || "This allows the agent to execute commands without asking for permission. The agent can read, write, and delete files, run shell commands, and access the network without your approval."}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={cancelBypass}
                style={{
                  flex: 1, padding: 12, borderRadius: 14,
                  border: "1px solid var(--glass-border)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >
                {t("mc.cancelAction")}
              </button>
              <button
                onClick={confirmBypass}
                style={{
                  flex: 1, padding: 12, borderRadius: 14,
                  border: "none",
                  background: "#ef4444",
                  color: "#fff",
                  fontSize: 14, fontWeight: 700, cursor: "pointer",
                }}
              >
                {t("mc.bypassConfirmBtn") || "Enable Bypass"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ?????? Rename dialog ?????? */}
      {renamingSession && (
        <div
          onClick={() => setRenamingSession(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 250,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.45)",
            animation: "springSlideUp 0.45s ease-out",
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

      {/* Voice Overlay — single container, stopPropagation on interactive content */}
      {voicePhase && (
        <div onClick={mcCancelVoice} onTouchEnd={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); mcCancelVoice() } }} style={{
          position: "fixed", inset: 0, zIndex: 400,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        }}>
          {/* Context label badge (e.g. selected lines from DiffPanel) */}
          {voiceContextLabel && (
            <div style={{
              position: "absolute", top: "max(env(safe-area-inset-top), 16px)", left: 16,
              padding: "6px 12px", borderRadius: 10,
              background: "rgba(55,172,192,0.2)", border: "1px solid rgba(55,172,192,0.4)",
              color: "#37ACC0", fontSize: 12, fontWeight: 600, fontFamily: "monospace",
              backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
            }}>
              {voiceContextLabel}
            </div>
          )}
          {/* Preparing: engine initializing — show pulsing mic, user should wait */}
          {voicePhase === "preparing" && (
            <div onClick={(e) => e.stopPropagation()} style={{
              position: "absolute", inset: 0,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            }}>
              <div className="voice-preparing-pulse" style={{
                width: 100, height: 100, borderRadius: "50%",
                background: "rgba(55,172,192,0.15)",
                border: "2px solid rgba(55,172,192,0.4)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" x2="12" y1="19" y2="22"/>
                </svg>
              </div>
              <div style={{ marginTop: 20, color: "rgba(255,255,255,0.7)", fontSize: 15, fontWeight: 500 }}>
                {t("voice.preparing") || "Preparing..."}
              </div>
            </div>
          )}
          {/* Recording: engine is listening — show orbs + stop button */}
          {voicePhase === "recording" && (
            <>
              <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
                <div className="voice-orb voice-orb-teal" />
                <div className="voice-orb voice-orb-coral" />
                <div className="voice-orb voice-orb-purple" />
              </div>
              <div onClick={(e) => e.stopPropagation()} style={{
                position: "absolute", bottom: "calc(20vh + env(safe-area-inset-bottom, 0px))",
                left: 0, right: 0,
                display: "flex", flexDirection: "column", alignItems: "center",
              }}>
                {voicePartialText && (
                  <div style={{
                    marginBottom: 20, padding: "10px 16px", borderRadius: 14,
                    background: "rgba(255,255,255,0.08)", backdropFilter: "blur(8px)",
                    color: "rgba(255,255,255,0.85)", fontSize: 15, lineHeight: 1.5,
                    maxHeight: 120, maxWidth: "80vw", overflow: "auto", textAlign: "left",
                  }}>
                    {voicePartialText}
                  </div>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); mcStopVoice() }}
                  onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); mcStopVoice() }}
                  className="voice-stop-btn" style={{
                  width: 80, height: 80, borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.3)",
                  background: "rgba(255,255,255,0.15)",
                  color: "#fff", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 40px rgba(55,172,192,0.3), 0 0 80px rgba(251,129,132,0.15)",
                  position: "relative", zIndex: 10,
                  WebkitTapHighlightColor: "transparent",
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="white" stroke="none">
                    <rect x="5" y="5" width="14" height="14" rx="3" />
                  </svg>
                </button>
                <div style={{ marginTop: 16, color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: 500 }}>
                  {t("voice.tapToStop")}
                </div>
                <div style={{ marginTop: 8, color: "rgba(255,255,255,0.5)", fontSize: 24, fontWeight: 300, fontVariantNumeric: "tabular-nums" }}>
                  {Math.floor(voiceDuration / 60)}:{(voiceDuration % 60).toString().padStart(2, "0")}
                </div>
              </div>
            </>
          )}
          {voicePhase === "cleaning" && (
            <div onClick={(e) => e.stopPropagation()} style={{
              position: "absolute", inset: 0,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            }}>
              <span className="voice-spin" style={{
                width: 40, height: 40, border: "3px solid rgba(255,255,255,0.2)",
                borderTopColor: "#37ACC0", borderRadius: "50%", display: "inline-block",
              }} />
              <div style={{ marginTop: 16, color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: 500 }}>
                {t("voice.cleaning")}
              </div>
            </div>
          )}
          {voicePhase === "result" && (
            <div onClick={(e) => e.stopPropagation()} style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              borderRadius: "24px 24px 0 0",
              backgroundImage: "var(--sheet-bg)",
              backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
              border: "1px solid var(--glass-border)",
              boxShadow: "0 -8px 40px rgba(0,0,0,0.1)",
              padding: "16px 20px calc(16px + env(safe-area-inset-bottom, 0px))",
            }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--text-secondary)", opacity: 0.3, margin: "0 auto 12px" }} />
              {voiceText ? (
                <div style={{ position: "relative", marginBottom: 12 }}>
                  <textarea value={voiceText} onChange={(e) => setVoiceText(e.target.value)}
                    rows={voiceExpanded ? Math.min(Math.max(voiceText.split("\n").length + 2, 6), 14) : 4}
                    style={{
                      width: "100%", padding: "12px 14px", paddingRight: 36, borderRadius: 14,
                      border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                      color: "var(--text-primary)", fontSize: 14, lineHeight: 1.5,
                      outline: "none", boxSizing: "border-box", resize: "none",
                    }} />
                  <button onClick={() => setVoiceExpanded(v => !v)} style={{
                    position: "absolute", top: 8, right: 8, width: 24, height: 24,
                    borderRadius: 6, border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {voiceExpanded
                        ? <><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></>
                        : <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>
                      }
                    </svg>
                  </button>
                </div>
              ) : (
                <div style={{ padding: "16px", textAlign: "center", color: "var(--text-secondary)", fontSize: 14, marginBottom: 12 }}>
                  {t("voice.noContent")}
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                {voiceText.trim() && (
                  <button onClick={mcStartVoiceEdit} style={{
                    padding: "12px 16px", borderRadius: 14,
                    border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                    color: "#37ACC0", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    </svg>
                    {t("voice.tapToEdit")}
                  </button>
                )}
                <button onClick={() => { setVoiceText(""); mcStartVoice() }} style={{
                  flex: voiceText.trim() ? undefined : 1, padding: "12px 16px", borderRadius: 14,
                  border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                  color: "var(--text-secondary)", fontSize: 13, fontWeight: 500, cursor: "pointer",
                }}>
                  {t("voice.reRecord")}
                </button>
                {voiceText.trim() && (
                  <button onClick={mcSendVoice} style={{
                    flex: 1, padding: "12px", borderRadius: 14,
                    border: "1px solid rgba(251,129,132,0.4)",
                    background: "linear-gradient(135deg, rgba(251,129,132,0.18), rgba(208,152,153,0.14))",
                    color: "#FB8184", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    {t("voice.send")}
                  </button>
                )}
              </div>
            </div>
          )}
          <style>{`
            .voice-orb { position: absolute; width: 160px; height: 160px; border-radius: 50%; filter: blur(40px); will-change: transform, opacity; opacity: 0.8; }
            .voice-orb-teal { background: radial-gradient(circle, #37ACC0, rgba(52,119,146,0.4) 60%, transparent 80%); box-shadow: 0 0 60px rgba(55,172,192,0.5); animation: orbWander1 8s ease-in-out infinite, orbPulse 3s ease-in-out infinite; }
            .voice-orb-coral { background: radial-gradient(circle, #FB8184, rgba(208,152,153,0.4) 60%, transparent 80%); box-shadow: 0 0 60px rgba(251,129,132,0.5); animation: orbWander2 9s ease-in-out infinite, orbPulse 3.5s ease-in-out infinite 0.8s; }
            .voice-orb-purple { background: radial-gradient(circle, #a78bfa, rgba(139,92,246,0.3) 60%, transparent 80%); box-shadow: 0 0 50px rgba(139,92,246,0.4); width: 120px; height: 120px; animation: orbWander3 7s ease-in-out infinite, orbPulse 2.8s ease-in-out infinite 1.5s; }
            @keyframes orbPulse { 0%, 100% { transform: scale(1); filter: blur(40px); opacity: 0.7; } 30% { transform: scale(1.3); filter: blur(30px); opacity: 1; } 70% { transform: scale(0.85); filter: blur(50px); opacity: 0.5; } }
            @keyframes orbWander1 { 0% { top: 15%; left: 10%; } 20% { top: 60%; left: 65%; } 40% { top: 30%; left: 75%; } 60% { top: 70%; left: 20%; } 80% { top: 10%; left: 50%; } 100% { top: 15%; left: 10%; } }
            @keyframes orbWander2 { 0% { top: 70%; left: 75%; } 25% { top: 20%; left: 30%; } 50% { top: 50%; left: 5%; } 75% { top: 80%; left: 60%; } 100% { top: 70%; left: 75%; } }
            @keyframes orbWander3 { 0% { top: 40%; left: 45%; } 33% { top: 15%; left: 80%; } 66% { top: 75%; left: 15%; } 100% { top: 40%; left: 45%; } }
            .voice-preparing-pulse { animation: preparePulse 1.5s ease-in-out infinite; }
            @keyframes preparePulse { 0%, 100% { transform: scale(1); opacity: 0.7; } 50% { transform: scale(1.1); opacity: 1; } }
            .voice-stop-btn { animation: stopBtnGlow 2s ease-in-out infinite; }
            @keyframes stopBtnGlow { 0%, 100% { box-shadow: 0 0 40px rgba(55,172,192,0.3), 0 0 80px rgba(251,129,132,0.15); } 50% { box-shadow: 0 0 60px rgba(55,172,192,0.5), 0 0 100px rgba(251,129,132,0.25); } }
            @keyframes voiceSpin { to { transform: rotate(360deg); } }
            .voice-spin { animation: voiceSpin 0.8s linear infinite; }
          `}</style>
        </div>
      )}
      {/* API Key Input Modal */}
      {apiKeyModal && (() => {
        const agentKeyMap: Record<string, { envVar: string; url: string }> = {
          claude: { envVar: "ANTHROPIC_API_KEY", url: "https://console.anthropic.com/settings/keys" },
          codex: { envVar: "OPENAI_API_KEY", url: "https://platform.openai.com/api-keys" },
          gemini: { envVar: "GEMINI_API_KEY", url: "https://aistudio.google.com/apikey" },
          cursor: { envVar: "CURSOR_API_KEY", url: "https://cursor.com/settings" },
          aider: { envVar: "ANTHROPIC_API_KEY", url: "https://console.anthropic.com/settings/keys" },
          cline: { envVar: "ANTHROPIC_API_KEY", url: "https://console.anthropic.com/settings/keys" },
          openclaw: { envVar: "OPENROUTER_API_KEY", url: "https://openrouter.ai/keys" },
        }
        const info = agentKeyMap[apiKeyModal.agentId] || { envVar: "API_KEY", url: "" }
        const handleSave = () => {
          if (!apiKeyInput.trim()) return
          setApiKeySaving(true)
          send({ type: "save_api_key", envVar: info.envVar, value: apiKeyInput.trim(), autoSaveKeysPath: getAutoSaveKeysPath() })
          setEvents(prev => prev.map(e => e.id === apiKeyModal.eventId ? { ...e, status: "completed" as const } : e))
        }
        return (
          <div onClick={() => { setApiKeyModal(null); setApiKeyInput("") }} style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24,
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              width: "100%", maxWidth: 400,
              background: "var(--glass-bg)",
              backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
              border: "1px solid var(--glass-border)",
              borderRadius: 20,
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
              padding: 24,
              display: "flex", flexDirection: "column", gap: 16,
            }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#37ACC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
                <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>{t("mc.enterApiKey")}</span>
              </div>

              {/* Agent + env var */}
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {apiKeyModal.agentId.charAt(0).toUpperCase() + apiKeyModal.agentId.slice(1)} — <code style={{ background: "rgba(55,172,192,0.15)", padding: "2px 6px", borderRadius: 6, fontSize: 12, color: "#37ACC0" }}>{info.envVar}</code>
              </div>

              {/* Get key link */}
              {info.url && (
                <button onClick={() => {
                  import("@capacitor/browser").then(({ Browser }) => {
                    Browser.open({ url: info.url }).catch(() => window.open(info.url, "_blank"))
                  }).catch(() => window.open(info.url, "_blank"))
                }} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 14px", borderRadius: 12,
                  background: "rgba(55,172,192,0.1)",
                  border: "1px solid rgba(55,172,192,0.25)",
                  color: "#37ACC0", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", textAlign: "left",
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                  {t("mc.getApiKey")}
                </button>
              )}

              {/* Input */}
              <input
                type="password"
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSave() }}
                placeholder={info.envVar}
                autoFocus
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 12,
                  border: "1px solid var(--glass-border)",
                  background: "var(--input-bg, rgba(255,255,255,0.05))",
                  color: "var(--text-primary)", fontSize: 15,
                  fontFamily: "monospace", outline: "none",
                  boxSizing: "border-box",
                }}
              />

              {/* Buttons */}
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => { setApiKeyModal(null); setApiKeyInput("") }} style={{
                  flex: 1, padding: "12px 0", borderRadius: 12,
                  border: "1px solid var(--glass-border)",
                  background: "var(--glass-bg)", color: "var(--text-secondary)",
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}>{t("mc.cancel")}</button>
                <button onClick={handleSave} disabled={!apiKeyInput.trim() || apiKeySaving} style={{
                  flex: 1, padding: "12px 0", borderRadius: 12,
                  border: "none",
                  background: apiKeyInput.trim() ? "#37ACC0" : "rgba(55,172,192,0.3)",
                  color: "#fff",
                  fontSize: 14, fontWeight: 600, cursor: apiKeyInput.trim() ? "pointer" : "default",
                  opacity: apiKeySaving ? 0.6 : 1,
                }}>{apiKeySaving ? "..." : t("mc.saveAndRestart")}</button>
              </div>
            </div>
          </div>
        )
      })()}
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          zIndex: 10000, padding: "10px 20px", borderRadius: 12,
          background: "var(--glass-bg)", backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)", border: "1px solid var(--glass-border)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)", color: "var(--text-primary)",
          fontSize: 13, fontWeight: 500, maxWidth: "85vw", textAlign: "center",
          animation: "fadeInUp 0.3s ease-out",
        }}>
          {toast}
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
