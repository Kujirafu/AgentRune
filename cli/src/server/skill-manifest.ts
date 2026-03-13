/**
 * Skill Manifest — declares what resources a skill needs.
 * Used for prompt-level sandboxing and runtime monitoring.
 */

// ── Types ──

export interface SkillManifest {
  skillId: string
  version?: string
  permissions: {
    /** Allowed filesystem paths (globs relative to project root) */
    filesystem?: { read?: string[]; write?: string[] }
    /** Allowed network hostnames, e.g. ["api.github.com", "registry.npmjs.org"] */
    network?: string[]
    /** Allowed shell command prefixes, e.g. ["git", "npm test", "npx tsc"] */
    shell?: string[]
    /** Env vars the skill needs access to */
    env?: string[]
  }
  /** Wallet/crypto operations — always false by default */
  walletAccess: boolean
  /** Max execution time in minutes (default: 30) */
  maxExecutionMinutes?: number
}

export interface ManifestValidationError {
  field: string
  message: string
}

// ── Sandbox level presets ──

export type SandboxLevel = "strict" | "moderate" | "permissive" | "none"

export function createManifestForLevel(skillId: string, level: SandboxLevel = "strict"): SkillManifest {
  switch (level) {
    case "none":
      // No sandbox — agent has full access (use with bypass mode)
      return {
        skillId,
        permissions: { filesystem: { read: ["**"], write: ["**"] }, network: ["*"], shell: ["*"], env: ["*"] },
        walletAccess: false,
        maxExecutionMinutes: 30,
      }
    case "permissive":
      // Allow network, file read/write in project, common shell commands
      return {
        skillId,
        permissions: {
          filesystem: { read: ["**"], write: ["./**"] },
          network: ["*"],
          shell: ["git", "npm", "npx", "node", "curl", "cat", "ls", "mkdir", "cp", "mv"],
          env: [],
        },
        walletAccess: false,
        maxExecutionMinutes: 30,
      }
    case "moderate":
      // Allow file read/write in project, limited shell, no network
      return {
        skillId,
        permissions: {
          filesystem: { read: ["./**"], write: ["./**"] },
          network: [],
          shell: ["git", "npm test", "npx tsc"],
          env: [],
        },
        walletAccess: false,
        maxExecutionMinutes: 30,
      }
    case "strict":
    default:
      return createDefaultManifest(skillId)
  }
}

// ── Default manifest (maximally restrictive) ──

export function createDefaultManifest(skillId: string): SkillManifest {
  return {
    skillId,
    permissions: {
      filesystem: { read: ["./**"], write: [] },
      network: [],
      shell: [],
      env: [],
    },
    walletAccess: false,
    maxExecutionMinutes: 30,
  }
}

// ── Validation ──

export function validateManifest(manifest: SkillManifest): ManifestValidationError[] {
  const errors: ManifestValidationError[] = []

  if (!manifest.skillId || typeof manifest.skillId !== "string") {
    errors.push({ field: "skillId", message: "skillId is required" })
  }

  // Check filesystem paths for directory traversal
  const allPaths = [
    ...(manifest.permissions.filesystem?.read || []),
    ...(manifest.permissions.filesystem?.write || []),
  ]
  for (const p of allPaths) {
    if (p.includes("..") || p.startsWith("/") || /^[A-Za-z]:/.test(p)) {
      errors.push({ field: "permissions.filesystem", message: `Path traversal or absolute path not allowed: "${p}"` })
    }
  }

  // Check network hosts are valid hostnames (no IPs, no protocols)
  for (const host of manifest.permissions.network || []) {
    if (/^\d+\.\d+\.\d+\.\d+/.test(host)) {
      errors.push({ field: "permissions.network", message: `Raw IP addresses not allowed: "${host}"` })
    }
    if (host.includes("://")) {
      errors.push({ field: "permissions.network", message: `Use hostname only, no protocol: "${host}"` })
    }
  }

  // Check shell commands — block obviously dangerous prefixes
  const dangerousCmds = ["rm -rf /", "mkfs", "format", "dd if=", ":(){ :|:& };:"]
  for (const cmd of manifest.permissions.shell || []) {
    for (const d of dangerousCmds) {
      if (cmd.toLowerCase().startsWith(d)) {
        errors.push({ field: "permissions.shell", message: `Dangerous command not allowed: "${cmd}"` })
      }
    }
  }

  // walletAccess must be explicitly set
  if (manifest.walletAccess !== false && manifest.walletAccess !== true) {
    errors.push({ field: "walletAccess", message: "walletAccess must be explicitly true or false" })
  }

  // maxExecutionMinutes range
  if (manifest.maxExecutionMinutes !== undefined) {
    if (manifest.maxExecutionMinutes <= 0 || manifest.maxExecutionMinutes > 480) {
      errors.push({ field: "maxExecutionMinutes", message: "Must be between 1 and 480 minutes" })
    }
  }

  return errors
}

// ── Sandbox instruction builder ──

