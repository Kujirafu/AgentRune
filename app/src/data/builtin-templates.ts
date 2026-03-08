import type { AutomationTemplate } from "./automation-types"

const t = (id: string, name: string, desc: string, icon: string, prompt: string, skill?: string, tags?: string[], group?: string): AutomationTemplate => ({
  id: `builtin_${id}`,
  name,
  description: desc,
  icon,
  prompt,
  skill,
  category: "builtin",
  visibility: "public",
  rating: 0,
  ratingCount: 0,
  pinCount: 0,
  tags,
  group,
  createdAt: 0,
})

/** Display groups in order */
export const TEMPLATE_GROUPS = [
  { key: "git", label: "Git & Code Review" },
  { key: "ci", label: "CI & Testing" },
  { key: "security", label: "Dependencies & Security" },
  { key: "quality", label: "Code Quality" },
  { key: "docs", label: "Reports & Docs" },
  { key: "perf", label: "Performance & Build" },
  { key: "monitoring", label: "Monitoring" },
  { key: "learning", label: "Learning & Release" },
  { key: "agentlore", label: "AgentLore Knowledge" },
]

export const BUILTIN_TEMPLATES: AutomationTemplate[] = [
  // --- Git & Code Review ---

  t("scan_commits", "Scan Commits", "Scan recent commits for potential bugs and suggest fixes", "🔍",
    `Scan commits since the last run (or last 24 hours if first run).
For each commit:
1. Read the diff
2. Flag: off-by-one errors, missing null checks, broken error handling, race conditions, unintended side effects
3. Skip: formatting-only changes, version bumps, auto-generated files

Output format — for each finding:
- Commit hash + author
- File:line
- What's wrong (1 sentence)
- Minimal fix (code snippet)

Sort by severity (critical first). If nothing found, say "No issues detected" with commit count scanned.`,
    undefined, ["git", "bug", "review"], "git"),

  t("release_notes", "Release Notes", "Draft weekly release notes from merged PRs", "📋",
    `Draft release notes from PRs merged since last run (or last 7 days).

Steps:
1. List all merged PRs with title, author, PR number
2. Group into: Features, Bug Fixes, Improvements, Breaking Changes
3. Write a 1-line summary per PR (user-facing language, not code jargon)
4. Include PR links where available

Output as markdown. Skip: dependency bumps, CI config changes (mention count at bottom if any).
If no merged PRs found, say "No PRs merged in this period."`,
    undefined, ["git", "docs", "release"], "git"),

  t("standup", "Standup Summary", "Summarize yesterday's git activity for standup", "☀️",
    `Summarize yesterday's git activity for standup.

Collect from git log (last 24h):
1. Commits by author — what was worked on (group related commits)
2. PRs opened / merged / reviewed
3. Branches created or deleted

Output format:
**Done:** bullet list of completed work
**In Progress:** branches with recent commits but no merge
**Blockers:** PRs with review requested but no response (>24h)

Keep each bullet to 1 line. Use plain language, not commit messages verbatim.`,
    undefined, ["git", "report", "daily"], "git"),

  t("pr_review", "PR Summary", "Summarize recent PRs by author and theme, flag risks", "👥",
    `Summarize PRs from the last 7 days.

Group by author, then list each PR with:
- Title + PR number
- Size (files changed / lines)
- Risk level: LOW (< 100 lines, tests included) / MEDIUM / HIGH (> 500 lines, no tests, touches core)
- 1-line summary of what it does

Then a "Themes" section: what areas of the codebase got the most activity.
Finally, "Risk alerts": PRs that are HIGH risk, large without tests, or touching shared code without review.`,
    undefined, ["git", "review", "weekly"], "git"),

  // --- CI & Testing ---

  t("ci_failures", "CI Check", "Summarize CI failures and flaky tests, suggest fixes", "🔧",
    `Check CI pipeline status and recent test results.

1. List failed CI runs from the last 24h with:
   - Branch/PR, failure stage, error message (first 3 lines)
2. Identify flaky tests: tests that passed on retry or failed intermittently
3. For each failure, suggest:
   - Root cause category (config, dependency, code bug, timeout, infra)
   - Specific fix or investigation step

Output: table of failures sorted by frequency. If all green, say "All CI passing" with run count.`,
    undefined, ["ci", "test", "daily"], "ci"),

  t("test_coverage", "Test Coverage", "Find untested code paths and suggest focused tests", "🧪",
    `Analyze test coverage gaps from recent changes (last 7 days or since last run).

1. Find files changed recently that have NO corresponding test file
2. Find functions/methods with 0 test coverage (if coverage report available)
3. Identify critical paths without tests: auth, payment, data mutation, API handlers

For each gap, write:
- File:function
- Why it matters (what breaks if this has a bug)
- A concrete test case description (Given/When/Then)

Prioritize: auth > data mutation > API > UI. Skip: generated files, config, types-only files.`,
    undefined, ["test", "coverage", "quality"], "ci"),

  // --- Dependencies & Security ---

  t("dep_check", "Dependency Check", "Scan outdated dependencies and suggest safe upgrades", "📦",
    `Scan dependencies for updates and security issues.

1. Run or simulate: npm outdated / pip list --outdated / cargo outdated (match project's package manager)
2. Check for known vulnerabilities (npm audit / advisory databases)
3. Categorize updates:
   - SECURITY: has CVE or advisory — include severity + CVE ID
   - MAJOR: breaking version bump — note breaking changes from changelog
   - MINOR/PATCH: safe to update

Output per dependency:
- Package name: current → latest (type: security/major/minor)
- Risk: what might break
- Action: "safe to update" or "needs testing because X"

Skip: devDependencies with only patch updates.`,
    undefined, ["deps", "security", "weekly"], "security"),

  t("security_scan", "Security Scan", "Scan code for hardcoded secrets, injection, XSS, and OWASP risks", "🛡️",
    `Scan source code for security vulnerabilities. Check these categories:

1. **Secrets**: grep for API keys, tokens, passwords, private keys in code (not .env)
   - Patterns: "sk-", "ghp_", "AKIA", base64-encoded keys, password = "..."
2. **Injection**: raw SQL queries without parameterization, unsanitized user input in shell commands
3. **XSS**: dangerouslySetInnerHTML, unescaped user content in templates
4. **Auth**: endpoints without auth middleware, session tokens in URLs, missing CSRF
5. **Config**: debug mode in production, permissive CORS, missing security headers

For each finding:
- File:line — category — severity (CRITICAL/HIGH/MEDIUM/LOW)
- Code snippet showing the issue
- Fix: exact code change

Skip: test files, node_modules, vendored code. If clean, report "No vulnerabilities found" with file count scanned.`,
    undefined, ["security", "audit", "weekly"], "security"),

  t("env_audit", "Env Var Audit", "Compare .env.example with actual usage, find missing or unused vars", "🔑",
    `Audit environment variable usage across the codebase.

1. Scan all source files for: process.env.X, os.environ["X"], env("X"), import.meta.env.X
2. Read .env.example / .env.template / .env.sample (whichever exists)
3. Compare:
   - **Missing from .env.example**: used in code but not documented — RISK: new dev setup will fail
   - **Unused in .env.example**: documented but never referenced — NOISE: confusing for new devs
   - **No default/fallback**: used without || default or ?? fallback — RISK: crashes if unset

Output per variable:
- Variable name — status (missing/unused/no-default) — file:line where used
- Suggested fix

If everything matches, say "Environment variables are in sync" with count.`,
    undefined, ["config", "security", "env"], "security"),

  // --- Code Quality ---

  t("dead_code", "Dead Code Cleanup", "Find unused exports, functions, and imports to remove", "🧹",
    `Find dead code in the codebase. Check for:

1. **Unused exports**: exported functions/classes/constants never imported elsewhere
2. **Unused imports**: imported but never referenced in the file
3. **Unreachable code**: code after return/throw, always-false conditions
4. **Unused files**: files not imported by any other file (orphans)

For each finding:
- File:line — type (unused export/import/unreachable/orphan)
- Confidence: HIGH (definitely unused) / MEDIUM (might be used dynamically)
- Safe to remove? YES / NEEDS CHECK (might be used via dynamic import or reflection)

Skip: entry points (index files, pages), test files, config files, type declaration files.
Only report HIGH confidence items unless asked otherwise. Sort by file path.`,
    undefined, ["refactor", "cleanup", "quality"], "quality"),

  t("todo_sweep", "TODO Sweep", "Collect all TODO/FIXME/HACK comments, prioritize by age and urgency", "📌",
    `Collect all TODO, FIXME, HACK, and XXX comments in source code.

For each comment:
- File:line — tag (TODO/FIXME/HACK) — the comment text
- Age: when it was added (git blame date)
- Author: who wrote it

Group into:
1. **Stale** (> 90 days old): these are likely forgotten — recommend: fix or delete
2. **Blocking** (mentions "before release", "urgent", "breaks", "security"): needs attention
3. **Nice-to-have**: everything else

Summary at top: total count, oldest one, breakdown by age bucket (< 30d / 30-90d / > 90d).
If no TODOs found, say "Codebase is clean" with file count scanned.`,
    undefined, ["cleanup", "code", "quality"], "quality"),

  t("type_safety", "Type Safety Check", "Find any types, unsafe assertions, and unhandled nulls", "🔒",
    `Scan TypeScript/JavaScript source for type safety issues.

Check for:
1. **\`any\` usage**: explicit \`any\` types (skip test files) — suggest proper type
2. **Type assertions**: \`as Type\`, \`<Type>\` casts — flag unsafe ones (e.g. \`as any\`, casting unrelated types)
3. **Null risks**: optional chaining chains (?.?.?) that hide bugs, missing null checks before .property access
4. **Missing return types**: exported functions without explicit return type annotation

For each finding:
- File:line — category — code snippet
- Suggested fix with proper type

Summary: count by category, files with most issues. Focus on src/ (skip node_modules, generated, tests).
If project has strict tsconfig, note which strict flags are disabled.`,
    undefined, ["typescript", "quality", "weekly"], "quality"),

  // --- Reports & Docs ---

  t("weekly_summary", "Weekly Summary", "Synthesize PRs, rollouts, and incidents into a weekly update", "📰",
    `Generate a weekly project update covering the last 7 days.

Sections:
1. **Highlights**: top 3 most impactful changes (user-facing language)
2. **PRs Merged**: count + list with 1-line summaries, grouped by area
3. **Open PRs**: count + any stale ones (> 3 days without review)
4. **Issues**: new vs closed, any critical/blocking ones
5. **Incidents**: downtime, hotfixes, reverts (if any)
6. **Next Week**: infer from open PRs and recent branch activity

Format as markdown. Keep each section to 3-5 bullets max. Use plain language suitable for a team-wide audience (not just devs).`,
    undefined, ["report", "weekly"], "docs"),

  t("changelog", "Changelog Update", "Update CHANGELOG.md with recent highlights and PR links", "📝",
    `Update the project's CHANGELOG.md with changes since the last entry.

1. Read existing CHANGELOG.md to understand format and conventions
2. Collect merged PRs and direct commits since last changelog entry date
3. Write new entry following the existing format (usually: date header, then categorized list)
4. Categories: Added, Changed, Fixed, Removed, Security, Deprecated
5. Each line: brief description + PR/commit link

Rules:
- Match the tone and style of existing entries exactly
- Don't duplicate entries already in the changelog
- If using semver, suggest whether this is a patch/minor/major bump
- Write the changes to CHANGELOG.md at the top (after the header)`,
    undefined, ["docs", "changelog", "release"], "docs"),

  t("api_docs", "API Docs Sync", "Compare API endpoints with docs, find mismatches and update", "📡",
    `Sync API documentation with actual code.

1. Scan for API routes/endpoints (Express routes, Next.js API routes, FastAPI, etc.)
2. For each endpoint extract: method, path, parameters, request body, response shape, auth required
3. Compare with existing API docs (README, OpenAPI spec, docs/ folder, or inline JSDoc)
4. Report:
   - **Undocumented**: endpoints with no docs at all
   - **Outdated**: docs that don't match current params/response
   - **Missing fields**: documented but missing required/optional field info

For each gap: show endpoint, what's wrong, and write the corrected documentation.
If no API docs exist, generate a basic endpoint reference.`,
    undefined, ["docs", "api", "weekly"], "docs"),

  t("onboarding_doc", "Onboarding Guide", "Auto-generate or update a developer onboarding guide from codebase", "🎒",
    `Generate or update a developer onboarding guide for this project.

Analyze the codebase and produce:
1. **Quick Start**: setup steps (clone, install, env setup, run dev server) — verify commands actually work
2. **Project Structure**: key directories and what lives where (max 2 levels deep)
3. **Architecture**: main entry points, data flow, key abstractions (1 paragraph)
4. **Key Files**: the 10 most important files a new dev should read first (with 1-line description each)
5. **Common Tasks**: how to add a new page/route, how to add a test, how to deploy
6. **Conventions**: naming, file organization, commit message format, PR process (infer from existing code)

Write to docs/ONBOARDING.md (or update if exists). Keep it under 300 lines — concise beats comprehensive.`,
    undefined, ["docs", "onboarding", "monthly"], "docs"),

  // --- Performance & Build ---

  t("perf_audit", "Performance Audit", "Audit for performance regressions and suggest high-leverage fixes", "⚡",
    `Audit for performance regressions in recent changes (last 7 days).

Check for:
1. **N+1 queries**: loops with DB calls inside, missing eager loading
2. **Large renders**: React components re-rendering entire lists, missing memo/useMemo
3. **Blocking operations**: synchronous file I/O, heavy computation on main thread
4. **Memory leaks**: event listeners not cleaned up, growing caches without eviction
5. **Network**: redundant API calls, missing caching headers, large payloads without pagination

For each finding:
- File:line — category — impact estimate (high/medium/low)
- Current code snippet
- Optimized code snippet

Rank by impact. Focus on changes in the last 7 days but flag old issues if they're in hot paths.`,
    undefined, ["perf", "audit", "weekly"], "perf"),

  t("bundle_size", "Bundle Size Monitor", "Analyze build output for large chunks and suggest optimizations", "📊",
    `Analyze build output and bundle sizes.

Steps:
1. Run the project's build command (npm run build / vite build / next build)
2. List all output chunks with sizes (sorted largest first)
3. Flag chunks > 200KB (warning) or > 500KB (critical)
4. For large chunks, trace what's inside:
   - Which dependencies contribute most (show package + size)
   - Any duplicated dependencies (same lib bundled twice)
5. Suggest fixes:
   - Dynamic import() candidates (heavy libs used in few routes)
   - Tree-shaking issues (importing entire lib vs specific exports)
   - Smaller alternatives (moment→dayjs, lodash→lodash-es)

Compare with previous build log if available in project. Output as a summary table.`,
    undefined, ["perf", "build", "weekly"], "perf"),

  // --- Monitoring ---

  t("error_digest", "Error Digest", "Scan recent logs and errors, group by pattern and suggest fixes", "🚨",
    `Scan for errors in project logs and recent output.

Sources to check (use whichever exist):
- Log files: logs/, *.log, /tmp/*, stderr output
- Build warnings: TypeScript errors, ESLint warnings, compiler output
- Runtime errors: uncaught exceptions in recent git changes, error handling gaps

For each error pattern:
- Error message (first occurrence)
- Frequency: how many times / how many files
- Category: build / runtime / config / dependency
- Root cause (1 sentence)
- Fix: specific code change or config adjustment

Group by category, sort by frequency within each group.
Top section: "Critical" errors (crashes, data loss, security). Bottom: warnings.
If no errors found, report "All clear" with what was scanned.`,
    undefined, ["monitoring", "debug", "daily"], "monitoring"),

  t("db_migration", "Migration Check", "Check DB migrations for consistency, missing indexes, and breaking changes", "🗄️",
    `Review database migrations and schema health.

1. List recent migrations (last 30 days) with: name, date, what changed
2. Check for issues:
   - **Missing indexes**: foreign keys without index, columns used in WHERE/ORDER BY without index
   - **Breaking changes**: column drops, type changes, NOT NULL additions without defaults
   - **Rollback safety**: can each migration be reversed? Is there a down migration?
   - **Schema drift**: do models/types in code match the actual schema?
3. Check migration order: any conflicts or gaps in sequence numbers?

For each issue:
- Migration file — problem — severity (blocks deploy / risky / cosmetic)
- Fix: migration code to add missing index, or flag for manual review

If using Prisma: compare schema.prisma with migration history.`,
    undefined, ["db", "migration", "weekly"], "monitoring"),

  // --- Learning & Release ---

  t("skill_suggest", "Skill Insights", "Analyze recent PRs and reviews to suggest skills to improve", "🎯",
    `Analyze recent development activity to suggest skills to improve.

Look at last 14 days of:
1. PRs written: what areas, what patterns, what was revised during review
2. Review comments received: recurring feedback themes
3. Bugs introduced: what category of mistakes (null handling, async, edge cases)
4. Time-consuming tasks: large PRs or many-revision PRs (suggest tools/patterns to speed up)

Output:
- **Strengths**: 2-3 areas where code quality is consistently good
- **Growth areas**: 2-3 specific skills with concrete learning resources
  - E.g. "Error handling in async code — try: [specific pattern or article]"
- **Quick wins**: 1-2 small habits that would immediately improve code quality

Be specific and actionable, not generic ("write better tests" → "add edge case tests for null inputs in API handlers").`,
    undefined, ["learning", "monthly"], "learning"),

  t("agentlore_sync", "AgentLore Sync", "Analyze content gaps and auto-fill missing knowledge in AgentLore", "🧠",
    `Sync AgentLore knowledge base — find content gaps and fill them.

Step 1 — Collect Gaps:
Run this SQL via the project's database connection (or Prisma query):
  SELECT query, COUNT(*) as count FROM "SearchQuery" WHERE "isGap" = true AND "gapResolved" = false GROUP BY query ORDER BY count DESC LIMIT 20
If no SearchQuery table exists or no gaps found, skip to Step 3.

Step 2 — Fill Gaps:
For each gap query (top 10 by frequency):
1. Research the topic using your own knowledge + web search if available
2. Verify the information is accurate and practically useful
3. Call the AgentLore MCP submit_knowledge tool with:
   - title: concise, searchable title
   - domain: best matching domain
   - content: structured knowledge with ## Overview, ## Best Practices, ## Common Pitfalls, ## Working Examples
   - tags: relevant search terms (include the original gap query as a tag)
4. After submission, mark the gap as resolved:
   UPDATE "SearchQuery" SET "gapResolved" = true, "resolvedAt" = NOW() WHERE query = '<gap_query>' AND "isGap" = true

Step 3 — Refresh Stale Content:
1. Call AgentLore MCP search("") with each popular domain to find entries
2. For entries older than 90 days with low confidence, check if information is still current
3. If outdated, submit updated version via submit_knowledge

Step 4 — Report:
Summarize: how many gaps found, how many filled, how many stale entries refreshed.
Save findings to .agentrune/agentlore.md ## AgentLore Sync Log.`,
    undefined, ["knowledge", "sync", "agentlore"], "agentlore"),

  t("agentlore_skill_audit", "Skill Card Audit", "Audit AgentLore skill cards — find low-performing ones and improve", "🔧",
    `Audit AgentLore skill cards for quality and coverage.

Step 1 — Analyze Usage:
Run this SQL:
  SELECT sc.slug, sc.name, sc."usageCount",
    COUNT(CASE WHEN su.outcome = 'SUCCESS' THEN 1 END) as successes,
    COUNT(CASE WHEN su.outcome = 'FAILED' THEN 1 END) as failures,
    COUNT(CASE WHEN su.outcome = 'OUTDATED' THEN 1 END) as outdated
  FROM "SkillCard" sc
  LEFT JOIN "SkillUsage" su ON su."skillCardId" = sc.id
  GROUP BY sc.id ORDER BY failures DESC LIMIT 20

Step 2 — Fix Low-Performing Skills:
For each skill with failure rate > 30%:
1. Read the skill card content (steps, gotchas)
2. Check SkillUsage feedbackNote for common complaints
3. Research current best practices for the topic
4. Update the skill card with corrected steps/gotchas

Step 3 — Coverage Gaps:
Compare SearchQuery gaps (isGap=true) with existing scenarios.
For frequent gap queries that match no scenario:
1. Create a new Scenario with appropriate keywords
2. Link relevant existing skill cards, or create new ones

Step 4 — Report:
Summarize: skills audited, fixed, new scenarios created, coverage improvement.`,
    undefined, ["skills", "audit", "agentlore"], "agentlore"),

  t("release_check", "Release Checklist", "Verify changelog, migrations, flags, and tests before tagging", "✅",
    `Pre-release verification checklist. Run before tagging a release.

Check each item and report PASS / FAIL / SKIP (with reason):

1. **Tests**: all tests passing? Any skipped tests? Coverage above project threshold?
2. **CHANGELOG**: has an entry for this version? Covers all merged PRs since last release?
3. **Migrations**: any pending migrations? All migrations reversible?
4. **Feature flags**: any flags that should be enabled/removed for this release?
5. **Dependencies**: any security advisories? Any pinned to pre-release versions?
6. **Build**: does production build succeed without warnings? Bundle size within limits?
7. **Environment**: all required env vars documented? Any new ones added since last release?
8. **Breaking changes**: any API/schema changes that need migration guide or deprecation notice?

Summary at top: X/8 passed, Y failed, Z skipped.
For each FAIL: what specifically is wrong and what to do about it.`,
    undefined, ["release", "check"], "learning"),
]
