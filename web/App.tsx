import { useState, useEffect, useRef, useCallback } from "react"
import "@xterm/xterm/css/xterm.css"
import type { Project } from "./lib/types"
import { getLastProject, saveLastProject } from "./lib/storage"
import { LaunchPad } from "./components/LaunchPad"
import { TerminalView } from "./components/TerminalView"
import { MissionControl } from "./components/MissionControl"

// ─── Server URL helpers ──────────────────────────────────────────

function getServerUrl(): string {
  if (
    typeof window !== "undefined" &&
    !window.location.href.startsWith("capacitor://") &&
    !window.location.href.startsWith("http://localhost")
  ) {
    return ""
  }
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

function useAuth() {
  const [status, setStatus] = useState<AuthStatus>("checking")
  const [mode, setMode] = useState<AuthMode>("none")
  const [error, setError] = useState("")
  const [sessionToken, setSessionToken] = useState("")

  useEffect(() => {
    checkAuth()
  }, [])

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

  return { status, mode, error, sessionToken, pairWithCode, verifyTotp }
}

// ─── WebSocket hook ──────────────────────────────────────────────

function useWs() {
  const wsRef = useRef<WebSocket | null>(null)
  const handlersRef = useRef<Map<string, (msg: Record<string, unknown>) => void>>(new Map())

  const connect = useCallback((sessionToken: string) => {
    const ws = new WebSocket(`${getWsUrl()}?token=${encodeURIComponent(sessionToken)}`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      const handler = handlersRef.current.get(msg.type)
      if (handler) handler(msg)
    }

    ws.onclose = () => {
      setTimeout(() => connect(sessionToken), 1500)
    }

    return ws
  }, [])

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const on = useCallback((type: string, handler: (msg: Record<string, unknown>) => void) => {
    handlersRef.current.set(type, handler)
  }, [])

  return { connect, send, on }
}

// ─── Auth screen ─────────────────────────────────────────────────

function AuthScreen({
  mode,
  error,
  onPair,
  onTotp,
}: {
  mode: AuthMode
  error: string
  onPair: (code: string) => void
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
      if (mode === "pairing") onPair(joined)
      else onTotp(joined)
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
      if (mode === "pairing") onPair(pasted)
      else onTotp(pasted)
    } else {
      inputRefs.current[pasted.length]?.focus()
    }
  }

  const isPairing = mode === "pairing"

  return (
    <div style={{
      height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0f172a", color: "#e2e8f0",
    }}>
      <div style={{
        width: 360, textAlign: "center", padding: 36, borderRadius: 24,
        background: "rgba(255,255,255,0.04)", backdropFilter: "blur(32px)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 36, fontWeight: 700, marginBottom: 4, letterSpacing: -1 }}>
          AgentRune
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 32, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600 }}>
          {isPairing ? "Device Pairing" : "Authenticator"}
        </div>

        <div style={{ marginBottom: 20 }}>
          {isPairing ? (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,0.6)" strokeWidth="1.5" style={{ margin: "0 auto" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.686-3.063a4.5 4.5 0 00-1.242-7.244l4.5-4.5a4.5 4.5 0 016.364 6.364l-1.757 1.757" />
            </svg>
          ) : (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,0.6)" strokeWidth="1.5" style={{ margin: "0 auto" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          )}
        </div>

        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 28, lineHeight: 1.5 }}>
          {isPairing
            ? "Enter the 6-digit code shown on your PC terminal"
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
                borderRadius: 12,
                border: code[i]
                  ? "2px solid rgba(96,165,250,0.4)"
                  : "1px solid rgba(255,255,255,0.1)",
                background: code[i]
                  ? "rgba(96,165,250,0.06)"
                  : "rgba(255,255,255,0.04)",
                color: "#e2e8f0",
                outline: "none",
                transition: "all 0.2s",
              }}
            />
          ))}
        </div>

        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginBottom: 8 }}>
          Auto-verifies when complete
        </div>

        {error && (
          <div style={{
            color: "#f87171", fontSize: 13, marginTop: 12,
            padding: "8px 12px", borderRadius: 8,
            background: "rgba(248,113,113,0.08)",
          }}>
            {error}
          </div>
        )}

        <div style={{
          marginTop: 24, padding: "12px 16px", borderRadius: 12,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.04)",
        }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
            {isPairing
              ? "This device will be remembered. No re-pairing needed."
              : "This device will be registered. No re-login needed."}
          </div>
        </div>
      </div>
    </div>
  )
}

