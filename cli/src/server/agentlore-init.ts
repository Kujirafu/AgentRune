/**
 * agentlore-init.ts — Initialize and manage the agentlore directory structure.
 *
 * agentlore.md is the project memory index (like MEMORY.md in Claude Code).
 * Actual content lives in separate section files under .agentrune/context/.
 *
 * Directory structure:
 *   .agentrune/
 *     agentlore.md         <- Summary + index (read first, kept short)
 *     rules.md             <- Behavior rules (existing)
 *     context/
 *       stack.md            <- Tech stack, conventions, key files
 *       decisions.md        <- Architecture decisions (AD-xxx)
 *       lessons.md          <- Lessons learned, pitfalls
 *       security.md         <- Security audit findings
 *       changelog.md        <- Change history
 *       bugs.md             <- Bug root cause analysis
 *
 * For users with external vaults (e.g. Obsidian), agentlore.md can point
 * to an external directory via the `contextPath` field.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

export interface ContextSectionDefinition {
  name: string
  heading: string
  description: string
  keywords: string[]
  taskTypes: string[]
  pathHints: string[]
  template: string
}

export interface ContextSectionSummary {
  file: string
  name: string
  description: string
  keywords: string[]
  taskTypes: string[]
  pathHints: string[]
  exists: boolean
  path: string
}

export interface ContextSearchResult {
  file: string
  name: string
  description: string
  score: number
  snippets: string[]
  path: string
}

export interface ContextRouteRequest {
  task?: string
  changedFiles?: string[]
  maxSections?: number
}

export interface ContextRouteResult {
  task: string
  changedFiles: string[]
  sections: Array<ContextSearchResult & { reasons: string[] }>
  fallbackResults: ContextSearchResult[]
}

/** Default section files that get created for new projects */
const SECTION_DEFINITIONS: ContextSectionDefinition[] = [
  {
    name: "stack.md",
    heading: "Stack & Conventions",
    description: "Tech stack, conventions, key files, repo structure, and build or release workflow.",
    keywords: ["stack", "convention", "build", "release", "setup", "onboarding", "key files", "repo", "structure", "architecture", "依賴", "技術棧", "建置", "發版", "專案結構"],
    taskTypes: ["setup", "onboarding", "build", "refactor", "integration"],
    pathHints: ["package.json", "app/", "cli/", "desktop/", "docs/", "tsconfig", "vite", "electron"],
    template: `# Stack & Conventions

## Tech Stack
<!-- List your tech stack here -->

## Conventions
<!-- Coding conventions, naming patterns, etc. -->

## Key Files
<!-- Important files and their purposes -->

## Build & Release
<!-- Build commands, release process -->
`,
  },
  {
    name: "decisions.md",
    heading: "Architecture Decisions",
    description: "Long-lived architecture decisions, tradeoffs, and policy boundaries.",
    keywords: ["decision", "architecture", "tradeoff", "policy", "boundary", "design", "ADR", "constraint", "架構", "決策", "取捨", "規則", "策略"],
    taskTypes: ["design", "architecture", "planning", "policy", "refactor"],
    pathHints: ["README.md", "docs/", "architecture", "design", "policy"],
    template: `# Architecture Decisions

<!-- Record architecture decisions in AD-xxx format -->
<!-- Example:
## AD-001: Use inline styles instead of CSS modules
- Date: 2026-01-01
- Status: Accepted
- Context: ...
- Decision: ...
- Consequences: ...
-->
`,
  },
  {
    name: "lessons.md",
    heading: "Lessons Learned",
    description: "Pitfalls, debugging lessons, testing gotchas, and operational reminders.",
    keywords: ["lesson", "pitfall", "debug", "testing", "playwright", "vitest", "regression", "gotcha", "教訓", "踩坑", "除錯", "測試", "回歸"],
    taskTypes: ["debug", "testing", "review", "qa", "maintenance"],
    pathHints: ["test", "spec", "playwright", "vitest", "e2e", "__tests__"],
    template: `# Lessons Learned

<!-- Record pitfalls, gotchas, and insights discovered during development -->
`,
  },
  {
    name: "security.md",
    heading: "Security",
    description: "Security findings, auth boundaries, secret handling, and remaining risks.",
    keywords: ["security", "auth", "token", "tunnel", "secret", "permission", "vulnerability", "漏洞", "安全", "權限", "認證", "金鑰", "風險"],
    taskTypes: ["security", "auth", "audit", "hardening", "review"],
    pathHints: ["auth", "request-security", "vault", "token", "secret", "tunnel", "ws-server.ts"],
    template: `# Security Audit Log

<!-- Record security findings, fixes, and remaining risks -->
`,
  },
  {
    name: "changelog.md",
    heading: "Changelog",
    description: "Recent validated changes, verification notes, and rollout snapshots.",
    keywords: ["changelog", "recent", "latest", "verification", "validated", "release notes", "更新", "最近", "驗證", "變更"],
    taskTypes: ["handoff", "verification", "release", "summary", "review"],
    pathHints: ["CHANGELOG", "release", "version", "build", "test"],
    template: `# Changelog

<!-- Record significant changes by date -->
`,
  },
  {
    name: "bugs.md",
    heading: "Bug Reports",
    description: "Bug root causes, regressions, symptoms, and concrete fixes.",
    keywords: ["bug", "root cause", "regression", "failure", "watcher", "resume", "sync", "error", "bugfix", "錯誤", "根因", "回歸", "同步", "崩潰"],
    taskTypes: ["bugfix", "debug", "incident", "regression", "recovery"],
    pathHints: ["ws-server.ts", "jsonl-watcher.ts", "agent-launch.ts", "AutomationSheet.tsx", "bug", "fix", "resume", "watcher"],
    template: `# Bug Reports

<!-- Record bug root cause analysis and fixes -->
`,
  },
]

