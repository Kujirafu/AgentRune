// Skill Chain definitions — hardcoded for Phase 1
// See spec: docs/superpowers/specs/2026-03-10-skill-chains-design.md

export type ChainDepth = "lite" | "standard" | "deep"
export type ChainPhase = "design" | "implement" | "verify" | "ship"

export interface ChainStepDef {
  id: string
  phase: ChainPhase
  labelKey: string // i18n key
  skillSelection: {
    lite: string | null
    standard: string | null
    deep: string | null
  }
  required: boolean
  defaultDepth: ChainDepth
}

export interface SkillChainDef {
  slug: string
  nameKey: string // i18n key
  descKey: string // i18n key
  steps: ChainStepDef[]
  tokenBudget: { lite: number; deep: number }
}

// ── 8 Built-in Chains ──────────────────────────────────

export const BUILTIN_CHAINS: SkillChainDef[] = [
  // 1. /feature — 新功能開發
  {
    slug: "feature",
    nameKey: "chain.feature.name",
    descKey: "chain.feature.desc",
    tokenBudget: { lite: 800, deep: 12000 },
    steps: [
      { id: "s1", phase: "design", labelKey: "chain.step.brainstorm", skillSelection: { lite: "brainstorm", standard: "concise-planning", deep: "architecture" }, required: true, defaultDepth: "lite" },
      { id: "s2", phase: "design", labelKey: "chain.step.plan", skillSelection: { lite: "plan", standard: "plan", deep: "architecture" }, required: true, defaultDepth: "lite" },
      { id: "s3", phase: "implement", labelKey: "chain.step.tdd", skillSelection: { lite: "tdd", standard: "tdd", deep: "test-driven-development" }, required: true, defaultDepth: "lite" },
      { id: "s4", phase: "verify", labelKey: "chain.step.review", skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" }, required: true, defaultDepth: "lite" },
      { id: "s5", phase: "verify", labelKey: "chain.step.security", skillSelection: { lite: "security", standard: "security", deep: "security-auditor" }, required: false, defaultDepth: "lite" },
      { id: "s6", phase: "ship", labelKey: "chain.step.test", skillSelection: { lite: "test", standard: "test", deep: "test" }, required: true, defaultDepth: "lite" },
      { id: "s7", phase: "ship", labelKey: "chain.step.commit", skillSelection: { lite: "commit", standard: "commit", deep: "commit" }, required: true, defaultDepth: "lite" },
      { id: "s8", phase: "ship", labelKey: "chain.step.doc", skillSelection: { lite: "doc", standard: "doc", deep: "documentation-templates" }, required: false, defaultDepth: "lite" },
      { id: "s9", phase: "ship", labelKey: "chain.step.pr", skillSelection: { lite: "pr", standard: "pr", deep: "pr" }, required: true, defaultDepth: "lite" },
    ],
  },

  // 2. /bugfix — Bug 修復
  {
    slug: "bugfix",
    nameKey: "chain.bugfix.name",
    descKey: "chain.bugfix.desc",
    tokenBudget: { lite: 550, deep: 6500 },
    steps: [
      { id: "s1", phase: "verify", labelKey: "chain.step.debug", skillSelection: { lite: "debug", standard: "debugging-strategies", deep: "systematic-debugging" }, required: true, defaultDepth: "lite" },
      { id: "s2", phase: "implement", labelKey: "chain.step.fix", skillSelection: { lite: "fix", standard: "fix", deep: "fix" }, required: true, defaultDepth: "lite" },
      { id: "s3", phase: "verify", labelKey: "chain.step.test", skillSelection: { lite: "test", standard: "test", deep: "test-driven-development" }, required: true, defaultDepth: "lite" },
      { id: "s4", phase: "ship", labelKey: "chain.step.commit", skillSelection: { lite: "commit", standard: "commit", deep: "commit" }, required: true, defaultDepth: "lite" },
    ],
  },

  // 3. /hotfix — 緊急修補
  {
    slug: "hotfix",
    nameKey: "chain.hotfix.name",
    descKey: "chain.hotfix.desc",
    tokenBudget: { lite: 350, deep: 3500 },
    steps: [
      { id: "s1", phase: "implement", labelKey: "chain.step.fix", skillSelection: { lite: "fix", standard: "fix", deep: "fix" }, required: true, defaultDepth: "lite" },
      { id: "s2", phase: "verify", labelKey: "chain.step.test", skillSelection: { lite: "test", standard: "test", deep: "test" }, required: true, defaultDepth: "lite" },
      { id: "s3", phase: "ship", labelKey: "chain.step.commit", skillSelection: { lite: "commit", standard: "commit", deep: "commit" }, required: true, defaultDepth: "lite" },
    ],
  },

  // 4. /refactor — 重構
  {
    slug: "refactor",
    nameKey: "chain.refactor.name",
    descKey: "chain.refactor.desc",
    tokenBudget: { lite: 650, deep: 7000 },
    steps: [
      { id: "s1", phase: "verify", labelKey: "chain.step.testBaseline", skillSelection: { lite: "test", standard: "test", deep: "test" }, required: true, defaultDepth: "lite" },
      { id: "s2", phase: "implement", labelKey: "chain.step.refactor", skillSelection: { lite: "refactor", standard: "refactor", deep: "kaizen" }, required: true, defaultDepth: "lite" },
      { id: "s3", phase: "verify", labelKey: "chain.step.testVerify", skillSelection: { lite: "test", standard: "test", deep: "test" }, required: true, defaultDepth: "lite" },
      { id: "s4", phase: "verify", labelKey: "chain.step.review", skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" }, required: true, defaultDepth: "lite" },
      { id: "s5", phase: "ship", labelKey: "chain.step.commit", skillSelection: { lite: "commit", standard: "commit", deep: "commit" }, required: true, defaultDepth: "lite" },
    ],
  },

  // 5. /secure — 安全加固
  {
    slug: "secure",
    nameKey: "chain.secure.name",
    descKey: "chain.secure.desc",
    tokenBudget: { lite: 650, deep: 9500 },
    steps: [
      { id: "s1", phase: "verify", labelKey: "chain.step.security", skillSelection: { lite: "security", standard: "security-auditor", deep: "security-auditor" }, required: true, defaultDepth: "lite" },
      { id: "s2", phase: "implement", labelKey: "chain.step.fix", skillSelection: { lite: "fix", standard: "fix", deep: "backend-security-coder" }, required: true, defaultDepth: "lite" },
      { id: "s3", phase: "verify", labelKey: "chain.step.test", skillSelection: { lite: "test", standard: "test", deep: "test" }, required: true, defaultDepth: "lite" },
      { id: "s4", phase: "verify", labelKey: "chain.step.review", skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" }, required: true, defaultDepth: "lite" },
      { id: "s5", phase: "ship", labelKey: "chain.step.commit", skillSelection: { lite: "commit", standard: "commit", deep: "commit" }, required: true, defaultDepth: "lite" },
    ],
  },

  // 6. /release — 發版
  {
    slug: "release",
    nameKey: "chain.release.name",
    descKey: "chain.release.desc",
    tokenBudget: { lite: 750, deep: 10000 },
    steps: [
      { id: "s1", phase: "verify", labelKey: "chain.step.test", skillSelection: { lite: "test", standard: "test", deep: "test" }, required: true, defaultDepth: "lite" },
      { id: "s2", phase: "verify", labelKey: "chain.step.review", skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" }, required: true, defaultDepth: "lite" },
      { id: "s3", phase: "verify", labelKey: "chain.step.security", skillSelection: { lite: "security", standard: "security-auditor", deep: "security-auditor" }, required: false, defaultDepth: "lite" },
      { id: "s4", phase: "ship", labelKey: "chain.step.doc", skillSelection: { lite: "doc", standard: "doc", deep: "documentation-templates" }, required: false, defaultDepth: "lite" },
      { id: "s5", phase: "ship", labelKey: "chain.step.commit", skillSelection: { lite: "commit", standard: "commit", deep: "commit" }, required: true, defaultDepth: "lite" },
      { id: "s6", phase: "ship", labelKey: "chain.step.pr", skillSelection: { lite: "pr", standard: "pr", deep: "pr" }, required: true, defaultDepth: "lite" },
    ],
  },

  // 7. /incident — 安全事件回應
  {
    slug: "incident",
    nameKey: "chain.incident.name",
    descKey: "chain.incident.desc",
    tokenBudget: { lite: 800, deep: 10000 },
    steps: [
      { id: "s1", phase: "verify", labelKey: "chain.step.investigate", skillSelection: { lite: "debug", standard: "debugging-strategies", deep: "incident-responder" }, required: true, defaultDepth: "deep" },
      { id: "s2", phase: "implement", labelKey: "chain.step.contain", skillSelection: { lite: "fix", standard: "fix", deep: "fix" }, required: true, defaultDepth: "deep" },
      { id: "s3", phase: "implement", labelKey: "chain.step.fix", skillSelection: { lite: "fix", standard: "fix", deep: "backend-security-coder" }, required: true, defaultDepth: "deep" },
      { id: "s4", phase: "verify", labelKey: "chain.step.test", skillSelection: { lite: "test", standard: "test", deep: "test" }, required: true, defaultDepth: "deep" },
      { id: "s5", phase: "verify", labelKey: "chain.step.securityVerify", skillSelection: { lite: "security", standard: "security-auditor", deep: "security-auditor" }, required: true, defaultDepth: "deep" },
      { id: "s6", phase: "ship", labelKey: "chain.step.postmortem", skillSelection: { lite: "remember", standard: "remember", deep: "postmortem-writing" }, required: true, defaultDepth: "deep" },
      { id: "s7", phase: "ship", labelKey: "chain.step.commit", skillSelection: { lite: "commit", standard: "commit", deep: "commit" }, required: true, defaultDepth: "lite" },
    ],
  },

  // 8. /onboard — 新人上手
  {
    slug: "onboard",
    nameKey: "chain.onboard.name",
    descKey: "chain.onboard.desc",
    tokenBudget: { lite: 500, deep: 2000 },
    steps: [
      { id: "s1", phase: "design", labelKey: "chain.step.init", skillSelection: { lite: "init", standard: "init", deep: "init" }, required: true, defaultDepth: "lite" },
      { id: "s2", phase: "design", labelKey: "chain.step.onboard", skillSelection: { lite: "onboard", standard: "onboard", deep: "onboard" }, required: true, defaultDepth: "lite" },
      { id: "s3", phase: "design", labelKey: "chain.step.explain", skillSelection: { lite: "explain", standard: "explain", deep: "architecture" }, required: false, defaultDepth: "lite" },
      { id: "s4", phase: "design", labelKey: "chain.step.remember", skillSelection: { lite: "remember", standard: "remember", deep: "remember" }, required: true, defaultDepth: "lite" },
    ],
  },
]

// ── Helpers ──────────────────────────────────────────────

export const CHAIN_SLUGS = BUILTIN_CHAINS.map(c => c.slug)

export function findChainBySlug(slug: string): SkillChainDef | undefined {
  return BUILTIN_CHAINS.find(c => c.slug === slug)
}

export function estimateTokens(chain: SkillChainDef, depth: ChainDepth): number {
  if (depth === "lite") return chain.tokenBudget.lite
  if (depth === "deep") return chain.tokenBudget.deep
  // standard ≈ midpoint
  return Math.round((chain.tokenBudget.lite + chain.tokenBudget.deep) / 2)
}

export function getSkillForDepth(step: ChainStepDef, depth: ChainDepth): string | null {
  return step.skillSelection[depth]
}

/** Format chain as text instructions to send to agent */
export function formatChainInstructions(
  chain: SkillChainDef,
  depth: ChainDepth,
  t: (key: string) => string,
): string {
  const name = t(chain.nameKey)
  const tokens = estimateTokens(chain, depth)
  const depthLabel = t(`chain.depth.${depth}`)

  const lines: string[] = [
    `[AgentLore Skill Chain: ${chain.slug} — ${name}]`,
    `Depth: ${depthLabel} | Steps: ${chain.steps.length} | Est. ~${tokens} tokens`,
    "",
    "Execute these skills IN ORDER. Load each skill with get_skill() just-in-time, complete it, then move to the next.",
    "",
  ]

  chain.steps.forEach((step, i) => {
    const skill = getSkillForDepth(step, depth)
    const label = t(step.labelKey)
    const phase = t(`chain.phase.${step.phase}`)
    const optional = step.required ? "" : " (optional)"
    lines.push(`${i + 1}. [${phase}] /${skill} — ${label}${optional}`)
  })

  lines.push("")
  lines.push("After each step, produce a brief handoff summary (what was done, key decisions, artifacts).")
  lines.push("After the chain completes, /remember the key decisions to .agentrune/agentlore.md.")

  return lines.join("\n")
}
