import * as pty from "node-pty"
import { randomBytes } from "node:crypto"
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"

export interface TerminalSpawnOptions {
  shell: string
  args?: string[]
  cwd: string
  cols: number
  rows: number
  name?: string
  baseEnv?: NodeJS.ProcessEnv
  extraEnv?: Record<string, string>
}

export interface ProcessSpawnOptions {
  command: string
  args: string[]
  cwd: string
  stdio?: SpawnOptions["stdio"]
  detached?: boolean
  windowsHide?: boolean
  baseEnv?: NodeJS.ProcessEnv
  extraEnv?: Record<string, string>
}

export interface AgentExecutor {
  createSessionId(projectId: string, now?: number): string
  buildEnv(baseEnv?: NodeJS.ProcessEnv, extraEnv?: Record<string, string>): Record<string, string>
  spawnTerminal(options: TerminalSpawnOptions): pty.IPty
  spawnProcess(options: ProcessSpawnOptions): ChildProcess
}

export function buildAgentEnvironment(
  baseEnv: NodeJS.ProcessEnv = process.env,
  extraEnv?: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {}

  for (const [key, value] of Object.entries({ ...baseEnv, ...extraEnv })) {
    if (typeof value === "string") merged[key] = value
  }

  // Prevent nested Claude Code session detection when the daemon itself is launched inside Claude.
  delete merged.CLAUDECODE
  delete merged.CLAUDE_CODE_ENTRYPOINT

  return merged
}

export function createManagedSessionId(projectId: string, now = Date.now()): string {
  return `${projectId}_${now}_${randomBytes(3).toString("hex")}`
}

export class LocalAgentExecutor implements AgentExecutor {
  createSessionId(projectId: string, now = Date.now()): string {
    return createManagedSessionId(projectId, now)
  }

  buildEnv(baseEnv?: NodeJS.ProcessEnv, extraEnv?: Record<string, string>): Record<string, string> {
    return buildAgentEnvironment(baseEnv, extraEnv)
  }

  spawnTerminal(options: TerminalSpawnOptions): pty.IPty {
    return pty.spawn(options.shell, options.args || [], {
      name: options.name || "xterm-256color",
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: this.buildEnv(options.baseEnv, options.extraEnv),
    })
  }

  spawnProcess(options: ProcessSpawnOptions): ChildProcess {
    return spawn(options.command, options.args, {
      cwd: options.cwd,
      env: this.buildEnv(options.baseEnv, options.extraEnv),
      stdio: options.stdio,
      detached: options.detached,
      windowsHide: options.windowsHide,
    })
  }
}

export function createLocalAgentExecutor(): AgentExecutor {
  return new LocalAgentExecutor()
}
