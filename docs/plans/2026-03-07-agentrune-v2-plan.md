# AgentRune v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform AgentRune from "terminal on phone" to a command-driven multi-agent collaboration platform where users give instructions and receive structured results.

**Architecture:** MCP `report_progress` tool as the gate keeper — agents must call it to report work. CLI intercepts idle agents and prompts them. APP renders structured ProgressCards instead of raw event streams. Worktree isolation enables parallel sessions.

**Tech Stack:** Node.js TypeScript CLI (MCP SDK, node-pty, ws), React Capacitor APP, AgentLore API

---

## Phase 1: MCP Gate Keeper + Structured Results

### Task 1: Add ProgressReport type to shared types

**Files:**
- Modify: `cli/src/shared/types.ts`
- Modify: `app/src/types.ts`

**Step 1: Add ProgressReport interface and new event type to CLI shared types**

In `cli/src/shared/types.ts`, add after the `SessionSummary` interface (line 48):

```typescript
export interface ProgressReport {
  title: string
  status: "done" | "blocked" | "in_progress"
  filesChanged: number
  linesAdded: number
  linesRemoved: number
  testResults?: {
    total: number
    passed: number
    failed: number
  }
  nextSteps: string[]
  details?: string
}
```

And add `"progress_report"` to the `AgentEvent.type` union (after `"session_summary"`):

```typescript
    | "progress_report"
```

And add the optional field to `AgentEvent`:

```typescript
  progress?: ProgressReport
```

**Step 2: Mirror the same changes in APP types**

In `app/src/types.ts`, add the same `ProgressReport` interface after line 130 (TaskStore), and add `"progress_report"` to the `AgentEvent.type` union, and add `progress?: ProgressReport` to `AgentEvent`.

**Step 3: Verify build**

Run:
```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
cd /c/Users/agres/Documents/Test/AgentRune-New/app && npx tsc --noEmit
```
Expected: no errors

**Step 4: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/shared/types.ts app/src/types.ts
git commit -m "feat: add ProgressReport type and progress_report event type"
```

---

### Task 2: Add `report_progress` MCP tool

**Files:**
- Modify: `cli/src/mcp/stdio-server.ts`

**Context:** The MCP server runs as a stdio subprocess spawned by the agent (e.g. Claude Code adds it as an MCP server). When the agent calls `report_progress`, the MCP server validates the input, then POSTs the structured data to the local ws-server HTTP API so it can be forwarded to the APP.

**Step 1: Add report_progress tool to MCP server**

In `cli/src/mcp/stdio-server.ts`, add after the `get_clipboard` tool (before the `// --- Start ---` comment at line 190):

```typescript
  server.tool(
    "report_progress",
    "REQUIRED: Report your work progress to the user. Call this after completing a task or reaching a milestone. The user's APP will display a structured summary card based on your report.",
    {
      title: z.string().describe("Short title of what was accomplished (e.g. 'API endpoint refactored')"),
      status: z.enum(["done", "blocked", "in_progress"]).describe("Current status of the work"),
      filesChanged: z.number().describe("Number of files modified/created"),
      linesAdded: z.number().describe("Approximate lines added"),
      linesRemoved: z.number().describe("Approximate lines removed"),
      testResults: z.object({
        total: z.number(),
        passed: z.number(),
        failed: z.number(),
      }).optional().describe("Test results if tests were run"),
      nextSteps: z.array(z.string()).describe("Suggested next actions for the user"),
      details: z.string().optional().describe("Detailed explanation (shown in expandable panel)"),
    },
    async ({ title, status, filesChanged, linesAdded, linesRemoved, testResults, nextSteps, details }) => {
      const report = { title, status, filesChanged, linesAdded, linesRemoved, testResults, nextSteps, details }

      // POST to local ws-server so it can broadcast to connected APP clients
      const config = loadConfig()
      try {
        await fetch(`http://localhost:${config.port}/api/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(report),
        })
      } catch {
        // ws-server may not be running — still return success to agent
      }

      return {
        content: [{
          type: "text" as const,
          text: `Progress reported successfully. The user will see a structured summary card in their APP.\n\nTitle: ${title}\nStatus: ${status}\nFiles: ${filesChanged} changed (+${linesAdded}/-${linesRemoved})${testResults ? `\nTests: ${testResults.passed}/${testResults.total} passed` : ""}\nNext steps: ${nextSteps.join(", ")}`,
        }],
      }
    }
  )
