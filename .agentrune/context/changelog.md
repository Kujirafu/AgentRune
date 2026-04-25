# Changelog

## 2026-04-25
- Cut `v0.3.7` as a desktop-only patch on top of `v0.3.6`. Bumped `cli/package.json` and `desktop/package.json` to `0.3.7`; left `app/android/app/build.gradle` at `versionName 0.3.6 / versionCode 14` because the only mobile-side changes since `v0.3.6` were the `buildProtocol` text sync and an e2e fixture. The release will be tagged with `--latest=false` so the `releases/latest/download/agentrune.apk` and `agentrune.aab` URLs that AgentLore embeds keep resolving to the `0.3.6` Android artifacts.
- Updated `context/stack.md` Tech Stack from "Electron 35" to "Electron 41" to match the actual desktop runtime after the `/secure` upgrade. No other stack lines changed.

## 2026-04-24
- Synced mobile app-side `buildProtocol` in `app/src/types.ts` to the v5 memory-index protocol. Previously it still told agents "`agentlore.md` IS your memory — read on start, write when you learn", which contradicts the daemon-side v5 text and the current `rules.md` (index + `context/*.md` sections). `full` and `short` outputs now match `cli/src/server/automation-manager.ts`; `prdHint` is intentionally omitted because the app-side builder has no `projectId`. All 434 app tests still pass; app `typecheck` clean.
- Ran `/secure` skill chain as a pre-commit sweep: added `isSafeBranchName()` helper in `cli/src/server/automation-manager.ts` and validated `crew.targetBranch` at both API ingress (`POST`/`PATCH /api/automations/:projectId` in `ws-server.ts`) and execution time (before `execFileSync("git", ["checkout", "-b", …])`), closing a flag-injection route via `--upload-pack=…`. Hardened Electron main window in `desktop/src/main.ts` with a URL-parse–based `will-navigate` guard (no more `startsWith("http://localhost:3457")` subdomain bypass) and a `setWindowOpenHandler` that sends external `http(s)` links to the OS browser via `shell.openExternal` and denies anything else; updated `desktop/src/main.test.ts` mock with `setWindowOpenHandler` + `shell.openExternal`. `npm audit fix` cleared 9 dependency CVEs (hono, lodash, path-to-regexp, picomatch, vite). Stepped `electron` 35.7.5 → 41.3.0 across six majors (36.9.5 → 37.10.3 → 38.8.6 → 39.8.9 → 40.9.2 → 41.3.0), running `typecheck` + 45/45 desktop tests at every step. Final `npm audit --workspaces --include-workspace-root` = 0 vulnerabilities. CLI 763/763, app 434/434, desktop 45/45 green.
- Ran `/qa` chain as release gate: app/cli/desktop builds green, 1242 unit/integration tests green, Playwright 54/54 (chromium + Pixel 7) green after adding a `test.beforeAll` in `app/e2e/mobile-daemon-regressions.spec.ts` that `mkdirSync`s `TMP_DIR` — fresh worktrees don't have a `tmp/` dir, so the projects-API and mkdir-API specs were failing on `expect(mkdirRes.ok()).toBeTruthy()` because daemon's `/api/mkdir` rejected the missing parent. Re-verified `npm audit` = 0 and a repo-wide secret regex scan was clean.

