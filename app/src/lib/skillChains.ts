// Skill Chain definitions + execution protocol
// See spec: docs/superpowers/specs/2026-03-10-skill-chains-design.md

export type ChainDepth = "lite" | "standard" | "deep"
export type ChainPhase = "design" | "implement" | "verify" | "ship"

export interface SkipCondition {
  type: "agentlore_has_pattern" | "simple_crud" | "read_only" | "low_complexity"
  hint: string // English hint for the agent to evaluate
}

export interface FailureAction {
  action: "retry" | "fallback" | "abort"
  fallbackSkill?: string // skill slug to run on failure
  maxRetries?: number
}

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
  skipWhen?: SkipCondition
  onFailure?: FailureAction
  contextFrom?: string[] // step IDs to inherit handoff from
  autoRemember?: boolean
}

export interface SkillChainDef {
  slug: string
  nameKey: string // i18n key
  descKey: string // i18n key
  steps: ChainStepDef[]
  tokenBudget: { lite: number; deep: number }
  forcedDepthTags?: string[] // domain tags that force deep on security/review steps
}

// Domain tags that force deep depth on security/review steps
export const FORCED_DEPTH_TAGS = [
  "payment", "auth", "migration", "public-api", "encryption",
  "user-data", "app-store", "supply-chain", "multi-tenant",
  "ai-agent", "backup", "container",
] as const

// High-complexity threshold (tokens) — show warning in UI
export const HIGH_COMPLEXITY_THRESHOLD = 10000

// ── 8 Built-in Chains ──────────────────────────────────

