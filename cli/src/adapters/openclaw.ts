// adapters/openclaw.ts
// OpenClaw adapter -- supports BOTH PTY mode (openclaw chat) AND API mode (Gateway WebSocket).
//
// PTY mode: user runs `openclaw chat` in terminal, adapter parses stdout
// API mode: connects directly to OpenClaw Gateway via WebSocket (ws://host:18789)
//
// Gateway protocol (from docs.openclaw.ai/gateway/protocol):
//   Connect: client sends { type:"req", method:"connect", params:{role,scopes,auth} }
//   Chat:    client sends { type:"req", method:"chat.send", params:{sessionKey,message} }
//   Events:  server pushes { type:"event", event:"agent", data:{type,content,...} }
//   Approvals: server pushes { type:"event", event:"exec.approval.requested", data:{...} }
//
// The API adapter is exposed as openclawApiConnect() for use by the session manager.
// The PTY adapter is the default AgentAdapter export for parse-engine compatibility.
import type { AgentAdapter } from "./types.js"
import type { AgentEvent, ParseContext } from "../shared/types.js"
import { makeEventId } from "./types.js"
import WebSocket from "ws"

// --- PTY Adapter (for `openclaw chat` in terminal) ---

interface OpenClawState {
  lastSkillTime: number
  lastErrorTime: number
  lastCompletionTime: number
}

function getState(ctx: ParseContext): OpenClawState {
  if (!(ctx as any)._openclawState) {
    (ctx as any)._openclawState = {
      lastSkillTime: 0,
      lastErrorTime: 0,
      lastCompletionTime: 0,
    }
  }
  return (ctx as any)._openclawState
}

export const openclawAdapter: AgentAdapter = {
  id: "openclaw",
  name: "OpenClaw",
  icon: ">_",
  capabilities: ["command_run", "decision_request", "info", "error"],

  parse(chunk: string, ctx: ParseContext): AgentEvent[] {
    const events: AgentEvent[] = []
    const now = Date.now()
    const state = getState(ctx)
    const lines = chunk.split("\n")

    for (const line of lines) {
      const trimmed = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim()
      if (!trimmed) continue

      // Skill/tool execution: "Running skill: ...", "Executing tool: ..."
      const skillMatch = trimmed.match(/(?:Running|Executing|Using)\s+(?:skill|tool)[:\s]+[`"]?([^\s`"\n]+)[`"]?/i)
      if (skillMatch && now - state.lastSkillTime > 2000) {
        state.lastSkillTime = now
        events.push({
          id: makeEventId(), timestamp: now,
          type: "command_run", status: "in_progress",
          title: `Running: ${skillMatch[1]}`,
          raw: trimmed,
        })
        continue
      }

      // File operations
      const fileMatch = trimmed.match(/(?:Writing|Creating|Editing|Updating)\s+(?:file:?\s*)?[`"]?([^\s`"]+)[`"]?/i)
      if (fileMatch) {
        const isCreate = /creating/i.test(trimmed)
        events.push({
          id: makeEventId(), timestamp: now,
          type: isCreate ? "file_create" : "file_edit",
          status: "in_progress",
          title: `${isCreate ? "Creating" : "Editing"} ${fileMatch[1]}`,
          detail: fileMatch[1],
        })
        continue
      }

      // Task/skill completion
      if (/(?:completed|done|finished|success)/i.test(trimmed) && /(?:task|skill|action|tool)/i.test(trimmed)) {
        if (now - state.lastCompletionTime > 3000) {
          state.lastCompletionTime = now
          events.push({
            id: makeEventId(), timestamp: now,
            type: "info", status: "completed",
            title: trimmed.slice(0, 80),
            detail: trimmed.length > 80 ? trimmed.slice(0, 200) : undefined,
          })
        }
        continue
      }

      // Confirmation prompts: [Y/n], (y/N), proceed?, confirm
      if (/\[Y\/n\]|\(y\/N\)|confirm|proceed\?|approve/i.test(trimmed)) {
        events.push({
          id: makeEventId(), timestamp: now,
          type: "decision_request", status: "waiting",
          title: "Confirmation needed",
          detail: trimmed.slice(0, 200),
          decision: {
            options: [
              { label: "Yes", input: "y\n", style: "primary" },
              { label: "No", input: "n\n", style: "danger" },
            ],
          },
        })
        continue
      }

      // Error patterns
      if (/(?:error|failed|exception|fatal)/i.test(trimmed) && !/test/i.test(trimmed)) {
        if (now - state.lastErrorTime > 5000) {
          state.lastErrorTime = now
          events.push({
            id: makeEventId(), timestamp: now,
            type: "error", status: "failed",
            title: trimmed.slice(0, 80),
            detail: trimmed.slice(0, 200),
            raw: trimmed,
          })
        }
        continue
      }
    }

    return events
  },

  detectIdle(buffer: string): boolean {
    const lastLine = buffer.split("\n").filter(Boolean).pop()?.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim() || ""
    return /[>$%]\s*$/.test(lastLine) || /openclaw>/i.test(lastLine) || /^>\s*$/.test(lastLine)
  },
}

