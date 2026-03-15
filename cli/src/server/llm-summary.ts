// llm-summary.ts
// Calls an LLM to summarize agent activity logs.
// Priority: claude CLI (uses user's subscription) → Gemini → Anthropic API → OpenAI API

import { readFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { log } from "../shared/logger.js"

const SUMMARY_PROMPT = `你是 AI agent 活動摘要工具。你的任務是摘要 agent 的活動記錄。

規則：
- 必須用繁體中文回覆（Traditional Chinese），即使活動記錄是英文
- 3-5 個重點，用「・」開頭
- 聚焦：完成了什麼、關鍵改動、遇到的錯誤
- 只輸出摘要文字，不要加標題、不要解釋、不要用 markdown 格式
- 如果記錄太少（只有 session started 之類），回覆「尚無有意義的活動」`

const TIMEOUT_MS = 30_000

const HOME = process.env.HOME || process.env.USERPROFILE || ""

function findEnvKey(...keys: string[]): string | null {
  for (const k of keys) {
    if (process.env[k]) return process.env[k]!
  }
  return null
}

// --- Claude CLI (uses user's own subscription, free) ---

async function callClaudeCli(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = `${SUMMARY_PROMPT}\n\n${text}`
    const child = spawn("claude", ["-p", "--model", "haiku"], {
      timeout: TIMEOUT_MS,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
    child.on("error", (err) => reject(new Error(`claude CLI: ${err.message}`)))
    child.on("close", (code) => {
      const output = stdout.trim()
      if (code !== 0) return reject(new Error(`claude CLI exit ${code}: ${stderr.slice(0, 200)}`))
      if (!output) return reject(new Error("claude CLI: empty output"))
      resolve(output)
    })
    child.stdin.write(input)
    child.stdin.end()
  })
}

// --- API call helpers ---

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

async function callClaude(apiKey: string, text: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
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

// --- Main export ---

export async function callLlmForSummary(activityLog: string): Promise<string | null> {
  const trimmed = activityLog.trim()
  if (!trimmed) return null

  // 1. Claude CLI (uses user's own subscription, no API key needed)
  try {
    const result = await callClaudeCli(trimmed)
    log.info("LLM summary: claude CLI (Haiku)")
    return result
  } catch (e: any) {
    log.warn(`LLM summary claude CLI failed: ${e.message}`)
  }

  // 2. Gemini (free tier)
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

  // 3. Anthropic API key (skip placeholders)
  const anthropicKey = findEnvKey("ANTHROPIC_API_KEY")
  if (anthropicKey && !anthropicKey.includes("...")) {
    try {
      const result = await callClaude(anthropicKey, trimmed)
      log.info("LLM summary: Anthropic API key (Haiku)")
      return result
    } catch (e: any) {
      log.warn(`LLM summary Anthropic failed: ${e.message}`)
    }
  }

  // 4. OpenAI API key
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

  log.warn("LLM summary: no working API available")
  return null
}
