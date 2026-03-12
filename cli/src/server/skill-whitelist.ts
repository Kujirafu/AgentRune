/**
 * Skill Whitelist — user-controlled trust list for skills.
 * Persisted to ~/.agentrune/skill-trust.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { getConfigDir } from "../shared/config.js"
import { log } from "../shared/logger.js"

// ── Types ──

export interface TrustedSkill {
  skillId: string
  /** "full" = no confirmation needed; "prompt-only" = can run but no bypass */
  trustLevel: "full" | "prompt-only"
  trustedAt: number
  /** Risk score at the time user approved */
  riskScoreAtTrust: number
}

// ── Class ──

export class SkillWhitelist {
  private trusted = new Map<string, TrustedSkill>()
  private filePath: string

  constructor() {
    this.filePath = join(getConfigDir(), "skill-trust.json")
    this.load()
  }

  // ── CRUD ──

  trust(skillId: string, level: "full" | "prompt-only", riskScore: number): TrustedSkill {
    const entry: TrustedSkill = {
      skillId,
      trustLevel: level,
      trustedAt: Date.now(),
      riskScoreAtTrust: riskScore,
    }
    this.trusted.set(skillId, entry)
    this.save()
    log.info(`[skill-whitelist] Trusted: ${skillId} (level=${level}, risk=${riskScore})`)
    return entry
  }

  revoke(skillId: string): boolean {
    const existed = this.trusted.delete(skillId)
    if (existed) {
      this.save()
      log.info(`[skill-whitelist] Revoked: ${skillId}`)
    }
    return existed
  }

  isTrusted(skillId: string): boolean {
    return this.trusted.has(skillId)
  }

  getTrustLevel(skillId: string): "full" | "prompt-only" | null {
    return this.trusted.get(skillId)?.trustLevel ?? null
  }

  getTrustInfo(skillId: string): TrustedSkill | null {
    return this.trusted.get(skillId) ?? null
  }

  list(): TrustedSkill[] {
    return Array.from(this.trusted.values()).sort((a, b) => b.trustedAt - a.trustedAt)
  }

  // ── Persistence ──

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return
      const raw = JSON.parse(readFileSync(this.filePath, "utf-8"))
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (entry.skillId && typeof entry.skillId === "string") {
            this.trusted.set(entry.skillId, entry)
          }
        }
      }
    } catch (err) {
      log.warn(`[skill-whitelist] Failed to load: ${err}`)
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.list(), null, 2))
    } catch (err) {
      log.warn(`[skill-whitelist] Failed to save: ${err}`)
    }
  }
}
