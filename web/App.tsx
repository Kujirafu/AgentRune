import { useState, useEffect, useRef, useCallback } from "react"
import "@xterm/xterm/css/xterm.css"
import type { Project, AppSession } from "./lib/types"
import { getLastProject, saveLastProject } from "./lib/storage"
import { LaunchPad } from "./components/LaunchPad"
import { TerminalView } from "./components/TerminalView"
import { MissionControl } from "./components/MissionControl"
import { App as CapApp } from "@capacitor/app"
import { useLocale } from "./lib/i18n/index.js"

// ─── Server URL helpers ──────────────────────────────────────────

function isCapacitor(): boolean {
  return typeof window !== "undefined" &&
    !!(window as any).Capacitor &&
    (window as any).Capacitor.isNativePlatform?.() === true
}

function needsServerSetup(): boolean {
  // If user is logged in with AgentLore, skip ConnectScreen — they'll pick a device in LaunchPad
  if (localStorage.getItem("agentrune_phone_token")) return false
  return isCapacitor() && !localStorage.getItem("agentrune_server")
}

function getServerUrl(): string {
  if (!isCapacitor()) return ""
  return localStorage.getItem("agentrune_server") || ""
}

function getApiBase(): string {
  return getServerUrl()
}

function getWsUrl(): string {
  const server = getServerUrl()
  if (!server) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:"
    return `${proto}//${location.host}`
  }
  return server.replace(/^http/, "ws")
}

function getDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/i.test(ua)) return "iPhone"
  if (/iPad/i.test(ua)) return "iPad"
  if (/Android/i.test(ua)) return "Android"
  if (/Mac/i.test(ua)) return "Mac"
  if (/Windows/i.test(ua)) return "Windows"
  return "Device"
}

// ─── Auth hook ───────────────────────────────────────────────────

type AuthMode = "pairing" | "totp" | "none"
type AuthStatus = "checking" | "need-setup" | "need-auth" | "authenticated"

function useAuth(serverReady: boolean) {
  const [status, setStatus] = useState<AuthStatus>("checking")
  const [mode, setMode] = useState<AuthMode>("none")
  const [error, setError] = useState("")
  const [sessionToken, setSessionToken] = useState("")

  useEffect(() => {
    if (serverReady) checkAuth()
  }, [serverReady])

  const checkAuth = async () => {
    try {
      const deviceId = localStorage.getItem("agentrune_device_id") || ""
      const res = await fetch(`${getApiBase()}/api/auth/check?deviceId=${deviceId}`)
      const data = await res.json()

      setMode(data.mode)

      if (data.mode === "none") {
        setSessionToken("__open__")
        setStatus("authenticated")
        return
      }

      const savedDeviceId = localStorage.getItem("agentrune_device_id")
      const savedToken = localStorage.getItem("agentrune_device_token")

      if (savedDeviceId && savedToken) {
        const verifyRes = await fetch(`${getApiBase()}/api/auth/device`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: savedDeviceId, token: savedToken }),
        })

        if (verifyRes.ok) {
          const verifyData = await verifyRes.json()
          setSessionToken(verifyData.sessionToken)
          setStatus("authenticated")
          return
        }

        localStorage.removeItem("agentrune_device_id")
        localStorage.removeItem("agentrune_device_token")
      }

      if (!data.hasPairedDevices && data.mode === "totp") {
        setStatus("need-setup")
      } else {
        setStatus("need-auth")
      }
    } catch {
      setError("Cannot connect to server")
      setStatus("need-auth")
    }
  }

  const pairWithCode = async (code: string) => {
    setError("")
    try {
      const res = await fetch(`${getApiBase()}/api/auth/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, deviceName: getDeviceName() }),
      })

      if (res.ok) {
        const data = await res.json()
        localStorage.setItem("agentrune_device_id", data.deviceId)
        localStorage.setItem("agentrune_device_token", data.deviceToken)
        setSessionToken(data.sessionToken)
        setStatus("authenticated")
      } else {
        setError("Invalid code")
      }
    } catch {
      setError("Connection failed")
    }
  }

  const verifyTotp = async (code: string) => {
    setError("")
    try {
      const res = await fetch(`${getApiBase()}/api/auth/totp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, deviceName: getDeviceName() }),
      })

      if (res.ok) {
        const data = await res.json()
        localStorage.setItem("agentrune_device_id", data.deviceId)
        localStorage.setItem("agentrune_device_token", data.deviceToken)
        setSessionToken(data.sessionToken)
        setStatus("authenticated")
      } else {
        setError("Invalid code")
      }
    } catch {
      setError("Connection failed")
    }
  }

  const recheckAuth = () => {
    setStatus("checking")
    checkAuth()
  }

  return { status, mode, error, sessionToken, pairWithCode, verifyTotp, recheckAuth }
}

