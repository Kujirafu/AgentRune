# Diff Panel + Markdown Rendering — Design Doc

Date: 2026-03-04

## Overview

Two related features:
1. **DiffPanel** — when agent edits/creates a file, tap the EventCard to view a before/after swipe viewer
2. **Markdown rendering** — render Markdown in both DiffPanel (for .md files) and MissionControl agent response events

---

## 1. Data Layer

### shared/types.ts

Add optional `diff` field to `AgentEvent`:

```ts
diff?: {
  filePath: string
  before: string   // reconstructed original content
  after: string    // reconstructed new content
}
```

---

## 2. Server: Stateful Diff Accumulation

### server/adapters/claude-code.ts

**Current behaviour**: `● Edit(path)` detected → emit event immediately, diff lines discarded.

**New behaviour**: Stateful two-phase capture.

Add to `AdapterState`:
```ts
pendingEdit: {
  filePath: string
  lines: string[]        // raw diff lines accumulated
  startTime: number
} | null
```

**Phase 1 — detect**: When `● Edit(path)` or `● Write(path)` matched, store `pendingEdit`, do NOT emit yet.

**Phase 2 — accumulate**: On subsequent chunks, if `pendingEdit` is active, append lines to buffer.

**Phase 3 — finalize**: Emit event when:
- Next `●` tool call is detected, OR
- Idle prompt detected (`$`, `❯`), OR
- Timeout: >2s since `startTime` (emit with whatever was captured)

**Diff line format** (Claude Code output):
```
 1  │ context line
 2 -│ removed line
 3 +│ added line
```

**Reconstruct before/after**:
- `before`: context lines + lines prefixed with `-│`
- `after`: context lines + lines prefixed with `+│`
- Strip line number prefix (`N  │`, `N -│`, `N +│`)

---

## 3. UI: DiffPanel (new component)

### web/components/DiffPanel.tsx

A right-side drawer (same visual style as DetailPanel) opened by tapping a `file_edit` or `file_create` EventCard.

**Layout**:
```
┌─────────────────────────┐
│ ✕  web/components/Foo   │  ← basename of filePath, close button
├─────────────────────────┤
│    ◀ Before  After ▶    │  ← page dots: ◉○ or ○◉
├─────────────────────────┤
│                         │
│  (scrollable content)   │  ← monospace or rendered Markdown
│                         │
└─────────────────────────┘
```

**Swipe gestures**:
- Swipe left inside content → switch to After page
- Swipe right on After page → switch back to Before page
- Swipe right on Before page → close panel (consistent with DetailPanel)

**Content rendering**:
- If `filePath` ends in `.md`: render with `react-markdown`
- Otherwise: monospace `<pre>` with line highlighting
  - Before page: removed lines → `background: rgba(248,113,113,0.12)` (red tint)
  - After page: added lines → `background: rgba(74,222,128,0.12)` (green tint)
  - Context lines: no highlight

**Fallback**: If `event.diff` is undefined (diff capture failed), show `event.detail` as plain text with a note "Diff not available".

---

## 4. UI: Markdown in MissionControl

### web/components/EventCard.tsx

For events where `event.type === "info"` and `event.detail` contains Markdown syntax (heuristic: contains `#`, `**`, `` ` ``, or `- `), render `event.detail` with `react-markdown` instead of plain `<pre>`.

**Styling**: react-markdown output needs CSS overrides to match the dark terminal aesthetic:
- `p`: `font-size: 12px`, `color: var(--text-secondary)`, `margin: 0 0 4px`
- `code`: monospace, `background: rgba(255,255,255,0.06)`, `border-radius: 4px`, `padding: 1px 4px`
- `pre > code`: block display, `background: rgba(255,255,255,0.04)`, `border-radius: 8px`, `padding: 8px`
- `h1–h3`: `font-size: 13–14px`, `font-weight: 700`, `color: var(--text-primary)`
- `ul/ol`: `padding-left: 16px`, `font-size: 12px`
- `a`: `color: var(--accent-primary)`, no underline

---

## 5. Trigger: EventCard → DiffPanel

### web/components/EventCard.tsx

Add `onViewDiff?: (event: AgentEvent) => void` prop.

For `file_edit` and `file_create` events: show a small `◈ View diff` chip in the card footer that calls `onViewDiff(event)` on tap.

### web/components/MissionControl.tsx

Accept `onEventDiff?: (event: AgentEvent) => void` prop, pass down to EventCard.

### web/App.tsx

- Add `diffEvent: AgentEvent | null` state
- Pass `onEventDiff={(e) => setDiffEvent(e)}` to MissionControl
- Render `<DiffPanel event={diffEvent} onClose={() => setDiffEvent(null)} />`

---

## 6. Dependencies

```bash
npm install react-markdown
```

`react-markdown` v9 is ESM-only, compatible with Vite. No additional plugins needed for basic rendering.

---

## 7. Files to Change

| File | Change |
|------|--------|
| `shared/types.ts` | Add `diff?` to `AgentEvent` |
| `server/adapters/claude-code.ts` | Stateful diff accumulation |
| `web/components/DiffPanel.tsx` | New component |
| `web/components/EventCard.tsx` | Add `onViewDiff` prop + chip |
| `web/components/MissionControl.tsx` | Pass `onEventDiff` down |
| `web/App.tsx` | Wire `diffEvent` state + render `DiffPanel` |
| `web/components/EventCard.tsx` | Markdown rendering for info events |
| `package.json` | Add `react-markdown` |