```

Also update the server instructions (line 41-54) to include report_progress:

```typescript
    instructions: `AgentRune MCP server — proxies AgentLore knowledge base tools + local device tools.

IMPORTANT: After completing any task or reaching a milestone, you MUST call report_progress
to notify the user. The user monitors your work from a mobile APP and can only see structured
progress reports — they cannot see your raw terminal output.

## Progress Reporting (REQUIRED)
- report_progress: Report work progress to the user (MUST call after completing tasks)

## AgentLore Tools
- search: Search the AI-verified knowledge base for solutions
- get_entry: Get full details of a knowledge entry
- find_skills: Find reusable skills/patterns for your task
- report_skill_outcome: Report whether a skill worked
- submit_knowledge: Submit new knowledge to the database
- list_domains: List available knowledge domains

## Local Tools
- list_sessions: List active PTY sessions on this device
- run_command: Run a shell command on the local machine
- get_clipboard: Read the system clipboard`,
```

**Step 2: Verify build**

Run:
```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
```
Expected: no errors

**Step 3: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/mcp/stdio-server.ts
git commit -m "feat: add report_progress MCP tool with ws-server notification"
```

---

### Task 3: ws-server receives progress reports and broadcasts to APP

**Files:**
- Modify: `cli/src/server/ws-server.ts`

**Context:** The ws-server has an Express HTTP server (variable `app`) and WebSocket server. We need to add a `POST /api/progress` endpoint that receives progress reports from the MCP server and broadcasts them as `progress_report` events to all connected APP clients.

**Step 1: Find the HTTP routes section in ws-server.ts**

Search for existing `app.get` or `app.post` routes. Add the new route near them.

**Step 2: Add POST /api/progress endpoint**

Add this route alongside the other API routes:

```typescript
  app.post("/api/progress", express.json(), (req, res) => {
    const report = req.body
    if (!report || !report.title || !report.status) {
      res.status(400).json({ error: "Missing required fields: title, status" })
      return
    }

    const event: AgentEvent = {
      id: `progress_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      type: "progress_report",
      status: report.status === "done" ? "completed" : report.status === "blocked" ? "failed" : "in_progress",
      title: report.title,
      detail: report.details,
      progress: {
        title: report.title,
        status: report.status,
        filesChanged: report.filesChanged || 0,
        linesAdded: report.linesAdded || 0,
        linesRemoved: report.linesRemoved || 0,
        testResults: report.testResults,
        nextSteps: report.nextSteps || [],
        details: report.details,
      },
    }

    // Broadcast to ALL connected clients (progress is project-wide, not session-specific)
    for (const [client] of clientSessions) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "event", event }))
      }
    }

    res.json({ ok: true })
  })
```

**Note:** Make sure `ProgressReport` is imported in the types import at the top of ws-server.ts (it's part of AgentEvent already since we added the `progress` field).

**Step 3: Verify build**

Run:
```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/server/ws-server.ts
git commit -m "feat: add POST /api/progress endpoint for MCP → APP progress broadcast"
```

---

### Task 4: ProgressCard APP component

**Files:**
- Create: `app/src/components/ProgressCard.tsx`
- Modify: `app/src/components/MissionControl.tsx`

**Context:** This replaces EventCard as the primary display for progress_report events. Design: clean white card with status badge, metrics row, next steps list, expandable details panel.

**Step 1: Create ProgressCard component**

Create `app/src/components/ProgressCard.tsx`:

```tsx
import { useState } from "react"
import type { AgentEvent, ProgressReport } from "../types"
import { useLocale } from "../lib/i18n/index.js"

interface ProgressCardProps {
  event: AgentEvent
  onNextStep?: (step: string) => void
}

