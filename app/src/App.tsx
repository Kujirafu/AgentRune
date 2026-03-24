import { useState, useEffect, useRef, useCallback, Suspense, Component, type ErrorInfo, type ReactNode } from "react"
import "@xterm/xterm/css/xterm.css"
import type { Project, AppSession, AgentEvent } from "./types"
import type { PhaseGateRequest, PhaseGateAction, PendingReauthRequest } from "./data/automation-types"
import { getLastProject, saveLastProject, getVolumeKeysEnabled, getKeepAwakeEnabled, getNotificationsEnabled, getAutoUpdateEnabled, getLastUpdateCheck, setLastUpdateCheck, getSkippedVersion, getUpdateDetectedAt, setUpdateDetectedAt, getUpdateNotified, setUpdateNotified, getKilledSessionIds, addKilledSessionId, getFcmToken, setFcmToken } from "./lib/storage"
import { LocalNotifications } from "@capacitor/local-notifications"
import { PushNotifications } from "@capacitor/push-notifications"
import { LaunchPad } from "./components/LaunchPad"
import { lazyRetry } from "./lib/lazy-retry"
const TerminalView = lazyRetry(() => import("./components/TerminalView").then(m => ({ default: m.TerminalView })))
const MissionControl = lazyRetry(() => import("./components/MissionControl").then(m => ({ default: m.MissionControl })))
const ProjectOverview = lazyRetry(() => import("./components/ProjectOverview").then(m => ({ default: m.ProjectOverview })))
const UnifiedPanel = lazyRetry(() => import("./components/UnifiedPanel").then(m => ({ default: m.UnifiedPanel })))
const DiffPanel = lazyRetry(() => import("./components/DiffPanel").then(m => ({ default: m.DiffPanel })))
const ChainBuilder = lazyRetry(() => import("./components/ChainBuilder").then(m => ({ default: m.ChainBuilder })))
const PhaseGateSheet = lazyRetry(() => import("./components/PhaseGateSheet"))
const ReauthSheet = lazyRetry(() => import("./components/ReauthSheet"))
const Dashboard = lazyRetry(() => import("./components/Dashboard").then(m => ({ default: m.Dashboard })))
import { App as CapApp } from "@capacitor/app"
import { useIsDesktop } from "./hooks/useIsDesktop"
import { Browser } from "@capacitor/browser"
import { useLocale } from "./lib/i18n/index.js"
import { getSessionActivityNotificationId, getSessionActivityNotificationKey } from "./lib/session-activity"
import { isSummaryNoise } from "./lib/session-summary"
// framer-motion deferred to lazy-loaded components only (saves ~133 KB initial load)
import { identifyUser, trackLogin, trackSessionStart, trackSessionEnd, trackScreenView, trackViewModeChange, trackAgentLaunch, trackOnboardingSkip, trackOnboardingComplete, trackConnectStep, trackConnectEscape } from "./lib/analytics"
import { OnboardingCarousel } from "./components/OnboardingCarousel"

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

function isElectron(): boolean {
  return !!(window as any).electronAPI
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
    // Web dev mode goes through Vite's /ws proxy to reach the local daemon.
    return `${proto}//${location.host}/ws`
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

// Simple string hash for stable notification IDs (Java hashCode algorithm)
// Uses >>> 0 to ensure unsigned 32-bit result (Math.abs fails on -2147483648)
function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return h >>> 0
}

