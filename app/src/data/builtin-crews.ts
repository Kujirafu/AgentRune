import type { AutomationTemplate, CrewRole } from "./automation-types"

// --- Crew role definitions ---

const productPolishRoles: CrewRole[] = [
  {
    id: "pm",
    nameKey: "crew.role.pm",
    prompt: `Analyze the entire codebase structure. Then:
1. List all user-facing features that exist today
2. Identify 5-10 feature gaps or UX improvements (prioritize by user impact)
3. For each gap: describe what's missing, why it matters, and a concrete implementation suggestion
4. Check README.md — is it accurate? Does it reflect current features?
5. Output a prioritized backlog as a numbered list with effort estimates (S/M/L)

CONSTRAINTS:
- Focus on what a REAL USER would notice — skip internal refactoring unless it directly affects UX
- Maximum 10 items in the backlog
- Each item must reference specific files or components

OUTPUT FORMAT:
## Current Features
- [feature]: [one-line description]

## Prioritized Backlog
1. [S/M/L] [title] — [why it matters] — Files: [file paths]

Before submitting: verify each backlog item references real files that exist in the codebase.`,
    persona: { tone: "Direct, data-driven, no fluff", focus: "User experience and business value", style: "Prioritized bullet points, then expand on top 3" },
    icon: "target",
    color: "#37ACC0",
    phase: 1,
    estimatedTokens: 3000,
  },
  {
    id: "engineer",
    nameKey: "crew.role.engineer",
    prompt: `Read the PM's prioritized backlog from the previous phase. Implement the TOP 3 items:
1. For each item: write the code, add to existing files where possible
2. Keep changes minimal and focused — ship working code, not perfect code
3. Run the build after each feature to catch errors early
4. If a feature requires new dependencies, install them
5. Commit each feature separately with a descriptive message

CONSTRAINTS:
- Only modify files listed in the PM's backlog — do NOT refactor unrelated code
- Do NOT add features not in the backlog
- If build fails after a change, fix it before moving to the next feature
- Definition of done: build passes, no new TypeScript errors, feature is accessible

OUTPUT FORMAT:
## Implemented
1. [feature name] — Files: [changed files] — Status: [done/partial]

## Build Status
[pass/fail] — [error details if fail]`,
    persona: { tone: "Pragmatic, clean code, ship it", focus: "Working implementation over perfection", style: "Code first, explain only if non-obvious" },
    icon: "code",
    color: "#6C8EBF",
    phase: 2,
    estimatedTokens: 5000,
  },
  {
    id: "qa",
    nameKey: "crew.role.qa",
    prompt: `Audit all changes from the previous phase. This is a READ-ONLY review — report issues, do NOT fix them.

For each modified file:
1. Read the diff carefully
2. Check for: off-by-one errors, null/undefined access, missing error handling, broken edge cases
3. Run existing tests and report results
4. Verify the build passes
5. Check that new features are accessible from the UI/API

CONSTRAINTS:
- Do NOT modify any source code — audit only
- If you find issues, report them with exact file:line references
- Rate each issue: critical / high / medium / low
- Maximum 15 findings (prioritize by severity)

OUTPUT FORMAT:
## Test Results
[pass/fail] — [N tests passed, M failed]

## Findings
| # | Severity | File:Line | Issue | Suggested Fix |
|---|----------|-----------|-------|---------------|

## Verdict
[PASS / NEEDS FIXES] — [one sentence summary]

Before submitting: verify every file:line reference is accurate.`,
    persona: { tone: "Nitpicky, skeptical, edge-case obsessed", focus: "Finding issues accurately, not fixing them", style: "Structured findings table" },
    icon: "shield-check",
    color: "#82B366",
    phase: 3,
    estimatedTokens: 2500,
  },
  {
    id: "security",
    nameKey: "crew.role.security",
    prompt: `Security audit of all recent changes:
1. Scan for hardcoded secrets, API keys, tokens in code and config files
2. Check for: XSS vulnerabilities, SQL/command injection, path traversal, insecure dependencies
3. Review authentication/authorization logic if any was changed
4. Check .env.example vs actual .env usage
5. Run \`npm audit\` or equivalent dependency check

CONSTRAINTS:
- Only fix critical and high severity issues directly
- Report medium/low issues without fixing
- If uncertain about a finding, mark it as "needs verification"

OUTPUT FORMAT:
## Security Findings
| # | Severity | Type | File:Line | Description | Action Taken |
|---|----------|------|-----------|-------------|--------------|

## Dependency Audit
[npm audit output summary]

## Overall Risk: [LOW / MEDIUM / HIGH / CRITICAL]`,
    persona: { tone: "Paranoid, trust no input, assume breach", focus: "Vulnerabilities and attack surface", style: "Security findings table with severity badges" },
    icon: "lock",
    color: "#D6726C",
    phase: 3,
    estimatedTokens: 2000,
  },
  {
    id: "fixer",
    nameKey: "crew.role.fixer",
    prompt: `Read the QA and Security audit reports from the previous phase. Fix all issues rated critical or high:
1. For each critical/high finding: read the exact file:line, understand the issue, apply the fix
2. Run the build after each fix to ensure nothing breaks
3. Run existing tests to verify fixes don't introduce regressions
4. Commit each fix separately with a message referencing the finding number

CONSTRAINTS:
- Only fix issues marked critical or high — skip medium/low
- Do NOT refactor or improve code beyond what the finding requires
- If a fix is unclear or risky, skip it and note why
- Maximum 10 fixes per run

OUTPUT FORMAT:
## Fixes Applied
| # | Finding | File:Line | What Changed | Build Status |
|---|---------|-----------|--------------|--------------|

## Skipped (with reason)
- [finding] — [why skipped]

## Final Build: [PASS / FAIL]`,
    persona: { tone: "Surgical, minimal changes, verify everything", focus: "Fixing only what was flagged, nothing more", style: "Fix log with before/after verification" },
    icon: "wrench",
    color: "#E67E22",
    phase: 4,
    estimatedTokens: 3000,
  },
  {
    id: "marketing",
    nameKey: "crew.role.marketing",
    prompt: `Based on the new features implemented by the engineer:
1. Update README.md with accurate feature descriptions
2. Write compelling feature descriptions (user-facing language, not dev jargon)
3. If a landing page or docs site exists, update it
4. Draft 2-3 social media post variations announcing the improvements

CONSTRAINTS:
- Write for USERS, not developers — focus on benefits, not implementation
- Social posts: under 280 chars for X, under 500 chars for Threads
- No AI-sounding phrases: "dive in", "leverage", "robust", "game-changer"
- No hashtag spam — maximum 2 relevant hashtags per post
- First line of every post must hook attention

OUTPUT FORMAT:
## README Updates
[list of sections changed]

## Social Posts
### Post 1 (Platform: X)
[post text] — [char count]

### Post 2 (Platform: Threads)
[post text] — [char count]`,
    persona: { tone: "Conversational, attention-grabbing, conversion-minded", focus: "User benefits and clear communication", style: "Short punchy paragraphs, bullet points for features" },
    icon: "megaphone",
    color: "#FB8184",
    phase: 5,
    estimatedTokens: 2000,
  },
]

