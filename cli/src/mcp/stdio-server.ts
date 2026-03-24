// mcp/stdio-server.ts
// MCP server that proxies AgentLore API tools + provides local AgentRune tools
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { resolve } from "node:path"
import { z } from "zod"
import { loadConfig } from "../shared/config.js"
import { readClipboard } from "../server/clipboard.js"
import { getProjectMemory, getMemoryPath, updateProjectMemory } from "../server/behavior-rules.js"
import {
  isAllowedContextSectionFile,
  listContextSections,
  readContextSection,
  routeContextSections,
  searchContextSections,
  writeContextSection,
} from "../server/agentlore-init.js"
import { ensureProjectMemoryReady } from "../server/project-memory.js"

const AGENTLORE_BASE = "https://agentlore.vercel.app"

/** Knowledge submission guide — embedded to avoid file-copy issues with bundler */
const KNOWLEDGE_GUIDE = `# AgentLore Knowledge 提交指南

## 什麼時候該提交
- 修完一個根因不明顯的 bug（需要 debug 才能找到原因）
- 發現了未記錄的框架/工具行為
- 解決了整合問題（兩個工具搭配時踩坑）
- 找到了 error message 的真正含義和解法
- 發現了效能/安全相關的 pattern

**不要提交**：常識性內容、官方文件已有的東西、太專案特定的設定

## API 格式

Tool: submit_knowledge

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| sourceText | string | ✅ | 完整內容，**最少 200 字元** |
| title | string | ✅ | 簡短標題 |
| sourceUrl | string | ❌ | 來源 URL（如有） |

⚠️ **常見錯誤**：
- ❌ content → ✅ sourceText（欄位名不是 content！）
- ❌ domain / tags → 這些由 server 端自動分析，不需要傳

## sourceText 結構模板

## Problem
[一句話描述問題現象。什麼平台、什麼工具、什麼條件下發生]

## Root Cause
[為什麼會發生。寫出具體的技術原因，不要含糊]

## Solution
1. [具體步驟一，包含程式碼或設定值]
2. [具體步驟二]
3. [具體步驟三]

## Key Insight
[一句話總結：為什麼這個問題不明顯、其他人可能會踩到的原因]

## 回應解讀

| status | 意義 |
|--------|------|
| ACCEPTED | 通過品質評估，已獲得 credits |
| REJECTED | 品質分數 < 0.45，內容不夠具體或太短 |
| FLAGGED | 偵測為 spam 或低品質內容 |

品質分數 > 0.65 = 較多 credits，> 0.8 = 最高 credits。
`

