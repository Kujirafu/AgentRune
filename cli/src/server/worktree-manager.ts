// server/worktree-manager.ts
// Manages git worktrees for session isolation
import { execSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

export interface Worktree {
  path: string
  branch: string
  sessionId?: string
  createdAt: number
}

export class WorktreeManager {
  private projectCwd: string
  private worktrees = new Map<string, Worktree>()

  constructor(projectCwd: string) {
    this.projectCwd = projectCwd
  }

  /** Create a new worktree for a session */
  create(sessionId: string, taskSlug?: string): Worktree {
    const existing = this.worktrees.get(sessionId)
    if (existing) return existing

    const date = new Date().toISOString().slice(0, 10)
    const slug = taskSlug || sessionId.slice(0, 8)
    const branch = `agentrune/${date}-${slug}`
    const worktreeDir = join(this.projectCwd, ".worktrees", `${date}-${slug}`)

    mkdirSync(join(this.projectCwd, ".worktrees"), { recursive: true })

    try {
      execSync(`git worktree add -b "${branch}" "${worktreeDir}"`, {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
    } catch {
      // Branch might already exist — try without -b
      execSync(`git worktree add "${worktreeDir}" "${branch}"`, {
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
      execSync(`git merge "${wt.branch}" --no-edit`, {
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
      execSync(`git worktree remove "${wt.path}" --force`, {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
    } catch { /* worktree may already be removed */ }

    try {
      execSync(`git branch -D "${wt.branch}"`, {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
    } catch { /* branch may already be removed */ }

    this.worktrees.delete(sessionId)
  }
}
