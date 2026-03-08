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
  .option("-p, --port <port>", "Port number", "3456")
  .option("-f, --foreground", "Run in foreground (not as daemon)")
  .action(async (opts) => {
    checkForUpdate()  // non-blocking, don't await
    const { startCommand } = await import("./commands/start.js")
    await startCommand(opts)
  })

program
  .command("stop")
  .description("Stop the running daemon")
  .action(async () => {
    const { stopCommand } = await import("./commands/stop.js")
    await stopCommand()
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
  .option("-p, --port <port>", "Daemon port", "3456")
  .option("-s, --session <id>", "Attach to specific session")
  .option("--raw", "Show raw terminal output")
  .action(async (opts) => {
    const { watchCommand } = await import("./commands/watch.js")
    await watchCommand(opts)
  })

// Default action (no args) = start --foreground
program.action(async () => {
  const { startCommand } = await import("./commands/start.js")
  await startCommand({ port: "3456", foreground: true })
})

program.parse()
