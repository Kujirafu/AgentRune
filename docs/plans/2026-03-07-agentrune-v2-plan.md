# AgentRune v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform AgentRune from "terminal on phone" to a command-driven multi-agent collaboration platform where users give instructions and receive structured results.

**Architecture:** MCP tools as the gate keeper (report_progress, log_prerequisite, log_decision, get_project_context). Vault sync module writes to Obsidian/markdown. CLI injects behavior rules + enforces hard constraints via PTY interception. APP renders ProgressCards in a SessionOverview/SessionDetail navigation structure.

**Tech Stack:** Node.js TypeScript CLI (MCP SDK, node-pty, ws), React Capacitor APP, AgentLore API

**Design docs:**
- `docs/plans/2026-03-07-agentrune-v2-design.md` — complete v2 design with MCP specs
- `docs/plans/2026-03-07-app-navigation-redesign-design.md` — APP navigation redesign

---

## Phase 1: MCP Gate Keeper + Vault Sync

### Task 1: Update ProgressReport type to natural language

**Files:**
- Modify: `cli/src/shared/types.ts`
- Modify: `app/src/types.ts`

**Step 1: Replace ProgressReport interface in CLI shared types**

In `cli/src/shared/types.ts`, add after the `SessionSummary` interface:

```typescript
export interface ProgressReport {
  title: string
  status: "done" | "blocked" | "in_progress"
  summary: string
  nextSteps: string[]
  details?: string
}
```

And add `"progress_report"` to the `AgentEvent.type` union, and add `progress?: ProgressReport` to `AgentEvent`.

**Step 2: Mirror in APP types**

In `app/src/types.ts`, add the same `ProgressReport` interface and update `AgentEvent`.

