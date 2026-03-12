/**
 * Standards Validator — validates agent work against development standards
 *
 * Runs checklist after agent completes work, reports pass/fail per rule.
 */

import { existsSync } from "fs"
import { join } from "path"
import { execFileSync } from "child_process"
import type { MergedStandards, StandardRule } from "./standards-loader.js"

// ── Types ──

export interface ValidationResult {
  ruleId: string
  category: string
  severity: StandardRule["severity"]
  title: string
  passed: boolean
  message: string
}

export interface ValidationReport {
  timestamp: number
  projectPath: string
  results: ValidationResult[]
  passed: boolean // all errors passed
  summary: {
    total: number
    passed: number
    failed: number
    errors: number   // failed with severity=error
    warnings: number // failed with severity=warning
  }
}

// ── Validators ──

type RuleValidator = (rule: StandardRule, ctx: ValidationContext) => ValidationResult

interface ValidationContext {
  projectPath: string
  changedFiles: string[]
  commitMessages: string[]
  sessionEvents?: any[]
  prdTaskCount?: number
}

function getChangedFiles(projectPath: string): string[] {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "HEAD~1", "HEAD"], { cwd: projectPath, encoding: "utf-8", timeout: 5000 })
    return out.trim().split("\n").filter(Boolean)
  } catch {
    try {
      const out = execFileSync("git", ["diff", "--name-only", "--cached"], { cwd: projectPath, encoding: "utf-8", timeout: 5000 })
      return out.trim().split("\n").filter(Boolean)
    } catch {
      return []
    }
  }
}

function getRecentCommitMessages(projectPath: string, count = 5): string[] {
  try {
    // Validate count is a safe integer to prevent argument injection
    const safeCount = Math.max(1, Math.min(100, Math.floor(Number(count) || 5)))
    const out = execFileSync("git", ["log", "--oneline", `-${safeCount}`], { cwd: projectPath, encoding: "utf-8", timeout: 5000 })
    return out.trim().split("\n").filter(Boolean)
  } catch {
    return []
  }
}

// ── Rule-specific validators ──

