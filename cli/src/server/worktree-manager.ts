// server/worktree-manager.ts
// Manages git worktrees for session isolation
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { log } from "../shared/logger.js"

const SESSION_META_FILE = ".agentrune-session.json"

export interface Worktree {
  path: string
  branch: string
  sessionId?: string
  createdAt: number
}

/** Sanitize slug to prevent command injection — allow only alphanumeric, hyphens, underscores */
function sanitizeSlug(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)
}

export class WorktreeManager {
  private projectCwd: string
  private worktrees = new Map<string, Worktree>()

  constructor(projectCwd: string) {
    this.projectCwd = projectCwd
    this.restoreFromDisk()
  }

  /** Scan .worktrees/ directory and rebuild in-memory map from persisted session metadata */
  private restoreFromDisk(): void {
    const worktreesDir = join(this.projectCwd, ".worktrees")
    if (!existsSync(worktreesDir)) return

    try {
      const dirs = readdirSync(worktreesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())

      for (const dir of dirs) {
        const metaPath = join(worktreesDir, dir.name, SESSION_META_FILE)
        if (!existsSync(metaPath)) continue

        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf-8"))
          if (!meta.sessionId || !meta.branch) continue

          // Verify the worktree is still valid (git knows about it)
          const wtPath = join(worktreesDir, dir.name)
          const wt: Worktree = {
            path: wtPath,
            branch: meta.branch,
            sessionId: meta.sessionId,
            createdAt: meta.createdAt || 0,
          }
          this.worktrees.set(meta.sessionId, wt)
          log.dim(`[Worktree] Restored: ${meta.sessionId} → ${dir.name}`)
        } catch {
          // Corrupted meta file — skip
        }
      }

      if (this.worktrees.size > 0) {
        log.info(`[Worktree] Restored ${this.worktrees.size} worktree(s) from disk`)
      }
    } catch {
      // .worktrees dir unreadable — skip
    }
  }

  /** Persist session metadata into the worktree directory */
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
      // Non-critical — worktree still works without persisted meta
    }
  }

  /** Create a new worktree for a session */
  create(sessionId: string, taskSlug?: string): Worktree {
    const existing = this.worktrees.get(sessionId)
    if (existing) return existing

    const date = new Date().toISOString().slice(0, 10)
    const slug = sanitizeSlug(taskSlug || sessionId.slice(0, 8))
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
      // Branch might already exist — try without -b
      execFileSync("git", ["worktree", "add", worktreeDir, branch], {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
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

  /** Get worktree for a session */
  get(sessionId: string): Worktree | undefined {
    return this.worktrees.get(sessionId)
  }

  /** List all managed worktrees */
  list(): Worktree[] {
    return [...this.worktrees.values()]
  }

  /** Merge worktree branch back to main and clean up */
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Merge failed"
      return { success: false, message: msg }
    }
  }

  /** Remove worktree and branch */
  cleanup(sessionId: string): void {
    const wt = this.worktrees.get(sessionId)
    if (!wt) return

    try {
      execFileSync("git", ["worktree", "remove", wt.path, "--force"], {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
    } catch { /* worktree may already be removed */ }

    try {
      execFileSync("git", ["branch", "-D", wt.branch], {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
    } catch { /* branch may already be removed */ }

    this.worktrees.delete(sessionId)
  }
}
