import type { AppSession, RoutingRule } from "../types"
import type { SessionDecisionDigest } from "./session-summary"
import { extractAgentTokens } from "./agent-parser"

export interface RoutedInstruction {
  sessionId: string | null   // null = launch new session
  instruction: string
  matchScore: number
  matchReason: string        // why this session was chosen (for UI feedback)
}

// ─── Compound command splitting ───────────────────────────
// Splits "fix the login bug and then update the docs" into two instructions
const SPLIT_MARKERS = /(?:，然後|然後|；另外|另外|；再|；|; ?and then|; ?also|; ?then|;|，同時|同時|，接著|接著|，再)/gi

export function splitCompoundCommand(text: string): string[] {
  const parts = text.split(SPLIT_MARKERS)
    .map(p => p.trim())
    .filter(p => p.length > 0)
  // If nothing was split, return the whole thing
  return parts.length > 0 ? parts : [text.trim()]
}

// ─── Keyword extraction ───────────────────────────────────
// Simple: split on whitespace/punctuation, remove stop words, lowercase
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been",
  "do", "does", "did", "will", "would", "could", "should", "can",
  "have", "has", "had", "this", "that", "these", "those",
  "i", "you", "we", "it", "they", "my", "your", "our",
  "to", "of", "in", "on", "at", "for", "with", "from", "by",
  "and", "or", "but", "not", "no", "so", "if", "then",
  "just", "also", "please", "help", "want", "need",
  // Chinese stop words
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人",
  "都", "一", "一個", "上", "也", "很", "到", "說", "要", "去",
  "你", "會", "著", "沒有", "看", "好", "把", "那", "這", "他",
  "她", "它", "讓", "幫", "幫我", "請", "可以", "可不可以",
])

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.:;!?，。：；！？、\-_/\\()\[\]{}'"]+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w))
}

// ─── Context matching ─────────────────────────────────────
// Score how well a command matches a session's context
function scoreMatch(
  commandKeywords: string[],
  digest: SessionDecisionDigest,
  events?: { title?: string; detail?: string }[],
): { score: number; reason: string } {
  if (commandKeywords.length === 0) return { score: 0, reason: "" }

  // Build session context keywords from: summary + nextAction + recent event titles
  const contextParts: string[] = []
  if (digest.summary) contextParts.push(digest.summary)
  if (digest.nextAction) contextParts.push(digest.nextAction)
  if (digest.displayLabel) contextParts.push(digest.displayLabel)
  if (events) {
    // Last 10 event titles
    for (const e of events.slice(-10)) {
      if (e.title) contextParts.push(e.title)
      if (e.detail) contextParts.push(e.detail.slice(0, 200))
    }
  }

  const contextText = contextParts.join(" ")
  const contextKeywords = new Set(extractKeywords(contextText))
  if (contextKeywords.size === 0) return { score: 0, reason: "" }

  // Count overlapping keywords
  const matches: string[] = []
  for (const kw of commandKeywords) {
    // Exact match
    if (contextKeywords.has(kw)) {
      matches.push(kw)
      continue
    }
    // Substring match (e.g. "login" matches "login-page") — require min 4 chars to avoid false positives
    if (kw.length >= 4) {
      for (const ck of contextKeywords) {
        if (ck.length >= 4 && (ck.includes(kw) || kw.includes(ck))) {
          matches.push(kw)
          break
        }
      }
    }
  }

  const score = matches.length / commandKeywords.length
  const reason = matches.length > 0
    ? matches.slice(0, 3).join(", ")
    : ""

  return { score, reason }
}

// ─── Route a single instruction to the best session ───────
const MIN_MATCH_SCORE = 0.25  // At least 25% keyword overlap to consider a match

