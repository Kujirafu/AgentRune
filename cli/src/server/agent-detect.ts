import { execFileSync } from "node:child_process"

export interface DetectedAgent {
  id: string
  name: string
  installed: boolean
  version?: string
  path?: string
}

const AGENT_COMMANDS: { id: string; name: string; cmd: string; versionFlag?: string }[] = [
  { id: "claude", name: "Claude Code", cmd: "claude", versionFlag: "--version" },
  { id: "codex", name: "Codex CLI", cmd: "codex", versionFlag: "--version" },
  { id: "gemini", name: "Gemini CLI", cmd: "gemini", versionFlag: "--version" },
  { id: "cursor", name: "Cursor Agent", cmd: "cursor", versionFlag: "--version" },
  { id: "aider", name: "Aider", cmd: "aider", versionFlag: "--version" },
  { id: "cline", name: "Cline", cmd: "cline", versionFlag: "--version" },
]

function findCommand(cmd: string): string | null {
  try {
    const which = process.platform === "win32" ? "where" : "which"
    const result = execFileSync(which, [cmd], { encoding: "utf-8", timeout: 5000 })
    return result.trim().split("\n")[0] || null
  } catch {
    return null
  }
}

function getVersion(cmd: string, flag: string): string | null {
  try {
    const result = execFileSync(cmd, [flag], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const match = result.match(/[\d]+\.[\d]+[\w.-]*/)
    return match?.[0] || result.trim().slice(0, 30)
  } catch {
    return null
  }
}

export function detectAgents(): DetectedAgent[] {
  return AGENT_COMMANDS.map(({ id, name, cmd, versionFlag }) => {
    const path = findCommand(cmd)
    if (!path) return { id, name, installed: false }
    const version = versionFlag ? getVersion(cmd, versionFlag) : undefined
    return { id, name, installed: true, version: version || undefined, path }
  })
}
