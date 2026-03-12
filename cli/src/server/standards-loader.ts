/**
 * Standards Loader — reads and merges global + project-level development standards
 *
 * Global:  ~/.agentrune/standards/
 * Project: .agentrune/standards/
 *
 * Project rules override global rules (matched by rule id within same category).
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { homedir } from "os"

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Types ──

export interface StandardRule {
  id: string
  category: string
  severity: "error" | "warning" | "info"
  enabled: boolean
  title: string
  description: string
  trigger?: string // e.g. "complex" for complex-feature-specific rules
}

export interface StandardCategory {
  id: string
  name: Record<string, string> // { en, "zh-TW" }
  icon: string
  description: Record<string, string>
  builtin: boolean
  rules: StandardRule[]
}

export interface ComplexFeatureTrigger {
  type: string
  threshold?: number
  pattern?: string[]
  description: Record<string, string>
}

export interface StandardsConfig {
  version: number
  categories: Omit<StandardCategory, "rules">[]
  complexFeatureTriggers: {
    enabled: boolean
    requiredDocs: string[]
    defaultConditions: ComplexFeatureTrigger[]
  }
}

export interface MergedStandards {
  categories: StandardCategory[]
  complexFeatureTriggers: StandardsConfig["complexFeatureTriggers"]
  source: "global" | "project" | "merged"
}

// ── Paths ──

const GLOBAL_DIR = join(homedir(), ".agentrune", "standards")
const BUILTIN_DIR = join(__dirname, "..", "..", "..", ".agentrune", "standards")

function getProjectDir(projectPath: string): string {
  return join(projectPath, ".agentrune", "standards")
}

// ── Parser ──

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }
  const meta: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/)
    if (kv) meta[kv[1]] = kv[2].trim()
  }
  return { meta, body: match[2] }
}

function parseRulesFromMarkdown(content: string, categoryId: string): StandardRule[] {
  const { body } = parseFrontmatter(content)
  const rules: StandardRule[] = []
  const sections = body.split(/\n## /).slice(1) // split by h2

  for (const section of sections) {
    const lines = section.split("\n")
    const id = lines[0].trim()
    if (!id) continue

    let severity: StandardRule["severity"] = "warning"
    let enabled = true
    let trigger: string | undefined
    const descLines: string[] = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      const severityMatch = line.match(/^- severity:\s*(error|warning|info)/)
      const enabledMatch = line.match(/^- enabled:\s*(true|false)/)
      const triggerMatch = line.match(/^- trigger:\s*(\S+)/)
      if (severityMatch) severity = severityMatch[1] as StandardRule["severity"]
      else if (enabledMatch) enabled = enabledMatch[1] === "true"
      else if (triggerMatch) trigger = triggerMatch[1]
      else if (line.trim()) descLines.push(line)
    }

    rules.push({
      id,
      category: categoryId,
      severity,
      enabled,
      title: id.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      description: descLines.join("\n").trim(),
      ...(trigger && { trigger }),
    })
  }

  return rules
}

function serializeRulesToMarkdown(categoryId: string, rules: StandardRule[]): string {
  const lines = [
    "---",
    `category: ${categoryId}`,
    "version: 1",
    "---",
    "",
    `# ${categoryId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}`,
  ]

  for (const rule of rules) {
    lines.push("")
    lines.push(`## ${rule.id}`)
    lines.push(`- severity: ${rule.severity}`)
    lines.push(`- enabled: ${rule.enabled}`)
    if (rule.trigger) lines.push(`- trigger: ${rule.trigger}`)
    lines.push("")
    lines.push(rule.description)
  }

  return lines.join("\n") + "\n"
}

// ── Loader ──

function loadFromDir(dir: string): { config: StandardsConfig | null; rulesByCategory: Map<string, StandardRule[]> } {
  const configPath = join(dir, "config.json")
  let config: StandardsConfig | null = null
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"))
    } catch { /* skip invalid */ }
  }

  const rulesByCategory = new Map<string, StandardRule[]>()
  const catDir = join(dir, "categories")
  if (existsSync(catDir)) {
    for (const file of readdirSync(catDir).filter(f => f.endsWith(".md"))) {
      const categoryId = file.replace(/\.md$/, "")
      try {
        const content = readFileSync(join(catDir, file), "utf-8")
        rulesByCategory.set(categoryId, parseRulesFromMarkdown(content, categoryId))
      } catch { /* skip unreadable */ }
    }
  }

  return { config, rulesByCategory }
}

