// server/builtin-templates.ts
// Built-in automation templates — AgentLore Skill Cards
// Users pick a template → AutomationManager creates an automation with pre-filled prompt/schedule

import type { AutomationSchedule } from "./automation-manager.js"

export interface BuiltinTemplate {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  category: "daily" | "weekly" | "pre-release" | "maintenance"
  defaultSchedule: AutomationSchedule
  prompt: string
  agentloreHooks: AgentLoreHook[]
}

export type AgentLoreHook =
  | "update-project-status"
  | "submit-knowledge"
  | "sync-to-cloud"
  | "recommend-skills"

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [

  // ── Daily ────────────────────────────────────────────────────────────

  {
    id: "daily-bug-scan",
    name: "Daily Bug Scan",
    nameZh: "每日 Bug 掃描",
    description: "Scan recent commits for likely bugs and propose minimal fixes.",
    descriptionZh: "掃描最近 24 小時的 commit，找出可能的 bug 並提出最小修復方案。",
    category: "daily",
    defaultSchedule: { type: "daily", timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
    prompt: `Scan commits from the last 24 hours for likely bugs and propose minimal fixes.

Rules:
- Use ONLY concrete repo evidence (commit SHAs, file paths, diffs, failing tests, CI logs).
- If no bugs found, report "No issues detected today" — do NOT invent problems.
- Prefer the smallest safe fix; avoid refactors and unrelated cleanup.
- If a real bug is found, call agentlore.submit_knowledge() to record the root cause.`,
    agentloreHooks: ["update-project-status", "submit-knowledge"],
  },

  {
    id: "ci-monitor",
    name: "CI Monitor",
    nameZh: "CI 監控",
    description: "Check CI failures, group by root cause, and suggest fixes.",
    descriptionZh: "檢查 CI 執行結果，將失敗和 flaky tests 按根因分組，建議修復。",
    category: "daily",
    defaultSchedule: { type: "daily", timeOfDay: "15:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
    prompt: `Check recent CI runs. Group failures and flaky tests by likely root cause, and suggest minimal fixes.

Rules:
- Cite specific job names, test names, error messages, and log snippets.
- Separate "Confirmed" vs "Suspected" root causes — do NOT overstate confidence.
- If all green, report "CI all green" with the latest run timestamp.
- Search agentlore.search() first to check for known similar issues and solutions.`,
    agentloreHooks: ["update-project-status", "submit-knowledge"],
  },

  {
    id: "standup-summary",
    name: "Standup Summary",
    nameZh: "站會摘要",
    description: "Summarize yesterday's git activity for standup.",
    descriptionZh: "摘要昨天的 git 活動，產出站會報告格式。",
    category: "daily",
    defaultSchedule: { type: "daily", timeOfDay: "08:30", weekdays: [1, 2, 3, 4, 5] },
    prompt: `Summarize yesterday's git activity in standup format.

Rules:
- Anchor every statement to concrete commits / PRs / files.
- Format: Done / In Progress / Blocked.
- Do NOT speculate about intent or future work.
- Reference AGENTLORE.md (or project config) for project context.`,
    agentloreHooks: ["update-project-status"],
  },

  // ── Weekly ───────────────────────────────────────────────────────────

  {
    id: "weekly-release-notes",
    name: "Weekly Release Notes",
    nameZh: "週報 / Release Notes",
    description: "Draft release notes from this week's merged PRs.",
    descriptionZh: "從本週 merged PR / commits 產生 release notes。",
    category: "weekly",
    defaultSchedule: { type: "daily", timeOfDay: "20:00", weekdays: [0] },
    prompt: `Draft release notes from this week's merged PRs and commits.

Rules:
- Stay strictly within repo history — do NOT add content beyond what data supports.
- Use PR numbers/titles with links when available.
- Categorize: Features / Bug Fixes / Refactors / Infra.
- Do NOT editorialize impact unless supported by PR description, tests, or metrics.
- Match existing CHANGELOG format in the repo.`,
    agentloreHooks: ["update-project-status"],
  },

  {
    id: "weekly-engineering-summary",
    name: "Weekly Engineering Summary",
    nameZh: "工程週報",
    description: "Synthesize this week's PRs, deploys, incidents, and reviews.",
    descriptionZh: "綜合本週的 PR、部署、事故、code review 成一份週報。",
    category: "weekly",
    defaultSchedule: { type: "daily", timeOfDay: "17:00", weekdays: [5] },
    prompt: `Synthesize this week's PRs, deployments, incidents, and reviews into a weekly engineering update.

Rules:
- If data is missing, state "No records this week" — do NOT fabricate events.
- Reference concrete PR #, incident IDs, deploy logs, file paths where available.
- Sections: Key Changes / Incidents & Fixes / Notable Discussions.
- Search agentlore.search() for additional knowledge context.`,
    agentloreHooks: ["update-project-status"],
  },

  {
    id: "dependency-sweep",
    name: "Dependency Sweep",
    nameZh: "依賴掃描",
    description: "Scan outdated dependencies and propose safe upgrades.",
    descriptionZh: "掃描過期依賴，提出最小安全升級計畫。",
    category: "weekly",
    defaultSchedule: { type: "daily", timeOfDay: "10:00", weekdays: [6] },
    prompt: `Scan outdated dependencies and propose a minimal safe upgrade plan.

Rules:
- Read current versions from lockfiles and package manifests — do NOT guess.
- Prefer the smallest viable upgrade set.
- Explicitly flag breaking-change risks and required migrations.
- If target versions are unclear, label as "Suggested" with rationale.
- Search agentlore.find_skills("migration") for existing upgrade guides.`,
    agentloreHooks: ["update-project-status", "submit-knowledge"],
  },

  {
    id: "test-gap-detection",
    name: "Test Gap Detection",
    nameZh: "測試缺口偵測",
    description: "Find untested paths in recent changes and add focused tests.",
    descriptionZh: "從本週改動找出未測試的路徑，補上重點測試。",
    category: "weekly",
    defaultSchedule: { type: "daily", timeOfDay: "14:00", weekdays: [6] },
    prompt: `Identify untested code paths from this week's changes and add focused tests.

Rules:
- Scope to this week's changed files only — no broad refactors.
- Tests must be small and reliable: fail before fix, pass after.
- Priority: core logic > API endpoints > utilities > UI components.
- Reference AGENTLORE.md conventions for testing patterns.`,
    agentloreHooks: ["update-project-status"],
  },

  {
    id: "performance-watch",
    name: "Performance Watch",
    nameZh: "效能監控",
    description: "Compare recent changes to benchmarks and flag regressions.",
    descriptionZh: "比對最近改動與 benchmark / trace，標記效能退化。",
    category: "weekly",
    defaultSchedule: { type: "daily", timeOfDay: "16:00", weekdays: [6] },
    prompt: `Compare recent changes against benchmarks or traces and flag performance regressions.

Rules:
- Ground claims in measurable signals (benchmarks, traces, timings, bundle size).
- If no measurements available, state "No measurements found" and suggest what to measure.
- Separate "Observed" vs "Suspected" regressions.
- Search agentlore.search("performance optimization") for known best practices.`,
    agentloreHooks: ["update-project-status", "submit-knowledge"],
  },

  // ── Pre-release ──────────────────────────────────────────────────────

  {
    id: "pre-release-check",
    name: "Pre-release Check",
    nameZh: "發版前檢查",
    description: "Verify changelog, migrations, env vars, tests, and build before tagging.",
    descriptionZh: "在打 tag 前驗證 changelog、migration、環境變數、測試、build。",
    category: "pre-release",
    defaultSchedule: { type: "interval", intervalMinutes: 0 },  // manual trigger
    prompt: `Run pre-release verification checklist before tagging a release.

Checklist (adapt based on project context from AGENTLORE.md):
- [ ] Changelog updated
- [ ] DB migrations applied (if applicable)
- [ ] Environment variables complete (compare .env.example vs production)
- [ ] All tests passing
- [ ] Build has no warnings
- [ ] Feature flags in correct state (if applicable)
- [ ] i18n translations in sync (if applicable)
- [ ] Security headers configured (if applicable)

Rules:
- Only report what can be confirmed from repo and CI context.
- Mark unverifiable items as "Unknown — manual verification needed".`,
    agentloreHooks: ["update-project-status"],
  },

  // ── Maintenance ──────────────────────────────────────────────────────

  {
    id: "update-agentlore-config",
    name: "Update AGENTLORE.md",
    nameZh: "更新 AGENTLORE.md",
    description: "Discover new workflows and conventions, update the unified agent config.",
    descriptionZh: "從開發活動中發現新工作流和慣例，更新統一 agent 設定檔。",
    category: "maintenance",
    defaultSchedule: { type: "daily", timeOfDay: "12:00", weekdays: [0] },
    prompt: `Review recent development activity and update AGENTLORE.md with newly discovered workflows, commands, and conventions.

Rules:
- Only edit sections related to agent behavior and project conventions.
- Every addition must be backed by repo evidence (commits, PRs, actual files).
- If unsure, add a TODO note rather than guessing.
- Keep format consistent with the existing file.
- Cover: new scripts, API patterns, lint rules, deploy flows, tool integrations.
- Sync latest AgentLore skill cards list from cloud.

This file is the single source of truth for ALL agents:
Claude, Codex, Cursor, Windsurf, Gemini — everyone reads this one file.`,
    agentloreHooks: ["update-project-status", "sync-to-cloud"],
  },

  {
    id: "skill-progression-map",
    name: "Skill Progression Map",
    nameZh: "技能成長建議",
    description: "Suggest next skills to deepen based on recent PRs and reviews.",
    descriptionZh: "從最近的 PR 和 code review，建議下一步該深化的技能。",
    category: "maintenance",
    defaultSchedule: { type: "daily", timeOfDay: "09:00", weekdays: [1] },
    prompt: `Analyze recent PRs and code reviews to suggest skills worth deepening.

Rules:
- Anchor each suggestion to concrete evidence (PR themes, review comments, recurring issues).
- No generic advice — every recommendation must be actionable and specific.
- Sections: Improve Now / Worth Learning / Long-term Investment.
- Search agentlore.find_skills() to recommend relevant skill cards.`,
    agentloreHooks: ["update-project-status", "recommend-skills"],
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getTemplate(id: string): BuiltinTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id)
}

export function listTemplates(category?: BuiltinTemplate["category"]): BuiltinTemplate[] {
  if (category) return BUILTIN_TEMPLATES.filter((t) => t.category === category)
  return BUILTIN_TEMPLATES
}

export function getTemplatesByCategory(): Record<string, BuiltinTemplate[]> {
  const grouped: Record<string, BuiltinTemplate[]> = {}
  for (const t of BUILTIN_TEMPLATES) {
    if (!grouped[t.category]) grouped[t.category] = []
    grouped[t.category].push(t)
  }
  return grouped
}
