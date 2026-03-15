/**
 * Skill Monitor — runtime behavior monitoring for automated skill execution.
 * Watches PTY output for deviations from the declared manifest permissions.
 *
 * IMPORTANT: This module must NEVER crash the server or agent.
 * All monitoring is wrapped in try-catch, pattern matching is simple,
 * and auto-halt is opt-in (default: warn only).
 */

import type { SkillManifest } from "./skill-manifest.js"
import { log } from "../shared/logger.js"
import { type AuthorityMap, hasPermission, violationTypeToPermissionKey } from "./authority-map.js"

// ── Types ──

export interface MonitorViolation {
  type: "filesystem" | "network" | "shell" | "wallet" | "env"
  description: string
  matchedText: string   // truncated to 200 chars
  timestamp: number
  severity: "warning" | "critical"
}

export interface MonitorConfig {
  manifest: SkillManifest
  projectCwd: string
  /** Auto-halt on critical violation (default: false — warn only) */
  autoHalt?: boolean
  /** Callback when violation detected */
  onViolation?: (violation: MonitorViolation) => void
  /** Callback to kill the PTY session */
  onHalt?: (reason: string) => void
  /** Authority map for permission-based enforcement (resumed sessions) */
  authorityMap?: AuthorityMap
  /** Is this a resumed session? If true, critical violations with expired/inherited permissions trigger halt */
  isResumedSession?: boolean
  /** Callback when a reauth is needed — violation that requires user re-authorization */
  onReauthRequired?: (violation: MonitorViolation, permissionKey: string) => void
}

export interface MonitorStats {
  linesProcessed: number
  violationsDetected: number
  startedAt: number
  lastActivityAt: number
  halted: boolean
  haltReason?: string
}

// ── Pattern definitions ──
// Simple patterns — no nested quantifiers, safe from ReDoS

interface MonitorPattern {
  regex: RegExp
  type: MonitorViolation["type"]
  severity: MonitorViolation["severity"]
  description: string
}

