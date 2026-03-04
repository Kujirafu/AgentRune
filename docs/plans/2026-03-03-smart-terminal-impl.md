# AgentRune Smart Terminal — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform AgentRune from a raw xterm.js terminal into a mobile-first AI coding launcher with touch-friendly interactions.

**Architecture:** Frontend-only refactor. Break monolithic `web/App.tsx` into components. Add server endpoint for project scripts. Keep existing auth/WS/PTY backend unchanged.

**Tech Stack:** React 19, xterm.js, Vite, TypeScript, Express (server-side, minimal changes)

**Design doc:** `docs/plans/2026-03-03-smart-terminal-design.md`

---

### Task 1: Server — Add project scripts endpoint

**Files:**
- Modify: `server/index.ts` (add 1 endpoint, ~15 lines)

**Step 1: Add endpoint**

In `server/index.ts`, after the existing `/api/projects` endpoint, add:

```typescript
app.get("/api/projects/:id/scripts", (req, res) => {
  const project = projects.find((p) => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: "Project not found" })

  const pkgPath = join(project.cwd, "package.json")
  if (!existsSync(pkgPath)) return res.json({ scripts: {} })

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    res.json({ scripts: pkg.scripts || {} })
  } catch {
    res.json({ scripts: {} })
  }
})
```

**Step 2: Test manually**

```bash
curl http://localhost:3456/api/projects/agentlore/scripts
```

Expected: `{ "scripts": { "dev": "next dev", "build": "next build", ... } }`

**Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: add project scripts API endpoint"
```

---

### Task 2: Create shared lib files

**Files:**
- Create: `web/lib/storage.ts`
- Create: `web/lib/detect.ts`
- Create: `web/lib/types.ts`

**Step 1: Create `web/lib/types.ts`**

```typescript
export interface Project {
  id: string
  name: string
  cwd: string
}

export interface AgentDef {
  id: string
  name: string
  description: string
  icon: string
  command: (settings: ProjectSettings) => string | null
}

export interface ProjectSettings {
  model: "sonnet" | "opus" | "haiku"
  bypass: boolean
  planMode: boolean
  autoEdit: boolean
}

export interface SmartAction {
  label: string
  input: string
  style: "primary" | "danger" | "default"
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  model: "sonnet",
  bypass: false,
  planMode: false,
  autoEdit: false,
}

export const AGENTS: AgentDef[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "AI coding assistant",
    icon: "\u{1F916}",
    command: (s) => {
      let cmd = "claude"
      if (s.model !== "sonnet") cmd += ` --model ${s.model}`
      if (s.bypass) cmd += " --dangerously-skip-permissions"
      return cmd
    },
  },
  {
    id: "codex",
    name: "Codex CLI",
    description: "OpenAI code agent",
    icon: "\u26A1",
    command: () => "codex",
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "Plain shell",
    icon: ">_",
    command: () => null, // No command, just attach
  },
]
```

**Step 2: Create `web/lib/storage.ts`**

```typescript
import { ProjectSettings, DEFAULT_SETTINGS } from "./types"