function findBestSession(
  instruction: string,
  sessions: AppSession[],
  digests: Map<string, SessionDecisionDigest>,
  sessionEvents: Map<string, { title?: string; detail?: string }[]>,
): RoutedInstruction {
  const keywords = extractKeywords(instruction)

  let bestSession: AppSession | null = null
  let bestScore = 0
  let bestReason = ""

  for (const s of sessions) {
    const d = digests.get(s.id)
    if (!d) continue
    // Skip completed sessions — don't send new work to done sessions
    if (d.status === "done") continue

    const events = sessionEvents.get(s.id) || []
    const { score, reason } = scoreMatch(keywords, d, events)

    if (score > bestScore) {
      bestScore = score
      bestSession = s
      bestReason = reason
    }
  }

  if (bestSession && bestScore >= MIN_MATCH_SCORE) {
    return {
      sessionId: bestSession.id,
      instruction,
      matchScore: bestScore,
      matchReason: bestReason,
    }
  }

  return {
    sessionId: null,
    instruction,
    matchScore: 0,
    matchReason: "",
  }
}

// ─── Main entry: route a full command (possibly compound) ─
export function routeCommand(
  command: string,
  sessions: AppSession[],
  digests: Map<string, SessionDecisionDigest>,
  sessionEvents: Map<string, { title?: string; detail?: string }[]>,
): RoutedInstruction[] {
  const instructions = splitCompoundCommand(command)
  return instructions.map(inst =>
    findBestSession(inst, sessions, digests, sessionEvents)
  )
}

// ─── Rule-based routing ──

export function matchRoutingRules(
  command: string,
  rules: RoutingRule[],
): { agentId: string; matchedKeyword: string } | null {
  const cmdLower = command.toLowerCase()
  const cmdWords = cmdLower.split(/[\s,;:!?]+/).filter(w => w.length >= 2)
  for (const rule of rules) {
    if (!rule.enabled) continue
    for (const keyword of rule.keywords) {
      const kw = keyword.toLowerCase().trim()
      if (!kw) continue
      if (cmdWords.includes(kw) || (kw.length >= 4 && cmdLower.includes(kw))) {
        return { agentId: rule.agentId, matchedKeyword: kw }
      }
    }
  }
  return null
}

// ─── Enhanced routing: extracts >agent tokens per segment ──
export interface EnhancedRoutedInstruction extends RoutedInstruction {
  agents: string[]
  models: string[]
}

export function routeCommandEnhanced(
  command: string,
  sessions: AppSession[],
  digests: Map<string, SessionDecisionDigest>,
  sessionEvents: Map<string, { title?: string; detail?: string }[]>,
  routingRules?: RoutingRule[],
): EnhancedRoutedInstruction[] {
  const segments = splitCompoundCommand(command)

  return segments.map(segment => {
    const { agents, models, cleanedText } = extractAgentTokens(segment)

    // If an explicit agent was specified, try to match to a session running that agent
    if (agents.length > 0) {
      const agentId = agents[0]
      const matchingSession = sessions.find(s => {
        const d = digests.get(s.id)
        return s.agentId === agentId && d?.status !== "done"
      })
      if (matchingSession) {
        return {
          sessionId: matchingSession.id,
          instruction: cleanedText,
          matchScore: 1,
          matchReason: `>${agentId}`,
          agents,
          models,
        }
      }
      // No running session for that agent — signal launch new
      return {
        sessionId: null,
        instruction: cleanedText,
        matchScore: 0,
        matchReason: `>${agentId} (new)`,
        agents,
        models,
      }
    }

    // Rule-based routing (after explicit >agent, before fuzzy match)
    if (routingRules && routingRules.length > 0) {
      const ruleMatch = matchRoutingRules(cleanedText, routingRules)
      if (ruleMatch) {
        const matchingSession = sessions.find(s => {
          const d = digests.get(s.id)
          return s.agentId === ruleMatch.agentId && d?.status !== "done"
        })
        return {
          sessionId: matchingSession?.id || null,
          instruction: cleanedText,
          matchScore: 0.8,
          matchReason: `rule: "${ruleMatch.matchedKeyword}" → ${ruleMatch.agentId}`,
          agents: [ruleMatch.agentId],
          models,
        }
      }
    }

    // No explicit agent — fall back to keyword matching
    const routed = findBestSession(cleanedText, sessions, digests, sessionEvents)
    return { ...routed, agents, models }
  })
}
