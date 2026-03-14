/**
 * planning-constraints.ts
 * Merges standards (error-level rules) + sandbox limits + authority map
 * into a unified constraint list for agent planning prompts.
 */

import { type MergedStandards, loadStandards, type StandardRule, generateStandardsPrompt } from "./standards-loader.js"
import { type SkillManifest, type SandboxLevel, createManifestForLevel, buildSandboxInstructions } from "./skill-manifest.js"
import type { AuthorityMap } from "./authority-map.js"

// ── Types ──

export interface PlanningConstraint {
  source: "standard" | "sandbox" | "authority"
  severity: "error" | "warning" | "info"
  title: string
  description: string
  /** For standards: rule ID. For sandbox: permission category. For authority: permission key. */
  ref?: string
}

export interface PlanningConstraintSet {
  constraints: PlanningConstraint[]
  sandboxLevel: SandboxLevel
  trustProfile?: string
  /** Full sandbox instructions text (for prompt injection) */
  sandboxInstructions?: string
  /** Standards prompt text (for prompt injection) */
  standardsPrompt?: string
}

// ── Builder ──

export function buildPlanningConstraints(opts: {
  projectPath?: string
  sandboxLevel?: SandboxLevel
  manifest?: SkillManifest
  authorityMap?: AuthorityMap
  trustProfile?: string
  locale?: string
}): PlanningConstraintSet {
  const constraints: PlanningConstraint[] = []
  const level = opts.sandboxLevel || "strict"

  // 1. Standards — collect error-level rules as hard constraints
  let standardsPrompt: string | undefined
  try {
    const standards = loadStandards(opts.projectPath)
    for (const cat of standards.categories) {
      for (const rule of cat.rules) {
        if (!rule.enabled) continue
        if (rule.severity === "error") {
          constraints.push({
            source: "standard",
            severity: "error",
            title: rule.title,
            description: rule.description,
            ref: rule.id,
          })
        }
      }
    }
    // Generate full standards prompt for injection
    standardsPrompt = generateStandardsPrompt(standards, opts.locale || "en")
  } catch {
    // No standards configured — that's OK
  }

  // 2. Sandbox — derive constraints from manifest/level
  const manifest = opts.manifest || createManifestForLevel("planning", level)
  const sandboxInstructions = buildSandboxInstructions(manifest, opts.projectPath || ".")

  if (level !== "none") {
    // Filesystem constraints
    const readPaths = manifest.permissions.filesystem?.read || []
    const writePaths = manifest.permissions.filesystem?.write || []
    if (readPaths.length === 0 && writePaths.length === 0) {
      constraints.push({
        source: "sandbox",
        severity: "error",
        title: "No filesystem access",
        description: "Sandbox prohibits all file read/write operations",
        ref: "filesystem",
      })
    } else if (writePaths.length === 0) {
      constraints.push({
        source: "sandbox",
        severity: "error",
        title: "Read-only filesystem",
        description: "Sandbox prohibits file writes — read only",
        ref: "filesystem.write",
      })
    }

    // Network constraints
    const hosts = manifest.permissions.network || []
    if (hosts.length === 0) {
      constraints.push({
        source: "sandbox",
        severity: "error",
        title: "No network access",
        description: "Sandbox prohibits all HTTP requests and network operations",
        ref: "network",
      })
    } else if (!hosts.includes("*")) {
      constraints.push({
        source: "sandbox",
        severity: "warning",
        title: "Restricted network access",
        description: `Network limited to: ${hosts.join(", ")}`,
        ref: "network",
      })
    }

    // Shell constraints
    const cmds = manifest.permissions.shell || []
    if (cmds.length === 0) {
      constraints.push({
        source: "sandbox",
        severity: "error",
        title: "No shell commands",
        description: "Sandbox prohibits all shell command execution",
        ref: "shell",
      })
    } else if (!cmds.includes("*")) {
      constraints.push({
        source: "sandbox",
        severity: "warning",
        title: "Restricted shell commands",
        description: `Only allowed: ${cmds.join(", ")}`,
        ref: "shell",
      })
    }

    // Wallet constraint
    if (!manifest.walletAccess) {
      constraints.push({
        source: "sandbox",
        severity: "error",
        title: "No wallet/crypto access",
        description: "Sandbox prohibits wallet operations, transaction signing, and private key handling",
        ref: "wallet",
      })
    }
  }

  // 3. Authority Map — inherit constraints if provided
  if (opts.authorityMap) {
    for (const perm of opts.authorityMap.permissions) {
      if (!perm.granted) {
        constraints.push({
          source: "authority",
          severity: perm.inherited ? "warning" : "error",
          title: `No ${perm.key} permission`,
          description: perm.reason || `Authority map denies ${perm.key}`,
          ref: perm.key,
        })
      } else if (perm.inherited) {
        constraints.push({
          source: "authority",
          severity: "info",
          title: `${perm.key} (inherited)`,
          description: `Inherited from previous session — may need re-confirmation`,
          ref: perm.key,
        })
      }
    }
  }

  return {
    constraints,
    sandboxLevel: level,
    trustProfile: opts.trustProfile,
    sandboxInstructions,
    standardsPrompt,
  }
}

/** Generate a human-readable constraint summary for prompt injection */
export function formatConstraintsForPrompt(cs: PlanningConstraintSet): string {
  if (cs.constraints.length === 0) return ""

  const lines: string[] = ["[PLANNING CONSTRAINTS — review before generating a plan]", ""]

  const errors = cs.constraints.filter(c => c.severity === "error")
  const warnings = cs.constraints.filter(c => c.severity === "warning")
  const infos = cs.constraints.filter(c => c.severity === "info")

  if (errors.length > 0) {
    lines.push("MUST NOT violate:")
    for (const c of errors) {
      lines.push(`  - [${c.source}] ${c.title}: ${c.description}`)
    }
    lines.push("")
  }

  if (warnings.length > 0) {
    lines.push("Should consider:")
    for (const c of warnings) {
      lines.push(`  - [${c.source}] ${c.title}: ${c.description}`)
    }
    lines.push("")
  }

  if (infos.length > 0) {
    lines.push("Note:")
    for (const c of infos) {
      lines.push(`  - [${c.source}] ${c.title}: ${c.description}`)
    }
    lines.push("")
  }

  lines.push("If your plan requires resources or permissions not available above, flag them explicitly.")
  return lines.join("\n")
}
