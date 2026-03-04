# Diff Panel + Markdown Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show file before/after diff viewer when tapping file_edit EventCards, and render Markdown in both the diff viewer and agent response events.

**Architecture:** Server adapter accumulates PTY diff output into `AgentEvent.diff`, new `DiffPanel` component renders before/after with horizontal swipe, `react-markdown` renders `.md` file content and agent response Markdown.

**Tech Stack:** React 19, TypeScript, react-markdown v9, existing glass-card design language (dark, `rgba` backgrounds, no Tailwind)

---

### Task 1: Add `diff` field to shared types

**Files:**
- Modify: `shared/types.ts`

**Step 1: Add the diff field**

In `shared/types.ts`, add to `AgentEvent`:

```ts
export interface AgentEvent {
  // ...existing fields...
  diff?: {
    filePath: string
    before: string
    after: string
  }
}
```

**Step 2: Verify**

```bash
npm run typecheck
```
Expected: 0 errors.

**Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "feat(types): add diff field to AgentEvent"
```

---

### Task 2: Stateful diff accumulation in claude-code adapter

**Files:**
- Modify: `server/adapters/claude-code.ts`

**Context:** Claude Code outputs diffs like this after `● Edit(path)`:
```
⎿  Updated path with 2 additions and 1 removal.
 1  │ context line
 2 -│ removed line
 3 +│ added line