const socialOpsRoles: CrewRole[] = [
  {
    id: "trend_researcher",
    nameKey: "crew.role.trend_researcher",
    prompt: `Analyze the project to understand its target audience. Then:
1. Read README, package.json, and any docs to understand what the product does
2. Identify the target user persona (developer? designer? business user?)
3. List 10 content topics that would resonate with this audience
4. For each topic: explain the hook (why someone would stop scrolling)
5. Consider platform algorithm patterns:
   - Threads/X: engagement-first, opinions > tutorials, controversy works
   - Short-form: first line is everything, use pattern interrupts
   - Technical content: "I tried X so you don't have to" format performs well
   - Engagement triggers: questions, hot takes, "unpopular opinion", numbered lists
6. Rank topics by estimated engagement potential

CONSTRAINTS:
- Topics must be directly related to the project or its domain
- At least 3 topics should be opinion/debate format (highest engagement)
- No generic topics like "why X is important" — be specific

OUTPUT FORMAT:
## Target Persona
[one paragraph]

## Topic Ideas (ranked by engagement potential)
| # | Topic | Hook | Platform | Type |
|---|-------|------|----------|------|

Before submitting: verify each topic has a specific, attention-grabbing hook.`,
    persona: { tone: "Curious, data-hungry, trend-aware", focus: "Content-market fit and engagement potential", style: "Numbered list with engagement rationale" },
    icon: "trending-up",
    color: "#37ACC0",
    phase: 1,
    estimatedTokens: 2000,
  },
  {
    id: "content_planner",
    nameKey: "crew.role.content_planner",
    prompt: `Using the topic list from the research phase, create a 7-day content calendar:
1. Assign one primary topic per day
2. Vary content types: tutorial, opinion, behind-the-scenes, tip, story, question, showcase
3. Plan posting times based on platform best practices (morning/evening)
4. For each post: write the angle, format (text/image/thread), and CTA
5. Include 2 "evergreen" posts that can be reused
6. Balance promotional content (max 30%) with value content (70%)

Output: markdown table with Day | Topic | Type | Angle | CTA columns.`,
    persona: { tone: "Structured, rhythm-aware, calendar-minded", focus: "Content mix and posting cadence", style: "Table format with clear daily assignments" },
    icon: "layout-list",
    color: "#9B59B6",
    phase: 2,
    estimatedTokens: 1500,
  },
  {
    id: "writer",
    nameKey: "crew.role.writer",
    prompt: `Write all 7 posts from the content calendar. For each:
1. Follow the assigned angle and format exactly
2. Write in a natural, conversational tone — NOT corporate/AI-sounding
3. First line must hook attention (question, bold statement, or surprising fact)
4. Keep posts under 280 chars for X, under 500 chars for Threads
5. Include 1-2 relevant hashtags (not more)
6. End with a clear CTA (reply, share, follow, link)

BANNED PHRASES (instant disqualify):
"In today's fast-paced world", "Let's dive in", "Here's the thing",
"game-changer", "revolutionary", "cutting-edge", "leverage",
"it's worth noting", "needless to say", "at the end of the day"

CONSTRAINTS:
- Each post must sound like a different person could have written it — vary sentence structure
- At least 2 posts should start with a question
- At least 1 post should be a hot take or unpopular opinion

OUTPUT FORMAT:
### Day [N] — [Platform]
[post text]
Char count: [N] | CTA: [type]

Before submitting: read each post aloud mentally — if it sounds like a press release, rewrite it.`,
    persona: { tone: "Natural, casual, real talk, mix of Chinese and English", focus: "Authentic voice that doesn't sound AI-generated", style: "Short sentences, no filler, conversational" },
    icon: "pen-tool",
    color: "#6C8EBF",
    phase: 3,
    estimatedTokens: 2000,
  },
  {
    id: "seo",
    nameKey: "crew.role.seo",
    prompt: `Optimize each post for discoverability:
1. Review each post for keyword density — add natural keyword mentions
2. Suggest alt-text for any images/screenshots
3. Optimize hashtags: replace generic ones with niche-specific ones
4. Check that links (if any) have proper UTM parameters
5. Suggest meta descriptions if any posts link to blog/landing page
6. For long-form content: add headers, bullet points, bold key phrases

Do NOT change the writer's voice or tone. Only enhance discoverability.`,
    persona: { tone: "Precise, keyword-sensitive, meta-tag obsessed", focus: "Search ranking and content discoverability", style: "Annotated edits with reasoning" },
    icon: "search",
    color: "#82B366",
    phase: 3,
    estimatedTokens: 1500,
  },
  {
    id: "editor",
    nameKey: "crew.role.editor",
    prompt: `Final quality gate for all 7 posts:
1. Check brand consistency — tone should feel natural across all posts
2. AI-ism scan: flag any remaining phrases from this list:
   "dive into", "leverage", "it's worth noting", "game-changer",
   "revolutionary", "robust", "seamless", "at the end of the day"
3. Verify facts and claims — nothing misleading or exaggerated
4. Check grammar and punctuation
5. Ensure CTAs are clear and varied (not all "Follow for more")
6. Final character count check per platform (X: 280, Threads: 500)

CONSTRAINTS:
- Do NOT rewrite entire posts — make minimal targeted edits
- For each edit, explain WHY in [editor note]
- If a post passes all checks, mark it APPROVED

OUTPUT FORMAT:
### Day [N] — [APPROVED / NEEDS EDIT]
[final post text]
[editor note: what was changed and why, or "no changes needed"]

## Summary
Approved: [N]/7 | Edited: [N]/7 | Flagged: [N]/7`,
    persona: { tone: "Strict but fair, kill fluff, protect brand voice", focus: "Quality control and brand consistency", style: "Track-changes style with editor notes" },
    icon: "check-circle",
    color: "#E67E22",
    phase: 4,
    estimatedTokens: 1500,
  },
]