const SECTION_FILES = SECTION_DEFINITIONS.map(({ name, heading, template }) => ({ name, heading, template }))
const ALLOWED_SECTION_FILES = new Set(SECTION_DEFINITIONS.map((section) => section.name))
const DEFAULT_MAX_ROUTE_SECTIONS = 3

const INTENT_PATTERNS: Array<{ pattern: RegExp; boosts: Record<string, number>; reason: string }> = [
  {
    pattern: /\b(security|auth|token|tunnel|secret|permission|vulnerability|漏洞|安全|認證|權限|金鑰)\b/i,
    boosts: { "security.md": 20, "decisions.md": 6, "bugs.md": 4 },
    reason: "task is security-related",
  },
  {
    pattern: /\b(bug|fix|failure|error|regression|resume|watcher|sync|錯誤|修復|回歸|同步|恢復)\b/i,
    boosts: { "bugs.md": 18, "lessons.md": 10, "changelog.md": 4 },
    reason: "task is a bug or regression investigation",
  },
  {
    pattern: /\b(test|testing|playwright|vitest|e2e|qa|測試|驗證)\b/i,
    boosts: { "lessons.md": 16, "changelog.md": 6, "stack.md": 4 },
    reason: "task is test or verification focused",
  },
  {
    pattern: /\b(build|setup|install|release|package|electron|capacitor|建置|安裝|發版)\b/i,
    boosts: { "stack.md": 18, "changelog.md": 5, "decisions.md": 3 },
    reason: "task is build or setup related",
  },
  {
    pattern: /\b(decision|architecture|design|policy|tradeoff|ADR|架構|決策|設計|策略|取捨)\b/i,
    boosts: { "decisions.md": 18, "stack.md": 5 },
    reason: "task is architecture or policy related",
  },
  {
    pattern: /\b(latest|recent|what changed|handoff|summary|最近|更新|變更|交接)\b/i,
    boosts: { "changelog.md": 18, "bugs.md": 4 },
    reason: "task needs recent validated changes",
  },
]

export function isAllowedContextSectionFile(sectionFile: string): boolean {
  return ALLOWED_SECTION_FILES.has(sectionFile)
}

/** Generate the agentlore.md index content */
function generateIndex(projectName: string, contextDir: string): string {
  const sectionLinks = SECTION_DEFINITIONS.map(
    (s) => `- [${s.heading}](${contextDir}/${s.name}) — ${s.description}`
  ).join("\n")

  return `# ${projectName}

## Summary
<!-- Brief description of the project (2-3 sentences) -->

## Stack
<!-- Keep only the essentials here. Full details in context/stack.md -->

## Index

Detailed documentation is split into separate files. Read only the relevant section when you need deeper context:

${sectionLinks}

## How to Use This File
- Read this file at session start for a quick project overview
- Do not load every memory section by default
- Use the index to read only the section that matches the current task
- If the right section is unclear, search the section files before reading more broadly
- When you learn something new, update the relevant section file (not this index)
- Keep this index file concise (under 100 lines)
- After significant work, update the changelog and lessons sections
`
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}./_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function scoreKeywordMatches(haystack: string, keywords: string[], reasons: string[], reasonPrefix: string, weight: number): number {
  let score = 0
  for (const keyword of keywords) {
    const normalized = normalizeText(keyword)
    if (!normalized || !haystack.includes(normalized)) continue
    score += weight
    if (!reasons.includes(`${reasonPrefix}: ${keyword}`)) {
      reasons.push(`${reasonPrefix}: ${keyword}`)
    }
  }
  return score
}

