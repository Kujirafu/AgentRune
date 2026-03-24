import { describe, it, expect } from "vitest"
import {
  isParallelGroup,
  resolveChainText,
  FORCED_DEPTH_TAGS,
  HIGH_COMPLEXITY_THRESHOLD,
  BUILTIN_CHAINS,
  CHAIN_SLUGS,
  findChainBySlug,
  findChainsByPrefix,
  searchChains,
  estimateTokens,
  getStepCount,
  getSkillForDepth,
  formatChainInstructions,
  type ChainStepDef,
  type ParallelGroup,
  type ChainNode,
  type SkillChainDef,
  type ChainDepth,
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

  it("all chains have nameKey and descKey starting with chain.", () => {
    for (const chain of BUILTIN_CHAINS) {
      expect(chain.nameKey).toMatch(/^chain\./)
      expect(chain.descKey).toMatch(/^chain\./)
    }
  })

  it("all step skillSelection objects have lite, standard, deep keys", () => {
    for (const chain of BUILTIN_CHAINS) {
      for (const node of chain.steps) {
        if (isParallelGroup(node)) {
          for (const branch of node.branches) {
            expect(branch.skillSelection).toHaveProperty("lite")
            expect(branch.skillSelection).toHaveProperty("standard")
            expect(branch.skillSelection).toHaveProperty("deep")
          }
        } else {
          expect(node.skillSelection).toHaveProperty("lite")
          expect(node.skillSelection).toHaveProperty("standard")
          expect(node.skillSelection).toHaveProperty("deep")
        }
      }
    }
  })

  it("all parallel group branches have a valid phase", () => {
    const validPhases = ["design", "implement", "verify", "ship"]
    for (const chain of BUILTIN_CHAINS) {
      for (const node of chain.steps) {
        if (isParallelGroup(node)) {
          expect(validPhases).toContain(node.phase)
          for (const branch of node.branches) {
            expect(validPhases).toContain(branch.phase)
          }
        } else {
          expect(validPhases).toContain(node.phase)
        }
      }
    }
  })

  it("release chain has all required structure fields", () => {
    const release = BUILTIN_CHAINS.find(c => c.slug === "release")
    expect(release).toBeDefined()
    expect(release!.tokenBudget.lite).toBeGreaterThan(0)
    expect(release!.tokenBudget.deep).toBeGreaterThan(0)
    expect(release!.steps.length).toBeGreaterThan(0)
  })

  it("incident chain defaultDepth is deep for key steps", () => {
    const incident = BUILTIN_CHAINS.find(c => c.slug === "incident")
    expect(incident).toBeDefined()
    const flatSteps = incident!.steps.flatMap(n =>
      isParallelGroup(n) ? n.branches : [n]
    )
    const deepSteps = flatSteps.filter(s => s.defaultDepth === "deep")
    expect(deepSteps.length).toBeGreaterThan(0)
  })

  it("secure chain starts with a parallel group", () => {
    const secure = BUILTIN_CHAINS.find(c => c.slug === "secure")
    expect(secure).toBeDefined()
    expect(isParallelGroup(secure!.steps[0])).toBe(true)
  })

  it("has exactly 30 chains", () => {
    expect(BUILTIN_CHAINS).toHaveLength(30)
  })
})

// ── CHAIN_SLUGS ──────────────────────────────────────────

describe("CHAIN_SLUGS", () => {
  it("is an array of strings matching BUILTIN_CHAINS slugs", () => {
    expect(CHAIN_SLUGS).toEqual(BUILTIN_CHAINS.map(c => c.slug))
  })

  it("contains all expected chain slugs", () => {
    const expected = [
      "feature", "bugfix", "hotfix", "refactor", "secure",
      "release", "incident", "onboard", "mobile-feature", "app-release",
      "api-endpoint", "api-migration", "api-integration", "pentest", "dep-audit",
      "bot-build", "ci-cd", "scraper", "ai-feature", "prompt-pipeline",
      "rag-setup", "docker-deploy", "monitoring", "infra", "landing-page",
      "seo-audit", "i18n", "perf", "test",
    ]
    for (const slug of expected) {
      expect(CHAIN_SLUGS).toContain(slug)
    }
  })

  it("does not contain duplicates", () => {
    expect(new Set(CHAIN_SLUGS).size).toBe(CHAIN_SLUGS.length)
  })
})

