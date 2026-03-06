#!/usr/bin/env node
// CLI entry point — Commander.js with 6 subcommands
import { Command } from "commander"

const program = new Command()
  .name("agentrune")
  .version("0.1.0")
  .description("AgentRune CLI -- AI agent mission control + AgentLore MCP server")

program
  .command("start")
  .description("Start WebSocket daemon")
  .option("-p, --port <port>", "Port number", "3456")
  .option("-f, --foreground", "Run in foreground (not as daemon)")
  .action(async (opts) => {
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

// Default action (no args) = start --foreground
program.action(async () => {
  const { startCommand } = await import("./commands/start.js")
  await startCommand({ port: "3456", foreground: true })
})

program.parse()
