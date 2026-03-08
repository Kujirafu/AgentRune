# Schedule UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace scattered automation entry points with a unified 3-tab panel (Sessions | Schedules | Templates) in ProjectOverview.

**Architecture:** Extend Panel 1 from a session-only view to a 3-tab view. Move AutomationSheet's list/management logic into ProjectOverview as inline Schedules and Templates tabs. Keep AutomationSheet's add/edit form as an overlay. Add schedule detail page as full-screen overlay.

**Tech Stack:** React + TypeScript, Capacitor (mobile), inline styles, i18n (en.ts + zh-TW.ts)

---

### Task 1: Add 3-tab state + pill toggle to Panel 1

**Files:**
- Modify: `app/src/components/ProjectOverview.tsx`

**What to do:**
1. Add state: `const [sessionTab, setSessionTab] = useState<"sessions" | "schedules" | "templates">("sessions")`
2. Replace the existing 2-option pill toggle (`swipeProjects / swipeSessions`) with 3-option pill: Sessions | Schedules | Templates
3. Keep Panel 0/1 swipe logic unchanged — the 3 tabs are within Panel 1 only
4. Conditional render: show session list when `sessionTab === "sessions"`, placeholder divs for the other two tabs

**Verify:** Build APK, open Panel 1, see 3 tabs, Sessions tab shows existing session list, other tabs show placeholders.

**Commit:** `feat(ui): add 3-tab pill toggle to session panel`

---

### Task 2: Simplify header buttons

**Files:**
- Modify: `app/src/components/ProjectOverview.tsx`

**What to do:**
1. Remove `showAddMenu` state and the popup menu from `+` button
2. Right side of header: two fixed buttons:
   - Clock `+` button → opens new schedule form (set `showAutomation=true` + dispatch `agentrune:automationAdd`)
   - `+` button → opens NewSessionSheet directly (existing behavior)
3. Remove the standalone clock button (was for managing, now handled by Schedules tab)

**Verify:** Build, both buttons work regardless of which tab is active.

**Commit:** `refactor(ui): simplify header to fixed + and clock buttons`

---

### Task 3: Build Schedules tab content

**Files:**
- Modify: `app/src/components/ProjectOverview.tsx`
- Reference: `app/src/components/AutomationSheet.tsx` (copy card logic from list page)

**What to do:**
1. When `sessionTab === "schedules"`, render schedule cards inline in Panel 1
2. Fetch automations from `${serverUrl}/api/automations/${projectId}` (same as AutomationSheet)
3. Vertical card layout per design:
   - Time (large) + toggle
   - Weekday dots
   - Name + prompt (2-line clamp)
   - Last run status + stats ("ran N times, M findings")
   - Action buttons row: Edit | Run Now | Delete — all visible, no expand needed
4. Click card body → expand to show recent 3 results summary
5. Empty state: clock icon + "No schedules yet"
6. Handle toggle, delete, edit (opens AutomationSheet add form with pre-filled values)

**Verify:** Build, Schedules tab shows cards with all controls visible. Toggle works. Delete works. Edit opens form.

**Commit:** `feat(ui): implement Schedules tab with vertical cards`

---

### Task 4: Build Templates tab content

**Files:**
- Modify: `app/src/components/ProjectOverview.tsx`
- Reference: `app/src/components/AutomationSheet.tsx` (copy template list logic)

**What to do:**
1. When `sessionTab === "templates"`, render template cards
2. Search bar at top
3. Pinned templates first, then by relevance
4. Card: icon + name + description + pin button + "Create Schedule" button
5. Stats line: "Ran N times · last found X" (if available, placeholder for now)
6. "Create Schedule" → opens AutomationSheet add form with template pre-filled
7. Starter Pack banner (V2 — just leave a TODO comment for now)

**Verify:** Build, Templates tab shows all 23 builtin templates. Search works. Pin works. "Create Schedule" opens form.

**Commit:** `feat(ui): implement Templates tab with search and pin`

---

### Task 5: Schedule detail page overlay

**Files:**
- Modify: `app/src/components/ProjectOverview.tsx`

**What to do:**
1. Add state: `const [scheduleDetailId, setScheduleDetailId] = useState<string | null>(null)`
2. When set, render full-screen overlay:
   - Back arrow + schedule name
   - Settings summary (time, weekdays, agent, mode, prompt)
   - Stats: "Ran N times · M findings"
   - Full execution history list (fetch all results)
   - Each result: status dot + date/time + duration + summary (first 2-3 lines)
   - Click to expand full output
3. From Schedules tab expanded results, `>` button sets `scheduleDetailId`

**Verify:** Build, expand a schedule card, click `>` on a result, detail page opens with full history.

**Commit:** `feat(ui): add schedule detail page overlay`

---

### Task 6: Clean up old entry points

**Files:**
- Modify: `app/src/components/ProjectOverview.tsx`

**What to do:**
1. Project card schedule indicator: clicking it should jump to Panel 1 Schedules tab (setPanel(1), setSessionTab("schedules"))
2. Context menu "Automations" option: same behavior (jump to Schedules tab)
3. Remove direct AutomationSheet opens from project card and context menu
4. Keep AutomationSheet component only for the add/edit form overlay

**Verify:** Build, all old entry points now navigate to Schedules tab.

**Commit:** `refactor(ui): redirect old schedule entry points to Schedules tab`

---

### Task 7: i18n keys

**Files:**
- Modify: `app/src/lib/i18n/en.ts`
- Modify: `app/src/lib/i18n/zh-TW.ts`

**What to do:**
Add keys for new UI strings:
- `sessions.tabSessions` / `sessions.tabSchedules` / `sessions.tabTemplates`
- `schedules.empty` / `schedules.ranTimes` / `schedules.findings` / `schedules.runNow`
- `schedules.detail` / `schedules.executionHistory` / `schedules.stats`
- `templates.starterPack` / `templates.createSchedule`

**Commit:** `feat(i18n): add schedule UI redesign translation keys`

---

### Task 8: Final build + release

**What to do:**
1. `vite build` → `cap sync android` → `gradlew assembleDebug`
2. `adb install -r` to phone
3. Copy APK to `public/agentrune.apk`
4. `gh release upload v0.1.0-alpha public/agentrune.apk --clobber`
5. Manual test all 3 tabs, create/edit/delete schedule, detail page

**Commit:** `chore: update APK (schedule UI redesign)`