// ─── WebSocket hook ──────────────────────────────────────────────

function useWs() {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<Map<string, Set<(msg: Record<string, unknown>) => void>>>(new Map())

  const connect = useCallback((sessionToken: string) => {
    const ws = new WebSocket(`${getWsUrl()}?token=${encodeURIComponent(sessionToken)}`)
    wsRef.current = ws

    ws.onopen = () => {
      const handlers = handlersRef.current.get("__ws_open__")
      if (handlers) for (const h of handlers) h({})
    }

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      const handlers = handlersRef.current.get(msg.type)
      if (handlers) for (const h of handlers) h(msg)
    }

    ws.onclose = () => {
      const handlers = handlersRef.current.get("__ws_close__")
      if (handlers) for (const h of handlers) h({})
      setTimeout(() => connect(sessionToken), 500)
    }

    return ws
  }, [])

  const send = useCallback((msg: Record<string, unknown>): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
      return true
    }
    return false
  }, [])

  const on = useCallback((type: string, handler: (msg: Record<string, unknown>) => void): (() => void) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set())
    }
    handlersRef.current.get(type)!.add(handler)
    return () => {
      handlersRef.current.get(type)?.delete(handler)
    }
  }, [])

  return { connect, send, on }
}

// ─── QR Scanner fullscreen view ──────────────────────────────────