// --- API Adapter (Gateway WebSocket) ---

export interface OpenClawApiConfig {
  gatewayUrl: string    // e.g. "ws://127.0.0.1:18789"
  token?: string        // OPENCLAW_GATEWAY_TOKEN
  sessionKey?: string   // e.g. "agent:main:agentgune:default"
}

export interface OpenClawApiConnection {
  send(message: string): void
  close(): void
  onEvent(handler: (event: AgentEvent) => void): void
}

/**
 * Connect to OpenClaw Gateway via WebSocket API.
 * Returns a connection object that emits AgentEvent[].
 *
 * Usage:
 *   const conn = await openclawApiConnect({ gatewayUrl: "ws://127.0.0.1:18789", token: "..." })
 *   conn.onEvent((event) => { // handle event })
 *   conn.send("Hello, what files should I edit?")
 *   conn.close()
 */
export function openclawApiConnect(config: OpenClawApiConfig): Promise<OpenClawApiConnection> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(config.gatewayUrl)
    let reqId = 1
    let connected = false
    let eventHandler: ((event: AgentEvent) => void) | null = null

    ws.on("error", (err) => {
      if (!connected) reject(err)
    })

    ws.on("open", () => {
      // Wait for connect.challenge from server, then respond
    })

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString())

        // Step 1: Server sends connect.challenge
        if (msg.type === "event" && msg.event === "connect.challenge") {
          ws.send(JSON.stringify({
            type: "req",
            id: String(reqId++),
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              role: "operator",
              scopes: ["operator.read", "operator.write"],
              auth: config.token ? { token: config.token } : undefined,
              device: {
                id: `agentrune_${Date.now()}`,
              },
            },
          }))
          return
        }

        // Step 2: Server confirms connection
        if (msg.type === "res" && msg.ok === true && !connected) {
          connected = true
          resolve(connection)
          return
        }

        // Step 3: Handle ongoing events
        if (msg.type === "event" && eventHandler) {
          const event = parseGatewayEvent(msg)
          if (event) eventHandler(event)
        }
      } catch { /* ignore parse errors */ }
    })

    ws.on("close", () => {
      if (!connected) reject(new Error("Gateway connection closed before handshake"))
    })

    const connection: OpenClawApiConnection = {
      send(message: string) {
        if (!connected) return
        ws.send(JSON.stringify({
          type: "req",
          id: String(reqId++),
          method: "chat.send",
          params: {
            sessionKey: config.sessionKey || "agent:main:agentrune:default",
            message,
          },
        }))
      },
      close() {
        ws.close()
      },
      onEvent(handler: (event: AgentEvent) => void) {
        eventHandler = handler
      },
    }
  })
}

/** Convert Gateway EventFrame to AgentEvent */
function parseGatewayEvent(msg: any): AgentEvent | null {
  const data = msg.data || msg.payload || {}
  const now = Date.now()

  // Agent streaming response
  if (msg.event === "agent") {
    if (data.type === "stream" || data.type === "partial") {
      // Streaming text -- accumulate, don't emit individual events
      return null
    }
    if (data.type === "complete" || data.type === "final") {
      const content = data.content || data.text || ""
      if (!content) return null
      return {
        id: makeEventId(), timestamp: now,
        type: "info", status: "completed",
        title: content.slice(0, 80),
        detail: content.length > 80 ? content.slice(0, 500) : undefined,
      }
    }
    if (data.type === "tool_call" || data.type === "tool") {
      const toolName = data.tool || data.name || "unknown"
      const toolInput = data.input || data.params || ""
      const inputStr = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput).slice(0, 100)
      // Map tool names to event types
      if (/write|edit|create|replace/i.test(toolName)) {
        return {
          id: makeEventId(), timestamp: now,
          type: "file_edit", status: "in_progress",
          title: `${toolName}: ${inputStr.slice(0, 50)}`,
          detail: inputStr,
        }
      }
      if (/exec|command|shell|run/i.test(toolName)) {
        return {
          id: makeEventId(), timestamp: now,
          type: "command_run", status: "in_progress",
          title: `Running: ${inputStr.slice(0, 50)}`,
          detail: inputStr,
        }
      }
      return {
        id: makeEventId(), timestamp: now,
        type: "info", status: "in_progress",
        title: `Tool: ${toolName}`,
        detail: inputStr,
      }
    }
    if (data.type === "error") {
      return {
        id: makeEventId(), timestamp: now,
        type: "error", status: "failed",
        title: (data.message || data.content || "Error").slice(0, 80),
        detail: data.message || data.content,
      }
    }
  }

  // Exec approval request
  if (msg.event === "exec.approval.requested") {
    const command = data.command || data.tool || "unknown command"
    return {
      id: makeEventId(), timestamp: now,
      type: "decision_request", status: "waiting",
      title: `Approve: ${typeof command === "string" ? command.slice(0, 60) : "command"}`,
      detail: typeof command === "string" ? command : JSON.stringify(command).slice(0, 200),
      decision: {
        options: [
          { label: "Approve", input: "approve", style: "primary" },
          { label: "Deny", input: "deny", style: "danger" },
        ],
      },
    }
  }

  return null
}