## 2026-04-04
- Release line now advances to `0.3.6`, because `v0.3.5` already points at an older commit and this bugfix batch needs a new publish tag instead of a rewritten release.
- Added a root `release:assets` staging step that copies the desktop updater payload under the exact `latest.yml` filenames plus the website aliases `agentrune-desktop.exe`, `agentrune.apk`, and `agentrune.aab` into `.release-assets`, so both auto-update and AgentLore's fixed GitHub latest-download URLs stay valid after each publish.
- Added ignore rules for `.release-assets/`, desktop release output folders, Android bundles, and local QA PDFs so public release commits do not accidentally include generated binaries or audit artifacts.
- Desktop release packaging now starts `electron-builder` via an explicit Windows command wrapper instead of `shell: true`, removing the child-process security warning from packaging runs.
- Fixed double-tap-to-send when picking images from gallery: `InputBar` now tracks active `FileReader` instances via `fileLoadingCountRef`. Tapping Send while the reader is still loading sets `pendingSendRef = true` and auto-fires `handleSendInner` once all readers complete, so the image is always sent in a single tap.
- Improved image instruction sent to agent: `appendInlineImagePaths` now uses a clearer "Please use your View/Read tool to open this image file before responding:" format and converts Windows backslash paths to forward slashes inside the instruction, so Claude Code reliably invokes the View tool.
- Improved FileBrowser error handling: network/timeout errors now show the localized `file.loadError` message, while unexpected server errors show the raw message, making it easier to diagnose 401 vs. network issues.
- BUG-001 safe area fix: SettingsSheet, FileBrowser header, InsightSheet header, and LaunchPad main header now use `calc(env(safe-area-inset-top, 0px) + Npx)` so content is not hidden behind the status bar on edge-to-edge Android devices.
- QA report v0.2.24 triage: BUG-003 (create project), BUG-004 (folder browser auth), BUG-005 (new folder), BUG-006+IMP-001 (system theme) were confirmed fixed in the 2026-03-28 session. BUG-001 fixed today. BUG-002 (Seasons) does not exist in the current codebase.
- All 432 app tests, 760 CLI tests, and 54 E2E tests pass. APK built and ready for install.

## 2026-03-24
- Fixed desktop auto-dispatch for short follow-up replies: `好`, `繼續`, `continue`, and similar acknowledgements now route back to the focused or live session instead of silently spawning a new session.
- 修正桌面 session 事件流與編號穩定性：
- `session_activity` 改為使用穩定 `eventId` upsert，不再因 `activity_${Date.now()}` 造成重複事件。
- `session_activity` / `event` / `events_replay` 現在會合併同 ID 事件，rich event 可覆蓋簡版 activity。
- 桌面 session `#` 改為 creation-order stable ordinal，卡片、展開面板、輸入列 target、message center 不再跟著排序交換。
- `MissionControl` 的跨 session activity unread 也加入 stable key dedup。
- Desktop sidebar bottom widget now behaves like a message center: Inbox stays focused on approvals, and completed sessions auto-open Recent with summary + next step.
- Desktop completion notifications now also trigger from explicit idle/end signals instead of only `digest.status === "done"`, so sessions that finish inside an open shell still surface in the message center and background notifications.
- Systemized the index-first project memory workflow: daemon-side auto-init now ensures `.agentrune` exists before worktree/session use, MCP memory tools read and write the local project directly, worktree memory files are shared instead of one-time copies, and `agentrune memory ...` exposes init/index/sections/read/search/route commands for installed users.
- 修正多 session / 多 agent / 跨裝置同步主幹：
- Claude `claudeSessionId` 會正確回寫，不再因空 mapping 卡住對話映射。
- recoverable / crashed session 的 resume cooldown 改成 per-session。
- `request_events` 不再停掉同 project 的其他 Claude watcher。
- 修正 CLI daemon 安全問題：
- `/api/auth/new-code` 改為受 auth 保護。
- HTTP / WebSocket localhost bypass 改為 trusted-local 判定。
- memory section 讀寫改用固定 allowlist，封住 Windows 路徑穿越。
- 更新 desktop 依賴到安全版本，並新增 `rebuild-pty` smoke test。
- 補齊 Dashboard / PRD E2E 相容調整：
- 新增穩定的 desktop `data-testid`
- 補 `All Projects` 入口
- legacy tasks API 會回填最新 PRD
- App Playwright 回到 `48/48 passed`
- 修正 `AutomationSheet` 編輯既有 automation 時未回填 `enabled` 的問題。
- `.worktrees/` 加入 `.gitignore`，避免污染工作樹。
- 專案記憶從單一 `agentlore.md` 重整為 `agentlore.md + context/*.md` 分類結構。
- 新增公開文件 [docs/project-memory-policy.md](C:/Users/agres/Documents/Test/AgentRune-New/docs/project-memory-policy.md)，明確區分 AGPL repo 的公開文件與本機 `.agentrune` 專案記憶。
- 更新 `.agentrune/rules.md`，要求 agent 將可公開的長期文件寫入 tracked docs，而不是把所有內容都塞進私有記憶。
- 新增本地 prototype：`/api/memory/route`、`/api/memory/search`、MCP memory section tools、worktree `context/` 同步，以及「索引優先、只讀相關 section」的 agent prompt。

