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
  agentConfig?: StepAgentConfig
}

export interface StepAgentConfig {
  agentId?: string  // "claude" | "codex" | "gemini" | "cursor" | ...
  model?: string    // "opus" | "sonnet" | "haiku" | "gpt-5" | "default"
}

export interface ParallelGroup {
  type: "parallel"
  id: string
  phase: ChainPhase
  labelKey: string
  branches: ChainStepDef[]
  joinStrategy: "all" | "any"
}

export type ChainNode = ChainStepDef | ParallelGroup

// Type guard
export function isParallelGroup(node: ChainNode): node is ParallelGroup {
  return "type" in node && (node as ParallelGroup).type === "parallel"
}

/** Resolve chain display text — i18n key if starts with "chain.", otherwise literal */
export function resolveChainText(key: string, t: (k: string) => string): string {
  return key.startsWith("chain.") ? t(key) : key
}

export interface SkillChainDef {
  slug: string
  nameKey: string // i18n key
  descKey: string // i18n key
  steps: ChainNode[]
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

// ── 28 Built-in Chains ─────────────────────────────────

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
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelVerify",
        branches: [
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
        ],
        joinStrategy: "all",
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
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelTestReview",
        branches: [
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
        ],
        joinStrategy: "all",
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
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelTestReview",
        branches: [
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
        ],
        joinStrategy: "all",
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
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelTestReview",
        branches: [
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
        ],
        joinStrategy: "all",
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
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelTestSecurity",
        branches: [
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
        ],
        joinStrategy: "all",
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
        type: "parallel", id: "p1", phase: "design",
        labelKey: "chain.step.parallelOnboardExplain",
        branches: [
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
        ],
        joinStrategy: "all",
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

  // ── App Development ─────────────────────────────────────