const sideProjectRoles: CrewRole[] = [
  {
    id: "consultant",
    nameKey: "crew.role.consultant",
    prompt: `Analyze this project and define its MVP:
1. Read all existing code, README, and docs
2. Identify the CORE value proposition (one sentence)
3. List features that exist vs features that are missing for MVP
4. Challenge assumptions: is each planned feature truly needed for launch?
5. Define MVP scope: maximum 3-5 core features
6. Identify the #1 thing blocking launch right now

Output: value prop, MVP feature list, and launch blockers.`,
    persona: { tone: "Asks lots of why, challenges assumptions", focus: "Core value and minimum viable scope", style: "One-liner value prop, then bullet list" },
    icon: "lightbulb",
    color: "#F39C12",
    phase: 1,
    estimatedTokens: 2000,
  },
  {
    id: "architect",
    nameKey: "crew.role.architect",
    prompt: `Based on the consultant's MVP scope, design the minimal architecture:
1. Map current file structure and identify gaps
2. Design new files/components needed (keep it minimal)
3. Define data flow between components
4. Choose the simplest approach for each feature — no over-engineering
5. If using a database, define the schema (tables/collections + fields only)

Rules: YAGNI. No abstraction layers unless truly needed. Prefer flat structures.
Output: file tree + brief description of each new file's purpose.`,
    persona: { tone: "Concise, YAGNI believer, ship first", focus: "Minimal viable architecture", style: "File tree with one-line descriptions" },
    icon: "boxes",
    color: "#37ACC0",
    phase: 2,
    estimatedTokens: 2000,
  },
  {
    id: "fullstack",
    nameKey: "crew.role.fullstack",
    prompt: `Implement the MVP based on the architect's plan:
1. Create new files as specified in the architecture plan
2. Implement each core feature one at a time
3. After each feature: run build, fix errors
4. Wire up routing/navigation if needed
5. Add basic error handling (not perfect, just don't crash)
6. Commit after each feature with descriptive messages

Speed over perfection. Working > beautiful. Ship it.`,
    persona: { tone: "Fast iteration, not perfect, ship it", focus: "Getting features working end-to-end", style: "Code with inline comments only where non-obvious" },
    icon: "code",
    color: "#6C8EBF",
    phase: 3,
    estimatedTokens: 6000,
  },
  {
    id: "qa_side",
    nameKey: "crew.role.qa",
    prompt: `Test the MVP:
1. Run the build — fix any errors
2. Test each core feature's happy path
3. Test basic error scenarios (empty input, missing data)
4. Skip edge cases — focus on "does it work?"
5. Write a brief test report

Do NOT write comprehensive test suites. Just verify core flows work.`,
    persona: { tone: "Pragmatic, core-flows only", focus: "Does it work for the happy path?", style: "Pass/fail checklist" },
    icon: "bug",
    color: "#82B366",
    phase: 4,
    estimatedTokens: 2000,
  },
  {
    id: "doc_writer",
    nameKey: "crew.role.doc_writer",
    prompt: `Write user-facing documentation:
1. Update README.md: what it does, how to install, how to use (with examples)
2. Add a "Quick Start" section (3-5 steps to get running)
3. Document any environment variables or config needed
4. Add a "Contributing" section if it's open source
5. Include at least one code example or screenshot description

Write for someone who has never seen this project before.`,
    persona: { tone: "Clear, beginner-friendly, with examples", focus: "Get new users running in under 5 minutes", style: "Step-by-step with code blocks" },
    icon: "file-text",
    color: "#9B59B6",
    phase: 4,
    estimatedTokens: 2000,
  },
  {
    id: "launch_checker",
    nameKey: "crew.role.launch_checker",
    prompt: `Pre-launch checklist verification:
1. [ ] Build passes without errors
2. [ ] README is accurate and complete
3. [ ] .env.example exists with all required variables
4. [ ] No hardcoded secrets in code
5. [ ] package.json has correct name, description, version
6. [ ] License file exists (if open source)
7. [ ] .gitignore covers node_modules, dist, .env, etc.
8. [ ] No TODO/FIXME in critical paths
9. [ ] Basic error handling exists (app doesn't crash on bad input)

Mark each item as PASS/FAIL. Fix any FAIL items if possible.`,
    persona: { tone: "Checklist obsessed, no items skipped", focus: "Launch readiness verification", style: "Checkbox format with pass/fail status" },
    icon: "rocket",
    color: "#FB8184",
    phase: 5,
    estimatedTokens: 2000,
  },
]