function scorePathHintMatches(changedFiles: string[], pathHints: string[], reasons: string[]): number {
  let score = 0
  const normalizedFiles = changedFiles.map((file) => file.replace(/\\/g, "/").toLowerCase())
  for (const hint of pathHints) {
    const normalizedHint = hint.replace(/\\/g, "/").toLowerCase()
    const matchedFile = normalizedFiles.find((file) => file.includes(normalizedHint))
    if (!matchedFile) continue
    score += 8
    reasons.push(`matched changed file hint: ${hint}`)
  }
  return score
}

function buildSectionSummary(projectCwd: string, section: ContextSectionDefinition, externalPath?: string): ContextSectionSummary {
  const contextDir = getContextDir(projectCwd, externalPath)
  return {
    file: section.name,
    name: section.heading,
    description: section.description,
    keywords: [...section.keywords],
    taskTypes: [...section.taskTypes],
    pathHints: [...section.pathHints],
    exists: existsSync(join(contextDir, section.name)),
    path: join(contextDir, section.name),
  }
}

function collectSnippets(content: string, queryTokens: string[], maxSnippets = 3): string[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (queryTokens.length === 0) return lines.slice(0, maxSnippets)

  const snippets: string[] = []
  for (const line of lines) {
    const haystack = normalizeText(line)
    if (queryTokens.some((token) => haystack.includes(token))) {
      snippets.push(line)
    }
    if (snippets.length >= maxSnippets) break
  }

  return snippets.length > 0 ? snippets : lines.slice(0, maxSnippets)
}

function scoreSectionContent(content: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0
  const haystack = normalizeText(content)
  let score = 0
  for (const token of queryTokens) {
    if (!token || !haystack.includes(token)) continue
    score += token.length >= 5 ? 4 : 2
  }
  return score
}

/** Context directory path — either custom (external vault) or default (.agentrune/context/) */
export function getContextDir(projectCwd: string, externalPath?: string): string {
  if (externalPath) return resolve(externalPath)
  return join(projectCwd, ".agentrune", "context")
}

/** Check if the agentlore directory structure exists */
export function hasAgentloreStructure(projectCwd: string): boolean {
  const contextDir = getContextDir(projectCwd)
  return existsSync(contextDir) && existsSync(join(contextDir, "stack.md"))
}

/** Initialize the agentlore directory structure for a project */
export function initAgentloreStructure(
  projectCwd: string,
  options?: { projectName?: string; externalPath?: string }
): { indexPath: string; contextDir: string; created: string[] } {
  const projectName = options?.projectName || projectCwd.split(/[\\/]/).pop() || "Project"
  const contextDir = getContextDir(projectCwd, options?.externalPath)
  const agentruneDir = join(projectCwd, ".agentrune")
  const indexPath = join(agentruneDir, "agentlore.md")

  // Ensure directories exist
  mkdirSync(agentruneDir, { recursive: true })
  mkdirSync(contextDir, { recursive: true })

  const created: string[] = []

  // Create section files (only if they don't exist)
  for (const section of SECTION_FILES) {
    const filePath = join(contextDir, section.name)
    if (!existsSync(filePath)) {
      writeFileSync(filePath, section.template, "utf-8")
      created.push(section.name)
    }
  }

  // Compute relative context path for the index
  const relContextDir = options?.externalPath
    ? options.externalPath
    : "context"

  // Create or update agentlore.md index (only if it doesn't exist OR is the old monolithic format)
  if (!existsSync(indexPath) || isMonolithicAgentlore(indexPath)) {
    const indexContent = generateIndex(projectName, relContextDir)
    writeFileSync(indexPath, indexContent, "utf-8")
    created.push("agentlore.md")
  }

  return { indexPath, contextDir, created }
}

/** Detect if an existing agentlore.md is the old monolithic format (> 100 lines with ## Lessons or ## Security) */
function isMonolithicAgentlore(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, "utf-8")
    const lines = content.split("\n").length
    // Old format: very long + has section headings that should be in separate files
    return (
      lines > 150 &&
      (/^## Lessons/m.test(content) || /^## Security/m.test(content) || /^## Decisions/m.test(content))
    )
  } catch {
    return false
  }
}

