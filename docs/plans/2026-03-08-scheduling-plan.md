# Scheduling System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend AgentRune's AutomationManager into a full alarm-clock scheduling system with templates, prompt/skill fields, worktree support, and enhanced card summaries.

**Architecture:** Extend existing `AutomationManager` (server) and `AutomationSheet` (app) — add new fields to AutomationConfig, rewrite scheduling logic from interval-only to daily+weekday alarm-clock style, build template system with builtin/community/custom tiers, and enhance Project/Session cards with progress summaries.

**Tech Stack:** TypeScript, React (inline styles), Capacitor (LocalNotifications), Express API, WebSocket, AgentLore API (templates community)

---

### Task 1: Extend AutomationConfig types (shared)

**Files:**
- Modify: `cli/src/server/automation-manager.ts:10-33`
- Modify: `app/src/components/AutomationSheet.tsx:6-36`
- Create: `app/src/data/automation-types.ts`

**Step 1: Create shared types file**

Create `app/src/data/automation-types.ts`:

```typescript
// data/automation-types.ts
// Shared types for the scheduling system

export type ScheduleType = "daily" | "interval"

export interface AutomationSchedule {
  type: ScheduleType
  timeOfDay?: string        // "09:00" (daily mode)
  weekdays?: number[]       // [1,2,3,4,5] = Mon-Fri (daily mode, 0=Sun 1=Mon...6=Sat)
  intervalMinutes?: number  // 30 (interval mode)
}

export interface AutomationConfig {
  id: string
  projectId: string
  name: string

  // Execution content
  command?: string          // legacy raw command (backward compat)
  prompt?: string           // natural language prompt for agent
  skill?: string            // MCP skill name (optional)

  // Template source
  templateId?: string

  // Schedule
  schedule: AutomationSchedule

  // Execution environment
  runMode: "local" | "worktree"
  agentId: string

  enabled: boolean
  createdAt: number
  lastRunAt?: number
  lastRunStatus?: "success" | "failed" | "timeout"
}

export interface AutomationResult {
  id: string
  automationId: string
  startedAt: number
  finishedAt: number
  exitCode: number | null
  output: string
  status: "success" | "failed" | "timeout"
}

export interface AutomationTemplate {
  id: string
  name: string
  description: string
  icon: string
  prompt: string
  skill?: string

  category: "builtin" | "community" | "custom"

  authorId?: string
  visibility: "private" | "public"
  rating: number
  ratingCount: number
  pinCount: number

  tags?: string[]
  createdAt: number
}
```

**Step 2: Verify the file compiles**

Run: `cd app && npx tsc --noEmit src/data/automation-types.ts 2>&1 || echo "OK — tsc may not work standalone, check vite build later"`

**Step 3: Commit**

```bash
git add app/src/data/automation-types.ts
git commit -m "feat(scheduling): add shared types for scheduling system"
```

---

### Task 2: Builtin templates data

**Files:**
- Create: `app/src/data/builtin-templates.ts`

**Step 1: Create builtin templates**

Create `app/src/data/builtin-templates.ts`:

