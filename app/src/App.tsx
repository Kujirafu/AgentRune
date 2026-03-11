import { useState, useEffect, useRef, useCallback, lazy, Suspense, Component, type ErrorInfo, type ReactNode } from "react"
import "@xterm/xterm/css/xterm.css"
import type { Project, AppSession, AgentEvent } from "./types"
import { getLastProject, saveLastProject, getVolumeKeysEnabled, getKeepAwakeEnabled, getNotificationsEnabled, getAutoUpdateEnabled, getLastUpdateCheck, setLastUpdateCheck, getSkippedVersion } from "./lib/storage"
import { LocalNotifications } from "@capacitor/local-notifications"
import { LaunchPad } from "./components/LaunchPad"
const TerminalView = lazy(() => import("./components/TerminalView").then(m => ({ default: m.TerminalView })))
import { MissionControl } from "./components/MissionControl"
import { ProjectOverview } from "./components/ProjectOverview"
import { UnifiedPanel } from "./components/UnifiedPanel"
import { DiffPanel } from "./components/DiffPanel"
import { ChainBuilder } from "./components/ChainBuilder"
import { App as CapApp } from "@capacitor/app"
import { Browser } from "@capacitor/browser"
import { useLocale } from "./lib/i18n/index.js"
import { motion, AnimatePresence } from "framer-motion"

// ─── Error Boundary ──────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: "#ef4444", fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap" }}>
          <h2>App Error</h2>
          <p>{this.state.error.message}</p>
          <p>{this.state.error.stack}</p>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 16, padding: "8px 16px", fontSize: 14 }}>
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Server URL helpers ──────────────────────────────────────────

function isCapacitor(): boolean {
  return typeof window !== "undefined" &&
    !!(window as any).Capacitor &&
    (window as any).Capacitor.isNativePlatform?.() === true
}

function needsServerSetup(): boolean {
  if (!isCapacitor()) return false
  // Cloud mode: phone logged in to AgentLore — go directly to LaunchPad,
  // user taps a device in Quick Connect to set the server URL.
  if (localStorage.getItem("agentrune_phone_token")) return false
  return !localStorage.getItem("agentrune_server")
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

// ─── Auto-refresh tunnel URL from AgentLore ─────────────────────
/** Returns { url, sessionToken } if an ONLINE device is found, null otherwise */
async function refreshTunnelUrl(): Promise<{ url: string; sessionToken?: string } | null> {
  const token = localStorage.getItem("agentrune_phone_token")
  if (!token) return null
  try {
    const res = await fetch("https://agentlore.vercel.app/api/agentrune/devices", {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    const devices: any[] = data.data?.devices ?? []
    const online = devices.find((d: any) => d.status === "ONLINE")
    if (online) {
      const newUrl = online.tunnelUrl || `http://${online.localIp}:${online.port}`
      const oldUrl = localStorage.getItem("agentrune_server") || ""
      if (newUrl !== oldUrl) {
        console.log(`[WS] Tunnel URL refreshed: ${oldUrl} → ${newUrl}`)
        localStorage.setItem("agentrune_server", newUrl)
      }
      return { url: newUrl, sessionToken: online.cloudSessionToken }
    }
  } catch {}
  return null
}

// ─── WebSocket hook ──────────────────────────────────────────────

function useWs() {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<Map<string, Set<(msg: Record<string, unknown>) => void>>>(new Map())
  const tokenRef = useRef<string>("")
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Prevent duplicate connect() calls while a WebSocket is already connecting/open
  const connectingRef = useRef(false)
  // Exponential backoff for reconnect: resets on successful open
  const backoffRef = useRef(300)
  const [wsConnected, setWsConnected] = useState(false)
  // Client-side heartbeat: ping every 15s, expect pong within 5s
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pongTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null }
    if (pongTimeoutRef.current) { clearTimeout(pongTimeoutRef.current); pongTimeoutRef.current = null }
  }, [])

  const doConnect = useCallback((sessionToken: string) => {
    // Avoid duplicate connections
    if (connectingRef.current) return wsRef.current
    const existing = wsRef.current
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return existing
    }
    connectingRef.current = true
    tokenRef.current = sessionToken

    const ws = new WebSocket(`${getWsUrl()}?token=${encodeURIComponent(sessionToken)}`)
    wsRef.current = ws

    ws.onopen = () => {
      connectingRef.current = false
      backoffRef.current = 300 // Reset backoff on successful connect
      setWsConnected(true)
      const handlers = handlersRef.current.get("__ws_open__")
      if (handlers) for (const h of handlers) h({})
      // Start client-side heartbeat — ping every 15s, expect pong within 5s
      stopHeartbeat()
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        try {
          ws.send(JSON.stringify({ type: "ping" }))
          if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current)
          pongTimeoutRef.current = setTimeout(() => {
            console.warn("[WS] No pong in 5s — connection dead")
            stopHeartbeat()
            // Close ws to trigger onclose → auto-reconnect
            try { ws.close() } catch {}
          }, 5000)
        } catch {
          stopHeartbeat()
          try { ws.close() } catch {}
        }
      }, 15000)
    }

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      // Handle pong — clear the dead-connection timeout
      if (msg.type === "pong") {
        if (pongTimeoutRef.current) { clearTimeout(pongTimeoutRef.current); pongTimeoutRef.current = null }
        return
      }
      // Handle token refresh from daemon (e.g. after daemon restart)
      if (msg.type === "token_refresh" && msg.sessionToken) {
        tokenRef.current = msg.sessionToken as string
      }
      const handlers = handlersRef.current.get(msg.type)
      if (handlers) for (const h of handlers) h(msg)
    }

    ws.onclose = () => {
      connectingRef.current = false
      setWsConnected(false)
      stopHeartbeat()
      const handlers = handlersRef.current.get("__ws_close__")
      if (handlers) for (const h of handlers) h({})
      // Auto-reconnect with exponential backoff (300ms → 600ms → 1200ms → max 5s)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      const delay = backoffRef.current
      backoffRef.current = Math.min(delay * 2, 5000)

      // After 3+ failures (backoff >= 2400ms), refresh tunnel URL from AgentLore
      if (delay >= 2400 && isCapacitor()) {
        refreshTunnelUrl().then(() => {
          reconnectTimerRef.current = setTimeout(() => doConnect(tokenRef.current), 500)
        }).catch(() => {
          reconnectTimerRef.current = setTimeout(() => doConnect(tokenRef.current), delay)
        })
      } else {
        reconnectTimerRef.current = setTimeout(() => doConnect(tokenRef.current), delay)
      }
    }

    ws.onerror = () => {
      // onerror is always followed by onclose, so just reset flag
      connectingRef.current = false
    }

    return ws
  }, [])

  // Force-reconnect: kill current WS and reconnect immediately
  // Used when the app comes back from background
  const forceReconnect = useCallback(() => {
    if (!tokenRef.current) return
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    connectingRef.current = false
    backoffRef.current = 300 // Reset backoff for immediate reconnect
    const existing = wsRef.current
    if (existing) {
      // Detach handlers to prevent the onclose auto-reconnect from racing
      existing.onclose = null
      existing.onerror = null
      existing.onmessage = null
      existing.onopen = null
      try { existing.close() } catch {}
      wsRef.current = null
    }
    // Fire close handlers so UI updates immediately
    const handlers = handlersRef.current.get("__ws_close__")
    if (handlers) for (const h of handlers) h({})
    // Reconnect immediately
    doConnect(tokenRef.current)
  }, [doConnect])

  // Listen for app resume (visibility change + Capacitor appStateChange)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return
      if (!tokenRef.current) return
      const ws = wsRef.current
      // If WS is gone or not open, force reconnect immediately
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        forceReconnect()
      }
    }
    document.addEventListener("visibilitychange", onVisible)

    let capHandle: { remove: () => void } | null = null
    if (isCapacitor()) {
      CapApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive && tokenRef.current) {
          const ws = wsRef.current
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            forceReconnect()
          }
        }
      }).then((h) => { capHandle = h })
    }

    // Network change detection — reconnect immediately when switching WiFi/mobile
    const onOnline = () => {
      if (!tokenRef.current) return
      // Small delay to let network stabilize
      setTimeout(() => {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          forceReconnect()
        }
      }, 500)
    }
    window.addEventListener("online", onOnline)

    // navigator.connection change (WiFi ↔ cellular switch)
    const conn = (navigator as any).connection
    const onConnChange = () => {
      if (!tokenRef.current) return
      setTimeout(() => {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          forceReconnect()
        } else {
          // WS might still show OPEN but actually dead after network switch — send ping
          try { ws.send(JSON.stringify({ type: "ping" })) } catch { forceReconnect() }
        }
      }, 300)
    }
    if (conn) conn.addEventListener("change", onConnChange)

    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("online", onOnline)
      if (conn) conn.removeEventListener("change", onConnChange)
      capHandle?.remove()
    }
  }, [forceReconnect])

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

  return { connect: doConnect, send, on, wsConnected }
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

