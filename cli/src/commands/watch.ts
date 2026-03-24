// commands/watch.ts
// Terminal sync agent — mirrors phone APP content on computer terminal.
// Shows events, thinking, diff in real-time. Allows input from terminal.

import WebSocket from "ws"
import { createInterface } from "node:readline"
import { loadConfig } from "../shared/config.js"
import { log } from "../shared/logger.js"
import type { AgentEvent, Project } from "../shared/types.js"

// ─── ANSI helpers ────────────────────────────────────────────
const R = "\x1b[0m"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const ITALIC = "\x1b[3m"
const BLUE = "\x1b[34m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const RED = "\x1b[31m"
const CYAN = "\x1b[36m"
const MAGENTA = "\x1b[35m"
const WHITE = "\x1b[37m"
const BG_BLUE = "\x1b[44m"
const BG_GREEN = "\x1b[42m"
const BG_RED = "\x1b[41m"
const BG_YELLOW = "\x1b[43m"
const CLEAR_LINE = "\x1b[2K\r"

const STATUS_ICON: Record<string, string> = {
  in_progress: `${BLUE}⟳${R}`,
  completed: `${GREEN}✓${R}`,
  failed: `${RED}✗${R}`,
  waiting: `${YELLOW}?${R}`,
}

const TYPE_ICON: Record<string, string> = {
  file_edit: `${CYAN}✎${R}`,
  file_create: `${GREEN}+${R}`,
  file_delete: `${RED}-${R}`,
  command_run: `${YELLOW}$${R}`,
  test_result: `${MAGENTA}⚡${R}`,
  decision_request: `${YELLOW}⚠${R}`,
  error: `${RED}✗${R}`,
  info: `${DIM}•${R}`,
  session_summary: `${BLUE}◆${R}`,
}

function timeStr(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}

function wrapText(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ""
  for (const w of words) {
    if (line.length + w.length + 1 > width) {
      lines.push(line)
      line = w
    } else {
      line = line ? line + " " + w : w
    }
  }
  if (line) lines.push(line)
  return lines.join("\n" + indent)
}

// ─── Diff renderer ───────────────────────────────────────────
function renderDiff(diff: { filePath: string; before: string; after: string }): string {
  const lines: string[] = []
  const cols = process.stdout.columns || 80
  lines.push(`${DIM}${"─".repeat(cols)}${R}`)
  lines.push(`${BOLD}${CYAN}  ${diff.filePath}${R}`)
  lines.push(`${DIM}${"─".repeat(cols)}${R}`)

  const before = diff.before.split("\n")
  const after = diff.after.split("\n")

  // Simple diff: show removed lines in red, added in green
  // Use LCS for short diffs, simple side-by-side for longer ones
  if (before.length + after.length < 60) {
    // Mark removed
    for (const l of before) {
      if (!after.includes(l)) {
        lines.push(`${RED}  - ${truncate(l, cols - 6)}${R}`)
      }
    }
    // Mark added
    for (const l of after) {
      if (!before.includes(l)) {
        lines.push(`${GREEN}  + ${truncate(l, cols - 6)}${R}`)
      }
    }
  } else {
    lines.push(`${DIM}  (${before.length} → ${after.length} lines)${R}`)
  }

  lines.push(`${DIM}${"─".repeat(cols)}${R}`)
  return lines.join("\n")
}

// ─── Event formatter ─────────────────────────────────────────
function formatEvent(event: AgentEvent): string {
  const cols = process.stdout.columns || 80
  const icon = TYPE_ICON[event.type] || "•"
  const status = STATUS_ICON[event.status] || " "
  const time = `${DIM}${timeStr(event.timestamp)}${R}`
  const title = truncate(event.title, cols - 20)

  let line = `  ${status} ${icon} ${title}  ${time}`

  // Detail line
  if (event.detail && event.detail.length < 200) {
    const cleaned = event.detail.replace(/\n/g, " ").trim()
    if (cleaned && cleaned !== event.title) {
      line += `\n      ${DIM}${truncate(cleaned, cols - 8)}${R}`
    }
  }

  // Diff preview
  if (event.diff) {
    line += `\n      ${CYAN}◇ diff: ${event.diff.filePath}${R}`
  }

  // Decision options
  if (event.decision) {
    for (let i = 0; i < event.decision.options.length; i++) {
      const opt = event.decision.options[i]
      const style = opt.style === "danger" ? RED : BLUE
      line += `\n      ${style}[${i + 1}]${R} ${opt.label.split("\n")[0]}`
    }
    line += `\n      ${DIM}→ Type number to choose, or 'v' to view all options${R}`
  }

  return line
}

// ─── Watch command ───────────────────────────────────────────
export async function watchCommand(opts: {
  port?: string
  session?: string
  raw?: boolean
}) {
  const port = parseInt(opts.port || "3457")
  const url = `ws://localhost:${port}`

  // Fetch projects and active sessions
  let projects: Project[] = []
  let activeSessions: { id: string; projectId: string; agentId: string }[] = []
  try {
    const [projRes, sessRes] = await Promise.all([
      fetch(`http://localhost:${port}/api/projects`),
      fetch(`http://localhost:${port}/api/sessions`),
    ])
    projects = await projRes.json()
    activeSessions = await sessRes.json()
  } catch {
    log.error(`Cannot connect to daemon at localhost:${port}. Is it running?`)
    process.exit(1)
  }

  if (projects.length === 0) {
    log.error("No projects configured. Add a project via the phone app first.")
    process.exit(1)
  }

  // Header
  const cols = process.stdout.columns || 80
  console.log()
  console.log(`${BG_BLUE}${WHITE}${BOLD}${"  AgentRune Watch  ".padEnd(cols)}${R}`)
  console.log(`${DIM}  Syncing with phone app • localhost:${port}${R}`)
  console.log(`${DIM}  Projects: ${projects.map(p => p.name).join(", ")}${R}`)
  console.log(`${DIM}${"─".repeat(cols)}${R}`)
  console.log()

  // Connect WebSocket
  const ws = new WebSocket(url)
  let currentSessionId: string | null = null
  let currentProject: Project | null = null
  let currentAgent = ""
  let currentStatus = "connecting"
  let pendingDecision: AgentEvent | null = null
  let eventCount = 0

  function updateStatusLine() {
    const cols = process.stdout.columns || 80
    const proj = currentProject?.name || "—"
    const agent = currentAgent || "—"
    const sid = currentSessionId ? currentSessionId.slice(0, 8) : "—"
    const statusColor = currentStatus === "working" ? YELLOW
      : currentStatus === "idle" ? GREEN
      : currentStatus === "waiting" ? RED
      : DIM
    const statusText = `${statusColor}${currentStatus}${R}`
    const line = `${DIM}[${R}${proj}${DIM}]${R} ${agent} ${DIM}(${sid})${R} ${statusText} ${DIM}| ${eventCount} events${R}`
    process.stdout.write(`${CLEAR_LINE}${line}`)
  }

  ws.on("open", () => {
    currentStatus = "connected"
    console.log(`${GREEN}  ● Connected to daemon${R}`)

    // If --session specified, attach to that session's project
    // Otherwise, attach to most recently active session
    let targetSession = opts.session
      ? activeSessions.find(s => s.id.startsWith(opts.session!))
      : activeSessions[0]

    const project = targetSession
      ? projects.find(p => p.id === targetSession!.projectId) || projects[0]
      : projects[0]
    const agentId = targetSession?.agentId || "claude"

    currentProject = project
    ws.send(JSON.stringify({
      type: "attach",
      projectId: project.id,
      agentId,
      ...(targetSession ? { sessionId: targetSession.id } : {}),
    }))
  })

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString())
      handleMessage(msg)
    } catch { /* ignore */ }
  })

  ws.on("close", () => {
    console.log(`\n${RED}  ● Disconnected from daemon${R}`)
    currentStatus = "disconnected"
    // Auto-reconnect after 3s
    setTimeout(() => {
      console.log(`${DIM}  Reconnecting...${R}`)
      watchCommand(opts)
    }, 3000)
  })

  ws.on("error", (err) => {
    log.error(`WebSocket error: ${err.message}`)
  })

  function handleMessage(msg: Record<string, any>) {
    switch (msg.type) {
      case "attached": {
        currentSessionId = msg.sessionId
        currentAgent = msg.agentId || "claude"
        currentStatus = "idle"
        const resumed = msg.resumed ? " (resumed)" : ""
        console.log(`${GREEN}  ● Attached to session ${msg.sessionId?.slice(0, 8)}${resumed}${R}`)
        console.log(`${DIM}  Project: ${msg.projectName || currentProject?.name} • Agent: ${currentAgent}${R}`)
        console.log()
        break
      }

      case "event": {
        const event = msg.event as AgentEvent
        if (!event) break
        eventCount++

        // Track pending decision
        if (event.type === "decision_request" && event.status === "waiting") {
          pendingDecision = event
          currentStatus = "waiting"
        }

        // Show in terminal
        console.log(formatEvent(event))

        // Status update
        if (event.status === "in_progress") currentStatus = "working"
        else if (event.status === "completed") currentStatus = "idle"
        break
      }

      case "events_replay": {
        const events = (msg.events as AgentEvent[]) || []
        if (events.length === 0) break
        console.log(`${DIM}  ─── Replaying ${events.length} events ───${R}`)
        for (const event of events.slice(-30)) { // Show last 30
          eventCount++
          console.log(formatEvent(event))
        }
        console.log(`${DIM}  ─── End replay ───${R}`)
        console.log()

        // Track latest decision
        const latest = events[events.length - 1]
        if (latest?.type === "decision_request" && latest.status === "waiting") {
          pendingDecision = latest
          currentStatus = "waiting"
        }
        break
      }

      case "output": {
        if (opts.raw) {
          // Raw mode: show terminal output directly
          process.stdout.write(msg.data as string)
        }
        // In non-raw mode, we only show structured events
        break
      }

      case "exit": {
        console.log(`\n${RED}  ● Session ended${R}`)
        currentStatus = "idle"
        pendingDecision = null
        break
      }

      case "session_activity": {
        const sid = (msg.sessionId as string)?.slice(0, 8) || "?"
        const title = msg.eventTitle || ""
        if (title) {
          console.log(`${DIM}  [${sid}] ${title}${R}`)
        }
        break
      }

      case "watch_target": {
        // Phone app requested watch on a specific session — auto-switch
        const targetSid = msg.sessionId as string
        if (targetSid && targetSid !== currentSessionId) {
          console.log(`\n${CYAN}  ● Phone requested sync to session ${targetSid.slice(0, 8)}${R}`)
          // Find the session's project to re-attach
          const targetSession = activeSessions.find(s => s.id === targetSid)
          if (targetSession) {
            const proj = projects.find(p => p.id === targetSession.projectId)
            if (proj) {
              currentProject = proj
              ws.send(JSON.stringify({
                type: "attach",
                projectId: proj.id,
                agentId: targetSession.agentId,
                sessionId: targetSid,
              }))
            }
          }
        }
        break
      }

      case "error": {
        log.error(msg.message || "Unknown error")
        break
      }
    }
  }

  // ─── Interactive input ─────────────────────────────────────
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "",
  })

  // Handle Ctrl+C gracefully
  rl.on("SIGINT", () => {
    console.log(`\n${DIM}  Bye!${R}`)
    ws.close()
    process.exit(0)
  })

  rl.on("line", (input) => {
    const trimmed = input.trim()
    if (!trimmed) return

    // Special commands
    if (trimmed === ":q" || trimmed === ":quit") {
      ws.close()
      process.exit(0)
    }

    if (trimmed === ":raw") {
      opts.raw = !opts.raw
      console.log(`${DIM}  Raw mode: ${opts.raw ? "ON" : "OFF"}${R}`)
      return
    }

    if (trimmed === ":status") {
      updateStatusLine()
      console.log()
      return
    }

    if (trimmed === ":diff" || trimmed === ":d") {
      // Show last diff event
      console.log(`${DIM}  (Diff history not stored in watch mode — use phone app for diff view)${R}`)
      return
    }

    if (trimmed === ":help" || trimmed === ":h") {
      console.log()
      console.log(`${BOLD}  Watch Commands:${R}`)
      console.log(`    ${CYAN}:q${R}        Quit`)
      console.log(`    ${CYAN}:raw${R}      Toggle raw terminal output`)
      console.log(`    ${CYAN}:status${R}   Show connection status`)
      console.log(`    ${CYAN}:switch N${R} Switch to project N`)
      console.log(`    ${CYAN}:h${R}        Show this help`)
      console.log()
      console.log(`${BOLD}  Input:${R}`)
      console.log(`    ${CYAN}1-9${R}       Choose decision option`)
      console.log(`    ${CYAN}y/n/a${R}     Answer permission prompt`)
      console.log(`    ${CYAN}text${R}      Send as command to agent`)
      console.log()
      return
    }

    if (trimmed.startsWith(":switch")) {
      const idx = parseInt(trimmed.split(/\s+/)[1] || "1") - 1
      if (idx >= 0 && idx < projects.length) {
        currentProject = projects[idx]
        ws.send(JSON.stringify({
          type: "attach",
          projectId: currentProject.id,
          agentId: "claude",
        }))
        console.log(`${DIM}  Switching to project: ${currentProject.name}${R}`)
      } else {
        console.log(`${DIM}  Projects: ${projects.map((p, i) => `${i + 1}. ${p.name}`).join(", ")}${R}`)
      }
      return
    }

    // Decision shortcut: single digit = choose option
    if (/^[1-9]$/.test(trimmed) && pendingDecision?.decision) {
      const idx = parseInt(trimmed) - 1
      const opt = pendingDecision.decision.options[idx]
      if (opt) {
        console.log(`${GREEN}  → Choosing: ${opt.label.split("\n")[0]}${R}`)
        // Send the input (may contain escape sequences for TUI navigation)
        const parts = opt.input.match(/\x1b\[[A-Z]|\x1b|\r|[^\x1b\r]+/g) || [opt.input]
        parts.forEach((part, i) => {
          setTimeout(() => ws.send(JSON.stringify({ type: "input", data: part })), i * 150)
        })
        pendingDecision = null
        currentStatus = "working"
        return
      }
    }

    // Permission shortcuts
    if (/^[yna]$/i.test(trimmed) && pendingDecision?.decision) {
      ws.send(JSON.stringify({ type: "input", data: trimmed }))
      pendingDecision = null
      currentStatus = "working"
      return
    }

    // Regular text: send as command
    ws.send(JSON.stringify({ type: "input", data: trimmed }))
    setTimeout(() => ws.send(JSON.stringify({ type: "input", data: "\r" })), 30)
    console.log(`${BLUE}  → ${truncate(trimmed, 60)}${R}`)
  })
}
