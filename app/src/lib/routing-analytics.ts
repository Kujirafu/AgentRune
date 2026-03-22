const MAX_EVENTS = 100
const MAX_LEARNED = 200

export interface RoutingEvent {
  command: string
  proposedSessionId: string | null
  actualSessionId: string | null
  wasOverridden: boolean
  timestamp?: number
}

export class RoutingAnalytics {
  private events: RoutingEvent[] = []
  private learnedRoutes = new Map<string, Map<string, number>>()

  record(event: RoutingEvent) {
    this.events.push({ ...event, timestamp: event.timestamp || Date.now() })
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS)
    }
    this.learnFromOverride(event)
  }

  getEvents(): RoutingEvent[] {
    return [...this.events]
  }

  getMisroutes(): RoutingEvent[] {
    return this.events.filter(e => e.wasOverridden)
  }

  getAccuracyRate(): number {
    if (this.events.length === 0) return 1
    const correct = this.events.filter(e => !e.wasOverridden).length
    return correct / this.events.length
  }

  getTopMisroutePatterns(): { command: string; count: number }[] {
    const counts = new Map<string, number>()
    for (const e of this.getMisroutes()) {
      const key = e.command.toLowerCase().trim().slice(0, 100)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
  }

  /** Get learned suggestion for a command, or null if no learning yet */
  getSuggestion(command: string): string | null {
    const key = this.normalizeCommand(command)
    const routes = this.learnedRoutes.get(key)
    if (!routes || routes.size === 0) return null
    let best = ""
    let bestCount = 0
    for (const [sid, count] of routes) {
      if (count > bestCount) { best = sid; bestCount = count }
    }
    return best || null
  }

  private learnFromOverride(event: RoutingEvent) {
    if (!event.wasOverridden || !event.actualSessionId) return
    const key = this.normalizeCommand(event.command)
    if (!this.learnedRoutes.has(key)) {
      // Evict oldest if at capacity
      if (this.learnedRoutes.size >= MAX_LEARNED) {
        const firstKey = this.learnedRoutes.keys().next().value
        if (firstKey) this.learnedRoutes.delete(firstKey)
      }
      this.learnedRoutes.set(key, new Map())
    }
    const routes = this.learnedRoutes.get(key)!
    routes.set(event.actualSessionId, (routes.get(event.actualSessionId) || 0) + 1)
  }

  private normalizeCommand(text: string): string {
    return text.replace(/>([a-zA-Z][\w-]*)/g, "").toLowerCase().trim().replace(/\s+/g, " ").slice(0, 100)
  }

  save() {
    const data = {
      events: this.events.slice(-MAX_EVENTS),
      learned: Object.fromEntries(
        Array.from(this.learnedRoutes.entries()).map(([k, v]) => [k, Object.fromEntries(v)])
      ),
    }
    try { localStorage.setItem("agentrune_routing_analytics", JSON.stringify(data)) } catch (e) { console.warn("[RoutingAnalytics] save failed:", e) }
  }

  static load(): RoutingAnalytics {
    const a = new RoutingAnalytics()
    try {
      const raw = localStorage.getItem("agentrune_routing_analytics")
      if (raw) {
        const data = JSON.parse(raw)
        a.events = data.events || []
        if (data.learned) {
          for (const [k, v] of Object.entries(data.learned)) {
            a.learnedRoutes.set(k, new Map(Object.entries(v as Record<string, number>)))
          }
        }
      }
    } catch {}
    return a
  }
}
