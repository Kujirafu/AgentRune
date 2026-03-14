// llm-summary.ts
// Calls an LLM to summarize agent activity logs.
// Reuses the same multi-provider fallback pattern as voice-cleanup.ts.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { log } from "../shared/logger.js"

const SUMMARY_PROMPT = `你是 AI agent 活動摘要工具。你的任務是摘要 agent 的活動記錄。

規則：
- 必須用繁體中文回覆（Traditional Chinese），即使活動記錄是英文
- 3-5 個重點，用「・」開頭
- 聚焦：完成了什麼、關鍵改動、遇到的錯誤
- 只輸出摘要文字，不要加標題、不要解釋、不要用 markdown 格式
- 如果記錄太少（只有 session started 之類），回覆「尚無有意義的活動」`

const TIMEOUT_MS = 15_000

const HOME = process.env.HOME || process.env.USERPROFILE || ""

function readJsonSafe(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf-8")) } catch { return null }
}

function findEnvKey(...keys: string[]): string | null {
  for (const k of keys) {
    if (process.env[k]) return process.env[k]!
  }
  return null
}

// --- Provider call helpers ---

async function callClaude(apiKey: string, text: string, useBearer = false): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const authHeader = useBearer
      ? { "authorization": `Bearer ${apiKey}` }
      : { "x-api-key": apiKey }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeader,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SUMMARY_PROMPT,
        messages: [{ role: "user", content: text }],
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    return data.content[0].text.trim()
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

async function callOpenAI(apiKey: string, text: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1024,
        messages: [
          { role: "system", content: SUMMARY_PROMPT },
          { role: "user", content: text },
        ],
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    return data.choices[0].message.content.trim()
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

async function callGemini(apiKey: string, text: string): Promise<string> {
  const model = "gemini-2.0-flash"
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${SUMMARY_PROMPT}\n\n${text}` }] }],
          generationConfig: { maxOutputTokens: 1024 },
        }),
        signal: controller.signal,
      },
    )
    clearTimeout(timer)
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    return data.candidates[0].content.parts[0].text.trim()
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

// --- Main export ---

export async function callLlmForSummary(activityLog: string): Promise<string | null> {
  const trimmed = activityLog.trim()
  if (!trimmed) return null

  // 1. Try env var API keys: Anthropic → OpenAI → Gemini
  const anthropicKey = findEnvKey("ANTHROPIC_API_KEY")
  if (anthropicKey) {
    try {
      const result = await callClaude(anthropicKey, trimmed)
      log.info("LLM summary: Anthropic API key (Haiku)")
      return result
    } catch (e: any) {
      log.warn(`LLM summary Anthropic failed: ${e.message}`)
    }
  }

  const openaiKey = findEnvKey("OPENAI_API_KEY")
  if (openaiKey) {
    try {
      const result = await callOpenAI(openaiKey, trimmed)
      log.info("LLM summary: OpenAI API key (gpt-4o-mini)")
      return result
    } catch (e: any) {
      log.warn(`LLM summary OpenAI failed: ${e.message}`)
    }
  }

  const geminiKey = findEnvKey("GEMINI_API_KEY", "GOOGLE_API_KEY")
  if (geminiKey) {
    try {
      const result = await callGemini(geminiKey, trimmed)
      log.info("LLM summary: Gemini API key (flash)")
      return result
    } catch (e: any) {
      log.warn(`LLM summary Gemini failed: ${e.message}`)
    }
  }

  // 2. Try OAuth tokens from local credential files
  //    Claude OAuth (~/.claude/.credentials.json) and Codex OAuth (~/.codex/auth.json)
  //    Gemini OAuth goes through internal proxy — not usable with public API.
  const claudeCreds = readJsonSafe(join(HOME, ".claude", ".credentials.json"))
  const claudeToken = claudeCreds?.claudeAiOauth?.accessToken as string | undefined
  if (claudeToken) {
    try {
      const result = await callClaude(claudeToken, trimmed, true)
      log.info("LLM summary: Claude OAuth (Haiku)")
      return result
    } catch (e: any) {
      log.warn(`LLM summary Claude OAuth failed: ${e.message}`)
    }
  }

  const codexCreds = readJsonSafe(join(HOME, ".codex", "auth.json"))
  const codexToken = codexCreds?.tokens?.access_token as string | undefined
  if (codexToken) {
    try {
      const result = await callOpenAI(codexToken, trimmed)
      log.info("LLM summary: Codex OAuth (gpt-4o-mini)")
      return result
    } catch (e: any) {
      log.warn(`LLM summary Codex OAuth failed: ${e.message}`)
    }
  }

  log.warn("LLM summary: no working API available")
  return null
}