// CSS page transition — GPU-friendly tween, replaces framer-motion AnimatePresence
const PAGE_STYLE: React.CSSProperties = {
  position: "fixed", inset: 0,
  animation: "pageEnter 220ms cubic-bezier(0.25, 0.1, 0.25, 1)",
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
      // Electron loads from localhost — daemon auto-bypasses auth for 127.0.0.1
      if (isElectron()) {
        setSessionToken("__electron__")
        setStatus("authenticated")
        return
      }

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
      // Connection failed — try refreshing tunnel URL before giving up
      if (isCapacitor()) {
        try {
          const device = await refreshTunnelUrl()
          if (device?.url) {
            localStorage.setItem("agentrune_server", device.url)
            // Retry auth with new URL
            const retryRes = await fetch(`${device.url}/api/auth/check?deviceId=${localStorage.getItem("agentrune_device_id") || ""}`)
            const retryData = await retryRes.json()
            setMode(retryData.mode)
            if (retryData.mode === "none") {
              setSessionToken("__open__")
              setStatus("authenticated")
              return
            }
            const savedDeviceId = localStorage.getItem("agentrune_device_id")
            const savedToken = localStorage.getItem("agentrune_device_token")
            if (savedDeviceId && savedToken) {
              const vRes = await fetch(`${device.url}/api/auth/device`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deviceId: savedDeviceId, token: savedToken }),
              })
              if (vRes.ok) {
                const vData = await vRes.json()
                setSessionToken(vData.sessionToken)
                setStatus("authenticated")
                return
              }
            }
          }
        } catch { /* refresh also failed */ }
      }
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
/** Returns { url, fallbackUrl?, sessionToken } if an ONLINE device is found, null otherwise */
async function refreshTunnelUrl(): Promise<{ url: string; fallbackUrl?: string; sessionToken?: string } | null> {
  // Use phone token only (daemon refresh token was removed for security — daemon credentials should not be on client)
  const token = localStorage.getItem("agentrune_phone_token")
  if (!token) return null
  try {
    // Include daemon's deviceId when using daemon refresh token (needed for linkRequest lookup)
    const daemonDeviceId = localStorage.getItem("agentrune_daemon_device_id") || ""
    const params = daemonDeviceId ? `?deviceId=${encodeURIComponent(daemonDeviceId)}` : ""
    const res = await fetch(`https://agentlore.vercel.app/api/agentrune/devices${params}`, {
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
      // Store fallback URL for daemon failover
      const fallbackUrl = online.fallbackTunnelUrl || undefined
      if (fallbackUrl) {
        localStorage.setItem("agentrune_fallback_server", fallbackUrl)
        console.log(`[WS] Fallback URL: ${fallbackUrl}`)
      }
      return { url: newUrl, fallbackUrl, sessionToken: online.cloudSessionToken }
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
  // Track consecutive failures for failover decision
  const failCountRef = useRef(0)
  const [wsConnected, setWsConnected] = useState(false)
  // Client-side heartbeat: ping every 15s, expect pong within 5s
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pongTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Failback timer: when connected to release daemon, periodically check if dev is back
  const failbackRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null }
    if (pongTimeoutRef.current) { clearTimeout(pongTimeoutRef.current); pongTimeoutRef.current = null }
    if (failbackRef.current) { clearInterval(failbackRef.current); failbackRef.current = null }
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
      failCountRef.current = 0 // Reset fail counter
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

      // Failback: when connected to release daemon, ask it for dev daemon's current tunnel URL every 5s
      // Release daemon caches sibling info from heartbeat probes
      if (isCapacitor()) {
        failbackRef.current = setInterval(async () => {
          const role = localStorage.getItem("agentrune_daemon_role")
          if (role !== "release") return
          const releaseUrl = localStorage.getItem("agentrune_server") || ""
          if (!releaseUrl) return
          try {
            // Step 1: Ask release daemon for dev daemon's latest tunnel URL
            const r = await fetch(`${releaseUrl}/api/daemon-info`, { signal: AbortSignal.timeout(3000) })
            const info = await r.json()
            const devUrl = info?.sibling?.tunnelUrl
            if (!devUrl || info?.sibling?.role !== "dev") return
            // Step 2: Probe dev daemon to confirm it's alive
            const r2 = await fetch(`${devUrl}/api/daemon-info`, { signal: AbortSignal.timeout(3000) })
            const devInfo = await r2.json()
            if (devInfo?.role !== "dev") return
            // Dev is alive — switch back
            console.log(`[WS] Dev daemon is back — switching to: ${devUrl}`)
            localStorage.setItem("agentrune_server", devUrl)
            localStorage.setItem("agentrune_fallback_server", releaseUrl)
            stopHeartbeat()
            try { ws.close() } catch {}
          } catch { /* dev still down */ }
        }, 5000)
      }
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
      // Track which daemon we're connected to (dev vs release)
      // Also store tunnel URL and refresh token so we can reconnect after daemon restart
      if (msg.type === "daemon_info" && msg.role) {
        localStorage.setItem("agentrune_daemon_role", msg.role as string)
        if (msg.tunnelUrl) {
          localStorage.setItem("agentrune_server", msg.tunnelUrl as string)
        }
        // Clean up stale refreshToken from older versions (daemon no longer sends it)
        localStorage.removeItem("agentrune_refresh_token")
        if (msg.daemonDeviceId) {
          localStorage.setItem("agentrune_daemon_device_id", msg.daemonDeviceId as string)
        }
      }
      // Forward PRD changes to window so PlanPanel can auto-refresh
      if (msg.type === "prd_changed") {
        window.dispatchEvent(new CustomEvent("prd_changed", { detail: msg }))
      }
      // Forward Trust Layer events to window for MissionControl
      if (msg.type === "plan_review_required" || msg.type === "daily_limit_reached" || msg.type === "skill_confirmation_required" || msg.type === "bypass_confirmation_required") {
        window.dispatchEvent(new CustomEvent("trust_event", { detail: msg }))
      }
      const handlers = handlersRef.current.get(msg.type)
      if (handlers) for (const h of handlers) h(msg)
    }

    ws.onclose = () => {
      connectingRef.current = false
      setWsConnected(false)
      stopHeartbeat()
      failCountRef.current++
      const handlers = handlersRef.current.get("__ws_close__")
      if (handlers) for (const h of handlers) h({})
      // Auto-reconnect with exponential backoff (300ms → 600ms → 1200ms → max 5s)
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      const delay = backoffRef.current
      backoffRef.current = Math.min(delay * 2, 5000)
      const fails = failCountRef.current

      // After 10+ consecutive failures (~15s downtime), try switching to fallback daemon
      if (fails >= 10 && isCapacitor()) {
        const fallback = localStorage.getItem("agentrune_fallback_server")
        if (fallback) {
          console.log(`[WS] ${fails} failures — switching to fallback daemon: ${fallback}`)
          const current = localStorage.getItem("agentrune_server") || ""
          localStorage.setItem("agentrune_server", fallback)
          if (current) localStorage.setItem("agentrune_fallback_server", current)
          backoffRef.current = 300 // Reset backoff for new daemon
          failCountRef.current = 0
          reconnectTimerRef.current = setTimeout(() => doConnect(tokenRef.current), 500)
          return
        }
      }

      // After 2+ failures, refresh tunnel URL from AgentLore
      // Quick refresh ensures app reconnects fast when daemon restarts with new tunnel
      if (fails >= 2 && isCapacitor()) {
        refreshTunnelUrl().then((device) => {
          // Update token if AgentLore returned a fresh cloudSessionToken
          if (device?.sessionToken) {
            tokenRef.current = device.sessionToken
            localStorage.setItem("agentrune_cloud_token", device.sessionToken)
          }
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
  // Step wizard: 1 = login AgentLore, 2 = install CLI, "escape" = QR/manual
  const isLoggedIn = !!localStorage.getItem("agentrune_phone_token")
  const [wizardStep, setWizardStep] = useState<1 | 2 | "escape">(isLoggedIn ? 2 : 1)
  const [showLearnMore, setShowLearnMore] = useState(false)
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
        // Re-identify telemetry with real userId
        identifyUser(); trackLogin()
        setWizardStep(2)
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

  // Show onboarding carousel from "Learn more" button
  if (showLearnMore) {
    return <OnboardingCarousel onComplete={() => setShowLearnMore(false)} />
  }

  const cmd = setupOs === "mac"
    ? "curl -fsSL https://agentlore.vercel.app/install.sh | sh"
    : "irm https://agentlore.vercel.app/install.ps1 | iex"

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
        {/* Header */}
        <div style={{ fontSize: 36, fontWeight: 700, marginBottom: 4, letterSpacing: -1, color: "var(--text-primary)" }}>
          AgentRune
        </div>

        {/* Step indicator */}
        <div style={{
          fontSize: 11, color: "var(--text-secondary)", marginBottom: 24,
          letterSpacing: 1, fontWeight: 600, opacity: 0.6,
        }}>
          {wizardStep === "escape" ? t("app.advancedConnect") : t("connect.step").replace("{step}", String(wizardStep))}
        </div>

        {/* ── Step 1: Login AgentLore ── */}
        {wizardStep === 1 && (<>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 20 }}>
            {t("connect.step1.title")}
          </div>

          {/* Benefits list */}
          <div style={{ textAlign: "left", marginBottom: 20 }}>
            {[
              { icon: "M3 15a4 4 0 0 0 4 4h9a5 5 0 1 0-.1-9.999 5.002 5.002 0 1 0-9.78 2.096A4.001 4.001 0 0 0 3 15z", text: t("connect.step1.benefit1"), color: "#4ade80" },
              { icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5", text: t("connect.step1.benefit2"), color: "#60a5fa" },
              { icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2", text: t("connect.step1.benefit3"), color: "#eab308" },
            ].map((b, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 12px", borderRadius: 12, marginBottom: 6,
                background: `${b.color}08`, border: `1px solid ${b.color}20`,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: `${b.color}15`, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={b.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={b.icon} />
                  </svg>
                </div>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{b.text}</span>
              </div>
            ))}
          </div>

          {/* Login CTA */}
          <button
            disabled={!!pollingCode}
            onClick={() => {
              setError("")
              const code = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                .map(b => b.toString(16).padStart(2, "0")).join("")
              const authUrl = `https://agentlore.vercel.app/zh-TW/agentrune/mobile-auth?code=${code}`
              savePollingCode(code)
              setStatus(t("app.waitingForBrowserLogin"))
              window.open(authUrl, "_system")
            }}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              width: "100%", padding: "16px", borderRadius: 14, marginBottom: 12,
              border: "none",
              background: pollingCode ? "rgba(55,172,192,0.15)" : "#37ACC0",
              color: pollingCode ? "#37ACC0" : "#fff",
              fontSize: 16, fontWeight: 700,
              cursor: pollingCode ? "default" : "pointer",
              boxShadow: pollingCode ? "none" : "0 4px 20px rgba(55,172,192,0.3)",
            }}
          >
            {pollingCode ? (
              <>
                <span style={{ width: 18, height: 18, border: "2px solid rgba(55,172,192,0.4)", borderTopColor: "#37ACC0", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }} />
                {t("app.waitingForBrowserLogin")}
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
                {t("connect.step1.login")}
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

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0" }}>
            <div style={{ flex: 1, height: 1, background: "var(--glass-border)" }} />
            <span style={{ fontSize: 12, color: "var(--text-secondary)", opacity: 0.5 }}>{t("app.or") || "or"}</span>
            <div style={{ flex: 1, height: 1, background: "var(--glass-border)" }} />
          </div>

          {/* Escape hatch */}
          <button
            onClick={() => { trackConnectEscape(); setWizardStep("escape"); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-secondary)", fontSize: 13, fontWeight: 500,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              width: "100%", padding: "8px",
            }}
          >
            {t("connect.step1.haveCli")}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </>)}

        {/* ── Step 2: Install CLI ── */}
        {wizardStep === 2 && (<>
          {/* Success badge */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "10px 16px", borderRadius: 12, marginBottom: 20,
            background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)",
          }}>
            <span style={{ color: "#4ade80", fontSize: 15 }}>&#10003;</span>
            <span style={{ color: "#4ade80", fontSize: 13, fontWeight: 600 }}>
              {t("connect.step2.connected")}
            </span>
          </div>

          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
            {t("connect.step2.title")}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, opacity: 0.7 }}>
            {t("connect.step2.instruction")}
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
              }}>
                {os.label}
              </button>
            ))}
          </div>

          {/* Command display */}
          <div style={{
            padding: "10px 12px", borderRadius: 10, marginBottom: 10,
            background: "var(--card-bg)", border: "1px solid var(--glass-border)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11, color: "var(--text-primary)",
            wordBreak: "break-all", lineHeight: 1.6,
          }}>
            {cmd}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              onClick={async () => {
                try { await navigator.clipboard.writeText(cmd); setStatus(t("app.copied")); setTimeout(() => setStatus(""), 2000) } catch {}
              }}
              style={{
                flex: 1, padding: "10px", borderRadius: 10,
                border: "1px solid var(--glass-border)", background: "var(--glass-bg)",
                color: "var(--text-primary)", fontSize: 12, fontWeight: 600, cursor: "pointer",
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
                try { if (navigator.share) await navigator.share({ title: "AgentRune", text: cmd }); else { await navigator.clipboard.writeText(cmd); setStatus(t("app.copied")); setTimeout(() => setStatus(""), 2000) } } catch {}
              }}
              style={{
                flex: 1, padding: "10px", borderRadius: 10,
                border: "1px solid rgba(55,172,192,0.3)", background: "rgba(55,172,192,0.08)",
                color: "#37ACC0", fontSize: 12, fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              {t("app.shareCommand")}
            </button>
          </div>

          {/* Detecting */}
          <div style={{ fontSize: 13, color: "var(--text-secondary)", opacity: 0.6, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span style={{ width: 12, height: 12, border: "2px solid rgba(55,172,192,0.3)", borderTopColor: "#37ACC0", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }} />
            {t("connect.step2.detecting")}
          </div>

          {/* QR scan shortcut */}
          <button
            onClick={() => setScanning(true)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              width: "100%", padding: "12px", borderRadius: 12, marginBottom: 8,
              border: "1px solid var(--glass-border)", background: "transparent",
              color: "var(--text-secondary)", fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
            </svg>
            {t("app.scanQrToPair")}
          </button>
        </>)}

        {/* ── Escape: QR / Manual ── */}
        {wizardStep === "escape" && (<>
          {/* Back button */}
          <button
            onClick={() => setWizardStep(1)}
            style={{
              display: "flex", alignItems: "center", gap: 4, marginBottom: 16,
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-secondary)", fontSize: 13,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {t("app.cancel")}
          </button>

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
                padding: "12px 18px", borderRadius: 14, border: "1px solid rgba(55,172,192,0.3)",
                background: "rgba(55,172,192,0.1)", color: "#37ACC0",
                fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}
            >
              {t("app.connect")}
            </button>
          </div>
        </>)}

        {/* Status & Error (shared) */}
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

        {/* Learn more — re-view onboarding */}
        <button
          onClick={() => setShowLearnMore(true)}
          style={{
            marginTop: 16, background: "none", border: "none", cursor: "pointer",
            color: "var(--text-secondary)", fontSize: 12, opacity: 0.5,
          }}
        >
          {t("connect.learnMore")}
        </button>
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
  const { t, locale } = useLocale()
  const isDesktop = useIsDesktop()
  // Onboarding — shown once on first app open (Capacitor only)
  const [showOnboarding, setShowOnboarding] = useState(() =>
    isCapacitor() && !localStorage.getItem("onboarding_seen")
  )
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
  const [screen, setScreenRaw] = useState<Screen>("overview")
  const prevScreenRef = useRef<Screen>("overview")
  const setScreen = useCallback((next: Screen) => {
    const from = prevScreenRef.current
    prevScreenRef.current = next
    setScreenRaw(next)
    trackScreenView(next, from)
  }, [])
  // Auto-switch to overview when sessions load
  const [initialScreenSet, setInitialScreenSet] = useState(false)
  const [selectedProject, setSelectedProject] = useState<string | null>(IS_DEV_PREVIEW ? "demo" : null)
  const [activeAgentId, setActiveAgentId] = useState<string>("terminal")
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [resumeSessionId, setResumeSessionId] = useState<string | undefined>(undefined)
  const [shouldResumeCurrentSession, setShouldResumeCurrentSession] = useState(false)
  const [viewMode, setViewModeRaw] = useState<"board" | "terminal">("board")
  const setViewMode = useCallback((mode: "board" | "terminal") => {
    setViewModeRaw(mode)
    trackViewModeChange(mode)
  }, [])
  const [activeSessions, setActiveSessions] = useState<AppSession[]>([])
  const [diffEvent, setDiffEvent] = useState<AgentEvent | null>(null)
  const [allDiffEvents, setAllDiffEvents] = useState<AgentEvent[]>([])
  const [cliUpdate, setCliUpdate] = useState<{ latest: string; current: string; changelog?: string } | null>(null)
  const requestVoiceRef = useRef<((callback: (text: string) => void, label?: string) => void) | null>(null)
  const [sessionEventsMap, setSessionEventsMap] = useState<Map<string, AgentEvent[]>>(new Map())
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("agentrune_theme") as "light" | "dark") || "light"
  )
  const { connect, send, on, wsConnected } = useWs()
  const [pendingPhaseGate, setPendingPhaseGate] = useState<PhaseGateRequest | null>(null)
  const [pendingReauthQueue, setPendingReauthQueue] = useState<PendingReauthRequest[]>([])
  const sessionStartRef = useRef<number>(0)

  // ─── Auto Update Check ─────────────────────────────────────────
  // Flow: detect new release → record timestamp → 12h later push notification
  const UPDATE_NOTIFY_DELAY = 12 * 60 * 60 * 1000 // 12 hours after first detection
  useEffect(() => {
    const runCheck = async () => {
      if (!getAutoUpdateEnabled()) return
      const lastCheck = getLastUpdateCheck()
      const now = Date.now()
      if (now - lastCheck < UPDATE_CHECK_INTERVAL) return
      setLastUpdateCheck(now)
      const info = await checkForUpdate()
      if (info) {
        // Dispatch in-app banner (SettingsSheet)
        window.dispatchEvent(new CustomEvent("updateAvailable", { detail: info }))

        // Track first detection time for delayed notification
        const detected = getUpdateDetectedAt()
        if (!detected || detected.version !== info.version) {
          // New version detected for the first time — start the 12h timer
          setUpdateDetectedAt(info.version, now)
        } else {
          // Same version already detected — check if 12h has passed
          const elapsed = now - detected.at
          const alreadyNotified = getUpdateNotified()
          if (elapsed >= UPDATE_NOTIFY_DELAY && alreadyNotified !== info.version) {
            // 12h passed, send push notification
            setUpdateNotified(info.version)
            if (isCapacitor() && getNotificationsEnabled()) {
              LocalNotifications.schedule({
                notifications: [{
                  id: now,
                  title: t("notification.updateAvailable"),
                  body: `v${info.version} — ${t("notification.updateTap")}`,
                  smallIcon: "ic_launcher",
                }],
              }).catch(() => {})
            }
          }
        }
      }
    }
    // Check on mount (after short delay to not block startup)
    const timeout = setTimeout(runCheck, 3000)
    // Also re-check periodically while app is open (every 6h)
    const interval = setInterval(runCheck, UPDATE_CHECK_INTERVAL)
    // Listen for manual check requests (from Settings toggle)
    const handler = () => {
      setLastUpdateCheck(0) // reset to force check
      runCheck()
    }
    window.addEventListener("checkForUpdate", handler)
    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
      window.removeEventListener("checkForUpdate", handler)
    }
  }, [t])

  // Cloud mode without a server URL = browsing LaunchPad (Quick Connect list)
  // Cloud mode WITH cloudSessionToken = pre-authorized, skip local auth
  // Cloud mode WITH server URL but NO cloudSessionToken = must authenticate locally
  const isAuthed = IS_DEV_PREVIEW || (isCloudMode && !serverUrl) || !!cloudSessionToken || status === "authenticated"

  const loadSessionsSnapshot = useCallback((base: string) => {
    const query = locale ? `?locale=${encodeURIComponent(locale)}` : ""
    fetch(`${base}/api/sessions${query}`)
      .then((r) => r.json())
      .then((data: SessionSnapshot[] | unknown) => {
        if (!Array.isArray(data)) return
        const localKilled = getKilledSessionIds()
        const sessions = data
          .filter((s: any) => !localKilled.has(s.id))
          .map((s: SessionSnapshot) => ({
            id: s.id,
            projectId: s.projectId,
            agentId: s.agentId,
            worktreeBranch: s.worktreeBranch || null,
            status: (s.status === "recoverable" ? "recoverable" : "active") as "active" | "recoverable",
            claudeSessionId: s.claudeSessionId,
          }))
        // Keep only locally-created sessions less than 30s old (prevents ghost sessions)
        setActiveSessions(prev => {
          const serverIds = new Set(sessions.map((s: AppSession) => s.id))
          const now = Date.now()
          const localOnly = prev.filter(s => {
            if (serverIds.has(s.id)) return false
            if (s.status === "recoverable") return false
            // Only keep if created recently (timestamp encoded in ID)
            const tsMatch = s.id.match(/_(\d{13})/)
            if (tsMatch && now - parseInt(tsMatch[1]) > 30000) return false
            return true
          })
          return [...sessions, ...localOnly]
        })

        setSessionEventsMap((prev) => {
          const next = new Map(prev)
          for (const snapshot of data as SessionSnapshot[]) {
            const seed = buildSessionSeedEvent(snapshot)
            if (!seed) continue
            const existing = next.get(snapshot.id)
            if (!existing || (existing.length === 1 && (existing[0].id.startsWith("init_") || existing[0].id.startsWith("seed_")))) {
              next.set(snapshot.id, [seed])
            }
          }
          return next
        })
      })
      .catch(() => { })
  }, [locale])

  // Load projects after auth, server URL change, or WS reconnect
  useEffect(() => {
    if (!isAuthed) return
    // Always read fresh URL from localStorage (serverUrl state may be stale after tunnel refresh)
    const base = getApiBase() || serverUrl
    // base="" is valid for same-origin browser access (relative URL)
    if (isCapacitor() && !base) return
    console.log(`[App] Loading projects: base=${base} wsConnected=${wsConnected} isAuthed=${isAuthed}`)
    fetch(`${base}/api/projects`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data) => {
        if (!Array.isArray(data)) return
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

    loadSessionsSnapshot(base)
  }, [isAuthed, serverUrl, wsConnected, loadSessionsSnapshot])

  // Also reload projects + sessions whenever WS reconnects (catches tunnel URL changes + kill state sync)
  useEffect(() => {
    if (!isAuthed) return
    return on("__ws_open__", () => {
      const base = getApiBase()
      if (!base && isCapacitor()) return
      fetch(`${base}/api/projects`)
        .then((r) => r.ok ? r.json() : Promise.reject(r.status))
        .then((data) => {
          if (!Array.isArray(data)) return
          setProjects(data)
          const last = getLastProject()
          if (last && data.find((p: Project) => p.id === last)) {
            setSelectedProject(last)
          } else if (data.length > 0 && !selectedProject) {
            setSelectedProject(data[0].id)
          }
        })
        .catch(() => { })
      // Reload sessions so killed sessions don't reappear
      loadSessionsSnapshot(base)
    })
  }, [isAuthed, on, loadSessionsSnapshot])

  // Session lifecycle sync — desktop + mobile see the same session list
  useEffect(() => {
    const unsubs: (() => void)[] = []
    // New session created (by any client)
    unsubs.push(on("session_created", (msg) => {
      const sid = msg.sessionId as string
      const pid = msg.projectId as string
      const aid = msg.agentId as string
      if (!sid || !pid || !aid) return
      setActiveSessions(prev => {
        if (prev.some(s => s.id === sid)) return prev
        return [...prev, { id: sid, projectId: pid, agentId: aid, worktreeBranch: (msg.worktreeBranch as string) || undefined }]
      })
    }))
    // Task title updates from server
    unsubs.push(on("session_task_title", (msg) => {
      const sid = msg.sessionId as string
      const title = msg.taskTitle as string
      if (!sid || !title) return
      setActiveSessions(prev => prev.map(s => s.id === sid ? { ...s, taskTitle: title } : s))
    }))
    // Session ended (killed/exited by any client)
    unsubs.push(on("session_ended", (msg) => {
      const sid = msg.sessionId as string
      if (!sid) return
      setActiveSessions(prev => prev.filter(s => s.id !== sid))
      setSessionEventsMap(prev => { const next = new Map(prev); next.delete(sid); return next })
    }))
    // Session killed (immediate broadcast from kill API — syncs desktop/mobile instantly)
    unsubs.push(on("session_killed", (msg) => {
      const sid = msg.sessionId as string
      if (!sid) return
      setActiveSessions(prev => prev.filter(s => s.id !== sid))
      // Clean up events for killed session
      setSessionEventsMap(prev => { const next = new Map(prev); next.delete(sid); return next })
    }))
    return () => { for (const u of unsubs) u() }
  }, [on])

  // Settings sync — when another client changes project settings, update localStorage
  useEffect(() => {
    return on("settings_changed", (msg) => {
      const pid = msg.projectId as string
      const settings = msg.settings as Record<string, unknown>
      if (pid && settings) {
        localStorage.setItem(`agentrune_settings_${pid}`, JSON.stringify(settings))
      }
    })
  }, [on])

  // Listen for CLI update notification from daemon
  useEffect(() => {
    return on("cli_update_available", (msg) => {
      setCliUpdate({ latest: msg.latest as string, current: msg.current as string, changelog: msg.changelog as string | undefined })
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

  // FCM Push Notifications — register and send token to daemon
  useEffect(() => {
    if (!isCapacitor()) return
    if (!isAuthed || !wsConnected) return

    let cancelled = false

    const registerFcm = async () => {
      try {
        const permResult = await PushNotifications.requestPermissions()
        if (permResult.receive !== "granted") return

        await PushNotifications.register()

        await PushNotifications.addListener("registration", (token) => {
          if (cancelled) return
          const prev = getFcmToken()
          // Only send to daemon if token changed
          if (token.value && token.value !== prev) {
            setFcmToken(token.value)
            send({ type: "set_fcm_token", token: token.value })
            console.log("[FCM] Token registered and sent to daemon")
          } else if (token.value && prev === token.value) {
            // Re-send on reconnect so daemon always has latest
            send({ type: "set_fcm_token", token: token.value })
          }
        })

        await PushNotifications.addListener("registrationError", (err) => {
          console.error("[FCM] Registration error:", err)
        })
      } catch (e) {
        console.warn("[FCM] Push registration failed:", e)
      }
    }

    registerFcm()

    return () => {
      cancelled = true
      PushNotifications.removeAllListeners().catch(() => {})
    }
  }, [isAuthed, wsConnected, send])

  // Update worktreeBranch on session when attached message arrives from server
  useEffect(() => {
    return on("attached", (msg) => {
      const sessionId = msg.sessionId as string
      const branch = (msg.worktreeBranch as string | null) || null
      if (sessionId && sessionId === currentSessionId) {
        setShouldResumeCurrentSession(true)
      }
      if (sessionId && branch) {
        setActiveSessions((prev) =>
          prev.map((s) => s.id === sessionId ? { ...s, worktreeBranch: branch } : s)
        )
      }
    })
  }, [currentSessionId, on])

  // Theme: apply dark class to <html>
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
    // Sync Electron titlebar overlay on mount/theme change
    ;(window as any).electronAPI?.setTheme?.(theme === "dark")
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

  // Smart Notifications — fire local notification when agent needs input or completes, app in background
  useEffect(() => {
    if (!isCapacitor()) return
    // Request permission on first enable
    const onEnable = () => {
      LocalNotifications.requestPermissions().catch(() => {})
    }
    window.addEventListener("notificationsChanged", onEnable)

    // Track last notification time per session to avoid spamming (throttle 30s)
    const lastNotifTime = new Map<string, number>()
    const notifiedActivityKeys = new Map<string, number>()

    const unsub = on("session_activity", (msg) => {
      if (!getNotificationsEnabled()) return
      if (document.visibilityState === "visible") return // Only notify in background
      const sid = msg.sessionId as string
      const eventTitle = msg.eventTitle as string
      const agentStatus = msg.agentStatus as string
      if (!sid) return
      const eventKey = getSessionActivityNotificationKey({
        sessionId: sid,
        eventId: msg.eventId as string | undefined,
        eventType: msg.eventType as string | undefined,
        eventTitle,
        agentStatus,
      })
      if (eventKey && notifiedActivityKeys.has(eventKey)) return

      // Throttle: max 1 notification per session per 30s
      const now = Date.now()
      const lastTime = lastNotifTime.get(sid) || 0
      if (now - lastTime < 30_000) return

      // Decision request — agent needs user confirmation (like LINE notification)
      if (agentStatus === "waiting") {
        lastNotifTime.set(sid, now)
        if (eventKey) {
          notifiedActivityKeys.set(eventKey, now)
          if (notifiedActivityKeys.size > 200) {
            const cutoff = now - 12 * 60 * 60 * 1000
            for (const [key, seenAt] of notifiedActivityKeys) {
              if (seenAt < cutoff || notifiedActivityKeys.size > 160) {
                notifiedActivityKeys.delete(key)
              }
            }
          }
        }
        const notifId = getSessionActivityNotificationId({
          sessionId: sid,
          eventId: msg.eventId as string | undefined,
          eventType: msg.eventType as string | undefined,
          eventTitle,
          agentStatus,
        }) || Date.now()
        LocalNotifications.schedule({
          notifications: [{
            id: notifId,
            title: t("notification.agentBlocked"),
            body: eventTitle ? eventTitle.slice(0, 200) : t("notification.needsConfirm"),
            smallIcon: "ic_launcher",
          }],
        }).catch(() => {})
      }
    })

    return () => { unsub(); window.removeEventListener("notificationsChanged", onEnable) }
  }, [on, t])

  // Automation completion notifications (local only — FCM push handles background separately)
  useEffect(() => {
    if (!isCapacitor()) return
    // Track already-notified automation IDs to prevent duplicates from WS reconnections
    const notifiedIds = new Set<string>()

    const unsubStarted = on("automation_started", (msg) => {
      if (!getNotificationsEnabled()) return
      if (document.visibilityState === "visible") return // In foreground — user sees it in-app
      const autoId = msg.automationId as string
      if (autoId && notifiedIds.has(`start_${autoId}`)) return
      if (autoId) notifiedIds.add(`start_${autoId}`)
      const name = (msg.automationName as string) || "Automation"
      // Use stable ID so duplicate notifications replace instead of stacking
      const notifId = autoId ? Math.abs(hashCode(`start_${autoId}`)) % 2147483647 : Date.now()
      LocalNotifications.schedule({
        notifications: [{
          id: notifId,
          title: `${name}`,
          body: msg.isCrew ? "Work chain started" : "Automation started",
          smallIcon: "ic_launcher",
        }],
      }).catch(() => {})
    })
    const unsub = on("automation_completed", (msg) => {
      if (!getNotificationsEnabled()) return
      if (document.visibilityState === "visible") return // In foreground — user sees it in-app
      const auto = msg.automation as { name?: string; id?: string } | undefined
      const result = msg.result as { status?: string; finishedAt?: number; startedAt?: number; automationId?: string } | undefined
      if (!auto || !result) return
      const autoId = (auto.id || result.automationId || "") as string
      if (autoId && notifiedIds.has(`done_${autoId}`)) return
      if (autoId) notifiedIds.add(`done_${autoId}`)
      const name = auto.name || "Automation"
      const duration = result.startedAt && result.finishedAt
        ? Math.round((result.finishedAt - result.startedAt) / 1000)
        : 0
      const durationStr = duration > 60 ? `${Math.floor(duration / 60)}m ${duration % 60}s` : `${duration}s`
      const title = result.status === "success"
        ? `${name} completed`
        : result.status === "skipped_no_action"
          ? `${name} skipped`
          : `${name} failed`
      const body = result.status === "success"
        ? `Finished in ${durationStr}`
        : result.status === "skipped_no_action"
          ? `No post sent: preconditions not met (${durationStr})`
          : `Status: ${result.status} (${durationStr})`
      // Use stable ID based on automation ID — duplicate notifications replace instead of stacking
      const notifId = autoId ? Math.abs(hashCode(`done_${autoId}`)) % 2147483647 : Date.now()
      LocalNotifications.schedule({
        notifications: [{
          id: notifId,
          title,
          body,
          smallIcon: "ic_launcher",
        }],
      }).catch(() => {})
    })
    return () => { unsubStarted(); unsub() }
  }, [on])

  const pendingReauth = pendingReauthQueue[0] || null

  // Phase Gate notifications + state management
  useEffect(() => {
    const unsub = on("phase_gate_waiting", (msg) => {
      const gate = msg.gate as PhaseGateRequest | undefined
      if (!gate) return
      setPendingPhaseGate(gate)

      // Local notification (always — phase gate needs attention)
      if (isCapacitor() && getNotificationsEnabled()) {
        const name = gate.automationName || "Crew"
        const notifId = Math.abs(hashCode(`gate_${gate.automationId}_${gate.completedPhase}`)) % 2147483647
        LocalNotifications.schedule({
          notifications: [{
            id: notifId,
            title: t("phaseGate.notification.title").replace("{name}", name).replace("{n}", String(gate.completedPhase)),
            body: t("phaseGate.notification.body"),
            smallIcon: "ic_launcher",
          }],
        }).catch(() => {})
      }
    })
    const unsubAck = on("phase_gate_ack", () => {
      // Gate resolved — sheet will be closed by handlePhaseGateRespond
    })
    return () => { unsub(); unsubAck() }
  }, [on, t])

  const handlePhaseGateRespond = useCallback((action: PhaseGateAction, instructions?: string, reviewNote?: string) => {
    if (!pendingPhaseGate) return
    send({
      type: "phase_gate_response",
      automationId: pendingPhaseGate.automationId,
      action,
      instructions: instructions || undefined,
      reviewNote: reviewNote || undefined,
    })
    setPendingPhaseGate(null)
  }, [pendingPhaseGate, send])

  useEffect(() => {
    const unsub = on("reauth_required", (msg) => {
      const automationId = msg.automationId as string | undefined
      if (!automationId) return
      const request: PendingReauthRequest = {
        automationId,
        automationName: (msg.automationName as string) || "Automation",
        sessionId: (msg.sessionId as string) || "",
        violationType: (msg.violationType as string) || "unknown",
        violationDescription: (msg.violationDescription as string) || "",
        permissionKey: (msg.permissionKey as string) || "",
        killedAt: typeof msg.killedAt === "number" ? msg.killedAt : Date.now(),
        estimatedReviewMs: typeof msg.estimatedReviewMs === "number" ? msg.estimatedReviewMs : undefined,
      }

      setPendingReauthQueue((prev) => {
        const filtered = prev.filter((item) => item.automationId !== request.automationId)
        return [...filtered, request]
      })

      if (isCapacitor() && getNotificationsEnabled()) {
        const notifId = Math.abs(hashCode(`reauth_${request.automationId}_${request.permissionKey}`)) % 2147483647
        LocalNotifications.schedule({
          notifications: [{
            id: notifId,
            title: t("reauth.notification.title", { name: request.automationName }),
            body: t("reauth.notification.body"),
            smallIcon: "ic_launcher",
          }],
        }).catch(() => {})
      }
    })

    const unsubAck = on("reauth_ack", (msg) => {
      const automationId = msg.automationId as string | undefined
      if (!automationId) return
      setPendingReauthQueue((prev) => prev.filter((item) => item.automationId !== automationId))
    })

    // Sandbox violations from regular sessions → show as reauth in permission widget
    const unsubSandbox = on("sandbox_violation", (msg) => {
      const sessionId = msg.sessionId as string
      if (!sessionId) return
      const violation = msg.violation as { type: string; description: string }
      const permKey = msg.permissionKey as string
      const request: PendingReauthRequest = {
        automationId: `sandbox_${sessionId}`,
        automationName: `Session`,
        sessionId,
        violationType: violation?.type || "sandbox",
        violationDescription: violation?.description || "Sandbox violation",
        permissionKey: permKey || "",
        killedAt: Date.now(),
      }
      setPendingReauthQueue((prev) => {
        const filtered = prev.filter((item) => item.automationId !== request.automationId)
        return [...filtered, request]
      })
    })

    return () => { unsub(); unsubAck(); unsubSandbox() }
  }, [on, t])

  const handleReauthRespond = useCallback((action: "approve" | "deny", opts?: { noExpiry?: boolean; reviewNote?: string }) => {
    if (!pendingReauth) return
    // Sandbox violations use sandbox_resolve, automations use reauth_resolve
    if (pendingReauth.automationId.startsWith("sandbox_")) {
      send({
        type: "sandbox_resolve",
        sessionId: pendingReauth.sessionId,
        action,
        permissionKey: pendingReauth.permissionKey,
        noExpiry: opts?.noExpiry === true,
      })
    } else {
      send({
        type: "reauth_resolve",
        automationId: pendingReauth.automationId,
        action,
        noExpiry: opts?.noExpiry === true,
        reviewNote: opts?.reviewNote || undefined,
      })
    }
    setPendingReauthQueue((prev) => prev.filter((item) => item.automationId !== pendingReauth.automationId))
  }, [pendingReauth, send])

  // Populate sessionEventsMap from session_activity broadcasts (for ProjectOverview summaries)
  // + handle rich "event" and "events_replay" messages (for desktop session panel)
  useEffect(() => {
    const unsubs: (() => void)[] = []
    unsubs.push(on("session_activity", (msg) => {
      const sid = msg.sessionId as string
      const title = msg.eventTitle as string
      const agentStatus = msg.agentStatus as string
      const eventType = normalizeSessionActivityType(msg.eventType)
      if (!sid) return
      if (!title || isSummaryNoise(title)) return
      setSessionEventsMap(prev => {
        const next = new Map(prev)
        const events = next.get(sid) || []
        const event: AgentEvent = {
          id: `activity_${Date.now()}`,
          timestamp: Date.now(),
          type: eventType,
          status: agentStatus === "waiting"
            ? "waiting"
            : agentStatus === "idle"
              ? "completed"
              : "in_progress",
          title: title || "",
        }
        const updated = [...events, event].slice(-200)
        next.set(sid, updated)
        return next
      })
    }))

    // Rich event messages — same events MissionControl uses, now also in global map
    unsubs.push(on("event", (msg) => {
      const event = msg.event as AgentEvent
      if (!event || !event.id) return
      // Determine sessionId: either from the message or from the event itself
      const sid = (msg.sessionId as string) || ""
      if (!sid) return
      if (event.type === "token_usage") return // skip noise
      // Skip ParseEngine's "Claude responded" — JSONL watcher provides cleaner response events
      if (event.type === "info" && /^(Claude|Codex|Cursor|Gemini|Aider) responded/i.test(event.title || "")) return
      setSessionEventsMap(prev => {
        const next = new Map(prev)
        const events = next.get(sid) || []
        // Dedup by id
        if (events.some(e => e.id === event.id)) {
          // Update status if changed
          const idx = events.findIndex(e => e.id === event.id)
          if (idx !== -1 && event.status && event.status !== events[idx].status) {
            const updated = [...events]
            updated[idx] = { ...events[idx], status: event.status }
            next.set(sid, updated)
            return next
          }
          return prev
        }
        const merged = [...events, event].slice(-200)
        merged.sort((a, b) => a.timestamp - b.timestamp)
        next.set(sid, merged)
        return next
      })
    }))

    // Replay stored events on attach/request_events
    unsubs.push(on("events_replay", (msg) => {
      const replayed = (msg.events as AgentEvent[]) || []
      const sid = (msg.sessionId as string) || ""
      if (!sid || replayed.length === 0) return
      const filtered = replayed.filter(e => {
        if (e.type === "token_usage") return false
        if (e.type === "decision_request" && e.status !== "waiting") return false
        return true
      })
      if (filtered.length === 0) return
      setSessionEventsMap(prev => {
        const next = new Map(prev)
        const existing = next.get(sid) || []
        const existingIds = new Set(existing.map(e => e.id))
        const newEvents = filtered.filter(e => !existingIds.has(e.id))
        if (newEvents.length === 0) return prev
        const merged = [...existing, ...newEvents].sort((a, b) => a.timestamp - b.timestamp).slice(-200)
        next.set(sid, merged)
        return next
      })
    }))

    return () => { for (const u of unsubs) u() }
  }, [on])

  // Instant local user events (desktop input → events view without server roundtrip)
  useEffect(() => {
    const handler = (e: Event) => {
      const { sessionId: sid, event } = (e as CustomEvent).detail
      if (!sid || !event) return
      setSessionEventsMap(prev => {
        const next = new Map(prev)
        const events = next.get(sid) || []
        next.set(sid, [...events, event].slice(-500))
        return next
      })
    }
    window.addEventListener("local_user_event", handler)
    return () => window.removeEventListener("local_user_event", handler)
  }, [])

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light"
    setTheme(newTheme)
    localStorage.setItem("agentrune_theme", newTheme)
    // Notify Electron to update titlebar overlay colors
    ;(window as any).electronAPI?.setTheme?.(newTheme === "dark")
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
            identifyUser(); trackLogin()
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

    // Onboarding carousel — first time only
    if (showOnboarding) {
      return <OnboardingCarousel onComplete={() => {
        trackOnboardingComplete()
        setShowOnboarding(false)
      }} />
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

  // Session timing for session_end tracking
  const sessionStartTimeRef = sessionStartRef

  // Launch handler — creates a new session
  // Optional resumeAgentSessionId: Claude Code session ID to resume (--resume <id>)
  const handleLaunch = (projectId: string, agentId: string, resumeAgentSessionId?: string) => {
    trackSessionStart(agentId, projectId)
    trackAgentLaunch(agentId, projectId)
    sessionStartTimeRef.current = Date.now()
    const sessionId = `${projectId}_${Date.now()}`
    setSelectedProject(projectId)
    setActiveAgentId(agentId)
    setCurrentSessionId(sessionId)
    setResumeSessionId(resumeAgentSessionId)
    setShouldResumeCurrentSession(false)
    saveLastProject(projectId)
    setActiveSessions((prev) => [...prev, { id: sessionId, projectId, agentId }])
    if (!isDesktop) { setScreen("session"); setViewMode("board") }
  }

  // Resume handler — resumes a specific AgentRune PTY session (not Claude Code session)
  const handleResume = (sessionId: string) => {
    const session = activeSessions.find((s) => s.id === sessionId)
    if (session) {
      const projectMatch = projects.find((p) => p.id === session.projectId)
      console.log("[handleResume]", { sessionId, projectId: session.projectId, status: session.status, projectMatch: !!projectMatch })
      setSelectedProject(session.projectId)
      setActiveAgentId(session.agentId)
      setCurrentSessionId(sessionId)
      setShouldResumeCurrentSession(true)
      // For recoverable sessions, pass the Claude session ID so daemon can --resume
      if (session.status === "recoverable" && session.claudeSessionId) {
        setResumeSessionId(session.claudeSessionId)
      } else {
        setResumeSessionId(undefined)
      }
      saveLastProject(session.projectId)
      if (!isDesktop) setScreen("session")
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
      setShouldResumeCurrentSession(true)
      saveLastProject(session.projectId)
      if (!isDesktop) { setScreen("session"); setViewMode("terminal") }
    }
  }

  // Kill handler — kills a specific session
  const handleKill = async (sessionId: string) => {
    // Persist locally first so session won't reappear even if server call fails
    addKilledSessionId(sessionId)
    setActiveSessions((prev) => prev.filter((s) => s.id !== sessionId))
    // Clean up events for the killed session to avoid stale state
    setSessionEventsMap(prev => {
      if (!prev.has(sessionId)) return prev
      const next = new Map(prev)
      next.delete(sessionId)
      return next
    })
    if (currentSessionId === sessionId) {
      setShouldResumeCurrentSession(false)
    }
    try {
      await fetch(`${getApiBase()}/api/sessions/${sessionId}/kill`, { method: "POST" })
    } catch { }
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
    // Track session duration
    if (sessionStartTimeRef.current > 0) {
      trackSessionEnd(activeAgentId, Date.now() - sessionStartTimeRef.current)
      sessionStartTimeRef.current = 0
    }
    setScreen("overview")
  }

  const sessionProject = selectedProject ? projects.find((p) => p.id === selectedProject) : null
  const isSessionReady = screen === "session" && !!sessionProject

  return (
    <ErrorBoundary>
        {screen === "builder" ? (
          <div key="builder" style={PAGE_STYLE}>
            <Suspense fallback={null}><ChainBuilder onBack={() => setScreen("overview")} t={t} /></Suspense>
          </div>
        ) : isSessionReady && !isDesktop ? (
          <div key="session" style={PAGE_STYLE}>
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
                  shouldResumeAgent={shouldResumeCurrentSession}
                  sessionToken={sessionToken}
                  send={send}
                  on={on}
                  onBack={() => setViewMode("board")}
                  onLaunchSession={handleLaunch}
                  onKillSession={handleKill}
                />
              </Suspense>
            </div>
            {/* Always keep MissionControl mounted to preserve events state.
                When in terminal mode, hide it with visibility:hidden (mirrors TerminalView pattern). */}
            <div style={viewMode === "terminal" ? {
              position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
              visibility: "hidden", zIndex: 0,
            } : undefined}>
              <Suspense fallback={null}>
                <MissionControl
                  project={sessionProject!}
                  agentId={activeAgentId}
                  sessionId={currentSessionId || undefined}
                  shouldResumeAgent={shouldResumeCurrentSession}
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
              </Suspense>
              <Suspense fallback={null}><DiffPanel
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
              /></Suspense>
            </div>
          </div>
        ) : (screen === "overview" || screen === "session") ? (
          <div key="overview" style={PAGE_STYLE}>
            {isDesktop ? (
              <Suspense fallback={null}><Dashboard
                projects={projects}
                activeSessions={activeSessions}
                sessionEvents={sessionEventsMap}
                send={send}
                on={on}
                sessionToken={wsToken}
                wsConnected={wsConnected}
                apiBase={getApiBase()}
                theme={theme}
                toggleTheme={toggleTheme}
                onSelectSession={handleResume}
                onNewSession={() => {}}
                onLaunch={handleLaunch}
                onOpenBuilder={() => setScreen("builder")}
                pendingPhaseGate={pendingPhaseGate}
                pendingReauthQueue={pendingReauthQueue}
                onPhaseGateRespond={handlePhaseGateRespond}
                onReauth={(automationId) => {
                  send({ type: "reauth_resolve", automationId, action: "approve" })
                }}
                onKillSession={handleKill}
                onNewProject={handleNewProject}
                onDeleteProject={handleDeleteProject}
              /></Suspense>
            ) : (
              <Suspense fallback={null}><UnifiedPanel
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
              /></Suspense>
            )}
          </div>
        ) : (
          <div key="launchpad" style={PAGE_STYLE}>
            {cliUpdate && (
              <div style={{
                position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
                background: "linear-gradient(90deg, #f59e0b, #d97706)", color: "#fff",
                padding: "8px 16px", fontSize: 13, fontWeight: 500,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
                {cliUpdate.changelog && (
                  <div style={{
                    marginTop: 6, fontSize: 12, opacity: 0.9,
                    whiteSpace: "pre-line", lineHeight: 1.4, maxHeight: 80, overflow: "auto",
                  }}>
                    {cliUpdate.changelog}
                  </div>
                )}
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
          </div>
        )}
      {/* Phase Gate overlay — global, shown whenever a crew is waiting for human decision */}
      {pendingPhaseGate && (
        <Suspense fallback={null}>
          <PhaseGateSheet
            gate={pendingPhaseGate}
            onRespond={handlePhaseGateRespond}
            t={t}
          />
        </Suspense>
      )}
      {pendingReauth && (
        <Suspense fallback={null}>
          <ReauthSheet
            request={pendingReauth}
            onRespond={handleReauthRespond}
            t={t}
          />
        </Suspense>
      )}
    </ErrorBoundary>
  )
}

type SessionSnapshot = {
  id: string
  projectId: string
  agentId: string
  worktreeBranch?: string | null
  lastEventTitle?: string
  summaryText?: string
  nextAction?: string
  summaryStatus?: "blocked" | "done" | "working" | "idle"
  summaryUpdatedAt?: number
  status?: string
  claudeSessionId?: string
}

const SESSION_ACTIVITY_TYPES: AgentEvent["type"][] = [
  "file_edit",
  "file_create",
  "file_delete",
  "command_run",
  "test_result",
  "install_package",
  "decision_request",
  "error",
  "info",
  "token_usage",
  "response",
  "user_message",
  "session_summary",
  "progress_report",
]

function normalizeSessionActivityType(value: unknown): AgentEvent["type"] {
  return typeof value === "string" && SESSION_ACTIVITY_TYPES.includes(value as AgentEvent["type"])
    ? value as AgentEvent["type"]
    : "response"
}

function buildSessionSeedEvent(snapshot: SessionSnapshot): AgentEvent | null {
  const summary = (snapshot.summaryText || snapshot.lastEventTitle || "").trim()
  const nextAction = (snapshot.nextAction || "").trim()
  if (!summary && !nextAction) return null

  const progressStatus = snapshot.summaryStatus === "blocked"
    ? "blocked"
    : snapshot.summaryStatus === "done"
      ? "done"
      : "in_progress"
  const timestamp = snapshot.summaryUpdatedAt || Date.now()

  return {
    id: `seed_${snapshot.id}_${timestamp}`,
    timestamp,
    type: nextAction ? "progress_report" : "response",
    status: snapshot.summaryStatus === "blocked"
      ? "failed"
      : snapshot.summaryStatus === "done"
        ? "completed"
        : "in_progress",
    title: summary,
    detail: nextAction || undefined,
    progress: {
      title: summary,
      status: progressStatus,
      summary,
      nextSteps: nextAction ? [nextAction] : [],
      details: snapshot.lastEventTitle && snapshot.lastEventTitle !== summary ? snapshot.lastEventTitle : undefined,
    },
  }
}
