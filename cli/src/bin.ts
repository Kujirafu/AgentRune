#!/usr/bin/env node
// CLI entry point — Commander.js with 6 subcommands
import { Command } from "commander"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join, dirname } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"))

/** Check npm for newer version (non-blocking) */
async function checkForUpdate(): Promise<void> {
  try {
    const res = await fetch("https://registry.npmjs.org/agentrune/latest", { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return
    const data = await res.json() as { version?: string }
    if (data.version && data.version !== pkg.version) {
      const isWin = process.platform === "win32"
      const cmd = isWin
        ? "irm https://agentrune.com/install.ps1 | iex"
        : "curl -fsSL https://agentrune.com/install.sh | bash"
      console.log(`\n\x1b[33m⚡ AgentRune v${data.version} available (current: v${pkg.version})\x1b[0m`)
      console.log(`   Run: \x1b[36m${cmd}\x1b[0m\n`)
    }
  } catch {}
}

const program = new Command()
  .name("agentrune")
  .version(pkg.version)
  .description("AgentRune CLI -- AI agent mission control + AgentLore MCP server")

program
  .command("start")
  .description("Start WebSocket daemon")
  .option("-p, --port <port>", "Port number", "3457")
  .option("-f, --foreground", "Run in foreground (not as daemon)")
  .action(async (opts) => {
    checkForUpdate()  // non-blocking, don't await
    const { startCommand } = await import("./commands/start.js")
    await startCommand(opts)
  })

program
  .command("stop")
  .description("Stop the running daemon")
  .option("-p, --port <port>", "Port number (to stop a specific daemon)")
  .action(async (opts) => {
    const { stopCommand } = await import("./commands/stop.js")
    await stopCommand(opts)
  })

program
  .command("restart")
  .description("Restart daemons (default: both 3456 + 3457)")
  .option("-p, --port <port>", "Restart only this port (default: restart all)")
  .action(async (opts) => {
    const { restartCommand } = await import("./commands/restart.js")
    await restartCommand(opts)
  })

program
  .command("status")
  .description("Show daemon status and AgentLore login")
  .action(async () => {
    checkForUpdate()  // non-blocking
    const { statusCommand } = await import("./commands/status.js")
    await statusCommand()
  })

program
  .command("mcp")
  .description("Start MCP server (stdio transport)")
  .action(async () => {
    const { mcpCommand } = await import("./commands/mcp.js")
    await mcpCommand()
  })

program
  .command("login")
  .description("Login to AgentLore")
  .action(async () => {
    const { loginCommand } = await import("./commands/login.js")
    await loginCommand()
  })

program
  .command("logout")
  .description("Logout from AgentLore")
  .action(async () => {
    const { logoutCommand } = await import("./commands/logout.js")
    await logoutCommand()
  })

program
  .command("watch")
  .description("Watch agent sessions in terminal (mirrors phone APP)")
  .option("-p, --port <port>", "Daemon port", "3457")
  .option("-s, --session <id>", "Attach to specific session")
  .option("--raw", "Show raw terminal output")
  .action(async (opts) => {
    const { watchCommand } = await import("./commands/watch.js")
    await watchCommand(opts)
  })

const memory = program
  .command("memory")
  .description("Inspect and manage local project memory")

memory
  .command("init")
  .description("Initialize or migrate .agentrune project memory in the target project")
  .argument("[path]", "Project root (defaults to current working directory)")
  .action(async (pathArg) => {
    const { memoryInitCommand } = await import("./commands/memory.js")
    await memoryInitCommand(pathArg)
  })

memory
  .command("index")
  .description("Print the project memory index (agentlore.md)")
  .argument("[path]", "Project root (defaults to current working directory)")
  .action(async (pathArg) => {
    const { memoryIndexCommand } = await import("./commands/memory.js")
    await memoryIndexCommand(pathArg)
  })

memory
  .command("sections")
  .description("List structured memory sections")
  .argument("[path]", "Project root (defaults to current working directory)")
  .action(async (pathArg) => {
    const { memorySectionsCommand } = await import("./commands/memory.js")
    await memorySectionsCommand(pathArg)
  })

memory
  .command("read")
  .description("Read one structured memory section")
  .argument("<file>", "Section file name, such as stack.md")
  .argument("[path]", "Project root (defaults to current working directory)")
  .action(async (file, pathArg) => {
    const { memoryReadCommand } = await import("./commands/memory.js")
    await memoryReadCommand(file, pathArg)
  })

memory
  .command("search")
  .description("Search structured memory sections")
  .argument("<query>", "Search query")
  .argument("[path]", "Project root (defaults to current working directory)")
  .option("-l, --limit <n>", "Maximum results")
  .action(async (query, pathArg, opts) => {
    const { memorySearchCommand } = await import("./commands/memory.js")
    await memorySearchCommand(query, pathArg, opts.limit)
  })

memory
  .command("route")
  .description("Recommend which memory sections to read first for a task")
  .argument("<task>", "Task description")
  .argument("[path]", "Project root (defaults to current working directory)")
  .option("-f, --file <path>", "Relevant changed file", (value, previous: string[] = []) => [...previous, value], [])
  .option("-m, --max <n>", "Maximum number of sections")
  .action(async (task, pathArg, opts) => {
    const { memoryRouteCommand } = await import("./commands/memory.js")
    await memoryRouteCommand(task, { path: pathArg, files: opts.file, max: opts.max })
  })

// Default action (no args) = start --foreground
program.action(async () => {
  const { startCommand } = await import("./commands/start.js")
  await startCommand({ port: "3457", foreground: true })
})

program.parse()