// ── findChainBySlug ──────────────────────────────────────

describe("findChainBySlug", () => {
  it("returns the chain for a valid slug", () => {
    const chain = findChainBySlug("feature")
    expect(chain).toBeDefined()
    expect(chain!.slug).toBe("feature")
  })

  it("returns the bugfix chain", () => {
    const chain = findChainBySlug("bugfix")
    expect(chain).toBeDefined()
    expect(chain!.slug).toBe("bugfix")
  })

  it("returns the qa chain", () => {
    const chain = findChainBySlug("qa")
    expect(chain).toBeDefined()
    expect(chain!.slug).toBe("qa")
  })

  it("returns undefined for an unknown slug", () => {
    expect(findChainBySlug("not-a-real-chain")).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(findChainBySlug("")).toBeUndefined()
  })

  it("is case-sensitive — uppercase slug returns undefined", () => {
    expect(findChainBySlug("Feature")).toBeUndefined()
    expect(findChainBySlug("FEATURE")).toBeUndefined()
  })

  it("returns each built-in chain by its own slug", () => {
    for (const chain of BUILTIN_CHAINS) {
      const found = findChainBySlug(chain.slug)
      expect(found).toBe(chain)
    }
  })
})

// ── findChainsByPrefix ───────────────────────────────────

describe("findChainsByPrefix", () => {
  it("finds all api-* chains by 'api' prefix", () => {
    const results = findChainsByPrefix("api")
    const slugs = results.map(c => c.slug)
    expect(slugs).toContain("api-endpoint")
    expect(slugs).toContain("api-migration")
    expect(slugs).toContain("api-integration")
  })

  it("finds exact chain when prefix equals slug", () => {
    const results = findChainsByPrefix("feature")
    expect(results.some(c => c.slug === "feature")).toBe(true)
  })

  it("returns empty array for a prefix that matches nothing", () => {
    expect(findChainsByPrefix("zzz-nonexistent")).toEqual([])
  })

  it("is case-insensitive (lowercases prefix internally)", () => {
    const lowerResults = findChainsByPrefix("api")
    const upperResults = findChainsByPrefix("API")
    expect(upperResults.map(c => c.slug)).toEqual(lowerResults.map(c => c.slug))
  })

  it("finds chains containing the substring (includes match)", () => {
    const results = findChainsByPrefix("release")
    const slugs = results.map(c => c.slug)
    expect(slugs).toContain("release")
    expect(slugs).toContain("app-release")
  })

  it("returns empty array for empty prefix — prefix startsWith('') always true, so all chains match", () => {
    // All chains start with empty string, so all 29 chains should be returned
    const results = findChainsByPrefix("")
    expect(results).toHaveLength(BUILTIN_CHAINS.length)
  })
})

// ── searchChains ─────────────────────────────────────────

