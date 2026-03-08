import { useState, useEffect } from "react"
import type { Project, AppSession } from "../types"
import { AGENTS } from "../types"
import { useLocale } from "../lib/i18n/index.js"
import { FileBrowser } from "./FileBrowser"
import { PathBadge } from "./PathBadge"

const AGENTLORE_DEVICES_URL = "https://agentlore.vercel.app/api/agentrune/devices"

interface CloudDevice {
  id: string
  hostname: string
  platform: string
  localIp: string
  port: number
  protocol: string
  cloudSessionToken?: string
  tunnelUrl?: string
  status: "ONLINE" | "OFFLINE"
  lastSeen: string
}

interface LaunchPadProps {
  projects: Project[]
  activeSessions: AppSession[]
  onLaunch: (projectId: string, agentId: string) => void
  onResume: (sessionId: string) => void
  onKill: (sessionId: string) => void
  onNewProject: (name: string, cwd: string) => void
  selectedProject: string | null
  onSelectProject: (id: string) => void
  theme: "light" | "dark"
  toggleTheme: () => void
  onCloudConnect?: (url: string, cloudSessionToken?: string) => void
}

// Helper to return the correct SVG icon for an agent ID
function getAgentIcon(id: string) {
  switch (id) {
    case "claude":
      // Claude sparkle/starburst — Anthropic's iconic spark shape
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
          <path d="M5.6 5.6l2.85 2.85M15.55 15.55l2.85 2.85M18.4 5.6l-2.85 2.85M8.45 15.55l-2.85 2.85" />
        </svg>
      )
    case "codex":
      // OpenAI Codex — hexagonal node shape
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2l8.5 5v10L12 22l-8.5-5V7L12 2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
    case "openclaw":
      // OpenClaw — claw / paw shape
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7.5 10c0-2.5-1-4.5-1-4.5S8 4 9.5 6.5" />
          <path d="M12 9c0-3-0.5-5.5-0.5-5.5S13.5 3 14 6" />
          <path d="M16.5 10c0-2.5 1-4.5 1-4.5S16 4 14.5 6.5" />
          <path d="M6 13c0 0 1 8 6 8s6-8 6-8" />
          <path d="M6 13c0-2 2.5-4 6-4s6 2 6 4" />
        </svg>
      )
    case "aider":
      // Aider — pair programming: two overlapping chat bubbles
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z" />
          <path d="M8 10h.01M12 10h.01M16 10h.01" />
        </svg>
      )
    case "cline":
      // Cline — code editor cursor/bracket style
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
          <line x1="14.5" y1="4" x2="9.5" y2="20" />
        </svg>
      )
    case "gemini":
      // Gemini — 4-point sparkle star (Google Gemini logo style)
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2C12 2 13.5 8.5 17 12C13.5 15.5 12 22 12 22C12 22 10.5 15.5 7 12C10.5 8.5 12 2 12 2Z" />
        </svg>
      )
    default:
      // Terminal — prompt icon
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      )
  }
}