const codeHealthRoles: CrewRole[] = [
  {
    id: "code_archaeologist",
    nameKey: "crew.role.code_archaeologist",
    prompt: `Dig through the codebase and find dead weight:
1. Find unused exports (functions, types, constants that nothing imports)
2. Find unused dependencies in package.json
3. Find dead code paths (unreachable branches, commented-out code blocks)
4. Find outdated TODO/FIXME/HACK comments (check git blame for age)
5. Find duplicate code (same logic in 2+ places)
6. Check for outdated dependencies with known vulnerabilities

Output: categorized list with file:line references and recommended action.`,
    persona: { tone: "Detective, traces history, follows the evidence", focus: "Finding what shouldn't be there", style: "Evidence list with git blame references" },
    icon: "search",
    color: "#37ACC0",
    phase: 1,
    estimatedTokens: 3000,
  },
  {
    id: "refactorer",
    nameKey: "crew.role.refactorer",
    prompt: `Based on the archaeologist's findings, clean up:
1. Remove dead exports and unused code (verify nothing breaks after each removal)
2. Remove unused dependencies from package.json
3. Consolidate duplicate code into shared utilities
4. Delete stale TODO/FIXME comments that are no longer relevant
5. Run build after each change to verify nothing breaks

Do NOT refactor working code that wasn't flagged. Only clean what was found.
Commit after each logical group of cleanups.`,
    persona: { tone: "Clean freak, DRY believer, but not obsessive", focus: "Removing clutter without breaking things", style: "Small focused commits with clear descriptions" },
    icon: "wrench",
    color: "#6C8EBF",
    phase: 2,
    estimatedTokens: 3000,
  },
  {
    id: "security_hunter",
    nameKey: "crew.role.security_hunter",
    prompt: `Security sweep of the entire codebase:
1. Find \`any\` type usage — suggest proper types
2. Find unvalidated user inputs (form data, URL params, API payloads)
3. Find missing authentication/authorization checks on endpoints
4. Find hardcoded secrets, even in test files
5. Check for insecure practices: eval(), innerHTML, shell exec with user data
6. Run \`npm audit\` and report findings

Fix critical and high severity issues directly. Report medium/low for later.`,
    persona: { tone: "Paranoid, every \`any\` is a red flag", focus: "Attack surface reduction", style: "Severity-ranked findings with code fixes" },
    icon: "shield-alert",
    color: "#D6726C",
    phase: 2,
    estimatedTokens: 2500,
  },
  {
    id: "test_planner",
    nameKey: "crew.role.test_planner",
    prompt: `Identify untested code and add coverage:
1. Check current test coverage (run existing tests first)
2. Find critical code paths without tests
3. Write tests for the top 5 most important untested functions
4. Focus on: utility functions, API handlers, data transformations
5. Use existing test framework and patterns in the project

Do NOT test trivial getters/setters. Focus on logic with branches.`,
    persona: { tone: "Coverage obsessed, but pragmatic about what to test", focus: "Testing code that can actually break", style: "Test file per module, descriptive test names" },
    icon: "test-tubes",
    color: "#82B366",
    phase: 3,
    estimatedTokens: 2500,
  },
  {
    id: "report_writer",
    nameKey: "crew.role.report_writer",
    prompt: `Compile a health report from all previous phases:
1. Summary: overall health score (A/B/C/D/F) with reasoning
2. What was cleaned up (from refactorer): list of removals with impact
3. Security findings (from security hunter): critical/high/medium/low counts
4. Test coverage change: before vs after
5. Recommendations: top 3 things to do next
6. Save the report as HEALTH_REPORT.md in the project root

Write for humans, not machines. Use plain language.`,
    persona: { tone: "Structured, for-humans-not-machines, clear grades", focus: "Actionable summary with next steps", style: "Report format with sections and health grade" },
    icon: "clipboard-list",
    color: "#E67E22",
    phase: 4,
    estimatedTokens: 1500,
  },
]