function QrScannerView({ onScan, onCancel }: { onScan: (text: string) => void; onCancel: () => void }) {
  const { t } = useLocale()
  const scannerRef = useRef<HTMLDivElement>(null)
  const html5QrRef = useRef<any>(null)
  const [scanError, setScanError] = useState("")

  useEffect(() => {
    let cancelled = false
      ; (async () => {
        try {
          const { Html5Qrcode } = await import("html5-qrcode")
          await new Promise(r => setTimeout(r, 150))
          if (cancelled) return
          const scanner = new Html5Qrcode("qr-reader")
          html5QrRef.current = scanner
          await scanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText) => {
              scanner.stop().catch(() => { })
              html5QrRef.current = null
              onScan(decodedText)
            },
            () => { }
          )
        } catch (err: any) {
          setScanError(err?.message || "Camera not available")
        }
      })()
    return () => {
      cancelled = true
      if (html5QrRef.current) {
        html5QrRef.current.stop().catch(() => { })
        html5QrRef.current = null
      }
    }
  }, [])

  return (
    <div style={{
      height: "100dvh", display: "flex", flexDirection: "column",
      background: "#000", color: "#e2e8f0",
    }}>
      <div style={{
        padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(15,23,42,0.9)", backdropFilter: "blur(20px)",
      }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{t("app.scanQrCode")}</div>
        <button
          onClick={onCancel}
          style={{
            padding: "6px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(255,255,255,0.08)", color: "#e2e8f0",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          {t("app.cancel")}
        </button>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        {scanError ? (
          <div style={{ color: "#f59e0b", fontSize: 14, padding: 20, textAlign: "center" }}>{scanError}</div>
        ) : (
          <div id="qr-reader" ref={scannerRef} style={{ width: "100%", maxWidth: 400 }} />
        )}
      </div>
      <div style={{
        padding: "16px 20px", textAlign: "center",
        background: "rgba(15,23,42,0.9)", backdropFilter: "blur(20px)",
        fontSize: 12, color: "rgba(255,255,255,0.4)",
      }}>
        {t("app.alignQrCode")}
      </div>
    </div>
  )
}

// ─── Connect screen (first time on Capacitor, no server URL) ────

function ConnectScreen({ onConnected }: { onConnected: () => void }) {
  const { t } = useLocale()
  const [scanning, setScanning] = useState(false)
  const [serverUrl, setServerUrl] = useState("")
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Listen for deep link after AgentLore OAuth — token saved → reload skips ConnectScreen
  useEffect(() => {
    let cleanup: (() => void) | undefined
    import("@capacitor/app").then(({ App: CapApp }) => {
      CapApp.addListener("appUrlOpen", ({ url }) => {
        if (url.startsWith("agentrune://auth")) {
          const u = new URL(url)
          const token = u.searchParams.get("token")
          const userId = u.searchParams.get("userId")
          if (token) {
            localStorage.setItem("agentrune_phone_token", token)
            if (userId) localStorage.setItem("agentrune_user_id", userId)
            // Reload to re-evaluate needsServerSetup() — will skip to LaunchPad
            window.location.reload()
          }
        }
      }).then((h) => { cleanup = () => h.remove() })
    })
    return () => { cleanup?.() }
  }, [])

  // Parse QR text: extract server URL and optional pair code
  const parseQrUrl = (text: string): { serverUrl: string; pairCode: string | null } | null => {
    try {
      const url = new URL(text)
      const pairCode = url.searchParams.get("pair")
      // server URL = origin (e.g. http://192.168.1.5:3456)
      const server = url.origin
      return { serverUrl: server, pairCode: pairCode && /^\d{6}$/.test(pairCode) ? pairCode : null }
    } catch {
      return null
    }
  }

  const handleQrScan = async (text: string) => {
    setScanning(false)
    const parsed = parseQrUrl(text)
    if (!parsed) {
      setError(t("app.cannotRecognizeQr"))
      return
    }

    setStatus(t("app.connecting"))
    setError("")
    localStorage.setItem("agentrune_server", parsed.serverUrl)

    // If QR contains a pair code, auto-pair
    if (parsed.pairCode) {
      try {
        const ctrl = new AbortController()
        setTimeout(() => ctrl.abort(), 5000)
        const res = await fetch(`${parsed.serverUrl}/api/auth/pair`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: parsed.pairCode, deviceName: getDeviceName() }),
          signal: ctrl.signal,
        })
        if (res.ok) {
          const data = await res.json()
          localStorage.setItem("agentrune_device_id", data.deviceId)
          localStorage.setItem("agentrune_device_token", data.deviceToken)
          setStatus(t("app.pairingSuccess"))
          setTimeout(onConnected, 500)
          return
        } else {
          setError(t("app.pairingFailed", { status: String(res.status) }))
          localStorage.removeItem("agentrune_server")
          setStatus("")
          return
        }
      } catch (e: any) {
        // Fall through to try check endpoint
        console.error("Pair fetch error:", e)
      }
    }

    // No pair code or pairing failed — just check if server is reachable
    try {
      const ctrl2 = new AbortController()
      setTimeout(() => ctrl2.abort(), 5000)
      const res = await fetch(`${parsed.serverUrl}/api/auth/check`, { signal: ctrl2.signal })
      if (res.ok) {
        setStatus(t("app.connected"))
        setTimeout(onConnected, 500)
        return
      }
    } catch (e: any) {
      console.error("Check fetch error:", e)
    }

    setError(t("app.connectionFailed", { url: parsed.serverUrl }))
    localStorage.removeItem("agentrune_server")
    setStatus("")
  }

  const handleManualConnect = async () => {
    if (!serverUrl.trim()) return
    setError("")
    const url = serverUrl.trim().replace(/\/$/, "")
    setStatus(t("app.connecting"))
    localStorage.setItem("agentrune_server", url)
    try {
      const res = await fetch(`${url}/api/auth/check`)
      if (res.ok) {
        setStatus(t("app.connected"))
        setTimeout(onConnected, 500)
        return
      }
    } catch { }
    setError(t("app.cannotConnectServer"))
    localStorage.removeItem("agentrune_server")
    setStatus("")
  }

  if (scanning) {
    return <QrScannerView onScan={handleQrScan} onCancel={() => setScanning(false)} />
  }

  return (
    <div style={{
      height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      color: "var(--text-primary)",
    }}>
      <div style={{
        width: 360, textAlign: "center", padding: 36, borderRadius: 20,
        background: "var(--glass-bg)", backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)",
        border: "1px solid var(--glass-border)", boxShadow: "var(--glass-shadow)",
      }}>
        <div style={{ fontSize: 36, fontWeight: 700, marginBottom: 4, letterSpacing: -1, color: "var(--text-primary)" }}>
          AgentRune
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 28, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600, opacity: 0.7 }}>
          {t("app.connectToComputer")}
        </div>

        {/* AgentLore Login — Primary */}
        <button
          onClick={() => {
            import("@capacitor/browser").then(({ Browser }) =>
              Browser.open({ url: "https://agentlore.vercel.app/api/agentrune/phone-auth" })
                .catch(() => window.open("https://agentlore.vercel.app/api/agentrune/phone-auth", "_blank"))
            )
          }}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            width: "100%", padding: "16px", borderRadius: 14, marginBottom: 12,
            border: "1.5px solid rgba(59,130,246,0.5)",
            background: "rgba(59,130,246,0.12)",
            color: "var(--accent-primary)", fontSize: 16, fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
          {t("settings.loginAgentLore")}
        </button>

        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 20, opacity: 0.7, lineHeight: 1.5 }}>
          {t("app.loginAgentLoreHint")}
        </div>

        {/* Advanced: QR / Manual */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            width: "100%", padding: "10px", borderRadius: 12, marginBottom: showAdvanced ? 16 : 0,
            border: "1px solid var(--glass-border)", background: "transparent",
            color: "var(--text-secondary)", fontSize: 13, fontWeight: 500, cursor: "pointer",
          }}
        >
          {t("app.advancedConnect")}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: showAdvanced ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {showAdvanced && (<>
          {/* QR Scan */}
          <button
            onClick={() => setScanning(true)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              width: "100%", padding: "13px", borderRadius: 14, marginBottom: 12,
              border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
              color: "var(--text-primary)", fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="3" height="3" />
              <path d="M20 14v3h-3M14 20h3v-3M20 20h.01" />
            </svg>
            {t("app.scanQrToPair")}
          </button>

          {/* Manual URL */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="url"
              placeholder="http://192.168.1.x:3456"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleManualConnect()}
              style={{
                flex: 1, padding: "12px 14px", borderRadius: 14,
                border: "1px solid var(--glass-border)", background: "var(--icon-bg)",
                color: "var(--text-primary)", fontSize: 14, outline: "none",
              }}
            />
            <button
              onClick={handleManualConnect}
              style={{
                padding: "12px 18px", borderRadius: 14, border: "1px solid rgba(59,130,246,0.3)",
                background: "rgba(59,130,246,0.1)", color: "var(--accent-primary)",
                fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}
            >
              {t("app.connect")}
            </button>
          </div>

          <div style={{
            marginTop: 8, padding: "12px 16px", borderRadius: 14,
            background: "var(--icon-bg)", border: "1px solid var(--glass-border)",
          }}>
            <div
              style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6, opacity: 0.7 }}
              dangerouslySetInnerHTML={{ __html: t("app.serverInstructions") }}
            />
          </div>
        </>)}

        {status && (
          <div style={{ color: "#4ade80", fontSize: 13, marginTop: 12 }}>{status}</div>
        )}
        {error && (
          <div style={{
            color: "#f87171", fontSize: 13, marginTop: 12,
            padding: "8px 12px", borderRadius: 12, background: "rgba(248,113,113,0.08)",
          }}>
            {error}
          </div>
        )}

        {/* VPN warning */}
        <div style={{
          marginTop: 12, padding: "10px 14px", borderRadius: 14,
          background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)",
        }}>
          <div style={{ fontSize: 11, color: "#fbbf24", lineHeight: 1.5, opacity: 0.9 }}>
            {t("app.vpnWarning")}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Auth screen (TOTP only — pairing handled by ConnectScreen) ──

