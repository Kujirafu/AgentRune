import {
  createFromTrustProfile,
  inheritForResume,
  getDeniedPermissions,
  getInheritedPermissions,
  hasPermission,
  getDefaultTTL,
  grantPermission,
  violationTypeToPermissionKey,
  type AuthorityMap,
} from "./authority-map.js"

// ── helpers ──

/** Build a minimal AuthorityMap for targeted tests */
function makeMap(overrides?: Partial<AuthorityMap>): AuthorityMap {
  return {
    sessionId: "test-session",
    permissions: [],
    createdAt: Date.now(),
    ...overrides,
  }
}

// ── createFromTrustProfile ──

describe("createFromTrustProfile", () => {
  it('derives denied permissions for "strict" sandbox', () => {
    const map = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "strict" })

    const perm = (key: string) => map.permissions.find(p => p.key === key)!

    expect(perm("filesystem.write").granted).toBe(false)
    expect(perm("network").granted).toBe(false)
    expect(perm("shell.unrestricted").granted).toBe(false)
  })

  it('grants all permissions for "none" sandbox', () => {
    const map = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "none" })

    const perm = (key: string) => map.permissions.find(p => p.key === key)!

    expect(perm("filesystem.write").granted).toBe(true)
    expect(perm("network").granted).toBe(true)
    expect(perm("shell.unrestricted").granted).toBe(true)
  })

  it('"permissive" sandbox allows network and filesystem, restricts shell', () => {
    const map = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "permissive" })

    const perm = (key: string) => map.permissions.find(p => p.key === key)!

    expect(perm("filesystem.write").granted).toBe(true)
    expect(perm("network").granted).toBe(true)
    expect(perm("shell.unrestricted").granted).toBe(false)
  })

  it("denies merge when requireMergeApproval is true", () => {
    const map = createFromTrustProfile({
      sessionId: "s1",
      sandboxLevel: "none",
      requireMergeApproval: true,
    })

    const merge = map.permissions.find(p => p.key === "merge")!
    expect(merge.granted).toBe(false)
    expect(merge.reason).toBe("Merge approval required")
  })

  it("denies plan.auto_execute when requirePlanReview is true", () => {
    const map = createFromTrustProfile({
      sessionId: "s1",
      sandboxLevel: "none",
      requirePlanReview: true,
    })

    const plan = map.permissions.find(p => p.key === "plan.auto_execute")!
    expect(plan.granted).toBe(false)
    expect(plan.reason).toBe("Plan review required before execution")
  })

  it("defaults to strict when no sandboxLevel provided", () => {
    const map = createFromTrustProfile({ sessionId: "s1" })

    const perm = (key: string) => map.permissions.find(p => p.key === key)!

    expect(perm("filesystem.write").granted).toBe(false)
    expect(perm("network").granted).toBe(false)
    expect(perm("shell.unrestricted").granted).toBe(false)
  })

  it("sets sessionId and automationId on the returned map", () => {
    const map = createFromTrustProfile({ sessionId: "s1", automationId: "a1" })

    expect(map.sessionId).toBe("s1")
    expect(map.automationId).toBe("a1")
  })

  it("marks all permissions as non-inherited", () => {
    const map = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "none" })

    for (const p of map.permissions) {
      expect(p.inherited).toBe(false)
    }
  })

  it('"moderate" sandbox denies network but allows filesystem.write', () => {
    const map = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "moderate" })

    const perm = (key: string) => map.permissions.find(p => p.key === key)!

    expect(perm("filesystem.write").granted).toBe(true)
    expect(perm("network").granted).toBe(false)
    expect(perm("shell.unrestricted").granted).toBe(false)
  })
})

// ── inheritForResume ──