```
Lines with ` -│` are removed, ` +│` are added, `  │` are context. This arrives in chunks after the initial `● Edit(...)` line.

**Step 1: Add pendingEdit to AdapterState**

In `AdapterState` interface (top of file):
```ts
interface AdapterState {
  pending: string
  lastThinkingTime: number
  lastResponseTime: number
  lastTokenTime: number
  seenTools: Set<string>
  seenToolsExpire: number
  // NEW:
  pendingEdit: {
    filePath: string
    lines: string[]
    startTime: number
    eventId: string
  } | null
}
```

In `getState()`, add `pendingEdit: null` to the initial object.

**Step 2: Replace the Edit/Write detection logic**

Find the `toolPatterns` array and the loop after it. Replace the Edit and Write handling so that instead of immediately emitting, we store a pending edit.

After the `for (const [pattern, type, titleFn, extra] of toolPatterns)` loop, add this block right before `hasToolCall` is used elsewhere:

```ts
// Finalize any pending edit when a new tool or prompt is detected
if (state.pendingEdit && (hasToolCall || this.detectIdle(text))) {
  const { filePath, lines, eventId } = state.pendingEdit
  const diff = parseDiffLines(lines)
  events.push({
    id: eventId,
    timestamp: state.pendingEdit.startTime,
    type: "file_edit",
    status: "completed",
    title: `Edited ${filePath}`,
    diff: { filePath, before: diff.before, after: diff.after },
    raw: chunk,
  })
  state.pendingEdit = null
}
```

Then update the Edit/Write toolPatterns match inside the loop to NOT push events but instead set pendingEdit. Replace the loop body with:

```ts
for (const [pattern, type, titleFn, extra] of toolPatterns) {
  const m = text.match(pattern)
  if (m) {
    hasToolCall = true
    const sig = `${m[0].slice(0, 60)}`
    if (!state.seenTools.has(sig)) {
      state.seenTools.add(sig)

      if (type === "file_edit" || type === "file_create") {
        // Finalize previous pending edit first
        if (state.pendingEdit) {
          const { filePath: fp, lines, eventId: eid } = state.pendingEdit
          const d = parseDiffLines(lines)
          events.push({
            id: eid,
            timestamp: state.pendingEdit.startTime,
            type: "file_edit",
            status: "completed",
            title: `Edited ${fp}`,
            diff: { filePath: fp, before: d.before, after: d.after },
            raw: chunk,
          })
        }
        // Start new pending edit
        state.pendingEdit = {
          filePath: titleFn(m).replace(/^(Editing|Creating) /, ""),
          lines: [],
          startTime: now,
          eventId: makeEventId(),
        }
      } else {
        events.push({
          id: makeEventId(),
          timestamp: now,
          type: type as AgentEvent["type"],
          status: "in_progress",
          title: titleFn(m),
          detail: extra === "bash" ? (m[1] || "").slice(0, 100) : (m[2] || "").slice(0, 100) || undefined,
          raw: chunk,
        })
      }
    }
  }
}
```

**Step 3: Accumulate diff lines when pendingEdit is active**

After the tool loop block, add:
```ts
// Accumulate diff lines for pending edit
if (state.pendingEdit) {
  const diffLines = clean.split("\n").filter(l => /^\s*\d+\s*[-+ ]?\s*│/.test(l) || /^[⎿✎]/.test(l.trim()))
  state.pendingEdit.lines.push(...diffLines)
  // Auto-finalize after 3 seconds to avoid hanging
  if (now - state.pendingEdit.startTime > 3000) {
    const { filePath: fp, lines, eventId: eid, startTime } = state.pendingEdit
    const d = parseDiffLines(lines)
    events.push({
      id: eid,
      timestamp: startTime,
      type: "file_edit",
      status: "completed",
      title: `Edited ${fp}`,
      diff: { filePath: fp, before: d.before, after: d.after },
      raw: chunk,
    })
    state.pendingEdit = null
  }
}
```

**Step 4: Add parseDiffLines helper** (add at top of file, before the adapter export):

```ts
function parseDiffLines(lines: string[]): { before: string; after: string } {
  const before: string[] = []
  const after: string[] = []

  for (const line of lines) {
    // Format: " N -│ content" or " N +│ content" or " N  │ content"
    const m = line.match(/^\s*\d+\s*([-+ ])?\s*│(.*)$/)
    if (!m) continue
    const marker = m[1] || " "
    const content = m[2] ?? ""
    if (marker === "-") {
      before.push(content)
    } else if (marker === "+") {
      after.push(content)
    } else {
      before.push(content)
      after.push(content)
    }
  }

  return {
    before: before.join("\n"),
    after: after.join("\n"),
  }
}
```

**Step 5: Verify**

```bash
npm run typecheck
```
Expected: 0 errors.

**Step 6: Commit**

```bash
git add server/adapters/claude-code.ts
git commit -m "feat(adapter): stateful diff accumulation for file_edit events"
```

---

### Task 3: Install react-markdown

**Step 1: Install**

```bash
npm install react-markdown
```

**Step 2: Verify it resolves**

```bash
npm run typecheck
```
Expected: 0 errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add react-markdown"
```

---

### Task 4: Create DiffPanel component

**Files:**
- Create: `web/components/DiffPanel.tsx`

**Step 1: Create the file**

