/**
 * authority-map.ts
 * Tracks session-level permissions with TTL expiry, marks inherited permissions
 * for checkpoint on resume, and feeds constraints to planning-constraints.ts.
 *
 * Phase 1: data structure + session inheritance + planning constraint output.
 * Phase 2 (AR-F01+F05): TTL expiry + noExpiry bypass + grantPermission + runtime enforcement.
 */

// ── TTL defaults (milliseconds) ──

/** Critical operations (rm, ssh, wallet): 5 minutes */
const TTL_CRITICAL = 5 * 60 * 1000
/** Warning operations (file write, curl): 30 minutes */
const TTL_WARNING = 30 * 60 * 1000

// ── Types ──

export type PermissionSeverity = "critical" | "warning"

export interface AuthorityPermission {
  key: string
  granted: boolean
  /** Was this permission inherited from a previous session (needs re-confirmation)? */
  inherited: boolean
  /** When this permission was granted/denied */
  timestamp: number
  /** Human-readable reason */
  reason?: string
  /** When this permission expires (undefined = use default TTL from severity) */
  expiresAt?: number
  /** If true, this permission never expires within the session */
  noExpiry?: boolean
  /** Severity level — determines default TTL */
  severity?: PermissionSeverity
}

export interface AuthorityMap {
  sessionId: string
  automationId?: string
  permissions: AuthorityPermission[]
  createdAt: number
}

// ── Factory ──

/** Create a fresh AuthorityMap from a Trust Profile's concrete settings */
export function createFromTrustProfile(opts: {
  sessionId: string
  automationId?: string
  sandboxLevel?: string
  requirePlanReview?: boolean
  requireMergeApproval?: boolean
}): AuthorityMap {
  const permissions: AuthorityPermission[] = []
  const now = Date.now()

  // Derive permissions from sandbox level
  const level = opts.sandboxLevel || "strict"

  permissions.push({
    key: "filesystem.write",
    granted: level !== "strict",
    inherited: false,
    timestamp: now,
    severity: "warning",
    reason: level === "strict" ? "Strict sandbox: write restricted" : undefined,
  })

  permissions.push({
    key: "network",
    granted: level === "none" || level === "permissive",
    inherited: false,
    timestamp: now,
    severity: "warning",
    reason: level === "strict" || level === "moderate" ? `${level} sandbox: network restricted` : undefined,
  })

  permissions.push({
    key: "shell.unrestricted",
    granted: level === "none",
    inherited: false,
    timestamp: now,
    severity: "critical",
    reason: level !== "none" ? `${level} sandbox: shell commands restricted` : undefined,
  })

  permissions.push({
    key: "merge",
    granted: !opts.requireMergeApproval,
    inherited: false,
    timestamp: now,
    severity: "warning",
    reason: opts.requireMergeApproval ? "Merge approval required" : undefined,
  })

  permissions.push({
    key: "plan.auto_execute",
    granted: !opts.requirePlanReview,
    inherited: false,
    timestamp: now,
    severity: "warning",
    reason: opts.requirePlanReview ? "Plan review required before execution" : undefined,
  })

  return {
    sessionId: opts.sessionId,
    automationId: opts.automationId,
    permissions,
    createdAt: now,
  }
}

/** Create an inherited AuthorityMap for session resume — marks all permissions as inherited, clears TTL */
export function inheritForResume(prev: AuthorityMap, newSessionId: string): AuthorityMap {
  return {
    sessionId: newSessionId,
    automationId: prev.automationId,
    permissions: prev.permissions.map(p => ({
      ...p,
      inherited: true,
      // Inherited permissions lose their TTL — must be re-granted
      expiresAt: undefined,
      noExpiry: false,
    })),
    createdAt: Date.now(),
  }
}

/** Get denied permissions (for quick checks) */
export function getDeniedPermissions(map: AuthorityMap): AuthorityPermission[] {
  return map.permissions.filter(p => !p.granted)
}

/** Get inherited permissions that need re-confirmation */
export function getInheritedPermissions(map: AuthorityMap): AuthorityPermission[] {
  return map.permissions.filter(p => p.inherited)
}

/** Check if a specific permission is granted AND not expired */
export function hasPermission(map: AuthorityMap, key: string): boolean {
  const perm = map.permissions.find(p => p.key === key)
  if (!perm || !perm.granted) return false

  // noExpiry bypass — always valid within this session
  if (perm.noExpiry) return true

  // Check TTL expiry
  if (perm.expiresAt !== undefined) {
    if (Date.now() > perm.expiresAt) return false
  }

  return true
}

/** Get the default TTL for a severity level */
export function getDefaultTTL(severity: PermissionSeverity): number {
  return severity === "critical" ? TTL_CRITICAL : TTL_WARNING
}

/**
 * Grant (or re-grant) a permission with TTL.
 * Mutates the AuthorityMap in place.
 */
export function grantPermission(map: AuthorityMap, key: string, opts?: {
  noExpiry?: boolean
  severity?: PermissionSeverity
  reason?: string
}): void {
  const now = Date.now()
  const severity = opts?.severity || "warning"
  const noExpiry = opts?.noExpiry || false
  const expiresAt = noExpiry ? undefined : now + getDefaultTTL(severity)

  const existing = map.permissions.find(p => p.key === key)
  if (existing) {
    existing.granted = true
    existing.inherited = false
    existing.timestamp = now
    existing.expiresAt = expiresAt
    existing.noExpiry = noExpiry
    existing.severity = severity
    if (opts?.reason !== undefined) existing.reason = opts.reason
  } else {
    map.permissions.push({
      key,
      granted: true,
      inherited: false,
      timestamp: now,
      expiresAt,
      noExpiry,
      severity,
      reason: opts?.reason,
    })
  }
}

/**
 * Map a skill-monitor violation type to the corresponding authority permission key.
 */
export function violationTypeToPermissionKey(type: "filesystem" | "network" | "shell" | "wallet" | "env"): string {
  switch (type) {
    case "filesystem": return "filesystem.write"
    case "network": return "network"
    case "shell": return "shell.unrestricted"
    case "wallet": return "wallet"
    case "env": return "env"
  }
}