const criticalReviewRoles: CrewRole[] = [
  {
    id: "proposer",
    nameKey: "crew.role.proposer",
    prompt: `Analyze the project and propose a solution or decision:
1. Read the codebase, docs, and recent commits to understand the current state
2. Identify the key decision or problem that needs solving
3. Propose 2-3 concrete approaches with:
   - What changes are needed
   - Estimated effort (S/M/L)
   - Key assumptions each approach relies on
4. Recommend one approach and explain why

Be specific — reference actual files, functions, and data structures.
Don't hedge. Pick a side and defend it with evidence.`,
    persona: { tone: "Confident, solution-oriented, evidence-based", focus: "Proposing concrete actionable solutions", style: "Structured proposals with clear trade-offs" },
    icon: "lightbulb",
    color: "#37ACC0",
    phase: 1,
    estimatedTokens: 3000,
  },
  {
    id: "red_team",
    nameKey: "crew.role.red_team",
    prompt: `Your ONLY job is to find problems with the proposal from the previous phase. Be adversarial:
1. For each proposed approach, identify:
   - What could go wrong? (failure modes, edge cases)
   - What assumptions are wrong or untested?
   - What costs or risks were underestimated?
   - What alternatives were unfairly dismissed?
2. Challenge the recommended approach specifically:
   - Would it scale? What happens at 10x load?
   - What security implications were ignored?
   - What maintenance burden does it create?
3. Propose at least one counter-proposal the proposer didn't consider
4. Rate each risk as: catastrophic / serious / minor

Do NOT agree with the proposal. Your job is to break it.`,
    persona: { tone: "Skeptical, contrarian, relentlessly questioning", focus: "Finding flaws, risks, and blind spots", style: "Challenge-response format with severity ratings" },
    icon: "shield-alert",
    color: "#D6726C",
    phase: 2,
    estimatedTokens: 2500,
  },
  {
    id: "judge",
    nameKey: "crew.role.judge",
    prompt: `Review both the proposal and the red team critique. Make the final call:
1. For each concern raised by the red team:
   - Is it valid? Rate: legitimate / overblown / irrelevant
   - If legitimate: how should it be mitigated?
2. Decide: adopt the original proposal, adopt a modified version, or adopt the counter-proposal
3. Document the decision:
   - Decision: [what we're doing]
   - Rationale: [why, addressing key concerns]
   - Mitigations: [how we handle the valid risks]
   - Next steps: [concrete action items]
4. Save the decision to a DECISION.md file in the project

Your job is to synthesize, not to please both sides. Make a clear call.`,
    persona: { tone: "Impartial, decisive, cuts through noise", focus: "Making the best decision with available evidence", style: "Verdict format with reasoning chain" },
    icon: "scale",
    color: "#9B59B6",
    phase: 3,
    estimatedTokens: 2500,
  },
]