const validators: Record<string, RuleValidator> = {
  // Git Flow
  "commit-messages": (rule, ctx) => {
    const conventionalPattern = /^[a-f0-9]+ (feat|fix|refactor|docs|chore|test|perf|ci|style|build)(\(.+\))?[!]?: .+/
    const bad = ctx.commitMessages.filter(m => !conventionalPattern.test(m))
    if (bad.length === 0) {
      return { ruleId: rule.id, category: rule.category, severity: rule.severity, title: rule.title, passed: true, message: "All commits follow conventional format" }
    }
    return { ruleId: rule.id, category: rule.category, severity: rule.severity, title: rule.title, passed: false, message: `Non-conventional commits:\n${bad.map(m => `  - ${m}`).join("\n")}` }
  },

  "branch-naming": (rule, ctx) => {
    try {
      const branch = execFileSync("git", ["branch", "--show-current"], { cwd: ctx.projectPath, encoding: "utf-8", timeout: 3000 }).trim()
      const validPattern = /^(feat|fix|refactor|docs|chore|hotfix|release|main|master|dev|develop)\/?.*/
      if (validPattern.test(branch) || ["main", "master", "dev", "develop"].includes(branch)) {
        return { ruleId: rule.id, category: rule.category, severity: rule.severity, title: rule.title, passed: true, message: `Branch "${branch}" follows naming convention` }
      }
      return { ruleId: rule.id, category: rule.category, severity: rule.severity, title: rule.title, passed: false, message: `Branch "${branch}" doesn't follow {type}/{description} pattern` }
    } catch {
      return { ruleId: rule.id, category: rule.category, severity: rule.severity, title: rule.title, passed: true, message: "Could not determine branch name" }
    }
  },

  // Best Practices
  "no-secrets-in-code": (rule, ctx) => {
    const secretPatterns = [
      /(?:api[_-]?key|apikey)\s*[:=]\s*["'][^"']{10,}/i,
      /(?:secret|password|passwd|token)\s*[:=]\s*["'][^"']{8,}/i,
      /sk-[a-zA-Z0-9]{20,}/,
      /ghp_[a-zA-Z0-9]{36}/,
    ]
    const violations: string[] = []
    for (const file of ctx.changedFiles) {
      const fullPath = join(ctx.projectPath, file)
      if (!existsSync(fullPath)) continue
      if (file.endsWith(".md") || file.endsWith(".lock") || file.endsWith(".json")) continue
      try {
        const { readFileSync } = require("fs")
        const content = readFileSync(fullPath, "utf-8")
        for (const pat of secretPatterns) {
          if (pat.test(content)) {
            violations.push(file)
            break
          }
        }
      } catch { /* skip unreadable */ }
    }
    if (violations.length === 0) {
      return { ruleId: rule.id, category: rule.category, severity: rule.severity, title: rule.title, passed: true, message: "No secrets detected in changed files" }
    }
    return { ruleId: rule.id, category: rule.category, severity: rule.severity, title: rule.title, passed: false, message: `Potential secrets found in:\n${violations.map(f => `  - ${f}`).join("\n")}` }
  },

  // Workflow
  "complex-feature-docs": (rule, ctx) => {
    // Check if Guide, Flow, Sequence docs exist for the project
    const docsDir = join(ctx.projectPath, ".agentrune", "docs")
    const researchDir = join(ctx.projectPath, ".agentrune", "research")
    const requiredTypes = ["guide", "flow", "sequence"]

    // Only validate if this looks like a complex feature (many files changed or PRD has many tasks)
    const isComplex = ctx.changedFiles.length >= 10 || (ctx.prdTaskCount && ctx.prdTaskCount >= 5)
    if (!isComplex) {
      return { ruleId: rule.id, category: rule.category, severity: rule.severity, title: rule.title, passed: true, message: "Feature does not meet complexity threshold, docs not required" }
    }

    const missing: string[] = []
    for (const docType of requiredTypes) {
      const hasDoc = [docsDir, researchDir].some(dir => {
        if (!existsSync(dir)) return false
        try {
          const files = require("fs").readdirSync(dir) as string[]
          return files.some((f: string) => f.toLowerCase().includes(docType))
        } catch { return false }
      })
      if (!hasDoc) missing.push(docType)
    }

    if (missing.length === 0) {
      return { ruleId: rule.id, category: rule.category, severity: rule.severity, title: rule.title, passed: true, message: "All required docs (Guide, Flow, Sequence) found" }
    }
    return { ruleId: rule.id, category: rule.category, severity: rule.severity, title: rule.title, passed: false, message: `Missing required docs: ${missing.join(", ")}` }
  },
}

// ── Default validator (always passes with info) ──

function defaultValidator(rule: StandardRule, _ctx: ValidationContext): ValidationResult {
  return {
    ruleId: rule.id,
    category: rule.category,
    severity: rule.severity,
    title: rule.title,
    passed: true,
    message: "Manual verification required — rule injected into agent prompt",
  }
}

// ── Main ──

export function validateStandards(
  standards: MergedStandards,
  projectPath: string,
  options?: { sessionEvents?: any[]; prdTaskCount?: number }
): ValidationReport {
  const changedFiles = getChangedFiles(projectPath)
  const commitMessages = getRecentCommitMessages(projectPath)
  const ctx: ValidationContext = {
    projectPath,
    changedFiles,
    commitMessages,
    sessionEvents: options?.sessionEvents,
    prdTaskCount: options?.prdTaskCount,
  }

  const results: ValidationResult[] = []

  for (const category of standards.categories) {
    for (const rule of category.rules) {
      if (!rule.enabled) continue
      const validator = validators[rule.id] || defaultValidator
      results.push(validator(rule, ctx))
    }
  }

  const failed = results.filter(r => !r.passed)
  const errors = failed.filter(r => r.severity === "error")
  const warnings = failed.filter(r => r.severity === "warning")

  return {
    timestamp: Date.now(),
    projectPath,
    results,
    passed: errors.length === 0,
    summary: {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: failed.length,
      errors: errors.length,
      warnings: warnings.length,
    },
  }
}