## 2026-03-25
- 修正 Codex 的 bypass/trust 對齊：CLI launch 現在會把全域 `bypass` 視為 Codex 的有效 `danger-full-access`，不再出現 UI 已開 bypass 但 Codex 仍跳 approval 的錯位。
- 補齊 session attach 設定傳遞：mobile / desktop / terminal attach helper 現在會一併送出 `sandboxLevel`、`requirePlanReview`、`requireMergeApproval`，讓 daemon 端的 `SkillMonitor` / `AuthorityMap` 在 reconnect / reattach 後仍能正確執行沙盒限制。
- 恢復 desktop 新 session 的 agent 繼承邏輯，不再因暫時修補而硬編成 `claude`，避免初始訊息 dispatch 修好後又把 agent 選擇帶歪。

- Desktop expanded session panels now auto-attach with the full terminal attach payload on mount, so brand-new sessions start immediately from the Events view instead of waiting for a manual switch into Terminal.
- Desktop `+` and `Ctrl+N` now arm a true "new session on next send" state instead of just falling back to auto-routing, so sending after clicking `+` no longer jumps back into an older actionable session by mistake.
- Desktop input-bar new-session intent now stays inside `CommandCenter` instead of opening Quick Launch, and `expandSessionId` / unrelated `attached` updates no longer clear that pending fresh-session state before the first send.
- Desktop fresh-session creation now keeps a pending handshake after the first `attach`: stale `expandSessionId` updates are ignored until the matching new `sessionId` responds with `attached`, preventing the input target from snapping back to an older session and resuming it.
- Desktop "create from input bar" launches now reuse `buildSessionAttachMessage(...)`, keeping locale and sandbox/trust fields aligned with terminal attach behavior.
- Queued desktop `session_input` now persists its `user_message` event when the input is accepted into the queue, so the Events feed reflects the send immediately even if actual PTY submit still waits for prompt readiness.
- Codex queued input readiness now matches the real `· 100% left ·` status separator and falls back to a plain prompt, preventing desktop `initialCommand` from hanging in queue just because the status-line regex missed the actual banner.
- Electron xterm panels now skip `@xterm/addon-webgl`, which was the most likely shared renderer-crash path when desktop users switched Codex or Claude sessions into terminal view.
- Desktop fresh-session sends now keep targeting the same `pendingNewSessionId` after the first attach, so follow-up input becomes `session_input` for the new session instead of silently spawning another attach or snapping back to an older expanded session.
- Desktop event merging now folds generic fallback replies like `Codex responded` into the later structured `response` event, and the Events panel keeps that fallback visible until a richer reply arrives, reducing duplicate output and terminal-only replies.
- Electron now writes renderer load/crash diagnostics to `logs/desktop-runtime.log` under userData, so future desktop flash-crash reports have a concrete trace instead of only the generic `tsup && electron .` lifecycle failure.
- Electron now logs secondary-instance handoff, `child-process-gone`, and process exit lifecycle, and a denied single-instance lock exits with code `0` instead of looking like a desktop dev failure.
- Electron quit tracing now records explicit quit sources and `window:close` sender metadata in `desktop-runtime.log`, and the tray quit handler no longer trips over a JavaScript ASI edge case during tests.
- Mobile/desktop schedule UIs now normalize automation `schedule` payloads before rendering or editing them, preventing malformed legacy automation records from blanking the schedules page.
- Desktop dashboard no longer auto-expands every newly observed active session, so external Codex/CLI sessions in the same project stop hijacking the desktop panel.
- Desktop session panels now auto-attach only recoverable sessions; active panels stay on `request_events` to avoid duplicate watcher replays and focus-stealing attach churn.
- Desktop fresh-session routing now keeps a ref-backed pending handshake in `CommandCenter`, so unrelated `attached` events cannot snap the input target back to an older session while the new session is still materializing.
- Desktop `+` / `Ctrl+N` now open the Quick Launch session launcher again, while the explicit fresh-session arm moved to the target menu's `New` option so launcher features are not lost.
- Desktop Quick Launch resume now forwards `resumeSessionId` through `Dashboard`, fixing the regression where choosing a past session in the launcher still started a brand-new one.
- Daemon session events now use a shared persistence buffer so watcher/PTy/live events create and update `sessionRecentEvents` even when the buffer did not exist yet; this closes a replay gap where terminal output could be visible but Events stayed empty after reconnect or restart.
- Session event replay history is now aligned to `500` entries across daemon persistence and desktop `sessionEventsMap`, reducing long-session cases where terminal scrollback outlived the replayable Events history.
- Project-memory init events, stored client events, resume-option events, and delayed PTY reparse events now all go through the same persistence path instead of several ad-hoc `list.push(...)` branches.
## 2026-03-26
- Release line now advances to `0.3.5`: npm already has `0.3.2` and `0.3.4`, so the hotfixes in this batch cannot safely reuse the `0.3.1` numbering branch.
- Desktop `0.3.5` NSIS packaging plus Android `assembleRelease` / `bundleRelease` now complete successfully from this workspace, so both release artifact paths are validated before publish.
- Shared queued terminal input now dispatches as soon as scrollback has stabilized for a few polls, instead of waiting only for an explicit prompt marker or the old 20s timeout fallback.
- Queued submit delays are now much shorter (`/slash` and normal text near-immediate, Codex multiline capped around 1.6s instead of 5-12s), and mobile terminal paths no longer add their own extra delayed `\r` on top of daemon-side queue submission.
- Desktop Quick Launch now sends `attach` immediately when it creates a desktop session, so a second session no longer sits idle until the user manually opens Terminal.
- Desktop launch-created sessions now carry `isAgentResume` plus saved project settings through that same immediate attach path, so the first `/qa` / `/secure` command is not dropped on a server-side missing session.
- 修正 Claude Code 桌面 Events fallback 污染：當 PTY fallback event 帶有 `Vibing...`、`thinking with max effort`、token/status footer 這類狀態列殘渣時，App 現在會在 `session_activity`、live `event`、`events_replay` 與 session digest 摘要層一併過濾，只保留 JSONL watcher 的正式 `response`。
- 移除 Claude / Cursor PTY fallback 回覆的 3000 字硬上限，`Claude responded (detailed)`、`Cursor responded (detailed)` 與 `Plan ready` 這類 fallback/info event 現在會保留完整 detail，不再因事件層裁切造成長回覆消失。
## Validation Snapshot (2026-03-25)
- `npm run test -w cli -- agent-launch.test.ts session-command-dispatch.test.ts codex.test.ts`: pass
- `npm run test -w app -- desktop-session-launch.test.ts session-attach.test.ts`: pass
- `npm run test -w app -- src/components/desktop/DesktopSessionPanel.test.tsx src/lib/automation-normalize.test.ts src/lib/terminal-renderer.test.ts src/lib/desktop-session-launch.test.ts src/lib/session-attach.test.ts`: pass
- `npm run test -w app -- src/lib/desktop-session-routing.test.ts src/lib/desktop-session-launch.test.ts src/components/desktop/DesktopSessionPanel.test.tsx src/lib/automation-normalize.test.ts src/lib/terminal-renderer.test.ts src/lib/session-attach.test.ts`: pass
- `npm run test -w app -- src/components/desktop/CommandCenter.test.tsx src/components/desktop/DesktopSessionPanel.test.tsx src/lib/desktop-session-routing.test.ts src/lib/session-attach.test.ts`: pass
- `npm run test -w app -- src/components/desktop/CommandCenter.test.tsx src/components/desktop/DesktopSessionPanel.test.tsx src/lib/desktop-session-routing.test.ts src/lib/session-attach.test.ts`: pass (fresh-attach stale-expand regression)
- `npm run test -w app -- src/components/desktop/CommandCenter.test.tsx src/lib/session-events.test.ts`: pass
- `npm run test -w app -- src/components/desktop/DesktopSessionPanel.test.tsx src/lib/desktop-session-routing.test.ts src/lib/session-attach.test.ts`: pass
- `npm run test -w app -- src/components/desktop/CommandCenter.test.tsx src/components/desktop/DesktopSessionPanel.test.tsx src/components/Dashboard.test.tsx src/lib/session-events.test.ts src/lib/desktop-session-routing.test.ts src/lib/session-attach.test.ts`: pass
- `npm run test -w app -- src/lib/session-summary.test.ts src/components/desktop/DesktopSessionPanel.test.tsx`: pass
- `npm run typecheck -w app`: pass
- `npm run test -w cli -- src/adapters/claude-code-response.test.ts src/adapters/cursor-response.test.ts`: pass
- `npm run build -w desktop`: pass
- `npm run typecheck -w cli`: pass
- `npm run typecheck -w app`: pass
- `npm run test -w cli -- session-command-dispatch.test.ts`: pass
- `npm run test -w desktop`: pass
- `npm run build -w desktop`: pass
- `npm run dev -w desktop`: stayed alive in smoke check, no immediate lifecycle failure reproduced locally