const researchReportRoles: CrewRole[] = [
  {
    id: "researcher",
    nameKey: "crew.role.researcher",
    prompt: `Deep-dive research on the topic defined in the project context:
1. Read all project files to understand what topic needs research
2. Search for the most relevant and recent information:
   - Official documentation and specifications
   - Community best practices and lessons learned
   - Common pitfalls and anti-patterns
   - Performance benchmarks or comparisons if relevant
3. Organize findings into categories
4. Note any conflicting information between sources
5. Identify gaps — what's NOT well documented?

Output: structured research notes with source references.`,
    persona: { tone: "Thorough, citation-heavy, follows evidence", focus: "Comprehensive information gathering", style: "Categorized findings with confidence levels" },
    icon: "search",
    color: "#37ACC0",
    phase: 1,
    estimatedTokens: 3000,
  },
  {
    id: "analyst",
    nameKey: "crew.role.analyst",
    prompt: `Analyze the research findings from the previous phase:
1. Identify key patterns and themes across all sources
2. Evaluate quality: which findings are well-supported vs speculative?
3. Create a comparison matrix if multiple approaches/tools were researched
4. Highlight the most actionable insights (not just interesting facts)
5. Flag any contradictions between sources and explain which is more credible

Output: analysis summary with "So What?" for each finding — why does it matter?`,
    persona: { tone: "Analytical, pattern-seeking, pragmatic", focus: "Turning raw research into actionable insights", style: "Insight cards with impact assessment" },
    icon: "brain",
    color: "#6C8EBF",
    phase: 2,
    estimatedTokens: 2500,
  },
  {
    id: "report_compiler",
    nameKey: "crew.role.report_compiler",
    prompt: `Compile the research and analysis into a polished report:
1. Write an executive summary (3-5 sentences, the TL;DR)
2. Structure the report with clear sections and headers
3. Include a recommendations section with concrete next steps
4. Add a "Quick Reference" table for key facts/comparisons
5. Save as RESEARCH_REPORT.md in the project root
6. Keep language clear — someone with zero context should understand it

Format: professional but readable. No academic jargon. Use bullet points and tables.`,
    persona: { tone: "Clear, structured, executive-friendly", focus: "Polished deliverable that non-experts can understand", style: "Report format with TL;DR and action items" },
    icon: "file-text",
    color: "#82B366",
    phase: 3,
    estimatedTokens: 2000,
  },
]

