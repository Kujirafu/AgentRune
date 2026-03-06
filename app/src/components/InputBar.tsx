import { useState, useRef, useEffect, useMemo } from "react"
import { createPortal } from "react-dom"
import { Clipboard } from "@capacitor/clipboard"
import { App as CapApp } from "@capacitor/app"
import type { SlashCommand } from "../types"
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
  const [pasteImages, setPasteImages] = useState<string[]>([])
  const [isListening, setIsListening] = useState(false)
  const [expandedEditor, setExpandedEditor] = useState(false)
  const [sentHistory, addSent] = useSentHistory()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  // Clipboard history
  const [showClipboard, setShowClipboard] = useState(false)
  const [clipHistory, setClipHistory] = useState<{ text: string; time: number; isImage?: boolean }[]>(() => {
    try { return JSON.parse(localStorage.getItem("clipboard_history") || "[]") } catch { return [] }
  })

  const saveClipHistory = (items: typeof clipHistory) => {
    const capped = items.slice(0, 30)
    setClipHistory(capped)
    localStorage.setItem("clipboard_history", JSON.stringify(capped))
  }

  const addToClipHistory = (text: string, isImage = false) => {
    if (!text || text.length < 1) return
    setClipHistory(prev => {
      if (prev[0]?.text === text) return prev
      const next = [{ text, time: Date.now(), isImage }, ...prev.filter(h => h.text !== text)].slice(0, 30)
      localStorage.setItem("clipboard_history", JSON.stringify(next))
      return next
    })
  }

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

  useEffect(() => {
    if (!showClipboard) return
    const listener = CapApp.addListener("backButton", () => {
      setShowClipboard(false)
    })
    return () => { listener.then(h => h.remove()) }
  }, [showClipboard])

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

  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight
    }
  }, [sentHistory.length])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed && pasteImages.length === 0) {
      onSend("\r")
      return
    }
    if (trimmed) {
      addSent({ text: trimmed, time: Date.now() })
      onSend(input)
    } else if (pasteImages.length > 0) {
      onSend("")
    }
    setInput("")
    setPasteImages([])
    setExpandedEditor(false)
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
    e.target.value = ""
  }

  const handleResend = (text: string) => {
    setInput(text)
    inputRef.current?.focus()
  }

  const hasInput = input.trim().length > 0 || pasteImages.length > 0

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
      {pasteImages.length > 0 && (
        <div style={{
          padding: "8px 14px",
          margin: "0 12px 8px",
          borderRadius: 16,
          background: "var(--glass-bg)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--glass-border)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}>
          <div style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            WebkitOverflowScrolling: "touch" as never,
            paddingBottom: 2,
          }}>
            {pasteImages.map((img, i) => (
              <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                <img
                  src={img}
                  alt={`preview ${i + 1}`}
                  style={{
                    width: 44,
                    height: 44,
                    objectFit: "cover",
                    borderRadius: 10,
                    border: "1px solid var(--glass-border)",
                  }}
                />
                <button
                  onClick={() => setPasteImages(prev => prev.filter((_, j) => j !== i))}
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    border: "1px solid var(--glass-border)",
                    background: "rgba(0,0,0,0.7)",
                    color: "#fff",
                    fontSize: 10,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  {"\u2715"}
                </button>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
            {pasteImages.length === 1 ? t("input.imageAttached") : `${pasteImages.length} ${t("input.imageAttached")}`}
          </div>
        </div>
      )}

      {/* Sent command history */}
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

      {/* Input row */}
      <div style={{
        display: "flex",
        gap: 8,
        padding: "10px 12px",
        paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
        alignItems: "center",
      }}>
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

        {onImagePaste && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFilePick}
              style={{ display: "none" }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title={t("input.attachImage") || "Attach image"}
              style={actionBtnStyle}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
          </>
        )}

        {hasClipboardSupport && (
          <button
            onClick={handleClipboardOpen}
            title={t("input.pasteClipboard")}
            style={actionBtnStyle}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
          </button>
        )}

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
          <textarea
            ref={inputRef}
            rows={1}
            wrap="off"
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
              resize: "none",
              overflowX: "auto",
              overflowY: "hidden",
              whiteSpace: "nowrap",
              maxHeight: 42,
              lineHeight: 1.4,
            }}
          />
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
          {hasInput ? (
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
              {"\u2190"}
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

      {/* Clipboard history panel */}
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
                {"\u2190"}
              </button>
              <div style={{ flex: 1, fontSize: 18, fontWeight: 700, color: "#fff" }}>
                {t("input.clipboard") || "Clipboard"}
              </div>
              <button onClick={() => { saveClipHistory([]) }} style={{
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