export function buildSandboxInstructions(manifest: SkillManifest, projectCwd: string): string {
  const lines: string[] = [
    "[SECURITY SCOPE — You MUST follow these restrictions]",
    "",
  ]

  // Filesystem
  const readPaths = manifest.permissions.filesystem?.read || []
  const writePaths = manifest.permissions.filesystem?.write || []
  if (readPaths.length > 0 || writePaths.length > 0) {
    lines.push(`Filesystem (relative to ${projectCwd}):`)
    if (readPaths.length > 0) lines.push(`  Read: ${readPaths.join(", ")}`)
    if (writePaths.length > 0) lines.push(`  Write: ${writePaths.join(", ")}`)
    else lines.push("  Write: NONE — do not create or modify any files")
  } else {
    lines.push("Filesystem: NO access — do not read or write any files")
  }

  // Network
  const hosts = manifest.permissions.network || []
  if (hosts.includes("*")) {
    lines.push("Network: Allowed — you may make HTTP requests as needed")
  } else if (hosts.length > 0) {
    lines.push(`Network: Only these hosts: ${hosts.join(", ")}`)
  } else {
    lines.push("Network: NO network access — do not make HTTP requests, curl, wget, or fetch")
  }

  // Shell
  const cmds = manifest.permissions.shell || []
  if (cmds.includes("*")) {
    lines.push("Shell commands: Allowed — you may execute shell commands as needed")
  } else if (cmds.length > 0) {
    lines.push(`Shell commands: Only these prefixes: ${cmds.join(", ")}`)
  } else {
    lines.push("Shell commands: NONE — do not execute shell commands")
  }

  // Wallet
  if (!manifest.walletAccess) {
    lines.push("Wallet/crypto: FORBIDDEN — do not access wallets, sign transactions, or handle private keys")
  }

  // Timeout
  if (manifest.maxExecutionMinutes) {
    lines.push(`Time limit: ${manifest.maxExecutionMinutes} minutes`)
  }

  lines.push("")
  lines.push("If the task requires resources not listed above, STOP immediately and report what you need. Do NOT attempt to access restricted resources.")

  return lines.join("\n")
}

// ── Prompt scanning for sandbox conflicts ──

export interface SandboxConflict {
  /** Which permission category is blocked */
  category: "network" | "filesystem.write" | "filesystem.read" | "shell" | "env" | "wallet"
  /** i18n key for the detected operation label (e.g. "sandbox.detected.httpRequest") */
  detectedKey: string
  /** The matched keyword/pattern from the prompt */
  matchedPattern: string
  /** Whether this sandbox level blocks it */
  blocked: boolean
  /** Suggested minimum sandbox level to allow this */
  suggestedLevel: SandboxLevel
  /** i18n key for the category label (e.g. "sandbox.category.network") */
  categoryKey: string
}


export interface PromptScanResult {
  /** The sandbox level that was scanned against */
  sandboxLevel: SandboxLevel
  /** All detected conflicts */
  conflicts: SandboxConflict[]
  /** Number of blocked operations */
  blockedCount: number
  /** Suggested sandbox level to resolve all conflicts */
  suggestedLevel: SandboxLevel | null
  /** i18n summary template key + params for App-side rendering */
  summaryKey: string
  summaryParams: Record<string, string | number>
}

// Pattern definitions: [regex, category, i18n key for detected label, minimum level needed]
type PatternDef = [RegExp, SandboxConflict["category"], string, SandboxLevel]

