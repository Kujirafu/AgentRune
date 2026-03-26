import type { AgentEvent } from "../types"

const GENERIC_AGENT_RESPONSE_TITLE_RE = /^(?:Claude|Codex|Cursor|Gemini|Aider) responded(?: \(detailed\))?$/i
const STATUS_VERB_RE = /\b(?:Vibing|Galloping|Beboppin|Ionizing|Saut[ée]ing|Crunching|Orchestrating|Brewing|Moonwalking)\b/gi
const STATUS_NOISE_RE = /(?:thinking with max effort|thought for \d+s|bypass permissions on|shift\+tab to cycle|current:\s*\d+\.\d+\.\d+|latest:\s*\d+\.\d+\.\d+|\/btw to ask a quick side question|interrupting Claude's current work)/i
const ANSI_ESCAPE_RE = /\u001b\[[0-9;?]*[a-zA-Z]/

function normalizeWhitespace(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim()
}

export function isGenericAgentResponseTitle(value?: string): boolean {
  return GENERIC_AGENT_RESPONSE_TITLE_RE.test(normalizeWhitespace(value))
}

export function isNoisyFallbackResponseEvent(
  event: Pick<AgentEvent, "type" | "title" | "detail" | "raw">,
): boolean {
  if (event.type !== "info" || !isGenericAgentResponseTitle(event.title)) return false

  const detail = event.detail || ""
  const raw = event.raw || ""
  const combined = `${detail}\n${raw}`.trim()
  if (!combined) return false

  const statusVerbHits = (combined.match(STATUS_VERB_RE) || []).length
  const maxEffortHits = (combined.match(/thinking with max effort/gi) || []).length

  if (ANSI_ESCAPE_RE.test(combined)) return true
  if (statusVerbHits >= 2) return true
  if (maxEffortHits >= 2) return true
  if (statusVerbHits >= 1 && STATUS_NOISE_RE.test(combined)) return true
  if (maxEffortHits >= 1 && /\btokens?\b/i.test(combined)) return true
  if (/\btokens?\b/i.test(combined) && /(?:bypass permissions on|current:|latest:)/i.test(combined)) return true

  return false
}
