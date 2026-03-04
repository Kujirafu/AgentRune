import { useState, useRef, useEffect, useMemo } from "react"
import type { SlashCommand } from "../lib/types"
import { useLocale } from "../lib/i18n/index.js"

interface InputBarProps {
  onSend: (text: string) => void
  onImagePaste?: (base64: string, filename: string) => void
  onBrowse?: () => void
  autoFocus?: boolean
  slashCommands?: SlashCommand[]
  prefill?: string
  onPrefillConsumed?: () => void
}

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

export function InputBar({ onSend, onImagePaste, onBrowse, autoFocus = true, slashCommands, prefill, onPrefillConsumed }: InputBarProps) {
  const { t, locale } = useLocale()
  const [input, setInput] = useState("")
  const [pastePreview, setPastePreview] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [sentHistory, addSent] = useSentHistory()
  const inputRef = useRef<HTMLInputElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
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

  const hasSpeechSupport = typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)

  const hasClipboardSupport = typeof navigator !== "undefined" &&
    navigator.clipboard && typeof navigator.clipboard.readText === "function"

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
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = locale === "zh-TW" ? "zh-TW" : "en-US"

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join("")
      setInput(prev => {
        if (prev.trim()) return prev.trim() + " " + transcript
        return transcript
      })
    }

    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }

  const handleClipboardPaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setInput(prev => prev + text)
        inputRef.current?.focus()
      }
    } catch {
      // Clipboard access denied — silently fail
    }
  }

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
    if (!trimmed) return
    addSent({ text: trimmed, time: Date.now() })
    onSend(input)
    setInput("")
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

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) return

        const reader = new FileReader()
        reader.onload = () => {
          const base64 = reader.result as string
          setPastePreview(base64)
          onImagePaste?.(base64, `paste.${file.type.split("/")[1] || "png"}`)
        }
        reader.readAsDataURL(file)
        return
      }
    }
  }

  // Tap to resend
  const handleResend = (text: string) => {
    setInput(text)
    inputRef.current?.focus()
  }

  const hasInput = input.trim().length > 0

  // Slash command suggestions
  const filteredSlash = useMemo(() => {
    if (!slashCommands || !input.startsWith("/")) return []
    const q = input.toLowerCase()
    if (q === "/") return slashCommands
    return slashCommands.filter((c) => c.command.toLowerCase().startsWith(q))
  }, [input, slashCommands])

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

  return (
    <div style={{ flexShrink: 0 }}>
      {/* Slash command suggestions */}
      {filteredSlash.length > 0 && (
        <div style={{
          maxHeight: 240,
          overflowY: "auto",
          padding: "6px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          WebkitOverflowScrolling: "touch" as never,
        }}>
          {filteredSlash.map((cmd) => (
            <button
              key={cmd.command}
              onClick={() => handleSlashSelect(cmd)}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 14,
                border: "1px solid var(--glass-border)",
                background: "var(--glass-bg)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                boxShadow: "var(--glass-shadow)",
                color: "var(--text-primary)",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span style={{
                fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                fontWeight: 700,
                fontSize: 14,
                color: "var(--accent-primary)",
                flexShrink: 0,
              }}>
                {cmd.command}
              </span>
              <span style={{
                fontSize: 12,
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
        </div>
      )}

      {/* Image paste preview */}
      {pastePreview && (
        <div style={{
          padding: "8px 14px",
          margin: "0 12px 8px",
          borderRadius: 16,
          background: "var(--glass-bg)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--glass-border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <img
            src={pastePreview}
            alt="paste preview"
            style={{
              width: 44,
              height: 44,
              objectFit: "cover",
              borderRadius: 10,
              border: "1px solid var(--glass-border)",
            }}
          />
          <div style={{ flex: 1, fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
            {t("input.imageAttached")}
          </div>
          <button
            onClick={() => setPastePreview(null)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: "1px solid var(--glass-border)",
              background: "var(--icon-bg)",
              color: "var(--text-secondary)",
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {"\u2715"}
          </button>
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
          {sentHistory.slice(-2).map((item) => (
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

      {/* Input row — floating glass bar */}
      <div style={{
        display: "flex",
        gap: 8,
        padding: "10px 12px",
        paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
        alignItems: "center",
      }}>
        {/* Browse files button */}
        {onBrowse && (
          <button
            onClick={onBrowse}
            title={t("input.browseFiles")}
            style={actionBtnStyle}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        )}

        {/* Paste button */}
        {hasClipboardSupport && (
          <button
            onClick={handleClipboardPaste}
            title={t("input.pasteClipboard")}
            style={actionBtnStyle}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
          </button>
        )}

        {/* Glass text input — wrapped in form for reliable mobile Enter/Send */}
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend() }}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            borderRadius: 16,
            border: hasInput ? "1px solid var(--accent-primary)" : "1px solid var(--glass-border)",
            background: "var(--glass-bg)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: hasInput ? "0 0 16px rgba(59,130,246,0.1)" : "var(--glass-shadow)",
            transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            overflow: "hidden",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            enterKeyHint="send"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t("input.placeholder")}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            style={{
              flex: 1,
              padding: "12px 16px",
              border: "none",
              background: "transparent",
              color: "var(--text-primary)",
              fontSize: 15,
              fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
              outline: "none",
            }}
          />
        </form>

        {/* Voice input button */}
        {hasSpeechSupport && (
          <button
            onClick={toggleVoice}
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

        {/* Send button — circular glass */}
        <button
          onClick={handleSend}
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            background: hasInput
              ? "var(--accent-primary)"
              : "var(--glass-bg)",
            border: hasInput
              ? "1px solid var(--accent-primary)"
              : "1px solid var(--glass-border)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: hasInput ? "0 4px 16px rgba(59,130,246,0.3)" : "var(--glass-shadow)",
            color: hasInput ? "#fff" : "var(--text-secondary)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  )
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