```typescript
import type { AutomationTemplate } from "./automation-types"

const t = (id: string, name: string, desc: string, icon: string, prompt: string, skill?: string, tags?: string[]): AutomationTemplate => ({
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
  createdAt: 0,
})

export const BUILTIN_TEMPLATES: AutomationTemplate[] = [
  t("scan_commits", "掃描 Commits", "掃描最近的 commits，找可能的 bug 並建議修復", "🔍",
    "Scan recent commits (since the last run, or last 24h) for likely bugs and propose minimal fixes.",
    undefined, ["git", "bug"]),
  t("release_notes", "Release Notes", "從已合併的 PR 草擬每週 release notes", "📋",
    "Draft weekly release notes from merged PRs (include links when available).",
    undefined, ["git", "docs"]),
  t("standup", "Standup 摘要", "摘要昨天的 git 活動，用於 standup", "☀️",
    "Summarize yesterday's git activity for standup.",
    undefined, ["git", "report"]),
  t("ci_failures", "CI 檢查", "摘要 CI 失敗和不穩定測試，建議修復", "🔧",
    "Summarize CI failures and flaky tests from the last CI window; suggest top fixes.",
    undefined, ["ci", "test"]),
  t("triage_issues", "Issue 分類", "分類新 issue，建議 owner、priority 和 label", "🏷️",
    "Triage new issues; suggest owner, priority, and labels.",
    undefined, ["github", "issues"]),
  t("dep_check", "依賴檢查", "掃描過時的依賴，建議安全升級", "📦",
    "Scan outdated dependencies; propose safe upgrades with minimal changes.",
    undefined, ["deps", "security"]),
  t("weekly_summary", "週報整理", "整合本週 PR、rollouts、incidents 寫成週報", "📰",
    "Synthesize this week's PRs, rollouts, incidents, and reviews into a weekly update.",
    undefined, ["report", "weekly"]),
  t("test_coverage", "測試覆蓋", "找出未測試的路徑，新增重點測試", "🧪",
    "Identify untested paths from recent changes; add focused tests.",
    undefined, ["test", "coverage"]),
  t("pr_review", "PR 摘要", "摘要上週 PR（依成員和主題），標出風險", "👥",
    "Summarize last week's PRs by teammate and theme; highlight risks.",
    undefined, ["git", "review"]),
  t("perf_audit", "效能審計", "審計效能回歸，建議最有效的修復", "⚡",
    "Audit performance regressions and propose highest-leverage fixes.",
    undefined, ["perf", "audit"]),
  t("changelog", "更新日誌", "用本週重點和 PR 連結更新 changelog", "📝",
    "Update the changelog with this week's highlights and key PR links.",
    undefined, ["docs", "changelog"]),
  t("skill_suggest", "技能建議", "從最近 PR 和 review 建議下一步要深化的技能", "🎯",
    "From recent PRs and reviews, suggest next skills to deepen.",
    undefined, ["learning"]),
  t("release_check", "發布檢查", "打 tag 前確認 changelog、migration、feature flag 和測試", "✅",
    "Before tagging, verify changelog, migrations, feature flags, and tests.",
    undefined, ["release", "check"]),
]
```

**Step 2: Verify build**

Run: `cd app && npx vite build 2>&1 | tail -3`

**Step 3: Commit**

```bash
git add app/src/data/builtin-templates.ts
git commit -m "feat(scheduling): add 13 builtin automation templates"
```

---

### Task 3: Extend server AutomationManager

**Files:**
- Modify: `cli/src/server/automation-manager.ts` (entire file)

**Step 1: Update AutomationConfig interface and scheduling logic**

In `cli/src/server/automation-manager.ts`, replace the `ScheduleType`, `AutomationSchedule`, and `AutomationConfig` interfaces (lines 12-33) with:

```typescript
export type ScheduleType = "daily" | "interval"

export interface AutomationSchedule {
  type: ScheduleType
  timeOfDay?: string        // "09:00"
  weekdays?: number[]       // [0-6], 0=Sun 1=Mon...6=Sat
  intervalMinutes?: number  // for interval mode
}

export interface AutomationConfig {
  id: string
  projectId: string
  name: string
  command?: string          // legacy
  prompt?: string
  skill?: string
  templateId?: string
  schedule: AutomationSchedule
  runMode: "local" | "worktree"
  agentId: string
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  lastRunStatus?: "success" | "failed" | "timeout"
}
```

**Step 2: Replace `startSchedule` method (line 151-168) with alarm-clock logic**