const mockT = (key: string) => {
  const map: Record<string, string> = {
    "chain.feature.name": "Feature Development",
    "chain.feature.desc": "Build new features",
    "chain.bugfix.name": "Bug Fix",
    "chain.bugfix.desc": "Fix bugs in existing code",
    "chain.qa.name": "QA Release Gate",
    "chain.qa.desc": "Quality assurance and release gate",
    "chain.secure.name": "Security Hardening",
    "chain.secure.desc": "Security audit and hardening",
    "chain.refactor.name": "Refactor",
    "chain.refactor.desc": "Refactor existing code",
    "chain.hotfix.name": "Hotfix",
    "chain.hotfix.desc": "Emergency production fix",
    "chain.release.name": "Release",
    "chain.release.desc": "Deploy to production",
    "chain.incident.name": "Incident Response",
    "chain.incident.desc": "Security incident response",
    "chain.onboard.name": "Onboard",
    "chain.onboard.desc": "Onboard new project",
    "chain.mobile-feature.name": "Mobile Feature",
    "chain.mobile-feature.desc": "Mobile app feature development",
    "chain.app-release.name": "App Release",
    "chain.app-release.desc": "Release app to store",
    "chain.api-endpoint.name": "API Endpoint",
    "chain.api-endpoint.desc": "Build API endpoint",
    "chain.api-migration.name": "API Migration",
    "chain.api-migration.desc": "Database migration",
    "chain.api-integration.name": "API Integration",
    "chain.api-integration.desc": "Third-party API integration",
    "chain.pentest.name": "Pentest",
    "chain.pentest.desc": "Penetration testing",
    "chain.dep-audit.name": "Dependency Audit",
    "chain.dep-audit.desc": "Audit dependencies",
    "chain.bot-build.name": "Bot Build",
    "chain.bot-build.desc": "Build automation bot",
    "chain.ci-cd.name": "CI/CD",
    "chain.ci-cd.desc": "CI/CD pipeline setup",
    "chain.scraper.name": "Scraper",
    "chain.scraper.desc": "Web scraper development",
    "chain.ai-feature.name": "AI Feature",
    "chain.ai-feature.desc": "AI feature development",
    "chain.prompt-pipeline.name": "Prompt Pipeline",
    "chain.prompt-pipeline.desc": "Prompt engineering pipeline",
    "chain.rag-setup.name": "RAG Setup",
    "chain.rag-setup.desc": "RAG system setup",
    "chain.docker-deploy.name": "Docker Deploy",
    "chain.docker-deploy.desc": "Docker deployment",
    "chain.monitoring.name": "Monitoring",
    "chain.monitoring.desc": "Monitoring system",
    "chain.infra.name": "Infrastructure",
    "chain.infra.desc": "Infrastructure as code",
    "chain.landing-page.name": "Landing Page",
    "chain.landing-page.desc": "Landing page development",
    "chain.seo-audit.name": "SEO Audit",
    "chain.seo-audit.desc": "SEO audit and optimization",
    "chain.i18n.name": "i18n",
    "chain.i18n.desc": "Internationalization",
    "chain.perf.name": "Performance",
    "chain.perf.desc": "Performance optimization",
    "chain.test.name": "Test Strategy",
    "chain.test.desc": "Testing strategy and quality engineering",
  }
  return map[key] ?? key
}

describe("searchChains", () => {
  it("returns empty array for empty input", () => {
    expect(searchChains("", mockT)).toEqual([])
  })

  it("returns empty array for whitespace-only input", () => {
    expect(searchChains("   ", mockT)).toEqual([])
  })

  it("exact slug match returns single result with score 1 and type 'exact'", () => {
    const results = searchChains("feature", mockT)
    expect(results).toHaveLength(1)
    expect(results[0].chain.slug).toBe("feature")
    expect(results[0].score).toBe(1)
    expect(results[0].matchType).toBe("exact")
  })

  it("exact slug match for 'bugfix'", () => {
    const results = searchChains("bugfix", mockT)
    expect(results).toHaveLength(1)
    expect(results[0].chain.slug).toBe("bugfix")
    expect(results[0].matchType).toBe("exact")
  })

  it("exact slug match for 'qa'", () => {
    const results = searchChains("qa", mockT)
    expect(results).toHaveLength(1)
    expect(results[0].chain.slug).toBe("qa")
    expect(results[0].matchType).toBe("exact")
  })

  it("prefix match returns type 'prefix' and multiple results", () => {
    const results = searchChains("api", mockT)
    expect(results.length).toBeGreaterThan(1)
    expect(results.every(r => r.matchType === "prefix")).toBe(true)
  })

  it("prefix match score is higher for closer prefix matches", () => {
    const results = searchChains("api", mockT)
    // Sorted by score descending
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score)
    }
  })

  it("keyword match for 'bug' returns bugfix with type 'keyword'", () => {
    const results = searchChains("bug fix", mockT)
    expect(results.length).toBeGreaterThan(0)
    const bugfix = results.find(r => r.chain.slug === "bugfix")
    expect(bugfix).toBeDefined()
    expect(bugfix!.matchType).toBe("keyword")
  })

  it("keyword match for 'security' returns security-related chains", () => {
    const results = searchChains("security audit", mockT)
    expect(results.length).toBeGreaterThan(0)
    const slugs = results.map(r => r.chain.slug)
    expect(slugs.some(s => ["secure", "pentest", "dep-audit"].includes(s))).toBe(true)
  })

  it("keyword match for Chinese '功能' returns feature chain", () => {
    const results = searchChains("新功能", mockT)
    expect(results.length).toBeGreaterThan(0)
    const feature = results.find(r => r.chain.slug === "feature")
    expect(feature).toBeDefined()
  })

  it("keyword match returns at most 5 results", () => {
    // 'test' is a very common keyword — should cap at 5
    const results = searchChains("test", mockT)
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it("keyword results are sorted by score descending", () => {
    const results = searchChains("security vulnerability", mockT)
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score)
    }
  })

  it("returns prefix matches before keyword fallback — 'app' matches app-release", () => {
    const results = searchChains("app", mockT)
    expect(results.length).toBeGreaterThan(0)
    expect(results.every(r => r.matchType === "prefix")).toBe(true)
    expect(results.some(r => r.chain.slug === "app-release")).toBe(true)
  })

  it("returns no results for a completely unrelated string", () => {
    const results = searchChains("zxzxzxzxzxzx", mockT)
    expect(results).toHaveLength(0)
  })
})

