import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { createPortal } from "react-dom"
import { Clipboard } from "@capacitor/clipboard"
import { App as CapApp } from "@capacitor/app"
import type { SlashCommand } from "../types"
import { useLocale } from "../lib/i18n/index.js"

const AGENTLORE_MCP_URL = "https://agentlore.vercel.app/api/mcp"

// Built-in MCP skills — always available regardless of API
// i18n keys for trigger/steps/gotchas
const BUILTIN_MCP_SKILLS_RAW = [
  // ── Memory ─────────────────────────────────────────
  {
    skill: "remember",
    triggerKey: "skill.remember.trigger",
    stepsKeys: [
      "skill.remember.step1",
      "skill.remember.step2",
      "skill.remember.step3",
      "skill.remember.step4",
    ],
    gotchasKeys: [
      "skill.remember.gotcha1",
      "skill.remember.gotcha2",
    ],
    tools: ["memory", "agentlore"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  {
    skill: "recall",
    triggerKey: "skill.recall.trigger",
    stepsKeys: [
      "skill.recall.step1",
      "skill.recall.step2",
      "skill.recall.step3",
    ],
    gotchasKeys: [
      "skill.recall.gotcha1",
    ],
    tools: ["memory", "agentlore"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  // ── Onboarding ─────────────────────────────────────
  {
    skill: "init",
    triggerKey: "skill.init.trigger",
    stepsKeys: [
      "skill.init.step1",
      "skill.init.step2",
      "skill.init.step3",
      "skill.init.step4",
      "skill.init.step5",
    ],
    gotchasKeys: [
      "skill.init.gotcha1",
      "skill.init.gotcha2",
    ],
    tools: ["memory", "agentlore"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  {
    skill: "onboard",
    triggerKey: "skill.onboard.trigger",
    stepsKeys: [
      "skill.onboard.step1",
      "skill.onboard.step2",
      "skill.onboard.step3",
      "skill.onboard.step4",
    ],
    gotchasKeys: [
      "skill.onboard.gotcha1",
    ],
    tools: ["memory", "agentlore"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  // ── Planning & Design ──────────────────────────────
  {
    skill: "brainstorm",
    triggerKey: "skill.brainstorm.trigger",
    stepsKeys: [
      "skill.brainstorm.step1",
      "skill.brainstorm.step2",
      "skill.brainstorm.step3",
      "skill.brainstorm.step4",
      "skill.brainstorm.step5",
    ],
    gotchasKeys: [
      "skill.brainstorm.gotcha1",
      "skill.brainstorm.gotcha2",
    ],
    tools: ["brainstorming", "writing-plans"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  {
    skill: "plan",
    triggerKey: "skill.plan.trigger",
    stepsKeys: [
      "skill.plan.step1",
      "skill.plan.step2",
      "skill.plan.step3",
      "skill.plan.step4",
      "skill.plan.step5",
    ],
    gotchasKeys: [
      "skill.plan.gotcha1",
    ],
    tools: ["writing-plans", "executing-plans"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  // ── Implementation ─────────────────────────────────
  {
    skill: "tdd",
    triggerKey: "skill.tdd.trigger",
    stepsKeys: [
      "skill.tdd.step1",
      "skill.tdd.step2",
      "skill.tdd.step3",
      "skill.tdd.step4",
      "skill.tdd.step5",
    ],
    gotchasKeys: [
      "skill.tdd.gotcha1",
    ],
    tools: ["test-driven-development"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  {
    skill: "fix",
    triggerKey: "skill.fix.trigger",
    stepsKeys: [
      "skill.fix.step1",
      "skill.fix.step2",
      "skill.fix.step3",
    ],
    gotchasKeys: [
      "skill.fix.gotcha1",
    ],
    tools: ["debug-error"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  {
    skill: "debug",
    triggerKey: "skill.debug.trigger",
    stepsKeys: [
      "skill.debug.step1",
      "skill.debug.step2",
      "skill.debug.step3",
      "skill.debug.step4",
      "skill.debug.step5",
    ],
    gotchasKeys: [
      "skill.debug.gotcha1",
    ],
    tools: ["systematic-debugging"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  {
    skill: "refactor",
    triggerKey: "skill.refactor.trigger",
    stepsKeys: [
      "skill.refactor.step1",
      "skill.refactor.step2",
      "skill.refactor.step3",
      "skill.refactor.step4",
    ],
    gotchasKeys: [
      "skill.refactor.gotcha1",
    ],
    tools: ["simplify"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  // ── Quality & Review ───────────────────────────────
  {
    skill: "review",
    triggerKey: "skill.review.trigger",
    stepsKeys: [
      "skill.review.step1",
      "skill.review.step2",
      "skill.review.step3",
      "skill.review.step4",
    ],
    gotchasKeys: [
      "skill.review.gotcha1",
    ],
    tools: ["requesting-code-review"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  {
    skill: "security",
    triggerKey: "skill.security.trigger",
    stepsKeys: [
      "skill.security.step1",
      "skill.security.step2",
      "skill.security.step3",
    ],
    gotchasKeys: [
      "skill.security.gotcha1",
    ],
    tools: ["security-review"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  // ── Shipping ────────────────────────────────────────
  {
    skill: "test",
    triggerKey: "skill.test.trigger",
    stepsKeys: [
      "skill.test.step1",
      "skill.test.step2",
      "skill.test.step3",
      "skill.test.step4",
    ],
    gotchasKeys: [
      "skill.test.gotcha1",
    ],
    tools: ["test-runner"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  {
    skill: "commit",
    triggerKey: "skill.commit.trigger",
    stepsKeys: [
      "skill.commit.step1",
      "skill.commit.step2",
      "skill.commit.step3",
    ],
    gotchasKeys: [
      "skill.commit.gotcha1",
    ],
    tools: ["commit"],
    confidence: 1.0,
    sources: ["built-in"],
  },
  {
    skill: "doc",
    triggerKey: "skill.doc.trigger",
    stepsKeys: [
      "skill.doc.step1",
      "skill.doc.step2",
      "skill.doc.step3",
    ],
    gotchasKeys: [
      "skill.doc.gotcha1",
    ],
    tools: [],
    confidence: 1.0,
    sources: ["built-in"],
  },
  {
    skill: "pr",
    triggerKey: "skill.pr.trigger",
    stepsKeys: [
      "skill.pr.step1",
      "skill.pr.step2",
      "skill.pr.step3",
      "skill.pr.step4",
    ],
    gotchasKeys: [
      "skill.pr.gotcha1",
    ],
    tools: [],
    confidence: 1.0,
    sources: ["built-in"],
  },
  // ── Utilities ──────────────────────────────────────
  {
    skill: "explain",
    triggerKey: "skill.explain.trigger",
    stepsKeys: [
      "skill.explain.step1",
      "skill.explain.step2",
      "skill.explain.step3",
      "skill.explain.step4",
    ],
    gotchasKeys: [],
    tools: [],
    confidence: 1.0,
    sources: ["built-in"],
  },
]

interface SkillCard {
  skill: string
  trigger: string
  steps: string[]
  gotchas: string[]
  tools: string[]
  confidence: number
  sources: string[]
}

export interface SendFlags {
  interrupt?: boolean
  task?: boolean
}

// --- Input syntax highlighting ---
// Tokenizes input text and renders with different styles for URLs, slash commands, file paths
function highlightInput(text: string) {
  // Regex patterns for different token types
  const TOKEN_RE = /(?:https?:\/\/[^\s]+)|(?:\/[a-zA-Z][\w-]*(?:\s+\S+)?)|(?:(?:[A-Z]:\\|[~/.])[^\s]*)/g
  const parts: { text: string; type: "plain" | "url" | "command" | "path" }[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), type: "plain" })
    }
    const m = match[0]
    if (/^https?:\/\//.test(m)) {
      parts.push({ text: m, type: "url" })
    } else if (m.startsWith("/")) {
      parts.push({ text: m, type: "command" })
    } else {
      parts.push({ text: m, type: "path" })
    }
    lastIndex = match.index + m.length
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), type: "plain" })
  }

  const STYLES: Record<string, React.CSSProperties> = {
    plain: { color: "var(--text-primary)" },
    url: { color: "#37ACC0", textDecoration: "underline", textDecorationColor: "rgba(55,172,192,0.3)" },
    command: { color: "#a78bfa", fontWeight: 600 },
    path: { color: "#f59e0b", background: "rgba(245,158,11,0.08)", borderRadius: 3, padding: "0 2px" },
  }

  return parts.map((p, i) => (
    <span key={i} style={STYLES[p.type]}>{p.text}</span>
  ))
}

interface InputBarProps {
  onSend: (text: string, flags?: SendFlags) => void
  onImagePaste?: (base64: string, filename: string) => void
  onBrowse?: () => void
  onVoice?: () => void
  onInsight?: () => void
  autoFocus?: boolean
  slashCommands?: SlashCommand[]
  prefill?: string
  onPrefillConsumed?: () => void
  draftKey?: string
  attachedFiles?: string[]
  onRemoveFile?: (path: string) => void
}

// Module-level draft storage — survives unmount/remount
const _inputDrafts = new Map<string, string>()
const _imageDrafts = new Map<string, string[]>()

interface SentItem {
  text: string
  time: number
}

// Module-level: survives component unmount/remount (view switches)
let _sentHistory: SentItem[] = []
const _listeners = new Set<() => void>()
function pushSent(item: SentItem) {
  _sentHistory = [..._sentHistory, item].slice(-20)
  _listeners.forEach((fn) => fn())
}
function useSentHistory(): [SentItem[], (item: SentItem) => void] {
  const [, setTick] = useState(0)
  useEffect(() => {
    const fn = () => setTick((t) => t + 1)
    _listeners.add(fn)
    return () => { _listeners.delete(fn) }
  }, [])
  return [_sentHistory, pushSent]
}

export function InputBar({ onSend, onImagePaste, onBrowse, onVoice, onInsight, autoFocus = true, slashCommands, prefill, onPrefillConsumed, draftKey, attachedFiles, onRemoveFile }: InputBarProps) {
  const { t, locale } = useLocale()
  const [input, setInputRaw] = useState(() => (draftKey ? _inputDrafts.get(draftKey) : null) || "")
  const setInput = useCallback((val: string | ((prev: string) => string)) => {
    if (typeof val === "function") {
      setInputRaw(prev => {
        const next = val(prev)
        if (draftKey) _inputDrafts.set(draftKey, next)
        return next
      })
    } else {
      setInputRaw(val)
      if (draftKey) _inputDrafts.set(draftKey, val)
    }
  }, [draftKey])
  const [pasteImages, setPasteImagesRaw] = useState<string[]>(() => (draftKey ? _imageDrafts.get(draftKey) : null) || [])
  const setPasteImages = useCallback((val: string[] | ((prev: string[]) => string[])) => {
    setPasteImagesRaw(prev => {
      const next = typeof val === "function" ? val(prev) : val
      if (draftKey) _imageDrafts.set(draftKey, next)
      return next
    })
  }, [draftKey])
  const [confirmRemove, setConfirmRemove] = useState<{ type: "image" | "file"; index?: number; path?: string } | null>(null)
  const [previewImage, setPreviewImageRaw] = useState<string | null>(null)
  const setPreviewImage = useCallback((img: string | null) => { setPreviewImageRaw(img) }, [])
  // Android back button closes preview via app:back event
  useEffect(() => {
    if (!previewImage) return
    const onBack = (e: Event) => { e.preventDefault(); setPreviewImageRaw(null) }
    document.addEventListener("app:back", onBack)
    return () => document.removeEventListener("app:back", onBack)
  }, [previewImage])
  const [isListening, setIsListening] = useState(false)
  const [expandedEditor, setExpandedEditor] = useState(false)
  const [interruptMode, setInterruptMode] = useState(false)
  const [taskMode, setTaskMode] = useState(false)
  const [sentHistory, addSent] = useSentHistory()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const slashPanelRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  // Prefill from quote
  useEffect(() => {
    if (prefill) {
      setInput(prefill)
      onPrefillConsumed?.()
      inputRef.current?.focus()
    }
  }, [prefill])

  // Always show voice button — native Capacitor plugin handles speech recognition
  const hasSpeechSupport = typeof window !== "undefined"

  // Android back button closes expanded editor
  useEffect(() => {
    if (!expandedEditor) return
    const handler = (e: Event) => {
      e.preventDefault()
      setExpandedEditor(false)
    }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [expandedEditor])

  // MCP skill search
  const [mcpSkills, setMcpSkills] = useState<SkillCard[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpScenario, setMcpScenario] = useState<string | null>(null)
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
  const mcpDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchMcpSkills = useCallback((query: string) => {
    if (mcpDebounce.current) clearTimeout(mcpDebounce.current)
    if (query.length < 2) { setMcpSkills([]); setMcpScenario(null); return }
    setMcpLoading(true)
    mcpDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(AGENTLORE_MCP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: "find_skills", arguments: { query, limit: 5 } }),
        })
        const data = await res.json()
        const textPayload = data.result?.[0]?.text || data.content?.[0]?.text || "{}"
        const parsed = JSON.parse(textPayload)
        setMcpSkills(parsed.skills || [])
        setMcpScenario(parsed.matched_scenario || parsed.hint || null)
      } catch {
        setMcpSkills([])
        setMcpScenario(null)
      } finally {
        setMcpLoading(false)
      }
    }, 400)
  }, [])

  // Resolve built-in skills with i18n
  const BUILTIN_MCP_SKILLS: SkillCard[] = useMemo(() =>
    BUILTIN_MCP_SKILLS_RAW.map(raw => ({
      skill: raw.skill,
      trigger: t(raw.triggerKey),
      steps: raw.stepsKeys.map(k => t(k)),
      gotchas: raw.gotchasKeys.map(k => t(k)),
      tools: raw.tools,
      confidence: raw.confidence,
      sources: raw.sources,
    }))
  , [t])

  // Fuzzy keyword aliases for skill matching (Chinese + English synonyms)
  const SKILL_KEYWORDS: Record<string, string[]> = useMemo(() => ({
    remember: ["記住", "記", "記憶", "remember", "save", "store", "memo", "筆記", "note", "記下來", "別忘了", "偏好", "preference", "convention", "慣例"],
    recall: ["回想", "想起", "recall", "回憶", "查看", "what did", "之前", "previously", "history", "記得", "上次", "last time", "備忘", "memo"],
    init: ["初始化", "init", "setup", "bootstrap", "開始", "新專案", "new project", "agentlore", "設定"],
    onboard: ["了解", "onboard", "上手", "熟悉", "context", "上下文", "這個專案", "codebase", "結構", "架構", "怎麼用"],
    brainstorm: ["腦力激盪", "設計", "想法", "idea", "design", "feature", "功能", "構想", "需求"],
    plan: ["計畫", "規劃", "plan", "實作", "implement", "步驟", "task", "任務", "架構"],
    tdd: ["測試", "test", "tdd", "驅動", "unit test", "單元測試", "先寫測試", "coverage"],
    fix: ["修", "fix", "快修", "hotfix", "patch", "壞了", "broken", "不能用", "失敗", "failed"],
    debug: ["除錯", "修復", "bug", "錯誤", "error", "偵錯", "問題", "crash", "exception"],
    refactor: ["重構", "refactor", "整理", "簡化", "simplify", "clean", "優化", "重寫", "改善"],
    review: ["審查", "檢查", "review", "code review", "程式碼", "檢視", "品質", "pr"],
    security: ["安全", "security", "漏洞", "vulnerability", "xss", "injection", "owasp", "auth", "認證"],
    test: ["測試", "test", "跑測試", "run tests", "失敗", "fail", "pass", "suite", "coverage", "jest", "vitest", "pytest"],
    commit: ["提交", "commit", "git", "推送", "push", "儲存", "版本", "message", "conventional"],
    doc: ["文件", "doc", "文檔", "readme", "documentation", "更新文件", "changelog", "jsdoc", "說明文件"],
    pr: ["pr", "pull request", "合併", "merge", "開 pr", "create pr", "github", "gitlab", "發 pr"],
    explain: ["解釋", "explain", "說明", "理解", "understand", "讀懂", "什麼意思", "how", "why", "原理"],
  }), [])

  // Filter built-in skills by query (/ trigger) with fuzzy matching
  const filteredBuiltins = useMemo(() => {
    if (!input.startsWith("/")) return []
    // // prefix = raw MCP command mode, don't show skill cards
    if (input.startsWith("//")) return []
    const q = input.slice(1).trim().toLowerCase()
    if (!q) return BUILTIN_MCP_SKILLS
    return BUILTIN_MCP_SKILLS.filter(s => {
      // Direct match on skill name or trigger text
      if (s.skill.toLowerCase().includes(q) || s.trigger.toLowerCase().includes(q)) return true
      // Match steps content
      if (s.steps.some(step => step.toLowerCase().includes(q))) return true
      // Fuzzy keyword match
      const keywords = SKILL_KEYWORDS[s.skill] || []
      return keywords.some(kw => kw.toLowerCase().includes(q) || q.includes(kw.toLowerCase()))
    })
  }, [input, BUILTIN_MCP_SKILLS, SKILL_KEYWORDS])

  // Trigger MCP search when input starts with / (but not //)
  useEffect(() => {
    if (input.startsWith("/") && !input.startsWith("//")) {
      const query = input.slice(1).trim()
      searchMcpSkills(query)
    } else {
      setMcpSkills([])
      setMcpScenario(null)
      setExpandedSkill(null)
    }
  }, [input, searchMcpSkills])

  const hasClipboardSupport = true // Capacitor Clipboard plugin always available

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
        recognitionRef.current = null
      }
    }
  }, [])

  const toggleVoice = () => {
    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }

    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognitionCtor) return

    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = locale === "zh-TW" ? "zh-TW" : "en-US"

    // Track finalized text vs interim preview
    let finalizedText = ""

    recognition.onresult = (event: any) => {
      let interim = ""
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalizedText += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }
      const full = finalizedText + interim
      setInput(prev => {
        // Preserve any text typed before voice started
        const prefix = prev.trim() && !prev.includes(finalizedText) ? prev.trim() + " " : ""
        return prefix + full
      })
    }

    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }

  // ─── Clipboard history ───
  const [showClipboard, setShowClipboard] = useState(false)
  const [clipHistory, setClipHistory] = useState<{ text: string; time: number; isImage?: boolean }[]>(() => {
    try { return JSON.parse(localStorage.getItem("clipboard_history") || "[]") } catch { return [] }
  })

  const saveClipHistory = (items: typeof clipHistory) => {
    const capped = items.slice(0, 30) // keep last 30
    setClipHistory(capped)
    localStorage.setItem("clipboard_history", JSON.stringify(capped))
  }

  const addToClipHistory = (text: string, isImage = false) => {
    if (!text || text.length < 1) return
    // Dedupe: don't add if same as most recent
    setClipHistory(prev => {
      if (prev[0]?.text === text) return prev
      const next = [{ text, time: Date.now(), isImage }, ...prev.filter(h => h.text !== text)].slice(0, 30)
      localStorage.setItem("clipboard_history", JSON.stringify(next))
      return next
    })
  }

  // Read system clipboard and add to history
  const readSystemClipboard = async () => {
    try {
      const { type, value } = await Clipboard.read()
      if (value && (type === "string" || type === "text/plain" || type?.startsWith("text/"))) {
        addToClipHistory(value)
      } else if (type?.startsWith("image/") && value) {
        addToClipHistory(value, true)
      }
    } catch {
      try {
        const text = await navigator.clipboard.readText()
        if (text) addToClipHistory(text)
      } catch { /* ok */ }
    }
  }

  const handleClipboardOpen = async () => {
    await readSystemClipboard()
    setShowClipboard(true)
  }

  // Auto-read clipboard when app regains focus (builds history over time)
  useEffect(() => {
    const onFocus = () => { readSystemClipboard() }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") readSystemClipboard()
    })
    return () => { window.removeEventListener("focus", onFocus) }
  }, [])

  const handleClipItemPaste = (item: typeof clipHistory[0]) => {
    if (item.isImage && onImagePaste) {
      onImagePaste(item.text, "clipboard.png")
    } else {
      setInput(prev => prev + item.text)
      inputRef.current?.focus()
    }
    setShowClipboard(false)
  }

  // Prevent slash panel scroll from propagating to parent (non-passive required)
  useEffect(() => {
    const el = slashPanelRef.current
    if (!el) return
    let lastY = 0
    const onTouchStart = (e: TouchEvent) => { lastY = e.touches[0].clientY }
    const onTouchMove = (e: TouchEvent) => {
      const dy = e.touches[0].clientY - lastY
      lastY = e.touches[0].clientY
      const atTop = el.scrollTop <= 0
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      // Scrolling up at top, or scrolling down at bottom → block
      if ((atTop && dy > 0) || (atBottom && dy < 0)) {
        e.preventDefault()
      }
      e.stopPropagation()
    }
    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchmove", onTouchMove, { passive: false })
    return () => {
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchmove", onTouchMove)
    }
  })

  // Hardware back button closes clipboard panel
  useEffect(() => {
    if (!showClipboard) return
    const onBack = (e: Event) => { e.preventDefault(); setShowClipboard(false) }
    document.addEventListener("app:back", onBack)
    return () => document.removeEventListener("app:back", onBack)
  }, [showClipboard])

  // Document-level paste listener: catches image paste from Samsung keyboard clipboard
  // that <input type="text"> can't handle natively
  useEffect(() => {
    const handleDocPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items || !onImagePaste) return
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault()
          const file = item.getAsFile()
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            const base64 = reader.result as string
            setPasteImages(prev => [...prev, base64])
            addToClipHistory(base64, true)
            onImagePaste(base64, `paste.${file.type.split("/")[1] || "png"}`)
          }
          reader.readAsDataURL(file)
          return
        }
      }
    }
    document.addEventListener("paste", handleDocPaste)
    return () => document.removeEventListener("paste", handleDocPaste)
  }, [onImagePaste])

  // Fixed height textarea — use expand button for long content
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "42px"
  }, [input])

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [autoFocus])

  // Auto-scroll history to bottom when new items arrive
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight
    }
  }, [sentHistory.length])

  const handleSend = () => {
    const trimmed = input.trim()
    const hasFiles = attachedFiles && attachedFiles.length > 0
    if (!trimmed && pasteImages.length === 0 && !hasFiles) {
      onSend("\r")
      return
    }
    const flags: SendFlags = {
      interrupt: interruptMode || undefined,
      task: taskMode || undefined,
    }
    // Build message: user text + attached file paths
    let toSend = input.startsWith("//") ? input.slice(1) : input
    if (hasFiles) {
      const filePaths = attachedFiles!.join("\n")
      toSend = toSend ? `${toSend}\n${filePaths}` : filePaths
    }
    if (toSend.trim()) {
      addSent({ text: trimmed || attachedFiles![0], time: Date.now() })
      onSend(toSend, flags)
    } else if (pasteImages.length > 0) {
      onSend("", flags)
    }
    setInput("")
    setPasteImages([])
    setExpandedEditor(false)
    setInterruptMode(false)
    setTaskMode(false)
    // Clear attached files via callback
    if (hasFiles && onRemoveFile) attachedFiles!.forEach(f => onRemoveFile(f))
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSend()
    }
    if (e.key === "c" && e.ctrlKey) {
      e.preventDefault()
      onSend("\x03")
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    // Save pasted text to clipboard history
    const pastedText = e.clipboardData?.getData("text/plain")
    if (pastedText) addToClipHistory(pastedText)

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) return

        const reader = new FileReader()
        reader.onload = () => {
          const base64 = reader.result as string
          setPasteImages(prev => [...prev, base64])
          addToClipHistory(base64, true)
          onImagePaste?.(base64, `paste.${file.type.split("/")[1] || "png"}`)
        }
        reader.readAsDataURL(file)
        return
      }
    }
  }

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = reader.result as string
        setPasteImages(prev => [...prev, base64])
        onImagePaste?.(base64, file.name || `image.${file.type.split("/")[1] || "png"}`)
      }
      reader.readAsDataURL(file)
    }
    // Reset so same file can be picked again
    e.target.value = ""
  }

  // Tap to resend
  const handleResend = (text: string) => {
    setInput(text)
    inputRef.current?.focus()
  }

  const hasInput = input.trim().length > 0 || pasteImages.length > 0

  // Native slash command suggestions — show with // trigger
  const filteredSlash = useMemo(() => {
    if (!slashCommands || !input.startsWith("//")) return []
    const q = "/" + input.slice(2).toLowerCase()
    if (q === "/") return slashCommands
    return slashCommands.filter((c) => c.command.toLowerCase().startsWith(q))
  }, [input, slashCommands])

  // / = skill cards mode, // = native commands mode
  const isSlashMode = input.startsWith("/")
  const isNativeMode = input.startsWith("//")

  const handleSlashSelect = (cmd: SlashCommand) => {
    addSent({ text: cmd.command, time: Date.now() })
    onSend(cmd.command)
    setInput("")
    inputRef.current?.focus()
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`
  }

  const handleSkillSelect = (skill: SkillCard) => {
    // Format skill steps as instructions and send to agent
    const instructions = [
      `[AgentLore Skill: ${skill.skill}]`,
      ...skill.steps.map((s, i) => `${i + 1}. ${s}`),
      ...(skill.gotchas.length > 0 ? [`\nGotchas: ${skill.gotchas.join("; ")}`] : []),
    ].join("\n")
    addSent({ text: `/${skill.skill}`, time: Date.now() })
    onSend(instructions)
    setInput("")
    setMcpSkills([])
    setExpandedSkill(null)
    inputRef.current?.focus()
  }

  return (
    <div style={{ flexShrink: 0, position: "relative" }}>
      {/* / = Skill cards panel, // = Native commands panel */}
      {isSlashMode && (filteredBuiltins.length > 0 || mcpSkills.length > 0 || mcpLoading || filteredSlash.length > 0) && (() => {
        const apiNames = new Set(mcpSkills.map(s => s.skill))
        const mergedSkills = [
          ...filteredBuiltins.filter(b => !apiNames.has(b.skill)),
          ...mcpSkills,
        ]
        return (
        <div
          ref={slashPanelRef}
          style={{
          position: "absolute",
          bottom: "100%",
          left: 0, right: 0,
          maxHeight: "36vh",
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: "8px 12px 6px",
          background: "var(--bg-gradient, var(--glass-bg))",
          borderTop: "1px solid var(--glass-border)",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.08)",
          zIndex: 10,
          WebkitOverflowScrolling: "touch" as never,
        }}>
          {/* AgentLore Skills section */}
          {(mergedSkills.length > 0 || mcpLoading) && (
            <>
              <div style={{
                fontSize: 10, fontWeight: 700, color: "var(--accent-primary)",
                textTransform: "uppercase", letterSpacing: 1.2,
                padding: "4px 8px",
              }}>
                {mcpScenario || t("mcp.skillsTitle")}
              </div>
              {mcpLoading && mergedSkills.length === 0 && (
                <div style={{
                  padding: "12px 14px", fontSize: 13,
                  color: "var(--text-secondary)", textAlign: "center",
                }}>
                  {t("mcp.searchingSkills")}
                </div>
              )}
              {mergedSkills.map((skill) => {
                const isOpen = expandedSkill === skill.skill
                const pct = Math.round(skill.confidence * 100)
                return (
                  <div key={skill.skill} style={{
                    borderRadius: 10,
                    border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)",
                    overflow: "hidden",
                    marginBottom: 6,
                  }}>
                    <button
                      onClick={() => setExpandedSkill(isOpen ? null : skill.skill)}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        border: "none",
                        background: "transparent",
                        color: "var(--text-primary)",
                        cursor: "pointer",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 700, fontSize: 13,
                        color: "var(--accent-primary)",
                        flexShrink: 0,
                      }}>
                        /{skill.skill}
                      </span>
                      <span style={{
                        fontSize: 11, color: "var(--text-secondary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        flex: 1,
                      }}>
                        {skill.trigger}
                      </span>
                      <span style={{
                        fontSize: 9, flexShrink: 0,
                        color: pct >= 100 ? "#22c55e" : "var(--text-secondary)",
                        opacity: pct >= 100 ? 1 : 0.6,
                        fontWeight: pct >= 100 ? 600 : 400,
                      }}>
                        {pct >= 100 ? t("mcp.verified") || "Verified" : `${pct}%`}
                      </span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, flexShrink: 0, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {isOpen && (
                      <div style={{ padding: "0 14px 12px" }}>
                        <div style={{
                          fontSize: 12, color: "var(--text-secondary)",
                          lineHeight: 1.6, marginBottom: 10,
                        }}>
                          {skill.steps.map((step, i) => (
                            <div key={i} style={{ marginBottom: 4 }}>
                              <span style={{ color: "var(--accent-primary)", fontWeight: 600 }}>{i + 1}.</span> {step}
                            </div>
                          ))}
                          {skill.gotchas.length > 0 && (
                            <div style={{ marginTop: 6, color: "#f59e0b", fontSize: 11 }}>
                              {skill.gotchas.map((g, i) => (
                                <div key={i}>⚠ {g}</div>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleSkillSelect(skill)}
                          style={{
                            width: "100%",
                            padding: "8px 12px", borderRadius: 10,
                            border: "1px solid var(--accent-primary)",
                            background: "var(--accent-primary-bg)",
                            color: "var(--accent-primary)",
                            fontSize: 12, fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {t("input.send") || "Send"} /{skill.skill}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}

          {/* Native commands section */}
          {filteredSlash.length > 0 && (
            <>
              <div style={{
                fontSize: 10, fontWeight: 700, color: "var(--text-secondary)",
                textTransform: "uppercase", letterSpacing: 1.2,
                padding: "4px 8px",
                marginTop: mergedSkills.length > 0 ? 4 : 0,
              }}>
                {t("mcp.nativeCommands")}
              </div>
              {filteredSlash.map((cmd) => (
                <button
                  key={cmd.command}
                  onClick={() => handleSlashSelect(cmd)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    marginBottom: 6,
                    borderRadius: 10,
                    border: "1px solid var(--glass-border)",
                    background: "var(--glass-bg)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span style={{
                    fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                    fontWeight: 700,
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    flexShrink: 0,
                  }}>
                    {cmd.command}
                  </span>
                  <span style={{
                    fontSize: 11,
                    color: "var(--text-secondary)",
                    fontWeight: 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {(() => { const k = `slash.${cmd.command.slice(1)}`; const v = t(k); return v !== k ? v : cmd.description })()}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
        )
      })()}

      {/* Attachments bar — images + files, horizontal scroll */}
      {(pasteImages.length > 0 || (attachedFiles && attachedFiles.length > 0)) && (
        <div style={{
          padding: "8px 14px",
          margin: "0 12px 8px",
          borderRadius: 16,
          background: "var(--glass-bg)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--glass-border)",
        }}>
          <div style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            WebkitOverflowScrolling: "touch" as never,
            paddingBottom: 2,
          }}>
            {/* Image thumbnails — tap to preview, X to remove (with confirm) */}
            {pasteImages.map((img, i) => (
              <div key={`img_${i}`} style={{ position: "relative", flexShrink: 0, padding: 4 }}>
                <img src={img} alt={`preview ${i + 1}`} onClick={() => setPreviewImage(img)} style={{
                  width: 72, height: 72, objectFit: "cover",
                  borderRadius: 12, border: "1px solid var(--glass-border)",
                  cursor: "pointer",
                }} />
                <button onClick={() => setConfirmRemove({ type: "image", index: i })} style={{
                  position: "absolute", top: 0, right: 0,
                  width: 22, height: 22, borderRadius: 11,
                  border: "1px solid var(--glass-border)",
                  background: "rgba(0,0,0,0.7)", color: "#fff",
                  fontSize: 12, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 0, lineHeight: 1,
                }}>
                  {"\u2715"}
                </button>
              </div>
            ))}
            {/* File badges — tap to browse that folder, X to remove */}
            {attachedFiles?.map((fp) => {
              const name = fp.split(/[/\\]/).pop() || fp
              return (
                <div key={fp} onClick={() => {
                  // Tap badge → open browser at that file's folder
                  if (onRemoveFile) onRemoveFile(fp)
                  // Re-open browse (handled by parent via onBrowse)
                  onBrowse?.()
                }} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 10px", borderRadius: 10, flexShrink: 0,
                  background: "rgba(245,158,11,0.08)",
                  border: "1px solid rgba(245,158,11,0.2)",
                  cursor: "pointer", maxWidth: 160,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#f59e0b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}
                  </span>
                  <button onClick={(e) => {
                    e.stopPropagation()
                    setConfirmRemove({ type: "file", path: fp })
                  }} style={{
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    color: "rgba(245,158,11,0.5)", display: "flex", flexShrink: 0,
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Sent command history — persistent, scrollable */}
      {sentHistory.length > 0 && (
        <div
          ref={historyRef}
          style={{
            maxHeight: 120,
            overflowY: "auto",
            padding: "4px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 3,
            WebkitOverflowScrolling: "touch" as never,
          }}
        >
          {sentHistory.filter((s) => !s.text.startsWith("/")).slice(-2).map((item) => (
            <div
              key={item.time}
              onClick={() => handleResend(item.text)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 10px",
                borderRadius: 10,
                background: "rgba(96, 165, 250, 0.06)",
                border: "1px solid rgba(96, 165, 250, 0.12)",
                cursor: "pointer",
                animation: "fadeSlideUp 0.15s ease-out",
              }}
            >
              <span style={{
                fontSize: 10,
                color: "rgba(96, 165, 250, 0.5)",
                fontFamily: "monospace",
                flexShrink: 0,
              }}>
                {formatTime(item.time)}
              </span>
              <span style={{
                fontSize: 10,
                color: "rgba(74, 222, 128, 0.7)",
                flexShrink: 0,
                fontWeight: 600,
              }}>
                {"->"}
              </span>
              <span style={{
                fontSize: 12,
                color: "var(--text-primary)",
                fontFamily: "'JetBrains Mono', monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                opacity: 0.85,
              }}>
                {item.text}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar row — actions + one-shot toggles */}
      <div style={{
        display: "flex",
        gap: 6,
        padding: "6px 12px 2px",
        alignItems: "center",
        flexShrink: 0,
      }}>
        {/* Clipboard — leftmost */}
        {hasClipboardSupport && (
          <button onClick={handleClipboardOpen} title={t("input.pasteClipboard")} style={toolbarBtnStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
          </button>
        )}

        {/* Browse files */}
        {onBrowse && (
          <button onClick={onBrowse} title={t("input.browseFiles")} style={toolbarBtnStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        )}

        {/* Image pick */}
        {onImagePaste && (
          <>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFilePick} style={{ display: "none" }} />
            <button onClick={() => fileInputRef.current?.click()} title={t("input.attachImage") || "Attach image"} style={toolbarBtnStyle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
          </>
        )}

        {/* Insight submit */}
        {onInsight && (
          <button onClick={onInsight} title="Submit Insight" style={toolbarBtnStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18h6" />
              <path d="M10 22h4" />
              <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
            </svg>
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Interrupt toggle — one-shot */}
        <button
          onClick={() => { const next = !interruptMode; setInterruptMode(next); if (next) setTaskMode(false) }}
          style={{
            padding: "5px 10px",
            borderRadius: 10,
            border: interruptMode ? "1.5px solid rgba(239,68,68,0.5)" : "1px solid var(--glass-border)",
            background: interruptMode ? "rgba(239,68,68,0.12)" : "transparent",
            color: interruptMode ? "#ef4444" : "var(--text-secondary)",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            transition: "all 0.2s",
            flexShrink: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 11V6a1 1 0 0 0-2 0V3a1 1 0 0 0-2 0v1a1 1 0 0 0-2 0v2a1 1 0 0 0-2 0v4l-1.8-1.8a1.42 1.42 0 0 0-2 2L10 15a5 5 0 0 0 5 5h1a5 5 0 0 0 5-5v-3a1 1 0 0 0-2 0" />
          </svg>
          Interrupt
        </button>

        {/* Task toggle — one-shot */}
        <button
          onClick={() => { const next = !taskMode; setTaskMode(next); if (next) setInterruptMode(false) }}
          style={{
            padding: "5px 10px",
            borderRadius: 10,
            border: taskMode ? "1.5px solid rgba(59,130,246,0.5)" : "1px solid var(--glass-border)",
            background: taskMode ? "rgba(59,130,246,0.12)" : "transparent",
            color: taskMode ? "#3b82f6" : "var(--text-secondary)",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            transition: "all 0.2s",
            flexShrink: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
          Task
        </button>
      </div>

      {/* Input row — clean: just text + voice + send */}
      <div style={{
        display: "flex",
        gap: 8,
        padding: "6px 12px",
        paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
        alignItems: "center",
      }}>
        {/* Glass text input — wrapped in form for reliable mobile Enter/Send */}
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend() }}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            borderRadius: 16,
            border: interruptMode
              ? "1.5px solid rgba(239,68,68,0.4)"
              : taskMode
                ? "1.5px solid rgba(59,130,246,0.4)"
                : hasInput ? "1px solid var(--accent-primary)" : "1px solid var(--glass-border)",
            background: "var(--glass-bg)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: hasInput ? "0 0 16px rgba(59,130,246,0.1)" : "var(--glass-shadow)",
            transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            overflow: "hidden",
          }}
        >
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            {/* Syntax-highlighted overlay */}
            {input && (
              <div aria-hidden style={{
                position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                padding: "12px 16px",
                fontSize: 15,
                fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                lineHeight: 1.4,
                whiteSpace: "nowrap",
                pointerEvents: "none",
                overflow: "hidden",
                color: "transparent",
              }}>
                {highlightInput(input)}
              </div>
            )}
            <textarea
              ref={inputRef}
              rows={1}
              wrap="off"
              enterKeyHint="send"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                interruptMode
                  ? (t("input.interruptPlaceholder") || "Interrupt: agent will prioritize this...")
                  : taskMode
                    ? (t("input.taskPlaceholder") || "Add task...")
                    : t("input.placeholder")
              }
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              style={{
                width: "100%",
                padding: "12px 16px",
                border: "none",
                background: "transparent",
                color: input ? "transparent" : "var(--text-primary)",
                caretColor: "var(--text-primary)",
                fontSize: 15,
                fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                outline: "none",
                resize: "none",
                overflowX: "auto",
                overflowY: "hidden",
                whiteSpace: "nowrap",
                maxHeight: 42,
                lineHeight: 1.4,
                position: "relative",
                zIndex: 1,
              }}
            />
          </div>
          {/* Expand button — always visible for fullscreen editing */}
          <button
            type="button"
            onClick={() => setExpandedEditor(true)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: "none",
              background: "transparent",
              color: input.length > 20 ? "var(--accent-primary)" : "var(--text-secondary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              marginRight: 4,
              opacity: input.length > 20 ? 1 : 0.5,
              transition: "all 0.2s",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        </form>

        {/* Voice input button */}
        {hasSpeechSupport && (
          <button
            onClick={onVoice || toggleVoice}
            title={isListening ? t("input.stopListening") : t("input.voiceInput")}
            style={{
              ...actionBtnStyle,
              border: isListening
                ? "1px solid rgba(239,68,68,0.4)"
                : "1px solid var(--glass-border)",
              background: isListening
                ? "rgba(239,68,68,0.12)"
                : "var(--glass-bg)",
              boxShadow: isListening ? "0 0 16px rgba(239,68,68,0.15)" : "var(--glass-shadow)",
              color: isListening ? "#ef4444" : "var(--text-secondary)",
              animation: isListening ? "pulse 1s ease-in-out infinite" : "none",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
        )}

        {/* Send button */}
        <button
          onClick={handleSend}
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            background: interruptMode
              ? "#ef4444"
              : hasInput
                ? "var(--accent-primary)"
                : "var(--glass-bg)",
            border: interruptMode
              ? "1px solid #ef4444"
              : hasInput
                ? "1px solid var(--accent-primary)"
                : "1px solid var(--glass-border)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: interruptMode
              ? "0 4px 16px rgba(239,68,68,0.3)"
              : hasInput ? "0 4px 16px rgba(59,130,246,0.3)" : "var(--glass-shadow)",
            color: (hasInput || interruptMode) ? "#fff" : "var(--text-secondary)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {interruptMode ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
              <line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          ) : hasInput ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 10 4 15 9 20" />
              <path d="M20 4v7a4 4 0 0 1-4 4H4" />
            </svg>
          )}
        </button>
      </div>

      {/* Fullscreen editor modal */}
      {expandedEditor && createPortal(
        <div
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
            zIndex: 10000,
            display: "flex", flexDirection: "column",
            padding: "env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px)",
          }}
        >
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            marginBottom: 12, paddingTop: 12,
          }}>
            <button onClick={() => setExpandedEditor(false)} style={{
              width: 36, height: 36, borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)",
              color: "rgba(255,255,255,0.7)",
              fontSize: 16, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              {"←"}
            </button>
            <div style={{ flex: 1, fontSize: 16, fontWeight: 600, color: "#fff" }}>
              {t("input.placeholder")}
            </div>
          </div>
          <textarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("input.placeholder")}
            style={{
              flex: 1,
              padding: 16,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
              fontSize: 15,
              fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
              outline: "none",
              resize: "none",
              lineHeight: 1.5,
            }}
          />
          <button
            onClick={handleSend}
            style={{
              marginTop: 12,
              padding: "14px 0",
              borderRadius: 14,
              border: "none",
              background: hasInput ? "var(--accent-primary)" : "rgba(255,255,255,0.1)",
              color: hasInput ? "#fff" : "rgba(255,255,255,0.4)",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {t("input.send") || "Send"}
          </button>
        </div>,
        document.body
      )}

      {/* Clipboard history panel — portal to escape overflow:hidden parents */}
      {showClipboard && createPortal(
        <div
          onClick={() => setShowClipboard(false)}
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            zIndex: 10000,
            display: "flex", flexDirection: "column",
            padding: "60px 16px 16px",
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            flex: 1, display: "flex", flexDirection: "column", minHeight: 0,
          }}>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              marginBottom: 16,
            }}>
              <button onClick={() => setShowClipboard(false)} style={{
                width: 36, height: 36, borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.7)",
                fontSize: 16, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                {"←"}
              </button>
              <div style={{ flex: 1, fontSize: 18, fontWeight: 700, color: "#fff" }}>
                {t("input.clipboard") || "Clipboard"}
              </div>
              <button onClick={() => { saveClipHistory([]); }} style={{
                padding: "6px 12px", borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.6)",
                fontSize: 12, cursor: "pointer",
                flexShrink: 0,
              }}>
                {t("input.clearHistory") || "Clear"}
              </button>
            </div>

            {/* History list */}
            <div style={{
              flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8,
              WebkitOverflowScrolling: "touch" as never,
            }}>
              {clipHistory.length === 0 && (
                <div style={{
                  textAlign: "center", padding: 40,
                  color: "rgba(255,255,255,0.4)", fontSize: 14,
                }}>
                  {t("input.clipboardEmpty") || "No clipboard history"}
                </div>
              )}
              {clipHistory.map((item, i) => (
                <button
                  key={`${item.time}_${i}`}
                  onClick={() => handleClipItemPaste(item)}
                  style={{
                    textAlign: "left",
                    padding: 12,
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.05)",
                    backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
                    color: "#fff",
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    display: "flex", flexDirection: "column", gap: 4,
                  }}
                >
                  {item.isImage ? (
                    <img src={item.text} alt="" style={{
                      maxWidth: "100%", maxHeight: 80, borderRadius: 8, objectFit: "cover",
                    }} />
                  ) : (
                    <div style={{
                      overflow: "hidden", textOverflow: "ellipsis",
                      display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as never,
                      lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-all",
                    }}>
                      {item.text}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                    {new Date(item.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Image preview overlay — fullscreen, back button closes */}
      {previewImage && createPortal(
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 10000,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, cursor: "pointer",
          }}
        >
          <img
            src={previewImage}
            alt="preview"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "100%", maxHeight: "100%",
              objectFit: "contain", borderRadius: 12,
              cursor: "default",
            }}
          />
          <button onClick={() => setPreviewImage(null)} style={{
            position: "absolute", top: 16, right: 16,
            width: 36, height: 36, borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(0,0,0,0.5)", color: "#fff",
            fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {"\u2715"}
          </button>
        </div>,
        document.body
      )}

      {/* Custom confirm dialog for removing attachments */}
      {confirmRemove && createPortal(
        <div
          onClick={() => setConfirmRemove(null)}
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 10001,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 32,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "var(--glass-bg, #1a1a2e)",
            backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
            border: "1px solid var(--glass-border, rgba(255,255,255,0.1))",
            borderRadius: 20, padding: "24px 20px 16px",
            maxWidth: 280, width: "100%",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 14, color: "var(--text-primary, #fff)", marginBottom: 20, lineHeight: 1.5 }}>
              {confirmRemove.type === "image"
                ? (t("input.confirmRemoveImage") || "確定要移除這張圖片？")
                : (t("input.confirmRemoveFile") || "確定要移除這個檔案？")}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmRemove(null)} style={{
                flex: 1, padding: "10px 0", borderRadius: 12,
                border: "1px solid var(--glass-border, rgba(255,255,255,0.1))",
                background: "transparent",
                color: "var(--text-secondary, rgba(255,255,255,0.6))",
                fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}>
                {t("app.cancel") || "取消"}
              </button>
              <button onClick={() => {
                if (confirmRemove.type === "image" && confirmRemove.index !== undefined) {
                  setPasteImages(prev => prev.filter((_, j) => j !== confirmRemove.index))
                } else if (confirmRemove.type === "file" && confirmRemove.path) {
                  onRemoveFile?.(confirmRemove.path)
                }
                setConfirmRemove(null)
              }} style={{
                flex: 1, padding: "10px 0", borderRadius: 12,
                border: "none",
                background: "rgba(239,68,68,0.15)",
                color: "#ef4444",
                fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}>
                {t("input.remove") || "移除"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

const toolbarBtnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 10,
  border: "1px solid var(--glass-border)",
  background: "var(--glass-bg)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "all 0.2s",
}

const actionBtnStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 14,
  border: "1px solid var(--glass-border)",
  background: "var(--glass-bg)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  boxShadow: "var(--glass-shadow)",
  color: "var(--text-secondary)",
  fontSize: 18,
  cursor: "pointer",
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "all 0.3s",
}
