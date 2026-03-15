import { describe, it, expect } from "vitest"
import {
  isParallelGroup,
  resolveChainText,
  FORCED_DEPTH_TAGS,
  HIGH_COMPLEXITY_THRESHOLD,
  BUILTIN_CHAINS,
  type ChainStepDef,
  type ParallelGroup,
  type ChainNode,
} from "./skillChains"

describe("isParallelGroup", () => {
  it("returns true for a parallel group node", () => {
    const pg: ParallelGroup = {
      type: "parallel",
      id: "p1",
      phase: "verify",
      labelKey: "test",
      branches: [],
      joinStrategy: "all",
    }
    expect(isParallelGroup(pg)).toBe(true)
  })

  it("returns false for a step node", () => {
    const step: ChainStepDef = {
      id: "s1",
      phase: "design",
      labelKey: "test",
      skillSelection: { lite: "a", standard: "b", deep: "c" },
      required: true,
      defaultDepth: "lite",
    }
    expect(isParallelGroup(step)).toBe(false)
  })
})

describe("resolveChainText", () => {
  const mockT = (key: string) => `translated:${key}`

  it("passes chain.* keys through the translation function", () => {
    expect(resolveChainText("chain.feature.name", mockT)).toBe("translated:chain.feature.name")
  })

  it("returns literal text for non-chain keys", () => {
    expect(resolveChainText("My Custom Name", mockT)).toBe("My Custom Name")
  })

  it("returns literal for empty string", () => {
    expect(resolveChainText("", mockT)).toBe("")
  })
})

describe("FORCED_DEPTH_TAGS", () => {
  it("contains expected security-sensitive tags", () => {
    expect(FORCED_DEPTH_TAGS).toContain("payment")
    expect(FORCED_DEPTH_TAGS).toContain("auth")
    expect(FORCED_DEPTH_TAGS).toContain("encryption")
    expect(FORCED_DEPTH_TAGS).toContain("user-data")
  })

  it("has 12 tags", () => {
    expect(FORCED_DEPTH_TAGS).toHaveLength(12)
  })
})

describe("HIGH_COMPLEXITY_THRESHOLD", () => {
  it("is 10000 tokens", () => {
    expect(HIGH_COMPLEXITY_THRESHOLD).toBe(10000)
  })
})

describe("BUILTIN_CHAINS", () => {
  it("has at least 10 chains", () => {
    expect(BUILTIN_CHAINS.length).toBeGreaterThanOrEqual(10)
  })

  it("each chain has required fields", () => {
    for (const chain of BUILTIN_CHAINS) {
      expect(chain.slug).toBeTruthy()
      expect(chain.nameKey).toBeTruthy()
      expect(chain.descKey).toBeTruthy()
      expect(chain.steps.length).toBeGreaterThan(0)
      expect(chain.tokenBudget.lite).toBeGreaterThan(0)
      expect(chain.tokenBudget.deep).toBeGreaterThan(0)
    }
  })

  it("all slugs are unique", () => {
    const slugs = BUILTIN_CHAINS.map(c => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it("each step has a unique id within its chain", () => {
    for (const chain of BUILTIN_CHAINS) {
      const ids: string[] = []
      for (const node of chain.steps) {
        if (isParallelGroup(node)) {
          ids.push(node.id)
          for (const branch of node.branches) {
            ids.push(branch.id)
          }
        } else {
          ids.push(node.id)
        }
      }
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    }
  })

  it("feature chain exists with expected structure", () => {
    const feature = BUILTIN_CHAINS.find(c => c.slug === "feature")
    expect(feature).toBeDefined()
    expect(feature!.steps.length).toBeGreaterThanOrEqual(5)

    // Should have at least one parallel group
    const hasParallel = feature!.steps.some(isParallelGroup)
    expect(hasParallel).toBe(true)
  })

  it("bugfix chain exists", () => {
    const bugfix = BUILTIN_CHAINS.find(c => c.slug === "bugfix")
    expect(bugfix).toBeDefined()
  })

  it("qa chain exists", () => {
    const qa = BUILTIN_CHAINS.find(c => c.slug === "qa")
    expect(qa).toBeDefined()
  })

  it("deep budget is always >= lite budget", () => {
    for (const chain of BUILTIN_CHAINS) {
      expect(chain.tokenBudget.deep).toBeGreaterThanOrEqual(chain.tokenBudget.lite)
    }
  })
})