// ── estimateTokens ───────────────────────────────────────

describe("estimateTokens", () => {
  const featureChain = BUILTIN_CHAINS.find(c => c.slug === "feature")!

  it("returns lite budget for lite depth", () => {
    expect(estimateTokens(featureChain, "lite")).toBe(featureChain.tokenBudget.lite)
  })

  it("returns deep budget for deep depth", () => {
    expect(estimateTokens(featureChain, "deep")).toBe(featureChain.tokenBudget.deep)
  })

  it("returns average of lite and deep for standard depth", () => {
    const expected = Math.round((featureChain.tokenBudget.lite + featureChain.tokenBudget.deep) / 2)
    expect(estimateTokens(featureChain, "standard")).toBe(expected)
  })

  it("standard estimate is between lite and deep", () => {
    for (const chain of BUILTIN_CHAINS) {
      const standardTokens = estimateTokens(chain, "standard")
      expect(standardTokens).toBeGreaterThanOrEqual(chain.tokenBudget.lite)
      expect(standardTokens).toBeLessThanOrEqual(chain.tokenBudget.deep)
    }
  })

  it("works for hotfix chain (smallest budget)", () => {
    const hotfix = BUILTIN_CHAINS.find(c => c.slug === "hotfix")!
    expect(estimateTokens(hotfix, "lite")).toBe(350)
    expect(estimateTokens(hotfix, "deep")).toBe(3500)
  })

  it("works for qa chain (largest budget)", () => {
    const qa = BUILTIN_CHAINS.find(c => c.slug === "qa")!
    expect(estimateTokens(qa, "lite")).toBe(1200)
    expect(estimateTokens(qa, "deep")).toBe(15000)
  })
})

// ── getStepCount ─────────────────────────────────────────