// --- Template builders ---

function buildCrewTemplate(
  id: string,
  roles: CrewRole[],
  tokenBudget: number,
  tags: string[],
): AutomationTemplate {
  return {
    id: `crew_${id}`,
    name: id,  // resolved via i18n: crew.preset.{id}
    description: "",  // resolved via i18n: crew.preset.{id}.desc
    icon: "",
    prompt: "",  // crew templates use roles, not a single prompt
    category: "crew",
    crew: {
      roles,
      tokenBudget,
      targetBranch: "crew/YYYY-MM-DD",
      phaseDelayMinutes: 0,
    },
    visibility: "public",
    rating: 0,
    ratingCount: 0,
    pinCount: 0,
    tags,
    group: "code",
    subgroup: "crew",
    createdAt: 0,
  }
}

/** Map chain subgroups to scene groups (same mapping as prompt templates) */
const CHAIN_SCENE_MAP: Record<string, string> = {
  chain_dev: "code",
  chain_api: "code",
  chain_mobile: "code",
  chain_ai: "code",
  chain_devops: "ops",
  chain_security: "ops",
}

/** Build a single-role template from a skill chain slug */
function buildChainTemplate(
  chainSlug: string,
  icon: string,
  color: string,
  tokenBudget: number,
  tags: string[],
  subgroup: string,
): AutomationTemplate {
  return {
    id: `chain_${chainSlug}`,
    name: chainSlug,  // resolved via i18n: chain.{slug}.name
    description: "",  // resolved via i18n: chain.{slug}.desc
    icon: "",
    prompt: "",
    category: "crew",
    crew: {
      roles: [{
        id: `role_${chainSlug}`,
        nameKey: `chain.${chainSlug}.name`,
        prompt: `Execute the ${chainSlug} skill chain workflow.`,
        persona: { tone: "professional", focus: chainSlug, style: "systematic" },
        icon,
        color,
        skillChainSlug: chainSlug,
        phase: 1,
        estimatedTokens: tokenBudget,
      }],
      tokenBudget,
      phaseDelayMinutes: 0,
    },
    visibility: "public",
    rating: 0,
    ratingCount: 0,
    pinCount: 0,
    tags,
    group: CHAIN_SCENE_MAP[subgroup] || "code",
    subgroup,
    createdAt: 0,
  }
}

// --- Multi-role crew templates ---
export const BUILTIN_CREWS: AutomationTemplate[] = [
  buildCrewTemplate("overnight_sprint", productPolishRoles, 18000, ["product", "feature", "qa", "security", "marketing"]),
  buildCrewTemplate("content_pipeline", socialOpsRoles, 9000, ["social", "content", "marketing", "seo"]),
  buildCrewTemplate("launch_sequence", sideProjectRoles, 20000, ["mvp", "launch", "fullstack", "docs"]),
  buildCrewTemplate("code_clinic", codeHealthRoles, 13000, ["quality", "security", "testing", "cleanup"]),
  buildCrewTemplate("war_room", criticalReviewRoles, 8000, ["decision", "debate", "architecture", "review"]),
  buildCrewTemplate("recon_brief", researchReportRoles, 7500, ["research", "analysis", "report", "learning"]),
]