function CheckingScreen() {
  return (
    <div style={{
      height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0f172a", color: "#e2e8f0",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 32, fontWeight: 700, marginBottom: 12, letterSpacing: -1 }}>AgentRune</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>Connecting...</div>
      </div>
    </div>
  )
}

// ─── Main App (Router) ──────────────────────────────────────────

type Screen = "launchpad" | "session"

export function App() {
  const { status, mode, error: authError, sessionToken, pairWithCode, verifyTotp } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [screen, setScreen] = useState<Screen>("launchpad")
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [activeAgentId, setActiveAgentId] = useState<string>("terminal")
  const [viewMode, setViewMode] = useState<"board" | "terminal">("board")
  const [activeSessions, setActiveSessions] = useState<Set<string>>(new Set())
  const { connect, send, on } = useWs()

  const isAuthed = status === "authenticated"

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
      .catch(() => {})

    // Load active sessions
    fetch(`${getApiBase()}/api/sessions`)
      .then((r) => r.json())
      .then((data) => {
        const ids = new Set<string>()
        for (const s of data) {
          // session id = project id in current implementation
          ids.add(s.id)
        }
        setActiveSessions(ids)
      })
      .catch(() => {})
  }, [isAuthed])

  // Connect WS after auth
  useEffect(() => {
    if (!isAuthed) return
    const ws = connect(sessionToken)
    ws.onopen = () => {}
    return () => { ws.close() }
  }, [isAuthed, connect, sessionToken])

  // Auth gates
  if (status === "checking") return <CheckingScreen />
  if (status === "need-auth" || status === "need-setup") {
    return <AuthScreen mode={mode} error={authError} onPair={pairWithCode} onTotp={verifyTotp} />
  }

  // Launch handler
  const handleLaunch = (projectId: string, agentId: string) => {
    setSelectedProject(projectId)
    setActiveAgentId(agentId)
    saveLastProject(projectId)
    setActiveSessions((prev) => new Set([...prev, projectId]))
    setScreen("session")
    setViewMode("board")
  }

  // Resume handler
  const handleResume = (projectId: string) => {
    setSelectedProject(projectId)
    saveLastProject(projectId)
    setScreen("session")
  }

  // Kill handler
  const handleKill = async (projectId: string) => {
    try {
      await fetch(`${getApiBase()}/api/sessions/${projectId}/kill`, { method: "POST" })
    } catch {}
    setActiveSessions((prev) => {
      const next = new Set(prev)
      next.delete(projectId)
      return next
    })
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
    } catch {}
  }

  // Back to launchpad
  const handleBack = () => {
    setScreen("launchpad")
  }

  if (screen === "session" && selectedProject) {
    const project = projects.find((p) => p.id === selectedProject)
    if (project) {
      if (viewMode === "terminal") {
        return (
          <TerminalView
            project={project}
            agentId={activeAgentId}
            sessionToken={sessionToken}
            send={send}
            on={on}
            onBack={() => setViewMode("board")}
          />
        )
      }
      return (
        <MissionControl
          project={project}
          agentId={activeAgentId}
          sessionToken={sessionToken}
          send={send}
          on={on}
          onBack={() => { setScreen("launchpad"); setViewMode("board") }}
          onOpenTerminal={() => setViewMode("terminal")}
        />
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
    />
  )
}
