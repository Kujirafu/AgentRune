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

  // --- Start ---

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
