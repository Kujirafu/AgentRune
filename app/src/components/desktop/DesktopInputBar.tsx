import React, { useState, useRef, useCallback, useEffect, useMemo } from "react"
import type { AppSession, Project, TaskStore, Task } from "../../types"
import type { SessionDecisionDigest } from "../../lib/session-summary"
import { searchChains, BUILTIN_CHAINS, formatChainInstructions } from "../../lib/skillChains"
import type { ChainMatch } from "../../lib/skillChains"
import { ChainCard } from "../ChainCard"

export interface DesktopInputBarProps {
  onSend: (text: string, images?: string[]) => void
  /** Send raw data (e.g. \x03 for interrupt) to a specific session */
  onRawSend: (sessionId: string, data: string) => void
  sessions: AppSession[]
  digests: Map<string, SessionDecisionDigest>
  targetSessionId: string | null
  onChangeTarget: (sessionId: string | null) => void
  onNewSession: () => void
  onCycleSession?: () => void
  theme: "light" | "dark"
  t: (key: string) => string
  locale: string
  apiBase: string
  projects: Project[]
  selectedProjectId: string | null
}

// ── Syntax highlight ──
function highlightInput(text: string, dark: boolean): React.ReactNode[] {
  const TOKEN_RE = /(?:https?:\/\/[^\s]+)|(?:>([a-zA-Z][\w-]*))|(?:@[^\s]+)|(?:\/\/[a-zA-Z][\w-]*)|(?:\/[a-zA-Z][\w-]*(?:\s+\S+)?)|(?:(?:[A-Z]:\\|[~/.])[^\s]*)/g
  const parts: { text: string; type: string }[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ text: text.slice(lastIndex, match.index), type: "plain" })
    const m = match[0]
    if (/^https?:\/\//.test(m)) parts.push({ text: m, type: "url" })
    else if (m.startsWith(">")) parts.push({ text: m, type: "agent" })
    else if (m.startsWith("@")) parts.push({ text: m, type: "file" })
    else if (m.startsWith("//")) parts.push({ text: m, type: "command" })
    else if (m.startsWith("/")) parts.push({ text: m, type: "command" })
    else parts.push({ text: m, type: "path" })
    lastIndex = match.index + m.length
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), type: "plain" })
  const tp = dark ? "#e2e8f0" : "#1e293b"
  const S: Record<string, React.CSSProperties> = {
    plain: { color: tp },
    url: { color: "#37ACC0", textDecoration: "underline", textDecorationColor: "rgba(55,172,192,0.3)" },
    agent: { color: "#6ee7b7", fontWeight: 700, background: "rgba(110,231,183,0.08)", borderRadius: 3, padding: "0 2px" },
    file: { color: "#f59e0b", background: "rgba(245,158,11,0.08)", borderRadius: 3, padding: "0 2px" },
    command: { color: "#a78bfa", fontWeight: 600 },
    path: { color: "#f59e0b", background: "rgba(245,158,11,0.08)", borderRadius: 3, padding: "0 2px" },
  }
  return parts.map((p, i) => <span key={i} style={S[p.type]}>{p.text}</span>)
}