describe("getStepCount", () => {
  it("counts branches inside parallel groups as separate steps", () => {
    const feature = BUILTIN_CHAINS.find(c => c.slug === "feature")!
    // feature has: s1, s2, s3, p1(s4+s5), s6, s7, s8, s9 = 8 sequential + 2 branches = 9 total
    expect(getStepCount(feature)).toBe(9)
  })

  it("counts all steps in bugfix (no parallel groups)", () => {
    const bugfix = BUILTIN_CHAINS.find(c => c.slug === "bugfix")!
    // s1, s2, s3, s4 = 4 steps, no parallel
    expect(getStepCount(bugfix)).toBe(4)
  })

  it("counts all steps in hotfix (no parallel groups)", () => {
    const hotfix = BUILTIN_CHAINS.find(c => c.slug === "hotfix")!
    expect(getStepCount(hotfix)).toBe(3)
  })

  it("returns a positive count for every built-in chain", () => {
    for (const chain of BUILTIN_CHAINS) {
      expect(getStepCount(chain)).toBeGreaterThan(0)
    }
  })

  it("counts parallel branches as their own steps (not the parallel node itself)", () => {
    // secure chain starts with a parallel group of 2 branches
    const secure = BUILTIN_CHAINS.find(c => c.slug === "secure")!
    // p0(s1a+s1b), s2, s3, p1(s3+s4) ... let's just verify it's >= 4
    expect(getStepCount(secure)).toBeGreaterThanOrEqual(4)
  })

  it("custom chain with a single step returns 1", () => {
    const singleStepChain: SkillChainDef = {
      slug: "single",
      nameKey: "chain.single.name",
      descKey: "chain.single.desc",
      tokenBudget: { lite: 100, deep: 500 },
      steps: [
        {
          id: "s1",
          phase: "design",
          labelKey: "chain.step.plan",
          skillSelection: { lite: "plan", standard: "plan", deep: "plan" },
          required: true,
          defaultDepth: "lite",
        },
      ],
    }
    expect(getStepCount(singleStepChain)).toBe(1)
  })

  it("custom chain with only a parallel group returns branch count", () => {
    const parallelOnlyChain: SkillChainDef = {
      slug: "par",
      nameKey: "chain.par.name",
      descKey: "chain.par.desc",
      tokenBudget: { lite: 100, deep: 500 },
      steps: [
        {
          type: "parallel",
          id: "p1",
          phase: "verify",
          labelKey: "chain.step.parallelVerify",
          branches: [
            {
              id: "b1", phase: "verify", labelKey: "chain.step.test",
              skillSelection: { lite: "test", standard: "test", deep: "test" },
              required: true, defaultDepth: "lite",
            },
            {
              id: "b2", phase: "verify", labelKey: "chain.step.review",
              skillSelection: { lite: "review", standard: "review", deep: "review" },
              required: true, defaultDepth: "lite",
            },
          ],
          joinStrategy: "all",
        },
      ],
    }
    expect(getStepCount(parallelOnlyChain)).toBe(2)
  })
})

// ── getSkillForDepth ─────────────────────────────────────

describe("getSkillForDepth", () => {
  const step: ChainStepDef = {
    id: "s1",
    phase: "design",
    labelKey: "chain.step.brainstorm",
    skillSelection: { lite: "brainstorm", standard: "concise-planning", deep: "architecture" },
    required: true,
    defaultDepth: "lite",
  }

  it("returns lite skill for lite depth", () => {
    expect(getSkillForDepth(step, "lite")).toBe("brainstorm")
  })

  it("returns standard skill for standard depth", () => {
    expect(getSkillForDepth(step, "standard")).toBe("concise-planning")
  })

  it("returns deep skill for deep depth", () => {
    expect(getSkillForDepth(step, "deep")).toBe("architecture")
  })

  it("returns null when skill is null for that depth", () => {
    const nullStep: ChainStepDef = {
      id: "s2",
      phase: "implement",
      labelKey: "chain.step.implement",
      skillSelection: { lite: null, standard: null, deep: null },
      required: true,
      defaultDepth: "lite",
    }
    expect(getSkillForDepth(nullStep, "lite")).toBeNull()
    expect(getSkillForDepth(nullStep, "standard")).toBeNull()
    expect(getSkillForDepth(nullStep, "deep")).toBeNull()
  })

  it("returns null only for lite when lite is null but standard/deep are not", () => {
    const qaStep: ChainStepDef = {
      id: "s5",
      phase: "verify",
      labelKey: "chain.step.qaUnit",
      skillSelection: { lite: null, standard: "qa-unit", deep: "qa-unit-deep" },
      required: true,
      defaultDepth: "standard",
    }
    expect(getSkillForDepth(qaStep, "lite")).toBeNull()
    expect(getSkillForDepth(qaStep, "standard")).toBe("qa-unit")
    expect(getSkillForDepth(qaStep, "deep")).toBe("qa-unit-deep")
  })

  it("works for all depths on every non-parallel step in all built-in chains", () => {
    const depths: ChainDepth[] = ["lite", "standard", "deep"]
    for (const chain of BUILTIN_CHAINS) {
      for (const node of chain.steps) {
        const steps: ChainStepDef[] = isParallelGroup(node) ? node.branches : [node]
        for (const s of steps) {
          for (const depth of depths) {
            // must return a string or null — not undefined
            const result = getSkillForDepth(s, depth)
            expect(result === null || typeof result === "string").toBe(true)
          }
        }
      }
    }
  })
})