```tsx
// web/components/DiffPanel.tsx
import { useState, useRef } from "react"
import ReactMarkdown from "react-markdown"
import type { AgentEvent } from "../../shared/types"

interface DiffPanelProps {
  event: AgentEvent | null
  onClose: () => void
}

function isMarkdownFile(path: string): boolean {
  return path.endsWith(".md") || path.endsWith(".mdx")
}

// Minimal markdown styles matching dark terminal aesthetic
const MD_STYLES = `
.diff-md p { font-size: 13px; color: rgba(226,232,240,0.8); margin: 0 0 8px; line-height: 1.6; }
.diff-md h1,.diff-md h2,.diff-md h3 { font-size: 14px; font-weight: 700; color: #e2e8f0; margin: 12px 0 6px; }
.diff-md code { font-family: 'JetBrains Mono', monospace; font-size: 11px; background: rgba(255,255,255,0.08); border-radius: 4px; padding: 1px 5px; }
.diff-md pre { background: rgba(255,255,255,0.04); border-radius: 10px; padding: 12px; overflow-x: auto; margin: 8px 0; }
.diff-md pre code { background: transparent; padding: 0; }
.diff-md ul, .diff-md ol { padding-left: 18px; font-size: 13px; color: rgba(226,232,240,0.7); }
.diff-md li { margin-bottom: 4px; }
.diff-md a { color: #60a5fa; text-decoration: none; }
.diff-md blockquote { border-left: 3px solid rgba(96,165,250,0.4); margin: 8px 0; padding: 4px 12px; color: rgba(226,232,240,0.5); }
`

function DiffContent({ content, side, filePath }: { content: string; side: "before" | "after"; filePath: string }) {
  if (isMarkdownFile(filePath)) {
    return (
      <div className="diff-md" style={{ padding: "12px 16px" }}>
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    )
  }

  // Plain text with line highlighting
  const lines = content.split("\n")
  const highlightColor = side === "before"
    ? "rgba(248,113,113,0.10)"
    : "rgba(74,222,128,0.10)"

  return (
    <pre style={{
      margin: 0,
      padding: "12px 16px",
      fontSize: 12,
      fontFamily: "'JetBrains Mono', monospace",
      color: "rgba(255,255,255,0.75)",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      lineHeight: 1.6,
    }}>
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            background: highlightColor,
            borderRadius: 3,
            padding: "0 4px",
            marginBottom: 1,
          }}
        >
          {line || " "}
        </div>
      ))}
    </pre>
  )
}

export function DiffPanel({ event, onClose }: DiffPanelProps) {
  const [page, setPage] = useState<"before" | "after">("after")
  const touchStartX = useRef(0)
  const open = event !== null

  const filePath = event?.diff?.filePath || event?.title?.replace(/^(Edited|Created) /, "") || "File"
  const fileName = filePath.split(/[\\/]/).pop() || filePath

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (dx > 80) {
      if (page === "after") {
        setPage("before")
      } else {
        onClose()
      }
    } else if (dx < -80) {
      if (page === "before") setPage("after")
    }
  }

  const hasDiff = !!event?.diff

  return (
    <>
      <style>{MD_STYLES}</style>

      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(2px)",
            zIndex: 200,
          }}
        />
      )}

      {/* Panel */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          position: "fixed",
          top: 0, right: 0, bottom: 0,
          width: "85vw",
          maxWidth: 420,
          zIndex: 201,
          background: "rgba(15,23,42,0.95)",
          backdropFilter: "blur(32px)",
          WebkitBackdropFilter: "blur(32px)",
          borderLeft: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.3)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.3s ease-out",
          display: "flex",
          flexDirection: "column",
          color: "#e2e8f0",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 16px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13,
              fontWeight: 600,
              color: "rgba(255,255,255,0.7)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              marginRight: 8,
            }}>
              {fileName}
            </div>
            <button
              onClick={onClose}
              style={{
                width: 30, height: 30, borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.4)",
                fontSize: 14, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}
            >✕</button>
          </div>

          {/* Page indicator */}
          {hasDiff && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginBottom: 12,
            }}>
              <button
                onClick={() => setPage("before")}
                style={{
                  padding: "6px 16px", borderRadius: 8,
                  border: page === "before" ? "1px solid rgba(248,113,113,0.4)" : "1px solid rgba(255,255,255,0.08)",
                  background: page === "before" ? "rgba(248,113,113,0.12)" : "transparent",
                  color: page === "before" ? "#f87171" : "rgba(255,255,255,0.35)",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >Before</button>
              <div style={{ display: "flex", gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: page === "before" ? "#f87171" : "rgba(255,255,255,0.15)" }} />
                <div style={{ width: 6, height: 6, borderRadius: 3, background: page === "after" ? "#4ade80" : "rgba(255,255,255,0.15)" }} />
              </div>
              <button
                onClick={() => setPage("after")}
                style={{
                  padding: "6px 16px", borderRadius: 8,
                  border: page === "after" ? "1px solid rgba(74,222,128,0.4)" : "1px solid rgba(255,255,255,0.08)",
                  background: page === "after" ? "rgba(74,222,128,0.12)" : "transparent",
                  color: page === "after" ? "#4ade80" : "rgba(255,255,255,0.35)",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >After</button>
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" as never }}>
          {!hasDiff ? (
            <div style={{ padding: "16px", fontSize: 12, color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace" }}>
              {event?.detail || "Diff not available"}
            </div>
          ) : (
            <DiffContent
              content={page === "before" ? (event!.diff!.before || "(empty)") : (event!.diff!.after || "(empty)")}
              side={page}
              filePath={filePath}
            />
          )}
        </div>

        {/* Swipe hint */}
        <div style={{
          padding: "8px",
          textAlign: "center",
          fontSize: 10,
          color: "rgba(255,255,255,0.12)",
          flexShrink: 0,
          borderTop: "1px solid rgba(255,255,255,0.04)",
        }}>
          {hasDiff ? "← swipe to switch · swipe right on Before to close" : "swipe right to close"}
        </div>
      </div>
    </>
  )
}
```

**Step 2: Verify**

```bash
npm run typecheck
```
Expected: 0 errors.

**Step 3: Commit**

```bash
git add web/components/DiffPanel.tsx
git commit -m "feat(ui): add DiffPanel component with before/after swipe viewer"
```

---

### Task 5: Add "View diff" trigger to EventCard

**Files:**
- Modify: `web/components/EventCard.tsx`

**Step 1: Add onViewDiff prop to EventCardProps**

```ts
interface EventCardProps {
  event: AgentEvent
  onDecision?: (input: string) => void
  onQuote?: (text: string) => void
  onSaveObsidian?: (text: string) => void
  onViewDiff?: (event: AgentEvent) => void   // NEW
}
```

Update the function signature:
```ts
export function EventCard({ event, onDecision, onQuote, onSaveObsidian, onViewDiff }: EventCardProps) {
```

**Step 2: Add chip inside the card, after the `{cleanDetail && ...}` block**

Add this block right before the `{event.decision && ...}` block:

```tsx
{/* View diff chip — only for file events that have diff data */}
{(event.type === "file_edit" || event.type === "file_create") && onViewDiff && (
  <div style={{ marginTop: 6 }}>
    <button
      onClick={(e) => { e.stopPropagation(); onViewDiff(event) }}
      style={{
        padding: "3px 10px",
        borderRadius: 6,
        border: "1px solid rgba(96,165,250,0.25)",
        background: "rgba(96,165,250,0.07)",
        color: "rgba(96,165,250,0.8)",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      ◈ View diff
    </button>
  </div>
)}
```

**Step 3: Verify**

```bash
npm run typecheck
```
Expected: 0 errors.

**Step 4: Commit**

```bash
git add web/components/EventCard.tsx
git commit -m "feat(ui): add View diff chip to file_edit EventCards"
```

---

### Task 6: Wire DiffPanel into MissionControl and App

**Files:**
- Modify: `web/components/MissionControl.tsx`
- Modify: `web/App.tsx`

**Step 1: Add onEventDiff prop to MissionControl**

Find the `MissionControlProps` interface in `MissionControl.tsx`. Add:
```ts
onEventDiff?: (event: AgentEvent) => void
```

Update the component signature to receive the prop, and pass it down to each `<EventCard>` as `onViewDiff={onEventDiff}`.

Find all `<EventCard event={...}` usages and add `onViewDiff={onEventDiff}` to each.

**Step 2: Add diffEvent state to App.tsx**

Find where other panel states are declared (e.g. `settingsOpen`, `historyOpen`). Add:
```ts
const [diffEvent, setDiffEvent] = useState<AgentEvent | null>(null)
```

You'll need to import `AgentEvent` from `../../shared/types` if not already imported.

**Step 3: Render DiffPanel in App.tsx**

Find where `<DetailPanel` and other panels are rendered. Add alongside them:
```tsx
<DiffPanel
  event={diffEvent}
  onClose={() => setDiffEvent(null)}
/>
```

Import `DiffPanel` at the top: `import { DiffPanel } from "./components/DiffPanel"`

**Step 4: Pass onEventDiff to MissionControl**

Find `<MissionControl` usage in App.tsx. Add:
```tsx
onEventDiff={(e) => setDiffEvent(e)}
```

**Step 5: Verify**

```bash
npm run typecheck
```
Expected: 0 errors.

**Step 6: Build to confirm no runtime issues**

```bash
npm run build
```
Expected: Build succeeds with no errors.

**Step 7: Commit**

```bash
git add web/components/MissionControl.tsx web/App.tsx
git commit -m "feat(ui): wire DiffPanel into MissionControl and App"
```

---

### Task 7: Markdown rendering in EventCard agent responses

**Files:**
- Modify: `web/components/EventCard.tsx`

**Step 1: Import react-markdown**

At the top of `EventCard.tsx`, add:
```ts
import ReactMarkdown from "react-markdown"
```

**Step 2: Add markdown detection helper**

After the existing `extractUrl` function, add:
```ts
function looksLikeMarkdown(text: string): boolean {
  return /#{1,3} |[*_]{2}|\*[^*]+\*|`[^`]+`|^\s*[-*] /m.test(text)
}
```

**Step 3: Add scoped markdown styles**

Add a `<style>` block inside the EventCard return (just before the outermost `<>`):
```tsx
<style>{`
  .ec-md p { font-size: 12px; color: rgba(226,232,240,0.7); margin: 0 0 4px; line-height: 1.5; }
  .ec-md code { font-family: 'JetBrains Mono', monospace; font-size: 11px; background: rgba(255,255,255,0.08); border-radius: 4px; padding: 1px 4px; }
  .ec-md pre { background: rgba(255,255,255,0.04); border-radius: 8px; padding: 8px 12px; margin: 4px 0; overflow-x: auto; }
  .ec-md pre code { background: transparent; padding: 0; }
  .ec-md ul, .ec-md ol { padding-left: 16px; font-size: 12px; color: rgba(226,232,240,0.65); margin: 0; }
  .ec-md h1,.ec-md h2,.ec-md h3 { font-size: 13px; font-weight: 700; color: #e2e8f0; margin: 6px 0 2px; }
  .ec-md a { color: #60a5fa; text-decoration: none; }
`}</style>
```

**Step 4: Replace the cleanDetail rendering block**

Find the `{cleanDetail && (...)}` block in EventCard. Replace the inner `<div>` content:

```tsx
{cleanDetail && (
  <div style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "'JetBrains Mono', monospace" }}>
    {event.type === "info" && looksLikeMarkdown(cleanDetail) ? (
      <div className="ec-md">
        <ReactMarkdown>{cleanDetail}</ReactMarkdown>
      </div>
    ) : (
      cleanDetail
    )}
  </div>
)}
```

**Step 5: Verify**

```bash
npm run typecheck
```
Expected: 0 errors.

**Step 6: Build**

```bash
npm run build
```
Expected: Build succeeds.

**Step 7: Commit**

```bash
git add web/components/EventCard.tsx
git commit -m "feat(ui): render Markdown in agent response EventCards"
```

---

### Task 8: Final verification

**Step 1: Full typecheck + build**

```bash
npm run typecheck && npm run build
```
Expected: 0 type errors, build succeeds.

**Step 2: Manual verification checklist**

In the running app, verify:
- [ ] Tapping a `file_edit` event card shows a "◈ View diff" chip
- [ ] Tapping the chip opens DiffPanel from the right
- [ ] DiffPanel shows "Before" and "After" buttons with colored dots
- [ ] Tapping Before/After switches the content view
- [ ] Swiping left/right in the panel switches pages
- [ ] Swiping right on Before page closes the panel
- [ ] Agent response events with Markdown syntax render formatted text (not raw `**bold**`)

**Step 3: Commit summary**

All individual commits already done above. No final commit needed.