const PROMPT_PATTERNS: PatternDef[] = [
  // Network
  [/\b(fetch|axios|http[s]?:\/\/|api\s*call|curl|wget|request\.get|request\.post)\b/i, "network", "sandbox.detected.httpRequest", "permissive"],
  [/\b(api|endpoint|webhook|REST|GraphQL)\b/i, "network", "sandbox.detected.apiInteraction", "permissive"],
  [/\b(download|upload|send\s+request|post\s+to|get\s+from)\b/i, "network", "sandbox.detected.networkTransfer", "permissive"],
  [/\b(slack|discord|telegram|twitter|threads)\b/i, "network", "sandbox.detected.socialPlatform", "permissive"],
  [/\b(smtp|email|mail|send\s+email)\b/i, "network", "sandbox.detected.emailSending", "permissive"],

  // Filesystem write
  [/\b(write|create|save|output)\s+(file|to\s+file|to\s+disk)/i, "filesystem.write", "sandbox.detected.fileWriting", "moderate"],
  [/\b(mkdir|mkdirp|create\s+directory|create\s+folder)\b/i, "filesystem.write", "sandbox.detected.dirCreation", "moderate"],
  [/\b(modify|edit|update|patch|append\s+to)\s+(file|code|source)/i, "filesystem.write", "sandbox.detected.fileModification", "moderate"],
  [/\b(generate|produce|export)\s+(file|report|csv|json|html|pdf)\b/i, "filesystem.write", "sandbox.detected.fileGeneration", "moderate"],
  [/\b(寫入|建立|儲存|新增|修改|編輯)\s*(檔案|文件|資料夾)/i, "filesystem.write", "sandbox.detected.fileWriting", "moderate"],

  // Shell commands
  [/\b(npm\s+(install|run|build|publish)|npx|yarn|pnpm)\b/i, "shell", "sandbox.detected.packageManager", "permissive"],
  [/\b(git\s+(push|pull|clone|checkout|merge|rebase|commit))\b/i, "shell", "sandbox.detected.gitOperation", "moderate"],
  [/\b(docker|kubectl|terraform|ansible)\b/i, "shell", "sandbox.detected.infraTool", "permissive"],
  [/\b(python|node|ruby|go\s+run|cargo\s+run|java)\b/i, "shell", "sandbox.detected.runtimeExec", "permissive"],
  [/\b(bash|sh|shell|terminal|command\s*line|execute|run\s+command)\b/i, "shell", "sandbox.detected.shellExec", "moderate"],
  [/\b(pip\s+install|gem\s+install|brew\s+install|apt\s+install)\b/i, "shell", "sandbox.detected.packageInstall", "permissive"],
  [/\b(build|compile|deploy|test|lint)\b/i, "shell", "sandbox.detected.buildTest", "moderate"],
  [/\b(執行|安裝|部署|編譯|測試)\b/i, "shell", "sandbox.detected.shellExec", "moderate"],

  // Environment variables
  [/\b(env|environment\s*variable|process\.env|API_KEY|SECRET|TOKEN|PASSWORD)\b/i, "env", "sandbox.detected.envVar", "permissive"],
  [/\b(\.env|dotenv|config\s+file|credential)\b/i, "env", "sandbox.detected.credentials", "permissive"],

  // Wallet/crypto
  [/\b(wallet|crypto|blockchain|solana|ethereum|web3|sign\s+transaction|private\s*key|seed\s*phrase|mnemonic)\b/i, "wallet", "sandbox.detected.cryptoWallet", "none"],
  [/\b(mint|transfer|airdrop|swap|stake|unstake|NFT)\b/i, "wallet", "sandbox.detected.tokenOp", "none"],
]

// Level ordering for comparison
const LEVEL_ORDER: Record<SandboxLevel, number> = { strict: 0, moderate: 1, permissive: 2, none: 3 }

function isBlocked(category: SandboxConflict["category"], manifest: SkillManifest): boolean {
  const p = manifest.permissions
  switch (category) {
    case "network":
      return !p.network || p.network.length === 0
    case "filesystem.write":
      return !p.filesystem?.write || p.filesystem.write.length === 0
    case "filesystem.read":
      return !p.filesystem?.read || p.filesystem.read.length === 0
    case "shell":
      return !p.shell || p.shell.length === 0
    case "env":
      return !p.env || p.env.length === 0
    case "wallet":
      return !manifest.walletAccess
  }
}

/**
 * Scan a prompt for operations that would conflict with the given sandbox level.
 * Returns detected conflicts with suggestions for the minimum sandbox level needed.
 */
export function scanPromptForConflicts(promptText: string, level: SandboxLevel): PromptScanResult {
  const manifest = createManifestForLevel("_scan", level)
  const conflicts: SandboxConflict[] = []
  const seenCategories = new Set<string>()

  for (const [pattern, category, description, suggestedLevel] of PROMPT_PATTERNS) {
    const match = promptText.match(pattern)
    if (!match) continue

    // Deduplicate by category + matched text
    const key = `${category}:${match[0].toLowerCase()}`
    if (seenCategories.has(key)) continue
    seenCategories.add(key)

    const blocked = isBlocked(category, manifest)
    conflicts.push({
      category,
      detectedKey: description,
      matchedPattern: match[0],
      blocked,
      suggestedLevel,
      categoryKey: `sandbox.category.${category}`,
    })
  }

  const blockedConflicts = conflicts.filter(c => c.blocked)
  const blockedCount = blockedConflicts.length

  // Find the minimum level that resolves all conflicts
  let suggestedLevel: SandboxLevel | null = null
  if (blockedCount > 0) {
    let maxNeeded = 0
    for (const c of blockedConflicts) {
      maxNeeded = Math.max(maxNeeded, LEVEL_ORDER[c.suggestedLevel])
    }
    suggestedLevel = (Object.entries(LEVEL_ORDER).find(([, v]) => v === maxNeeded)?.[0] as SandboxLevel) || "permissive"
  }

  // Build summary as i18n key + params (App renders with its own locale)
  let summaryKey: string
  let summaryParams: Record<string, string | number>
  if (blockedCount === 0) {
    summaryKey = "sandbox.summary.noConflict"
    summaryParams = { level: `sandbox.level.${level}` }
  } else {
    const categoryKeys = [...new Set(blockedConflicts.map(c => c.categoryKey))]
    summaryKey = "sandbox.summary.hasConflict"
    summaryParams = {
      level: `sandbox.level.${level}`,
      count: blockedCount,
      categories: categoryKeys.join(","),
      suggested: suggestedLevel ? `sandbox.level.${suggestedLevel}` : "",
    }
  }

  return { sandboxLevel: level, conflicts, blockedCount, suggestedLevel, summaryKey, summaryParams }
}
