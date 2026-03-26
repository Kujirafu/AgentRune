// server/worktree-manager.ts
// Manages git worktrees for session isolation
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { log } from "../shared/logger.js"

const SESSION_META_FILE = ".agentrune-session.json"

export interface Worktree {
  path: string
  branch: string
  sessionId?: string
  createdAt: number
}

/** Sanitize slug to prevent command injection; allow only alphanumeric, hyphens, and underscores. */
function sanitizeSlug(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)
}

export function syncProjectMemoryToWorktree(projectAgentruneDir: string, worktreeAgentruneDir: string): void {
  if (!existsSync(projectAgentruneDir)) return

  mkdirSync(worktreeAgentruneDir, { recursive: true })

  const linkFileOrCopy = (src: string, dst: string): void => {
    if (!existsSync(src) || existsSync(dst)) return
    try {
      linkSync(src, dst)
    } catch {
      copyFileSync(src, dst)
    }
  }

  for (const file of ["agentlore.md", "rules.md"]) {
    const src = join(projectAgentruneDir, file)
    const dst = join(worktreeAgentruneDir, file)
    linkFileOrCopy(src, dst)
  }

  const srcContextDir = join(projectAgentruneDir, "context")
  if (!existsSync(srcContextDir)) return

  const dstContextDir = join(worktreeAgentruneDir, "context")
  mkdirSync(dstContextDir, { recursive: true })

  for (const entry of readdirSync(srcContextDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const src = join(srcContextDir, entry.name)
    const dst = join(dstContextDir, entry.name)
    linkFileOrCopy(src, dst)
  }
}

export class WorktreeManager {
  private projectCwd: string
  private worktrees = new Map<string, Worktree>()

  constructor(projectCwd: string) {
    this.projectCwd = projectCwd
    this.restoreFromDisk()
  }

  /** Scan .worktrees/ and rebuild in-memory map from persisted session metadata. */
  private restoreFromDisk(): void {
    const worktreesDir = join(this.projectCwd, ".worktrees")
    if (!existsSync(worktreesDir)) return

    try {
      const dirs = readdirSync(worktreesDir, { withFileTypes: true }).filter((dirent) => dirent.isDirectory())

      for (const dirent of dirs) {
        const metaPath = join(worktreesDir, dirent.name, SESSION_META_FILE)
        if (!existsSync(metaPath)) continue

        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf-8"))
          if (!meta.sessionId || !meta.branch) continue

          const wtPath = join(worktreesDir, dirent.name)
          const wt: Worktree = {
            path: wtPath,
            branch: meta.branch,
            sessionId: meta.sessionId,
            createdAt: meta.createdAt || 0,
          }
          this.worktrees.set(meta.sessionId, wt)
          log.dim(`[Worktree] Restored: ${meta.sessionId} -> ${dirent.name}`)
        } catch {
          // Ignore corrupted metadata and continue restoring the rest.
        }
      }

      if (this.worktrees.size > 0) {
        log.info(`[Worktree] Restored ${this.worktrees.size} worktree(s) from disk`)
      }
    } catch {
      // Ignore unreadable .worktrees directory.
    }
  }

  /** Persist session metadata into the worktree directory. */
  private persistMeta(wt: Worktree): void {
    try {
      writeFileSync(
        join(wt.path, SESSION_META_FILE),
        JSON.stringify({
          sessionId: wt.sessionId,
          branch: wt.branch,
          createdAt: wt.createdAt,
        }),
        "utf-8",
      )
    } catch {
      // Non-critical; the worktree still works without persisted metadata.
    }
  }

  /** Create a new worktree for a session. */
  create(sessionId: string, taskSlug?: string): Worktree {
    const existing = this.worktrees.get(sessionId)
    if (existing) return existing

    const date = new Date().toISOString().slice(0, 10)
    const rand = Math.random().toString(36).slice(2, 6)
    const slug = sanitizeSlug(taskSlug || sessionId.slice(0, 8)) + `-${rand}`
    const branch = `agentrune/${date}-${slug}`
    const worktreeDir = join(this.projectCwd, ".worktrees", `${date}-${slug}`)

    mkdirSync(join(this.projectCwd, ".worktrees"), { recursive: true })

    try {
      execFileSync("git", ["worktree", "add", "-b", branch, worktreeDir], {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
    } catch {
      // Branch might already exist; try without -b.
      execFileSync("git", ["worktree", "add", worktreeDir, branch], {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
    }

    const agentruneDir = join(this.projectCwd, ".agentrune")
    const worktreeAgentruneDir = join(worktreeDir, ".agentrune")
    if (existsSync(agentruneDir)) {
      try {
        syncProjectMemoryToWorktree(agentruneDir, worktreeAgentruneDir)
        log.dim(`[Worktree] Synced project memory -> ${worktreeDir}`)
      } catch (error) {
        log.warn(`[Worktree] Failed to sync project memory: ${error instanceof Error ? error.message : "unknown"}`)
      }
    }

    // Sync agent config directories to worktree
    // These contain MCP settings, permissions, project-level config that agents need
    const INHERIT_DIRS = [".claude", ".codex", ".gemini", ".cursor"]
    const INHERIT_FILES = [".mcp.json", "CLAUDE.md", "AGENTS.md", "GEMINI.md", "CODEX.md"]
    for (const dir of INHERIT_DIRS) {
      const src = join(this.projectCwd, dir)
      const dst = join(worktreeDir, dir)
      if (existsSync(src) && !existsSync(dst)) {
        try {
          mkdirSync(dst, { recursive: true })
          for (const f of readdirSync(src)) {
            const srcFile = join(src, f)
            if (statSync(srcFile).isFile()) {
              copyFileSync(srcFile, join(dst, f))
            }
          }
          log.dim(`[Worktree] Synced ${dir}/ -> ${worktreeDir}`)
        } catch (error) {
          log.warn(`[Worktree] Failed to sync ${dir}/: ${error instanceof Error ? error.message : "unknown"}`)
        }
      }
    }
    for (const file of INHERIT_FILES) {
      const src = join(this.projectCwd, file)
      const dst = join(worktreeDir, file)
      if (existsSync(src) && !existsSync(dst)) {
        try {
          copyFileSync(src, dst)
          log.dim(`[Worktree] Synced ${file} -> ${worktreeDir}`)
        } catch (error) {
          log.warn(`[Worktree] Failed to sync ${file}: ${error instanceof Error ? error.message : "unknown"}`)
        }
      }
    }

    const wt: Worktree = {
      path: worktreeDir,
      branch,
      sessionId,
      createdAt: Date.now(),
    }
    this.worktrees.set(sessionId, wt)
    this.persistMeta(wt)
    return wt
  }

  /** Get worktree for a session. */
  get(sessionId: string): Worktree | undefined {
    return this.worktrees.get(sessionId)
  }

  /** List all managed worktrees. */
  list(): Worktree[] {
    return [...this.worktrees.values()]
  }

  /** Merge worktree branch back to main and clean up. */
  merge(sessionId: string, targetBranch: string = "main"): { success: boolean; message: string } {
    const wt = this.worktrees.get(sessionId)
    if (!wt) return { success: false, message: "Worktree not found" }

    try {
      execFileSync("git", ["merge", wt.branch, "--no-edit"], {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
      this.cleanup(sessionId)
      return { success: true, message: `Merged ${wt.branch} into ${targetBranch}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Merge failed"
      return { success: false, message }
    }
  }

  /** Remove worktree and branch. */
  cleanup(sessionId: string): void {
    const wt = this.worktrees.get(sessionId)
    if (!wt) return

    try {
      execFileSync("git", ["worktree", "remove", wt.path, "--force"], {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
    } catch {
      // Worktree may already be removed.
    }

    try {
      execFileSync("git", ["branch", "-D", wt.branch], {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
    } catch {
      // Branch may already be removed.
    }

    this.worktrees.delete(sessionId)
  }
}