/**
 * Migrate a monolithic agentlore.md into the directory structure.
 * Extracts known sections into separate files, keeps the rest as summary.
 */
export function migrateMonolithicAgentlore(
  projectCwd: string,
  options?: { externalPath?: string }
): { migrated: boolean; sections: string[] } {
  const indexPath = join(projectCwd, ".agentrune", "agentlore.md")
  if (!existsSync(indexPath)) return { migrated: false, sections: [] }

  const content = readFileSync(indexPath, "utf-8")
  if (!isMonolithicAgentlore(indexPath)) return { migrated: false, sections: [] }

  const contextDir = getContextDir(projectCwd, options?.externalPath)
  mkdirSync(contextDir, { recursive: true })

  const migrated: string[] = []

  // Section extraction patterns (heading → file)
  const sectionMap: { pattern: RegExp; file: string; heading: string }[] = [
    { pattern: /^## (?:Stack|Conventions)$/m, file: "stack.md", heading: "Stack & Conventions" },
    { pattern: /^## (?:Key Files|Build|Environment)/m, file: "stack.md", heading: "Stack & Conventions" },
    { pattern: /^## (?:Decisions|Key Decisions)/m, file: "decisions.md", heading: "Architecture Decisions" },
    { pattern: /^## Lessons/m, file: "lessons.md", heading: "Lessons Learned" },
    { pattern: /^## Security/m, file: "security.md", heading: "Security" },
    { pattern: /^## (?:Changelog|Changes)/m, file: "changelog.md", heading: "Changelog" },
    { pattern: /^## (?:Bug|Bugs)/m, file: "bugs.md", heading: "Bug Reports" },
  ]

  // Split content by ## headings
  const headingSplits = content.split(/(?=^## )/m)
  const summaryParts: string[] = []
  const fileContents = new Map<string, string[]>()

  for (const part of headingSplits) {
    let matched = false
    for (const mapping of sectionMap) {
      if (mapping.pattern.test(part)) {
        const existing = fileContents.get(mapping.file) || []
        existing.push(part)
        fileContents.set(mapping.file, existing)
        matched = true
        break
      }
    }
    if (!matched) {
      // Keep Context/Summary/Workflow/Obsidian sections in the index
      summaryParts.push(part)
    }
  }

  // Write extracted sections to files
  for (const [file, parts] of fileContents) {
    const filePath = join(contextDir, file)
    const fileContent = parts.join("\n").trim()
    if (fileContent.length > 50) {
      writeFileSync(filePath, fileContent + "\n", "utf-8")
      migrated.push(file)
    }
  }

  // Build new index from remaining summary parts + add Index section
  const relContextDir = options?.externalPath || "context"
  const sectionLinks = SECTION_DEFINITIONS.map(
    (s) => `- [${s.heading}](${relContextDir}/${s.name}) — ${s.description}`
  ).join("\n")

  const newIndex = summaryParts.join("\n").trim() + `

## Index

Detailed documentation is split into separate files:

${sectionLinks}

## How to Use This File
- Read this file at session start for a quick project overview
- Do not load every memory section by default
- Use the index to read only the section that matches the current task
- If the right section is unclear, search the section files before reading more broadly
- When you learn something new, update the relevant section file (not this index)
- Keep this index file concise (under 100 lines)
`

  writeFileSync(indexPath, newIndex, "utf-8")

  return { migrated: true, sections: migrated }
}

/** List available context sections for a project */
export function listContextSections(projectCwd: string, externalPath?: string): ContextSectionSummary[] {
  return SECTION_DEFINITIONS.map((section) => buildSectionSummary(projectCwd, section, externalPath))
}

/** Search context sections using metadata + lexical content matches. */
export function searchContextSections(
  projectCwd: string,
  query: string,
  options?: { externalPath?: string; limit?: number }
): ContextSearchResult[] {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return []

  const limit = clamp(options?.limit ?? 5, 1, 20)
  const queryTokens = tokenize(query)
  const results: ContextSearchResult[] = []

  for (const section of SECTION_DEFINITIONS) {
    const summary = buildSectionSummary(projectCwd, section, options?.externalPath)
    if (!summary.exists) continue

    const metadataHaystack = normalizeText([
      section.heading,
      section.description,
      section.keywords.join(" "),
      section.taskTypes.join(" "),
      section.pathHints.join(" "),
    ].join(" "))

    const content = readContextSection(projectCwd, section.name, options?.externalPath)
    const metadataScore = scoreKeywordMatches(metadataHaystack, queryTokens, [], "metadata", 5)
    const contentScore = scoreSectionContent(content, queryTokens)
    const exactPhraseBonus = metadataHaystack.includes(normalizedQuery) || normalizeText(content).includes(normalizedQuery) ? 8 : 0
    const score = metadataScore + contentScore + exactPhraseBonus
    if (score <= 0) continue

    results.push({
      file: section.name,
      name: section.heading,
      description: section.description,
      score,
      snippets: collectSnippets(content, queryTokens),
      path: summary.path,
    })
  }

  return results
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, limit)
}

/** Route the current task to the memory sections most worth reading first. */
export function routeContextSections(
  projectCwd: string,
  request: ContextRouteRequest,
  options?: { externalPath?: string }
): ContextRouteResult {
  const task = request.task?.trim() || ""
  const changedFiles = Array.isArray(request.changedFiles)
    ? request.changedFiles.filter((file): file is string => typeof file === "string" && file.trim().length > 0)
    : []
  const maxSections = clamp(request.maxSections ?? DEFAULT_MAX_ROUTE_SECTIONS, 1, 6)

  const combinedHaystack = normalizeText([task, ...changedFiles].join(" "))
  const queryTokens = tokenize([task, ...changedFiles].join(" "))
  const fallbackResults = task
    ? searchContextSections(projectCwd, [task, ...changedFiles].join(" "), { externalPath: options?.externalPath, limit: maxSections + 2 })
    : []

  const fallbackScoreMap = new Map(fallbackResults.map((result) => [result.file, result]))

  const ranked = SECTION_DEFINITIONS
    .map((section) => {
      const summary = buildSectionSummary(projectCwd, section, options?.externalPath)
      const reasons: string[] = []
      let score = 0

      score += scoreKeywordMatches(combinedHaystack, section.taskTypes, reasons, "matched task type", 6)
      score += scoreKeywordMatches(combinedHaystack, section.keywords, reasons, "matched keyword", 4)
      score += scorePathHintMatches(changedFiles, section.pathHints, reasons)

      for (const intent of INTENT_PATTERNS) {
        if (!intent.pattern.test(task)) continue
        const boost = intent.boosts[section.name] || 0
        if (boost > 0) {
          score += boost
          reasons.push(intent.reason)
        }
      }

      const fallback = fallbackScoreMap.get(section.name)
      if (fallback) {
        score += Math.min(fallback.score, 12)
        reasons.push("matched indexed memory search")
      }

      return {
        file: section.name,
        name: section.heading,
        description: section.description,
        path: summary.path,
        exists: summary.exists,
        score,
        reasons: [...new Set(reasons)],
        snippets: fallback?.snippets || [],
      }
    })
    .filter((section) => section.exists)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))

  const topMatches = ranked.filter((section) => section.score > 0).slice(0, maxSections)

  const sections = (topMatches.length > 0 ? topMatches : ranked.slice(0, maxSections)).map((section) => ({
    file: section.file,
    name: section.name,
    description: section.description,
    score: section.score,
    snippets: section.snippets,
    path: section.path,
    reasons: section.reasons.length > 0
      ? section.reasons
      : ["default fallback from memory index"],
  }))

  return {
    task,
    changedFiles,
    sections,
    fallbackResults: fallbackResults.filter((result) => !sections.some((section) => section.file === result.file)),
  }
}

/** Read a specific context section */
export function readContextSection(projectCwd: string, sectionFile: string, externalPath?: string): string {
  if (!isAllowedContextSectionFile(sectionFile)) return ""
  const contextDir = getContextDir(projectCwd, externalPath)
  const filePath = join(contextDir, sectionFile)
  if (!existsSync(filePath)) return ""
  try {
    return readFileSync(filePath, "utf-8")
  } catch {
    return ""
  }
}

/** Write to a specific context section */
export function writeContextSection(projectCwd: string, sectionFile: string, content: string, externalPath?: string): void {
  if (!isAllowedContextSectionFile(sectionFile)) {
    throw new Error(`Invalid context section file: ${sectionFile}`)
  }
  const contextDir = getContextDir(projectCwd, externalPath)
  mkdirSync(contextDir, { recursive: true })
  writeFileSync(join(contextDir, sectionFile), content, "utf-8")
}
