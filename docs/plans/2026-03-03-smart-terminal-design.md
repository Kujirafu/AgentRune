# AgentRune Smart Terminal Design

## Product Definition

AgentRune is a mobile-first AI coding assistant launcher. It connects to a local dev machine via WebSocket and provides a touch-friendly terminal experience optimized for AI agent interaction.

**Positioning:** Independent product. Not a generic terminal emulator — an AI-first dev tool for phones.

**Core workflow:** Open → Pick project → Pick agent → Work via touch interactions.

## Architecture

```
┌──────────────┐     WebSocket      ┌──────────────┐
│  Phone       │ ◄──────────────► │  PC Server   │
│  (Browser)   │                    │  (Express)   │
│              │                    │              │
│  Launch Pad  │     PTY stdin/out  │  node-pty    │
│  Terminal UI │ ◄──────────────► │  sessions    │
│  Smart Layer │                    │  auth        │
└──────────────┘                    └──────────────┘
```

Existing backend (Express + WebSocket + node-pty + auth) stays unchanged. All changes are frontend-only.

## Screen 1: Launch Pad

Two-panel layout. Top panel: project selection. Bottom panel: agent selection.

### Top Panel — Projects

- Horizontal scrollable cards, one per project from `projects.json`
- Selected project has visual highlight
- `[+ New]` button opens inline form (name + path)
- Projects with active background sessions show green dot + "running..." label
  - Active project card shows `[Resume]` and `[Kill & Restart]` instead of agent list
- Most recently used project auto-selected on launch

### Bottom Panel — Agents

- Vertical list of agent cards:
  - Claude Code — "AI coding assistant"
  - Codex CLI — "OpenAI code agent"
  - Terminal — "Plain shell"
- Tapping an agent card: attaches to selected project's PTY + sends launch command
  - Claude Code: `claude\n` (with flags from settings: `--model`, `--dangerously-skip-permissions`)
  - Codex CLI: `codex\n`
  - Terminal: just attaches, sends nothing
- Agent list is extensible (future: Aider, Copilot CLI, etc.)

### Input Bar

Always visible at bottom. User can type any custom command even from Launch Pad.

## Screen 2: Terminal View

After tapping an agent, transitions to terminal view.

### Layout (top to bottom)

1. **Top bar** — `← ProjectName · AgentName [mode indicator] 🎛`
2. **Terminal output** — xterm.js (scrollable, full ANSI support)
3. **Smart suggestion list** — vertical cards, context-dependent (see below)
4. **Quick action bar** — icon-based shortcut keys
5. **Input bar** — text field + send button

### Top Bar

- `←` returns to Launch Pad (session stays alive in background)
- Project name + agent name for context
- Mode indicator: shows `⚡` when Bypass mode is on
- `🎛` opens Settings bottom sheet

### Smart Suggestion List (vertical cards)

Same position, content changes based on terminal state:

**When AI asks a question (Allow/Deny, Y/n, etc.):**

| Terminal output pattern | Buttons shown |
|---|---|
| `Allow ... ? (y/n)` | `[Allow this once]` `[Always allow]` `[Deny]` |
| `[Y/n]` or `(y/N)` | `[Yes]` `[No]` |
| `1) option 2) option` | `[1. option]` `[2. option]` ... |
| `Press Enter to continue` | `[Continue ↵]` |
| inquirer `? Select ...` | Detect options → buttons |

**When shell is idle (detected `$` / `>` / `%` prompt):**

Suggest next commands, by priority:
1. Agent launch commands (`claude`, `codex`) — always first
2. Project scripts (from `package.json` `scripts` field)
3. Recent commands (per-project, stored in localStorage, deduplicated, max 3)
4. Common git commands (`git status`, `git pull`, `git push`)

**Detection:** Read xterm buffer last 5 lines. Match against known patterns. Also detect idle via: prompt regex match OR 500ms no new output + last line non-empty.

**Transition:** Suggestions auto-switch between prompt responses and idle suggestions. User always looks at the same place.

### Quick Action Bar

Icon-based, newbie-friendly labels:

| Icon | Label | Action | Escape sequence |
|---|---|---|---|
| ■ | Stop | Ctrl+C | `\x03` |
| Tab | Tab | Tab completion | `\t` |
| ↑ | — | Previous command | `\x1b[A` |
| ↓ | — | Next command | `\x1b[B` |
| ↩ | Undo | Ctrl+Z | `\x1a` |
| ⌧ | Clear | Ctrl+L | `\x0c` |
| ⏏ | Exit | Ctrl+D | `\x04` |

### Input Bar

- Text input with monospace font
- Send button (↵) — sends text + newline
- Empty send = just newline (for "Press Enter to continue")
- Ctrl+C works from input bar too
- `autoComplete="off"`, `autoCapitalize="off"`, `spellCheck=false`

## Settings Bottom Sheet

Opened via 🎛 button in top bar.

### Model Selection

Horizontal toggle: `[Sonnet ✓] [Opus] [Haiku]`

Affects Claude Code launch command: `claude --model sonnet`

### Mode Toggles

| Toggle | Effect | Implementation |
|---|---|---|
| Bypass Mode | Skip all permissions | Adds `--dangerously-skip-permissions` flag |
| Plan Mode | Think before acting | (Future: sends `/plan` prefix) |
| Auto-Edit | Auto-allow file edits | Auto-responds `y` to Edit tool requests |

- Toggle states stored in localStorage (per-project)
- Active modes shown as indicators in top bar

## Session Management

- Sessions persist when navigating back to Launch Pad
- Active sessions show green dot on project card
- `[Resume]` returns to terminal view
- `[Kill & Restart]` sends Ctrl+C then returns to agent selection
- Multiple projects can have active sessions simultaneously

## Data Storage (localStorage)

| Key | Value |
|---|---|
| `agentrune_recent_{projectId}` | Array of recent commands (max 10) |
| `agentrune_settings_{projectId}` | `{ model, bypass, planMode, autoEdit }` |
| `agentrune_last_project` | Last selected project ID |
| `agentrune_device_id` | Auth device ID |
| `agentrune_device_token` | Auth device token |

## Idle Detection

```
function isIdle(term):
  lastLine = term.buffer.active.getLine(cursorY).translateToString().trim()
  return /[$%>]\s*$/.test(lastLine)
```

Also fallback: 500ms timer after last output with non-empty last line.

## Out of Scope (future)

- Voice input
- Clipboard sync between phone and PC
- Multi-terminal split view
- Plugin system for custom agents
- Notification when long-running command finishes