function ConnectScreen({ onConnected, onLogin }: { onConnected: () => void; onLogin?: (token: string) => void }) {
  const { t } = useLocale()
  const [scanning, setScanning] = useState(false)
  const [serverUrl, setServerUrl] = useState("")
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [setupOs, setSetupOs] = useState<"mac" | "windows">("mac")
  // Auto-expand QR section if already logged in to AgentLore (next step is scanning)
  const [showAdvanced, setShowAdvanced] = useState(!!localStorage.getItem("agentrune_phone_token"))
  // Persist polling code across app kills — resume on restart
  const [pollingCode, setPollingCode] = useState<string | null>(
    () => localStorage.getItem("agentrune_polling_code")
  )
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const savePollingCode = (code: string | null) => {
    setPollingCode(code)
    if (code) localStorage.setItem("agentrune_polling_code", code)
    else localStorage.removeItem("agentrune_polling_code")
  }

  const doPoll = useCallback(async (code: string) => {
    try {
      const res = await fetch(`https://agentlore.vercel.app/api/agentrune/mobile-auth/poll?code=${code}`)
      const data = await res.json()
      if (data.data?.status === "confirmed") {
        clearInterval(pollingRef.current!)
        savePollingCode(null)
        const token = data.data.token as string
        localStorage.setItem("agentrune_phone_token", token)
        if (data.data.userId) localStorage.setItem("agentrune_user_id", data.data.userId)
        if (onLogin) {
          onLogin(token)
        } else {
          window.location.reload()
        }
      } else if (data.data?.status === "expired") {
        clearInterval(pollingRef.current!)
        savePollingCode(null)
        setError(t("app.loginExpired"))
        setStatus("")
      }
    } catch { /* network error, retry next tick */ }
  }, [t])

  // Poll every 3s; also poll immediately when app comes back to foreground
  useEffect(() => {
    if (!pollingCode) return
    doPoll(pollingCode) // immediate check on mount / code change
    pollingRef.current = setInterval(() => doPoll(pollingCode), 3000)
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [pollingCode, doPoll])

  // Re-poll when app returns to foreground (three independent mechanisms)
  useEffect(() => {
    if (!pollingCode) return
    let cleanupState: (() => void) | undefined
    let cleanupBrowser: (() => void) | undefined

    // 1. Capacitor lifecycle (fires when activity goes background → foreground)
    CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive && pollingCode) doPoll(pollingCode)
    }).then((h) => { cleanupState = () => h.remove() })

    // 2. Browser plugin event (for iOS SFSafariViewController / in-app browser close)
    Browser.addListener("browserFinished", () => {
      if (pollingCode) doPoll(pollingCode)
    }).then((h) => { cleanupBrowser = () => h.remove() })

    // 3. Standard DOM visibility (most reliable in Android WebView — fires on resume)
    const onVisible = () => {
      if (!document.hidden && pollingCode) doPoll(pollingCode)
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => { cleanupState?.(); cleanupBrowser?.(); document.removeEventListener("visibilitychange", onVisible) }
  }, [pollingCode, doPoll])

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

        {/* AgentLore login status badge */}
        {localStorage.getItem("agentrune_phone_token") ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "10px 16px", borderRadius: 12, marginBottom: 16,
            background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)",
          }}>
            <span style={{ color: "#4ade80", fontSize: 15 }}>&#10003;</span>
            <span style={{ color: "#4ade80", fontSize: 13, fontWeight: 600 }}>
              {t("app.agentLoreConnected")}
            </span>
          </div>
        ) : (
          <>
        {/* AgentLore Login — Polling-based (no deep link) */}
        <button
          disabled={!!pollingCode}
          onClick={() => {
            setError("")
            const code = Array.from(crypto.getRandomValues(new Uint8Array(16)))
              .map(b => b.toString(16).padStart(2, "0")).join("")
            const authUrl = `https://agentlore.vercel.app/zh-TW/agentrune/mobile-auth?code=${code}`
            savePollingCode(code)
            setStatus(t("app.waitingForBrowserLogin"))
            // Use _system to open real Chrome — Browser.open() uses Chrome Custom Tab
            // which Google blocks with disallowed_useragent for OAuth flows
            window.open(authUrl, "_system")
          }}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            width: "100%", padding: "16px", borderRadius: 14, marginBottom: 12,
            border: "1.5px solid rgba(59,130,246,0.5)",
            background: pollingCode ? "rgba(59,130,246,0.06)" : "rgba(59,130,246,0.12)",
            color: "var(--accent-primary)", fontSize: 16, fontWeight: 700,
            cursor: pollingCode ? "default" : "pointer", opacity: pollingCode ? 0.7 : 1,
          }}
        >
          {pollingCode ? (
            <>
              <span style={{ width: 18, height: 18, border: "2px solid rgba(59,130,246,0.4)", borderTopColor: "rgba(59,130,246,0.9)", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }} />
              {t("app.waitingForBrowserLogin")}
            </>
          ) : (
            <>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
              {t("settings.loginAgentLore")}
            </>
          )}
        </button>
        {pollingCode && (
          <button
            onClick={() => { savePollingCode(null); setStatus(""); }}
            style={{ fontSize: 12, color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", marginBottom: 8, opacity: 0.6 }}
          >
            {t("app.cancel")}
          </button>
        )}

        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 20, opacity: 0.7, lineHeight: 1.5 }}>
          {t("app.loginAgentLoreHint")}
        </div>
          </>
        )}

        {/* Setup your computer */}
        <div style={{
          marginBottom: 16, padding: 16, borderRadius: 16,
          background: "var(--icon-bg)", border: "1px solid var(--glass-border)",
          textAlign: "left",
        }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            {t("app.setupComputer")}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
            {t("app.setupComputerHint")}
          </div>

          {/* OS tab selector */}
          <div style={{
            display: "flex", gap: 0, marginBottom: 10,
            background: "var(--card-bg)", borderRadius: 10, padding: 3,
            border: "1px solid var(--glass-border)",
          }}>
            {([
              { key: "mac" as const, label: "macOS / Linux" },
              { key: "windows" as const, label: "Windows" },
            ]).map((os) => (
              <button key={os.key} onClick={() => setSetupOs(os.key)} style={{
                flex: 1, padding: "7px 0", borderRadius: 8, border: "none", cursor: "pointer",
                background: setupOs === os.key ? "rgba(55, 172, 192, 0.12)" : "transparent",
                color: setupOs === os.key ? "#37ACC0" : "var(--text-secondary)",
                fontSize: 12, fontWeight: 600, transition: "all 0.2s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              }}>
                {os.key === "mac" ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 17V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10" /><rect x="2" y="17" width="20" height="4" rx="1" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                )}
                {os.label}
              </button>
            ))}
          </div>

          {/* Terminal label */}
          <div style={{
            fontSize: 10, fontWeight: 600, color: "var(--text-secondary)",
            marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5,
          }}>
            {setupOs === "mac" ? "Terminal / Bash" : "PowerShell"}
          </div>

          {/* Command display */}
          <div style={{
            padding: "10px 12px", borderRadius: 10,
            background: "var(--card-bg)", border: "1px solid var(--glass-border)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11, color: "var(--text-primary)",
            wordBreak: "break-all", lineHeight: 1.6,
            position: "relative",
          }}>
            {setupOs === "mac"
              ? "curl -fsSL https://agentlore.vercel.app/install.sh | sh"
              : "irm https://agentlore.vercel.app/install.ps1 | iex"}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={async () => {
                const cmd = setupOs === "mac"
                  ? "curl -fsSL https://agentlore.vercel.app/install.sh | sh"
                  : "irm https://agentlore.vercel.app/install.ps1 | iex"
                try {
                  await navigator.clipboard.writeText(cmd)
                  setStatus(t("app.copied"))
                  setTimeout(() => setStatus(""), 2000)
                } catch { }
              }}
              style={{
                flex: 1, padding: "10px", borderRadius: 10,
                border: "1px solid var(--glass-border)",
                background: "var(--glass-bg)",
                color: "var(--text-primary)",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              {t("app.copyCommand")}
            </button>
            <button
              onClick={async () => {
                const cmd = setupOs === "mac"
                  ? "curl -fsSL https://agentlore.vercel.app/install.sh | sh"
                  : "irm https://agentlore.vercel.app/install.ps1 | iex"
                try {
                  if (navigator.share) {
                    await navigator.share({ title: "AgentRune Setup", text: cmd })
                  } else {
                    await navigator.clipboard.writeText(cmd)
                    setStatus(t("app.copied"))
                    setTimeout(() => setStatus(""), 2000)
                  }
                } catch { }
              }}
              style={{
                flex: 1, padding: "10px", borderRadius: 10,
                border: "1px solid rgba(55, 172, 192, 0.3)",
                background: "rgba(55, 172, 192, 0.08)",
                color: "#37ACC0",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              {t("app.shareCommand")}
            </button>
          </div>
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
          {mode === "pairing"
            ? "Enter the 6-digit pairing code shown on your computer"
            : "Enter the 6-digit code from Google Authenticator"}
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

type Screen = "launchpad" | "overview" | "session" | "builder"

// ─── Auto Update Checker ────────────────────────────────────────
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000 // 6 hours
const GITHUB_RELEASES_URL = "https://api.github.com/repos/Kujirafu/agentrune/releases"
const APK_DOWNLOAD_URL = "https://github.com/Kujirafu/agentrune/releases/latest/download/agentrune.apk"

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number)
  const pb = b.replace(/^v/, "").split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

function isStableRelease(release: { tag_name: string; prerelease: boolean; draft: boolean }): boolean {
  return !release.prerelease && !release.draft && !/-(alpha|beta|rc|dev|canary)/i.test(release.tag_name)
}

async function checkForUpdate(): Promise<{ version: string; url: string; notes: string } | null> {
  try {
    window.dispatchEvent(new CustomEvent("updateChecking", { detail: true }))
    const res = await fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
    })
    if (!res.ok) return null
    const releases: { tag_name: string; prerelease: boolean; draft: boolean; body?: string }[] = await res.json()
    const stable = releases.find(isStableRelease)
    if (!stable) return null

    const remoteVersion = stable.tag_name.replace(/^v/, "")
    const currentVersion = (typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0")
    const skipped = getSkippedVersion()

    if (compareVersions(remoteVersion, currentVersion) > 0 && remoteVersion !== skipped) {
      return {
        version: remoteVersion,
        url: APK_DOWNLOAD_URL,
        notes: stable.body?.slice(0, 500) || "",
      }
    }
    return null
  } catch {
    return null
  } finally {
    window.dispatchEvent(new CustomEvent("updateChecking", { detail: false }))
  }
}

export function App() {
  const { t } = useLocale()
  // Cloud mode: user logged in via AgentLore — reactive state so login completes without reload
  const [isCloudMode, setIsCloudMode] = useState(() => !!localStorage.getItem("agentrune_phone_token"))
  const [serverReady, setServerReady] = useState(() => IS_DEV_PREVIEW || !needsServerSetup())
  // Reactive server URL — updated when Quick Connect is used, triggers data reload
  const [serverUrl, setServerUrl] = useState(() => getServerUrl())
  // Cloud session token — pre-authorized WS token from AgentLore, skips local pairing
  const [cloudSessionToken, setCloudSessionToken] = useState<string | null>(
    () => localStorage.getItem("agentrune_cloud_token")
  )
  // Run local auth only when NO cloud session token (need pairing code / TOTP)
  const shouldRunAuth = serverReady && !IS_DEV_PREVIEW && (!isCloudMode || (!!serverUrl && !cloudSessionToken))
  const { status, mode, error: authError, sessionToken, pairWithCode, verifyTotp, recheckAuth } = useAuth(shouldRunAuth)
  const [projects, setProjects] = useState<Project[]>(IS_DEV_PREVIEW ? [
    { id: "demo", name: "Demo Project", cwd: "/home/user/project" },
  ] : [])
  const [screen, setScreen] = useState<Screen>("overview")
  // Auto-switch to overview when sessions load
  const [initialScreenSet, setInitialScreenSet] = useState(false)
  const [selectedProject, setSelectedProject] = useState<string | null>(IS_DEV_PREVIEW ? "demo" : null)
  const [activeAgentId, setActiveAgentId] = useState<string>("terminal")
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [resumeSessionId, setResumeSessionId] = useState<string | undefined>(undefined)
  const [viewMode, setViewMode] = useState<"board" | "terminal">("board")
  const [activeSessions, setActiveSessions] = useState<AppSession[]>([])
  const [diffEvent, setDiffEvent] = useState<AgentEvent | null>(null)
  const [allDiffEvents, setAllDiffEvents] = useState<AgentEvent[]>([])
  const [cliUpdate, setCliUpdate] = useState<{ latest: string; current: string } | null>(null)
  const requestVoiceRef = useRef<((callback: (text: string) => void, label?: string) => void) | null>(null)
  const [sessionEventsMap, setSessionEventsMap] = useState<Map<string, AgentEvent[]>>(new Map())
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("agentrune_theme") as "light" | "dark") || "light"
  )
  const { connect, send, on, wsConnected } = useWs()

  // ─── Auto Update Check ─────────────────────────────────────────
  useEffect(() => {
    const runCheck = async () => {
      if (!getAutoUpdateEnabled()) return
      const lastCheck = getLastUpdateCheck()
      const now = Date.now()
      if (now - lastCheck < UPDATE_CHECK_INTERVAL) return
      setLastUpdateCheck(now)
      const info = await checkForUpdate()
      if (info) {
        window.dispatchEvent(new CustomEvent("updateAvailable", { detail: info }))
      }
    }
    // Check on mount (after short delay to not block startup)
    const timeout = setTimeout(runCheck, 3000)
    // Listen for manual check requests (from Settings toggle)
    const handler = () => {
      setLastUpdateCheck(0) // reset to force check
      runCheck()
    }
    window.addEventListener("checkForUpdate", handler)
    return () => {
      clearTimeout(timeout)
      window.removeEventListener("checkForUpdate", handler)
    }
  }, [])

  // Cloud mode without a server URL = browsing LaunchPad (Quick Connect list)
  // Cloud mode WITH cloudSessionToken = pre-authorized, skip local auth
  // Cloud mode WITH server URL but NO cloudSessionToken = must authenticate locally
  const isAuthed = IS_DEV_PREVIEW || (isCloudMode && !serverUrl) || !!cloudSessionToken || status === "authenticated"

  // Load projects after auth, server URL change, or WS reconnect
  useEffect(() => {
    if (!isAuthed) return
    // Always read fresh URL from localStorage (serverUrl state may be stale after tunnel refresh)
    const base = getApiBase() || serverUrl
    // base="" is valid for same-origin browser access (relative URL)
    if (isCapacitor() && !base) return
    console.log(`[App] Loading projects: base=${base} wsConnected=${wsConnected} isAuthed=${isAuthed}`)
    fetch(`${base}/api/projects`)
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
    fetch(`${base}/api/sessions`)
      .then((r) => r.json())
      .then((data: { id: string; projectId: string; agentId: string; worktreeBranch?: string | null; lastEventTitle?: string }[] | unknown) => {
        if (!Array.isArray(data)) return
        const sessions = data.map((s: { id: string; projectId: string; agentId: string; worktreeBranch?: string | null; lastEventTitle?: string }) => ({
          id: s.id,
          projectId: s.projectId,
          agentId: s.agentId,
          worktreeBranch: s.worktreeBranch || null,
        }))
        setActiveSessions(sessions)
        // Seed sessionEventsMap with lastEventTitle from server so summaries show immediately
        setSessionEventsMap(prev => {
          const next = new Map(prev)
          for (const s of data) {
            if (s.lastEventTitle) {
              const existing = next.get(s.id)
              // Update if no existing events, or existing only has the init_ seed placeholder
              if (!existing || (existing.length === 1 && existing[0].id.startsWith("init_"))) {
                next.set(s.id, [{
                  id: `init_${s.id}`,
                  timestamp: Date.now(),
                  type: "response",
                  status: "in_progress",
                  title: s.lastEventTitle,
                }])
              }
            }
          }
          return next
        })
      })
      .catch(() => { })
  }, [isAuthed, serverUrl, wsConnected])

  // Also reload projects whenever WS reconnects (catches tunnel URL changes)
  useEffect(() => {
    if (!isAuthed) return
    return on("__ws_open__", () => {
      const base = getApiBase()
      if (!base && isCapacitor()) return
      fetch(`${base}/api/projects`)
        .then((r) => r.json())
        .then((data) => {
          setProjects(data)
          const last = getLastProject()
          if (last && data.find((p: Project) => p.id === last)) {
            setSelectedProject(last)
          } else if (data.length > 0 && !selectedProject) {
            setSelectedProject(data[0].id)
          }
        })
        .catch(() => { })
    })
  }, [isAuthed, on])

  // Listen for CLI update notification from daemon
  useEffect(() => {
    return on("cli_update_available", (msg) => {
      setCliUpdate({ latest: msg.latest as string, current: msg.current as string })
    })
  }, [on])

  // Connect WS after auth — use cloudSessionToken (from Quick Connect) or local sessionToken
  const wsToken = cloudSessionToken || sessionToken
  useEffect(() => {
    if (!isAuthed || !wsToken) return
    // In Capacitor, don't attempt WS if no server URL is configured (fresh install)
    if (isCapacitor() && !getServerUrl()) return
    connect(wsToken)
    // Cleanup: don't close on re-render — useWs manages its own lifecycle.
    // Only close on full unmount (App teardown).
  }, [isAuthed, connect, wsToken])

  // Update worktreeBranch on session when attached message arrives from server
  useEffect(() => {
    return on("attached", (msg) => {
      const sessionId = msg.sessionId as string
      const branch = (msg.worktreeBranch as string | null) || null
      if (sessionId && branch) {
        setActiveSessions((prev) =>
          prev.map((s) => s.id === sessionId ? { ...s, worktreeBranch: branch } : s)
        )
      }
    })
  }, [on])

  // Theme: apply dark class to <html>
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [theme])

  // Wake Lock: keep screen on when enabled
  useEffect(() => {
    if (!getKeepAwakeEnabled()) return
    let wakeLock: WakeLockSentinel | null = null
    const request = async () => {
      try { wakeLock = await navigator.wakeLock.request("screen") } catch {}
    }
    request()
    // Re-acquire when tab becomes visible again (lock is released on tab switch)
    const onVisibility = () => { if (document.visibilityState === "visible") request() }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      wakeLock?.release().catch(() => {})
    }
  }, [])

  // Listen for keep-awake setting changes (from SettingsSheet)
  useEffect(() => {
    const handler = (e: Event) => {
      const enabled = (e as CustomEvent).detail
      if (enabled) {
        navigator.wakeLock.request("screen").catch(() => {})
      }
    }
    window.addEventListener("keepAwakeChanged", handler)
    return () => window.removeEventListener("keepAwakeChanged", handler)
  }, [])

  // Smart Notifications — fire local notification when agent is done/blocked and app is in background
  useEffect(() => {
    if (!isCapacitor()) return
    // Request permission on first enable
    const onEnable = () => {
      LocalNotifications.requestPermissions().catch(() => {})
    }
    window.addEventListener("notificationsChanged", onEnable)

    const unsub = on("agent_events", (msg) => {
      if (!getNotificationsEnabled()) return
      if (document.visibilityState === "visible") return // Only notify in background
      const events = msg.events as Array<{ type: string; title?: string; summary?: string }> | undefined
      if (!events) return
      for (const evt of events) {
        if (evt.type === "progress_report") {
          const summary = evt.summary || evt.title || ""
          const status = (evt as any).status
          if (status === "done" || status === "blocked") {
            LocalNotifications.schedule({
              notifications: [{
                id: Date.now(),
                title: status === "blocked" ? "Agent needs your input" : "Agent completed task",
                body: summary.slice(0, 200),
                smallIcon: "ic_launcher",
              }],
            }).catch(() => {})
          }
        }
      }
    })

    return () => { unsub(); window.removeEventListener("notificationsChanged", onEnable) }
  }, [on])

  // Automation completion notifications
  useEffect(() => {
    if (!isCapacitor()) return
    const unsub = on("automation_completed", (msg) => {
      if (!getNotificationsEnabled()) return
      const auto = msg.automation as { name?: string } | undefined
      const result = msg.result as { status?: string; finishedAt?: number; startedAt?: number } | undefined
      if (!auto || !result) return
      const name = auto.name || "Automation"
      const duration = result.startedAt && result.finishedAt
        ? Math.round((result.finishedAt - result.startedAt) / 1000)
        : 0
      const durationStr = duration > 60 ? `${Math.floor(duration / 60)}m ${duration % 60}s` : `${duration}s`
      LocalNotifications.schedule({
        notifications: [{
          id: Date.now(),
          title: result.status === "success" ? `${name} completed` : `${name} failed`,
          body: result.status === "success"
            ? `Finished in ${durationStr}`
            : `Status: ${result.status} (${durationStr})`,
          smallIcon: "ic_launcher",
        }],
      }).catch(() => {})
    })
    return () => unsub()
  }, [on])

  // Populate sessionEventsMap from session_activity broadcasts (for ProjectOverview summaries)
  useEffect(() => {
    const unsub1 = on("session_activity", (msg) => {
      const sid = msg.sessionId as string
      const title = msg.eventTitle as string
      const agentStatus = msg.agentStatus as string
      if (!sid) return
      // Skip noise titles that shouldn't be used as session summaries
      if (!title || /^\d[\d,]*\s*tokens?\s*(used|remaining|total)?$/i.test(title)
        || /^(Thinking|Processing)\.{0,3}$/i.test(title)
        || /^Permission requested/i.test(title)
        || /^Agent is requesting/i.test(title)
        || title === "Token usage"
        || /^(初始化|工作階段已)/i.test(title)
        || /^Session (started|ended|resumed)/i.test(title)
      ) return
      setSessionEventsMap(prev => {
        const next = new Map(prev)
        const events = next.get(sid) || []
        const event: AgentEvent = {
          id: `activity_${Date.now()}`,
          timestamp: Date.now(),
          type: "response",
          status: agentStatus === "waiting" ? "waiting" : "in_progress",
          title: title || "",
        }
        // Keep last 20 events per session to avoid memory bloat
        const updated = [...events, event].slice(-20)
        next.set(sid, updated)
        return next
      })
    })
    return () => { unsub1() }
  }, [on])

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light"
    setTheme(newTheme)
    localStorage.setItem("agentrune_theme", newTheme)
  }

  // Snapshot event handler — dispatched by ProjectOverview context menu
  useEffect(() => {
    const handler = (e: Event) => {
      const { sessionId, name } = (e as CustomEvent).detail
      send({ type: "snapshot_create", sessionId, name })
    }
    window.addEventListener("agentrune:snapshot", handler)
    return () => window.removeEventListener("agentrune:snapshot", handler)
  }, [send])

  // Health scan event handler
  useEffect(() => {
    const handler = (e: Event) => {
      const { projectId } = (e as CustomEvent).detail
      send({ type: "health_scan", projectId })
    }
    window.addEventListener("agentrune:healthScan", handler)
    return () => window.removeEventListener("agentrune:healthScan", handler)
  }, [send])

  // Deep link handler — receives agentrune://auth?token=...&userId=... from mobile-auth page
  // This fires when Chrome redirects back to the app after successful login
  useEffect(() => {
    if (!isCapacitor()) return
    let handle: { remove: () => void } | null = null
    CapApp.addListener("appUrlOpen", ({ url }) => {
      try {
        const u = new URL(url)
        if (u.hostname === "auth" || u.pathname === "/auth") {
          const token = u.searchParams.get("token")
          const userId = u.searchParams.get("userId")
          if (token) {
            localStorage.setItem("agentrune_phone_token", token)
            if (userId) localStorage.setItem("agentrune_user_id", userId)
            setIsCloudMode(true)
            setServerReady(true)
            // Auto-connect to first ONLINE device
            refreshTunnelUrl().then(async (device) => {
              if (device?.url) {
                localStorage.setItem("agentrune_server", device.url)
                setServerUrl(device.url)
                let csToken = device.sessionToken
                if (!csToken) {
                  // Fallback: request session token from CLI server
                  try {
                    const authRes = await fetch(`${device.url}/api/auth/cloud`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ phoneToken: token }),
                    })
                    if (authRes.ok) {
                      const authData = await authRes.json()
                      csToken = authData.sessionToken
                    }
                  } catch {}
                }
                if (csToken) {
                  localStorage.setItem("agentrune_cloud_token", csToken)
                  setCloudSessionToken(csToken)
                }
                recheckAuth()
              }
            })
          }
        }
      } catch { /* invalid URL */ }
    }).then((h) => { handle = h })
    return () => { handle?.remove() }
  }, [])

  // Android hardware back button
  const screenRef = useRef(screen)
  const viewModeRef = useRef(viewMode)
  useEffect(() => { screenRef.current = screen }, [screen])
  useEffect(() => { viewModeRef.current = viewMode }, [viewMode])

  // Volume keys → arrow up/down (global, sent to terminal via WebSocket)
  useEffect(() => {
    const handler = (e: Event) => {
      if (!getVolumeKeysEnabled()) return // respect setting toggle
      if (viewModeRef.current !== "terminal") return // only in terminal view
      const dir = (e as CustomEvent).detail
      const seq = dir === "up" ? "\x1b[A" : "\x1b[B"
      send({ type: "input", data: seq })
    }
    document.addEventListener("volume-key", handler)
    return () => document.removeEventListener("volume-key", handler)
  }, [send])

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
          setScreen("overview")
          setViewMode("board")
        }
      } else if (screenRef.current === "launchpad" || screenRef.current === "builder") {
        // LaunchPad / Builder — back goes to overview
        setScreen("overview")
      } else {
        // overview is home — minimize app
        CapApp.minimizeApp()
      }
    }).then((h) => { handle = h })
    return () => { handle?.remove() }
  }, [])

  // Dev preview skips all auth
  if (!IS_DEV_PREVIEW) {
    // Need server setup first (Capacitor, no saved server URL)
    const handleLogin = async (_token: string) => {
      setIsCloudMode(true)
      setServerReady(true)
      // Auto-connect to first ONLINE device after login
      const device = await refreshTunnelUrl()
      if (device?.url) {
        localStorage.setItem("agentrune_server", device.url)
        setServerUrl(device.url)
        // Try cloudSessionToken from devices API first
        let token = device.sessionToken
        if (!token) {
          // Fallback: request session token from CLI server using phone token
          const phoneToken = localStorage.getItem("agentrune_phone_token")
          if (phoneToken) {
            try {
              const authRes = await fetch(`${device.url}/api/auth/cloud`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phoneToken }),
              })
              if (authRes.ok) {
                const authData = await authRes.json()
                token = authData.sessionToken
              }
            } catch { /* network error — will fall through to auth gate */ }
          }
        }
        if (token) {
          localStorage.setItem("agentrune_cloud_token", token)
          setCloudSessionToken(token)
        }
        recheckAuth()
      }
    }

    if (!serverReady) {
      return <ConnectScreen onConnected={() => { setServerReady(true); recheckAuth() }} onLogin={handleLogin} />
    }

    // Auth gates — skipped in cloud mode before Quick Connect, or when cloudSessionToken available
    if ((!isCloudMode || serverUrl) && !cloudSessionToken) {
      if (status === "checking") return <CheckingScreen />
      if (status === "need-auth" || status === "need-setup") {
        if (mode === "totp") {
          return <AuthScreen mode={mode} error={authError} onTotp={verifyTotp} />
        }
        // Non-cloud Capacitor: show full ConnectScreen with QR scanning
        if (isCapacitor() && !isCloudMode) {
          return <ConnectScreen onConnected={() => { setServerReady(true); recheckAuth() }} onLogin={handleLogin} />
        }
        // Cloud mode or desktop: show code input screen
        // For pairing mode use pairWithCode, for totp use verifyTotp
        return <AuthScreen mode={mode} error={authError || ""} onTotp={mode === "pairing" ? pairWithCode : verifyTotp} />
      }
    }
  }

  // Launch handler — creates a new session
  // Optional resumeAgentSessionId: Claude Code session ID to resume (--resume <id>)
  const handleLaunch = (projectId: string, agentId: string, resumeAgentSessionId?: string) => {
    const sessionId = `${projectId}_${Date.now()}`
    setSelectedProject(projectId)
    setActiveAgentId(agentId)
    setCurrentSessionId(sessionId)
    setResumeSessionId(resumeAgentSessionId)
    saveLastProject(projectId)
    setActiveSessions((prev) => [...prev, { id: sessionId, projectId, agentId }])
    setScreen("session")
    setViewMode("board")
  }

  // Resume handler — resumes a specific AgentRune PTY session (not Claude Code session)
  const handleResume = (sessionId: string) => {
    const session = activeSessions.find((s) => s.id === sessionId)
    if (session) {
      const projectMatch = projects.find((p) => p.id === session.projectId)
      console.log("[handleResume]", { sessionId, projectId: session.projectId, projectMatch: !!projectMatch, projects: projects.map(p => p.id) })
      setSelectedProject(session.projectId)
      setActiveAgentId(session.agentId)
      setCurrentSessionId(sessionId)
      setResumeSessionId(undefined)  // Clear — this resumes an existing PTY, not a new Claude Code resume
      saveLastProject(session.projectId)
      setScreen("session")
    } else {
      console.warn("[handleResume] session not found:", sessionId, "available:", activeSessions.map(s => s.id))
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

  const handleDeleteProject = async (projectId: string) => {
    try {
      const res = await fetch(`${getApiBase()}/api/projects/${projectId}`, { method: "DELETE" })
      if (res.ok) {
        setProjects((prev) => {
          const next = prev.filter((p) => p.id !== projectId)
          if (selectedProject === projectId) {
            setSelectedProject(next[0]?.id || null)
          }
          return next
        })
      }
    } catch { }
  }

  // Back to project overview
  const handleBack = () => {
    setScreen("overview")
  }

  // Compute screen content for AnimatePresence transitions
  const sessionProject = selectedProject ? projects.find((p) => p.id === selectedProject) : null
  const isSessionReady = screen === "session" && !!sessionProject

  // Determine screen key for AnimatePresence
  let screenKey: string = screen
  if (screen === "session" && !sessionProject) screenKey = "overview"

  // Page transition — GPU-friendly tween, tuned for mobile WebView
  const pageEnter = { duration: 0.22, ease: [0.25, 0.1, 0.25, 1] as const }
  const pageExit = { duration: 0.12, ease: [0.4, 0, 1, 1] as const }

  return (
    <ErrorBoundary>
      <AnimatePresence mode="wait">
        {screen === "builder" ? (
          <motion.div
            key="builder"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: pageExit }}
            transition={pageEnter}
            style={{ position: "fixed", inset: 0 }}
          >
            <ChainBuilder onBack={() => setScreen("overview")} t={t} />
          </motion.div>
        ) : isSessionReady ? (
          <motion.div
            key="session"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: pageExit }}
            transition={pageEnter}
            style={{ position: "fixed", inset: 0 }}
          >
            {/* Always keep TerminalView mounted to preserve xterm content.
                When in board mode, push it behind MissionControl with lower z-index
                and visibility:hidden so xterm keeps its layout dimensions. */}
            <div style={viewMode !== "terminal" ? {
              position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
              visibility: "hidden", zIndex: 0,
            } : undefined}>
              <Suspense fallback={<div className="flex items-center justify-center h-full w-full bg-black"><div className="text-neutral-400 text-sm">Loading terminal…</div></div>}>
                <TerminalView
                  project={sessionProject!}
                  agentId={activeAgentId}
                  sessionId={currentSessionId || undefined}
                  resumeSessionId={resumeSessionId}
                  sessionToken={sessionToken}
                  send={send}
                  on={on}
                  onBack={() => setViewMode("board")}
                />
              </Suspense>
            </div>
            {/* Always keep MissionControl mounted to preserve events state.
                When in terminal mode, hide it with visibility:hidden (mirrors TerminalView pattern). */}
            <div style={viewMode === "terminal" ? {
              position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
              visibility: "hidden", zIndex: 0,
            } : undefined}>
              <MissionControl
                project={sessionProject!}
                agentId={activeAgentId}
                sessionId={currentSessionId || undefined}
                sessionToken={sessionToken}
                send={send}
                on={on}
                onBack={() => { setScreen("overview"); setViewMode("board") }}
                onOpenTerminal={() => setViewMode("terminal")}
                viewMode={viewMode}
                projects={projects}
                activeSessions={activeSessions}
                onSwitchSession={handleResume}
                onKillSession={handleKill}
                onOpenSessionTerminal={handleOpenSessionTerminal}
                theme={theme}
                toggleTheme={toggleTheme}
                onEventDiff={(e) => setDiffEvent(e)}
                onDiffEventsChange={setAllDiffEvents}
                onRequestVoiceRef={requestVoiceRef}
                wsConnected={wsConnected}
                onLaunchSession={handleLaunch}
                onOpenBuilder={() => setScreen("builder")}
              />
              <DiffPanel
                event={diffEvent}
                allDiffEvents={allDiffEvents}
                onClose={() => setDiffEvent(null)}
                onSelectEvent={(e) => setDiffEvent(e)}
                projectId={selectedProject || undefined}
                apiBase={getApiBase() || undefined}
                onSendEdit={(instruction) => {
                  send({ type: "input", data: instruction })
                  setTimeout(() => send({ type: "input", data: "\r" }), 30)
                }}
                onVoiceInput={(cb, label) => requestVoiceRef.current?.(cb, label)}
              />
            </div>
          </motion.div>
        ) : (screen === "overview" || screen === "session") ? (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: pageExit }}
            transition={pageEnter}
            style={{ position: "fixed", inset: 0 }}
          >
            <UnifiedPanel
              activeSessions={activeSessions}
              sessionEvents={sessionEventsMap}
              projects={projects}
              selectedProject={selectedProject}
              onSelectSession={handleResume}
              onNewSession={() => {}}
              onLaunch={handleLaunch}
              onNewProject={handleNewProject}
              onDeleteProject={handleDeleteProject}
              onKillSession={handleKill}
              onSessionInput={(sessionId, data) => {
                send({ type: "session_input", sessionId, data })
              }}
              onNextStep={(sessionId, step) => {
                handleResume(sessionId)
                setTimeout(() => send({ type: "input", data: step + "\n" }), 500)
              }}
              send={send}
              theme={theme}
              toggleTheme={toggleTheme}
              wsConnected={wsConnected}
              onOpenBuilder={() => setScreen("builder")}
              onCloudConnect={async (url, token) => {
                localStorage.setItem("agentrune_server", url)
                setServerUrl(url)
                setServerReady(true)
                let csToken = token
                if (!csToken) {
                  const phoneToken = localStorage.getItem("agentrune_phone_token")
                  if (phoneToken) {
                    try {
                      const authRes = await fetch(`${url}/api/auth/cloud`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ phoneToken }),
                      })
                      if (authRes.ok) {
                        const authData = await authRes.json()
                        csToken = authData.sessionToken
                      }
                    } catch {}
                  }
                }
                if (csToken) {
                  localStorage.setItem("agentrune_cloud_token", csToken)
                  setCloudSessionToken(csToken)
                }
                recheckAuth()
              }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="launchpad"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: pageExit }}
            transition={pageEnter}
            style={{ position: "fixed", inset: 0 }}
          >
            {cliUpdate && (
              <div style={{
                position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
                background: "linear-gradient(90deg, #f59e0b, #d97706)", color: "#fff",
                padding: "8px 16px", fontSize: 13, fontWeight: 500,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <span>AgentRune v{cliUpdate.latest} {t("update.available") || "available"} (v{cliUpdate.current})</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => {
                    navigator.clipboard?.writeText(
                      navigator.userAgent.includes("Win")
                        ? "irm https://agentrune.com/install.ps1 | iex"
                        : "curl -fsSL https://agentrune.com/install.sh | bash"
                    )
                  }} style={{
                    background: "rgba(255,255,255,0.2)", border: "none", color: "#fff",
                    padding: "4px 12px", borderRadius: 4, fontSize: 12, cursor: "pointer",
                  }}>{t("update.copyCommand") || "Copy update command"}</button>
                  <button onClick={() => setCliUpdate(null)} style={{
                    background: "none", border: "none", color: "rgba(255,255,255,0.7)",
                    fontSize: 16, cursor: "pointer", padding: "0 4px",
                  }}>x</button>
                </div>
              </div>
            )}
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
              onCloudConnect={async (url, token) => {
                localStorage.setItem("agentrune_server", url)
                setServerUrl(url)
                setServerReady(true)
                let csToken = token
                if (!csToken) {
                  const phoneToken = localStorage.getItem("agentrune_phone_token")
                  if (phoneToken) {
                    try {
                      const authRes = await fetch(`${url}/api/auth/cloud`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ phoneToken }),
                      })
                      if (authRes.ok) {
                        const authData = await authRes.json()
                        csToken = authData.sessionToken
                      }
                    } catch {}
                  }
                }
                if (csToken) {
                  localStorage.setItem("agentrune_cloud_token", csToken)
                  setCloudSessionToken(csToken)
                }
                recheckAuth()
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </ErrorBoundary>
  )
}
