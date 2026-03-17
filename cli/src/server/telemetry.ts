// server/telemetry.ts
// Lightweight telemetry client — batches events and sends to AgentLore
import { createHash } from "node:crypto"
import { log } from "../shared/logger.js"

const TELEMETRY_URL = "https://agentlore.vercel.app/api/telemetry"
const FLUSH_INTERVAL = 30_000 // 30s
const MAX_BATCH = 50
const MAX_QUEUE = 500

interface TelemetryEvent {
  event: string
  properties?: Record<string, unknown>
  platform: string
}

let queue: TelemetryEvent[] = []
let distinctId: string | null = null
let flushTimer: ReturnType<typeof setInterval> | null = null

/** Check if telemetry is disabled via env vars */
function isTelemetryDisabled(): boolean {
  if (process.env.AGENTRUNE_TELEMETRY === "off" || process.env.AGENTRUNE_TELEMETRY === "0") return true
  if (process.env.DO_NOT_TRACK === "1") return true
  return false
}

/** Initialize telemetry with a deviceId (hashed before use as distinctId) */
export function initCliTelemetry(deviceId: string) {
  if (isTelemetryDisabled()) return
  // Hash deviceId so telemetry server cannot correlate with AgentLore device record
  distinctId = createHash("sha256").update(deviceId).digest("hex").slice(0, 16)
  if (!flushTimer) {
    flushTimer = setInterval(flushTelemetry, FLUSH_INTERVAL)
    // Don't let the timer keep the process alive
    if (flushTimer && typeof flushTimer === "object" && "unref" in flushTimer) {
      flushTimer.unref()
    }
  }
}

/** Queue a telemetry event (always platform: "cli") */
export function captureCliEvent(event: string, properties?: Record<string, unknown>) {
  if (!distinctId) return
  // Drop oldest events if queue grows too large (e.g. flush endpoint unreachable)
  if (queue.length >= MAX_QUEUE) {
    queue.splice(0, queue.length - MAX_QUEUE + MAX_BATCH)
  }
  queue.push({ event, properties, platform: "cli" })
  if (queue.length >= MAX_BATCH) {
    flushTelemetry()
  }
}

/** Flush queued events to AgentLore */
export async function flushTelemetry(): Promise<void> {
  if (!distinctId || queue.length === 0) return
  const batch = queue.splice(0, MAX_BATCH)
  try {
    const res = await fetch(TELEMETRY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ distinctId, events: batch }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      log.dim(`[Telemetry] flush failed: ${res.status}`)
      queue.unshift(...batch) // re-queue for next flush attempt
    }
  } catch {
    queue.unshift(...batch) // re-queue on network failure
  }
}

/** Shutdown: flush remaining events */
export async function shutdownTelemetry(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  await flushTelemetry()
}
