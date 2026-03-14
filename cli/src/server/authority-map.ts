/**
 * authority-map.ts
 * Tracks session-level permissions, marks inherited permissions for checkpoint on resume,
 * and feeds constraints to planning-constraints.ts.
 *
 * Phase 1: data structure + session inheritance + planning constraint output.
 * Runtime enforcement is Phase 4.
 */

// ── Types ──

export interface AuthorityPermission {
  key: string
  granted: boolean
  /** Was this permission inherited from a previous session (needs re-confirmation)? */
  inherited: boolean
  /** When this permission was granted/denied */
  timestamp: number
  /** Human-readable reason */
  reason?: string
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
    reason: level === "strict" ? "Strict sandbox: write restricted" : undefined,
  })

  permissions.push({
    key: "network",
    granted: level === "none" || level === "permissive",
    inherited: false,
    timestamp: now,
    reason: level === "strict" || level === "moderate" ? `${level} sandbox: network restricted` : undefined,
  })

  permissions.push({
    key: "shell.unrestricted",
    granted: level === "none",
    inherited: false,
    timestamp: now,
    reason: level !== "none" ? `${level} sandbox: shell commands restricted` : undefined,
  })

  permissions.push({
    key: "merge",
    granted: !opts.requireMergeApproval,
    inherited: false,
    timestamp: now,
    reason: opts.requireMergeApproval ? "Merge approval required" : undefined,
  })

  permissions.push({
    key: "plan.auto_execute",
    granted: !opts.requirePlanReview,
    inherited: false,
    timestamp: now,
    reason: opts.requirePlanReview ? "Plan review required before execution" : undefined,
  })

  return {
    sessionId: opts.sessionId,
    automationId: opts.automationId,
    permissions,
    createdAt: now,
  }
}

/** Create an inherited AuthorityMap for session resume — marks all permissions as inherited */
export function inheritForResume(prev: AuthorityMap, newSessionId: string): AuthorityMap {
  return {
    sessionId: newSessionId,
    automationId: prev.automationId,
    permissions: prev.permissions.map(p => ({
      ...p,
      inherited: true,
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

/** Check if a specific permission is granted */
export function hasPermission(map: AuthorityMap, key: string): boolean {
  const perm = map.permissions.find(p => p.key === key)
  return perm?.granted ?? false
}