**Step 3: Verify build**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
cd /c/Users/agres/Documents/Test/AgentRune-New/app && npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/shared/types.ts app/src/types.ts
git commit -m "feat: add ProgressReport type (natural language summary)"
```

---

### Task 2: Add all 4 MCP documentation tools

**Files:**
- Modify: `cli/src/mcp/stdio-server.ts`

**Context:** The MCP server runs as stdio subprocess. We add 4 tools: report_progress, log_prerequisite, log_decision, get_project_context. Each tool POSTs to the local ws-server and includes a _reminder in the response.

**Step 1: Add report_progress tool**

In `cli/src/mcp/stdio-server.ts`, add:

```typescript
server.tool(
  "report_progress",
  "REQUIRED: Report your work progress. The user monitors from a mobile APP and can only see structured progress reports.",
  {
    title: z.string().describe("Short title of what was accomplished, in user's language"),
    status: z.enum(["done", "blocked", "in_progress"]).describe("Current status"),
    summary: z.string().describe("Natural language summary of the work, in user's language"),
    nextSteps: z.array(z.string()).describe("Suggested next actions, in user's language"),
    details: z.string().optional().describe("Detailed explanation for expandable panel"),
  },
  async ({ title, status, summary, nextSteps, details }) => {
    // Validate
    if (!title.trim()) return { content: [{ type: "text" as const, text: "Error: title cannot be empty" }], isError: true }
    if (!summary.trim()) return { content: [{ type: "text" as const, text: "Error: summary cannot be empty" }], isError: true }
    if (status === "blocked" && !summary.toLowerCase().includes("because") && summary.length < 20) {
      return { content: [{ type: "text" as const, text: "Error: when blocked, summary must explain why and what you need" }], isError: true }
    }
    if (status === "done" && nextSteps.length === 0) {
      return { content: [{ type: "text" as const, text: "Error: when done, nextSteps must have at least one item" }], isError: true }
    }

    const report = { title, status, summary, nextSteps, details }
    const config = loadConfig()
    try {
      await fetch(`http://localhost:${config.port}/api/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      })
    } catch { /* ws-server may not be running */ }

    return {
      content: [{
        type: "text" as const,
        text: `${title}\n\n_reminder: 回報成功。提醒：summary 寫人話、用用戶語言、卡住了就說你需要什麼、每完成一段有意義的工作就報一次。`,
      }],
    }
  }
)
```

**Step 2: Add log_prerequisite tool**

```typescript
server.tool(
  "log_prerequisite",
  "Record a prerequisite: why things are the way they are, pitfalls discovered, constraints found.",
  {
    content: z.string().describe("The prerequisite content — explain WHY, not WHAT"),
    context: z.string().optional().describe("Related code path or file"),
  },
  async ({ content, context }) => {
    const config = loadConfig()
    try {
      await fetch(`http://localhost:${config.port}/api/vault/prerequisite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, context }),
      })
    } catch { /* ws-server may not be running */ }

    return {
      content: [{
        type: "text" as const,
        text: `Prerequisite logged.\n\n_reminder: 前提條件已記錄。提醒：記錄「為什麼」不是「是什麼」、未來的 agent 會讀這份紀錄。`,
      }],
    }
  }
)
```

**Step 3: Add log_decision tool**

```typescript
server.tool(
  "log_decision",
  "Record an architecture decision: what was chosen, why, and what alternatives were considered.",
  {
    decision: z.string().describe("What was decided"),
    reasoning: z.string().describe("Why this was chosen"),
    alternatives: z.string().optional().describe("Other options considered"),
  },
  async ({ decision, reasoning, alternatives }) => {
    const config = loadConfig()
    try {
      await fetch(`http://localhost:${config.port}/api/vault/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reasoning, alternatives }),
      })
    } catch { /* ws-server may not be running */ }

    return {
      content: [{
        type: "text" as const,
        text: `Decision logged.\n\n_reminder: 決策已記錄。提醒：包含替代方案和理由、不要推翻已有決策除非有明確理由。`,
      }],
    }
  }
)
```

**Step 4: Add get_project_context tool**

```typescript
server.tool(
  "get_project_context",
  "Read project context from the knowledge vault. Call this at the start of a new session to understand the project.",
  {},
  async () => {
    const config = loadConfig()
    try {
      const res = await fetch(`http://localhost:${config.port}/api/vault/context`)
      const data = await res.json()
      return {
        content: [{
          type: "text" as const,
          text: `${data.context}\n\n_reminder: 上下文已載入。提醒：先讀完再開始工作、注意前提條件中的限制和踩坑。`,
        }],
      }
    } catch {
      return {
        content: [{
          type: "text" as const,
          text: "Could not connect to ws-server to read vault. The server may not be running.",
        }],
        isError: true,
      }
    }
  }
)
```

**Step 5: Update server instructions**

Replace the server `instructions` string to include all 4 documentation tools:

```typescript
instructions: `AgentRune MCP server — proxies AgentLore knowledge base tools + local device tools + documentation tools.

IMPORTANT: After completing any task, you MUST call report_progress. The user monitors from a mobile APP.

## Documentation Tools (REQUIRED)
- report_progress: Report work progress (MUST call after completing tasks)
- log_prerequisite: Record why things are the way they are (pitfalls, constraints, discoveries)
- log_decision: Record architecture decisions (what, why, alternatives)
- get_project_context: Read project context from vault (call at session start)

## AgentLore Tools
- search: Search the AI-verified knowledge base
- get_entry: Get full details of a knowledge entry
- find_skills: Find reusable skills/patterns
- report_skill_outcome: Report whether a skill worked
- submit_knowledge: Submit new knowledge
- list_domains: List available knowledge domains

## Local Tools
- list_sessions: List active PTY sessions
- run_command: Run a shell command
- get_clipboard: Read the system clipboard`,
```

**Step 6: Verify build**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
```

**Step 7: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/mcp/stdio-server.ts
git commit -m "feat: add 4 MCP documentation tools (report_progress, log_prerequisite, log_decision, get_project_context)"
```

---

### Task 3: Vault sync module

**Files:**
- Create: `cli/src/server/vault-sync.ts`

**Context:** This module writes to the Obsidian vault (or default knowledge folder) when MCP tools are called. It reads `~/.agentrune/config.json` for vault path.

**Step 1: Create vault-sync module**

```typescript
// server/vault-sync.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

interface VaultConfig {
  vaultPath: string
  projectName: string
}

function getVaultConfig(): VaultConfig {
  const configPath = join(homedir(), ".agentrune", "config.json")
  let vaultPath = join(homedir(), ".agentrune", "knowledge")

  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"))
      if (config.vaultPath) vaultPath = config.vaultPath
    } catch { /* use default */ }
  }

  // projectName from cwd basename or config
  const projectName = process.env.AGENTRUNE_PROJECT || "default"

  return { vaultPath, projectName }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19)
}

