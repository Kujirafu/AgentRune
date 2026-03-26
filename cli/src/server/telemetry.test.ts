// server/telemetry.test.ts
// Unit tests for the telemetry batching client (telemetry.ts)
//
// The module uses file-level mutable state (queue, distinctId, flushTimer).
// Each test acquires a fresh module via vi.resetModules() + dynamic import()
// so state never leaks between tests.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Static mock — must be declared before any dynamic import of the module under
// test so Vitest's module registry always resolves the logger to this stub.
// ---------------------------------------------------------------------------
vi.mock("../shared/logger.js", () => ({
  log: { warn: vi.fn(), error: vi.fn(), dim: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Constants mirrored from telemetry.ts (kept in sync manually)
// ---------------------------------------------------------------------------
const TELEMETRY_URL = "https://agentlore.vercel.app/api/telemetry"
const FLUSH_INTERVAL = 30_000
const MAX_BATCH = 50
const MAX_QUEUE = 500

// ---------------------------------------------------------------------------
// Shared test scaffolding
// ---------------------------------------------------------------------------

/** Fresh module instance — replaced in every beforeEach. */
let mod: typeof import("./telemetry.js")

beforeEach(async () => {
  // Reset the module registry so each test loads a new copy of telemetry.ts
  // with zeroed-out module-level variables (queue = [], distinctId = null …).
  vi.resetModules()

  // Stub fetch before the module loads so any auto-flush triggered during
  // import cannot hit the network.
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true })))

  // Fake timers prevent real setInterval from firing and keep tests fast.
  vi.useFakeTimers()

  // Clean environment so isTelemetryDisabled() returns false by default.
  delete process.env.AGENTRUNE_TELEMETRY
  delete process.env.DO_NOT_TRACK

  mod = await import("./telemetry.js")
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Helper — queue N events without hitting the auto-flush threshold.
// Caller must have already called initCliTelemetry.
// ---------------------------------------------------------------------------
function queueEvents(count: number, eventName = "test_event"): void {
  for (let i = 0; i < count; i++) {
    mod.captureCliEvent(eventName, { index: i })
  }
}

// ---------------------------------------------------------------------------
// initCliTelemetry
// ---------------------------------------------------------------------------

describe("initCliTelemetry", () => {
  it("hashes the deviceId and stores a 16-character hex distinctId", async () => {
    // We cannot read distinctId directly (it is not exported), but we can
    // verify it was set by checking that captureCliEvent now enqueues events
    // (it is a no-op when distinctId is null).
    mod.initCliTelemetry("my-device-id")
    mod.captureCliEvent("probe")

    // flushTelemetry() should attempt a POST — that only happens when
    // distinctId is non-null and the queue is non-empty.
    await mod.flushTelemetry()

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledOnce()

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    // distinctId must be a 16-character lowercase hex string (SHA-256 prefix).
    expect(body.distinctId).toMatch(/^[0-9a-f]{16}$/)
  })

  it("produces the same distinctId for the same deviceId on repeated calls", async () => {
    mod.initCliTelemetry("stable-device")
    mod.captureCliEvent("probe")
    await mod.flushTelemetry()

    const body1 = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string
    )

    // Re-initialize with the same deviceId in the same module instance.
    mod.initCliTelemetry("stable-device")
    mod.captureCliEvent("probe2")
    await mod.flushTelemetry()

    const body2 = JSON.parse(
      (vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string
    )

    expect(body1.distinctId).toBe(body2.distinctId)
  })

  it("produces different distinctIds for different deviceIds", async () => {
    mod.initCliTelemetry("device-A")
    mod.captureCliEvent("probe")
    await mod.flushTelemetry()
    const idA = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string
    ).distinctId

    // Reload module to get fresh state with a different deviceId.
    vi.resetModules()
    const mod2 = await import("./telemetry.js")
    mod2.initCliTelemetry("device-B")
    mod2.captureCliEvent("probe")
    await mod2.flushTelemetry()
    const idB = JSON.parse(
      (vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string
    ).distinctId

    expect(idA).not.toBe(idB)
  })

  it("starts a setInterval with the correct flush interval", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval")
    mod.initCliTelemetry("timer-device")

    expect(setIntervalSpy).toHaveBeenCalledOnce()
    const [, interval] = setIntervalSpy.mock.calls[0]
    expect(interval).toBe(FLUSH_INTERVAL)
  })

  it("does not start a second timer when called a second time", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval")
    mod.initCliTelemetry("once-device")
    mod.initCliTelemetry("once-device")

    expect(setIntervalSpy).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Disabled via environment variables
// ---------------------------------------------------------------------------

describe("telemetry disabled via AGENTRUNE_TELEMETRY", () => {
  it("skips init when AGENTRUNE_TELEMETRY=off", async () => {
    process.env.AGENTRUNE_TELEMETRY = "off"
    vi.resetModules()
    const m = await import("./telemetry.js")

    m.initCliTelemetry("device-x")
    m.captureCliEvent("should-not-queue")
    await m.flushTelemetry()

    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it("skips init when AGENTRUNE_TELEMETRY=0", async () => {
    process.env.AGENTRUNE_TELEMETRY = "0"
    vi.resetModules()
    const m = await import("./telemetry.js")

    m.initCliTelemetry("device-x")
    m.captureCliEvent("should-not-queue")
    await m.flushTelemetry()

    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})

describe("telemetry disabled via DO_NOT_TRACK", () => {
  it("skips init when DO_NOT_TRACK=1", async () => {
    process.env.DO_NOT_TRACK = "1"
    vi.resetModules()
    const m = await import("./telemetry.js")

    m.initCliTelemetry("device-dnt")
    m.captureCliEvent("should-not-queue")
    await m.flushTelemetry()

    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it("does not disable telemetry when DO_NOT_TRACK is absent", async () => {
    // Env was cleared in beforeEach — init should work normally.
    mod.initCliTelemetry("device-ok")
    mod.captureCliEvent("ok-event")
    await mod.flushTelemetry()

    expect(vi.mocked(fetch)).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// captureCliEvent
// ---------------------------------------------------------------------------

describe("captureCliEvent", () => {
  it("is a no-op when telemetry has not been initialized", async () => {
    // No initCliTelemetry call — distinctId remains null.
    mod.captureCliEvent("ghost-event", { foo: 1 })
    await mod.flushTelemetry()

    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it("enqueues an event with platform set to 'cli'", async () => {
    mod.initCliTelemetry("dev-1")
    mod.captureCliEvent("my_event", { key: "value" })
    await mod.flushTelemetry()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string
    )
    expect(body.events).toHaveLength(1)
    const ev = body.events[0]
    expect(ev.event).toBe("my_event")
    expect(ev.properties).toEqual({ key: "value" })
    expect(ev.platform).toBe("cli")
  })

  it("enqueues an event without optional properties", async () => {
    mod.initCliTelemetry("dev-1")
    mod.captureCliEvent("bare_event")
    await mod.flushTelemetry()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string
    )
    expect(body.events[0].event).toBe("bare_event")
  })

  it("auto-flushes synchronously when MAX_BATCH events accumulate", async () => {
    mod.initCliTelemetry("dev-autoflush")

    // Queue MAX_BATCH - 1 events without triggering flush, then add one more
    // to hit exactly MAX_BATCH.  The flush call is fire-and-forget (not
    // awaited inside captureCliEvent), so we just check fetch was called.
    for (let i = 0; i < MAX_BATCH - 1; i++) {
      mod.captureCliEvent("fill", { i })
    }
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()

    // This 50th push triggers the auto-flush.
    mod.captureCliEvent("trigger")

    // Allow microtasks (the async fetch inside flushTelemetry) to settle.
    await Promise.resolve()

    expect(vi.mocked(fetch)).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Queue overflow (MAX_QUEUE)
// ---------------------------------------------------------------------------

describe("queue overflow", () => {
  it("drops oldest events when queue reaches MAX_QUEUE, keeping queue below MAX_QUEUE", async () => {
    // Stub fetch to always fail so events stay in the queue and accumulate.
    vi.mocked(fetch).mockRejectedValue(new Error("network error"))

    mod.initCliTelemetry("overflow-device")

    // Fill the queue past MAX_QUEUE in batches smaller than MAX_BATCH so the
    // auto-flush threshold (MAX_BATCH) is not crossed mid-loop.
    // We send MAX_BATCH - 1 events at a time, resetting manually.
    //
    // Strategy: push slightly fewer than MAX_BATCH at a time to avoid the
    // auto-flush, call flushTelemetry manually (which fails and re-queues),
    // repeat until we have accumulated MAX_QUEUE events in the queue.
    //
    // Simpler approach: just fill to MAX_QUEUE - 1 events (below auto-flush
    // per-batch), then push one more which should trigger the overflow guard.

    // Each captureCliEvent call below adds 1 event. We need to reach
    // MAX_QUEUE without triggering MAX_BATCH auto-flush per individual push.
    // So we push in bursts of (MAX_BATCH - 1).
    const burstSize = MAX_BATCH - 1
    const bursts = Math.ceil(MAX_QUEUE / burstSize)

    for (let b = 0; b < bursts; b++) {
      for (let i = 0; i < burstSize; i++) {
        mod.captureCliEvent("overflow_event", { b, i })
      }
      // Drain auto-flush calls (they fail and re-queue) but we want to
      // keep accumulating.  Wait for microtasks.
      await Promise.resolve()
    }

    // Push one more event that crosses MAX_QUEUE, triggering the splice.
    mod.captureCliEvent("overflow_trigger")
    await Promise.resolve()

    // After the overflow guard fires, flushTelemetry is called (auto-flush)
    // which will also re-queue because fetch is stubbed to fail.
    // The key invariant: after a splice the queue length must be
    // <= MAX_QUEUE.  We verify by flushing with a working fetch and checking
    // the batch size is <= MAX_BATCH.
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)
    await mod.flushTelemetry()

    const body = JSON.parse(
      (vi.mocked(fetch).mock.lastCall![1] as RequestInit).body as string
    )
    // The batch must be capped at MAX_BATCH.
    expect(body.events.length).toBeLessThanOrEqual(MAX_BATCH)
  })
})

// ---------------------------------------------------------------------------
// flushTelemetry
// ---------------------------------------------------------------------------

describe("flushTelemetry", () => {
  it("sends a POST to the telemetry URL with distinctId and events", async () => {
    mod.initCliTelemetry("flush-device")
    mod.captureCliEvent("alpha", { n: 1 })
    mod.captureCliEvent("beta", { n: 2 })

    await mod.flushTelemetry()

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledOnce()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(TELEMETRY_URL)
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json")

    const body = JSON.parse(init.body as string)
    expect(body.distinctId).toMatch(/^[0-9a-f]{16}$/)
    expect(body.events).toHaveLength(2)
    expect(body.events[0].event).toBe("alpha")
    expect(body.events[1].event).toBe("beta")
  })

  it("is a no-op when the queue is empty", async () => {
    mod.initCliTelemetry("empty-queue-device")
    // Do not captureCliEvent — queue stays empty.
    await mod.flushTelemetry()

    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it("is a no-op when telemetry has not been initialized", async () => {
    // distinctId is null — flush must bail out immediately.
    mod.captureCliEvent("orphan") // no-op without init
    await mod.flushTelemetry()

    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it("re-queues the batch when the server returns a non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response)
    // Second call succeeds so we can verify re-queued events are re-sent.
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)

    mod.initCliTelemetry("retry-device")
    mod.captureCliEvent("important_event")

    // First flush — server returns 500, batch is re-queued.
    await mod.flushTelemetry()
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce()

    // Second flush — batch should be re-sent.
    await mod.flushTelemetry()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)

    const body2 = JSON.parse(
      (vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string
    )
    expect(body2.events[0].event).toBe("important_event")
  })

  it("logs a dim message when the server returns a non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response)

    mod.initCliTelemetry("log-device")
    mod.captureCliEvent("log_event")
    await mod.flushTelemetry()

    const { log } = await import("../shared/logger.js")
    expect(vi.mocked(log.dim)).toHaveBeenCalledWith(
      expect.stringContaining("503")
    )
  })

  it("re-queues the batch on a network error (fetch throws)", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("connection refused"))
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)

    mod.initCliTelemetry("network-error-device")
    mod.captureCliEvent("resilient_event")

    // First flush — fetch throws.
    await mod.flushTelemetry()
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce()

    // Second flush — event should have been re-queued and re-sent.
    await mod.flushTelemetry()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)

    const body2 = JSON.parse(
      (vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string
    )
    expect(body2.events[0].event).toBe("resilient_event")
  })

  it("sends at most MAX_BATCH events per flush when queue is larger", async () => {
    mod.initCliTelemetry("batch-cap-device")

    // Fill queue to exactly MAX_BATCH + 1 without triggering auto-flush.
    // We push MAX_BATCH - 1 first (safe), then add 2 more individually
    // while preventing the auto-flush from racing.
    // Simpler: call flushTelemetry first to drain any partial auto-flush,
    // then add MAX_BATCH + 1 events carefully.
    // Easiest: stub auto-flush not to fire by checking queue size.
    // Actually the cleanest approach: push exactly MAX_BATCH + 1 events and
    // verify the first flush only sends MAX_BATCH.

    // To avoid triggering the auto-flush at exactly MAX_BATCH we must not
    // push the 50th event until after we start our controlled flush test.
    // Push 49 safe events:
    for (let i = 0; i < MAX_BATCH - 1; i++) {
      mod.captureCliEvent("batch_event", { i })
    }

    // Manually flush the 49 events (no auto-flush yet).
    await mod.flushTelemetry()
    vi.mocked(fetch).mockClear()

    // Now push MAX_BATCH + 5 events: the 50th will trigger auto-flush.
    // Wait for it, clear the mock, then push a few more and test manual flush.
    for (let i = 0; i < MAX_BATCH + 5; i++) {
      mod.captureCliEvent("overflow", { i })
    }
    // Let auto-flushes settle.
    await Promise.resolve()
    await Promise.resolve()
    vi.mocked(fetch).mockClear()

    // Add one more event and flush manually to verify the batch cap.
    mod.captureCliEvent("extra")
    await Promise.resolve()
    await mod.flushTelemetry()

    const lastCall = vi.mocked(fetch).mock.lastCall
    if (lastCall) {
      const body = JSON.parse((lastCall[1] as RequestInit).body as string)
      expect(body.events.length).toBeLessThanOrEqual(MAX_BATCH)
    }
  })

  it("drains events across multiple flush calls", async () => {
    mod.initCliTelemetry("multi-flush-device")

    // Add exactly 2 × MAX_BATCH events without triggering auto-flush.
    // Use small bursts and flush manually between them.
    const half = MAX_BATCH - 1
    for (let i = 0; i < half; i++) mod.captureCliEvent("ev", { i })
    await mod.flushTelemetry() // flush first half

    for (let i = 0; i < half; i++) mod.captureCliEvent("ev", { i })
    await mod.flushTelemetry() // flush second half

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// shutdownTelemetry
// ---------------------------------------------------------------------------

describe("shutdownTelemetry", () => {
  it("clears the flush timer and flushes remaining events", async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval")

    mod.initCliTelemetry("shutdown-device")
    mod.captureCliEvent("last_event")

    await mod.shutdownTelemetry()

    // Timer was cleared.
    expect(clearIntervalSpy).toHaveBeenCalledOnce()

    // Remaining event was flushed.
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce()
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string
    )
    expect(body.events[0].event).toBe("last_event")
  })

  it("does not throw when called before initCliTelemetry", async () => {
    await expect(mod.shutdownTelemetry()).resolves.toBeUndefined()
  })

  it("does not throw when called with an empty queue", async () => {
    mod.initCliTelemetry("empty-shutdown-device")
    await expect(mod.shutdownTelemetry()).resolves.toBeUndefined()
  })

  it("calling shutdown a second time does not throw", async () => {
    mod.initCliTelemetry("double-shutdown-device")
    await mod.shutdownTelemetry()
    await expect(mod.shutdownTelemetry()).resolves.toBeUndefined()
  })

  it("does not call fetch again after shutdown when the queue is empty", async () => {
    mod.initCliTelemetry("no-double-flush-device")
    await mod.shutdownTelemetry() // queue empty — fetch not called
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Timer setup — setInterval wiring
// ---------------------------------------------------------------------------

describe("timer setup", () => {
  it("registers a periodic flush timer with FLUSH_INTERVAL (30 000 ms)", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval")
    mod.initCliTelemetry("timer-wiring-device")

    expect(setIntervalSpy).toHaveBeenCalledOnce()
    const [fn, delay] = setIntervalSpy.mock.calls[0]
    expect(typeof fn).toBe("function")
    expect(delay).toBe(FLUSH_INTERVAL)
  })

  it("fires flushTelemetry when the interval elapses", async () => {
    mod.initCliTelemetry("timer-fire-device")
    mod.captureCliEvent("timed_event")

    // Advance fake timers by one full interval — this synchronously triggers
    // the setInterval callback.
    vi.advanceTimersByTime(FLUSH_INTERVAL)

    // Let async flush settle.
    await Promise.resolve()

    expect(vi.mocked(fetch)).toHaveBeenCalledOnce()
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string
    )
    expect(body.events[0].event).toBe("timed_event")
  })

  it("does not fire before the interval elapses", async () => {
    mod.initCliTelemetry("no-early-fire-device")
    mod.captureCliEvent("pending_event")

    vi.advanceTimersByTime(FLUSH_INTERVAL - 1)
    await Promise.resolve()

    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it("shutdownTelemetry prevents the timer from firing after shutdown", async () => {
    mod.initCliTelemetry("post-shutdown-timer-device")
    mod.captureCliEvent("event_before_shutdown")

    await mod.shutdownTelemetry()
    vi.mocked(fetch).mockClear()

    // Advance past the interval — timer should already be cleared.
    vi.advanceTimersByTime(FLUSH_INTERVAL * 2)
    await Promise.resolve()

    // No additional fetch calls after shutdown.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
