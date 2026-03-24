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

/** Default section files that get created for new projects */
const SECTION_FILES: { name: string; heading: string; template: string }[] = [
  {
    name: "stack.md",
    heading: "Stack & Conventions",
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
    template: `# Lessons Learned

<!-- Record pitfalls, gotchas, and insights discovered during development -->
`,
  },
  {
    name: "security.md",
    heading: "Security",
    template: `# Security Audit Log

<!-- Record security findings, fixes, and remaining risks -->
`,
  },
  {
    name: "changelog.md",
    heading: "Changelog",
    template: `# Changelog

<!-- Record significant changes by date -->
`,
  },
  {
    name: "bugs.md",
    heading: "Bug Reports",
    template: `# Bug Reports

<!-- Record bug root cause analysis and fixes -->
`,
  },
]

const ALLOWED_SECTION_FILES = new Set(SECTION_FILES.map((section) => section.name))

export function isAllowedContextSectionFile(sectionFile: string): boolean {
  return ALLOWED_SECTION_FILES.has(sectionFile)
}

/** Generate the agentlore.md index content */
function generateIndex(projectName: string, contextDir: string): string {
  const sectionLinks = SECTION_FILES.map(
    (s) => `- [${s.heading}](${contextDir}/${s.name})`
  ).join("\n")

  return `# ${projectName}

## Summary
<!-- Brief description of the project (2-3 sentences) -->

## Stack
<!-- Keep only the essentials here. Full details in context/stack.md -->

## Index

Detailed documentation is split into separate files. Read the relevant section when you need deeper context:

${sectionLinks}

## How to Use This File
- Read this file at session start for a quick project overview
- Follow the links above to read specific sections as needed
- When you learn something new, update the relevant section file (not this index)
- Keep this index file concise (under 100 lines)
- After significant work, update the changelog and lessons sections
`
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
  const sectionLinks = SECTION_FILES.map(
    (s) => `- [${s.heading}](${relContextDir}/${s.name})`
  ).join("\n")

  const newIndex = summaryParts.join("\n").trim() + `

## Index

Detailed documentation is split into separate files:

${sectionLinks}

## How to Use This File
- Read this file at session start for a quick project overview
- Follow the links above to read specific sections as needed
- When you learn something new, update the relevant section file (not this index)
- Keep this index file concise (under 100 lines)
`

  writeFileSync(indexPath, newIndex, "utf-8")

  return { migrated: true, sections: migrated }
}

/** List available context sections for a project */
export function listContextSections(projectCwd: string, externalPath?: string): { name: string; exists: boolean; path: string }[] {
  const contextDir = getContextDir(projectCwd, externalPath)
  return SECTION_FILES.map((s) => ({
    name: s.heading,
    exists: existsSync(join(contextDir, s.name)),
    path: join(contextDir, s.name),
  }))
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