const FILESYSTEM_PATTERNS: MonitorPattern[] = [
  { regex: /\b(cat|head|tail|less|more|nano|vim?|code)\s+["']?([^\s"']+)/gi, type: "filesystem", severity: "warning", description: "File read" },
  { regex: /\b(echo|printf|tee)\s+.*?>+\s*["']?([^\s"']+)/gi, type: "filesystem", severity: "warning", description: "File write via redirect" },
  { regex: /\bwrite\s+(to\s+)?["']?([^\s"']+)/gi, type: "filesystem", severity: "warning", description: "File write" },
  { regex: /\brm\s+[-a-z]*\s*["']?([^\s"']+)/gi, type: "filesystem", severity: "critical", description: "File delete" },
]

const NETWORK_PATTERNS: MonitorPattern[] = [
  { regex: /\bcurl\s+[-a-z]*\s*["']?(https?:\/\/[^\s"']+)/gi, type: "network", severity: "warning", description: "curl request" },
  { regex: /\bwget\s+[-a-z]*\s*["']?(https?:\/\/[^\s"']+)/gi, type: "network", severity: "warning", description: "wget request" },
  { regex: /\bfetch\s*\(\s*["'](https?:\/\/[^\s"']+)/gi, type: "network", severity: "warning", description: "fetch() call" },
  { regex: /\bnc\s+-[a-z]*\s/gi, type: "network", severity: "critical", description: "netcat command" },
  { regex: /\bssh\s+/gi, type: "network", severity: "critical", description: "SSH command" },
]

const WALLET_PATTERNS: MonitorPattern[] = [
  { regex: /\bsign\s*transaction/gi, type: "wallet", severity: "critical", description: "Transaction signing" },
  { regex: /\btransfer\s+\d+/gi, type: "wallet", severity: "critical", description: "Token transfer" },
  { regex: /\bsend\s+sol\b/gi, type: "wallet", severity: "critical", description: "SOL transfer" },
  { regex: /\bseed\s*phrase/gi, type: "wallet", severity: "critical", description: "Seed phrase access" },
  { regex: /\bprivate[._-]?key/gi, type: "wallet", severity: "critical", description: "Private key access" },
]

const ENV_PATTERNS: MonitorPattern[] = [
  { regex: /\becho\s+\$([A-Z_]+)/gi, type: "env", severity: "warning", description: "Env var read" },
  { regex: /\bprintenv\s+([A-Z_]+)/gi, type: "env", severity: "warning", description: "Env var read" },
  { regex: /\bexport\s+([A-Z_]+)\s*=/gi, type: "env", severity: "warning", description: "Env var set" },
]

// ── Monitor class ──

export class SkillMonitor {
  private config: MonitorConfig
  private stats: MonitorStats
  private violations: MonitorViolation[] = []
  private lineBuffer = ""

  /** Max violations before auto-halt regardless of config (safety limit) */
  private static MAX_VIOLATIONS = 50
  /** Max line length to analyze (skip binary output) */
  private static MAX_LINE_LENGTH = 5000

  constructor(config: MonitorConfig) {
    this.config = config
    this.stats = {
      linesProcessed: 0,
      violationsDetected: 0,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      halted: false,
    }
  }

  /** Feed PTY output data to the monitor. Call this from the PTY data handler. */
  processOutput(data: string): void {
    if (this.stats.halted) return

    try {
      this.stats.lastActivityAt = Date.now()
      // Buffer partial lines
      this.lineBuffer += data
      const lines = this.lineBuffer.split(/\r?\n/)
      // Keep the last incomplete line in buffer
      this.lineBuffer = lines.pop() || ""

      for (const line of lines) {
        this.processLine(line)
        if (this.stats.halted) break
      }
    } catch (err) {
      // Never crash — just log
      log.warn(`[skill-monitor] Error processing output: ${err}`)
    }
  }

  private processLine(line: string): void {
    this.stats.linesProcessed++

    // Skip empty lines and very long lines (likely binary)
    if (!line || line.length > SkillMonitor.MAX_LINE_LENGTH) return

    // Strip ANSI escape codes for cleaner matching
    const clean = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim()
    if (!clean) return

    const allPatterns = [
      ...FILESYSTEM_PATTERNS,
      ...NETWORK_PATTERNS,
      ...WALLET_PATTERNS,
      ...ENV_PATTERNS,
    ]

    for (const pattern of allPatterns) {
      try {
        pattern.regex.lastIndex = 0
        const match = pattern.regex.exec(clean)
        if (!match) continue

        // Check if this action is allowed by manifest
        if (this.isAllowed(pattern.type, match[0])) continue

        const violation: MonitorViolation = {
          type: pattern.type,
          description: pattern.description,
          matchedText: match[0].slice(0, 200),
          timestamp: Date.now(),
          severity: pattern.severity,
        }

        this.violations.push(violation)
        this.stats.violationsDetected++
        log.warn(`[skill-monitor] Violation: ${violation.type} — ${violation.description}: "${violation.matchedText}"`)

        // Notify callback
        if (this.config.onViolation) {
          try { this.config.onViolation(violation) } catch {}
        }

        // Resumed session enforcement: critical violation + no valid permission → halt for reauth
        if (pattern.severity === "critical" && this.config.isResumedSession && this.config.authorityMap) {
          const permKey = violationTypeToPermissionKey(pattern.type)
          if (!hasPermission(this.config.authorityMap, permKey)) {
            log.warn(`[skill-monitor] Resumed session: critical violation "${permKey}" — no valid permission, requesting reauth`)
            if (this.config.onReauthRequired) {
              try { this.config.onReauthRequired(violation, permKey) } catch {}
            }
            this.halt(`Reauth required: ${violation.type} violation — ${violation.description}`)
            return
          }
        }

        // Auto-halt on critical violations (if enabled) or too many violations
        if (
          (pattern.severity === "critical" && this.config.autoHalt) ||
          this.stats.violationsDetected >= SkillMonitor.MAX_VIOLATIONS
        ) {
          this.halt(`${violation.type} violation: ${violation.description}`)
          return
        }
      } catch {
        // Individual pattern failure — skip
        continue
      }
    }
  }

  /** Check if an action is allowed by the manifest */
  private isAllowed(type: MonitorViolation["type"], matchedText: string): boolean {
    const m = this.config.manifest

    switch (type) {
      case "filesystem": {
        // Check if file path matches allowed read/write paths
        const paths = [
          ...(m.permissions.filesystem?.read || []),
          ...(m.permissions.filesystem?.write || []),
        ]
        if (paths.length === 0) return false
        // Allow if any path pattern matches (simple substring check)
        return paths.some(p => p === "./**" || matchedText.includes(p.replace(/\*\*/g, "")))
      }

      case "network": {
        const hosts = m.permissions.network || []
        if (hosts.length === 0) return false
        // Check if URL hostname is in allowed list
        return hosts.some(host => matchedText.toLowerCase().includes(host.toLowerCase()))
      }

      case "shell": {
        const cmds = m.permissions.shell || []
        if (cmds.length === 0) return false
        return cmds.some(cmd => matchedText.toLowerCase().startsWith(cmd.toLowerCase()))
      }

      case "wallet":
        return m.walletAccess === true

      case "env": {
        const envVars = m.permissions.env || []
        if (envVars.length === 0) return false
        return envVars.some(v => matchedText.toUpperCase().includes(v.toUpperCase()))
      }

      default:
        return false
    }
  }

  /** Halt execution — triggers onHalt callback */
  private halt(reason: string): void {
    if (this.stats.halted) return
    this.stats.halted = true
    this.stats.haltReason = reason
    log.warn(`[skill-monitor] HALTING: ${reason}`)

    if (this.config.onHalt) {
      try { this.config.onHalt(reason) } catch {}
    }
  }

  /** Get current monitoring stats */
  getStats(): MonitorStats {
    return { ...this.stats }
  }

  /** Get all violations detected so far */
  getViolations(): MonitorViolation[] {
    return [...this.violations]
  }

  /** Check if monitor has been halted */
  isHalted(): boolean {
    return this.stats.halted
  }

  /** Flush remaining buffer (call on session end) */
  flush(): void {
    if (this.lineBuffer) {
      this.processLine(this.lineBuffer)
      this.lineBuffer = ""
    }
  }
}
