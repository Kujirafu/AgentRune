// voice-cleanup.ts
// Cleans up raw voice transcription using the cheapest model for the user's agent platform.
// Uses raw fetch — no SDK dependencies needed.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { log } from "../shared/logger.js"

const CLEANUP_PROMPT = `You are a voice-to-text editor for a SOFTWARE DEVELOPMENT tool. The user is a programmer dictating instructions to an AI coding agent. The raw transcript is messy — full of repetitions, filler words, and fragmented thoughts. Your job is to UNDERSTAND what the user is trying to say and rewrite it clearly.

DO:
- Understand the overall message and restructure it into clear, logical prose
- Merge duplicated/repeated ideas into one coherent statement
- Remove all filler words and false starts (嗯、那個、就是、然後、對、um、like)
- When the user lists items using sequential markers (第一/第二/第三、首先/其次/再來/最後、first/second/then/finally), format as a numbered list with line breaks
- **FIX speech-to-text misrecognitions** using surrounding context. STT often confuses similar-sounding words. Use the full sentence meaning to correct them. Examples:
  - "拍攝腳本" near "hello world" → user meant "Python 腳本" (script)
  - "害肉" → "hi world", "害Rose/害肉絲" → "hello world" (misheard English)
  - "一個函式庫" misheard as "一個含式庫" → correct to "函式庫"
  - "API" misheard as "a P I" or "a pie" → correct to "API"
- **Remove self-corrections and meta-commentary.** When the user corrects themselves mid-speech, keep ONLY the corrected version:
  - "不是X，是Y" → keep only Y
  - "我剛才說錯了，應該是Z" → keep only Z
  - "就是那個…我的意思是…" → extract the actual intent
  - The user is dictating a message TO an AI agent — strip any words addressed at the voice system itself
- Keep technical terms precise (code, API names, file paths, etc.)
- The text has already been converted to Traditional Chinese. Do NOT change the script. Keep 繁體字 as 繁體字. Keep English as English.

DO NOT:
- Add content the user didn't say
- Change the user's intent or opinion
- "Correct" words the user deliberately chose (e.g. "hi" stays "hi", don't change to "hello"; "cool" stays "cool", don't change to "great")
- Add explanations or meta-commentary
- Wrap output in quotes
- Respond conversationally (do NOT say "I'm ready to help", "Here's the cleaned text", etc.)
- Return an empty response — if the input is unclear, return your best interpretation

CRITICAL: You are a text filter, NOT a chatbot. Output ONLY the cleaned text. No greetings, no preamble, no explanation.`

interface CleanupResult {
  original: string
  cleaned: string
  model: string
  provider?: string    // which provider actually handled it
  fallback?: boolean   // true if not the agent's native provider
}