describe("inheritForResume", () => {
  it("marks all permissions as inherited", () => {
    const original = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "none" })
    const resumed = inheritForResume(original, "s2")

    for (const p of resumed.permissions) {
      expect(p.inherited).toBe(true)
    }
  })

  it("clears expiresAt on all permissions", () => {
    const original = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "none" })
    // Manually set expiresAt on a permission
    original.permissions[0].expiresAt = Date.now() + 60_000

    const resumed = inheritForResume(original, "s2")

    for (const p of resumed.permissions) {
      expect(p.expiresAt).toBeUndefined()
    }
  })

  it("sets noExpiry to false on all permissions", () => {
    const original = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "none" })
    original.permissions[0].noExpiry = true

    const resumed = inheritForResume(original, "s2")

    for (const p of resumed.permissions) {
      expect(p.noExpiry).toBe(false)
    }
  })

  it("uses the new sessionId", () => {
    const original = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "strict" })
    const resumed = inheritForResume(original, "s2")

    expect(resumed.sessionId).toBe("s2")
  })

  it("carries forward automationId", () => {
    const original = createFromTrustProfile({ sessionId: "s1", automationId: "a1", sandboxLevel: "strict" })
    const resumed = inheritForResume(original, "s2")

    expect(resumed.automationId).toBe("a1")
  })

  it("does not mutate the original map", () => {
    const original = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "none" })
    original.permissions[0].expiresAt = Date.now() + 60_000
    original.permissions[0].noExpiry = true

    inheritForResume(original, "s2")

    expect(original.permissions[0].inherited).toBe(false)
    expect(original.permissions[0].expiresAt).toBeDefined()
    expect(original.permissions[0].noExpiry).toBe(true)
  })
})

// ── getDeniedPermissions ──

describe("getDeniedPermissions", () => {
  it("returns only denied (granted=false) permissions", () => {
    const map = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "strict" })
    const denied = getDeniedPermissions(map)

    expect(denied.length).toBeGreaterThan(0)
    for (const p of denied) {
      expect(p.granted).toBe(false)
    }
  })

  it("returns empty array when everything is granted", () => {
    const map = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "none" })
    const denied = getDeniedPermissions(map)

    expect(denied).toHaveLength(0)
  })
})

// ── getInheritedPermissions ──

describe("getInheritedPermissions", () => {
  it("returns only inherited permissions", () => {
    const original = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "none" })
    const resumed = inheritForResume(original, "s2")
    const inherited = getInheritedPermissions(resumed)

    expect(inherited).toHaveLength(resumed.permissions.length)
    for (const p of inherited) {
      expect(p.inherited).toBe(true)
    }
  })

  it("returns empty when no permissions are inherited", () => {
    const map = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "none" })
    const inherited = getInheritedPermissions(map)

    expect(inherited).toHaveLength(0)
  })
})

// ── hasPermission ──

describe("hasPermission", () => {
  it("returns true for a granted, non-expired permission", () => {
    const map = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "none" })

    expect(hasPermission(map, "filesystem.write")).toBe(true)
  })

  it("returns false when expiresAt is in the past", () => {
    const map = makeMap({
      permissions: [
        {
          key: "filesystem.write",
          granted: true,
          inherited: false,
          timestamp: Date.now() - 60_000,
          expiresAt: Date.now() - 1_000, // already expired
          severity: "warning",
        },
      ],
    })

    expect(hasPermission(map, "filesystem.write")).toBe(false)
  })

  it("returns true when noExpiry is true regardless of expiresAt", () => {
    const map = makeMap({
      permissions: [
        {
          key: "filesystem.write",
          granted: true,
          inherited: false,
          timestamp: Date.now() - 60_000,
          expiresAt: Date.now() - 1_000, // past
          noExpiry: true,
          severity: "warning",
        },
      ],
    })

    expect(hasPermission(map, "filesystem.write")).toBe(true)
  })

  it("returns false for a denied permission", () => {
    const map = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "strict" })

    expect(hasPermission(map, "filesystem.write")).toBe(false)
  })

  it("returns false for a non-existent permission key", () => {
    const map = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "none" })

    expect(hasPermission(map, "does.not.exist")).toBe(false)
  })

  it("returns true when expiresAt is in the future", () => {
    const map = makeMap({
      permissions: [
        {
          key: "network",
          granted: true,
          inherited: false,
          timestamp: Date.now(),
          expiresAt: Date.now() + 60_000,
          severity: "warning",
        },
      ],
    })

    expect(hasPermission(map, "network")).toBe(true)
  })

  it("returns true when expiresAt is undefined (no explicit TTL set)", () => {
    const map = makeMap({
      permissions: [
        {
          key: "network",
          granted: true,
          inherited: false,
          timestamp: Date.now(),
          severity: "warning",
        },
      ],
    })

    expect(hasPermission(map, "network")).toBe(true)
  })
})

// ── getDefaultTTL ──

describe("getDefaultTTL", () => {
  it("returns 5 minutes for critical severity", () => {
    expect(getDefaultTTL("critical")).toBe(5 * 60 * 1000)
  })

  it("returns 30 minutes for warning severity", () => {
    expect(getDefaultTTL("warning")).toBe(30 * 60 * 1000)
  })
})

