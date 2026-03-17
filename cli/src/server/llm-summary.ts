import { spawn } from "node:child_process"
import { log } from "../shared/logger.js"

type SummaryProvider = "claude" | "openai" | "gemini"
type SummaryLocale = "zh-TW" | "ja" | "ko" | "en"

export interface LlmSummaryOptions {
  locale?: string
  agentId?: string
}

const TIMEOUT_MS = 20_000
const MAX_INPUT_CHARS = 12_000
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const FE_RE = /\x1b[@-Z\\-_]/g
const CHARSET_RE = /\x1b[()][0-9A-B]/g
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g

function findEnvKey(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]
    if (value) return value
  }
  return null
}

function normalizeLocale(locale?: string): SummaryLocale {
  const value = (locale || "").toLowerCase()
  if (value.startsWith("zh")) return "zh-TW"
  if (value.startsWith("ja")) return "ja"
  if (value.startsWith("ko")) return "ko"
  return "en"
}

function sanitizeActivityLog(text: string): string {
  return text
    .replace(ANSI_RE, "")
    .replace(OSC_RE, "")
    .replace(FE_RE, "")
    .replace(CHARSET_RE, "")
    .replace(CONTROL_RE, "")
    .split(/\r?\n/)
    .filter((line) => !/^__AGENTRUNE_[A-Z0-9_]+\b/.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function trimForModel(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text
  return text.slice(-MAX_INPUT_CHARS)
}

function getLocaleInstructions(locale: SummaryLocale): string {
  if (locale === "zh-TW") {
    return "請用繁體中文輸出。產品名、模型名、API 欄位名和必要引用可保留原文，不要硬翻。"
  }
  if (locale === "ja") {
    return "Return the report in Japanese. Keep product names, model names, API field names, and direct quotes in their original form when needed."
  }
  if (locale === "ko") {
    return "Return the report in Korean. Keep product names, model names, API field names, and direct quotes in their original form when needed."
  }
  return "Return the report in English. Keep product names, model names, API field names, and direct quotes in their original form when needed."
}

function getSectionLabels(locale: SummaryLocale) {
  if (locale === "zh-TW") {
    return {
      summary: "摘要",
      actions: "做了哪些事",
      results: "結果如何",
      issues: "問題與風險",
      decisions: "需要你決策",
    }
  }

  if (locale === "ja") {
    return {
      summary: "要約",
      actions: "実施内容",
      results: "結果",
      issues: "課題とリスク",
      decisions: "判断が必要",
    }
  }

  if (locale === "ko") {
    return {
      summary: "요약",
      actions: "수행 내용",
      results: "결과",
      issues: "문제와 리스크",
      decisions: "결정 필요",
    }
  }

  return {
    summary: "Summary",
    actions: "What Happened",
    results: "Outcome",
    issues: "Issues & Risks",
    decisions: "Decision Needed",
  }
}

export function buildSummaryPrompt(locale?: string): string {
  const normalized = normalizeLocale(locale)
  const labels = getSectionLabels(normalized)

  return [
    "Rewrite the automation execution output into a short, user-facing markdown report.",
    getLocaleInstructions(normalized),
    "Requirements:",
    `- Use GitHub-flavored markdown with short sections like: ## ${labels.summary}, ## ${labels.actions}, ## ${labels.results}, ## ${labels.issues}, ## ${labels.decisions}. Omit empty sections.`,
    "- Keep it concise: around 120-220 words.",
    "- Remove shell noise, ANSI junk, duplicated lines, internal markers, and machine-only chatter.",
    "- Preserve factual details like post IDs, error codes, retry timing, and file paths when they matter.",
    "- If the run failed or was skipped, say so plainly.",
    "- Do not mention that you are summarizing or that you are an AI.",
  ].join("\n")
}

export function resolveSummaryProviders(agentId?: string): SummaryProvider[] {
  const normalized = (agentId || "").toLowerCase()
  if (normalized === "gemini") return ["gemini", "claude", "openai"]
  if (normalized === "claude" || normalized === "cline") return ["claude", "openai", "gemini"]
  if (normalized === "codex" || normalized === "cursor" || normalized === "openai") {
    return ["openai", "claude", "gemini"]
  }
  return ["openai", "claude", "gemini"]
}

export function shouldUseLlmSummary(text: string): boolean {
  const cleaned = sanitizeActivityLog(text)
  if (!cleaned) return false
  if (cleaned.length >= 220) return true
  const lineCount = cleaned.split(/\r?\n/).filter(Boolean).length
  return lineCount >= 4 || /---\s*AgentRune\b/i.test(cleaned)
}

function runCliSummary(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM")
      } catch {
        // ignore
      }
    }, TIMEOUT_MS)

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
    child.on("error", (err) => {
      clearTimeout(timer)
      reject(new Error(`${command}: ${err.message}`))
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      const output = stdout.trim()
      if (code !== 0) return reject(new Error(`${command} exit ${code}: ${stderr.slice(0, 200)}`))
      if (!output) return reject(new Error(`${command}: empty output`))
      resolve(output)
    })

    child.stdin.write(input)
    child.stdin.end()
  })
}