// Agent ID → { envKey, apiCall }
const PROVIDERS: Record<string, {
  envKeys: string[]
  call: (apiKey: string, text: string) => Promise<{ cleaned: string; model: string }>
}> = {
  claude: {
    envKeys: ["ANTHROPIC_API_KEY"],
    call: async (apiKey, text) => {
      const model = "claude-haiku-4-5-20251001"
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000) // 15s timeout
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            system: CLEANUP_PROMPT,
            messages: [{ role: "user", content: text }],
          }),
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
        const data = await res.json() as any
        return { cleaned: data.content[0].text.trim(), model }
      } catch (e: any) {
        clearTimeout(timer)
        throw e
      }
    },
  },
  codex: {
    envKeys: ["OPENAI_API_KEY"],
    call: async (apiKey, text) => {
      const model = "gpt-4o-mini"
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            messages: [
              { role: "system", content: CLEANUP_PROMPT },
              { role: "user", content: text },
            ],
          }),
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
        const data = await res.json() as any
        return { cleaned: data.choices[0].message.content.trim(), model }
      } catch (e: any) { clearTimeout(timer); throw e }
    },
  },
  gemini: {
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    call: async (apiKey, text) => {
      const model = "gemini-2.0-flash"
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${CLEANUP_PROMPT}\n\nRaw transcription:\n${text}` }] }],
              generationConfig: { maxOutputTokens: 1024 },
            }),
            signal: controller.signal,
          },
        )
        clearTimeout(timer)
        if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
        const data = await res.json() as any
        return { cleaned: data.candidates[0].content.parts[0].text.trim(), model }
      } catch (e: any) { clearTimeout(timer); throw e }
    },
  },
}

// Aider/Cline/OpenClaw → try OpenAI first, then Anthropic, then Gemini
PROVIDERS.aider = PROVIDERS.codex
PROVIDERS.cline = PROVIDERS.codex
PROVIDERS.openclaw = PROVIDERS.codex

function findApiKey(envKeys: string[]): string | null {
  for (const key of envKeys) {
    if (process.env[key]) return process.env[key]!
  }
  return null
}

// Read agent OAuth tokens from their credential files
const HOME = process.env.HOME || process.env.USERPROFILE || ""

function readJsonSafe(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf-8")) } catch { return null }
}

// Returns ordered list of OAuth tokens that can actually work as API keys
// NOTE: Gemini CLI OAuth tokens go through Code Assist (internal proxy), NOT the public API.
//       They cannot be used with generativelanguage.googleapis.com. Only Claude and Codex tokens work.
function getUsableOAuthTokens(agentId: string): { provider: string; token: string }[] {
  const claudeCreds = readJsonSafe(join(HOME, ".claude", ".credentials.json"))
  const claudeToken = claudeCreds?.claudeAiOauth?.accessToken as string | undefined
  const codexCreds = readJsonSafe(join(HOME, ".codex", "auth.json"))
  const codexToken = codexCreds?.tokens?.access_token as string | undefined

  const all: { provider: string; token: string }[] = []
  const add = (p: string, t?: string) => { if (t) all.push({ provider: p, token: t }) }

  // Agent-preferred first, then fallbacks
  if (agentId === "claude") { add("claude", claudeToken); add("codex", codexToken) }
  else if (agentId === "codex" || agentId === "aider" || agentId === "cline" || agentId === "openclaw") {
    add("codex", codexToken); add("claude", claudeToken)
  }
  else { add("claude", claudeToken); add("codex", codexToken) }
  // Gemini users: no usable OAuth token, will try Claude/Codex as fallback

  return all
}

// Detect if the LLM responded conversationally instead of cleaning the text
function isConversationalResponse(original: string, cleaned: string): boolean {
  const lower = cleaned.toLowerCase()
  // Check for chatbot-like patterns
  if (/^(i'm |i am |i need |i can't |i cannot |here'?s |sure|unfortunately|could you|please provide)/i.test(cleaned)) return true
  if (/\?$/.test(cleaned.trim()) && !original.includes("?") && !original.includes("？")) return true
  // If cleaned is 3x+ longer than original, LLM probably added its own content
  if (cleaned.length > original.length * 3 && original.length < 50) return true
  return false
}

export async function cleanupVoiceText(text: string, agentId: string): Promise<CleanupResult> {
  const trimmed = text.trim()
  if (!trimmed) return { original: text, cleaned: "", model: "none" }

  // Resolve the canonical provider for this agent
  const canonicalProvider = (agentId === "aider" || agentId === "cline" || agentId === "openclaw") ? "codex" : agentId

  // Helper: validate cleanup result (reject conversational LLM responses)
  const validate = (cleaned: string): string => {
    if (isConversationalResponse(trimmed, cleaned)) {
      log.warn(`Voice cleanup rejected conversational response: "${cleaned.slice(0, 80)}..."`)
      return trimmed
    }
    return cleaned
  }

  // 1. Try env var API keys — agent's preferred provider first
  const preferred = PROVIDERS[agentId]
  if (preferred) {
    const key = findApiKey(preferred.envKeys)
    if (key) {
      try {
        const result = await preferred.call(key, trimmed)
        result.cleaned = validate(result.cleaned)
        log.info(`Voice cleanup: ${agentId} → ${result.model}`)
        return { original: text, ...result, provider: canonicalProvider, fallback: false }
      } catch (e: any) {
        log.warn(`Voice cleanup failed (${agentId}): ${e.message}`)
      }
    }
  }

  // 2. Try env var API keys — fallback providers
  const fallbackOrder = ["claude", "codex", "gemini"]
  for (const id of fallbackOrder) {
    if (id === canonicalProvider) continue
    const provider = PROVIDERS[id]
    const key = findApiKey(provider.envKeys)
    if (key) {
      try {
        const result = await provider.call(key, trimmed)
        result.cleaned = validate(result.cleaned)
        log.info(`Voice cleanup fallback: ${id} → ${result.model} (agent: ${agentId})`)
        return { original: text, ...result, provider: id, fallback: true }
      } catch (e: any) {
        log.warn(`Voice cleanup fallback failed (${id}): ${e.message}`)
      }
    }
  }

  // 3. Try OAuth tokens from local agent config files
  //    Only Claude and Codex OAuth tokens can be used as API keys directly.
  //    Gemini CLI OAuth goes through Code Assist (internal proxy) — not usable.
  const oauthCandidates = getUsableOAuthTokens(agentId)
  for (const oauth of oauthCandidates) {
    try {
      const result = await PROVIDERS[oauth.provider].call(oauth.token, trimmed)
      result.cleaned = validate(result.cleaned)
      const isFallback = oauth.provider !== canonicalProvider
      log.info(`Voice cleanup via ${oauth.provider} OAuth → ${result.model}${isFallback ? ` (fallback for ${agentId})` : ""}`)
      return { original: text, ...result, provider: oauth.provider, fallback: isFallback }
    } catch (e: any) {
      log.warn(`Voice cleanup ${oauth.provider} OAuth failed: ${e.message}`)
    }
  }

  // No API available — return raw text
  log.warn(`Voice cleanup: no working API for agent "${agentId}", returning raw text`)
  return { original: text, cleaned: trimmed, model: "none", provider: "none", fallback: false }
}

// --- Voice Edit: apply a voice instruction to modify existing text ---

const EDIT_PROMPT = `You are a text editor. You receive an ORIGINAL text and an EDIT INSTRUCTION (spoken by the user via voice). Apply the instruction to modify the original text and output ONLY the modified result.

Rules:
- Apply the edit instruction precisely — change only what the user asked
- Keep everything else unchanged
- The instruction may be in any language (繁體中文, English, mixed)
- Output ONLY the modified text, no explanation, no preamble
- If the instruction is unclear, make your best guess and apply it
- Do NOT wrap output in quotes
- Do NOT say "Here is the modified text" — just output it directly`

export async function applyVoiceEdit(original: string, instruction: string): Promise<string> {
  const prompt = `ORIGINAL TEXT:\n${original}\n\nEDIT INSTRUCTION:\n${instruction}`

  // Try OAuth tokens (same logic as cleanup)
  const oauthCandidates = getUsableOAuthTokens("claude")
  for (const oauth of oauthCandidates) {
    const provider = PROVIDERS[oauth.provider]
    if (!provider) continue
    try {
      // Override the system prompt for edit mode
      const model = oauth.provider === "claude" ? "claude-haiku-4-5-20251001" : "gpt-4o-mini"
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20000)
      let result: string

      if (oauth.provider === "claude") {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": oauth.token,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 2048,
            system: EDIT_PROMPT,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (!res.ok) throw new Error(`Anthropic ${res.status}`)
        const data = await res.json() as any
        result = data.content[0].text.trim()
      } else {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${oauth.token}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: 2048,
            messages: [
              { role: "system", content: EDIT_PROMPT },
              { role: "user", content: prompt },
            ],
          }),
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (!res.ok) throw new Error(`OpenAI ${res.status}`)
        const data = await res.json() as any
        result = data.choices[0].message.content.trim()
      }

      // Reject conversational responses — return original text instead
      if (isConversationalResponse(original, result)) {
        log.warn(`Voice edit rejected conversational response: "${result.slice(0, 80)}..."`)
        continue
      }
      log.info(`Voice edit via ${oauth.provider} OAuth → ${model}`)
      return result
    } catch (e: any) {
      log.warn(`Voice edit ${oauth.provider} failed: ${e.message}`)
    }
  }

  // Fallback: try env var API keys (with EDIT_PROMPT, not CLEANUP_PROMPT)
  const fallbackOrder2 = ["claude", "codex", "gemini"] as const
  for (const id of fallbackOrder2) {
    const provider = PROVIDERS[id]
    if (!provider) continue
    const key = findApiKey(provider.envKeys)
    if (!key) continue
    try {
      const model = id === "claude" ? "claude-haiku-4-5-20251001" : id === "codex" ? "gpt-4o-mini" : "gemini-2.0-flash"
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20000)
      let result: string

      if (id === "claude") {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, max_tokens: 2048, system: EDIT_PROMPT, messages: [{ role: "user", content: prompt }] }),
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (!res.ok) throw new Error(`Anthropic ${res.status}`)
        const data = await res.json() as any
        result = data.content[0].text.trim()
      } else if (id === "codex") {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", "authorization": `Bearer ${key}` },
          body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: "system", content: EDIT_PROMPT }, { role: "user", content: prompt }] }),
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (!res.ok) throw new Error(`OpenAI ${res.status}`)
        const data = await res.json() as any
        result = data.choices[0].message.content.trim()
      } else {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: `${EDIT_PROMPT}\n\n${prompt}` }] }], generationConfig: { maxOutputTokens: 2048 } }),
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (!res.ok) throw new Error(`Gemini ${res.status}`)
        const data = await res.json() as any
        result = data.candidates[0].content.parts[0].text.trim()
      }

      // Reject conversational responses — return original text instead
      if (isConversationalResponse(original, result)) {
        log.warn(`Voice edit rejected conversational response: "${result.slice(0, 80)}..."`)
        continue
      }
      log.info(`Voice edit via ${id} API key → ${model}`)
      return result
    } catch (e: any) {
      log.warn(`Voice edit ${id} failed: ${e.message}`)
    }
  }

  log.warn("Voice edit: no working API, returning original")
  return original
}