export const BUILTIN_CHAINS: SkillChainDef[] = [
  // 1. /feature — 新功能開發
  {
    slug: "feature",
    nameKey: "chain.feature.name",
    descKey: "chain.feature.desc",
    tokenBudget: { lite: 800, deep: 12000 },
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.brainstorm",
        skillSelection: { lite: "brainstorm", standard: "concise-planning", deep: "architecture" },
        required: true, defaultDepth: "lite",
        skipWhen: { type: "simple_crud", hint: "Skip if this is a routine CRUD endpoint or UI component with an existing pattern in agentlore.md" },
        autoRemember: true,
      },
      {
        id: "s2", phase: "design", labelKey: "chain.step.plan",
        skillSelection: { lite: "plan", standard: "plan", deep: "architecture" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        id: "s3", phase: "implement", labelKey: "chain.step.tdd",
        skillSelection: { lite: "tdd", standard: "tdd", deep: "test-driven-development" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s2"],
      },
      {
        id: "s4", phase: "verify", labelKey: "chain.step.review",
        skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s3"],
        onFailure: { action: "fallback", fallbackSkill: "fix", maxRetries: 2 },
      },
      {
        id: "s5", phase: "verify", labelKey: "chain.step.security",
        skillSelection: { lite: "security", standard: "security", deep: "security-auditor" },
        required: false, defaultDepth: "lite",
        skipWhen: { type: "read_only", hint: "Skip if this is a read-only feature with no user input, auth, or external data" },
        contextFrom: ["s3"],
      },
      {
        id: "s6", phase: "ship", labelKey: "chain.step.test",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
        onFailure: { action: "fallback", fallbackSkill: "debug" },
      },
      {
        id: "s7", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s8", phase: "ship", labelKey: "chain.step.doc",
        skillSelection: { lite: "doc", standard: "doc", deep: "documentation-templates" },
        required: false, defaultDepth: "lite",
        skipWhen: { type: "low_complexity", hint: "Skip if the change is small and self-explanatory (e.g. single endpoint, minor UI tweak)" },
      },
      {
        id: "s9", phase: "ship", labelKey: "chain.step.pr",
        skillSelection: { lite: "pr", standard: "pr", deep: "pr" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s2", "s7"],
      },
    ],
  },

  // 2. /bugfix — Bug 修復
  {
    slug: "bugfix",
    nameKey: "chain.bugfix.name",
    descKey: "chain.bugfix.desc",
    tokenBudget: { lite: 550, deep: 6500 },
    steps: [
      {
        id: "s1", phase: "verify", labelKey: "chain.step.debug",
        skillSelection: { lite: "debug", standard: "debugging-strategies", deep: "systematic-debugging" },
        required: true, defaultDepth: "lite",
        autoRemember: true,
      },
      {
        id: "s2", phase: "implement", labelKey: "chain.step.fix",
        skillSelection: { lite: "fix", standard: "fix", deep: "fix" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        id: "s3", phase: "verify", labelKey: "chain.step.test",
        skillSelection: { lite: "test", standard: "test", deep: "test-driven-development" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s2"],
        onFailure: { action: "fallback", fallbackSkill: "debug" },
      },
      {
        id: "s4", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 3. /hotfix — 緊急修補
  {
    slug: "hotfix",
    nameKey: "chain.hotfix.name",
    descKey: "chain.hotfix.desc",
    tokenBudget: { lite: 350, deep: 3500 },
    steps: [
      {
        id: "s1", phase: "implement", labelKey: "chain.step.fix",
        skillSelection: { lite: "fix", standard: "fix", deep: "fix" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s2", phase: "verify", labelKey: "chain.step.test",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
        onFailure: { action: "retry", maxRetries: 1 },
      },
      {
        id: "s3", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 4. /refactor — 重構
  {
    slug: "refactor",
    nameKey: "chain.refactor.name",
    descKey: "chain.refactor.desc",
    tokenBudget: { lite: 650, deep: 7000 },
    steps: [
      {
        id: "s1", phase: "verify", labelKey: "chain.step.testBaseline",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s2", phase: "implement", labelKey: "chain.step.refactor",
        skillSelection: { lite: "refactor", standard: "refactor", deep: "kaizen" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        id: "s3", phase: "verify", labelKey: "chain.step.testVerify",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
        onFailure: { action: "fallback", fallbackSkill: "debug" },
      },
      {
        id: "s4", phase: "verify", labelKey: "chain.step.review",
        skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s2"],
        onFailure: { action: "fallback", fallbackSkill: "fix", maxRetries: 2 },
      },
      {
        id: "s5", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 5. /secure — 安全加固
  {
    slug: "secure",
    nameKey: "chain.secure.name",
    descKey: "chain.secure.desc",
    tokenBudget: { lite: 650, deep: 9500 },
    steps: [
      {
        id: "s1", phase: "verify", labelKey: "chain.step.security",
        skillSelection: { lite: "security", standard: "security-auditor", deep: "security-auditor" },
        required: true, defaultDepth: "lite",
        autoRemember: true,
      },
      {
        id: "s2", phase: "implement", labelKey: "chain.step.fix",
        skillSelection: { lite: "fix", standard: "fix", deep: "backend-security-coder" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        id: "s3", phase: "verify", labelKey: "chain.step.test",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s4", phase: "verify", labelKey: "chain.step.review",
        skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s2"],
      },
      {
        id: "s5", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 6. /release — 發版
  {
    slug: "release",
    nameKey: "chain.release.name",
    descKey: "chain.release.desc",
    tokenBudget: { lite: 750, deep: 10000 },
    steps: [
      {
        id: "s1", phase: "verify", labelKey: "chain.step.test",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
        onFailure: { action: "abort" },
      },
      {
        id: "s2", phase: "verify", labelKey: "chain.step.review",
        skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" },
        required: true, defaultDepth: "lite",
        onFailure: { action: "fallback", fallbackSkill: "fix", maxRetries: 2 },
      },
      {
        id: "s3", phase: "verify", labelKey: "chain.step.security",
        skillSelection: { lite: "security", standard: "security-auditor", deep: "security-auditor" },
        required: false, defaultDepth: "lite",
      },
      {
        id: "s4", phase: "ship", labelKey: "chain.step.doc",
        skillSelection: { lite: "doc", standard: "doc", deep: "documentation-templates" },
        required: false, defaultDepth: "lite",
      },
      {
        id: "s5", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s6", phase: "ship", labelKey: "chain.step.pr",
        skillSelection: { lite: "pr", standard: "pr", deep: "pr" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s2"],
      },
    ],
  },

  // 7. /incident — 安全事件回應
  {
    slug: "incident",
    nameKey: "chain.incident.name",
    descKey: "chain.incident.desc",
    tokenBudget: { lite: 800, deep: 10000 },
    steps: [
      {
        id: "s1", phase: "verify", labelKey: "chain.step.investigate",
        skillSelection: { lite: "debug", standard: "debugging-strategies", deep: "incident-responder" },
        required: true, defaultDepth: "deep",
        autoRemember: true,
      },
      {
        id: "s2", phase: "implement", labelKey: "chain.step.contain",
        skillSelection: { lite: "fix", standard: "fix", deep: "fix" },
        required: true, defaultDepth: "deep",
        contextFrom: ["s1"],
      },
      {
        id: "s3", phase: "implement", labelKey: "chain.step.fix",
        skillSelection: { lite: "fix", standard: "fix", deep: "backend-security-coder" },
        required: true, defaultDepth: "deep",
        contextFrom: ["s1", "s2"],
      },
      {
        id: "s4", phase: "verify", labelKey: "chain.step.test",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "deep",
      },
      {
        id: "s5", phase: "verify", labelKey: "chain.step.securityVerify",
        skillSelection: { lite: "security", standard: "security-auditor", deep: "security-auditor" },
        required: true, defaultDepth: "deep",
        contextFrom: ["s1"],
      },
      {
        id: "s6", phase: "ship", labelKey: "chain.step.postmortem",
        skillSelection: { lite: "remember", standard: "remember", deep: "postmortem-writing" },
        required: true, defaultDepth: "deep",
        contextFrom: ["s1", "s3", "s5"],
        autoRemember: true,
      },
      {
        id: "s7", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 8. /onboard — 新人上手
  {
    slug: "onboard",
    nameKey: "chain.onboard.name",
    descKey: "chain.onboard.desc",
    tokenBudget: { lite: 500, deep: 2000 },
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.init",
        skillSelection: { lite: "init", standard: "init", deep: "init" },
        required: true, defaultDepth: "lite",
        skipWhen: { type: "agentlore_has_pattern", hint: "Skip if .agentrune/agentlore.md already exists and is comprehensive" },
      },
      {
        id: "s2", phase: "design", labelKey: "chain.step.onboard",
        skillSelection: { lite: "onboard", standard: "onboard", deep: "onboard" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s3", phase: "design", labelKey: "chain.step.explain",
        skillSelection: { lite: "explain", standard: "explain", deep: "architecture" },
        required: false, defaultDepth: "lite",
        skipWhen: { type: "agentlore_has_pattern", hint: "Skip if agentlore.md ## Key Files section is already thorough" },
      },
      {
        id: "s4", phase: "design", labelKey: "chain.step.remember",
        skillSelection: { lite: "remember", standard: "remember", deep: "remember" },
        required: true, defaultDepth: "lite",
        skipWhen: { type: "low_complexity", hint: "Skip if no new information was discovered during onboard/explain" },
        autoRemember: true,
      },
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
  return Math.round((chain.tokenBudget.lite + chain.tokenBudget.deep) / 2)
}

export function getSkillForDepth(step: ChainStepDef, depth: ChainDepth): string | null {
  return step.skillSelection[depth]
}

// ── Execution Protocol Formatter ────────────────────────

/** Format chain as complete execution protocol to send to agent */
export function formatChainInstructions(
  chain: SkillChainDef,
  depth: ChainDepth,
  t: (key: string) => string,
): string {
  const name = t(chain.nameKey)
  const tokens = estimateTokens(chain, depth)
  const depthLabel = t(`chain.depth.${depth}`)

  const sections: string[] = []

  // ── Header
  sections.push(
    `[AgentLore Skill Chain: ${chain.slug} — ${name}]`,
    `Depth: ${depthLabel} | Steps: ${chain.steps.length} | Est. ~${tokens} tokens`,
  )

  // ── Depth behavior
  sections.push("")
  if (depth === "lite") {
    sections.push("MODE: Lite — Use only the specified skill for each step. Do not search for additional skills.")
  } else if (depth === "standard") {
    sections.push("MODE: Standard — Use the specified skill + check agentlore.md ## Lessons for relevant past experience.")
  } else {
    sections.push("MODE: Deep — Use the specified skill + call find_skills() to search for additional domain knowledge. You may load multiple skills per step if relevant.")
  }

  // ── Execution protocol
  sections.push("")
  sections.push("=== EXECUTION PROTOCOL ===")
  sections.push("")
  sections.push("Execute steps IN ORDER. For each step:")
  sections.push("1. Check skip condition (if any) — suggest skipping with reason, wait for user confirm")
  sections.push("2. Load the skill via get_skill(slug) — just-in-time, one at a time")
  sections.push("3. Inject handoff context from prior steps (if contextFrom specified)")
  sections.push("4. Execute the skill fully")
  sections.push("5. Produce a HANDOFF (see format below)")
  sections.push("6. On failure, follow the onFailure action (retry/fallback/abort)")
  sections.push("7. Show progress: \"Step 3/9 done (tdd) — wrote 5 tests, all passing\"")

  // ── Handoff format
  sections.push("")
  sections.push("=== HANDOFF FORMAT (produce after each step) ===")
  sections.push("")
  sections.push("```")
  sections.push("HANDOFF [step_id]:")
  sections.push("  Summary: <1-3 sentences of what was done>")
  sections.push("  Decisions: <bullet list of choices made>")
  sections.push("  Artifacts: <file paths, test names, etc.>")
  sections.push("  Blockers: <unresolved issues, or \"none\">")
  sections.push("```")

  // ── Pipeline
  sections.push("")
  sections.push("=== PIPELINE ===")
  sections.push("")

  chain.steps.forEach((step, i) => {
    const skill = getSkillForDepth(step, depth)
    const label = t(step.labelKey)
    const phase = t(`chain.phase.${step.phase}`)
    const num = i + 1

    // Step header
    let line = `${num}. [${phase}] /${skill} — ${label}`
    if (!step.required) line += " (OPTIONAL)"
    sections.push(line)

    // Skip condition
    if (step.skipWhen) {
      sections.push(`   SKIP IF: ${step.skipWhen.hint}`)
    }

    // Context inheritance
    if (step.contextFrom && step.contextFrom.length > 0) {
      const fromLabels = step.contextFrom.map(id => {
        const s = chain.steps.find(x => x.id === id)
        return s ? t(s.labelKey) : id
      })
      sections.push(`   CONTEXT FROM: ${fromLabels.join(", ")}`)
    }

    // Failure handling
    if (step.onFailure) {
      const f = step.onFailure
      if (f.action === "retry") {
        sections.push(`   ON FAIL: Retry (max ${f.maxRetries ?? 1}x), then abort`)
      } else if (f.action === "fallback") {
        sections.push(`   ON FAIL: Run /${f.fallbackSkill} to fix, then re-run this step (max ${f.maxRetries ?? 1}x)`)
      } else {
        sections.push(`   ON FAIL: ABORT the chain — do not continue`)
      }
    }

    // Auto-remember
    if (step.autoRemember) {
      sections.push(`   AUTO-REMEMBER: Save key findings to agentlore.md after this step`)
    }
  })

  // ── Forced depth rules (for deep mode)
  if (depth === "deep") {
    sections.push("")
    sections.push("=== FORCED DEPTH RULES ===")
    sections.push("")
    sections.push("If the task involves ANY of these domain tags, security and review steps MUST use deep skills (even if user chose lite/standard):")
    sections.push(`Tags: ${FORCED_DEPTH_TAGS.join(", ")}`)
    sections.push("Detection: Check file paths, import statements, and task description for these domains.")
  }

  // ── Dynamic bundle matching (deep mode security steps)
  if (depth === "deep") {
    const securitySteps = chain.steps.filter(s =>
      s.skillSelection.deep?.includes("security") || s.id === "s5" && s.phase === "verify"
    )
    if (securitySteps.length > 0) {
      sections.push("")
      sections.push("=== DYNAMIC SECURITY SKILL SELECTION ===")
      sections.push("")
      sections.push("For security/review steps in deep mode:")
      sections.push("1. Call find_skills('security audit <detected-framework>') to find the best match")
      sections.push("2. If a domain-specific security skill exists (e.g. 'nextjs-security', 'react-native-security'), prefer it over the generic one")
      sections.push("3. Fallback to the specified skill if no better match found")
    }
  }

  // ── Chain completion
  sections.push("")
  sections.push("=== ON CHAIN COMPLETE ===")
  sections.push("")
  sections.push("1. Save all key decisions and lessons to .agentrune/agentlore.md via /remember")
  sections.push("2. Show a summary report:")
  sections.push("   - Steps completed vs skipped")
  sections.push("   - Key decisions made")
  sections.push("   - Files changed")
  sections.push("   - Any remaining TODOs")

  return sections.join("\n")
}
