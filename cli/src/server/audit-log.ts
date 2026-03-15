/**
 * audit-log.ts
 * Structured audit logging for Trust Layer decisions.
 * Records permission grants, denials, violations, and trust profile changes.
 */

import { mkdirSync, appendFileSync, readFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { getConfigDir } from "../shared/config.js"
import { log } from "../shared/logger.js"

// ── Types ──

export type AuditAction =
  | "automation_started"
  | "automation_completed"
  | "daily_limit_reached"
  | "plan_review_requested"
  | "plan_review_approved"
  | "plan_review_denied"
  | "plan_review_timeout"
  | "permission_granted"
  | "permission_denied"
  | "permission_inherited"
  | "runtime_violation"
  | "runtime_halt"
  | "trust_profile_changed"
  | "merge_approval_requested"
  | "merge_approved"
  | "merge_denied"
  | "reauth_required"
  | "reauth_approved"
  | "reauth_denied"
  | "phase_gate_waiting"
  | "phase_gate_response"

export interface AuditEntry {
  timestamp: number
  action: AuditAction
  automationId?: string
  automationName?: string
  sessionId?: string
  /** Additional context */
  detail: Record<string, unknown>
}

// ── Storage ──

const AUDIT_DIR = join(getConfigDir(), "audit")
const MAX_ENTRIES_PER_FILE = 1000
const MAX_LOG_FILES = 30  // ~30 days of logs

function ensureDir(): void {
  mkdirSync(AUDIT_DIR, { recursive: true })
}

function getLogFile(date?: Date): string {
  const d = date || new Date()
  return join(AUDIT_DIR, `${d.toISOString().slice(0, 10)}.jsonl`)
}

// ── Write ──

export function auditLog(action: AuditAction, detail: Record<string, unknown> = {}, opts?: {
  automationId?: string
  automationName?: string
  sessionId?: string
}): void {
  try {
    ensureDir()
    const entry: AuditEntry = {
      timestamp: Date.now(),
      action,
      automationId: opts?.automationId,
      automationName: opts?.automationName,
      sessionId: opts?.sessionId,
      detail,
    }
    appendFileSync(getLogFile(), JSON.stringify(entry) + "\n", "utf-8")
  } catch (err) {
    log.warn(`[Audit] Failed to write audit entry: ${err}`)
  }
}

// ── Read ──

export function readAuditLog(date?: string): AuditEntry[] {
  try {
    // Defense-in-depth: validate date format even for internal callers
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
    const filePath = date ? join(AUDIT_DIR, `${date}.jsonl`) : getLogFile()
    if (!existsSync(filePath)) return []
    const content = readFileSync(filePath, "utf-8")
    return content.trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
  } catch {
    return []
  }
}

export function listAuditDates(): string[] {
  try {
    ensureDir()
    return readdirSync(AUDIT_DIR)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => f.replace(".jsonl", ""))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

/** Get recent audit entries across all dates, newest first */
export function getRecentAuditEntries(limit = 50): AuditEntry[] {
  const dates = listAuditDates()
  const entries: AuditEntry[] = []
  for (const date of dates) {
    if (entries.length >= limit) break
    const dayEntries = readAuditLog(date)
    entries.push(...dayEntries.reverse())
  }
  return entries.slice(0, limit)
}

/** Get audit entries for a specific automation */
export function getAutomationAudit(automationId: string, limit = 50): AuditEntry[] {
  const all = getRecentAuditEntries(500)
  return all.filter(e => e.automationId === automationId).slice(0, limit)
}

/** Prune old log files beyond MAX_LOG_FILES */
export function pruneAuditLogs(): void {
  try {
    const dates = listAuditDates()
    if (dates.length <= MAX_LOG_FILES) return
    const toDelete = dates.slice(MAX_LOG_FILES)
    for (const date of toDelete) {
      unlinkSync(join(AUDIT_DIR, `${date}.jsonl`))
    }
    log.info(`[Audit] Pruned ${toDelete.length} old audit log files`)
  } catch {
    // ignore
  }
}
