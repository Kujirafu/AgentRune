// web/components/MissionControl.tsx
import { useState, useEffect, useRef, useCallback } from "react"
import type { Project, ProjectSettings, SmartAction } from "../lib/types"
import type { AgentEvent } from "../../shared/types"
import { AGENTS } from "../lib/types"
import { getSettings, saveSettings, addRecentCommand, getRecentCommands } from "../lib/storage"
import { EventCard } from "./EventCard"
import { StatusIndicator, type AgentStatus } from "./StatusIndicator"
import { QuickActions } from "./QuickActions"
import { InputBar } from "./InputBar"
import { SettingsSheet } from "./SettingsSheet"
import { isMobile } from "../lib/detect"

interface MissionControlProps {
  project: Project
  agentId: string
  sessionToken: string
  send: (msg: Record<string, unknown>) => void
  on: (type: string, handler: (msg: Record<string, unknown>) => void) => void
  onBack: () => void
  onOpenTerminal: () => void
}

export function MissionControl({
  project,
  agentId,
  send,
  on,
  onBack,
  onOpenTerminal,
}: MissionControlProps) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle")
  const [settings, setSettings] = useState<ProjectSettings>(() => getSettings(project.id))
  const [showSettings, setShowSettings] = useState(false)
  const [kbHeight, setKbHeight] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const promptReadyRef = useRef(false)
  const agent = AGENTS.find((a) => a.id === agentId)

  // Keyboard height detection
  useEffect(() => {
    if (!isMobile || !window.visualViewport) return
    const vv = window.visualViewport
    const onResize = () => {
      const diff = window.innerHeight - vv.height
      setKbHeight(diff > 50 ? diff : 0)
    }
    vv.addEventListener("resize", onResize)
    return () => vv.removeEventListener("resize", onResize)
  }, [])

  // Auto-scroll to top (newest events) — decision cards are pinned
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [events.length])

  const handleSettingsChange = useCallback((newSettings: ProjectSettings) => {
    setSettings(newSettings)
    saveSettings(project.id, newSettings)
  }, [project.id])

  const sendInput = useCallback((data: string) => {
    send({ type: "input", data })
  }, [send])

  const handleSendCommand = useCallback((text: string) => {
    if (text === "\x03") {
      sendInput(text)
      return
    }
    sendInput(text + "\n")
    addRecentCommand(project.id, text)
  }, [sendInput, project.id])

  const handleDecision = useCallback((input: string) => {
    sendInput(input)
    // Remove the decision event after responding
    setEvents((prev) =>
      prev.map((e) =>
        e.type === "decision_request" && e.status === "waiting"
          ? { ...e, status: "completed" as const }
          : e
      )
    )
  }, [sendInput])

  // Handle WS messages
  useEffect(() => {
    on("event", (msg) => {
      const event = msg.event as AgentEvent
      setEvents((prev) => [event, ...prev].slice(0, 100)) // newest first, cap at 100

      // Update agent status based on event
      if (event.type === "decision_request" && event.status === "waiting") {
        setAgentStatus("waiting")
        // Vibrate on mobile when decision needed
        if (navigator.vibrate) navigator.vibrate([200, 100, 200])
      } else if (event.status === "in_progress") {
        setAgentStatus("working")
      }
    })

    on("output", (msg) => {
      const data = msg.data as string
      // Detect shell prompt for idle state
      if (/[$%>]\s*$/.test(data)) {
        promptReadyRef.current = true
      }

      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      setAgentStatus("working")

      idleTimerRef.current = setTimeout(() => {
        if (promptReadyRef.current) {
          setAgentStatus("idle")
        }
      }, 1500)
    })

    on("attached", () => {
      if (agent) {
        const cmd = agent.command(settings)
        if (cmd) {
          const tryToSend = (attempts: number) => {
            if (promptReadyRef.current || attempts >= 10) {
              setTimeout(() => send({ type: "input", data: cmd + "\n" }), 100)
            } else {
              setTimeout(() => tryToSend(attempts + 1), 200)
            }
          }
          setTimeout(() => tryToSend(0), 500)
        }
      }
    })

    on("exit", () => {
      setAgentStatus("idle")
      setEvents((prev) => [{
        id: `evt_exit_${Date.now()}`,
        timestamp: Date.now(),
        type: "info",
        status: "completed",
        title: "Session ended",
      }, ...prev])
    })
  }, [on, send, agent, settings])

  // Attach on mount
  useEffect(() => {
    promptReadyRef.current = false
    send({ type: "attach", projectId: project.id, agentId })
  }, [project.id, agentId, send])

  // Separate decision events (pinned) from others
  const decisionEvents = events.filter((e) => e.type === "decision_request" && e.status === "waiting")
  const otherEvents = events.filter((e) => !(e.type === "decision_request" && e.status === "waiting"))

  // Pull-down hint for terminal
  const touchStartRef = useRef(0)

  return (
    <div style={{
      height: kbHeight > 0 ? `calc(100dvh - ${kbHeight}px)` : "100dvh",
      display: "flex",
      flexDirection: "column",
      background: "#0f172a",
      color: "#e2e8f0",
      transition: "height 0.1s",
    }}>
      {/* Top bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        background: "rgba(255,255,255,0.03)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
        userSelect: "none",
      }}>
        <button
          onClick={onBack}
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            color: "rgba(255,255,255,0.6)",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          {"\u2190"}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontWeight: 600,
            fontSize: 14,
            color: "#fff",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {project.name}
            <span style={{ color: "rgba(255,255,255,0.25)", margin: "0 6px" }}>{"\u00B7"}</span>
            <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 400 }}>
              {agent?.name || "Terminal"}
            </span>
          </div>
        </div>

        {settings.bypass && (
          <span style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            background: "rgba(251,191,36,0.1)",
            border: "1px solid rgba(251,191,36,0.2)",
            color: "#fbbf24",
            fontWeight: 600,
          }}>
            {"\u26A1"} Bypass
          </span>
        )}

        {/* Terminal toggle */}
        <button
          onClick={onOpenTerminal}
          style={{
            padding: "5px 10px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            color: "rgba(255,255,255,0.4)",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "monospace",
          }}
        >
          {">_"}
        </button>

        <button
          onClick={() => setShowSettings(true)}
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            color: "rgba(255,255,255,0.6)",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          {"\u2699"}
        </button>
      </div>

      {/* Status indicator */}
      <StatusIndicator status={agentStatus} agentName={agent?.name || "Terminal"} />

      {/* Event stream */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          WebkitOverflowScrolling: "touch" as never,
        }}
        onTouchStart={(e) => { touchStartRef.current = e.touches[0].clientY }}
        onTouchEnd={(e) => {
          const dy = e.changedTouches[0].clientY - touchStartRef.current
          // Pull down at top to open terminal
          if (dy > 100 && scrollRef.current && scrollRef.current.scrollTop <= 0) {
            onOpenTerminal()
          }
        }}
      >
        {/* Decision events pinned at top */}
        {decisionEvents.map((event) => (
          <EventCard key={event.id} event={event} onDecision={handleDecision} />
        ))}

        {/* Other events */}
        {otherEvents.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}

        {/* Empty state */}
        {events.length === 0 && (
          <div style={{
            textAlign: "center",
            padding: "60px 20px",
            color: "rgba(255,255,255,0.2)",
          }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>{agent?.icon || ">_"}</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Waiting for agent activity...</div>
            <div style={{ fontSize: 12, marginTop: 8 }}>Events will appear here as the agent works</div>
          </div>
        )}

        {/* Pull hint */}
        <div style={{
          textAlign: "center",
          padding: "16px 0",
          fontSize: 11,
          color: "rgba(255,255,255,0.15)",
          letterSpacing: 1,
        }}>
          pull down for terminal
        </div>
      </div>

      {/* Quick actions */}
      <QuickActions onAction={sendInput} />

      {/* Input bar */}
      <InputBar
        onSend={handleSendCommand}
        autoFocus={isMobile}
      />

      {/* Settings overlay */}
      <SettingsSheet
        open={showSettings}
        settings={settings}
        onChange={handleSettingsChange}
        onClose={() => setShowSettings(false)}
      />

      {/* CSS animation */}
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}
