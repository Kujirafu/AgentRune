import { KNOWN_AGENT_IDS, MODEL_NAMES } from "../types"

const AGENT_TOKEN_RE = />([a-zA-Z][\w-]*)/g

const agentSet = new Set(KNOWN_AGENT_IDS)
const modelSet = new Set<string>(MODEL_NAMES)

export interface AgentParseResult {
  agents: string[]
  models: string[]
  unknowns: string[]
  cleanedText: string
}

export function extractAgentTokens(text: string): AgentParseResult {
  const agents: string[] = []
  const models: string[] = []
  const unknowns: string[] = []

  let cleaned = text.replace(AGENT_TOKEN_RE, (_, token) => {
    const lower = token.toLowerCase()
    if (agentSet.has(lower)) {
      if (!agents.includes(lower)) agents.push(lower)
    } else if (modelSet.has(lower)) {
      if (!models.includes(lower)) models.push(lower)
    } else {
      if (!unknowns.includes(lower)) unknowns.push(lower)
    }
    return ""
  })

  cleaned = cleaned.replace(/\s{2,}/g, " ").trim()

  return { agents, models, unknowns, cleanedText: cleaned }
}

/** Get all known >tokens for autocomplete */
export function getAgentCompletions(): { value: string; type: "agent" | "model" }[] {
  return [
    ...KNOWN_AGENT_IDS.map(id => ({ value: id, type: "agent" as const })),
    ...MODEL_NAMES.map(m => ({ value: m, type: "model" as const })),
  ]
}
