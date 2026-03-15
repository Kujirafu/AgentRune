# AgentRune Rules

You are working inside AgentRune. Read this file at the start of every session.

## Language
- Reply in the user's language (follow the language of user input or the project's primary language)
- report_progress fields should also use the same language

## Shared Memory (Most Important!)
- `.agentrune/agentlore.md` is your memory — treat it like memory.md
- This is the only cross-session, cross-agent shared memory. All agents (Claude/Codex/Gemini) read/write the same file
- **Always read agentlore.md at session start** — use it as your project memory
- New findings, gotchas, architecture decisions, user preferences → write to agentlore.md
- Do NOT write memory to CLAUDE.md, .claude/memory/, codex config, or any agent-native memory system
- If you have your own memory/auto-memory mechanism, don't use it. The user can't see those files
- If agentlore.md doesn't exist, scan the project and create it (## Stack, ## Conventions, ## Key Files, ## Context, ## Lessons)
- Don't record temporary state or unverified guesses

## Reporting
- Proactively call report_progress at these moments:
  - After completing a task assigned by the user
  - When blocked and unable to continue (explain what you need)
  - When waiting for a user decision
- Write summaries in plain language, not technical logs

## Scope
- Work strictly within your worktree scope — don't touch files from other sessions
- Only do the assigned task. If you find unrelated issues, use log_prerequisite to record them — don't fix them on the side

## Work Discipline
- Before fixing a bug, confirm "the problem is X because of Y". If you can't confirm, you haven't investigated enough. If the same fix fails twice, change direction
- Proactively suggest better approaches or flag task issues — don't just silently push through
- Run tests before and after code changes
- Important prerequisites → log_prerequisite; architecture decisions → log_decision

## AgentLore Knowledge Base
- You have AgentLore MCP tools: search (search knowledge), find_skills (find skill guides), advisor (get advice)
- When encountering unfamiliar tech/domains, looking for best practices, or facing integration issues — check AgentLore first
- After solving a non-obvious problem, ask the user if they want to submit_knowledge back to the knowledge base

## Skill Cards
- Use `find_skills` at appropriate moments to look up available skill guides relevant to the current task
- Examples: starting a feature → look for planning skills; fixing a bug → look for debugging skills; finishing work → look for commit/review skills
- Don't memorize the skill list — query dynamically each time for the latest available skills

## Daemon Development (MANDATORY — Read Before ANY Server Work)

### The #1 Rule: Always Use safe-restart.sh

**After modifying ANY file under `cli/src/` you MUST follow this exact sequence:**

```bash
# Step 1: Build (mandatory, never skip)
cd cli && npm run build

# Step 2: If build fails → STOP. Fix the build. Do NOT restart.

# Step 3: If build succeeds → restart daemon
bash cli/safe-restart.sh

# Step 4: Verify health (safe-restart.sh does this, but double-check)
grep "heartbeat OK" ~/.agentrune/daemon.log | tail -1
```

### Forbidden Actions (Will Break User's Connection)

- **NEVER** `taskkill //IM node.exe //F` without `safe-restart.sh` after
- **NEVER** `npx tsx src/bin.ts start` without building first
- **NEVER** start a second daemon while the old one is running
- **NEVER** skip the restart after modifying server code — the user's phone will stay connected to the OLD code
- **NEVER** restart without building — an import error will crash the daemon and the user loses connection

### Why This Matters

The user controls agents from their phone via this daemon. If you crash it or leave it running old code, the user has to physically walk to their computer to fix it. This is unacceptable. **Every daemon restart must be done by you, the agent, using `bash cli/safe-restart.sh`.**

### ESM Module Rules

- `__dirname` / `__filename` don't exist in ESM — use `fileURLToPath(import.meta.url)`
- No `require()` — use dynamic `import()` if needed
- Modify one server file at a time, build + verify between changes

## PRD Management (Must Use API!)
- For feature requests that would take more than 30 minutes, follow the PRD workflow:
  1. **Clarify the goal**: Confirm what the user wants in one sentence
  2. **Ask decision questions**: One key question at a time, wait for the answer before asking the next (usually 3-5 questions suffice)
     - Questions should be specific, offer options when possible
  3. **Propose approaches**: Present 2-3 viable approaches with plain-language pros/cons, let the user choose
  4. **Confirm scope**: Explicitly list "what to do" and "what not to do"
  5. **Create PRD via API** (see PRD API section below) — don't just output JSON in chat
  6. Wait for user confirmation in the AgentRune app before starting implementation
  7. Update task status via API during implementation (pending → in_progress → done)
- Simple requests (change button color, etc.) can skip this

## Release & Secret Safety
- **APK 檔案絕對不 commit 進 repo** — 只透過 GitHub Releases 上傳
- **google-services.json 不可 commit** — 已在 .gitignore，但 APK build 會嵌入，所以 APK 也不能 commit
- **Firebase Admin SDK 金鑰 (firebase-adminsdk*.json) 不可 commit** — 放 ~/.agentrune/secrets/
- **build.gradle 的 keystore 密碼** — 應改用 local.properties 或環境變數，不要明文寫在 build.gradle
- **Release 前檢查**：確認 APK 內嵌的 API key 有設定 Android 限制（SHA-1 + package name）
- **git history 無法輕易清除** — 一旦 secret 被 commit，唯一可靠做法是輪換 key
- **教訓（2026-03-15）**：google-services.json 的 API key 透過 .gitignore 例外的 APK 檔案洩漏到 GitHub，被 Google 掃到通報。26 個 release 全部受影響，需刪除重發

## Voice Commands
- Messages starting with [Voice Command] → understand the intent, execute directly, don't ask for clarification

## Cross-Session Collaboration
- Messages starting with [From Other Session] → respond, then report_progress with summary prefixed [Reply]

## PRD API

AgentRune daemon provides a local REST API for managing PRDs (Product Requirements Documents).
**When you receive a feature request, you must use this API to create a PRD — don't just output JSON in chat.**

**Create new PRD (must use this!):**
```
curl -X POST http://localhost:<PORT>/api/prd/<projectId> \
  -H 'Content-Type: application/json' \
  -d @<json-file>
```

JSON structure:
```json
{
  "title": "PRD title",
  "goal": "One-sentence goal description",
  "priority": "p0",
  "decisions": [{"question": "Question", "answer": "Answer"}],
  "approaches": [{"name": "Approach", "pros": ["Pro"], "cons": ["Con"], "adopted": true}],
  "scope": {"included": ["In scope"], "excluded": ["Out of scope"]},
  "tasks": [{"title": "Task 1"}, {"title": "Task 2"}]
}
```

Note: When JSON contains non-ASCII characters, use file transfer (`-d @file.json`) instead of heredoc to avoid encoding issues.

**List all PRDs:**
```
curl http://localhost:<PORT>/api/prd/<projectId>
```

**Read a single PRD:**
```
curl http://localhost:<PORT>/api/prd/<projectId>/<prdId>
```

**Update task status (keep updating during implementation):**
```
curl -X PATCH http://localhost:<PORT>/api/prd/<projectId>/<prdId>/tasks/<taskId> \
  -H 'Content-Type: application/json' \
  -d '{"status":"done"}'
```

**Add a task:**
```
curl -X POST http://localhost:<PORT>/api/prd/<projectId>/<prdId>/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"..."}'
```

- `<PORT>` is the daemon port (default: 3456)
- `<projectId>` from `GET /api/projects`
- Only read PRDs related to the current task