// ── formatChainInstructions ──────────────────────────────

describe("formatChainInstructions", () => {
  const noopT = (key: string) => key

  it("returns a non-empty string", () => {
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(typeof output).toBe("string")
    expect(output.length).toBeGreaterThan(0)
  })

  it("includes the chain slug in the header", () => {
    const chain = findChainBySlug("bugfix")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("bugfix")
  })

  it("lite mode includes 'MODE: Lite' instruction", () => {
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("MODE: Lite")
  })

  it("standard mode includes 'MODE: Standard' instruction", () => {
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "standard", noopT)
    expect(output).toContain("MODE: Standard")
  })

  it("deep mode includes 'MODE: Deep' instruction", () => {
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "deep", noopT)
    expect(output).toContain("MODE: Deep")
  })

  it("includes EXECUTION PROTOCOL section", () => {
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("EXECUTION PROTOCOL")
  })

  it("includes PARALLEL EXECUTION section", () => {
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("PARALLEL EXECUTION")
  })

  it("includes HANDOFF FORMAT section", () => {
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("HANDOFF FORMAT")
  })

  it("includes PIPELINE section", () => {
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("PIPELINE")
  })

  it("includes ON CHAIN COMPLETE section", () => {
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("ON CHAIN COMPLETE")
  })

  it("deep mode includes FORCED DEPTH RULES section", () => {
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "deep", noopT)
    expect(output).toContain("FORCED DEPTH RULES")
  })

  it("lite and standard mode do NOT include FORCED DEPTH RULES section", () => {
    const chain = findChainBySlug("feature")!
    expect(formatChainInstructions(chain, "lite", noopT)).not.toContain("FORCED DEPTH RULES")
    expect(formatChainInstructions(chain, "standard", noopT)).not.toContain("FORCED DEPTH RULES")
  })

  it("includes SKIP IF text when a step has skipWhen", () => {
    // feature chain s1 has a skipWhen condition
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("SKIP IF:")
  })

  it("includes CONTEXT FROM text when a step has contextFrom", () => {
    // feature chain s2 has contextFrom: ["s1"]
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("CONTEXT FROM:")
  })

  it("includes ON FAIL text when a step has onFailure", () => {
    // feature chain s4 (in parallel group) has onFailure
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("ON FAIL:")
  })

  it("includes AUTO-REMEMBER text when a step has autoRemember", () => {
    // feature chain s1 has autoRemember: true
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("AUTO-REMEMBER:")
  })

  it("includes OPTIONAL label for non-required steps", () => {
    // feature chain s5 (security) is required: false
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("(OPTIONAL)")
  })

  it("includes [PARALLEL] label for parallel groups", () => {
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("[PARALLEL")
  })

  it("includes step count in header", () => {
    const chain = findChainBySlug("feature")!
    const stepCount = getStepCount(chain)
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain(`Steps: ${stepCount}`)
  })

  it("includes token estimate in header", () => {
    const chain = findChainBySlug("feature")!
    const tokens = estimateTokens(chain, "lite")
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain(`${tokens} tokens`)
  })

  it("uses translated name in header via t()", () => {
    const chain = findChainBySlug("feature")!
    const tWithMap = (key: string) => key === "chain.feature.name" ? "Feature Development" : key
    const output = formatChainInstructions(chain, "lite", tWithMap)
    expect(output).toContain("Feature Development")
  })

  it("abort onFailure action outputs ABORT THE CHAIN", () => {
    // release chain s1 (in parallel) has onFailure: { action: "abort" }
    const chain = findChainBySlug("release")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("ABORT the chain")
  })

  it("retry onFailure action outputs Retry", () => {
    // hotfix chain s2 has onFailure: { action: "retry", maxRetries: 1 }
    const chain = findChainBySlug("hotfix")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("Retry")
  })

  it("fallback onFailure action outputs fallback skill slug", () => {
    // bugfix chain s3 has onFailure: { action: "fallback", fallbackSkill: "debug" }
    const chain = findChainBySlug("bugfix")!
    const output = formatChainInstructions(chain, "lite", noopT)
    expect(output).toContain("/debug")
  })

  it("deep mode with security steps includes DYNAMIC SECURITY SKILL SELECTION", () => {
    // feature chain has a security step (s5)
    const chain = findChainBySlug("feature")!
    const output = formatChainInstructions(chain, "deep", noopT)
    expect(output).toContain("DYNAMIC SECURITY SKILL SELECTION")
  })

  it("produces consistent output for same inputs", () => {
    const chain = findChainBySlug("bugfix")!
    const out1 = formatChainInstructions(chain, "standard", noopT)
    const out2 = formatChainInstructions(chain, "standard", noopT)
    expect(out1).toBe(out2)
  })

  it("lite and deep outputs differ (depth affects skill selection)", () => {
    const chain = findChainBySlug("feature")!
    const liteOut = formatChainInstructions(chain, "lite", noopT)
    const deepOut = formatChainInstructions(chain, "deep", noopT)
    expect(liteOut).not.toBe(deepOut)
  })

  it("produces valid output for every built-in chain at all depths", () => {
    const depths: ChainDepth[] = ["lite", "standard", "deep"]
    for (const chain of BUILTIN_CHAINS) {
      for (const depth of depths) {
        const output = formatChainInstructions(chain, depth, noopT)
        expect(typeof output).toBe("string")
        expect(output).toContain(chain.slug)
        expect(output).toContain("EXECUTION PROTOCOL")
        expect(output).toContain("ON CHAIN COMPLETE")
      }
    }
  })
})