```typescript
private startSchedule(auto: AutomationConfig) {
  this.stopSchedule(auto.id)

  if (auto.schedule.type === "interval") {
    const ms = (auto.schedule.intervalMinutes || 30) * 60 * 1000
    log.info(`[Automation] Starting interval for "${auto.name}" every ${auto.schedule.intervalMinutes}m`)
    const timer = setInterval(() => this.executeAutomation(auto.id), ms)
    this.timers.set(auto.id, timer)
  } else if (auto.schedule.type === "daily") {
    this.scheduleDailyNext(auto)
  }
}

/** Calculate ms until next daily trigger, then setTimeout */
private scheduleDailyNext(auto: AutomationConfig) {
  const now = new Date()
  const [hh, mm] = (auto.schedule.timeOfDay || "09:00").split(":").map(Number)
  const weekdays = auto.schedule.weekdays || [1, 2, 3, 4, 5] // default Mon-Fri

  // Find next matching day+time
  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const candidate = new Date(now.getTime() + daysAhead * 86400000)
    candidate.setHours(hh, mm, 0, 0)
    if (candidate.getTime() <= now.getTime()) continue
    if (!weekdays.includes(candidate.getDay())) continue

    const delay = candidate.getTime() - now.getTime()
    log.info(`[Automation] Next run for "${auto.name}": ${candidate.toLocaleString()} (in ${Math.round(delay / 60000)}m)`)
    const timer = setTimeout(() => {
      this.executeAutomation(auto.id)
      // Reschedule for next occurrence
      if (this.automations.get(auto.id)?.enabled) {
        this.scheduleDailyNext(auto)
      }
    }, delay)
    this.timers.set(auto.id, timer)
    return
  }
  log.warn(`[Automation] No valid day found for "${auto.name}" — no weekdays enabled?`)
}
```

**Step 3: Update `add` method to accept new fields (line 73-88)**

Replace the `add` method's parameter type:

```typescript
add(config: Omit<AutomationConfig, "id" | "createdAt">): AutomationConfig {
  const id = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const automation: AutomationConfig = {
    ...config,
    id,
    createdAt: Date.now(),
    runMode: config.runMode || "local",
    agentId: config.agentId || "claude",
  }
  this.automations.set(id, automation)
  this.results.set(id, [])
  this.saveToDisk()
  if (automation.enabled) this.startSchedule(automation)
  return automation
}
```

**Step 4: Update `update` method to handle new fields (line 126-143)**

```typescript
update(id: string, updates: Partial<Pick<AutomationConfig, "name" | "command" | "prompt" | "skill" | "schedule" | "enabled" | "runMode" | "agentId" | "templateId">>): AutomationConfig | null {
  const auto = this.automations.get(id)
  if (!auto) return null

  const wasEnabled = auto.enabled

  if (updates.name !== undefined) auto.name = updates.name
  if (updates.command !== undefined) auto.command = updates.command
  if (updates.prompt !== undefined) auto.prompt = updates.prompt
  if (updates.skill !== undefined) auto.skill = updates.skill
  if (updates.schedule !== undefined) auto.schedule = updates.schedule
  if (updates.enabled !== undefined) auto.enabled = updates.enabled
  if (updates.runMode !== undefined) auto.runMode = updates.runMode
  if (updates.agentId !== undefined) auto.agentId = updates.agentId
  if (updates.templateId !== undefined) auto.templateId = updates.templateId

  if (wasEnabled) this.stopSchedule(id)
  if (auto.enabled) this.startSchedule(auto)

  this.saveToDisk()
  return auto
}
```

**Step 5: Update `executeAutomation` to use prompt instead of command**

In the `executeAutomation` method (~line 178), change the command injection:

```typescript
// Instead of: this.ptyManager.write(sessionId, auto.command + "\n")
const input = auto.prompt || auto.command || ""
if (input) {
  this.ptyManager.write(sessionId, input + "\n")
}
```

Also update `lastRunAt` and `lastRunStatus` after execution completes:

```typescript
// After storing result:
auto.lastRunAt = Date.now()
auto.lastRunStatus = status
this.saveToDisk()
```

**Step 6: Rebuild CLI**

Run: `cd cli && npm run build 2>&1 | tail -5`

**Step 7: Commit**

```bash
git add cli/src/server/automation-manager.ts
git commit -m "feat(scheduling): extend AutomationManager with daily scheduling, prompt/skill fields"
```

---

### Task 4: Update server API endpoints

**Files:**
- Modify: `cli/src/server/ws-server.ts:1149-1162`

**Step 1: Update POST endpoint to accept new fields**

Replace `cli/src/server/ws-server.ts` lines 1149-1162:

```typescript
app.post("/api/automations/:projectId", express.json(), (req, res) => {
  const { name, prompt, command, skill, schedule, runMode, agentId, templateId, enabled } = req.body
  if (!name || (!prompt && !command) || !schedule) {
    return res.status(400).json({ error: "name, prompt (or command), and schedule are required" })
  }
  const auto = automationManager.add({
    projectId: req.params.projectId,
    name,
    prompt,
    command,
    skill,
    templateId,
    schedule,
    runMode: runMode || "local",
    agentId: agentId || "claude",
    enabled: enabled !== false,
  })
  res.json(auto)
})
```

**Step 2: Rebuild CLI**

Run: `cd cli && npm run build 2>&1 | tail -5`

**Step 3: Commit**

```bash
git add cli/src/server/ws-server.ts
git commit -m "feat(scheduling): update API endpoint to accept prompt/skill/runMode/agentId"
```

---

### Task 5: Rewrite AutomationSheet UI — List Page

**Files:**
- Modify: `app/src/components/AutomationSheet.tsx` (full rewrite)

**Step 1: Rewrite the list page with alarm-clock card style**

Replace the entire `AutomationSheet.tsx` with the new design. The list page shows alarm-clock cards with:
- Time display + weekday dots
- Toggle switch
- Prompt preview + last run status
- Expand for execution history

Key structure:

```tsx
// Each automation card
<div style={{ ... glass card ... }}>
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
    {/* Left: time or interval label */}
    <div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)" }}>
        {auto.schedule.type === "daily" ? auto.schedule.timeOfDay : `每 ${auto.schedule.intervalMinutes} 分鐘`}
      </div>
      {/* Weekday dots for daily mode */}
      {auto.schedule.type === "daily" && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {["Su","Mo","Tu","We","Th","Fr","Sa"].map((d, i) => (
            <span key={i} style={{
              fontSize: 11, fontWeight: 600, width: 24, height: 24,
              borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              background: (auto.schedule.weekdays || []).includes(i) ? "#F5DAC5" : "transparent",
              color: (auto.schedule.weekdays || []).includes(i) ? "#5a3e2b" : "var(--text-secondary)",
            }}>{d}</span>
          ))}
        </div>
      )}
    </div>
    {/* Right: toggle */}
    <Toggle checked={auto.enabled} onChange={(v) => handleToggle(auto.id, v)} />
  </div>
  {/* Prompt preview + status */}
  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8 }}>
    {(auto.prompt || auto.command || "").slice(0, 50)}...
  </div>
  {auto.lastRunAt && (
    <div style={{ fontSize: 11, color: "var(--text-secondary)", opacity: 0.6, marginTop: 4 }}>
      上次: {new Date(auto.lastRunAt).toLocaleString()} {auto.lastRunStatus === "success" ? "✓" : "✗"}
    </div>
  )}
</div>
```

**Step 2: Verify build**

Run: `cd app && npx vite build 2>&1 | tail -3`

**Step 3: Commit**

```bash
git add app/src/components/AutomationSheet.tsx
git commit -m "feat(scheduling): rewrite AutomationSheet list page with alarm-clock cards"
```

---

### Task 6: AutomationSheet — Add/Edit Page with Template Selector

**Files:**
- Modify: `app/src/components/AutomationSheet.tsx` (add page section)

**Step 1: Add template selector section**

At the top of the add form, add horizontal scrolling template cards:

```tsx
// Template tab state
const [templateTab, setTemplateTab] = useState<"pinned" | "builtin" | "community" | "custom">("pinned")
const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
  try { return JSON.parse(localStorage.getItem("agentrune_pinned_templates") || "[]") } catch { return [] }
})

// Filter templates by tab
const filteredTemplates = allTemplates.filter(t => {
  if (templateTab === "pinned") return pinnedIds.includes(t.id)
  return t.category === templateTab
})
```

Template card:

```tsx
<div style={{
  minWidth: 140, padding: 12, borderRadius: 14,
  background: selectedTemplateId === t.id ? "#F5DAC5" : "var(--glass-bg)",
  border: selectedTemplateId === t.id ? "1.5px solid rgba(245,218,197,0.8)" : "1px solid var(--glass-border)",
  cursor: "pointer", position: "relative", flexShrink: 0,
}} onClick={() => applyTemplate(t)}>
  {/* Pin button */}
  <button onClick={(e) => { e.stopPropagation(); togglePin(t.id) }}
    style={{ position: "absolute", top: 6, right: 6, background: "none", border: "none", cursor: "pointer" }}>
    📌 {/* filled if pinned, outline if not */}
  </button>
  <div style={{ fontSize: 24, marginBottom: 6 }}>{t.icon}</div>
  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{t.name}</div>
  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>{t.description}</div>
</div>
```

**Step 2: Add prompt textarea, skill dropdown, schedule picker, environment selector**

Schedule picker (Pixel alarm style):

```tsx
{/* Schedule type toggle */}
<div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
  {(["daily", "interval"] as const).map(type => (
    <button key={type} onClick={() => setNewScheduleType(type)} style={{
      padding: "6px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600,
      border: "none", cursor: "pointer",
      background: newScheduleType === type ? "#F5DAC5" : "var(--glass-bg)",
      color: newScheduleType === type ? "#5a3e2b" : "var(--text-secondary)",
    }}>
      {type === "daily" ? t("automation.daily") : t("automation.interval")}
    </button>
  ))}
</div>

{/* Daily: time + weekdays */}
{newScheduleType === "daily" && (
  <>
    <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)}
      style={{ padding: "12px 16px", borderRadius: 14, border: "1px solid var(--glass-border)",
        background: "var(--glass-bg)", color: "var(--text-primary)", fontSize: 16, width: "100%" }} />
    <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "center" }}>
      {["Su","Mo","Tu","We","Th","Fr","Sa"].map((d, i) => (
        <button key={i} onClick={() => toggleWeekday(i)} style={{
          width: 36, height: 36, borderRadius: "50%", fontSize: 12, fontWeight: 600,
          border: "none", cursor: "pointer",
          background: newWeekdays.includes(i) ? "#F5DAC5" : "var(--glass-bg)",
          color: newWeekdays.includes(i) ? "#5a3e2b" : "var(--text-secondary)",
        }}>{d}</button>
      ))}
    </div>
  </>
)}

{/* Run mode + agent */}
<div style={{ display: "flex", gap: 4, marginTop: 16 }}>
  {(["local", "worktree"] as const).map(mode => (
    <button key={mode} onClick={() => setNewRunMode(mode)} style={{
      flex: 1, padding: "8px", borderRadius: 12, fontSize: 13, fontWeight: 600,
      border: "none", cursor: "pointer",
      background: newRunMode === mode ? "#F5DAC5" : "var(--glass-bg)",
      color: newRunMode === mode ? "#5a3e2b" : "var(--text-secondary)",
    }}>
      {mode === "local" ? "本機" : "工作樹"}
    </button>
  ))}
</div>
```

**Step 3: Wire up handleAdd to send new fields to API**

```typescript
const handleAdd = async () => {
  if (!newName.trim() || !newPrompt.trim()) return
  setSubmitting(true)
  try {
    const schedule: any = { type: newScheduleType }
    if (newScheduleType === "daily") {
      schedule.timeOfDay = newTime
      schedule.weekdays = newWeekdays
    } else {
      schedule.intervalMinutes = parseInt(newInterval) || 30
    }
    await fetch(`${serverUrl}/api/automations/${projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName,
        prompt: newPrompt,
        skill: newSkill || undefined,
        schedule,
        runMode: newRunMode,
        agentId: newAgentId,
        templateId: selectedTemplateId || undefined,
      }),
    })
    setShowAdd(false)
    fetchAutomations()
  } catch {}
  setSubmitting(false)
}
```

**Step 4: Verify build**

Run: `cd app && npx vite build 2>&1 | tail -3`

**Step 5: Commit**

```bash
git add app/src/components/AutomationSheet.tsx
git commit -m "feat(scheduling): add template selector, prompt/skill fields, alarm-clock schedule picker"
```

---

### Task 7: Add i18n keys

**Files:**
- Modify: `app/src/lib/i18n/en.ts`
- Modify: `app/src/lib/i18n/zh-TW.ts`

**Step 1: Add new keys to both locale files**

New keys needed:

```typescript
// zh-TW
"automation.daily": "每天",
"automation.promptPlaceholder": "描述你要 agent 做什麼...",
"automation.skillOptional": "Skill（可選）",
"automation.selectSkill": "選擇 MCP Skill...",
"automation.runMode": "執行環境",
"automation.local": "本機",
"automation.worktree": "工作樹",
"automation.agent": "Agent",
"automation.template": "從範本選擇",
"automation.templatePinned": "我的最愛",
"automation.templateBuiltin": "內建",
"automation.templateCommunity": "社群",
"automation.templateCustom": "自訂",
"automation.lastRun": "上次",
"automation.success": "成功",
"automation.failed": "失敗",
"automation.cancel": "取消",
"automation.nextRun": "下次",