## Validation Snapshot
- `npm run typecheck -w app`: pass
- `npm run test -w app -- --run src/lib/session-events.test.ts src/lib/session-ordinals.test.ts src/lib/session-activity.test.ts`: pass
- `npm run typecheck -w app`: pass
- `npm run test -w app`: pass
- `npm run build -w app`: pass
- `npm run test:e2e -w app`: pass, `48/48`
- `npm run typecheck -w cli`: pass
- `npm run test -w cli`: pass
- `npm run build -w cli`: pass
- `npm run build -w desktop`: pass
- `npm run rebuild-pty -w desktop`: pass

## 2026-03-28
- Fixed the mobile image-send pipeline at the source: `MissionControl` and `TerminalView` no longer pre-upload images or stuff temporary file paths into the terminal input. Images now travel with the actual send payload, which removes the double-submit behavior and keeps image references valid for the receiving agent.
- Normalized app REST auth around `agentrune_api_token`. WebSocket pairing/session tokens are now mirrored into storage on connect and refresh, and `authedFetch()` prefers that token before falling back to `agentrune_cloud_token`.
- Reworked mobile file browsing to use authenticated API calls rather than treating a missing base URL as "computer disconnected". `FileBrowser` now loads directories via `buildApiUrl(...)` plus `authedFetch(...)`, keeps inline error state, and reports server failures instead of only showing a generic offline message.
- Added `POST /api/mkdir` to the daemon as the single folder-creation backend. The route validates names, confines writes to the home tree, handles existing-path conflicts explicitly, and gives the app a real success/error contract for "New Folder".
- Project creation now propagates backend errors through `App.tsx`, `LaunchPad`, and `NewSessionSheet`, so invalid paths or other server failures keep the create form open with a visible error instead of failing silently.
- Theme preference now supports `system` in addition to `light` and `dark`, with resolved-theme tracking wired into the app root plus mobile/desktop settings controls.
- Added regression coverage for the new auth and file-browser paths: `src/components/FileBrowser.test.tsx`, `src/lib/storage.test.ts`, and `e2e/mobile-daemon-regressions.spec.ts`.

## Validation Snapshot (2026-03-28)
- `C:\\Program Files\\Git\\bin\\bash.exe cli/safe-restart.sh`: pass
- `npm run typecheck -w app`: pass
- `npm run typecheck -w cli`: pass
- `npm run typecheck -w desktop`: pass
- `npm run test -w cli`: pass (`760` tests)
- `npm run test -w app`: pass (`432` tests)
- `npm run test -w desktop`: pass (`45` tests)
- `npm run test:e2e -w app`: pass (`54/54`)
- Real daemon WebSocket smoke: pass (`session_input` with inline base64 image created a persisted upload path and matching `user_message` event on first send)