export function getSettings(projectId: string): ProjectSettings {
  try {
    const raw = localStorage.getItem(`agentrune_settings_${projectId}`)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(projectId: string, settings: ProjectSettings) {
  localStorage.setItem(`agentrune_settings_${projectId}`, JSON.stringify(settings))
}

export function getRecentCommands(projectId: string): string[] {
  try {
    const raw = localStorage.getItem(`agentrune_recent_${projectId}`)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function addRecentCommand(projectId: string, cmd: string) {
  const trimmed = cmd.trim()
  if (!trimmed || trimmed.length < 2) return
  const recent = getRecentCommands(projectId)
  const filtered = recent.filter((r) => r !== trimmed)
  filtered.unshift(trimmed)
  localStorage.setItem(`agentrune_recent_${projectId}`, JSON.stringify(filtered.slice(0, 10)))
}

export function getLastProject(): string | null {
  return localStorage.getItem("agentrune_last_project")
}

export function saveLastProject(projectId: string) {
  localStorage.setItem("agentrune_last_project", projectId)
}
```

**Step 3: Create `web/lib/detect.ts`**

```typescript
import type { Terminal as XTerm } from "@xterm/xterm"
import type { SmartAction } from "./types"

export function isIdle(term: XTerm | null): boolean {
  if (!term) return false
  const buf = term.buffer.active
  const line = buf.getLine(buf.cursorY)?.translateToString()?.trim() || ""
  return /[$%>]\s*$/.test(line)
}

export function detectPromptActions(term: XTerm | null): SmartAction[] {
  if (!term) return []

  const buf = term.buffer.active
  const lines: string[] = []
  for (let i = Math.max(0, buf.cursorY - 5); i <= buf.cursorY; i++) {
    const line = buf.getLine(i)?.translateToString()?.trim()
    if (line) lines.push(line)
  }
  const text = lines.join("\n")

  // Claude Code: Allow tool? (y/n/a)
  if (/\(y\/n\/a\)/.test(text) || (/allow/i.test(text) && /\(y\/n\)/.test(text))) {
    return [
      { label: "\u2705 Allow this once", input: "y", style: "primary" },
      { label: "\u2705 Always allow", input: "a", style: "primary" },
      { label: "\u274C Deny", input: "n", style: "danger" },
    ]
  }

  // Generic Y/n
  if (/\[Y\/n\]|\(y\/N\)|\(yes\/no\)|\[y\/N\]/i.test(text)) {
    return [
      { label: "Yes", input: "y\n", style: "primary" },
      { label: "No", input: "n\n", style: "danger" },
    ]
  }

  // Numbered options: 1) foo  2) bar
  const numberOpts = text.match(/^\s*(\d)\)\s+.+/gm)
  if (numberOpts && numberOpts.length >= 2) {
    return numberOpts.slice(0, 6).map((line) => {
      const m = line.match(/^\s*(\d)\)\s+(.+)/)
      return {
        label: m ? `${m[1]}. ${m[2].slice(0, 30)}` : line.slice(0, 30),
        input: (m?.[1] || "") + "\n",
        style: "default" as const,
      }
    })
  }

  // Press Enter to continue
  if (/press enter|hit enter|press return/i.test(text)) {
    return [{ label: "Continue \u21B5", input: "\n", style: "primary" }]
  }

  return []
}

export const isMobile =
  typeof navigator !== "undefined" &&
  /iPhone|iPad|iPod|Android|webOS|Mobile/i.test(navigator.userAgent)
```

**Step 4: Commit**

```bash
git add web/lib/
git commit -m "feat: add shared types, storage, and detection utilities"
```

---

### Task 3: LaunchPad component

**Files:**
- Create: `web/components/LaunchPad.tsx`

**Step 1: Build the component**

Two panels:
- Top: horizontal scrollable project cards (from props). Selected has border highlight. Active sessions show green dot + `[Resume]` / `[Kill]`. `[+ New]` button at end.
- Bottom: vertical agent cards (from `AGENTS` constant). Tapping sends attach + command.

Key props:
```typescript
interface LaunchPadProps {
  projects: Project[]
  activeSessions: Map<string, string> // projectId → agentId
  onLaunch: (projectId: string, agentId: string) => void
  onResume: (projectId: string) => void
  onKill: (projectId: string) => void
  onNewProject: (name: string, cwd: string) => void
}
```

Styling: dark theme matching existing AgentRune (`#0f172a` background, glassmorphism cards).

**Step 2: Test visually**

Open in browser, verify:
- Projects render horizontally, scrollable
- Tapping project highlights it
- Tapping agent triggers `onLaunch`
- Active session shows Resume/Kill

**Step 3: Commit**

```bash
git add web/components/LaunchPad.tsx
git commit -m "feat: add LaunchPad component with project + agent selection"
```

---

### Task 4: SettingsSheet component

**Files:**
- Create: `web/components/SettingsSheet.tsx`

**Step 1: Build the component**

Bottom sheet overlay with:
- Model selection: 3 horizontal toggle buttons (Sonnet/Opus/Haiku)
- Mode toggles: Bypass, Plan Mode, Auto-Edit (each a toggle switch)
- Close button (✕)
- Backdrop click to close

Key props:
```typescript
interface SettingsSheetProps {
  open: boolean
  settings: ProjectSettings
  onChange: (settings: ProjectSettings) => void
  onClose: () => void
}
```

**Step 2: Commit**

```bash
git add web/components/SettingsSheet.tsx
git commit -m "feat: add SettingsSheet with model selection and mode toggles"
```

---

### Task 5: SmartSuggestions component

**Files:**
- Create: `web/components/SmartSuggestions.tsx`

**Step 1: Build the component**

Vertical list of full-width cards. Two modes controlled by parent:

```typescript
interface SmartSuggestionsProps {
  // Mode A: prompt responses (from detectPromptActions)
  actions: SmartAction[]
  // Mode B: idle command suggestions
  idleSuggestions: { label: string; description?: string; command: string }[]
  // Which mode
  mode: "prompt" | "idle" | "hidden"
  onAction: (input: string) => void
}
```

Card styling:
- `primary`: blue border, blue tinted bg
- `danger`: red border, red tinted bg
- `default`: white/10 border
- Idle suggestions: icon + command + optional description

**Step 2: Commit**

```bash
git add web/components/SmartSuggestions.tsx
git commit -m "feat: add SmartSuggestions component with vertical card layout"
```

---

### Task 6: QuickActions and InputBar components

**Files:**
- Create: `web/components/QuickActions.tsx`
- Create: `web/components/InputBar.tsx`

**Step 1: QuickActions**

Horizontal scrollable pill buttons:

```typescript
const ACTIONS = [
  { label: "■", title: "Stop", seq: "\x03" },
  { label: "Tab", title: "Tab", seq: "\t" },
  { label: "↑", title: "Previous", seq: "\x1b[A" },
  { label: "↓", title: "Next", seq: "\x1b[B" },
  { label: "↩", title: "Undo", seq: "\x1a" },
  { label: "⌧", title: "Clear", seq: "\x0c" },
  { label: "⏏", title: "Exit", seq: "\x04" },
]
```

Props: `onAction: (seq: string) => void`

**Step 2: InputBar**

Chat-style input with send button. Props:

```typescript
interface InputBarProps {
  onSend: (text: string) => void
  inputRef?: React.RefObject<HTMLInputElement>
}
```

- Monospace font, dark theme
- Send button changes color when input has text
- `autoComplete="off"`, `autoCapitalize="off"`, `spellCheck=false`
- Enter key sends, Ctrl+C sends interrupt
- safe-area-inset-bottom for iPhone

**Step 3: Commit**

```bash
git add web/components/QuickActions.tsx web/components/InputBar.tsx
git commit -m "feat: add QuickActions and InputBar components"
```

---

### Task 7: TerminalView component

**Files:**
- Create: `web/components/TerminalView.tsx`

**Step 1: Build the component**

Integrates all pieces. This is the main screen after launching an agent.

```typescript
interface TerminalViewProps {
  project: Project
  agentId: string
  sessionToken: string
  send: (msg: Record<string, unknown>) => void
  on: (type: string, handler: (msg: Record<string, unknown>) => void) => void
  onBack: () => void
}
```

Layout (flex column, 100dvh):
1. Top bar: `← project.name · agentName [⚡ if bypass] [🎛]`
2. xterm.js container (flex: 1)
3. SmartSuggestions (conditional)
4. QuickActions
5. InputBar

Logic:
- Init xterm.js on mount (same as current code)
- On output: write to xterm + run `detectPromptActions` + check `isIdle`
- If prompt detected → SmartSuggestions mode="prompt"
- If idle → fetch project scripts + recent commands → mode="idle"
- If running (neither) → mode="hidden"
- Track recent commands: when user sends from InputBar, call `addRecentCommand`
- 🎛 button opens SettingsSheet overlay

**Step 2: Test visually**

Run AgentRune, connect from phone, verify:
- Terminal renders with output
- Smart suggestions appear on prompts
- Idle suggestions appear when shell is idle
- Quick actions and input bar work

**Step 3: Commit**

```bash
git add web/components/TerminalView.tsx
git commit -m "feat: add TerminalView component with smart suggestions"
```

---

### Task 8: Rewrite App.tsx as router

**Files:**
- Modify: `web/App.tsx` (major rewrite)

**Step 1: Rewrite**

App.tsx becomes a thin router between LaunchPad and TerminalView:

```typescript
type Screen = "launchpad" | "terminal"

export function App() {
  const auth = useAuth()
  const [screen, setScreen] = useState<Screen>("launchpad")
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [activeSessions, setActiveSessions] = useState<Map<string, string>>(new Map())
  const { connect, send, on } = useWs()

  // Auth gates (keep existing)
  if (auth.status === "checking") return <CheckingScreen />
  if (auth.status === "need-auth" || auth.status === "need-setup")
    return <AuthScreen ... />

  // Connect WS once after auth
  // Load projects once after auth

  if (screen === "launchpad") {
    return <LaunchPad
      projects={projects}
      activeSessions={activeSessions}
      onLaunch={(projectId, agentId) => {
        setActiveProjectId(projectId)
        setActiveAgentId(agentId)
        setScreen("terminal")
        // attach + send agent command handled by TerminalView
      }}
      onResume={(projectId) => {
        setActiveProjectId(projectId)
        setScreen("terminal")
      }}
      onKill={...}
      onNewProject={...}
    />
  }

  return <TerminalView
    project={projects.find(p => p.id === activeProjectId)!}
    agentId={activeAgentId!}
    sessionToken={auth.sessionToken}
    send={send}
    on={on}
    onBack={() => setScreen("launchpad")}
  />
}
```

Keep in App.tsx: `useAuth`, `useWs`, `AuthScreen`, `CheckingScreen` (or extract to own files).

**Step 2: Verify full flow**

1. Open AgentRune → see Launch Pad
2. Select project → select Claude Code → terminal opens
3. Smart suggestions work during AI interaction
4. Tap ← → back to Launch Pad, session shows green dot
5. Tap Resume → back to terminal with scrollback

**Step 3: Commit**

```bash
git add web/App.tsx web/components/
git commit -m "feat: rewrite App as LaunchPad ↔ TerminalView router"
```

---

### Task 9: New project creation

**Files:**
- Modify: `server/index.ts` (add POST endpoint)
- Modify: `web/components/LaunchPad.tsx` (add form)

**Step 1: Server endpoint**

```typescript
app.post("/api/projects", (req, res) => {
  const { name, cwd } = req.body
  if (!name || !cwd) return res.status(400).json({ error: "Missing name or cwd" })

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  if (projects.find((p) => p.id === id)) return res.status(409).json({ error: "Project exists" })

  const project = { id, name, cwd }
  projects.push(project)

  // Persist to projects.json
  writeFileSync(join(process.cwd(), "projects.json"), JSON.stringify(projects, null, 2))
  res.json(project)
})
```

**Step 2: LaunchPad inline form**

`[+ New]` button expands to two fields (name, path) + confirm button. On confirm, POST to `/api/projects`, then refresh list.

**Step 3: Commit**

```bash
git add server/index.ts web/components/LaunchPad.tsx
git commit -m "feat: add new project creation from LaunchPad"
```

---

### Task 10: Build, test end-to-end, and push

**Step 1: Build**

```bash
cd C:\Users\agres\Documents\Test\AgentRune
npm run build
```

**Step 2: Start server and test on phone**

```bash
npm run start:pair
```

Test flow on phone:
- [ ] Launch Pad shows all projects
- [ ] Select project, select Claude Code → terminal opens
- [ ] Smart suggestions appear for Allow/Deny prompts
- [ ] Idle state shows command suggestions (npm scripts, recent, git)
- [ ] Quick actions (Stop, Tab, arrows) work
- [ ] Input bar sends commands
- [ ] Settings: model selection, bypass toggle work
- [ ] ← back to Launch Pad, session persists (green dot)
- [ ] Resume returns to terminal with scrollback
- [ ] + New project works

**Step 3: Final commit and push**

```bash
git add -A
git commit -m "feat: AgentRune Smart Terminal — mobile-first AI coding launcher"
git push
```