// en
"automation.daily": "Daily",
"automation.promptPlaceholder": "Describe what you want the agent to do...",
"automation.skillOptional": "Skill (optional)",
"automation.selectSkill": "Select MCP Skill...",
"automation.runMode": "Environment",
"automation.local": "Local",
"automation.worktree": "Worktree",
"automation.agent": "Agent",
"automation.template": "Choose template",
"automation.templatePinned": "Favorites",
"automation.templateBuiltin": "Built-in",
"automation.templateCommunity": "Community",
"automation.templateCustom": "Custom",
"automation.lastRun": "Last run",
"automation.success": "Success",
"automation.failed": "Failed",
"automation.cancel": "Cancel",
"automation.nextRun": "Next",
```

**Step 2: Commit**

```bash
git add app/src/lib/i18n/en.ts app/src/lib/i18n/zh-TW.ts
git commit -m "feat(i18n): add scheduling system translation keys"
```

---

### Task 8: Enhance Project Card summary

**Files:**
- Modify: `app/src/components/ProjectOverview.tsx:697-779` (project card rendering)

**Step 1: Add automation count fetch**

In ProjectOverview, add state for automation counts:

```typescript
const [automationCounts, setAutomationCounts] = useState<Map<string, { enabled: number; nextRun?: string }>>(new Map())

