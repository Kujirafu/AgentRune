# Session Grid Design

## Summary

Replace the Win+Tab floating session picker with a 2-panel swipe navigation in `ProjectOverview`:
- **Panel 0** (Projects): Existing project list (unchanged)
- **Panel 1** (Session Grid): CSS Grid of session cards for the selected project

## User Requirements
- Clicking a project with sessions swipes to Panel 1 (Session Grid)
- Clicking a project with 0 sessions opens NewSessionSheet
- Session Grid has a "New Session" button
- Session Grid uses responsive CSS Grid layout
- Short tap on session card enters MissionControl
- Long press on session card shows context menu (rename/kill/merge/discard worktree)
- Bottom page indicator (two dots)
- Delete the Win+Tab floating session picker
- Add "Worktree Isolation" toggle in SettingsSheet (default: ON)

## Panel 0: Projects (existing)

No changes to current project list. `handleProjectTap` logic:
- 0 sessions: open NewSessionSheet (unchanged)
- 1+ sessions: swipe to Panel 1 with that project selected

## Panel 1: Session Grid

### Header
- Back arrow (swipe back to Panel 0)
- Project name
- "+" new session button

### Grid Layout
```css
display: grid;
grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
gap: 12px;
```

### Session Card Content
- Status dot (color-coded) + agent name or custom label
- Branch name (if worktree)
- Progress summary (truncated to ~60 chars)
- Last activity relative time

### Interactions
- Short tap -> `onSelectSession(sessionId)` (enter MissionControl)
- Long press -> context menu bottom sheet (rename, kill, merge/discard worktree)

## Navigation

Swipe gesture pattern reused from MissionControl's panel system:
- `useState<number>(0)` for current panel
- Touch handlers with `touchStartX`, threshold 50px
- `translateX(-panel * 100vw)` with CSS transition
- Rubber band effect at edges (no over-scroll)

## Page Indicator

Two dots at bottom center:
- Active dot: `var(--accent-primary)`, slightly larger
- Inactive dot: `var(--text-secondary)` at 30% opacity
- Fixed position above safe area

## SettingsSheet: Worktree Toggle

Add `ToggleCard` in the general settings section:
- Label: "Worktree Isolation" / i18n key `settings.worktreeIsolation`
- Description: "Run each session in its own git worktree" / i18n key `settings.worktreeIsolationDesc`
- Stored in `localStorage` key `agentrune_worktree_enabled`, default `true`
- Icon: git-branch SVG

## Files to Modify

1. `app/src/components/ProjectOverview.tsx` - Main changes (panels, grid, swipe)
2. `app/src/components/SettingsSheet.tsx` - Add worktree toggle
3. `app/src/lib/i18n/en.ts` - Add new translation keys
4. `app/src/lib/i18n/zh-TW.ts` - Add zh-TW translations
5. `app/src/lib/storage.ts` - Add worktree enabled getter/setter (if exists, else inline localStorage)

## Elements to Delete

- Win+Tab floating session picker (lines ~416-528 in ProjectOverview.tsx)
- Associated `pickerProjectId`, `pickerSessions` state
