// mcp/stdio-server.ts
// MCP server that proxies AgentLore API tools + provides local AgentRune tools
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { loadConfig } from "../shared/config.js"
import { readClipboard } from "../server/clipboard.js"

const AGENTLORE_BASE = "https://agentlore.vercel.app"

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

## Knowledge Management
- log_prerequisite: Record prerequisites, constraints, or lessons learned
- log_decision: Record architecture/design decisions
- get_project_context: Read project context from shared knowledge vault

## AgentLore Tools
- search: Search the AI-verified knowledge base for solutions
- get_entry: Get full details of a knowledge entry
- find_skills: Find reusable skills/patterns for your task
- report_skill_outcome: Report whether a skill worked
- submit_knowledge: Submit new knowledge to the database
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
    "Submit new knowledge to AgentLore (debug insights, patterns, solutions)",
    {
      title: z.string().describe("Knowledge title"),
      content: z.string().describe("Full content/description"),
      domain: z.string().optional().describe("Domain (e.g. 'nextjs', 'prisma')"),
      tags: z.array(z.string()).optional().describe("Tags"),
    },
    async ({ title, content, domain, tags }) => {
      const result = await callAgentLoreApi("submit_knowledge", { title, content, domain, tags })
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }
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

  server.tool(
    "run_command",
    "Run a shell command on the local machine via AgentRune",
    {
      command: z.string().describe("Shell command to run"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ command, cwd }) => {
      const { execSync } = await import("node:child_process")
      try {
        const output = execSync(command, {
          cwd: cwd || process.cwd(),
          encoding: "utf-8",
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        })
        return { content: [{ type: "text" as const, text: output }] }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Command failed"
        return { content: [{ type: "text" as const, text: `Error: ${message}` }] }
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