useEffect(() => {
  const serverUrl = localStorage.getItem("agentrune_server") || ""
  if (!serverUrl) return
  for (const project of projects) {
    fetch(`${serverUrl}/api/automations/${project.id}`)
      .then(r => r.json())
      .then((autos: any[]) => {
        const enabled = autos.filter(a => a.enabled).length
        // Find next daily run
        let nextRun: string | undefined
        for (const a of autos) {
          if (a.enabled && a.schedule.type === "daily" && a.schedule.timeOfDay) {
            nextRun = a.schedule.timeOfDay
            break
          }
        }
        setAutomationCounts(prev => {
          const next = new Map(prev)
          next.set(project.id, { enabled, nextRun })
          return next
        })
      })
      .catch(() => {})
  }
}, [projects])
```

**Step 2: Update project card rendering (line 764-776)**

After the existing summary display, add schedule + blocked info:

```tsx
{/* Schedule status */}
{(() => {
  const autoInfo = automationCounts.get(project.id)
  if (!autoInfo || autoInfo.enabled === 0) return null
  return (
    <div style={{ fontSize: 11, color: "#37ACC0", marginLeft: 18, marginTop: 4 }}>
      ⏰ {autoInfo.enabled} 個排程啟用中{autoInfo.nextRun ? ` · 下次 ${autoInfo.nextRun}` : ""}
    </div>
  )
})()}
{/* Blocked indicator */}
{(() => {
  const blockedCount = sessions.filter(s => {
    const events = sessionEvents.get(s.id) || []
    return getSessionStatus(events) === "blocked"
  }).length
  if (blockedCount === 0) return null
  return (
    <div style={{ fontSize: 11, color: "#ef4444", marginLeft: 18, marginTop: 4 }}>
      ⚡ {blockedCount} blocked · 需要回覆
    </div>
  )
})()}
```

**Step 3: Verify build**

Run: `cd app && npx vite build 2>&1 | tail -3`

**Step 4: Commit**

```bash
git add app/src/components/ProjectOverview.tsx
git commit -m "feat(ui): add schedule status and blocked indicator to project cards"
```

---

### Task 9: Enhance Session Card summary

**Files:**
- Modify: `app/src/components/ProjectOverview.tsx:1065-1086` (session card summary area)

**Step 1: Replace simple summary with structured progress display**

Replace the session card summary section (lines 1065-1086) with:

```tsx
{/* Summary — structured progress */}
<div style={{
  fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5,
  display: "flex", flexDirection: "column", gap: 3,
}}>
  {statusLabel && (
    <span style={{
      fontSize: 9, fontWeight: 700,
      textTransform: "uppercase" as const,
      letterSpacing: 0.5,
      color: dotStyle.color,
    }}>
      {statusLabel}
    </span>
  )}
  {/* Summary text */}
  <div style={{
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as never,
    overflow: "hidden",
  }}>
    {summaryText || t("mc.sessionStarted")}
  </div>
  {/* Next steps (from progress_report) */}
  {(() => {
    const prog = getLatestProgress(events)
    if (!prog?.nextSteps?.length) return null
    return (
      <div style={{ marginTop: 2 }}>
        {prog.nextSteps.slice(0, 2).map((step, i) => (
          <div key={i} style={{ fontSize: 10, color: "var(--text-secondary)", opacity: 0.7 }}>
            → {step.length > 30 ? step.slice(0, 30) + "..." : step}
          </div>
        ))}
      </div>
    )
  })()}
  {/* Task progress bar */}
  {(() => {
    const prog = getLatestProgress(events)
    if (!prog) return null
    // Parse task count from summary or details if available
    const taskMatch = (prog.details || prog.summary || "").match(/(\d+)\s*\/\s*(\d+)/)
    if (!taskMatch) return null
    const done = parseInt(taskMatch[1])
    const total = parseInt(taskMatch[2])
    const pct = total > 0 ? (done / total) * 100 : 0
    return (
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 9, color: "var(--text-secondary)", opacity: 0.6, marginBottom: 2 }}>
          {done}/{total} 完成
        </div>
        <div style={{ height: 3, borderRadius: 2, background: "var(--glass-border)" }}>
          <div style={{ height: "100%", borderRadius: 2, background: dotStyle.color, width: `${pct}%`, transition: "width 0.3s" }} />
        </div>
      </div>
    )
  })()}
</div>
```

**Step 2: Verify build**

Run: `cd app && npx vite build 2>&1 | tail -3`

**Step 3: Commit**

```bash
git add app/src/components/ProjectOverview.tsx
git commit -m "feat(ui): enhance session cards with next steps and task progress bar"
```

---

### Task 10: Add "排程" to context menus

**Files:**
- Modify: `app/src/components/ProjectOverview.tsx` (context menu sections)

**Step 1: Find project context menu and add "排程" option**

Search for `contextProjectId` rendering. Add a button that opens AutomationSheet for that project:

```tsx
{/* In project context menu */}
<button onClick={() => {
  setAutomationProjectId(contextProjectId)
  setShowAutomation(true)
  setContextProjectId(null)
}} style={{ ... menu item style ... }}>
  ⏰ {t("automation.title")}
</button>
```

**Step 2: Find session context menu and add "排程" option**

Search for `contextSessionId` rendering. Add similar button that opens AutomationSheet pre-configured with the session's project.

**Step 3: Verify build**

Run: `cd app && npx vite build 2>&1 | tail -3`

**Step 4: Commit**

```bash
git add app/src/components/ProjectOverview.tsx
git commit -m "feat(ui): add schedule option to project and session context menus"
```

---

### Task 11: Build, sync, and upload APK

**Files:** (no code changes)

**Step 1: Full build pipeline**

```bash
cd app && npx vite build
npx cap sync android
cd android && JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.10.7-hotspot" ./gradlew assembleDebug
```

**Step 2: Upload to release**

```bash
cp app/android/app/build/outputs/apk/debug/app-debug.apk public/agentrune.apk
GH_TOKEN=<token> gh release upload v0.1.0-alpha public/agentrune.apk --clobber
```

**Step 3: Commit APK**

```bash
git add public/agentrune.apk
git commit -m "chore: update APK with scheduling system"
```
