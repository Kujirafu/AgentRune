/**
 * Skill Analyzer — static analysis of skill content before execution.
 * Scans for suspicious patterns, produces a risk score.
 *
 * IMPORTANT: This module must NEVER crash the server or agent.
 * All analysis is wrapped in try-catch, input is size-limited,
 * and regex patterns are simple (no nested quantifiers → no ReDoS).
 */

import type { SkillManifest } from "./skill-manifest.js"
import { log } from "../shared/logger.js"

// ── Types ──

export interface SkillRiskFinding {
  pattern: string
  severity: "info" | "warning" | "danger"
  match: string  // the actual text that matched (truncated to 100 chars)
}

export interface SkillRiskReport {
  score: number           // 0-100
  level: "low" | "medium" | "high" | "critical"
  findings: SkillRiskFinding[]
  requiresManualReview: boolean  // true if score >= 60
  analyzedAt: number
}

// ── Constants ──

/** Max input size to analyze (100KB). Anything larger is truncated. */
const MAX_INPUT_BYTES = 100_000

/** Timeout for the entire analysis (5 seconds). */
const ANALYSIS_TIMEOUT_MS = 5_000

// ── Pattern definitions ──
// Each pattern: [regex, label, severity, weight]
// Regex rules: NO nested quantifiers, NO unbounded backrefs, keep simple.

type PatternDef = [RegExp, string, "info" | "warning" | "danger", number]