export class VaultSync {
  private vaultPath: string
  private projectDir: string

  constructor(projectName?: string) {
    const config = getVaultConfig()
    this.vaultPath = config.vaultPath
    const name = projectName || config.projectName
    this.projectDir = join(this.vaultPath, name)
    ensureDir(this.projectDir)
    ensureDir(join(this.projectDir, "變更記錄"))
    ensureDir(join(this.projectDir, "Bug記錄"))
    ensureDir(join(this.projectDir, "測試結果"))
  }

  /** Write progress report to vault */
  writeProgress(report: { title: string; status: string; summary: string; nextSteps: string[]; details?: string }): void {
    const entry = `\n## [${timestamp()}] ${report.title}\n\n**狀態**：${report.status}\n\n${report.summary}\n\n${report.nextSteps.length > 0 ? "**下一步**：\n" + report.nextSteps.map(s => `- ${s}`).join("\n") : ""}\n${report.details ? "\n**詳情**：\n" + report.details : ""}\n`

    // Append to 進度.md
    appendFileSync(join(this.projectDir, "進度.md"), entry, "utf-8")

    // Append to 變更記錄/YYYY-MM-DD.md
    appendFileSync(join(this.projectDir, "變更記錄", `${today()}.md`), entry, "utf-8")

    // If blocked, also write to Bug記錄/
    if (report.status === "blocked") {
      appendFileSync(join(this.projectDir, "Bug記錄", `${today()}.md`), entry, "utf-8")
    }

    // If summary mentions test, write to 測試結果/
    if (/test|測試|passed|failed/i.test(report.summary)) {
      appendFileSync(join(this.projectDir, "測試結果", `${today()}.md`), entry, "utf-8")
    }

    // Overwrite 狀態總覽.md
    this.updateStatusOverview(report)
  }

  /** Write prerequisite to vault */
  writePrerequisite(content: string, context?: string): void {
    const entry = `\n## [${today()} ${timestamp()}] ${context || "General"}\n\n${content}\n`
    const filePath = join(this.projectDir, "前提條件.md")

    // Check for duplicates (simple substring check)
    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, "utf-8")
      if (existing.includes(content.slice(0, 50))) return // skip duplicate
    }

    appendFileSync(filePath, entry, "utf-8")
  }

  /** Write decision to vault */
  writeDecision(decision: string, reasoning: string, alternatives?: string): void {
    const entry = `\n## [${today()} ${timestamp()}] ${decision}\n\n**理由**：${reasoning}\n${alternatives ? "\n**替代方案**：" + alternatives : ""}\n`
    appendFileSync(join(this.projectDir, "架構決策.md"), entry, "utf-8")
  }

  /** Read project context from vault */
  readContext(): string {
    const sections: string[] = []

    const files = ["狀態總覽.md", "前提條件.md", "架構決策.md", "進度.md"]
    for (const file of files) {
      const filePath = join(this.projectDir, file)
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf-8")
        // For 進度.md, only return last 2000 chars to avoid huge context
        if (file === "進度.md" && content.length > 2000) {
          sections.push(`# ${file}\n\n...（截取最近部分）\n\n${content.slice(-2000)}`)
        } else {
          sections.push(`# ${file}\n\n${content}`)
        }
      }
    }

    return sections.length > 0 ? sections.join("\n\n---\n\n") : "No project context found in vault."
  }

  private updateStatusOverview(report: { title: string; status: string; summary: string }): void {
    const filePath = join(this.projectDir, "狀態總覽.md")
    const content = `# 狀態總覽\n\n**最後更新**：${today()} ${timestamp()}\n\n## 最近回報\n\n| 時間 | 狀態 | 標題 | 摘要 |\n|------|------|------|------|\n| ${timestamp()} | ${report.status} | ${report.title} | ${report.summary.slice(0, 60)} |\n`
    writeFileSync(filePath, content, "utf-8")
  }
}
```

**Step 2: Verify build**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
```