function AuthScreen({
  mode,
  error,
  onTotp,
}: {
  mode: AuthMode
  error: string
  onTotp: (code: string) => void
}) {
  const [code, setCode] = useState("")
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const handleDigitChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return
    const newCode = code.split("")
    newCode[index] = value
    const joined = newCode.join("").slice(0, 6)
    setCode(joined)

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }

    if (joined.length === 6) {
      onTotp(joined)
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
      const newCode = code.split("")
      newCode[index - 1] = ""
      setCode(newCode.join(""))
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
    setCode(pasted)
    if (pasted.length === 6) {
      onTotp(pasted)
    } else {
      inputRefs.current[pasted.length]?.focus()
    }
  }

  return (
    <div style={{
      height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      color: "var(--text-primary)",
    }}>
      <div style={{
        width: 360, textAlign: "center", padding: 36, borderRadius: 20,
        background: "var(--glass-bg)", backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)",
        border: "1px solid var(--glass-border)", boxShadow: "var(--glass-shadow)",
      }}>
        <div style={{ fontSize: 36, fontWeight: 700, marginBottom: 4, letterSpacing: -1, color: "var(--text-primary)" }}>
          AgentRune
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 32, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600, opacity: 0.7 }}>
          Authenticator
        </div>

        <div style={{ marginBottom: 20 }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" style={{ margin: "0 auto", opacity: 0.6 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>

        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 28, lineHeight: 1.5, opacity: 0.8 }}>
          Enter the 6-digit code from Google Authenticator
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 20 }} onPaste={handlePaste}>
          {Array.from({ length: 6 }).map((_, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={code[i] || ""}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              autoFocus={i === 0}
              style={{
                width: 44, height: 56, textAlign: "center",
                fontSize: 24, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                borderRadius: 14,
                border: code[i] ? "2px solid rgba(59,130,246,0.4)" : "1px solid var(--glass-border)",
                background: code[i] ? "rgba(59,130,246,0.06)" : "var(--icon-bg)",
                color: "var(--text-primary)", outline: "none", transition: "all 0.2s",
              }}
            />
          ))}
        </div>

        {error && (
          <div style={{
            color: "#f87171", fontSize: 13, marginTop: 12,
            padding: "8px 12px", borderRadius: 12, background: "rgba(248,113,113,0.08)",
          }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

function CheckingScreen() {
  return (
    <div style={{
      height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      color: "var(--text-primary)",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 12, letterSpacing: -1, color: "var(--text-primary)" }}>AgentRune</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", opacity: 0.7 }}>Connecting...</div>
      </div>
    </div>
  )
}

// ─── Dev mode check ─────────────────────────────────────────────

const IS_DEV_PREVIEW = typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("dev")

// ─── Main App (Router) ──────────────────────────────────────────

type Screen = "launchpad" | "session"

export function App() {
  const [serverReady, setServerReady] = useState(IS_DEV_PREVIEW || !needsServerSetup())
  const { status, mode, error: authError, sessionToken, pairWithCode, verifyTotp, recheckAuth } = useAuth(serverReady && !IS_DEV_PREVIEW)
  const [projects, setProjects] = useState<Project[]>(IS_DEV_PREVIEW ? [
    { id: "demo", name: "Demo Project", cwd: "/home/user/project" },
  ] : [])
  const [screen, setScreen] = useState<Screen>("launchpad")
  const [selectedProject, setSelectedProject] = useState<string | null>(IS_DEV_PREVIEW ? "demo" : null)
  const [activeAgentId, setActiveAgentId] = useState<string>("terminal")
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"board" | "terminal">("board")
  const [activeSessions, setActiveSessions] = useState<AppSession[]>([])
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("agentrune_theme") as "light" | "dark") || "light"
  )
  const { connect, send, on } = useWs()

  const isAuthed = IS_DEV_PREVIEW || status === "authenticated"

  // Load projects after auth
  useEffect(() => {
    if (!isAuthed) return
    fetch(`${getApiBase()}/api/projects`)
      .then((r) => r.json())
      .then((data) => {
        setProjects(data)
        // Auto-select last used project or first
        const last = getLastProject()
        if (last && data.find((p: Project) => p.id === last)) {
          setSelectedProject(last)
        } else if (data.length > 0) {
          setSelectedProject(data[0].id)
        }
      })
      .catch(() => { })

    // Load active sessions
    fetch(`${getApiBase()}/api/sessions`)
      .then((r) => r.json())
      .then((data: { id: string; projectId: string; agentId: string }[]) => {
        setActiveSessions(data.map((s) => ({
          id: s.id,
          projectId: s.projectId,
          agentId: s.agentId,
        })))
      })
      .catch(() => { })
  }, [isAuthed])

  // Connect WS after auth
  useEffect(() => {
    if (!isAuthed) return
    const ws = connect(sessionToken)
    return () => { ws.close() }
  }, [isAuthed, connect, sessionToken])

  // Theme: apply dark class to <html>
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [theme])

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light"
    setTheme(newTheme)
    localStorage.setItem("agentrune_theme", newTheme)
  }

  // Android hardware back button
  const screenRef = useRef(screen)
  const viewModeRef = useRef(viewMode)
  useEffect(() => { screenRef.current = screen }, [screen])
  useEffect(() => { viewModeRef.current = viewMode }, [viewMode])

  useEffect(() => {
    if (!isCapacitor()) return
    let handle: { remove: () => void } | null = null
    CapApp.addListener("backButton", () => {
      // Dispatch a cancelable event — overlays can intercept it
      const evt = new Event("app:back", { cancelable: true })
      const wasCancelled = !document.dispatchEvent(evt)
      if (wasCancelled) return // An overlay handled it

      // Screen-level navigation
      if (screenRef.current === "session") {
        if (viewModeRef.current === "terminal") {
          setViewMode("board")
        } else {
          setScreen("launchpad")
          setViewMode("board")
        }
      } else {
        CapApp.minimizeApp()
      }
    }).then((h) => { handle = h })
    return () => { handle?.remove() }
  }, [])

  // Dev preview skips all auth
  if (!IS_DEV_PREVIEW) {
    // Need server setup first (Capacitor, no saved server URL)
    if (!serverReady) {
      return <ConnectScreen onConnected={() => { setServerReady(true); recheckAuth() }} />
    }

    // Auth gates
    if (status === "checking") return <CheckingScreen />
    if (status === "need-auth" || status === "need-setup") {
      if (mode === "totp") {
        return <AuthScreen mode={mode} error={authError} onTotp={verifyTotp} />
      }
      if (isCapacitor()) {
        return <ConnectScreen onConnected={() => { setServerReady(true); recheckAuth() }} />
      }
      return <AuthScreen mode={mode} error={authError || ""} onTotp={verifyTotp} />
    }
  }

  // Launch handler — creates a new session
  const handleLaunch = (projectId: string, agentId: string) => {
    const sessionId = `${projectId}_${Date.now()}`
    setSelectedProject(projectId)
    setActiveAgentId(agentId)
    setCurrentSessionId(sessionId)
    saveLastProject(projectId)
    setActiveSessions((prev) => [...prev, { id: sessionId, projectId, agentId }])
    setScreen("session")
    setViewMode("board")
  }

  // Resume handler — resumes a specific session
  const handleResume = (sessionId: string) => {
    const session = activeSessions.find((s) => s.id === sessionId)
    if (session) {
      setSelectedProject(session.projectId)
      setActiveAgentId(session.agentId)
      setCurrentSessionId(sessionId)
      saveLastProject(session.projectId)
      setScreen("session")
    }
  }

  // Open a session directly in terminal view
  const handleOpenSessionTerminal = (sessionId: string) => {
    const session = activeSessions.find((s) => s.id === sessionId)
    if (session) {
      setSelectedProject(session.projectId)
      setActiveAgentId(session.agentId)
      setCurrentSessionId(sessionId)
      saveLastProject(session.projectId)
      setScreen("session")
      setViewMode("terminal")
    }
  }

  // Kill handler — kills a specific session
  const handleKill = async (sessionId: string) => {
    try {
      await fetch(`${getApiBase()}/api/sessions/${sessionId}/kill`, { method: "POST" })
    } catch { }
    setActiveSessions((prev) => prev.filter((s) => s.id !== sessionId))
  }

  // New project handler
  const handleNewProject = async (name: string, cwd: string) => {
    try {
      const res = await fetch(`${getApiBase()}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, cwd }),
      })
      if (res.ok) {
        const project = await res.json()
        setProjects((prev) => [...prev, project])
        setSelectedProject(project.id)
      }
    } catch { }
  }

  // Back to launchpad
  const handleBack = () => {
    setScreen("launchpad")
  }

  if (screen === "session" && selectedProject) {
    const project = projects.find((p) => p.id === selectedProject)
    if (project) {
      return (
        <>
          {/* Always keep TerminalView mounted to preserve xterm content.
              When in board mode, push it behind MissionControl with lower z-index
              and visibility:hidden so xterm keeps its layout dimensions. */}
          <div style={viewMode !== "terminal" ? {
            position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
            visibility: "hidden", zIndex: 0,
          } : undefined}>
            <TerminalView
              project={project}
              agentId={activeAgentId}
              sessionId={currentSessionId || undefined}
              sessionToken={sessionToken}
              send={send}
              on={on}
              onBack={() => setViewMode("board")}
            />
          </div>
          {/* Always keep MissionControl mounted to preserve events state.
              When in terminal mode, hide it with visibility:hidden (mirrors TerminalView pattern). */}
          <div style={viewMode === "terminal" ? {
            position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
            visibility: "hidden", zIndex: 0,
          } : undefined}>
            <MissionControl
              project={project}
              agentId={activeAgentId}
              sessionId={currentSessionId || undefined}
              sessionToken={sessionToken}
              send={send}
              on={on}
              onBack={() => { setScreen("launchpad"); setViewMode("board") }}
              onOpenTerminal={() => setViewMode("terminal")}
              projects={projects}
              activeSessions={activeSessions}
              onSwitchSession={handleResume}
              onKillSession={handleKill}
              onOpenSessionTerminal={handleOpenSessionTerminal}
              theme={theme}
              toggleTheme={toggleTheme}
            />
          </div>
        </>
      )
    }
  }

  return (
    <LaunchPad
      projects={projects}
      activeSessions={activeSessions}
      onLaunch={handleLaunch}
      onResume={handleResume}
      onKill={handleKill}
      onNewProject={handleNewProject}
      selectedProject={selectedProject}
      onSelectProject={(id) => {
        setSelectedProject(id)
        saveLastProject(id)
      }}
      theme={theme}
      toggleTheme={toggleTheme}
      onCloudConnect={() => window.location.reload()}
    />
  )
}