const PATTERNS: PatternDef[] = [
  // Network exfiltration
  [/\bcurl\s+/gi, "curl command", "warning", 10],
  [/\bwget\s+/gi, "wget command", "warning", 10],
  [/\bfetch\s*\(/gi, "fetch() call", "info", 5],
  [/https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/gi, "URL with raw IP address", "danger", 20],
  [/\bnc\s+-[a-z]*\s/gi, "netcat command", "danger", 25],
  [/\bssh\s+/gi, "SSH command", "warning", 15],

  // Destructive commands
  [/\brm\s+-[a-z]*r[a-z]*f/gi, "rm -rf command", "danger", 30],
  [/\brm\s+-[a-z]*f[a-z]*r/gi, "rm -fr command", "danger", 30],
  [/\bdel\s+\/s/gi, "del /s (Windows recursive delete)", "danger", 30],
  [/\bmkfs\b/gi, "mkfs (format disk)", "danger", 40],
  [/\bformat\s+[a-z]:/gi, "format drive", "danger", 40],
  [/\bdd\s+if=/gi, "dd command", "danger", 25],

  // Credential / wallet access
  [/\bwallet\b/gi, "wallet reference", "warning", 10],
  [/\bseed\s*phrase/gi, "seed phrase reference", "danger", 25],
  [/\bprivate[._-]?key/gi, "private key reference", "danger", 25],
  [/\bmnemonic\b/gi, "mnemonic reference", "danger", 20],
  [/\bkeystore\b/gi, "keystore reference", "warning", 15],
  [/\b\.env\b/gi, ".env file reference", "warning", 8],
  [/\bpassword\s*[=:]/gi, "password assignment", "warning", 15],
  [/\bsecret\s*[=:]/gi, "secret assignment", "warning", 12],
  [/\bapi[_-]?key\s*[=:]/gi, "API key assignment", "warning", 12],

  // Prompt injection
  [/ignore\s+(all\s+)?previous\s+instructions/gi, "prompt injection: ignore instructions", "danger", 35],
  [/you\s+are\s+now\s+/gi, "prompt injection: role override", "danger", 30],
  [/system\s*prompt\s*override/gi, "prompt injection: system override", "danger", 35],
  [/\bforget\s+(everything|all|your)\b/gi, "prompt injection: forget context", "danger", 30],
  [/\bact\s+as\s+(if|though)\b/gi, "prompt injection: act as", "warning", 10],

  // Obfuscation
  [/\batob\s*\(/gi, "base64 decode (atob)", "warning", 15],
  [/Buffer\.from\s*\([^)]*,\s*['"]base64['"]/gi, "Buffer.from base64", "warning", 15],
  [/\beval\s*\(/gi, "eval() call", "danger", 25],
  [/new\s+Function\s*\(/gi, "new Function() constructor", "danger", 25],
  [/\\x[0-9a-f]{2}/gi, "hex-escaped string", "info", 5],

  // Privilege escalation
  [/\bsudo\s+/gi, "sudo command", "danger", 20],
  [/\bchmod\s+[0-7]*7[0-7]*/gi, "chmod world-writable", "warning", 15],
  [/\bchown\s+/gi, "chown command", "warning", 10],
]

// ── Analysis ──

/**
 * Analyze skill content for suspicious patterns.
 * Safe to call on any input — never throws, never hangs.
 */
export function analyzeSkillContent(
  content: string,
  manifest?: SkillManifest
): SkillRiskReport {
  const startTime = Date.now()

  // Default safe return for edge cases
  const safeDefault: SkillRiskReport = {
    score: 0,
    level: "low",
    findings: [],
    requiresManualReview: false,
    analyzedAt: Date.now(),
  }

  try {
    // Guard: empty input
    if (!content || typeof content !== "string") {
      return safeDefault
    }

    // Guard: truncate oversized input
    const text = content.length > MAX_INPUT_BYTES
      ? content.slice(0, MAX_INPUT_BYTES)
      : content

    const findings: SkillRiskFinding[] = []
    let totalScore = 0

    for (const [regex, label, severity, weight] of PATTERNS) {
      // Timeout check — abort if analysis takes too long
      if (Date.now() - startTime > ANALYSIS_TIMEOUT_MS) {
        log.warn("[skill-analyzer] Analysis timed out, returning partial results")
        findings.push({
          pattern: "analysis_timeout",
          severity: "warning",
          match: `Analysis timed out after ${ANALYSIS_TIMEOUT_MS}ms`,
        })
        totalScore += 10
        break
      }

      try {
        // Reset regex state (global flag)
        regex.lastIndex = 0
        const match = regex.exec(text)
        if (match) {
          findings.push({
            pattern: label,
            severity,
            match: match[0].slice(0, 100),
          })
          totalScore += weight

          // Check for multiple occurrences (adds half weight per extra match)
          regex.lastIndex = 0
          let count = 0
          while (regex.exec(text) && count < 10) count++
          if (count > 1) {
            totalScore += Math.floor(weight * 0.3 * Math.min(count - 1, 5))
          }
        }
      } catch {
        // Individual regex failure — skip it, don't crash
        continue
      }
    }

    // Manifest-specific checks
    if (manifest) {
      try {
        if (manifest.walletAccess) {
          findings.push({
            pattern: "manifest_wallet_access",
            severity: "danger",
            match: "Manifest declares wallet access",
          })
          totalScore += 15
        }
        if ((manifest.permissions.network || []).length > 5) {
          findings.push({
            pattern: "many_network_hosts",
            severity: "warning",
            match: `Manifest declares ${manifest.permissions.network!.length} network hosts`,
          })
          totalScore += 5
        }
      } catch {
        // Manifest check failure — skip
      }
    }

    // Cap score at 100
    const score = Math.min(totalScore, 100)
    const level = score >= 80 ? "critical"
      : score >= 60 ? "high"
      : score >= 30 ? "medium"
      : "low"

    return {
      score,
      level,
      findings,
      requiresManualReview: score >= 60,
      analyzedAt: Date.now(),
    }
  } catch (err) {
    // Catastrophic failure — return safe default, log the error
    log.error(`[skill-analyzer] Unexpected error: ${err}`)
    return safeDefault
  }
}

/**
 * Quick check: is this content likely safe?
 * Lightweight version for hot paths.
 */
export function isLikelySafe(content: string): boolean {
  try {
    if (!content || content.length > MAX_INPUT_BYTES) return false
    const report = analyzeSkillContent(content)
    return report.score < 30
  } catch {
    return false
  }
}
