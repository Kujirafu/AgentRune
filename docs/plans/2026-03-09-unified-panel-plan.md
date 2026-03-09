# Unified Panel UI Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge project panel and session panel into a single vertically-scrolling unified page, with session cards in horizontal scroll per project.

**Architecture:** Replace ProjectOverview's 2-panel structure (Panel 0 = project list, Panel 1 = session dashboard) with a single scrollable view. Each project renders as a section: header + info card (auto-summary) + horizontal session row. Top-level 3 tabs (專案/排程/範本) replace the inner tab bar. New `/api/project-summary` endpoint for LLM-generated summaries.

**Tech Stack:** React + TypeScript + inline styles, Capacitor SpeechRecognition, Express API

**Scope:** Dev build only. UI-only changes in app/, one new API endpoint in cli/.

---

## Task 1: New API endpoint — `/api/project-summary`

**Files:**
- Modify: `cli/src/server/ws-server.ts`

**Step 1: Add the endpoint**

Add after the existing `/api/voice-cleanup` endpoint block. This endpoint collects all session events for a project and calls the user's agent lightweight model to generate a summary.

```typescript
app.post("/api/project-summary", async (req, res) => {
  const { projectId } = req.body
  if (!projectId) return res.status(400).json({ error: "projectId required" })

  // Collect recent events from all sessions in this project
  const projectSessions = Array.from(sessions.values()).filter(s => s.projectId === projectId)
  if (projectSessions.length === 0) return res.json({ summary: "" })

  const eventSummaries: string[] = []
  for (const s of projectSessions) {
    const evts = sessionEvents.get(s.id) || []
    // Take last 10 events per session, extract meaningful text
    const recent = evts.slice(-10)
    for (const e of recent) {
      if (e.progress?.summary) eventSummaries.push(`[${s.agentId}] ${e.progress.summary}`)
      else if (e.title) eventSummaries.push(`[${s.agentId}] ${e.title}`)
    }
  }

  if (eventSummaries.length === 0) return res.json({ summary: "" })

  // Use lightweight model via the first available session's agent
  const firstSession = projectSessions[0]
  const prompt = `Summarize this project's current state in 1-3 sentences (Traditional Chinese preferred):\n\n${eventSummaries.join("\n")}`

  try {
    // Send as a transient input to get a quick summary via voice-cleanup style endpoint
    const serverUrl = `http://localhost:${PORT}`
    const cleanupRes = await fetch(`${serverUrl}/api/voice-cleanup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: prompt, agentId: firstSession.agentId, mode: "summary" }),
    })
    if (cleanupRes.ok) {
      const data = await cleanupRes.json()
      return res.json({ summary: data.cleaned || "" })
    }
  } catch (err) {
    log.warn(`[ProjectSummary] Generation failed: ${err}`)
  }

  // Fallback: return concatenated event summaries
  return res.json({ summary: eventSummaries.slice(0, 3).join("; ") })
})
```

**Step 2: Verify endpoint works**

Run CLI dev server and test with curl:
```bash
curl -X POST http://localhost:3457/api/project-summary \
  -H "content-type: application/json" \
  -d '{"projectId":"test"}'
```

**Step 3: Commit**
```bash
git add cli/src/server/ws-server.ts
git commit -m "feat: add /api/project-summary endpoint for LLM-generated project summaries"
```

---

## Task 2: Add i18n keys

**Files:**
- Modify: `app/src/lib/i18n/en.ts`
- Modify: `app/src/lib/i18n/zh-TW.ts`

**Step 1: Add English keys**

Add to the `en` object, in the `overview` section:

```typescript
// Unified panel
"unified.summary": "Summary",
"unified.nextSteps": "Next Steps",
"unified.noSummary": "No activity yet",
"unified.refreshSummary": "Refresh summary",
"unified.generatingSummary": "Generating summary...",
"unified.projectActions": "More actions",
"unified.mergeToMain": "Merge to main",
"unified.healthReport": "Health report",
"unified.closeProject": "Close project",
"unified.viewPrd": "View PRD",
"unified.editProject": "Edit project",
"unified.deleteProject": "Delete project",
"unified.expandSession": "Show details",
"unified.collapseSession": "Hide details",
"unified.startTime": "Started",
"unified.messageCount": "Messages",
"unified.fileChanges": "File changes",
"unified.labels": "Labels",
"unified.tabProjects": "Projects",
"unified.tabSchedules": "Schedules",
"unified.tabTemplates": "Templates",
```

**Step 2: Add Traditional Chinese keys**

```typescript
"unified.summary": "摘要",
"unified.nextSteps": "下一步",
"unified.noSummary": "尚無活動",
"unified.refreshSummary": "重新整理摘要",
"unified.generatingSummary": "正在產生摘要...",
"unified.projectActions": "更多操作",
"unified.mergeToMain": "合併到 main",
"unified.healthReport": "健康報告",
"unified.closeProject": "關閉專案",
"unified.viewPrd": "查看 PRD",
"unified.editProject": "編輯專案",
"unified.deleteProject": "刪除專案",
"unified.expandSession": "顯示詳細",
"unified.collapseSession": "收起詳細",
"unified.startTime": "開始時間",
"unified.messageCount": "訊息數",
"unified.fileChanges": "檔案變更",
"unified.labels": "標籤",
"unified.tabProjects": "專案",
"unified.tabSchedules": "排程",
"unified.tabTemplates": "範本",
```

**Step 3: Commit**
```bash
git add app/src/lib/i18n/en.ts app/src/lib/i18n/zh-TW.ts
git commit -m "feat: add i18n keys for unified panel redesign"
```

---

## Task 3: Create UnifiedPanel component — scaffold

**Files:**
- Create: `app/src/components/UnifiedPanel.tsx`

This is the core new component that replaces ProjectOverview's 2-panel structure.

**Step 1: Create the component file with basic structure**

The component receives the same props as ProjectOverview (reuse the interface). It renders:
1. Top-level 3-tab bar (專案/排程/範本) — swipeable + tappable
2. 專案 tab: vertical scroll of project sections
3. 排程 tab: existing AutomationSheet schedules list content
4. 範本 tab: existing AutomationSheet templates content

```typescript
// UnifiedPanel.tsx
// Core structure:
// - Tab bar at top (3 tabs)
// - Swipe between tabs (reuse existing swipe logic from ProjectOverview)
// - Tab 0 (專案): ProjectSection[] vertically scrolled
//   - ProjectSection = header + info card + horizontal session row
// - Tab 1 (排程): delegated to AutomationSheet schedule list
// - Tab 2 (範本): delegated to AutomationSheet template list
```

Props interface — reuse ProjectOverviewProps exactly, adding:
```typescript
interface UnifiedPanelProps extends ProjectOverviewProps {
  // No additional props needed — all existing functionality preserved
}
```

**Key state variables to migrate from ProjectOverview:**
- `activeTab`: 0 | 1 | 2 (replaces `panel` + `sessionTab`)
- `contextProjectId` / `contextSessionId` (long press menus)
- `expandedSessions`: Set<string> (new — tracks which session cards are expanded)
- `summaryCache`: Map<string, { text: string, timestamp: number }> (new — project summary cache)
- `summaryLoading`: Set<string> (new — projects currently generating summaries)
- All voice state (migrate from ProjectOverview)
- `renamingSessionId`, `renameValue`, `multiSelectMode`, `selectedSessionIds`

**Key functions to migrate:**
- `getSessionStatus()`, `getProjectStatus()`, `getProjectSummary()`, `getEventSummary()`, `getLatestProgress()` — move as-is
- `startVoice()`, `stopVoice()`, `callCleanupAPI()`, voice overlay rendering — move as-is
- Long press handlers — move as-is
- Swipe gesture handlers — adapt for 3 tabs

**Step 2: Implement tab bar + swipe**

Tab bar: 3 buttons at top, active tab has accent underline.
Swipe: reuse ProjectOverview's touch handlers, adapted for 3 tabs:

```typescript
const TAB_ORDER = ["projects", "schedules", "templates"] as const
type TabKey = typeof TAB_ORDER[number]
const [activeTab, setActiveTab] = useState<TabKey>("projects")

// Swipe logic: same as ProjectOverview Panel 1 tab switching
const handleTouchEnd = () => {
  if (!swipingPanel.current) return
  const threshold = 50
  const currentIdx = TAB_ORDER.indexOf(activeTab)
  if (touchDeltaX.current < -threshold && currentIdx < TAB_ORDER.length - 1) {
    setActiveTab(TAB_ORDER[currentIdx + 1])
  } else if (touchDeltaX.current > threshold && currentIdx > 0) {
    setActiveTab(TAB_ORDER[currentIdx - 1])
  }
  // reset
}
```

**Step 3: Commit scaffold**
```bash
git add app/src/components/UnifiedPanel.tsx
git commit -m "feat: scaffold UnifiedPanel component with tab bar + swipe"
```

---

## Task 4: Project section — header + info card

**Files:**
- Modify: `app/src/components/UnifiedPanel.tsx`

**Step 1: Implement project header row**

Per project, render:
```
[ProjectName]                    [...] [⏰] [+]
```

- Project name: bold, large text
- [...] button: opens project actions sheet (merge to main, health report, close, view PRD, edit, delete)
- [⏰] button: opens AutomationSheet for this project
- [+] button: opens NewSessionSheet for this project

**Step 2: Implement project info card**

Full-width card below header, distinct from session cards (lighter glass bg, subtle border):

```
┌─────────────────────────────────────┐
│ Summary: [auto-generated text]  [↻] │  ← refresh button
│ → Next: [step] (Agent)              │  ← from ProgressReport.nextSteps
│ → Next: [step] (Agent)              │
│                                🎤   │  ← project voice button
└─────────────────────────────────────┘
```

Summary fetch logic:
```typescript
const fetchSummary = async (projectId: string, force = false) => {
  const cached = summaryCache.get(projectId)
  const now = Date.now()
  // Throttle: skip if < 5 min and not forced
  if (!force && cached && (now - cached.timestamp) < 5 * 60 * 1000) return
  // Check if any session has new events since last summary
  if (!force && cached) {
    const sessions = sessionsByProject.get(projectId) || []
    const latestEventTs = Math.max(...sessions.flatMap(s => {
      const evts = sessionEvents.get(s.id) || []
      return evts.map(e => e.timestamp)
    }), 0)
    if (latestEventTs <= cached.timestamp) return
  }
  setSummaryLoading(prev => new Set(prev).add(projectId))
  try {
    const serverUrl = localStorage.getItem("agentrune_server") || ""
    const res = await fetch(`${serverUrl}/api/project-summary`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
      signal: AbortSignal.timeout(15000),
    })
    if (res.ok) {
      const data = await res.json()
      setSummaryCache(prev => new Map(prev).set(projectId, { text: data.summary, timestamp: now }))
    }
  } catch {}
  setSummaryLoading(prev => { const s = new Set(prev); s.delete(projectId); return s })
}
```

Next Steps extraction:
```typescript
const getProjectNextSteps = (projectId: string): { step: string; agent: string }[] => {
  const sessions = sessionsByProject.get(projectId) || []
  const steps: { step: string; agent: string }[] = []
  for (const s of sessions) {
    const events = sessionEvents.get(s.id) || []
    const prog = getLatestProgress(events)
    if (prog?.nextSteps?.length) {
      steps.push({ step: prog.nextSteps[0], agent: s.agentId })
    }
  }
  return steps
}
```

Auto-trigger on tab focus:
```typescript
useEffect(() => {
  if (activeTab !== "projects") return
  // Fetch summaries for all visible projects
  for (const p of projects) {
    fetchSummary(p.id)
  }
}, [activeTab, projects.length])
```

**Step 3: Implement project actions menu ([...] button)**

Bottom sheet with options, same pattern as existing context menus:
- Merge to main → `onSessionInput(sessionId, "merge to main")`
- Health report → `onSessionInput(sessionId, "health report")`
- Close project → `onDeleteProject(projectId)`
- View PRD → `onSessionInput(sessionId, "view PRD")`
- Edit project → inline edit (name/path)
- Delete project → confirm + `onDeleteProject(projectId)`

**Step 4: Commit**
```bash
git add app/src/components/UnifiedPanel.tsx
git commit -m "feat: add project header + info card with auto-summary and next steps"
```

---

## Task 5: Horizontal session card row

**Files:**
- Modify: `app/src/components/UnifiedPanel.tsx`

**Step 1: Implement horizontal scrolling session row**

Replace the 2-column grid with a horizontal scroll container:

```typescript
<div style={{
  display: "flex",
  overflowX: "auto",
  gap: 12,
  padding: "0 16px 16px",
  WebkitOverflowScrolling: "touch",
  scrollSnapType: "x mandatory",
}}>
  {sessions.map(session => (
    <SessionCard key={session.id} ... />
  ))}
</div>
```

Each session card:
- Fixed width (~160px) to show multiple cards
- Status dot + agent name (no session ID)
- Latest progress summary (truncated)
- Voice button (blue circle, bottom-right)
- Expand button (bottom-left)
- `scrollSnapAlign: "start"`

**Step 2: Implement session card tap/long-press**

- Tap → `onSelectSession(session.id)` (enter fullscreen event view)
- Long press (500ms + vibrate) → context menu (rename, delete, labels — same as current)
- Must prevent swipe interference: check dx vs dy to distinguish horizontal scroll from card tap

**Step 3: Implement expand/collapse**

Expand button toggles `expandedSessions` set. When expanded, card grows to show:
- Start time (relative, e.g. "2 hours ago")
- Message count
- File changes count
- Labels

```typescript
const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())

const toggleExpand = (sessionId: string) => {
  setExpandedSessions(prev => {
    const next = new Set(prev)
    if (next.has(sessionId)) next.delete(sessionId)
    else next.add(sessionId)
    return next
  })
}
```

**Step 4: Session voice button**

Blue circle button on each card. Tap → `startVoice(session.id)` → full voice overlay (recording → cleaning → result → send to that session).

Same voice system as current ProjectOverview, just bound to the session.

**Step 5: Commit**
```bash
git add app/src/components/UnifiedPanel.tsx
git commit -m "feat: horizontal session cards with expand, voice, and long-press"
```

---

## Task 6: Voice overlay — migrate from ProjectOverview

**Files:**
- Modify: `app/src/components/UnifiedPanel.tsx`

**Step 1: Migrate voice state + functions**

Copy from ProjectOverview (lines 182-373, 2387-2533):
- All voice state variables
- `startVoice()`, `stopVoice()`, `callCleanupAPI()`, `voiceAutoRestart()`
- Voice edit mode (`voiceEditOriginalRef`, `voiceEditModeRef`)
- Voice overlay JSX (recording orbs, cleaning spinner, result sheet)
- CSS animations (`orbWander`, `orbPulse`, `stopBtnGlow`)

**Step 2: Adapt voice target**

Voice can now be triggered from:
1. Project info card → `startVoice(null, projectId)` — sends to project-level
2. Session card → `startVoice(sessionId)` — sends to specific session

When sending:
- If `voiceSessionId` is set → `handleSendCommand` to that session
- If project-level → create new session or send to most recently active session

**Step 3: Commit**
```bash
git add app/src/components/UnifiedPanel.tsx
git commit -m "feat: migrate voice overlay system to UnifiedPanel"
```

---

## Task 7: Schedules + Templates tabs

**Files:**
- Modify: `app/src/components/UnifiedPanel.tsx`

**Step 1: Integrate existing AutomationSheet content**

Tab 1 (排程) and Tab 2 (範本) should render the same content as the current AutomationSheet tabs in ProjectOverview Panel 1.

Option: import and render AutomationSheet inline (it already has tab support for schedules vs templates). Pass `mode="schedules"` or `mode="templates"` prop.

If AutomationSheet is too tightly coupled, extract the schedule list and template list as separate render sections.

**Step 2: Commit**
```bash
git add app/src/components/UnifiedPanel.tsx
git commit -m "feat: integrate schedules and templates tabs in UnifiedPanel"
```

---

## Task 8: Wire UnifiedPanel into MissionControl

**Files:**
- Modify: `app/src/components/MissionControl.tsx`

**Step 1: Replace ProjectOverview with UnifiedPanel**

In MissionControl, find where ProjectOverview is rendered and replace with UnifiedPanel, passing the same props.

The existing panel switching in MissionControl (event view vs diff view) remains unchanged — UnifiedPanel replaces only the project/session selection layer.

**Step 2: Update imports**

```typescript
// Remove or keep ProjectOverview import (keep for release build if needed)
import { UnifiedPanel } from "./UnifiedPanel"
```

**Step 3: Ensure session selection flow works**

When user taps a session card in UnifiedPanel → `onSelectSession(id)` → MissionControl switches to event/terminal view (existing behavior, no change needed).

Back button / back gesture → return to UnifiedPanel (existing behavior).

**Step 4: Commit**
```bash
git add app/src/components/MissionControl.tsx app/src/components/UnifiedPanel.tsx
git commit -m "feat: wire UnifiedPanel into MissionControl, replacing ProjectOverview"
```

---

## Task 9: Context menus — project actions + session actions

**Files:**
- Modify: `app/src/components/UnifiedPanel.tsx`

**Step 1: Project actions bottom sheet**

Triggered by [...] button. Glass morphism bottom sheet with options:
1. Merge to main (icon: GitMerge)
2. Health report (icon: Activity)
3. View PRD (icon: FileText)
4. Edit project (icon: Edit)
5. Close project (icon: XCircle)
6. Delete project (icon: Trash — red, with confirm)

Each action calls the appropriate handler:
- Merge/Health/PRD → `onSessionInput` to the project's most active session
- Edit → inline rename/path edit
- Close → stop all sessions + collapse
- Delete → confirm dialog + `onDeleteProject`

**Step 2: Session long-press bottom sheet**

Migrate from ProjectOverview (lines 1954-2225). Same options:
1. Rename
2. Open (select session)
3. Snapshot
4. Voice
5. Schedule
6. Kill

**Step 3: Commit**
```bash
git add app/src/components/UnifiedPanel.tsx
git commit -m "feat: project actions menu and session long-press menu"
```

---

## Task 10: Visual polish — glass morphism + dark/light

**Files:**
- Modify: `app/src/components/UnifiedPanel.tsx`

**Step 1: Project info card styling**

- Glass background: `rgba(255,255,255,0.08)` dark / `rgba(255,255,255,0.6)` light
- `backdropFilter: "blur(20px) saturate(1.5)"`
- Subtle border: `1px solid rgba(255,255,255,0.12)` dark / `rgba(0,0,0,0.08)` light
- Distinct from session cards (session cards use slightly different opacity/border)

**Step 2: Session card styling**

- Smaller glass cards (~160px wide)
- Status dot with glow (reuse STATUS_DOT from ProjectOverview)
- Blue voice button: `background: #3b82f6`, 36px circle, positioned bottom-right
- Expand chevron: subtle, bottom-left

**Step 3: Tab bar styling**

- Pill-shaped tab group (like mockup)
- Active tab: solid fill
- Inactive: transparent
- Match existing glass design language

**Step 4: Responsive spacing**

- Project sections separated by 24px gap
- Session cards: 12px gap, 16px padding
- Info card: 12px padding, 12px gap from session row

**Step 5: Commit**
```bash
git add app/src/components/UnifiedPanel.tsx
git commit -m "feat: visual polish — glass morphism, dark/light themes"
```

---

## Task 11: Build + install dev APK

**Step 1: Build dev**
```bash
cd app && npm run build:dev
```

**Step 2: Sync + build APK**
```bash
npx cap sync android
cd android && JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.10.7-hotspot" ./gradlew assembleDebug
```

**Step 3: Install**
```bash
/c/Users/agres/Android/Sdk/platform-tools/adb.exe install -r app/android/app/build/outputs/apk/debug/app-debug.apk
```

**Step 4: Commit all remaining changes**
```bash
git add -A
git commit -m "feat: unified panel UI redesign — merge project + session panels"
```

---

## Dependency Graph

```
Task 1 (API endpoint) ──────────────────────────────┐
Task 2 (i18n) ──────────────────────────────────────┤
Task 3 (scaffold UnifiedPanel) ─────────────────────┤
                                                     ├→ Task 4 (project section)
                                                     │    ├→ Task 5 (session cards)
                                                     │    ├→ Task 6 (voice overlay)
                                                     │    └→ Task 9 (context menus)
                                                     ├→ Task 7 (schedules + templates tabs)
                                                     └→ Task 8 (wire into MissionControl)
                                                          └→ Task 10 (visual polish)
                                                               └→ Task 11 (build + install)
```

Tasks 1, 2, 3 can run in parallel. Tasks 4-7 depend on 3. Task 8 depends on all. Task 10-11 are final.