**Step 3: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/server/vault-sync.ts
git commit -m "feat: add VaultSync module for Obsidian/markdown knowledge storage"
```

---

### Task 4: ws-server vault API endpoints + progress broadcast

**Files:**
- Modify: `cli/src/server/ws-server.ts`

**Context:** The ws-server needs HTTP endpoints for MCP tools to POST to, and broadcasts progress_report events to connected APP clients.

**Step 1: Import VaultSync**

```typescript
import { VaultSync } from "./vault-sync.js"
```

Create instance:
```typescript
const vault = new VaultSync()
```

**Step 2: Add POST /api/progress endpoint**

```typescript
app.post("/api/progress", express.json(), (req, res) => {
  const report = req.body
  if (!report || !report.title || !report.status) {
    res.status(400).json({ error: "Missing required fields: title, status" })
    return
  }

  // Write to vault
  vault.writeProgress(report)

  // Broadcast to APP
  const event: AgentEvent = {
    id: `progress_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    type: "progress_report",
    status: report.status === "done" ? "completed" : report.status === "blocked" ? "failed" : "in_progress",
    title: report.title,
    detail: report.details,
    progress: report,
  }

  for (const [client] of clientSessions) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "event", event }))
    }
  }

  res.json({ ok: true })
})
```

**Step 3: Add vault API endpoints**

```typescript
app.post("/api/vault/prerequisite", express.json(), (req, res) => {
  const { content, context } = req.body
  if (!content) { res.status(400).json({ error: "Missing content" }); return }
  vault.writePrerequisite(content, context)
  res.json({ ok: true })
})

app.post("/api/vault/decision", express.json(), (req, res) => {
  const { decision, reasoning, alternatives } = req.body
  if (!decision || !reasoning) { res.status(400).json({ error: "Missing decision or reasoning" }); return }
  vault.writeDecision(decision, reasoning, alternatives)
  res.json({ ok: true })
})

app.get("/api/vault/context", (req, res) => {
  const context = vault.readContext()
  res.json({ context })
})
```

**Step 4: Verify build**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
```

**Step 5: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/server/ws-server.ts
git commit -m "feat: add vault API endpoints + progress broadcast to APP"
```

---

### Task 5: Agent behavior rules injection

**Files:**
- Create: `cli/src/server/behavior-rules.ts`
- Modify: `cli/src/server/ws-server.ts`

**Context:** When a new agent session starts, CLI injects behavior rules into the PTY. Also injects vault context so agent starts with full project knowledge.

**Step 1: Create behavior-rules module**

```typescript
// server/behavior-rules.ts

export function getBehaviorRules(userLanguage: string = "zh-TW"): string {
  // Rules are in Chinese since that's the primary user base.
  // The language rule itself tells agent to follow user's language.
  return `
你正在 AgentRune 環境中工作。

【語言】
- 用用戶的語言溝通，包括 report_progress 的所有欄位
- 不確定用戶語言時，跟隨專案的主要語言

【回報】
- 完成一段有意義的工作後，主動呼叫 report_progress
- 被 blocked 時立即報，說明你需要什麼
- summary 寫人話，不要寫技術 log

【範圍】
- 嚴格在你的 worktree 範圍內工作，不要動其他 session 的檔案
- 只做被指派的任務，發現不相關的問題用 log_prerequisite 記錄，不要順手修
- 不要改你不理解的程式碼

【除錯】
- 不要猜問題在哪，先加 debug log 確認實際資料再修
- 修之前要能說出「問題是 X 因為 Y」，說不出來就還沒查夠
- 同一個修法失敗兩次就換方向，不要重複嘗試

【思考】
- 有更聰明的做法時主動提出，不要悶著頭做
- 發現任務本身可能有問題時，report_progress(status="blocked") 提出疑問
- 多個方案時簡述取捨再選，不要自己默默決定

【品質】
- 改程式碼前先跑現有測試
- 改完再跑一次
- 不確定的事用 log_prerequisite 記錄

【知識】
- 發現重要前提 → log_prerequisite
- 做了架構決策 → log_decision
- 這些記錄會被其他 session 讀取，寫清楚
`.trim()
}

export function getCommandPrompt(command: string): string | null {
  const prompts: Record<string, string> = {
    "/resume": `統整過去的工作並建議下一步。步驟：
1. 呼叫 get_project_context 讀取 vault
2. 整理成工作摘要：最近做了什麼、目前狀態、未完成的事
3. 建議 2-3 個下一步，按優先順序
4. report_progress(status="done")`,

    "/status": `回報當前 session 的工作狀態。步驟：
1. 檢查 git status、最近的改動、未完成的工作
2. 彙整成簡短狀態報告
3. report_progress(status="in_progress" 或 "done")`,

    "/report": `強制回報最近完成的工作。步驟：
1. 檢查 git log 和 git diff 了解最近的改動
2. 彙整成結構化報告
3. report_progress，所有欄位盡量填完整
4. 這是強制回報，即使你覺得沒什麼好報的也要報`,

    "/test": `執行專案的測試套件並結構化回報結果。步驟：
1. 找到專案的測試指令（package.json scripts、Makefile、或常見測試框架）
2. 執行測試
3. 分析結果，失敗的說明原因和建議修法
4. report_progress，summary 包含通過/失敗數量`,

    "/review": `Review 目前的改動並產出結構化摘要。步驟：
1. git diff 查看所有變更
2. 逐檔案分析：改了什麼、潛在問題
3. 檢查測試覆蓋、安全、效能
4. report_progress，details 包含 review 摘要`,

    "/deploy": `執行部署流程並回報結果。步驟：
1. 先跑測試，失敗就 blocked 停止
2. 執行部署
3. 驗證是否成功
4. report_progress 包含結果和 URL`,

    "/merge": `合併當前 worktree 的改動回 main。步驟：
1. 先 /review + /test
2. 執行 merge/rebase
3. 有衝突嘗試解決，記錄原因
4. 解不了就 blocked
5. 成功就 report_progress`,

    "/note": `記錄前提條件或架構決策。步驟：
1. 判斷是前提條件還是架構決策
2. 前提 → log_prerequisite | 決策 → log_decision
3. report_progress(status="done")`,

    "/context": `讀取專案上下文。步驟：
1. 呼叫 get_project_context
2. 整理成易讀摘要
3. report_progress(status="done")`,

    "/analysis": `分析程式碼並產出結構化報告。步驟：
1. 確認分析方向（效能/安全/架構/全部）
2. 深入分析，每個發現標嚴重程度
3. report_progress，details 包含完整報告`,

    "/insight": `提煉工作中的洞察。步驟：
1. 回顧最近工作
2. 提煉踩坑、pattern、技術決定
3. 分類記錄：前提 → log_prerequisite | 決策 → log_decision
4. report_progress 列出記錄了什麼`,
  }

  return prompts[command] || null
}
```

**Step 2: Integrate into ws-server**

In the session creation handler, after starting the agent PTY, inject behavior rules + vault context:

```typescript
import { getBehaviorRules, getCommandPrompt } from "./behavior-rules.js"

// After session PTY is started:
const rules = getBehaviorRules()
const vaultContext = vault.readContext()
const injection = `${rules}\n\n---\n\n以下是專案上下文：\n\n${vaultContext}\n`
sessions.write(sessionId, injection)
```

In the input handler, detect /commands and inject the corresponding prompt:

```typescript
case "input": {
  const sessionId = clientSessions.get(ws)
  if (sessionId) {
    const inputStr = msg.data as string

    // Check for /command
    const cmdMatch = inputStr.match(/^(\/\w+)/)
    if (cmdMatch) {
      const prompt = getCommandPrompt(cmdMatch[1])
      if (prompt) {
        sessions.write(sessionId, prompt + "\n")
        break
      }
    }

    sessions.write(sessionId, inputStr)
  }
  break
}
```

**Step 3: Verify build**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/server/behavior-rules.ts cli/src/server/ws-server.ts
git commit -m "feat: agent behavior rules injection + /command prompt dispatch"
```

---

## Phase 2: PTY Interception + Enforcement

### Task 6: Progress interceptor (idle detection + report prompt)

**Files:**
- Create: `cli/src/server/progress-interceptor.ts`
- Modify: `cli/src/server/ws-server.ts`

**Step 1: Create progress-interceptor module**

```typescript
// server/progress-interceptor.ts

const IDLE_THRESHOLD_MS = 15_000
const PROMPT_COOLDOWN_MS = 120_000

interface SessionState {
  lastProgressReport: number
  lastPromptInjected: number
  lastActivityTime: number
  hasNewWork: boolean
}

export class ProgressInterceptor {
  private sessions = new Map<string, SessionState>()

  trackSession(sessionId: string): void {
    this.sessions.set(sessionId, {
      lastProgressReport: Date.now(),
      lastPromptInjected: 0,
      lastActivityTime: Date.now(),
      hasNewWork: false,
    })
  }

  untrackSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  onData(sessionId: string, hasToolEvents: boolean): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.lastActivityTime = Date.now()
    if (hasToolEvents) state.hasNewWork = true
  }

  onProgressReport(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.lastProgressReport = Date.now()
    state.hasNewWork = false
  }

  checkInjection(sessionId: string, isIdle: boolean): string | null {
    const state = this.sessions.get(sessionId)
    if (!state) return null
    const now = Date.now()

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

**Step 2: Create PTY hard enforcement module**

Create `cli/src/server/pty-enforcer.ts`:

```typescript
// server/pty-enforcer.ts
// Hard enforcement rules applied to PTY output/input

export interface EnforcementResult {
  action: "allow" | "block" | "warn"
  message?: string
}

const DANGEROUS_PATTERNS = [
  { pattern: /git\s+push\s+.*--force/i, message: "Force push detected — requesting user confirmation" },
  { pattern: /rm\s+-rf\s+[\/~]/i, message: "Dangerous rm -rf detected — requesting user confirmation" },
  { pattern: /drop\s+(table|database)/i, message: "DROP TABLE/DATABASE detected — requesting user confirmation" },
]

const INSTALL_PATTERNS = [
  /npm\s+install\s/i,
  /yarn\s+add\s/i,
  /pip\s+install\s/i,
  /pnpm\s+add\s/i,
  /bun\s+add\s/i,
]

export function checkCommand(input: string): EnforcementResult {
  // Check dangerous commands
  for (const { pattern, message } of DANGEROUS_PATTERNS) {
    if (pattern.test(input)) {
      return { action: "block", message }
    }
  }

  // Check dependency installs
  for (const pattern of INSTALL_PATTERNS) {
    if (pattern.test(input)) {
      return { action: "warn", message: "Dependency install detected — requesting user confirmation" }
    }
  }

  return { action: "allow" }
}

export function checkWorktreeBounds(input: string, worktreePath: string): EnforcementResult {
  // Simple check: if agent tries to cd outside worktree
  const cdMatch = input.match(/cd\s+([^\s;|&]+)/)
  if (cdMatch) {
    const target = cdMatch[1]
    if (target.startsWith("..") || target.startsWith("/")) {
      // Could be navigating outside worktree — warn
      return { action: "warn", message: `Navigation outside worktree detected: ${target}` }
    }
  }

  return { action: "allow" }
}
```

**Step 3: Integrate both into ws-server**

Import and wire up:
```typescript
import { ProgressInterceptor } from "./progress-interceptor.js"
import { checkCommand } from "./pty-enforcer.js"
```

In session creation: `progressInterceptor.trackSession(sessionId)`
In session exit: `progressInterceptor.untrackSession(sessionId)`
In progress endpoint: `progressInterceptor.onProgressReport(sessionId)`
In PTY data handler: check idle + inject prompt
In input handler: run `checkCommand()` before writing to PTY

**Step 4: Verify build**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
```

**Step 5: Commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/server/progress-interceptor.ts cli/src/server/pty-enforcer.ts cli/src/server/ws-server.ts
git commit -m "feat: PTY enforcement — idle detection, dangerous command blocking, worktree bounds"
```

---

## Phase 3: Worktree Isolation

### Task 7: Worktree manager

**Files:**
- Create: `cli/src/server/worktree-manager.ts`

**Step 1: Create worktree-manager module**

```typescript
// server/worktree-manager.ts
import { execSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

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

  create(sessionId: string, taskSlug?: string): Worktree {
    const existing = this.worktrees.get(sessionId)
    if (existing) return existing

    const date = new Date().toISOString().slice(0, 10)
    const slug = taskSlug || sessionId.slice(0, 8)
    const branch = `agentrune/${date}-${slug}`
    const worktreeDir = join(this.projectCwd, ".worktrees", `${date}-${slug}`)

    mkdirSync(join(this.projectCwd, ".worktrees"), { recursive: true })

    try {
      execSync(`git worktree add -b "${branch}" "${worktreeDir}"`, {
        cwd: this.projectCwd, encoding: "utf-8", stdio: "pipe",
      })
    } catch {
      execSync(`git worktree add "${worktreeDir}" "${branch}"`, {
        cwd: this.projectCwd, encoding: "utf-8", stdio: "pipe",
      })
    }

    const wt: Worktree = { path: worktreeDir, branch, sessionId, createdAt: Date.now() }
    this.worktrees.set(sessionId, wt)
    return wt
  }

  get(sessionId: string): Worktree | undefined {
    return this.worktrees.get(sessionId)
  }

  list(): Worktree[] {
    return [...this.worktrees.values()]
  }

  merge(sessionId: string, targetBranch: string = "main"): { success: boolean; message: string } {
    const wt = this.worktrees.get(sessionId)
    if (!wt) return { success: false, message: "Worktree not found" }

    try {
      execSync(`git merge "${wt.branch}" --no-edit`, {
        cwd: this.projectCwd, encoding: "utf-8", stdio: "pipe",
      })
      this.cleanup(sessionId)
      return { success: true, message: `Merged ${wt.branch} into ${targetBranch}` }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : "Merge failed" }
    }
  }

  cleanup(sessionId: string): void {
    const wt = this.worktrees.get(sessionId)
    if (!wt) return

    try { execSync(`git worktree remove "${wt.path}" --force`, { cwd: this.projectCwd, encoding: "utf-8", stdio: "pipe" }) } catch {}
    try { execSync(`git branch -D "${wt.branch}"`, { cwd: this.projectCwd, encoding: "utf-8", stdio: "pipe" }) } catch {}
    this.worktrees.delete(sessionId)
  }
}
```

**Step 2: Verify build + commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/server/worktree-manager.ts
git commit -m "feat: add WorktreeManager for session-isolated git worktrees"
```

---

### Task 8: Integrate worktree into ws-server

**Files:**
- Modify: `cli/src/server/ws-server.ts`

**Step 1: Add worktree support**

Import and wire up WorktreeManager. Add `create_session` (with optional isolation), `merge_worktree`, `discard_worktree` WebSocket message handlers, and `GET /api/worktrees/:projectId` HTTP endpoint.

See Task 7 in the previous plan version for detailed code — the logic is unchanged.

**Step 2: Verify build + commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc --noEmit
cd /c/Users/agres/Documents/Test/AgentRune-New
git add cli/src/server/ws-server.ts
git commit -m "feat: integrate worktree isolation into session creation + merge/discard"
```

---

## Phase 4: APP Navigation Redesign

### Task 9: ProgressCard component (zero emoji, color bars)

**Files:**
- Create: `app/src/components/ProgressCard.tsx`

**Context:** Replaces EventCard as primary display. Design: color bar left border, status dot indicator, line-style icons. NO emoji anywhere. Follows existing dark/light theme.

**Step 1: Create ProgressCard component**

Build the component following the design spec:
- Left color bar (green=done, blue=in_progress, red=blocked)
- Status label badge (text only, no emoji)
- Title + summary (natural language)
- Next steps as tappable buttons
- Expandable details panel
- Support both dark and light theme

Reference design doc: `docs/plans/2026-03-07-app-navigation-redesign-design.md` section "UI 設計規範"

**Step 2: Verify build + commit**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/app && npx tsc --noEmit
git add app/src/components/ProgressCard.tsx
git commit -m "feat: add ProgressCard component (zero emoji, color bars, dual theme)"
```

---

### Task 10: SessionOverview component (replaces LaunchPad home)

**Files:**
- Create: `app/src/components/SessionOverview.tsx`

**Context:** The new home screen. Vertical scrolling list of session cards, each with inline ProgressCard preview. Blocked sessions have expandable quick-reply input.

**Step 1: Create SessionOverview**

Build following the design spec:
- Top bar: project name + settings gear + "+ New Session" button
- Session cards: agent icon + name + status dot + label + inline ProgressCard preview
- Action buttons per status (Working→view, Done→merge/discard, Blocked→reply)
- Long press → settings sheet (model, mode, rename, delete)
- Left swipe card → quick actions
- Pull down → refresh

**Step 2: Verify build + commit**

---

### Task 11: SessionDetail component (replaces MissionControl board)

**Files:**
- Create: `app/src/components/SessionDetail.tsx`

**Context:** The detail view. Mixed display of ProgressCards and chat bubbles. InputBar at bottom supports both /commands and natural language.

**Step 1: Create SessionDetail**

Build following the design spec:
- Top: back arrow + session name + status dot
- Mixed timeline: ProgressCard (bordered, color bar) + chat bubbles (lightweight)
- Bottom InputBar: /command → result card, natural language → chat bubble
- Switchable panels: Terminal / Diff / Files (bottom tabs or slide-up drawer)

**Step 2: Verify build + commit**

---

### Task 12: ProjectPanel component (replaces LaunchPad sidebar)

**Files:**
- Create: `app/src/components/ProjectPanel.tsx`

**Context:** Left slide-in panel showing all projects.

**Step 1: Create ProjectPanel**

- Project list with name + path + active session count
- Top: global settings gear
- Settings include: theme, language, connection, AgentLore account, "Show planning guide for new sessions" toggle

**Step 2: Verify build + commit**

---

### Task 13: Wire up new navigation in App.tsx

**Files:**
- Modify: `app/src/App.tsx`

**Context:** Replace the LaunchPad → MissionControl flow with ProjectPanel → SessionOverview → SessionDetail.

**Step 1: Update App.tsx navigation**

- Default view: SessionOverview
- Tap session card → SessionDetail
- Left swipe → ProjectPanel
- Remove old LaunchPad/MissionControl routing (keep files for reference)

**Step 2: Verify build + commit**

---

### Task 14: New Session planning flow

**Files:**
- Create: `app/src/components/PlanningGuide.tsx`

**Context:** When user taps "+ New Session", show planning guide dialog before session creation. Can skip or permanently disable.

**Step 1: Create PlanningGuide component**

- Dialog with 3 options: "Start planning" / "Skip" / "Always skip"
- "Always skip" saves preference to localStorage
- "Start planning" → (future: agent-guided brainstorm, for now just a text input for task description)
- After planning → option to create session with PRD or save PRD to vault

**Step 2: Integrate into SessionOverview "New Session" flow**

**Step 3: Verify build + commit**

---

## Phase 5: Build + Deploy

### Task 15: Build, test, deploy

**Step 1: Build CLI**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/cli && npx tsc
```

**Step 2: Build APP**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/app
npm run build
npx cap sync android
```

**Step 3: Build APK**

```bash
cd /c/Users/agres/Documents/Test/AgentRune-New/app/android
JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.10.7-hotspot" ./gradlew assembleDebug
```

**Step 4: Copy APK**

```bash
cp /c/Users/agres/Documents/Test/AgentRune-New/app/android/app/build/outputs/apk/debug/app-debug.apk /c/Users/agres/Documents/Test/AgentWiki/public/agentrune.apk
```

**Step 5: Manual test**

- Install APK on phone
- Connect to CLI server
- Test: send /status, verify ProgressCard appears
- Test: send natural language, verify chat bubble appears
- Test: check vault files are created
- Test: create isolated session, verify worktree
