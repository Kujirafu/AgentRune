# Inline Edit Design

## Summary

Add inline code editing to DiffPanel: users tap line numbers to select lines, type a natural language instruction, and the agent modifies the file via PTY.

## User Flow

1. User views a file diff in DiffPanel (after panel shows current code with line numbers)
2. User taps line numbers to select lines (toggle select/deselect)
3. User can long-press + drag to select a continuous range
4. Selected lines are highlighted; input bar shows a chip like `[L12-L18]`
5. User taps the input field, types instruction (e.g. "rename forEach to map")
6. Instruction sent to agent as: `Edit ${filePath} lines 12-18: rename forEach to map`
7. Agent modifies the file; DiffPanel refreshes to show updated diff

## Line Number Display

- Both Before and After panels show line numbers
- Style: fixed-width, monospace, dim color (`var(--text-secondary)` at 40% opacity)
- `userSelect: "none"` — numbers are not selectable as text
- Tappable area: full line-number column (min 32px wide for easy tap)

## Line Selection Mechanism

### Interactions
- **Tap line number** → toggle select/deselect that line
- **Long-press line number + drag** → select continuous range
- **Tap already-selected line** → deselect it
- **Tap × on chip** → clear all selections

### Visual Feedback
- Selected lines: background highlight (`var(--accent-primary)` at 10% opacity)
- Line number of selected line: accent color, bolder weight

### State
- `selectedLines: Set<number>` — set of selected line numbers (from After panel)
- Only After panel lines are selectable (Before is read-only reference)

### Important: No Keyboard Pop-up on Line Tap
- Tapping line numbers must NOT focus the text input
- Input is only focused when user explicitly taps the input field

## Input Bar

### Layout
- Fixed at bottom of DiffPanel (above safe area)
- Glass morphism style matching existing InputBar
- Left: line reference chip (when lines selected)
- Center: text input with placeholder
- Right: send button

### Line Reference Chip
- Displayed when `selectedLines.size > 0`
- Format: consecutive lines merged → `L12-L18`, non-consecutive → `L12, L15, L20`
- Has × button to clear all selections
- Style: small rounded chip, accent border, monospace text

### Placeholder Text
- With lines selected: "Describe the edit..."
- Without lines: "Select lines or describe edit..."

### Send Format
- With lines: `Edit ${filePath} lines ${lineRef}: ${instruction}`
- Without lines: `Edit ${filePath}: ${instruction}`
- Sent via existing `send({type: "input", data: ...})` to agent PTY

### Post-Send
- Clear input text and line selection
- Brief toast: "Sent to agent" (fade out after 2s)

## i18n Keys

- `diff.editPlaceholder`: "Describe the edit..."
- `diff.editPlaceholderNoLines`: "Select lines or describe edit..."
- `diff.sentToAgent`: "Sent to agent"
- `diff.clearSelection`: "Clear"

## Files to Modify

1. `app/src/components/DiffPanel.tsx` — Add line numbers, selection state, input bar
2. `app/src/lib/i18n/en.ts` — Add i18n keys
3. `app/src/lib/i18n/zh-TW.ts` — Add zh-TW translations

## What We're NOT Doing

- No code text selection (mobile UX is bad for this)
- No new backend file-edit API (reuse agent PTY flow)
- No live diff preview (wait for agent to finish, then DiffPanel refreshes naturally)
- No Monaco/CodeMirror editor (keep it lightweight)
