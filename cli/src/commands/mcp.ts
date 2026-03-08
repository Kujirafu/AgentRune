// commands/mcp.ts
export async function mcpCommand() {
  const { startMcpServer } = await import("../mcp/stdio-server.js")
  await startMcpServer()
}