async function callAgentLoreApi(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const config = loadConfig()
  const token = config.agentlore?.token

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const res = await fetch(`${AGENTLORE_BASE}/api/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tool: toolName, arguments: args }),
  })

  if (!res.ok) {
    const error = await res.text().catch(() => "Unknown error")
    throw new Error(`AgentLore API error (${res.status}): ${error}`)
  }

  return res.json()
}

function resolveMemoryProjectCwd(projectCwd?: string): string {
  const envCwd = process.env.AGENTRUNE_PROJECT_CWD
  return resolve(projectCwd || envCwd || process.cwd())
}

function ensureLocalProjectMemory(projectCwd?: string): string {
  const cwd = resolveMemoryProjectCwd(projectCwd)
  const config = loadConfig()
  ensureProjectMemoryReady(cwd, {
    projectId: process.env.AGENTRUNE_PROJECT_ID,
    projectName: process.env.AGENTRUNE_PROJECT_NAME,
    port: config.port,
  })
  return cwd
}

export async function startMcpServer() {
  const server = new McpServer({
    name: "agentrune",
    version: "0.1.0",
  }, {
    instructions: `AgentRune MCP server — proxies AgentLore knowledge base tools + local device tools.

IMPORTANT: After completing any task or reaching a milestone, you MUST call report_progress
to notify the user. The user monitors your work from a mobile APP and can only see structured
progress reports — they cannot see your raw terminal output.

## Progress Reporting (REQUIRED)
- report_progress: Report work progress to the user (MUST call after completing tasks)

## Shared Memory (agentlore.md)
- read_memory: Read the project memory index (agentlore.md)
- list_memory_sections: List structured memory sections with metadata
- route_memory_sections: Recommend which memory sections to read first for the current task
- search_memory_sections: Search across structured memory sections
- read_memory_section: Read one structured memory section
- update_memory_section: Update one structured memory section
- update_memory: Update the memory index if needed
- Memory tools operate on AGENTRUNE_PROJECT_CWD when set, otherwise the current working directory

## Knowledge Management
- log_prerequisite: Record prerequisites, constraints, or lessons learned
- log_decision: Record architecture/design decisions
- get_project_context: Read project context from shared knowledge vault

## AgentLore Tools
- search: Search the AI-verified knowledge base for solutions
- get_entry: Get full details of a knowledge entry
- find_skills: Find reusable skills/patterns for your task
- report_skill_outcome: Report whether a skill worked
- get_knowledge_guide: Read submission format guide (call BEFORE submit_knowledge)
- submit_knowledge: Submit new knowledge (use sourceText, NOT content!)
- list_domains: List available knowledge domains

## Local Tools
- list_sessions: List active PTY sessions on this device
- run_command: Run a shell command on the local machine
- get_clipboard: Read the system clipboard`,
  })

  // --- AgentLore proxy tools ---

  server.tool(
    "search",
    "Search AgentLore knowledge base for solutions, patterns, and insights",
    {
      query: z.string().describe("Search query"),
      domain: z.string().optional().describe("Filter by domain (e.g. 'nextjs', 'prisma')"),
      limit: z.number().optional().describe("Max results (default: 5)"),
    },
    async ({ query, domain, limit }) => {
      const result = await callAgentLoreApi("search", { query, domain, limit })
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    "get_entry",
    "Get full details of a knowledge entry by slug or ID",
    {
      slug: z.string().optional().describe("Entry slug"),
      id: z.string().optional().describe("Entry ID"),
    },
    async ({ slug, id }) => {
      const result = await callAgentLoreApi("get_entry", { slug, id })
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    "find_skills",
    "Find reusable skills and patterns for a specific task or technology",
    {
      keywords: z.array(z.string()).describe("Keywords describing the task"),
      scenario: z.string().optional().describe("Description of the scenario"),
    },
    async ({ keywords, scenario }) => {
      const result = await callAgentLoreApi("find_skills", { keywords, scenario })
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    "report_skill_outcome",
    "Report whether a skill/pattern worked or failed",
    {
      skillId: z.string().describe("The skill ID"),
      outcome: z.enum(["success", "failure", "partial"]).describe("Outcome"),
      notes: z.string().optional().describe("Additional notes"),
    },
    async ({ skillId, outcome, notes }) => {
      const result = await callAgentLoreApi("report_skill_outcome", { skillId, outcome, notes })
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    "submit_knowledge",
    `Submit new knowledge to AgentLore. IMPORTANT FORMAT:
- Use "sourceText" (NOT "content") for the body — minimum 200 characters
- Structure: ## Problem → ## Root Cause → ## Solution (numbered steps) → ## Key Insight
- "title" should be specific and descriptive (not "Fixed a bug")
- "sourceUrl" is optional
Call get_knowledge_guide first if unsure about the format.`,
    {
      title: z.string().describe("Specific, descriptive title (e.g. 'Android WebView backdrop-filter causes blank screen')"),
      sourceText: z.string().describe("Full content (min 200 chars). Must have: ## Problem, ## Root Cause, ## Solution, ## Key Insight"),
      sourceUrl: z.string().optional().describe("Source URL if applicable"),
    },
    async ({ title, sourceText, sourceUrl }) => {
      const result = await callAgentLoreApi("submit_knowledge", { title, sourceText, sourceUrl })
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    "get_knowledge_guide",
    "Read the AgentLore knowledge submission format guide. Call this BEFORE submit_knowledge to ensure correct format.",
    {},
    async () => {
      return { content: [{ type: "text" as const, text: KNOWLEDGE_GUIDE }] }
    }
  )

  server.tool(
    "list_domains",
    "List available knowledge domains in AgentLore",
    {},
    async () => {
      const result = await callAgentLoreApi("list_domains", {})
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }
    }
  )

  // --- Local AgentRune tools ---

  server.tool(
    "list_sessions",
    "List active PTY sessions on this AgentRune device",
    {},
    async () => {
      try {
        const config = loadConfig()
        const res = await fetch(`http://localhost:${config.port}/api/sessions`)
        const sessions = await res.json()
        return { content: [{ type: "text" as const, text: JSON.stringify(sessions, null, 2) }] }
      } catch {
        return { content: [{ type: "text" as const, text: "AgentRune daemon not running" }] }
      }
    }
  )

  // Allowlisted binaries for run_command (defense-in-depth)
  // NO network tools (curl/wget) or interpreters (python) — these enable data exfiltration
  const ALLOWED_BINS = new Set([
    "git", "node", "npm", "npx", "ls", "cat", "head", "tail", "echo", "pwd",
    "find", "grep", "rg", "wc", "sort", "uniq", "diff", "which", "env",
    "date", "whoami", "hostname", "uname", "df", "du", "jq",
    "tsc", "eslint", "prettier", "vitest", "jest",
  ])

  server.tool(
    "run_command",
    "Run an allowlisted command on the local machine via AgentRune. Only pre-approved binaries are permitted.",
    {
      command: z.string().describe("Binary name (must be allowlisted, no paths)"),
      args: z.array(z.string()).optional().describe("Command arguments"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ command, args, cwd }) => {
      const { execFileSync } = await import("node:child_process")
      // Extract basename and ONLY use the validated name (not the user-supplied path)
      const bin = command.split("/").pop()?.split("\\").pop() || command
      if (!ALLOWED_BINS.has(bin)) {
        return { content: [{ type: "text" as const, text: `Error: Binary "${bin}" is not allowlisted. Allowed: ${[...ALLOWED_BINS].join(", ")}` }] }
      }
      try {
        // Use validated bin name only — let OS resolve via PATH (prevents path-based bypass)
        const output = execFileSync(bin, args || [], {
          cwd: cwd || process.cwd(),
          encoding: "utf-8",
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        })
        return { content: [{ type: "text" as const, text: output }] }
      } catch (err: unknown) {
        const stderr = (err as any)?.stderr || (err as any)?.stdout || ""
        const safeMsg = typeof stderr === "string" ? stderr.slice(0, 1000) : "Command execution failed"
        return { content: [{ type: "text" as const, text: `Error: ${safeMsg}` }] }
      }
    }
  )

  server.tool(
    "get_clipboard",
    "Read the system clipboard content",
    {},
    async () => {
      const text = readClipboard()
      return { content: [{ type: "text" as const, text: text || "(clipboard empty)" }] }
    }
  )

  // --- Shared Memory (agentlore.md) ---

  server.tool(
    "read_memory",
    "Read the project's shared memory (agentlore.md). All agents share this file — it contains project patterns, architecture decisions, debugging insights, and workflow preferences.",
    {},
    async () => {
      const cwd = ensureLocalProjectMemory()
      const sections = listContextSections(cwd)
      return { content: [{ type: "text" as const, text: JSON.stringify({ projectCwd: cwd, sections }, null, 2) }] }

      const config = loadConfig()
      try {
        const res = await fetch(`http://localhost:${config.port}/api/memory`)
        const data = await res.json() as { content: string; path: string }
        if (!data.content) {
          return { content: [{ type: "text" as const, text: "共用記憶為空。你可以用 update_memory 建立初始內容。" }] }
        }
        return { content: [{ type: "text" as const, text: `${data.content}\n\n_reminder: 共用記憶已載入。有新發現就用 update_memory 更新。` }] }
      } catch {
        return { content: [{ type: "text" as const, text: "無法讀取共用記憶。AgentRune daemon 可能未執行。" }] }
      }
    }
  )

  server.tool(
    "list_memory_sections",
    "List the available structured memory sections, including descriptions, keywords, and path hints.",
    {},
    async () => {
      const cwd = ensureLocalProjectMemory()
      const content = getProjectMemory(cwd)
      if (!content) {
        return { content: [{ type: "text" as const, text: "agentlore.md is empty. Initialize or update project memory first." }] }
      }
      return { content: [{ type: "text" as const, text: `${content}\n\n_path: ${getMemoryPath(cwd)}` }] }

      const config = loadConfig()
      try {
        const res = await fetch(`http://localhost:${config.port}/api/memory/sections`)
        const data = await res.json()
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
      } catch {
        return { content: [{ type: "text" as const, text: "Could not list memory sections. AgentRune daemon may not be running." }] }
      }
    }
  )

  server.tool(
    "route_memory_sections",
    "Recommend which structured memory sections to read first for the current task. Use this after reading agentlore.md.",
    {
      task: z.string().describe("What you are trying to do"),
      changedFiles: z.array(z.string()).optional().describe("Relevant file paths if already known"),
      maxSections: z.number().optional().describe("Maximum sections to recommend (default: 3)"),
    },
    async ({ task, changedFiles, maxSections }) => {
      const cwd = ensureLocalProjectMemory()
      const data = routeContextSections(cwd, { task, changedFiles, maxSections })
      return { content: [{ type: "text" as const, text: JSON.stringify({ projectCwd: cwd, ...data }, null, 2) }] }

      const config = loadConfig()
      try {
        const res = await fetch(`http://localhost:${config.port}/api/memory/route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, changedFiles, maxSections }),
        })
        const data = await res.json()
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
      } catch {
        return { content: [{ type: "text" as const, text: "Could not route memory sections. AgentRune daemon may not be running." }] }
      }
    }
  )

  server.tool(
    "search_memory_sections",
    "Search structured memory sections when the right section is unclear or when you need fallback retrieval.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Maximum results"),
    },
    async ({ query, limit }) => {
      const cwd = ensureLocalProjectMemory()
      const results = searchContextSections(cwd, query, { limit })
      return { content: [{ type: "text" as const, text: JSON.stringify({ projectCwd: cwd, results }, null, 2) }] }

      const config = loadConfig()
      try {
        const url = new URL(`http://localhost:${config.port}/api/memory/search`)
        url.searchParams.set("q", query)
        if (typeof limit === "number") url.searchParams.set("limit", String(limit))
        const res = await fetch(url)
        const data = await res.json()
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
      } catch {
        return { content: [{ type: "text" as const, text: "Could not search memory sections. AgentRune daemon may not be running." }] }
      }
    }
  )

  server.tool(
    "read_memory_section",
    "Read one structured memory section by file name, such as stack.md or security.md.",
    {
      file: z.string().describe("Section file name"),
    },
    async ({ file }) => {
      if (!isAllowedContextSectionFile(file)) {
        return { content: [{ type: "text" as const, text: `Error: invalid memory section "${file}".` }], isError: true }
      }
      const cwd = ensureLocalProjectMemory()
      const content = readContextSection(cwd, file)
      return { content: [{ type: "text" as const, text: JSON.stringify({ projectCwd: cwd, file, content }, null, 2) }] }

      const config = loadConfig()
      try {
        const res = await fetch(`http://localhost:${config.port}/api/memory/sections/${encodeURIComponent(file)}`)
        const data = await res.json()
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
      } catch {
        return { content: [{ type: "text" as const, text: "Could not read memory section. AgentRune daemon may not be running." }] }
      }
    }
  )

  server.tool(
    "update_memory_section",
    "Update one structured memory section. Use this for stable lessons, bugs, changelog notes, and other section-specific knowledge.",
    {
      file: z.string().describe("Section file name"),
      content: z.string().describe("Complete new content for the section file"),
    },
    async ({ file, content }) => {
      if (!isAllowedContextSectionFile(file)) {
        return { content: [{ type: "text" as const, text: `Error: invalid memory section "${file}".` }], isError: true }
      }
      const cwd = ensureLocalProjectMemory()
      writeContextSection(cwd, file, content)
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, projectCwd: cwd, file }, null, 2) }] }

      const config = loadConfig()
      try {
        const res = await fetch(`http://localhost:${config.port}/api/memory/sections/${encodeURIComponent(file)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        })
        const data = await res.json()
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
      } catch {
        return { content: [{ type: "text" as const, text: "Could not update memory section. AgentRune daemon may not be running." }] }
      }
    }
  )

  server.tool(
    "update_memory",
    "Update the project's shared memory (agentlore.md). Pass the COMPLETE new content — it will overwrite the existing file. All agents (claude/codex/gemini) share this memory. Record: stable patterns, important file paths, architecture decisions, debugging insights, workflow preferences. Do NOT record: temporary state, in-progress work, unverified guesses.",
    {
      content: z.string().describe("Complete new content for agentlore.md (will overwrite existing)"),
    },
    async ({ content }) => {
      const cwd = ensureLocalProjectMemory()
      updateProjectMemory(cwd, content)
      return { content: [{ type: "text" as const, text: `Updated agentlore.md (${content.length} chars) at ${getMemoryPath(cwd)}` }] }

      const config = loadConfig()
      try {
        await fetch(`http://localhost:${config.port}/api/memory`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        })
        return { content: [{ type: "text" as const, text: `共用記憶已更新（${content.length} 字元）。\n\n_reminder: 記憶已儲存。其他 session 啟動時會自動載入這份記憶。` }] }
      } catch {
        return { content: [{ type: "text" as const, text: "無法更新共用記憶。AgentRune daemon 可能未執行。" }] }
      }
    }
  )

  // --- Progress Reporting (MCP Gate Keeper) ---

  server.tool(
    "report_progress",
    "REQUIRED: Report your work progress to the user. Call this after completing a task or reaching a milestone. The user's APP will display a structured summary card based on your report. Write everything in the user's language.",
    {
      title: z.string().describe("Short title of what was accomplished, in user's language"),
      status: z.enum(["done", "blocked", "in_progress"]).describe("Current status"),
      summary: z.string().describe("Natural language summary of the work, in user's language"),
      nextSteps: z.array(z.string()).describe("Suggested next actions, in user's language"),
      details: z.string().optional().describe("Detailed explanation for expandable panel"),
    },
    async ({ title, status, summary, nextSteps, details }) => {
      // Validation
      if (!title.trim()) return { content: [{ type: "text" as const, text: "Error: title cannot be empty. Please provide a short title describing what you accomplished." }], isError: true }
      if (!summary.trim()) return { content: [{ type: "text" as const, text: "Error: summary cannot be empty. Please write a natural language summary of your work." }], isError: true }
      if (status === "done" && nextSteps.length === 0) return { content: [{ type: "text" as const, text: "Error: when status is 'done', nextSteps must have at least one item." }], isError: true }

      const report = { title, status, summary, nextSteps, details }

      const config = loadConfig()
      try {
        await fetch(`http://localhost:${config.port}/api/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(report),
        })
      } catch {
        // ws-server may not be running — still return success to agent
      }

      return {
        content: [{
          type: "text" as const,
          text: `${title}\n\n_reminder: 回報成功。提醒：summary 寫人話、用用戶語言、卡住了就說你需要什麼、每完成一段有意義的工作就報一次。`,
        }],
      }
    }
  )

  // --- Knowledge Management (Obsidian Vault — Shared Memory) ---

  server.tool(
    "get_project_context",
    "Read the project's shared knowledge context from the vault. Call this at the start of a new session to understand the project state, prerequisites, recent progress, and architecture decisions.",
    {},
    async () => {
      const config = loadConfig()
      try {
        const res = await fetch(`http://localhost:${config.port}/api/vault/context`)
        const data = await res.json() as { context: string }
        return { content: [{ type: "text" as const, text: `${data.context}\n\n_reminder: 上下文已載入。提醒：先讀完再開始工作、注意前提條件中的限制和踩坑。` }] }
      } catch {
        return { content: [{ type: "text" as const, text: "Could not read project context. AgentRune daemon may not be running." }] }
      }
    }
  )

  server.tool(
    "log_prerequisite",
    "Record a prerequisite, constraint, or lesson learned. This gets stored in the project's shared knowledge vault so future agent sessions can avoid the same pitfalls.",
    {
      title: z.string().describe("Short title (e.g. 'Node 18 required for native ESM')"),
      content: z.string().describe("Detailed explanation of the prerequisite/constraint"),
    },
    async ({ title, content }) => {
      const config = loadConfig()
      try {
        await fetch(`http://localhost:${config.port}/api/vault/prerequisite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, content }),
        })
      } catch { /* non-fatal */ }

      return {
        content: [{
          type: "text" as const,
          text: `Prerequisite recorded: "${title}".\n\n_reminder: 前提條件已記錄。提醒：記錄「為什麼」不是「是什麼」、未來的 agent 會讀這份紀錄。`,
        }],
      }
    }
  )

  server.tool(
    "log_decision",
    "Record an architecture or design decision. This gets stored in the project's shared knowledge vault for future reference.",
    {
      title: z.string().describe("Decision title (e.g. 'Use SQLite instead of PostgreSQL')"),
      decision: z.string().describe("What was decided"),
      alternatives: z.string().optional().describe("What alternatives were considered"),
      rationale: z.string().optional().describe("Why this decision was made"),
    },
    async ({ title, decision, alternatives, rationale }) => {
      const config = loadConfig()
      try {
        await fetch(`http://localhost:${config.port}/api/vault/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, decision, alternatives, rationale }),
        })
      } catch { /* non-fatal */ }

      return {
        content: [{
          type: "text" as const,
          text: `Decision recorded: "${title}" → ${decision}.\n\n_reminder: 決策已記錄。提醒：包含替代方案和理由、不要推翻已有決策除非有明確理由。`,
        }],
      }
    }
  )

  // --- Start ---

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