// ── SVG icons ──
const XIcon = ({ size = 10 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

export function DesktopInputBar({
  onSend, onRawSend, sessions, digests, targetSessionId,
  onChangeTarget, onNewSession, onCycleSession, theme, t, locale,
  apiBase, projects, selectedProjectId,
}: DesktopInputBarProps) {
  const dark = theme === "dark"
  const [input, setInput] = useState("")
  const [showTargetMenu, setShowTargetMenu] = useState(false)
  const [pasteImages, setPasteImages] = useState<string[]>([])
  const [interruptMode, setInterruptMode] = useState(false)
  const [taskMode, setTaskMode] = useState(false)

  // @file flat search
  const [projectFiles, setProjectFiles] = useState<string[]>([])
  const [showFilePanel, setShowFilePanel] = useState(false)
  const [fileQuery, setFileQuery] = useState("")
  const filesCacheRef = useRef<{ pid: string; files: string[] } | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const filePanelRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastTabRef = useRef(0)
  const lastCtrlRef = useRef(0)

  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const textMuted = dark ? "#475569" : "#94a3b8"
  const border = dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)"
  const inputBg = dark ? "rgba(30,41,59,0.6)" : "rgba(255,255,255,0.8)"
  const panelBg = dark ? "rgba(15,23,42,0.95)" : "rgba(255,255,255,0.95)"
  const panelBorder = dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.18)"

  // Active mode determines placeholder
  const activeMode = interruptMode ? "interrupt" : taskMode ? "task" : null
  const placeholder = activeMode === "interrupt"
    ? (locale === "zh-TW" ? "輸入指令給被中斷的 agent..." : "Type instructions for interrupted agent...")
    : activeMode === "task"
    ? (locale === "zh-TW" ? "新增任務..." : "Add task...")
    : (locale === "zh-TW"
      ? "輸入指令... /skill chain, @file, Tabx2 中斷 — 自動拆分任務給 agent"
      : "Type a command... /skill chain, @file, Tabx2 interrupt — auto-dispatches tasks to agents")

  // ── Project CWD ──
  const projectCwd = useMemo(() => {
    const p = projects.find(p => p.id === selectedProjectId) || projects[0]
    return p?.cwd || ""
  }, [projects, selectedProjectId])

  // ── Target session ──
  const targetLabel = targetSessionId
    ? `#${sessions.findIndex(s => s.id === targetSessionId) + 1}`
    : "Auto"

  // ── Skill Chains ──
  const chainMatches = useMemo((): ChainMatch[] => {
    if (showFilePanel) return []
    if (input.startsWith("//")) return []
    if (input.startsWith("/")) {
      const cmd = input.slice(1).trim().toLowerCase()
      if (!cmd) return BUILTIN_CHAINS.map(c => ({ chain: c, score: 0.5, matchType: "prefix" as const }))
      return searchChains(cmd, t)
    }
    const trimmed = input.trim()
    if (trimmed.length < 3) return []
    return searchChains(trimmed, t)
  }, [input, t, showFilePanel])

  const matchedChain = chainMatches.length === 1 && chainMatches[0].matchType === "exact" ? chainMatches[0].chain : null
  const showChainPanel = chainMatches.length > 0

  // ── @file: fetch project files ──
  const fetchProjectFiles = useCallback(async () => {
    const pid = selectedProjectId || projects[0]?.id
    if (!pid) return
    // Use cache
    if (filesCacheRef.current?.pid === pid) {
      setProjectFiles(filesCacheRef.current.files)
      return
    }
    try {
      // apiBase is "" in Electron (same origin) — relative URL works fine
      const base = apiBase || ""
      const res = await fetch(`${base}/api/project-files/${pid}`)
      if (res.ok) {
        const data = await res.json()
        const files = Array.isArray(data.files) ? data.files : []
        filesCacheRef.current = { pid, files }
        setProjectFiles(files)
      }
    } catch { /* ignore */ }
  }, [apiBase, selectedProjectId, projects])

  // Detect @ trigger
  useEffect(() => {
    const atMatch = input.match(/@(\S*)$/)
    if (atMatch) {
      setFileQuery(atMatch[1])
      if (!showFilePanel) {
        setShowFilePanel(true)
        fetchProjectFiles()
      }
    } else {
      if (showFilePanel) setShowFilePanel(false)
      setFileQuery("")
    }
  }, [input, fetchProjectFiles, showFilePanel])

  // Invalidate file cache when project changes
  useEffect(() => {
    filesCacheRef.current = null
  }, [selectedProjectId])

  // Filter files by query (fuzzy path match)
  const filteredFiles = useMemo(() => {
    if (!fileQuery) return projectFiles.slice(0, 40)
    const q = fileQuery.toLowerCase()
    const parts = q.split(/[\\/]/)
    return projectFiles
      .filter(f => {
        const fl = f.toLowerCase()
        // Match each part of the query in order within the path
        if (parts.length <= 1) return fl.includes(q)
        let pos = 0
        for (const part of parts) {
          const idx = fl.indexOf(part, pos)
          if (idx < 0) return false
          pos = idx + part.length
        }
        return true
      })
      .slice(0, 40)
  }, [projectFiles, fileQuery])

  const handleFileSelect = useCallback((filePath: string) => {
    setInput(prev => prev.replace(/@\S*$/, `@${filePath} `))
    setShowFilePanel(false)
    inputRef.current?.focus()
  }, [])

  // ── Image paste ──
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault()
        e.stopPropagation()
        const file = item.getAsFile()
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => setPasteImages(prev => [...prev, reader.result as string])
        reader.readAsDataURL(file)
        return
      }
    }
  }, [])

  const handleFilePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue
      const reader = new FileReader()
      reader.onload = () => setPasteImages(prev => [...prev, reader.result as string])
      reader.readAsDataURL(file)
    }
    e.target.value = ""
  }, [])

  // ── Interrupt — auto-detect working session ──
  // Find the best session to interrupt: working > target > first
  const resolveInterruptTarget = useCallback((): string | null => {
    const workingSession = sessions.find(s => digests.get(s.id)?.status === "working")
    if (workingSession) return workingSession.id
    return targetSessionId || sessions[0]?.id || null
  }, [sessions, digests, targetSessionId])

  // Immediate interrupt (Ctrl+C) — no message, emergency stop
  const doImmediateInterrupt = useCallback(() => {
    const targetId = resolveInterruptTarget()
    if (targetId) {
      onRawSend(targetId, "\x03")
      setInterruptMode(false)
      return true
    }
    return false
  }, [resolveInterruptTarget, onRawSend])

  // ── Send ──
  const hasContent = input.trim() || pasteImages.length > 0
  const handleSend = useCallback(() => {
    // Interrupt mode: send ^C first, then message as new instructions
    if (interruptMode) {
      const msg = input.trim()
      const targetId = resolveInterruptTarget()
      if (targetId) {
        onRawSend(targetId, "\x03")
        if (msg) {
          setTimeout(() => onRawSend(targetId, msg + "\n"), 200)
        }
      }
      setInput("")
      setInterruptMode(false)
      return
    }
    // Task mode: append to task store + send [TASK] prefixed to agent
    if (taskMode) {
      const taskText = input.trim()
      if (!taskText) return
      const pid = selectedProjectId || projects[0]?.id
      if (pid) {
        const base = apiBase || ""
        fetch(`${base}/api/tasks/${encodeURIComponent(pid)}`)
          .then(r => r.json())
          .then((store: TaskStore | null) => {
            const existing = store?.tasks || []
            const nextId = existing.length > 0 ? Math.max(...existing.map((t: Task) => t.id)) + 1 : 1
            const newTask: Task = {
              id: nextId,
              title: taskText.slice(0, 80),
              description: taskText,
              status: "pending",
              dependsOn: [],
            }
            return fetch(`${base}/api/tasks/${encodeURIComponent(pid)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tasks: [...existing, newTask] }),
            }).then(() => window.dispatchEvent(new Event("tasks_changed")))
          })
          .catch(() => {})
      }
      onSend(`[TASK] Add the following to your task list (use TodoWrite), then confirm: ${taskText}`)
      setInput("")
      setTaskMode(false)
      return
    }
    const trimmed = input.trim()
    if (!trimmed && pasteImages.length === 0) return
    // If exact chain match, send formatted chain instructions instead of raw text
    if (matchedChain) {
      const instructions = formatChainInstructions(matchedChain, "normal", t)
      onSend(instructions)
      setInput("")
      return
    }
    onSend(trimmed, pasteImages.length > 0 ? [...pasteImages] : undefined)
    setInput("")
    setPasteImages([])
  }, [input, pasteImages, onSend, interruptMode, taskMode, resolveInterruptTarget, onRawSend, apiBase, selectedProjectId, projects, matchedChain, t])

  const handleChainSend = useCallback((instructions: string) => {
    onSend(instructions)
    setInput("")
  }, [onSend])

  // ── Keyboard ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Shift+Tab — cycle expanded session
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault()
      onCycleSession?.()
      return
    }
    // Double-Tab — toggle interrupt mode
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault()
      const now = Date.now()
      if (now - lastTabRef.current < 350) {
        setInterruptMode(prev => { const next = !prev; if (next) setTaskMode(false); return next })
      }
      lastTabRef.current = now
      return
    }
    // Double-Ctrl — toggle task mode
    if (e.key === "Control") {
      const now = Date.now()
      if (now - lastCtrlRef.current < 350) {
        setTaskMode(prev => { const next = !prev; if (next) setInterruptMode(false); return next })
      }
      lastCtrlRef.current = now
      return
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
    // Ctrl+C — immediate interrupt (emergency, no message)
    if (e.key === "c" && e.ctrlKey) {
      e.preventDefault()
      doImmediateInterrupt()
    }
    if (e.key === "n" && e.ctrlKey) {
      e.preventDefault()
      onNewSession()
    }
    if (e.key === "Escape") {
      if (showFilePanel) { setShowFilePanel(false); return }
      if (showChainPanel) { setInput(""); return }
      if (interruptMode) { setInterruptMode(false); return }
      if (taskMode) { setTaskMode(false); return }
    }
  }, [handleSend, doImmediateInterrupt, onNewSession, onChangeTarget, sessions, showChainPanel, showFilePanel, interruptMode, taskMode])

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (showTargetMenu && menuRef.current && !menuRef.current.contains(e.target as Node)) setShowTargetMenu(false)
      if (showFilePanel && filePanelRef.current && !filePanelRef.current.contains(e.target as Node)) setShowFilePanel(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [showTargetMenu, showFilePanel])

  return (
    <div style={{ padding: "10px 18px 8px", flexShrink: 0, position: "relative" }}>
      {/* Chain suggestions panel */}
      {showChainPanel && (
        <div style={{
          position: "absolute", bottom: "100%", left: 18, right: 18,
          maxHeight: 400, overflowY: "auto",
          background: panelBg, backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
          border: `1px solid ${panelBorder}`, borderRadius: 12,
          boxShadow: dark ? "0 -4px 24px rgba(0,0,0,0.4)" : "0 -4px 24px rgba(0,0,0,0.08)",
          padding: 10, marginBottom: 4, zIndex: 60,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#37ACC0", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, padding: "0 4px" }}>
            {matchedChain ? (t("chain.sectionTitle") || "Skill Chain") : (t("chain.suggested") || "Suggested Chains")}
          </div>
          {matchedChain && <ChainCard chain={matchedChain} t={t} onSend={handleChainSend} />}
          {!matchedChain && chainMatches.slice(0, 8).map(({ chain, score }) => (
            <ChainCard key={chain.slug} chain={chain} t={t} collapsed={chainMatches.length > 1} relevance={score} onSend={handleChainSend} />
          ))}
          {chainMatches.length > 8 && !matchedChain && (
            <div style={{ fontSize: 11, color: textMuted, padding: "4px 8px", textAlign: "center" }}>+{chainMatches.length - 8} more...</div>
          )}
        </div>
      )}

      {/* @file search panel — flat file list like Codex */}
      {showFilePanel && (
        <div ref={filePanelRef} style={{
          position: "absolute", bottom: "100%", left: 18, right: 18,
          maxHeight: 360, overflowY: "auto",
          background: panelBg, backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
          border: `1px solid ${panelBorder}`, borderRadius: 12,
          boxShadow: dark ? "0 -4px 24px rgba(0,0,0,0.4)" : "0 -4px 24px rgba(0,0,0,0.08)",
          padding: 8, marginBottom: 4, zIndex: 60,
        }}>
          {/* Header */}
          <div style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, padding: "0 6px" }}>
            {fileQuery ? `@${fileQuery}` : "@"} {"\u2014"} {locale === "zh-TW" ? "選擇檔案" : "Select file"}
          </div>
          {/* CWD breadcrumb */}
          <div style={{ fontSize: 10, color: textMuted, padding: "0 6px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {projectCwd}
          </div>

          {filteredFiles.length === 0 ? (
            <div style={{ padding: 12, textAlign: "center", fontSize: 12, color: textMuted }}>
              {projectFiles.length === 0 ? "Loading..." : "No matches"}
            </div>
          ) : (
            filteredFiles.map(file => {
              // Highlight matching parts
              const isDir = file.endsWith("/")
              return (
                <button
                  key={file}
                  onClick={() => handleFileSelect(file)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    width: "100%", padding: "4px 8px", fontSize: 12,
                    background: "transparent", border: "none", cursor: "pointer",
                    color: isDir ? "#37ACC0" : textPrimary,
                    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
                    textAlign: "left", borderRadius: 5, lineHeight: 1.6,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.06)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  {/* File/folder icon */}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={isDir ? "#37ACC0" : textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    {isDir
                      ? <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                      : <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></>
                    }
                  </svg>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file}</span>
                </button>
              )
            })
          )}
        </div>
      )}

      {/* Image preview strip */}
      {pasteImages.length > 0 && (
        <div style={{ display: "flex", gap: 8, padding: "6px 0 8px", flexWrap: "wrap" }}>
          {pasteImages.map((img, i) => (
            <div key={i} style={{
              position: "relative", width: 56, height: 56, borderRadius: 8, overflow: "hidden",
              border: `1px solid ${dark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.2)"}`, flexShrink: 0,
            }}>
              <img src={img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button onClick={() => setPasteImages(prev => prev.filter((_, j) => j !== i))} style={{
                position: "absolute", top: 2, right: 2, width: 16, height: 16, borderRadius: 8,
                background: "rgba(0,0,0,0.6)", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", padding: 0,
              }}>
                <XIcon size={8} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        background: interruptMode ? (dark ? "rgba(239,68,68,0.08)" : "rgba(239,68,68,0.04)")
          : taskMode ? (dark ? "rgba(59,130,246,0.08)" : "rgba(59,130,246,0.04)")
          : inputBg,
        border: `1px solid ${interruptMode ? (dark ? "rgba(239,68,68,0.25)" : "rgba(239,68,68,0.2)")
          : taskMode ? (dark ? "rgba(59,130,246,0.25)" : "rgba(59,130,246,0.2)")
          : border}`,
        borderRadius: 10, padding: "8px 10px",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        transition: "border-color 0.15s, background 0.15s",
      }}>
        {/* Attach image button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          title={locale === "zh-TW" ? "附加圖片" : "Attach image"}
          style={{
            width: 28, height: 28, borderRadius: 6, border: "none", cursor: "pointer",
            background: "transparent", color: textSecondary,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFilePick} />

        {/* Input area with highlight overlay */}
        <div style={{ flex: 1, position: "relative", minHeight: 28 }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            style={{
              width: "100%", background: "transparent", border: "none", outline: "none",
              fontSize: 14, color: input ? "transparent" : (activeMode === "interrupt" ? "#ef4444" : activeMode === "task" ? "#3b82f6" : textPrimary),
              caretColor: activeMode === "interrupt" ? "#ef4444" : activeMode === "task" ? "#3b82f6" : textPrimary,
              fontFamily: "inherit", lineHeight: "28px",
            }}
            autoFocus
          />
          {input && (
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0,
              pointerEvents: "none", fontSize: 14, fontFamily: "inherit",
              whiteSpace: "pre", overflow: "hidden", lineHeight: "28px",
            }}>
              {highlightInput(input, dark)}
            </div>
          )}
        </div>

        {/* Task mode toggle — double-Ctrl to activate */}
        <button
          onClick={() => setTaskMode(prev => { const next = !prev; if (next) setInterruptMode(false); return next })}
          title={locale === "zh-TW" ? "新增任務 (Ctrlx2)" : "Add task (Ctrlx2)"}
          style={{
            height: 26, borderRadius: 6, padding: "0 8px",
            border: `1px solid ${taskMode ? (dark ? "rgba(59,130,246,0.4)" : "rgba(59,130,246,0.3)") : border}`,
            cursor: "pointer",
            background: taskMode ? (dark ? "rgba(59,130,246,0.15)" : "rgba(59,130,246,0.08)") : "transparent",
            color: taskMode ? "#3b82f6" : textMuted,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            flexShrink: 0, fontSize: 11, fontWeight: 600, fontFamily: "inherit",
            transition: "all 0.15s",
          }}
        >
          {/* Clipboard-list icon */}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
          </svg>
          {taskMode ? (locale === "zh-TW" ? "任務" : "Task") : "Ctrlx2"}
        </button>

        {/* Interrupt mode toggle — double-Tab to activate */}
        <button
          onClick={() => setInterruptMode(prev => { const next = !prev; if (next) setTaskMode(false); return next })}
          title={locale === "zh-TW" ? "中斷模式 (Tabx2)" : "Interrupt mode (Tabx2)"}
          style={{
            height: 26, borderRadius: 6, padding: "0 8px",
            border: `1px solid ${interruptMode ? (dark ? "rgba(239,68,68,0.4)" : "rgba(239,68,68,0.3)") : border}`,
            cursor: "pointer",
            background: interruptMode ? (dark ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.08)") : "transparent",
            color: interruptMode ? "#ef4444" : textMuted,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            flexShrink: 0, fontSize: 11, fontWeight: 600, fontFamily: "inherit",
            transition: "all 0.15s",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          {interruptMode ? (locale === "zh-TW" ? "中斷" : "Interrupt") : "Tabx2"}
        </button>

        {/* Target selector */}
        <div style={{ position: "relative" }} ref={menuRef}>
          <button
            onClick={() => setShowTargetMenu(!showTargetMenu)}
            style={{
              fontSize: 12, fontWeight: 600, padding: "4px 10px",
              borderRadius: 6, border: `1px solid ${border}`,
              background: "transparent", cursor: "pointer",
              color: targetSessionId ? "#37ACC0" : textSecondary,
              whiteSpace: "nowrap", fontFamily: "inherit",
            }}
          >
            {"\u2192"} {targetLabel}
          </button>
          {showTargetMenu && (
            <div style={{
              position: "absolute", bottom: "calc(100% + 6px)", right: 0,
              background: dark ? "#1e293b" : "#ffffff",
              border: `1px solid ${border}`, borderRadius: 8, padding: 4, minWidth: 160,
              boxShadow: dark ? "0 4px 16px rgba(0,0,0,0.4)" : "0 4px 16px rgba(0,0,0,0.1)",
              zIndex: 50,
            }}>
              <button
                onClick={() => { onChangeTarget(null); setShowTargetMenu(false) }}
                style={{
                  padding: "5px 10px", fontSize: 12, cursor: "pointer", borderRadius: 5,
                  color: !targetSessionId ? "#37ACC0" : textSecondary,
                  fontWeight: !targetSessionId ? 600 : 400,
                  background: "transparent", border: "none", width: "100%", textAlign: "left",
                  fontFamily: "inherit", display: "block",
                }}
              >
                Auto
              </button>
              {sessions.map((s, i) => {
                const d = digests.get(s.id)
                const isTarget = s.id === targetSessionId
                return (
                  <button
                    key={s.id}
                    onClick={() => { onChangeTarget(s.id); setShowTargetMenu(false) }}
                    style={{
                      padding: "5px 10px", fontSize: 12, cursor: "pointer", borderRadius: 5,
                      color: isTarget ? "#37ACC0" : textSecondary,
                      fontWeight: isTarget ? 600 : 400,
                      background: "transparent", border: "none", width: "100%", textAlign: "left",
                      fontFamily: "inherit", display: "block",
                    }}
                  >
                    #{i + 1} {d?.displayLabel || s.agentId}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* New session */}
        <button
          onClick={onNewSession} title="New session (Ctrl+N)"
          style={{
            width: 32, height: 32, borderRadius: 7, border: `1px solid ${border}`,
            cursor: "pointer", background: "transparent", color: textSecondary,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        {/* Send */}
        <button
          onClick={handleSend}
          disabled={!hasContent && !interruptMode}
          style={{
            width: 32, height: 32, borderRadius: 7, border: "none",
            cursor: (hasContent || interruptMode) ? "pointer" : "default",
            background: interruptMode ? "#ef4444" : taskMode ? "#3b82f6" : (hasContent ? "#37ACC0" : (dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.08)")),
            color: (hasContent || interruptMode || taskMode) ? "#ffffff" : textMuted,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 0.15s",
          }}
        >
          {interruptMode ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>

      {/* Hotkey hints */}
      <div style={{ display: "flex", gap: 14, padding: "5px 4px 0", fontSize: 11, color: textMuted }}>
        <span style={{ color: "#a78bfa" }}>/skill chain</span>
        <span style={{ color: "#f59e0b" }}>@file</span>
        <span style={{ color: "#6ee7b7" }}>{">"}agent</span>
        <span style={taskMode ? { color: "#3b82f6", fontWeight: 600 } : { color: "#3b82f6" }}>Ctrlx2 {locale === "zh-TW" ? "任務" : "task"}</span>
        <span style={interruptMode ? { color: "#ef4444", fontWeight: 600 } : { color: "#ef4444" }}>Tabx2 {locale === "zh-TW" ? "中斷" : "interrupt"}</span>
        <span style={{ color: "#37ACC0" }}>Shift+Tab {locale === "zh-TW" ? "切換" : "switch"}</span>
        <span style={{ color: "#37ACC0" }}>Ctrl+N new</span>
        <span>Esc close</span>
      </div>
    </div>
  )
}