export function LaunchPad({
  projects,
  activeSessions,
  onLaunch,
  onResume,
  onKill,
  onNewProject,
  selectedProject,
  onSelectProject,
  theme,
  toggleTheme,
  onCloudConnect,
}: LaunchPadProps) {
  const { t } = useLocale()
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState("")
  const [newCwd, setNewCwd] = useState("")
  const [showBrowser, setShowBrowser] = useState(false)
  const [cloudDevices, setCloudDevices] = useState<CloudDevice[]>([])

  useEffect(() => {
    const token = localStorage.getItem("agentrune_phone_token")
    if (!token) return
    fetch(AGENTLORE_DEVICES_URL, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setCloudDevices(d.data?.devices ?? []))
      .catch(() => {})
  }, [])

  const handleCreate = () => {
    if (!newName.trim() || !newCwd.trim()) return
    onNewProject(newName.trim(), newCwd.trim())
    setNewName("")
    setNewCwd("")
    setShowNewForm(false)
  }

  const projectSessions = selectedProject
    ? activeSessions.filter((s) => s.projectId === selectedProject)
    : []

  return (
    <div style={{
      height: "100dvh",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header / Logo Component */}
      <div style={{
        padding: "48px 20px 32px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}>
        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          style={{
            position: "absolute",
            top: "calc(env(safe-area-inset-top, 0px) + 52px)",
            right: 20,
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "var(--glass-bg)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid var(--glass-border)",
            boxShadow: "var(--glass-shadow)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "var(--text-primary)",
            transition: "all 0.3s ease",
            zIndex: 10,
          }}
          aria-label="Toggle theme"
        >
          {theme === "light" ? (
            // Moon icon for switching to dark
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          ) : (
            // Sun icon for switching to light
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
          )}
        </button>

        <div style={{
          padding: "32px 24px",
          borderRadius: "16px",
          background: "var(--glass-bg)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid var(--glass-border)",
          boxShadow: "var(--glass-shadow)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          maxWidth: "400px",
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Subtle mesh glow inside the card */}
          <div style={{
            position: "absolute",
            top: "-50%",
            left: "-50%",
            width: "200%",
            height: "200%",
            background: "radial-gradient(circle at center, var(--accent-primary-bg) 0%, transparent 60%)",
            opacity: 0.2,
            pointerEvents: "none",
          }} />
          <div style={{
            fontSize: 36,
            fontWeight: 700,
            letterSpacing: "-1px",
            color: "var(--text-primary)",
            position: "relative",
            zIndex: 1,
            lineHeight: 1.1,
          }}>
            AgentRune
          </div>
          <div style={{
            fontSize: 11,
            color: "var(--text-secondary)",
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            fontWeight: 600,
            marginTop: 8,
            position: "relative",
            zIndex: 1,
          }}>
            {t("launchpad.title")}
          </div>
        </div>
      </div>

      {/* Quick Connect — cloud devices from AgentLore */}
      {cloudDevices.length > 0 && (
        <div style={{ flexShrink: 0, padding: "0 20px", width: "100%", maxWidth: "440px", margin: "0 auto 8px" }}>
          <div style={{
            fontSize: 11,
            color: "var(--text-secondary)",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 1.5,
            marginBottom: 12,
          }}>
            {t("launchpad.quickConnect")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {cloudDevices.map((device) => {
              // Prefer tunnel URL (works from anywhere), fallback to LAN
              const url = device.tunnelUrl || `http://${device.localIp}:${device.port}`
              const isOnline = device.status === "ONLINE"
              const currentServer = localStorage.getItem("agentrune_server") || ""
              const isConnected = (currentServer === url || currentServer === `http://${device.localIp}:${device.port}`) && !!localStorage.getItem("agentrune_cloud_token")
              return (
                <button
                  key={device.id}
                  onClick={() => {
                    if (onCloudConnect) {
                      localStorage.setItem("agentrune_server", url)
                      onCloudConnect(url, device.cloudSessionToken)
                    } else {
                      window.open(url, "_blank")
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 18px",
                    borderRadius: 18,
                    border: isConnected
                      ? "1.5px solid rgba(74, 222, 128, 0.4)"
                      : isOnline
                        ? "1px solid rgba(16, 185, 129, 0.35)"
                        : "1px solid var(--glass-border)",
                    background: isConnected
                      ? "rgba(74, 222, 128, 0.06)"
                      : isOnline ? "rgba(16, 185, 129, 0.07)" : "var(--glass-bg)",
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    color: "var(--text-primary)",
                    boxShadow: isConnected ? "0 0 12px rgba(74, 222, 128, 0.08)" : "none",
                  }}
                >
                  <div style={{
                    width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                    background: isConnected ? "rgba(74, 222, 128, 0.7)" : isOnline ? "#fbbf24" : "var(--text-secondary)",
                    boxShadow: isConnected ? "0 0 6px rgba(74, 222, 128, 0.3)" : isOnline ? "0 0 6px #fbbf24" : "none",
                    transition: "all 0.3s",
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{device.hostname}</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                      {device.tunnelUrl ? new URL(device.tunnelUrl).hostname : `${device.localIp}:${device.port}`}
                    </div>
                  </div>
                  <div style={{
                    fontSize: 12,
                    color: isConnected ? "rgba(74, 222, 128, 0.8)" : "var(--text-secondary)",
                    fontWeight: isConnected ? 700 : 500,
                  }}>
                    {isConnected ? "✓ " + t("launchpad.connected") : t("launchpad.tapToConnect")}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Top Panel: Projects */}
      <div style={{ flexShrink: 0, padding: "0 20px", width: "100%", maxWidth: "440px", margin: "0 auto" }}>
        <div style={{
          fontSize: 11,
          color: "var(--text-secondary)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1.5,
          marginBottom: 12,
        }}>
          {t("launchpad.projects")}
        </div>
        <div style={{
          display: "flex",
          gap: 12,
          overflowX: "auto",
          overflowY: "hidden",
          paddingBottom: 16,
          WebkitOverflowScrolling: "touch" as never,
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          touchAction: "pan-x",
          margin: "0 -20px",
          padding: "0 20px 16px",
        }}>
          {projects.map((p) => {
            const selected = p.id === selectedProject
            const running = activeSessions.some((s) => s.projectId === p.id)
            return (
              <button
                key={p.id}
                onClick={() => onSelectProject(p.id)}
                style={{
                  flexShrink: 0,
                  minWidth: 160,
                  padding: "16px 20px",
                  borderRadius: 16,
                  border: selected
                    ? "1.5px solid var(--accent-primary)"
                    : "1px solid var(--glass-border)",
                  background: selected
                    ? "var(--accent-primary-bg)"
                    : "var(--glass-bg)",
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                  boxShadow: selected ? "0 4px 16px rgba(59, 130, 246, 0.15)" : "var(--glass-shadow)",
                  color: "var(--text-primary)",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                  position: "relative",
                  opacity: selected ? 1 : 0.8,
                  overflow: "hidden",
                }}
              >
                {selected && (
                  <div style={{
                    position: "absolute",
                    top: 14,
                    right: 14,
                    color: "var(--accent-primary)",
                    opacity: 0.8,
                  }}>
                    {/* Tiny quote/pin icon from the mockup indicating selection */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.8">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                    </svg>
                  </div>
                )}
                {running && !selected && (
                  <div style={{
                    position: "absolute",
                    top: 16,
                    right: 16,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--accent-primary)",
                    boxShadow: "0 0 8px var(--accent-primary)",
                  }} />
                )}
                <div style={{
                  fontWeight: 600,
                  fontSize: 16,
                  marginBottom: 6,
                  paddingRight: 20,
                  color: "var(--text-primary)",
                }}>
                  {p.name}
                </div>
                <PathBadge path={p.cwd} style={{ fontSize: 11 }} />
              </button>
            )
          })}

          {/* + New button */}
          <button
            onClick={() => setShowNewForm(true)}
            style={{
              flexShrink: 0,
              minWidth: 64,
              padding: "16px",
              borderRadius: 20,
              border: "1px dashed var(--text-secondary)",
              background: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s",
              opacity: 0.6,
            }}
          >
            +
          </button>
        </div>
      </div>

      {/* New project form */}
      {showNewForm && (
        <div style={{
          margin: "0 auto 16px",
          width: "calc(100% - 40px)",
          maxWidth: "400px",
          padding: 20,
          borderRadius: 20,
          background: "var(--glass-bg)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid var(--glass-border)",
          boxShadow: "var(--glass-shadow)",
        }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("launchpad.projectName")}
            style={inputStyle}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
            <input
              value={newCwd}
              onChange={(e) => setNewCwd(e.target.value)}
              placeholder={t("launchpad.projectPath")}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={() => setShowBrowser(true)}
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                border: "1px solid var(--glass-border)",
                background: "var(--glass-bg)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <button
              onClick={handleCreate}
              style={{
                flex: 1,
                padding: "12px",
                borderRadius: 12,
                border: "none",
                background: "var(--accent-primary)",
                color: "#ffffff",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {t("launchpad.create")}
            </button>
            <button
              onClick={() => setShowNewForm(false)}
              style={{
                padding: "12px 20px",
                borderRadius: 12,
                border: "1px solid var(--glass-border)",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {t("launchpad.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Bottom Panel: Agents */}
      <div style={{
        flex: 1,
        padding: "12px 20px 24px",
        overflowY: "auto",
        width: "100%",
        maxWidth: "440px",
        margin: "0 auto",
      }}>
        <div style={{
          fontSize: 11,
          color: "var(--text-secondary)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1.5,
          marginBottom: 16,
        }}>
          {t("launchpad.launchAgent")}
        </div>

        {/* Active sessions for this project */}
        {projectSessions.length > 0 && (
          <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{
              fontSize: 10, fontWeight: 600, color: "var(--text-secondary)",
              textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4,
            }}>
              {t("launchpad.activeSessions")}
            </div>
            {projectSessions.map((s) => {
              const agentDef = AGENTS.find((a) => a.id === s.agentId)
              return (
                <div key={s.id} style={{
                  display: "flex", gap: 8, alignItems: "center",
                }}>
                  <button
                    onClick={() => onResume(s.id)}
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      borderRadius: 14,
                      border: "1px solid rgba(16, 185, 129, 0.4)",
                      background: "rgba(16, 185, 129, 0.1)",
                      backdropFilter: "blur(20px)",
                      WebkitBackdropFilter: "blur(20px)",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: "#4ade80", boxShadow: "0 0 8px #4ade80",
                    }} />
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {agentDef?.name || s.agentId}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginLeft: "auto" }}>
                      {t("launchpad.resume")}
                    </div>
                  </button>
                  <button
                    onClick={() => onKill(s.id)}
                    style={{
                      width: 40, height: 40,
                      borderRadius: 12,
                      border: "1px solid rgba(239, 68, 68, 0.2)",
                      background: "rgba(239, 68, 68, 0.05)",
                      color: "#ef4444",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Agent selection cards — always shown */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {AGENTS.map((agent) => (
            <button
              key={agent.id}
              onClick={() => selectedProject && onLaunch(selectedProject, agent.id)}
              disabled={!selectedProject}
              style={{
                padding: "16px 20px",
                borderRadius: 20,
                border: "1px solid var(--glass-border)",
                background: "var(--card-bg)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                boxShadow: "var(--glass-shadow)",
                color: "var(--text-primary)",
                cursor: selectedProject ? "pointer" : "default",
                textAlign: "left",
                transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                opacity: selectedProject ? 1 : 0.5,
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: "var(--icon-bg)",
                color: "var(--text-primary)",
                border: "1px solid var(--glass-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 2px 8px rgba(0,0,0,0.05)"
              }}>
                {getAgentIcon(agent.id)}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>{agent.id === "terminal" ? t("agent.terminal.name") : agent.name}</div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>
                  {t(`agent.${agent.id}.desc`)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Footer Version Info */}
      <div style={{
        padding: "16px 20px",
        paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        flexShrink: 0,
        display: "flex",
        justifyContent: "center",
      }}>
        <div style={{
          fontSize: 11,
          color: "var(--text-secondary)",
          letterSpacing: 1,
          fontWeight: 600,
        }}>
          AgentRune v0.2
        </div>
      </div>

      {/* FileBrowser modal for folder selection */}
      <FileBrowser
        open={showBrowser}
        onClose={() => setShowBrowser(false)}
        onSelectPath={(path) => { setNewCwd(path); setShowBrowser(false) }}
        initialPath={newCwd || undefined}
      />
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: 14,
  border: "1px solid var(--glass-border)",
  background: "var(--icon-bg)",
  color: "var(--text-primary)",
  fontSize: 14,
  fontFamily: "'JetBrains Mono', monospace",
  outline: "none",
  boxSizing: "border-box",
}
