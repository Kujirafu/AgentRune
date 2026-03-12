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
  if (hosts.length > 0) {
    lines.push(`Network: Only these hosts: ${hosts.join(", ")}`)
  } else {
    lines.push("Network: NO network access — do not make HTTP requests, curl, wget, or fetch")
  }

  // Shell
  const cmds = manifest.permissions.shell || []
  if (cmds.length > 0) {
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