// ── grantPermission ──

describe("grantPermission", () => {
  it("updates an existing permission in-place", () => {
    const map = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "strict" })

    // filesystem.write should be denied initially
    expect(hasPermission(map, "filesystem.write")).toBe(false)

    grantPermission(map, "filesystem.write", { severity: "warning", reason: "user approved" })

    const perm = map.permissions.find(p => p.key === "filesystem.write")!
    expect(perm.granted).toBe(true)
    expect(perm.inherited).toBe(false)
    expect(perm.reason).toBe("user approved")
    expect(perm.expiresAt).toBeDefined()
    expect(perm.noExpiry).toBe(false)
  })

  it("adds a new permission when key does not exist", () => {
    const map = makeMap()
    expect(map.permissions).toHaveLength(0)

    grantPermission(map, "wallet", { severity: "critical", reason: "allowed for deploy" })

    expect(map.permissions).toHaveLength(1)

    const perm = map.permissions[0]
    expect(perm.key).toBe("wallet")
    expect(perm.granted).toBe(true)
    expect(perm.severity).toBe("critical")
    expect(perm.reason).toBe("allowed for deploy")
  })

  it("sets expiresAt based on severity TTL", () => {
    const map = makeMap()
    const before = Date.now()

    grantPermission(map, "network", { severity: "warning" })

    const perm = map.permissions.find(p => p.key === "network")!
    // expiresAt should be roughly now + 30 min
    const expectedExpiry = before + 30 * 60 * 1000
    expect(perm.expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 100)
    expect(perm.expiresAt).toBeLessThanOrEqual(expectedExpiry + 1000)
  })

  it("sets expiresAt based on critical TTL (5 min)", () => {
    const map = makeMap()
    const before = Date.now()

    grantPermission(map, "shell.unrestricted", { severity: "critical" })

    const perm = map.permissions.find(p => p.key === "shell.unrestricted")!
    const expectedExpiry = before + 5 * 60 * 1000
    expect(perm.expiresAt).toBeGreaterThanOrEqual(expectedExpiry - 100)
    expect(perm.expiresAt).toBeLessThanOrEqual(expectedExpiry + 1000)
  })

  it("does not set expiresAt when noExpiry is true", () => {
    const map = makeMap()

    grantPermission(map, "network", { noExpiry: true })

    const perm = map.permissions.find(p => p.key === "network")!
    expect(perm.expiresAt).toBeUndefined()
    expect(perm.noExpiry).toBe(true)
  })

  it("defaults severity to warning when not specified", () => {
    const map = makeMap()

    grantPermission(map, "network")

    const perm = map.permissions.find(p => p.key === "network")!
    expect(perm.severity).toBe("warning")
  })

  it("clears inherited flag when re-granting", () => {
    const original = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "none" })
    const resumed = inheritForResume(original, "s2")

    // Before grant: should be inherited
    const before = resumed.permissions.find(p => p.key === "filesystem.write")!
    expect(before.inherited).toBe(true)

    grantPermission(resumed, "filesystem.write", { severity: "warning" })

    const after = resumed.permissions.find(p => p.key === "filesystem.write")!
    expect(after.inherited).toBe(false)
    expect(after.granted).toBe(true)
  })

  it("does not mutate the original permissions array length when updating existing", () => {
    const map = createFromTrustProfile({ sessionId: "s1", sandboxLevel: "strict" })
    const originalLength = map.permissions.length

    grantPermission(map, "filesystem.write")

    expect(map.permissions.length).toBe(originalLength)
  })
})

// ── violationTypeToPermissionKey ──

describe("violationTypeToPermissionKey", () => {
  it('maps "filesystem" to "filesystem.write"', () => {
    expect(violationTypeToPermissionKey("filesystem")).toBe("filesystem.write")
  })

  it('maps "network" to "network"', () => {
    expect(violationTypeToPermissionKey("network")).toBe("network")
  })

  it('maps "shell" to "shell.unrestricted"', () => {
    expect(violationTypeToPermissionKey("shell")).toBe("shell.unrestricted")
  })

  it('maps "wallet" to "wallet"', () => {
    expect(violationTypeToPermissionKey("wallet")).toBe("wallet")
  })

  it('maps "env" to "env"', () => {
    expect(violationTypeToPermissionKey("env")).toBe("env")
  })
})