export function loadStandards(projectPath?: string): MergedStandards {
  // 1. Load builtin (shipped with AgentRune)
  const builtin = loadFromDir(BUILTIN_DIR)

  // 2. Load global (~/.agentrune/standards/)
  const global = loadFromDir(GLOBAL_DIR)

  // 3. Load project (.agentrune/standards/)
  const project = projectPath ? loadFromDir(getProjectDir(projectPath)) : { config: null, rulesByCategory: new Map() }

  // Config priority: project > global > builtin
  const config = project.config || global.config || builtin.config
  if (!config) {
    return {
      categories: [],
      complexFeatureTriggers: { enabled: false, requiredDocs: [], defaultConditions: [] },
      source: "global",
    }
  }

  // Merge rules: project overrides global overrides builtin (by rule id)
  const mergedCategories: StandardCategory[] = config.categories.map(cat => {
    const builtinRules = builtin.rulesByCategory.get(cat.id) || []
    const globalRules = global.rulesByCategory.get(cat.id) || []
    const projectRules = project.rulesByCategory.get(cat.id) || []

    // Build map: builtin -> global overlay -> project overlay
    const ruleMap = new Map<string, StandardRule>()
    for (const r of builtinRules) ruleMap.set(r.id, r)
    for (const r of globalRules) ruleMap.set(r.id, r)
    for (const r of projectRules) ruleMap.set(r.id, r)

    return { ...cat, rules: Array.from(ruleMap.values()) }
  })

  // Include project-only categories not in config
  if (projectPath) {
    for (const [catId, rules] of project.rulesByCategory) {
      if (!mergedCategories.find(c => c.id === catId)) {
        mergedCategories.push({
          id: catId,
          name: { en: catId.replace(/-/g, " ").replace(/\b\w/g, (ch: string) => ch.toUpperCase()), "zh-TW": catId },
          icon: "file-text",
          description: { en: "Custom category", "zh-TW": "自訂分類" },
          builtin: false,
          rules,
        })
      }
    }
  }

  const source = project.config ? "project" : global.config ? "global" : "merged"

  return {
    categories: mergedCategories,
    complexFeatureTriggers: config.complexFeatureTriggers,
    source,
  }
}

// ── Writer ──

export function saveRule(dir: string, categoryId: string, rule: StandardRule): void {
  const catDir = join(dir, "categories")
  mkdirSync(catDir, { recursive: true })
  const filePath = join(catDir, `${categoryId}.md`)

  let existingRules: StandardRule[] = []
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, "utf-8")
    existingRules = parseRulesFromMarkdown(content, categoryId)
  }

  const idx = existingRules.findIndex(r => r.id === rule.id)
  if (idx >= 0) existingRules[idx] = rule
  else existingRules.push(rule)

  writeFileSync(filePath, serializeRulesToMarkdown(categoryId, existingRules), "utf-8")
}

export function deleteRule(dir: string, categoryId: string, ruleId: string): boolean {
  const filePath = join(dir, "categories", `${categoryId}.md`)
  if (!existsSync(filePath)) return false

  const content = readFileSync(filePath, "utf-8")
  const rules = parseRulesFromMarkdown(content, categoryId).filter(r => r.id !== ruleId)
  writeFileSync(filePath, serializeRulesToMarkdown(categoryId, rules), "utf-8")
  return true
}

export function saveCategory(dir: string, category: Omit<StandardCategory, "rules">): void {
  const configPath = join(dir, "config.json")
  let config: StandardsConfig
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, "utf-8"))
  } else {
    mkdirSync(dir, { recursive: true })
    config = { version: 1, categories: [], complexFeatureTriggers: { enabled: true, requiredDocs: ["guide", "flow", "sequence"], defaultConditions: [] } }
  }

  const idx = config.categories.findIndex(c => c.id === category.id)
  if (idx >= 0) config.categories[idx] = category
  else config.categories.push(category)

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8")
}

export function deleteCategory(dir: string, categoryId: string): boolean {
  const configPath = join(dir, "config.json")
  if (!existsSync(configPath)) return false

  const config: StandardsConfig = JSON.parse(readFileSync(configPath, "utf-8"))
  config.categories = config.categories.filter(c => c.id !== categoryId)
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8")
  return true
}

// ── Prompt generation for agent injection ──

export function generateStandardsPrompt(standards: MergedStandards, locale: string = "en"): string {
  const lang = locale.startsWith("zh") ? "zh-TW" : "en"
  const lines: string[] = []

  lines.push("# Development Standards")
  lines.push("")
  lines.push("You MUST follow these development standards. After completing work, a checklist will validate compliance.")
  lines.push("")

  for (const cat of standards.categories) {
    const enabledRules = cat.rules.filter(r => r.enabled)
    if (enabledRules.length === 0) continue

    lines.push(`## ${cat.name[lang] || cat.name.en}`)
    lines.push("")

    for (const rule of enabledRules) {
      const severityTag = rule.severity === "error" ? "[REQUIRED]" : rule.severity === "warning" ? "[RECOMMENDED]" : "[INFO]"
      lines.push(`### ${severityTag} ${rule.title}`)
      lines.push(rule.description)
      lines.push("")
    }
  }

  if (standards.complexFeatureTriggers.enabled) {
    lines.push("## Complex Feature Documentation Requirement")
    lines.push("")
    lines.push("When a feature matches ANY of these conditions, you MUST create Guide, Flow, and Sequence documents before implementation:")
    for (const cond of standards.complexFeatureTriggers.defaultConditions) {
      lines.push(`- ${cond.description[lang] || cond.description.en}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

// ── Get standard dirs ──
export function getGlobalStandardsDir(): string { return GLOBAL_DIR }
export function getProjectStandardsDir(projectPath: string): string { return getProjectDir(projectPath) }
