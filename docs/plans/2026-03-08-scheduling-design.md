# AgentRune Scheduling System Design

## Overview

Extend the existing AutomationManager + AutomationSheet into a full scheduling system with:
- Pixel-style alarm clock UI (time + weekday toggles)
- Prompt/Skill fields (instead of raw commands)
- Template system (builtin + community + custom, with pinning and rating)
- Local vs worktree execution mode
- Independent automation sessions (separate from manual sessions)
- Push notifications + execution history + Obsidian logging

## Approach

Extend existing `AutomationManager` (server) and `AutomationSheet` (app) rather than building from scratch. Reuse existing CRUD API endpoints, PTY execution logic, and persistence.

---

## Data Models

### AutomationConfig (extended)

```typescript
interface AutomationConfig {
  id: string
  projectId: string
  name: string

  // Execution content
  command?: string          // legacy raw command (backward compat)
  prompt?: string           // natural language prompt for agent
  skill?: string            // MCP skill name (optional, paired with prompt)

  // Template source
  templateId?: string       // reference to template ID (null = custom)

  // Schedule (alarm-clock style)
  schedule: {
    type: "daily" | "interval"
    timeOfDay?: string      // "09:00" (daily mode)
    weekdays?: number[]     // [1,2,3,4,5] = Mon-Fri (daily mode)
    intervalMinutes?: number // 30 (interval mode)
  }

  // Execution environment
  runMode: "local" | "worktree"
  agentId: string           // claude/codex/gemini...

  enabled: boolean
  createdAt: number
  lastRunAt?: number
  lastRunStatus?: "success" | "failed" | "timeout"
}
```

### AutomationTemplate

```typescript
interface AutomationTemplate {
  id: string
  name: string
  description: string
  icon: string              // emoji or icon name
  prompt: string
  skill?: string

  // Source
  category: "builtin" | "community" | "custom"

  // Social
  authorId?: string
  visibility: "private" | "public"
  rating: number            // average 0-5
  ratingCount: number
  pinCount: number          // number of users who pinned

  tags?: string[]
  createdAt: number
}
```

### Community ranking

- Score formula: `score = rating * 0.6 + normalize(pinCount) * 0.4`
- Community promotion threshold: rating >= 4.0 AND pinCount >= 10
- Pin data stored per-user in localStorage (device) + synced to AgentLore API

---

## UI Design

### Entry Points

- **Project card** long-press → context menu → "排程"
- **Session card** long-press → context menu → "排程"
- Both open the same `AutomationSheet`, pre-selecting the relevant project/agent

### AutomationSheet — List Page (default)

Each schedule displayed as alarm-clock card:
- Left: time display (`09:00`) + weekday dots (Mo Tu We Th Fr Sa Su)
- Right: toggle switch (enabled/disabled)
- Below: prompt preview (first 40 chars) + last run status
- Expandable: execution history
- Top-right: `+` button to add new

### AutomationSheet — Add/Edit Page

Top to bottom:

1. **Template selector** (optional)
   - Horizontal scrolling template cards
   - Tabs: [我的最愛] [內建] [社群] [自訂]
   - Each card: icon + name + description
   - Pin icon (top-right of each card) to favorite
   - Selecting a template auto-fills prompt + skill
   - Can skip to custom

2. **Prompt input**
   - Multi-line textarea
   - Placeholder: "描述你要 agent 做什麼..."

3. **Skill field** (optional)
   - Dropdown listing available MCP skills

4. **Schedule** (Pixel alarm style)
   - Pill toggle: [每天] / [間隔]
   - Daily mode: time picker + weekday circle buttons
   - Interval mode: number input + unit selector (min/hr)

5. **Execution environment**
   - Pill toggle: [本機] / [工作樹]
   - Agent selector (reuse AGENTS list from NewSessionSheet)

6. **[取消] [建立] buttons**

Accent color: `#F5DAC5`

---

## Session Card / Project Card Summaries

### Data Source