  // 9. /mobile-feature — 手機 App 功能開發
  {
    slug: "mobile-feature",
    nameKey: "chain.mobile-feature.name",
    descKey: "chain.mobile-feature.desc",
    tokenBudget: { lite: 850, deep: 12000 },
    forcedDepthTags: ["app-store", "user-data"],
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.brainstorm",
        skillSelection: { lite: "brainstorm", standard: "concise-planning", deep: "architecture" },
        required: true, defaultDepth: "lite",
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
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelVerify",
        branches: [
          {
            id: "s4", phase: "verify", labelKey: "chain.step.review",
            skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" },
            required: true, defaultDepth: "lite",
            contextFrom: ["s3"],
            onFailure: { action: "fallback", fallbackSkill: "fix", maxRetries: 2 },
          },
          {
            id: "s5", phase: "verify", labelKey: "chain.step.deviceTest",
            skillSelection: { lite: "test", standard: "test", deep: "test" },
            required: true, defaultDepth: "lite",
            onFailure: { action: "fallback", fallbackSkill: "debug" },
          },
        ],
        joinStrategy: "all",
      },
      {
        id: "s6", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 10. /app-release — App 發版
  {
    slug: "app-release",
    nameKey: "chain.app-release.name",
    descKey: "chain.app-release.desc",
    tokenBudget: { lite: 700, deep: 9000 },
    forcedDepthTags: ["app-store"],
    steps: [
      {
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelTestReview",
        branches: [
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
          },
        ],
        joinStrategy: "all",
      },
      {
        id: "s3", phase: "ship", labelKey: "chain.step.versionBump",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s4", phase: "ship", labelKey: "chain.step.buildApk",
        skillSelection: { lite: null, standard: null, deep: null },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s5", phase: "ship", labelKey: "chain.step.publishRelease",
        skillSelection: { lite: "pr", standard: "pr", deep: "pr" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s2"],
      },
    ],
  },

  // ── API Development ─────────────────────────────────────

  // 11. /api-endpoint — API 端點開發
  {
    slug: "api-endpoint",
    nameKey: "chain.api-endpoint.name",
    descKey: "chain.api-endpoint.desc",
    tokenBudget: { lite: 650, deep: 8000 },
    forcedDepthTags: ["public-api", "auth", "user-data"],
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.plan",
        skillSelection: { lite: "plan", standard: "plan", deep: "architecture" },
        required: true, defaultDepth: "lite",
        skipWhen: { type: "simple_crud", hint: "Skip if this is a standard CRUD endpoint following existing patterns" },
      },
      {
        id: "s2", phase: "implement", labelKey: "chain.step.tdd",
        skillSelection: { lite: "tdd", standard: "tdd", deep: "test-driven-development" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelVerify",
        branches: [
          {
            id: "s3", phase: "verify", labelKey: "chain.step.security",
            skillSelection: { lite: "security", standard: "security", deep: "security-auditor" },
            required: true, defaultDepth: "lite",
            contextFrom: ["s2"],
          },
          {
            id: "s4", phase: "verify", labelKey: "chain.step.review",
            skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" },
            required: true, defaultDepth: "lite",
            contextFrom: ["s2"],
            onFailure: { action: "fallback", fallbackSkill: "fix", maxRetries: 2 },
          },
        ],
        joinStrategy: "all",
      },
      {
        id: "s5", phase: "ship", labelKey: "chain.step.doc",
        skillSelection: { lite: "doc", standard: "doc", deep: "documentation-templates" },
        required: false, defaultDepth: "lite",
        skipWhen: { type: "low_complexity", hint: "Skip if endpoint is internal-only and self-explanatory" },
      },
      {
        id: "s6", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 12. /api-migration — DB Migration
  {
    slug: "api-migration",
    nameKey: "chain.api-migration.name",
    descKey: "chain.api-migration.desc",
    tokenBudget: { lite: 600, deep: 7500 },
    forcedDepthTags: ["migration", "backup"],
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.plan",
        skillSelection: { lite: "plan", standard: "plan", deep: "architecture" },
        required: true, defaultDepth: "lite",
        autoRemember: true,
      },
      {
        id: "s2", phase: "verify", labelKey: "chain.step.testBaseline",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s3", phase: "implement", labelKey: "chain.step.migrate",
        skillSelection: { lite: null, standard: null, deep: null },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        id: "s4", phase: "verify", labelKey: "chain.step.testVerify",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
        onFailure: { action: "fallback", fallbackSkill: "debug" },
      },
      {
        id: "s5", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 13. /api-integration — 第三方 API 整合
  {
    slug: "api-integration",
    nameKey: "chain.api-integration.name",
    descKey: "chain.api-integration.desc",
    tokenBudget: { lite: 700, deep: 9000 },
    forcedDepthTags: ["encryption", "auth"],
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.brainstorm",
        skillSelection: { lite: "brainstorm", standard: "concise-planning", deep: "architecture" },
        required: true, defaultDepth: "lite",
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
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelVerify",
        branches: [
          {
            id: "s4", phase: "verify", labelKey: "chain.step.security",
            skillSelection: { lite: "security", standard: "security", deep: "security-auditor" },
            required: true, defaultDepth: "lite",
            contextFrom: ["s3"],
          },
          {
            id: "s5", phase: "verify", labelKey: "chain.step.test",
            skillSelection: { lite: "test", standard: "test", deep: "test" },
            required: true, defaultDepth: "lite",
            onFailure: { action: "fallback", fallbackSkill: "debug" },
          },
        ],
        joinStrategy: "all",
      },
      {
        id: "s6", phase: "ship", labelKey: "chain.step.doc",
        skillSelection: { lite: "doc", standard: "doc", deep: "documentation-templates" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s7", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // ── Security ────────────────────────────────────────────

  // 14. /pentest — 滲透測試
  {
    slug: "pentest",
    nameKey: "chain.pentest.name",
    descKey: "chain.pentest.desc",
    tokenBudget: { lite: 700, deep: 11000 },
    forcedDepthTags: ["auth", "encryption", "user-data", "public-api"],
    steps: [
      {
        id: "s1", phase: "verify", labelKey: "chain.step.reconnaissance",
        skillSelection: { lite: "security", standard: "security-auditor", deep: "security-auditor" },
        required: true, defaultDepth: "deep",
        autoRemember: true,
      },
      {
        id: "s2", phase: "verify", labelKey: "chain.step.vulnScan",
        skillSelection: { lite: "security", standard: "security-auditor", deep: "security-auditor" },
        required: true, defaultDepth: "deep",
        contextFrom: ["s1"],
      },
      {
        id: "s3", phase: "implement", labelKey: "chain.step.fix",
        skillSelection: { lite: "fix", standard: "fix", deep: "backend-security-coder" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s2"],
      },
      {
        id: "s4", phase: "verify", labelKey: "chain.step.testVerify",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
        onFailure: { action: "fallback", fallbackSkill: "debug" },
      },
      {
        id: "s5", phase: "ship", labelKey: "chain.step.securityReport",
        skillSelection: { lite: "doc", standard: "doc", deep: "documentation-templates" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1", "s2", "s3"],
        autoRemember: true,
      },
      {
        id: "s6", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 15. /dep-audit — 依賴審計
  {
    slug: "dep-audit",
    nameKey: "chain.dep-audit.name",
    descKey: "chain.dep-audit.desc",
    tokenBudget: { lite: 400, deep: 5000 },
    forcedDepthTags: ["supply-chain"],
    steps: [
      {
        id: "s1", phase: "verify", labelKey: "chain.step.depScan",
        skillSelection: { lite: "security", standard: "security", deep: "security-auditor" },
        required: true, defaultDepth: "lite",
        autoRemember: true,
      },
      {
        id: "s2", phase: "implement", labelKey: "chain.step.depUpdate",
        skillSelection: { lite: "fix", standard: "fix", deep: "fix" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        id: "s3", phase: "verify", labelKey: "chain.step.test",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
        onFailure: { action: "fallback", fallbackSkill: "debug" },
      },
      {
        id: "s4", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // ── Automation ──────────────────────────────────────────

  // 16. /bot-build — 自動化機器人開發
  {
    slug: "bot-build",
    nameKey: "chain.bot-build.name",
    descKey: "chain.bot-build.desc",
    tokenBudget: { lite: 800, deep: 10000 },
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.brainstorm",
        skillSelection: { lite: "brainstorm", standard: "concise-planning", deep: "architecture" },
        required: true, defaultDepth: "lite",
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
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelTestReview",
        branches: [
          {
            id: "s4", phase: "verify", labelKey: "chain.step.review",
            skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" },
            required: true, defaultDepth: "lite",
            contextFrom: ["s3"],
          },
          {
            id: "s5", phase: "verify", labelKey: "chain.step.test",
            skillSelection: { lite: "test", standard: "test", deep: "test" },
            required: true, defaultDepth: "lite",
            onFailure: { action: "fallback", fallbackSkill: "debug" },
          },
        ],
        joinStrategy: "all",
      },
      {
        id: "s6", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s7", phase: "ship", labelKey: "chain.step.doc",
        skillSelection: { lite: "doc", standard: "doc", deep: "documentation-templates" },
        required: false, defaultDepth: "lite",
      },
    ],
  },

  // 17. /ci-cd — CI/CD Pipeline
  {
    slug: "ci-cd",
    nameKey: "chain.ci-cd.name",
    descKey: "chain.ci-cd.desc",
    tokenBudget: { lite: 550, deep: 7000 },
    forcedDepthTags: ["container"],
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.plan",
        skillSelection: { lite: "plan", standard: "plan", deep: "architecture" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s2", phase: "implement", labelKey: "chain.step.implement",
        skillSelection: { lite: null, standard: null, deep: null },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelVerify",
        branches: [
          {
            id: "s3", phase: "verify", labelKey: "chain.step.test",
            skillSelection: { lite: "test", standard: "test", deep: "test" },
            required: true, defaultDepth: "lite",
            onFailure: { action: "retry", maxRetries: 2 },
          },
          {
            id: "s4", phase: "verify", labelKey: "chain.step.security",
            skillSelection: { lite: "security", standard: "security", deep: "security-auditor" },
            required: false, defaultDepth: "lite",
          },
        ],
        joinStrategy: "all",
      },
      {
        id: "s5", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s6", phase: "ship", labelKey: "chain.step.doc",
        skillSelection: { lite: "doc", standard: "doc", deep: "documentation-templates" },
        required: false, defaultDepth: "lite",
        skipWhen: { type: "low_complexity", hint: "Skip if pipeline config is self-explanatory" },
      },
    ],
  },

  // 18. /scraper — 網頁爬蟲開發
  {
    slug: "scraper",
    nameKey: "chain.scraper.name",
    descKey: "chain.scraper.desc",
    tokenBudget: { lite: 600, deep: 7500 },
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.plan",
        skillSelection: { lite: "plan", standard: "plan", deep: "architecture" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s2", phase: "implement", labelKey: "chain.step.tdd",
        skillSelection: { lite: "tdd", standard: "tdd", deep: "test-driven-development" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        id: "s3", phase: "verify", labelKey: "chain.step.test",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
        onFailure: { action: "fallback", fallbackSkill: "debug" },
      },
      {
        id: "s4", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // ── AI/ML ───────────────────────────────────────────────

  // 19. /ai-feature — AI 功能開發
  {
    slug: "ai-feature",
    nameKey: "chain.ai-feature.name",
    descKey: "chain.ai-feature.desc",
    tokenBudget: { lite: 850, deep: 12000 },
    forcedDepthTags: ["ai-agent", "user-data"],
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.brainstorm",
        skillSelection: { lite: "brainstorm", standard: "concise-planning", deep: "architecture" },
        required: true, defaultDepth: "lite",
        autoRemember: true,
      },
      {
        id: "s2", phase: "design", labelKey: "chain.step.plan",
        skillSelection: { lite: "plan", standard: "plan", deep: "architecture" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        id: "s3", phase: "implement", labelKey: "chain.step.promptDesign",
        skillSelection: { lite: null, standard: null, deep: null },
        required: true, defaultDepth: "lite",
        contextFrom: ["s2"],
      },
      {
        id: "s4", phase: "implement", labelKey: "chain.step.tdd",
        skillSelection: { lite: "tdd", standard: "tdd", deep: "test-driven-development" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s3"],
      },
      {
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelVerify",
        branches: [
          {
            id: "s5", phase: "verify", labelKey: "chain.step.review",
            skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" },
            required: true, defaultDepth: "lite",
            contextFrom: ["s4"],
            onFailure: { action: "fallback", fallbackSkill: "fix", maxRetries: 2 },
          },
          {
            id: "s6", phase: "verify", labelKey: "chain.step.security",
            skillSelection: { lite: "security", standard: "security", deep: "security-auditor" },
            required: false, defaultDepth: "lite",
            skipWhen: { type: "read_only", hint: "Skip if AI feature has no user input or external data exposure" },
          },
        ],
        joinStrategy: "all",
      },
      {
        id: "s7", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 20. /prompt-pipeline — Prompt 工程流水線
  {
    slug: "prompt-pipeline",
    nameKey: "chain.prompt-pipeline.name",
    descKey: "chain.prompt-pipeline.desc",
    tokenBudget: { lite: 500, deep: 6000 },
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.brainstorm",
        skillSelection: { lite: "brainstorm", standard: "concise-planning", deep: "architecture" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s2", phase: "implement", labelKey: "chain.step.promptDesign",
        skillSelection: { lite: null, standard: null, deep: null },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        id: "s3", phase: "verify", labelKey: "chain.step.test",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
        onFailure: { action: "retry", maxRetries: 2 },
      },
      {
        id: "s4", phase: "ship", labelKey: "chain.step.doc",
        skillSelection: { lite: "doc", standard: "doc", deep: "documentation-templates" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s5", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 21. /rag-setup — RAG 系統建置
  {
    slug: "rag-setup",
    nameKey: "chain.rag-setup.name",
    descKey: "chain.rag-setup.desc",
    tokenBudget: { lite: 750, deep: 10000 },
    forcedDepthTags: ["ai-agent"],
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.brainstorm",
        skillSelection: { lite: "brainstorm", standard: "concise-planning", deep: "architecture" },
        required: true, defaultDepth: "lite",
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
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelTestReview",
        branches: [
          {
            id: "s4", phase: "verify", labelKey: "chain.step.test",
            skillSelection: { lite: "test", standard: "test", deep: "test" },
            required: true, defaultDepth: "lite",
            onFailure: { action: "fallback", fallbackSkill: "debug" },
          },
          {
            id: "s5", phase: "verify", labelKey: "chain.step.review",
            skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" },
            required: true, defaultDepth: "lite",
            contextFrom: ["s3"],
          },
        ],
        joinStrategy: "all",
      },
      {
        id: "s6", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // ── DevOps ──────────────────────────────────────────────

  // 22. /docker-deploy — Docker 部署
  {
    slug: "docker-deploy",
    nameKey: "chain.docker-deploy.name",
    descKey: "chain.docker-deploy.desc",
    tokenBudget: { lite: 550, deep: 7000 },
    forcedDepthTags: ["container"],
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.plan",
        skillSelection: { lite: "plan", standard: "plan", deep: "architecture" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s2", phase: "implement", labelKey: "chain.step.implement",
        skillSelection: { lite: null, standard: null, deep: null },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelVerify",
        branches: [
          {
            id: "s3", phase: "verify", labelKey: "chain.step.security",
            skillSelection: { lite: "security", standard: "security", deep: "security-auditor" },
            required: true, defaultDepth: "lite",
            contextFrom: ["s2"],
          },
          {
            id: "s4", phase: "verify", labelKey: "chain.step.test",
            skillSelection: { lite: "test", standard: "test", deep: "test" },
            required: true, defaultDepth: "lite",
            onFailure: { action: "retry", maxRetries: 1 },
          },
        ],
        joinStrategy: "all",
      },
      {
        id: "s5", phase: "ship", labelKey: "chain.step.doc",
        skillSelection: { lite: "doc", standard: "doc", deep: "documentation-templates" },
        required: false, defaultDepth: "lite",
      },
      {
        id: "s6", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 23. /monitoring — 監控系統建置
  {
    slug: "monitoring",
    nameKey: "chain.monitoring.name",
    descKey: "chain.monitoring.desc",
    tokenBudget: { lite: 550, deep: 6500 },
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.plan",
        skillSelection: { lite: "plan", standard: "plan", deep: "architecture" },
        required: true, defaultDepth: "lite",
        autoRemember: true,
      },
      {
        id: "s2", phase: "implement", labelKey: "chain.step.implement",
        skillSelection: { lite: null, standard: null, deep: null },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        id: "s3", phase: "verify", labelKey: "chain.step.test",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
        onFailure: { action: "fallback", fallbackSkill: "debug" },
      },
      {
        id: "s4", phase: "ship", labelKey: "chain.step.doc",
        skillSelection: { lite: "doc", standard: "doc", deep: "documentation-templates" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s5", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 24. /infra — 基礎設施即代碼
  {
    slug: "infra",
    nameKey: "chain.infra.name",
    descKey: "chain.infra.desc",
    tokenBudget: { lite: 650, deep: 8500 },
    forcedDepthTags: ["container", "backup"],
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.plan",
        skillSelection: { lite: "plan", standard: "plan", deep: "architecture" },
        required: true, defaultDepth: "lite",
        autoRemember: true,
      },
      {
        id: "s2", phase: "implement", labelKey: "chain.step.implement",
        skillSelection: { lite: null, standard: null, deep: null },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelVerify",
        branches: [
          {
            id: "s3", phase: "verify", labelKey: "chain.step.security",
            skillSelection: { lite: "security", standard: "security", deep: "security-auditor" },
            required: true, defaultDepth: "lite",
            contextFrom: ["s2"],
          },
          {
            id: "s4", phase: "verify", labelKey: "chain.step.test",
            skillSelection: { lite: "test", standard: "test", deep: "test" },
            required: true, defaultDepth: "lite",
            onFailure: { action: "retry", maxRetries: 1 },
          },
        ],
        joinStrategy: "all",
      },
      {
        id: "s5", phase: "ship", labelKey: "chain.step.doc",
        skillSelection: { lite: "doc", standard: "doc", deep: "documentation-templates" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s6", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // ── Content / Web ───────────────────────────────────────

  // 25. /landing-page — Landing Page 開發
  {
    slug: "landing-page",
    nameKey: "chain.landing-page.name",
    descKey: "chain.landing-page.desc",
    tokenBudget: { lite: 700, deep: 8500 },
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.brainstorm",
        skillSelection: { lite: "brainstorm", standard: "concise-planning", deep: "architecture" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s2", phase: "design", labelKey: "chain.step.plan",
        skillSelection: { lite: "plan", standard: "plan", deep: "architecture" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        id: "s3", phase: "implement", labelKey: "chain.step.implement",
        skillSelection: { lite: null, standard: null, deep: null },
        required: true, defaultDepth: "lite",
        contextFrom: ["s2"],
      },
      {
        id: "s4", phase: "verify", labelKey: "chain.step.review",
        skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s3"],
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

  // 26. /seo-audit — SEO 審計
  {
    slug: "seo-audit",
    nameKey: "chain.seo-audit.name",
    descKey: "chain.seo-audit.desc",
    tokenBudget: { lite: 400, deep: 5000 },
    steps: [
      {
        id: "s1", phase: "verify", labelKey: "chain.step.audit",
        skillSelection: { lite: null, standard: null, deep: null },
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
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s4", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 27. /i18n — 國際化
  {
    slug: "i18n",
    nameKey: "chain.i18n.name",
    descKey: "chain.i18n.desc",
    tokenBudget: { lite: 550, deep: 6500 },
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.plan",
        skillSelection: { lite: "plan", standard: "plan", deep: "architecture" },
        required: true, defaultDepth: "lite",
      },
      {
        id: "s2", phase: "implement", labelKey: "chain.step.implement",
        skillSelection: { lite: null, standard: null, deep: null },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelTestReview",
        branches: [
          {
            id: "s3", phase: "verify", labelKey: "chain.step.review",
            skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" },
            required: true, defaultDepth: "lite",
            contextFrom: ["s2"],
          },
          {
            id: "s4", phase: "verify", labelKey: "chain.step.test",
            skillSelection: { lite: "test", standard: "test", deep: "test" },
            required: true, defaultDepth: "lite",
            onFailure: { action: "fallback", fallbackSkill: "debug" },
          },
        ],
        joinStrategy: "all",
      },
      {
        id: "s5", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 28. /perf — 效能優化
  {
    slug: "perf",
    nameKey: "chain.perf.name",
    descKey: "chain.perf.desc",
    tokenBudget: { lite: 600, deep: 7500 },
    steps: [
      {
        id: "s1", phase: "verify", labelKey: "chain.step.benchmark",
        skillSelection: { lite: "test", standard: "test", deep: "test" },
        required: true, defaultDepth: "lite",
        autoRemember: true,
      },
      {
        id: "s2", phase: "design", labelKey: "chain.step.plan",
        skillSelection: { lite: "plan", standard: "plan", deep: "architecture" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
      },
      {
        id: "s3", phase: "implement", labelKey: "chain.step.refactor",
        skillSelection: { lite: "refactor", standard: "refactor", deep: "kaizen" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s2"],
      },
      {
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelTestReview",
        branches: [
          {
            id: "s4", phase: "verify", labelKey: "chain.step.benchmarkVerify",
            skillSelection: { lite: "test", standard: "test", deep: "test" },
            required: true, defaultDepth: "lite",
            onFailure: { action: "fallback", fallbackSkill: "debug" },
          },
          {
            id: "s5", phase: "verify", labelKey: "chain.step.review",
            skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" },
            required: true, defaultDepth: "lite",
            contextFrom: ["s3"],
          },
        ],
        joinStrategy: "all",
      },
      {
        id: "s6", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },

  // 29. /test — 測試策略與品質工程
  // Based on: https://blog.wclee.me/testing-strategies-from-pyramid-to-ai-era/
  // Core: analyse architecture → pick testing model → write tests by model → AI-era layers
  {
    slug: "test",
    nameKey: "chain.test.name",
    descKey: "chain.test.desc",
    tokenBudget: { lite: 650, deep: 9000 },
    forcedDepthTags: ["ai-agent", "payment"],
    steps: [
      {
        id: "s1", phase: "design", labelKey: "chain.step.testStrategy",
        skillSelection: { lite: "test", standard: "test", deep: "test-driven-development" },
        required: true, defaultDepth: "lite",
        autoRemember: true,
        // Agent analyses architecture type (Monolith/SPA/Microservices/API-first/Event-driven/AI Agent)
        // and selects a testing model (Pyramid/Trophy/Honeycomb/Diamond/Crab/AI Test Pyramid).
        // Handoff includes: chosen model + layer proportions + risk areas.
      },
      {
        id: "s2", phase: "design", labelKey: "chain.step.testPlan",
        skillSelection: { lite: "plan", standard: "plan", deep: "architecture" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s1"],
        skipWhen: { type: "agentlore_has_pattern", hint: "Skip if project already has a complete test plan or testing conventions in agentlore.md" },
        // Identify high-risk areas (core paths, security, payment).
        // Decide tools per layer (vitest/testing-library/playwright/pact).
        // Target 80% coverage on high-risk paths.
      },
      {
        id: "s3", phase: "implement", labelKey: "chain.step.testCore",
        skillSelection: { lite: "tdd", standard: "tdd", deep: "test-driven-development" },
        required: true, defaultDepth: "lite",
        contextFrom: ["s2"],
        onFailure: { action: "retry", maxRetries: 2 },
        // Write the thickest layer of tests per the chosen model:
        // Diamond → API integration tests
        // Trophy  → component integration tests
        // Honeycomb → contract tests (Pact)
        // Crab    → E2E + visual regression
        // AI Test Pyramid → deterministic + record/playback
      },
      {
        id: "s4", phase: "implement", labelKey: "chain.step.testSupplementary",
        skillSelection: { lite: "tdd", standard: "tdd", deep: "test-driven-development" },
        required: false, defaultDepth: "lite",
        contextFrom: ["s3"],
        skipWhen: { type: "low_complexity", hint: "Skip if the core layer already provides sufficient coverage for the feature's risk level" },
        // Secondary layer: edge cases, boundary tests, error paths.
        // AI-era (deep): add benchmark tests + LLM-as-Judge evaluation.
        // Acceptance tests for vibe-coding projects (Given-When-Then from requirements).
      },
      {
        type: "parallel", id: "p1", phase: "verify",
        labelKey: "chain.step.parallelTestReview",
        branches: [
          {
            id: "s5", phase: "verify", labelKey: "chain.step.testRun",
            skillSelection: { lite: "test", standard: "test", deep: "test" },
            required: true, defaultDepth: "lite",
            onFailure: { action: "fallback", fallbackSkill: "debug" },
            // Run all tests, collect coverage report.
          },
          {
            id: "s6", phase: "verify", labelKey: "chain.step.testQuality",
            skillSelection: { lite: "review", standard: "code-review-checklist", deep: "code-review-checklist" },
            required: true, defaultDepth: "lite",
            contextFrom: ["s3"],
            // Review: tests should test behaviour, not implementation (Kent C. Dodds).
            // Check: no self-verification (AI-generated tests must not be the sole gate for AI-generated code).
            // Verify acceptance tests cover business requirements.
          },
        ],
        joinStrategy: "all",
      },
      {
        id: "s7", phase: "ship", labelKey: "chain.step.commit",
        skillSelection: { lite: "commit", standard: "commit", deep: "commit" },
        required: true, defaultDepth: "lite",
      },
    ],
  },
]

// ── Chain keyword map for natural language matching ─────

// Each chain maps to keywords in both EN and zh-TW for NL detection
const CHAIN_KEYWORDS: Record<string, string[]> = {
  "feature":         ["feature", "new feature", "add", "build", "implement", "功能", "新功能", "加", "開發", "實作"],
  "bugfix":          ["bug", "fix", "broken", "error", "crash", "修", "壞", "錯誤", "當機", "修復"],
  "hotfix":          ["hotfix", "urgent", "emergency", "prod down", "緊急", "急修", "線上壞"],
  "refactor":        ["refactor", "cleanup", "restructure", "rewrite", "重構", "整理", "重寫"],
  "secure":          ["security", "audit", "harden", "vulnerability", "安全", "稽核", "加固", "漏洞"],
  "release":         ["release", "deploy", "ship", "publish", "version", "發版", "部署", "交付", "上線"],
  "incident":        ["incident", "breach", "hack", "compromise", "事件", "入侵", "被駭"],
  "onboard":         ["onboard", "new project", "getting started", "understand", "上手", "新專案", "了解"],
  "mobile-feature":  ["mobile", "app feature", "capacitor", "react native", "flutter", "手機", "行動", "app"],
  "app-release":     ["app release", "apk", "app store", "google play", "ipa", "app 發版", "app 上架"],
  "api-endpoint":    ["api", "endpoint", "route", "rest", "graphql", "api 端點", "接口"],
  "api-migration":   ["migration", "schema", "database change", "alter table", "遷移", "schema 改", "資料庫"],
  "api-integration": ["integrate", "third party", "sdk", "webhook", "oauth", "整合", "第三方", "串接"],
  "pentest":         ["pentest", "penetration", "attack", "exploit", "owasp", "滲透", "攻擊", "弱點"],
  "dep-audit":       ["dependency", "audit", "npm audit", "outdated", "cve", "依賴", "套件", "過期"],
  "bot-build":       ["bot", "automation", "cron", "scheduled", "scrape", "機器人", "自動化", "排程"],
  "ci-cd":           ["ci", "cd", "pipeline", "github actions", "workflow", "cicd", "流水線", "自動部署"],
  "scraper":         ["scraper", "crawl", "spider", "extract", "爬蟲", "爬取", "抓取"],
  "ai-feature":      ["ai", "llm", "gpt", "claude", "openai", "gemini", "ai 功能", "大模型"],
  "prompt-pipeline": ["prompt", "prompt engineering", "chain of thought", "few shot", "prompt 工程", "提示詞"],
  "rag-setup":       ["rag", "retrieval", "embedding", "vector", "knowledge base", "向量", "檢索", "知識庫"],
  "docker-deploy":   ["docker", "container", "dockerfile", "compose", "容器", "docker 部署"],
  "monitoring":      ["monitor", "alert", "logging", "observability", "grafana", "監控", "告警", "日誌"],
  "infra":           ["infra", "terraform", "iac", "infrastructure", "cloud", "基礎設施", "雲端"],
  "landing-page":    ["landing", "homepage", "marketing page", "hero", "landing page", "首頁", "行銷頁"],
  "seo-audit":       ["seo", "meta tag", "sitemap", "lighthouse", "page speed", "搜尋優化"],
  "i18n":            ["i18n", "internationalization", "translate", "locale", "multilingual", "國際化", "翻譯", "多語"],
  "perf":            ["performance", "optimize", "slow", "speed", "benchmark", "效能", "優化", "太慢", "加速"],
  "test":            ["test", "testing", "tdd", "unit test", "integration test", "e2e", "coverage", "quality", "pyramid", "diamond", "trophy", "測試", "品質", "覆蓋率", "測試策略"],
}

// ── Helpers ──────────────────────────────────────────────

export const CHAIN_SLUGS = BUILTIN_CHAINS.map(c => c.slug)

export function findChainBySlug(slug: string): SkillChainDef | undefined {
  return BUILTIN_CHAINS.find(c => c.slug === slug)
}

/** Find chains by prefix (e.g. "api" matches api-endpoint, api-migration, api-integration) */
export function findChainsByPrefix(prefix: string): SkillChainDef[] {
  const p = prefix.toLowerCase()
  return BUILTIN_CHAINS.filter(c => c.slug.startsWith(p) || c.slug.includes(p))
}

export interface ChainMatch {
  chain: SkillChainDef
  score: number // 0-1 relevance
  matchType: "exact" | "prefix" | "keyword"
}

/** Smart chain search: exact slug > prefix > natural language keywords */
export function searchChains(input: string, t: (key: string) => string): ChainMatch[] {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return []

  // 1. Exact slug match (highest priority)
  const exact = findChainBySlug(trimmed)
  if (exact) return [{ chain: exact, score: 1, matchType: "exact" }]

  // 2. Prefix / partial slug match
  const prefixMatches = findChainsByPrefix(trimmed)
  if (prefixMatches.length > 0) {
    return prefixMatches.map(c => ({
      chain: c,
      score: trimmed.length / c.slug.length, // longer prefix = higher score
      matchType: "prefix" as const,
    })).sort((a, b) => b.score - a.score)
  }

  // 3. Natural language keyword matching
  const words = trimmed.split(/[\s,;.!?]+/).filter(w => w.length > 1)
  if (words.length === 0) return []

  const results: ChainMatch[] = []

  for (const chain of BUILTIN_CHAINS) {
    const keywords = CHAIN_KEYWORDS[chain.slug] ?? []
    // Also match against translated name/desc
    const name = t(chain.nameKey).toLowerCase()
    const desc = t(chain.descKey).toLowerCase()
    const allSearchable = [...keywords, name, desc]

    let hits = 0
    for (const word of words) {
      if (allSearchable.some(kw => kw.includes(word) || word.includes(kw))) {
        hits++
      }
    }

    if (hits > 0) {
      results.push({
        chain,
        score: hits / words.length,
        matchType: "keyword",
      })
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 5) // max 5 suggestions
}

export function estimateTokens(chain: SkillChainDef, depth: ChainDepth): number {
  if (depth === "lite") return chain.tokenBudget.lite
  if (depth === "deep") return chain.tokenBudget.deep
  return Math.round((chain.tokenBudget.lite + chain.tokenBudget.deep) / 2)
}

export function getStepCount(chain: SkillChainDef): number {
  let count = 0
  for (const node of chain.steps) {
    if (isParallelGroup(node)) {
      count += node.branches.length
    } else {
      count++
    }
  }
  return count
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
  const name = resolveChainText(chain.nameKey, t)
  const tokens = estimateTokens(chain, depth)
  const depthLabel = t(`chain.depth.${depth}`)

  const sections: string[] = []

  // ── Header
  sections.push(
    `[AgentLore Skill Chain: ${chain.slug} — ${name}]`,
    `Depth: ${depthLabel} | Steps: ${getStepCount(chain)} | Est. ~${tokens} tokens`,
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

  // ── Parallel execution protocol
  sections.push("")
  sections.push("=== PARALLEL EXECUTION ===")
  sections.push("")
  sections.push("When you encounter a [PARALLEL] block:")
  sections.push("1. Check each branch's agentConfig — if different agents specified, launch separate sessions via AgentRune")
  sections.push("2. If all branches use same agent (or no agentConfig), use Agent tool with run_in_background=true per branch")
  sections.push("3. Each subagent receives: the skill slug, handoff context, and step instructions")
  sections.push("4. Wait strategy: ALL = wait for every branch; ANY = proceed when first completes")
  sections.push("5. Collect HANDOFF from each completed branch and merge for downstream steps")

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

  // Helper: find step label by ID across all nodes
  const findStepLabel = (id: string): string => {
    for (const n of chain.steps) {
      if (isParallelGroup(n)) {
        const found = n.branches.find(x => x.id === id)
        if (found) return t(found.labelKey)
      } else if (n.id === id) return t(n.labelKey)
    }
    return id
  }

  // Helper: render a single step's metadata lines
  const renderStepMeta = (step: ChainStepDef, indent: string) => {
    if (step.skipWhen) {
      sections.push(`${indent}SKIP IF: ${step.skipWhen.hint}`)
    }
    if (step.contextFrom && step.contextFrom.length > 0) {
      sections.push(`${indent}CONTEXT FROM: ${step.contextFrom.map(findStepLabel).join(", ")}`)
    }
    if (step.onFailure) {
      const f = step.onFailure
      if (f.action === "retry") {
        sections.push(`${indent}ON FAIL: Retry (max ${f.maxRetries ?? 1}x), then abort`)
      } else if (f.action === "fallback") {
        sections.push(`${indent}ON FAIL: Run /${f.fallbackSkill} to fix, then re-run (max ${f.maxRetries ?? 1}x)`)
      } else {
        sections.push(`${indent}ON FAIL: ABORT the chain`)
      }
    }
    if (step.autoRemember) {
      sections.push(`${indent}AUTO-REMEMBER: Save key findings to agentlore.md after this step`)
    }
  }

  let stepNum = 0

  for (const node of chain.steps) {
    if (isParallelGroup(node)) {
      stepNum++
      const joinLabel = node.joinStrategy === "all" ? "ALL must complete" : "ANY completes"
      sections.push(`${stepNum}. [PARALLEL — ${joinLabel}]:`)

      for (let bi = 0; bi < node.branches.length; bi++) {
        const branch = node.branches[bi]
        const skill = getSkillForDepth(branch, depth)
        const label = t(branch.labelKey)
        const phase = t(`chain.phase.${branch.phase}`)
        const letter = String.fromCharCode(97 + bi)

        let line = `   ${stepNum}${letter}. [${phase}] /${skill} — ${label}`
        if (!branch.required) line += " (OPTIONAL)"
        sections.push(line)
        renderStepMeta(branch, "      ")
        if (branch.agentConfig?.agentId) {
          const agent = branch.agentConfig.agentId
          const model = branch.agentConfig.model || "default"
          sections.push(`      AGENT: ${agent} (${model})`)
        }
      }

      sections.push(`   → Wait for ${node.joinStrategy === "all" ? "ALL" : "ANY"} branches before proceeding.`)
    } else {
      stepNum++
      const skill = getSkillForDepth(node, depth)
      const label = t(node.labelKey)
      const phase = t(`chain.phase.${node.phase}`)

      let line = `${stepNum}. [${phase}] /${skill} — ${label}`
      if (!node.required) line += " (OPTIONAL)"
      sections.push(line)
      renderStepMeta(node, "   ")
    }
  }

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
    const allSteps: ChainStepDef[] = chain.steps.flatMap(n =>
      isParallelGroup(n) ? n.branches : [n]
    )
    const securitySteps = allSteps.filter(s =>
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