// --- Single-role skill chain templates (converted from BUILTIN_CHAINS) ---
export const CHAIN_TEMPLATES: AutomationTemplate[] = [
  // Development
  buildChainTemplate("feature", "rocket", "#60a5fa", 12000, ["feature", "development", "tdd"], "chain_dev"),
  buildChainTemplate("bugfix", "bug", "#f87171", 6500, ["bug", "fix", "debug"], "chain_dev"),
  buildChainTemplate("hotfix", "wrench", "#ef4444", 3500, ["hotfix", "urgent", "fix"], "chain_dev"),
  buildChainTemplate("refactor", "boxes", "#a78bfa", 7000, ["refactor", "cleanup", "quality"], "chain_dev"),
  buildChainTemplate("onboard", "lightbulb", "#34d399", 3500, ["onboard", "learn", "explore"], "chain_dev"),
  buildChainTemplate("test", "test-tubes", "#22c55e", 8000, ["test", "coverage", "quality"], "chain_dev"),
  buildChainTemplate("perf", "trending-up", "#f59e0b", 5000, ["performance", "optimization", "benchmark"], "chain_dev"),
  buildChainTemplate("i18n", "layout-list", "#8b5cf6", 4500, ["i18n", "localization", "translation"], "chain_dev"),
  // API
  buildChainTemplate("api-endpoint", "code", "#3b82f6", 9500, ["api", "endpoint", "rest"], "chain_api"),
  buildChainTemplate("api-migration", "wrench", "#f59e0b", 7500, ["api", "migration", "database"], "chain_api"),
  buildChainTemplate("api-integration", "boxes", "#8b5cf6", 11000, ["api", "integration", "third-party"], "chain_api"),
  // Mobile / App
  buildChainTemplate("mobile-feature", "rocket", "#06b6d4", 13000, ["mobile", "feature", "capacitor"], "chain_mobile"),
  buildChainTemplate("app-release", "check-circle", "#22c55e", 6000, ["release", "build", "apk"], "chain_mobile"),
  buildChainTemplate("landing-page", "layout-list", "#ec4899", 7000, ["frontend", "landing", "design"], "chain_mobile"),
  // AI
  buildChainTemplate("ai-feature", "brain", "#a78bfa", 13500, ["ai", "ml", "feature"], "chain_ai"),
  buildChainTemplate("prompt-pipeline", "pen-tool", "#f472b6", 5500, ["prompt", "pipeline", "ai"], "chain_ai"),
  buildChainTemplate("rag-setup", "search", "#06b6d4", 11000, ["rag", "embedding", "ai"], "chain_ai"),
  buildChainTemplate("bot-build", "brain", "#8b5cf6", 12000, ["bot", "automation", "agent"], "chain_ai"),
  buildChainTemplate("scraper", "search", "#64748b", 5000, ["scraper", "crawl", "data"], "chain_ai"),
  // DevOps
  buildChainTemplate("release", "check-circle", "#22c55e", 8000, ["release", "deploy", "ci"], "chain_devops"),
  buildChainTemplate("ci-cd", "wrench", "#3b82f6", 10000, ["ci", "cd", "pipeline"], "chain_devops"),
  buildChainTemplate("docker-deploy", "boxes", "#0ea5e9", 8500, ["docker", "deploy", "container"], "chain_devops"),
  buildChainTemplate("monitoring", "target", "#f59e0b", 5500, ["monitoring", "alerts", "observability"], "chain_devops"),
  buildChainTemplate("infra", "shield-check", "#64748b", 10000, ["infrastructure", "terraform", "cloud"], "chain_devops"),
  // Security & Quality
  buildChainTemplate("secure", "shield-alert", "#ef4444", 9500, ["security", "audit", "hardening"], "chain_security"),
  buildChainTemplate("pentest", "shield-alert", "#dc2626", 11000, ["pentest", "security", "vulnerability"], "chain_security"),
  buildChainTemplate("dep-audit", "boxes", "#f59e0b", 4500, ["dependency", "audit", "update"], "chain_security"),
  buildChainTemplate("incident", "shield-alert", "#ef4444", 8000, ["incident", "response", "postmortem"], "chain_security"),
  buildChainTemplate("seo-audit", "search", "#22c55e", 5500, ["seo", "audit", "optimization"], "chain_security"),
]