Events flow from server via WebSocket `session_activity` messages into `sessionEventsMap` (App.tsx). Progress reports come from MCP `report_progress` tool calls.

### Project Card — Overview Focus

- Latest activity title (from most recent session event)
- Schedule status: "N 個排程啟用中 · 下次 HH:MM"
- Blocked indicator: "N blocked · 需要回覆"
- Session count + working count

### Session Card — Detail Focus

- Summary: from `progress.summary` (latest progress_report)
- Next steps: from `progress.nextSteps[]` (bullet list, max 3)
- Task progress: count + progress bar
- Status label (working/blocked/done)

---

## Server Changes

### AutomationManager extensions

1. Add `prompt`, `skill`, `templateId`, `runMode`, `agentId` to config
2. Replace interval-only scheduling with alarm-clock scheduler:
   - Daily mode: calculate next trigger time from `timeOfDay` + `weekdays`
   - Use `setTimeout` to next trigger, then reschedule after each run
3. Execution: create independent automation session (tagged `automation_*`)
   - If `runMode === "worktree"`: create worktree before launching
   - Send prompt (not raw command) to agent PTY
4. On completion: push notification + write to Obsidian vault log

### Template API (AgentLore backend)

New endpoints on AgentLore:
- `GET /api/agentrune/templates` — list (builtin + community)
- `POST /api/agentrune/templates` — create custom template
- `PATCH /api/agentrune/templates/:id` — update
- `DELETE /api/agentrune/templates/:id` — delete (own only)
- `POST /api/agentrune/templates/:id/rate` — rate (1-5)
- `POST /api/agentrune/templates/:id/pin` — toggle pin

### Notification

- Use Capacitor LocalNotifications on automation completion
- Write execution summary to Obsidian `變更記錄/YYYY-MM-DD.md`

---

## Template System

### Builtin Templates (shipped with app)

Stored in `app/src/data/builtin-templates.ts`:

```typescript
export const BUILTIN_TEMPLATES: AutomationTemplate[] = [
  {
    id: "builtin_scan_commits",
    name: "掃描 Commits",
    description: "掃描最近的 commits，找可能的 bug 並建議修復",
    icon: "🔍",
    prompt: "Scan recent commits (since the last run, or last 24h) for likely bugs and propose minimal fixes.",
    category: "builtin",
    visibility: "public",
    rating: 0, ratingCount: 0, pinCount: 0,
    createdAt: 0,
  },
  {
    id: "builtin_release_notes",
    name: "Release Notes",
    description: "從已合併的 PR 草擬每週 release notes",
    icon: "📋",
    prompt: "Draft weekly release notes from merged PRs (include links when available).",
    category: "builtin",
    ...
  },
  {
    id: "builtin_standup",
    name: "Standup 摘要",
    description: "摘要昨天的 git 活動，用於 standup",
    icon: "☀️",
    prompt: "Summarize yesterday's git activity for standup.",
    category: "builtin",
    ...
  },
  // ... ~15 builtin templates matching Codex-style tasks
]
```

### Custom Templates

- Created via "儲存為範本" button in add/edit page
- Stored on server: `~/.agentrune/templates.json` (local)
- If `visibility: "public"`: synced to AgentLore API for community access
- Export: download as JSON file (share via any channel)
- Import: upload JSON file

### Pin / Favorites

- Pin state stored in localStorage: `agentrune_pinned_templates: string[]`
- Also POST to AgentLore API to increment `pinCount`
- "我的最愛" tab shows pinned templates first

---

## Execution Flow

```
Schedule triggers
  → AutomationManager.executeAutomation()
    → Create automation session (tagged automation_*)
    → If worktree mode: create git worktree
    → Spawn agent PTY with agentId
    → Inject prompt as first message
    → Wait for completion (idle detection / timeout)
    → Collect progress_report from MCP
    → Push notification (LocalNotifications)
    → Write to Obsidian vault log
    → Store result in execution history
    → If worktree mode: optionally cleanup worktree
```