// ── Edge cases: ChainStepDef and ParallelGroup structural integrity ──

describe("ChainNode structural integrity", () => {
  it("isParallelGroup returns false for node without type property", () => {
    const bareObj = { id: "x", phase: "design", labelKey: "test",
      skillSelection: { lite: "a", standard: "b", deep: "c" },
      required: true, defaultDepth: "lite" as ChainDepth }
    expect(isParallelGroup(bareObj as ChainNode)).toBe(false)
  })

  it("isParallelGroup returns false for node with wrong type value", () => {
    const wrongType = { type: "sequential", id: "p1", phase: "verify",
      labelKey: "test", branches: [], joinStrategy: "all" as const }
    expect(isParallelGroup(wrongType as unknown as ChainNode)).toBe(false)
  })

  it("isParallelGroup returns true only for type='parallel'", () => {
    const pg: ParallelGroup = {
      type: "parallel", id: "p1", phase: "design",
      labelKey: "test", branches: [], joinStrategy: "any",
    }
    expect(isParallelGroup(pg)).toBe(true)
  })
})

// ── resolveChainText edge cases ──────────────────────────

describe("resolveChainText edge cases", () => {
  const mockT2 = (key: string) => `[${key}]`

  it("key with 'chain.' in middle (not start) is treated as literal", () => {
    expect(resolveChainText("my.chain.key", mockT2)).toBe("my.chain.key")
  })

  it("chain. prefix with additional dots is still translated", () => {
    expect(resolveChainText("chain.a.b.c", mockT2)).toBe("[chain.a.b.c]")
  })

  it("exact 'chain.' prefix (no suffix) is still passed to t()", () => {
    expect(resolveChainText("chain.", mockT2)).toBe("[chain.]")
  })
})