async function callClaudeCli(prompt: string, text: string): Promise<string> {
  return runCliSummary("claude", ["-p", "--model", "haiku"], `${prompt}\n\n${text}`)
}

async function callGemini(apiKey: string, prompt: string, text: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${prompt}\n\n${text}` }] }],
          generationConfig: { maxOutputTokens: 1024 },
        }),
        signal: controller.signal,
      },
    )

    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ""
  } finally {
    clearTimeout(timer)
  }
}

async function callAnthropic(apiKey: string, prompt: string, text: string): Promise<string> {
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
        system: prompt,
        messages: [{ role: "user", content: text }],
      }),
      signal: controller.signal,
    })

    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    return data.content?.[0]?.text?.trim() || ""
  } finally {
    clearTimeout(timer)
  }
}

async function callOpenAI(apiKey: string, prompt: string, text: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1024,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: text },
        ],
      }),
      signal: controller.signal,
    })

    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
    const data = await res.json() as any
    return data.choices?.[0]?.message?.content?.trim() || ""
  } finally {
    clearTimeout(timer)
  }
}

async function callProvider(provider: SummaryProvider, prompt: string, text: string): Promise<string | null> {
  if (provider === "claude") {
    try {
      const cliResult = await callClaudeCli(prompt, text)
      if (cliResult.trim()) {
        log.info("LLM summary: Claude Haiku via CLI")
        return cliResult.trim()
      }
    } catch (err: any) {
      log.warn(`LLM summary Claude CLI failed: ${err.message}`)
    }

    const anthropicKey = findEnvKey("ANTHROPIC_API_KEY")
    if (anthropicKey && !anthropicKey.includes("...")) {
      try {
        const apiResult = await callAnthropic(anthropicKey, prompt, text)
        if (apiResult.trim()) {
          log.info("LLM summary: Claude Haiku via API")
          return apiResult.trim()
        }
      } catch (err: any) {
        log.warn(`LLM summary Anthropic failed: ${err.message}`)
      }
    }
  }

  if (provider === "openai") {
    const openaiKey = findEnvKey("OPENAI_API_KEY")
    if (openaiKey) {
      try {
        const result = await callOpenAI(openaiKey, prompt, text)
        if (result.trim()) {
          log.info("LLM summary: OpenAI Mini")
          return result.trim()
        }
      } catch (err: any) {
        log.warn(`LLM summary OpenAI failed: ${err.message}`)
      }
    }
  }

  if (provider === "gemini") {
    const geminiKey = findEnvKey("GEMINI_API_KEY", "GOOGLE_API_KEY")
    if (geminiKey) {
      try {
        const result = await callGemini(geminiKey, prompt, text)
        if (result.trim()) {
          log.info("LLM summary: Gemini Flash")
          return result.trim()
        }
      } catch (err: any) {
        log.warn(`LLM summary Gemini failed: ${err.message}`)
      }
    }
  }

  return null
}

export async function callLlmForSummary(
  activityLog: string,
  options: LlmSummaryOptions = {},
): Promise<string | null> {
  const cleaned = trimForModel(sanitizeActivityLog(activityLog))
  if (!cleaned) return null

  const prompt = buildSummaryPrompt(options.locale)
  const orderedProviders = resolveSummaryProviders(options.agentId)
  const tried: SummaryProvider[] = []

  for (const provider of orderedProviders) {
    if (tried.includes(provider)) continue
    tried.push(provider)

    const result = await callProvider(provider, prompt, cleaned)
    if (result) return result
  }

  log.warn("LLM summary: no working lightweight provider available")
  return null
}