const STATUS_CONFIG = {
  done: { label: "Done", bg: "rgba(74,222,128,0.15)", border: "rgba(74,222,128,0.4)", text: "#22c55e" },
  blocked: { label: "Blocked", bg: "rgba(248,113,113,0.15)", border: "rgba(248,113,113,0.4)", text: "#ef4444" },
  in_progress: { label: "Working", bg: "rgba(96,165,250,0.15)", border: "rgba(96,165,250,0.4)", text: "#3b82f6" },
} as const

export function ProgressCard({ event, onNextStep }: ProgressCardProps) {
  const [expanded, setExpanded] = useState(false)
  const p = event.progress
  if (!p) return null

  const cfg = STATUS_CONFIG[p.status]

  return (
    <div style={{
      background: "rgba(255,255,255,0.06)",
      borderRadius: 12,
      border: `1px solid ${cfg.border}`,
      padding: 16,
      marginBottom: 12,
    }}>
      {/* Header: status badge + title */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{
          background: cfg.bg,
          color: cfg.text,
          padding: "2px 10px",
          borderRadius: 12,
          fontSize: 12,
          fontWeight: 600,
        }}>
          {cfg.label}
        </span>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{p.title}</span>
      </div>

      {/* Metrics row */}
      <div style={{
        display: "flex",
        gap: 16,
        fontSize: 13,
        color: "rgba(255,255,255,0.6)",
        marginBottom: 12,
      }}>
        <span>{p.filesChanged} files</span>
        <span style={{ color: "#22c55e" }}>+{p.linesAdded}</span>
        <span style={{ color: "#ef4444" }}>-{p.linesRemoved}</span>
        {p.testResults && (
          <span style={{ color: p.testResults.failed > 0 ? "#ef4444" : "#22c55e" }}>
            Tests {p.testResults.passed}/{p.testResults.total}
          </span>
        )}
      </div>

      {/* Next steps */}
      {p.nextSteps.length > 0 && (
        <div style={{ marginBottom: expanded ? 12 : 0 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>
            Next steps
          </div>
          {p.nextSteps.map((step, i) => (
            <button
              key={i}
              onClick={() => onNextStep?.(step)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "rgba(59,130,246,0.1)",
                border: "1px solid rgba(59,130,246,0.2)",
                borderRadius: 8,
                padding: "8px 12px",
                marginBottom: 4,
                color: "#93c5fd",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {step}
            </button>
          ))}
        </div>
      )}

      {/* Expand/collapse details */}
      {p.details && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.4)",
              fontSize: 12,
              cursor: "pointer",
              padding: "4px 0",
            }}
          >
            {expanded ? "Hide details" : "Show details"}
          </button>
          {expanded && (
            <div style={{
              marginTop: 8,
              padding: 12,
              background: "rgba(0,0,0,0.2)",
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.7)",
              whiteSpace: "pre-wrap",
            }}>
              {p.details}
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

**Step 2: Integrate ProgressCard into MissionControl**

In `app/src/components/MissionControl.tsx`:

1. Add import at the top:
```typescript
import { ProgressCard } from "./ProgressCard"
```

2. In the events rendering section (where `EventCard` is rendered), add a check: if `event.type === "progress_report"`, render `ProgressCard` instead of `EventCard`:

```tsx
{event.type === "progress_report" ? (
  <ProgressCard
    key={event.id}
    event={event}
    onNextStep={(step) => handleSend(step)}
  />
) : (
  <EventCard
    key={event.id}
    event={event}
    onDecision={...}
    ...
  />
)}
```

**Step 3: Verify build**

Run:
```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/app && npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add app/src/components/ProgressCard.tsx app/src/components/MissionControl.tsx
git commit -m "feat: add ProgressCard component for structured result display"
```

---

### Task 5: PTY idle detection + inject MCP prompt

**Files:**
- Create: `cli/src/server/progress-interceptor.ts`
- Modify: `cli/src/server/ws-server.ts`

**Context:** When the agent finishes work (idle detected) but hasn't called `report_progress`, the CLI injects a reminder prompt into the PTY. This is the enforcement mechanism that makes MCP gate keeping work regardless of which agent is running.

**Step 1: Create progress-interceptor module**

Create `cli/src/server/progress-interceptor.ts`:

```typescript
// server/progress-interceptor.ts
// Monitors agent sessions and injects report_progress prompts when agent is idle

const IDLE_THRESHOLD_MS = 15_000  // 15 seconds of idle before prompting
const PROMPT_COOLDOWN_MS = 120_000  // Don't re-prompt within 2 minutes

interface SessionState {
  lastProgressReport: number   // timestamp of last report_progress received
  lastPromptInjected: number   // timestamp of last prompt injection
  lastActivityTime: number     // timestamp of last PTY output
  hasNewWork: boolean          // whether agent has done work since last report
}

export class ProgressInterceptor {
  private sessions = new Map<string, SessionState>()

  /** Called when a session starts */
  trackSession(sessionId: string): void {
    this.sessions.set(sessionId, {
      lastProgressReport: Date.now(),
      lastPromptInjected: 0,
      lastActivityTime: Date.now(),
      hasNewWork: false,
    })
  }

  /** Called when session ends */
  untrackSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /** Called on every PTY data event — tracks activity and work detection */
  onData(sessionId: string, hasToolEvents: boolean): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.lastActivityTime = Date.now()
    if (hasToolEvents) {
      state.hasNewWork = true
    }
  }

  /** Called when report_progress is received from MCP */
  onProgressReport(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.lastProgressReport = Date.now()
    state.hasNewWork = false
  }

  /** Check if we should inject a prompt for a given session.
   *  Returns the prompt text to inject, or null if no injection needed. */
  checkInjection(sessionId: string, isIdle: boolean): string | null {
    const state = this.sessions.get(sessionId)
    if (!state) return null

    const now = Date.now()

    // Conditions for injection:
    // 1. Agent is idle
    // 2. Agent has done work since last report
    // 3. Enough time has passed since last activity (agent is truly done, not just pausing)
    // 4. Not within cooldown of last prompt
    if (
      isIdle &&
      state.hasNewWork &&
      (now - state.lastActivityTime) >= IDLE_THRESHOLD_MS &&
      (now - state.lastPromptInjected) >= PROMPT_COOLDOWN_MS
    ) {
      state.lastPromptInjected = now
      return "Please call the report_progress MCP tool to report what you just accomplished. The user is monitoring from their phone and can only see structured progress reports."
    }

    return null
  }
}
```

**Step 2: Integrate into ws-server**

In `cli/src/server/ws-server.ts`:

1. Import at the top:
```typescript
import { ProgressInterceptor } from "./progress-interceptor.js"
```

2. Create instance alongside other managers:
```typescript
const progressInterceptor = new ProgressInterceptor()
```

3. In the session creation handler (where `sessions.create()` is called), add:
```typescript
progressInterceptor.trackSession(sessionId)
```

4. In the session exit handler, add:
```typescript
progressInterceptor.untrackSession(sessionId)
```

5. In the `POST /api/progress` handler (from Task 3), after broadcasting the event, add:
```typescript
// Mark progress reported for all sessions (MCP doesn't know which session it's from)
// In practice, there's usually one active session per project
for (const [sid] of clientSessions.values()) {
  progressInterceptor.onProgressReport(sid)
}
```

6. In the PTY `data` event handler (where `engine.feed(data)` is called), after processing events, add:
```typescript
// Track activity for progress interception
const hasToolEvents = events.some(e =>
  e.type === "file_edit" || e.type === "file_create" || e.type === "command_run"
)
progressInterceptor.onData(sessionId, hasToolEvents)

// Check if we should inject a report_progress prompt
const isIdle = engine?.isIdle() ?? false
const injectionPrompt = progressInterceptor.checkInjection(sessionId, isIdle)
if (injectionPrompt) {
  sessions.write(sessionId, injectionPrompt + "\n")
}
```

**Step 3: Verify build**

Run:
```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/server/progress-interceptor.ts cli/src/server/ws-server.ts
git commit -m "feat: add progress interceptor — inject report_progress prompt on idle agents"
```

---

## Phase 2: Multi-Session Worktree Isolation

### Task 6: Worktree manager

**Files:**
- Create: `cli/src/server/worktree-manager.ts`

**Context:** Each agent session runs in an isolated git worktree. This module handles creating, listing, merging, and cleaning up worktrees.

**Step 1: Create worktree-manager module**

Create `cli/src/server/worktree-manager.ts`:

```typescript
// server/worktree-manager.ts
// Manages git worktrees for session isolation
import { execSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { join, basename } from "node:path"

export interface Worktree {
  path: string
  branch: string
  sessionId?: string
  createdAt: number
}

export class WorktreeManager {
  private projectCwd: string
  private worktrees = new Map<string, Worktree>()

  constructor(projectCwd: string) {
    this.projectCwd = projectCwd
  }

  /** Create a new worktree for a session */
  create(sessionId: string, taskSlug?: string): Worktree {
    const existing = this.worktrees.get(sessionId)
    if (existing) return existing

    const date = new Date().toISOString().slice(0, 10)
    const slug = taskSlug || sessionId.slice(0, 8)
    const branch = `agentrune/${date}-${slug}`
    const worktreeDir = join(this.projectCwd, ".worktrees", `${date}-${slug}`)

    mkdirSync(join(this.projectCwd, ".worktrees"), { recursive: true })

    // Create branch from current HEAD
    try {
      execSync(`git worktree add -b "${branch}" "${worktreeDir}"`, {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
    } catch (err) {
      // Branch might already exist — try without -b
      execSync(`git worktree add "${worktreeDir}" "${branch}"`, {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
    }

    const wt: Worktree = {
      path: worktreeDir,
      branch,
      sessionId,
      createdAt: Date.now(),
    }
    this.worktrees.set(sessionId, wt)
    return wt
  }

  /** Get worktree for a session */
  get(sessionId: string): Worktree | undefined {
    return this.worktrees.get(sessionId)
  }

  /** List all managed worktrees */
  list(): Worktree[] {
    return [...this.worktrees.values()]
  }

  /** Merge worktree branch back to main and clean up */
  merge(sessionId: string, targetBranch: string = "main"): { success: boolean; message: string } {
    const wt = this.worktrees.get(sessionId)
    if (!wt) return { success: false, message: "Worktree not found" }

    try {
      // Merge the worktree branch into target
      execSync(`git merge "${wt.branch}" --no-edit`, {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
      this.cleanup(sessionId)
      return { success: true, message: `Merged ${wt.branch} into ${targetBranch}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Merge failed"
      return { success: false, message: msg }
    }
  }

  /** Remove worktree and branch */
  cleanup(sessionId: string): void {
    const wt = this.worktrees.get(sessionId)
    if (!wt) return

    try {
      execSync(`git worktree remove "${wt.path}" --force`, {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
    } catch { /* worktree may already be removed */ }

    try {
      execSync(`git branch -D "${wt.branch}"`, {
        cwd: this.projectCwd,
        encoding: "utf-8",
        stdio: "pipe",
      })
    } catch { /* branch may already be removed */ }

    this.worktrees.delete(sessionId)
  }
}
```

**Step 2: Verify build**

Run:
```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
```

**Step 3: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/server/worktree-manager.ts
git commit -m "feat: add WorktreeManager for session-isolated git worktrees"
```

---

### Task 7: Integrate worktree into session creation

**Files:**
- Modify: `cli/src/server/ws-server.ts`
- Modify: `cli/src/server/pty-manager.ts`

**Context:** When the APP creates a new agent session, ws-server should optionally create a worktree and start the agent PTY inside it. The APP sends `{ type: "create_session", projectId, agentId, isolated: true, taskSlug: "fix-api" }`.

**Step 1: Add worktree support to session creation in ws-server**

In ws-server.ts:

1. Import WorktreeManager:
```typescript
import { WorktreeManager } from "./worktree-manager.js"
```

2. Create a map of worktree managers per project:
```typescript
const worktreeManagers = new Map<string, WorktreeManager>()
```

3. In the `create_session` message handler, check for `isolated` flag:
```typescript
case "create_session": {
  const project = projects.find(p => p.id === msg.projectId)
  if (!project) break

  let sessionCwd = project.cwd

  // If isolated session requested, create worktree
  if (msg.isolated) {
    let wtm = worktreeManagers.get(project.id)
    if (!wtm) {
      wtm = new WorktreeManager(project.cwd)
      worktreeManagers.set(project.id, wtm)
    }
    const wt = wtm.create(sessionId, msg.taskSlug as string)
    sessionCwd = wt.path
  }

  // Create session with worktree cwd
  const sessionProject = { ...project, cwd: sessionCwd }
  const session = sessions.create(sessionProject, msg.agentId as string)
  // ... rest of session setup
  break
}
```

4. Add `merge_worktree` and `discard_worktree` message handlers:
```typescript
case "merge_worktree": {
  const sid = msg.sessionId as string
  const session = sessions.get(sid)
  if (!session) break
  const wtm = worktreeManagers.get(session.project.id)
  if (!wtm) break
  const result = wtm.merge(sid)
  ws.send(JSON.stringify({ type: "worktree_result", ...result }))
  break
}

case "discard_worktree": {
  const sid = msg.sessionId as string
  const session = sessions.get(sid)
  if (!session) break
  const wtm = worktreeManagers.get(session.project.id)
  if (!wtm) break
  wtm.cleanup(sid)
  ws.send(JSON.stringify({ type: "worktree_result", success: true, message: "Worktree discarded" }))
  break
}
```

**Step 2: Add HTTP endpoints for worktree listing**

```typescript
app.get("/api/worktrees/:projectId", (req, res) => {
  const wtm = worktreeManagers.get(req.params.projectId)
  if (!wtm) { res.json([]); return }
  res.json(wtm.list())
})
```

**Step 3: Verify build**

Run:
```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/server/ws-server.ts
git commit -m "feat: integrate worktree isolation into session creation"
```

---

### Task 8: Multi-session APP UI

**Files:**
- Modify: `app/src/components/MissionControl.tsx`
- Modify: `app/src/components/LaunchPad.tsx`

**Context:** The APP should show multiple active sessions as cards. Each session card shows: agent icon, task slug/label, status (working/idle/done), last progress report title. Tapping a card enters that session's result view.

**Step 1: Add session card to LaunchPad**

In `app/src/components/LaunchPad.tsx`, add a "Active Sessions" section that shows cards for each `activeSessions` entry. Each card has:
- Agent name (from AGENTS lookup by agentId)
- Session label (from localStorage or task slug)
- Status dot (green=working, yellow=idle, gray=done)
- Last event title (if available)
- "New Isolated Session" button that sends `{ type: "create_session", isolated: true }`

**Step 2: Add worktree controls to MissionControl**

In `app/src/components/MissionControl.tsx`, when the current session has a worktree, show action buttons at the bottom:
- "Merge to main" → sends `{ type: "merge_worktree", sessionId }`
- "Discard" → sends `{ type: "discard_worktree", sessionId }`

**Step 3: Verify build**

Run:
```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/app && npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add app/src/components/LaunchPad.tsx app/src/components/MissionControl.tsx
git commit -m "feat: multi-session UI with worktree merge/discard controls"
```

---

## Phase 3: Command Registry (future)

### Task 9: AgentLore command definitions API

_(Deferred — depends on AgentLore backend changes)_

- Add `POST/GET /api/agentrune/commands` to AgentLore
- CLI fetches command definitions on startup
- APP renders command menu from definitions

### Task 10: Custom /command execution

_(Deferred — depends on Task 9)_

- APP shows /command menu from registry
- Selecting a command triggers CLI to inject the corresponding MCP tool call prompt
- MCP tool validates and returns structured result

---

## Build & Deploy Checklist

After completing Phase 1 (Tasks 1-5):

```bash
# Build CLI
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc

# Restart server
# Kill existing process on port 3456, then:
node dist/bin.js start --foreground --port 3456

# Build APP
cd /c/Users/agres/Documents/Test/AgentRune-New/app
npm run build
npx cap sync android

# Build APK
cd android && JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.10.7-hotspot" ./gradlew assembleDebug

# Copy APK
cp android/app/build/outputs/apk/debug/app-debug.apk ../../AgentWiki/public/agentrune.apk
```
