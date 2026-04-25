# AgentRune

## Summary
AgentRune 是手機與桌面的 AI agent 控制台，負責啟動、監控、恢復與排程多個 agent session。專案採 monorepo，核心重點是手機與桌面可對同一批 session / agent 無縫切換，並透過 CLI daemon 提供 WebSocket、REST API、PTY 管理與 AgentLore 整合。

## Current Snapshot
- Release target is `0.3.7` (desktop-only patch on top of `v0.3.6`): mobile app code only changed in protocol text + e2e fixture, so Android keeps shipping `0.3.6` (versionCode 14) until the next batch — `v0.3.7` will be tagged with `--latest=false` so AgentLore's `releases/latest/download/agentrune.apk` link continues to resolve to the `0.3.6` Android artifact.
- Shared terminal input is now less latent across desktop and mobile: daemon-side queued sends can fall back to stabilized scrollback instead of waiting for a strict prompt marker, Codex multiline submit delay is much shorter, and mobile no longer stacks an extra client-side delayed Enter on top.
- Desktop Quick Launch now attaches new sessions immediately, so opening a second desktop session no longer waits for a manual Terminal click before its first `/qa` or skill-chain command can start.
- Desktop left-bottom widget is now a message center, not a permission-only shield: use it for approvals plus completed-session summaries and next steps.
- Desktop session activity feed now upserts by stable `eventId`, and desktop session `#` labels are fixed by creation-order ordinals instead of render-time sorting.
- Desktop auto-dispatch no longer treats short follow-up replies like `好` / `繼續` as new work: focused or active sessions win before new-session launch.
- Project memory is now systemized for installed desktop/CLI users: daemon startup auto-initializes `.agentrune`, MCP memory tools resolve against the local project instead of the first daemon session, and `agentrune memory ...` exposes init/index/sections/read/search/route commands.
- Monorepo workspaces: `app`, `cli`, `desktop`
- 共享規則入口: [rules.md](C:/Users/agres/Documents/Test/AgentRune-New/.agentrune/rules.md)
- 功能盤點: [FEATURES.md](C:/Users/agres/Documents/Test/AgentRune-New/.agentrune/FEATURES.md)
- 開發規範: [standards/config.json](C:/Users/agres/Documents/Test/AgentRune-New/.agentrune/standards/config.json)
- 目前專案記憶採「索引 + context 分檔」結構；新增知識請優先寫進對應 section

## Index
詳細記憶依主題拆在 `context/`：

- [Stack & Conventions](C:/Users/agres/Documents/Test/AgentRune-New/.agentrune/context/stack.md)
- [Architecture Decisions](C:/Users/agres/Documents/Test/AgentRune-New/.agentrune/context/decisions.md)
- [Lessons Learned](C:/Users/agres/Documents/Test/AgentRune-New/.agentrune/context/lessons.md)
- [Security](C:/Users/agres/Documents/Test/AgentRune-New/.agentrune/context/security.md)
- [Changelog](C:/Users/agres/Documents/Test/AgentRune-New/.agentrune/context/changelog.md)
- [Bug Reports](C:/Users/agres/Documents/Test/AgentRune-New/.agentrune/context/bugs.md)

## 2026-03-24 Update
- Desktop completion notices now follow explicit idle/end signals instead of waiting only for `digest.status === "done"`.
- `App.tsx` dispatches `agentrune_session_completed` on `session_activity` idle transitions and `session_ended`, `Sidebar.tsx` consumes those notices, and `DesktopSessionPanel.tsx` prefers explicit idle over stale working heuristics.

## 2026-03-25 Update
- Desktop keeps its existing agent assignment behavior, but Codex desktop skill-chain forwarding now uses queued multiline dispatch that continues after project-memory initialization and no longer leaves `/qa` stuck in the terminal input waiting for a manual Enter.
- Initial desktop messages created through the "no existing session" path are now persisted back into the event feed when the queued command is actually dispatched, so terminal output and Events stay aligned.
- Desktop session cards now stay in creation order instead of reordering by live status, and the message center only consumes explicit completion events while replacing older notices from the same session.
- Desktop packaging now pulls `node-pty` from the workspace root so packaged Electron builds include the PTY binaries they need at runtime.
- Codex now treats the global `bypass` toggle as an effective `danger-full-access` launch, attach/reconnect flows carry sandbox and trust settings consistently, daemon-side sandbox enforcement still runs through `SkillMonitor` + `AuthorityMap`, and desktop new-session launches no longer fall back to a hardcoded Claude agent.
- Desktop expanded session panels must send the same attach payload as terminal view on mount, not only `request_events`: otherwise brand-new desktop sessions look idle until the user manually switches to terminal, and input routing can appear to jump back to an older live session.
- Desktop `+` / `Ctrl+N` must explicitly arm a fresh session for the next send. Clearing the target alone is not enough, because the desktop router will otherwise keep reusing an actionable live session and make "new session" feel like an accidental resume.
- Desktop input-bar fresh-session intent must stay local to `CommandCenter`: it should not open Quick Launch, and `expandSessionId` / unrelated `attached` events must not clear that intent before the first send actually becomes an `attach`.
- Desktop fresh-session routing must keep a pending new-session handshake after the first `attach` send: stale `expandSessionId` updates must be ignored until the matching new `sessionId` answers `attached`, otherwise the input target can snap back to an older session and resume it.
- Desktop "no session" sends should reuse `buildSessionAttachMessage(...)` so the events-panel launch path carries the same locale/sandbox/trust payload as terminal attach instead of drifting into a slightly different attach shape.
- Electron desktop terminals should avoid `@xterm/addon-webgl` and stay on the default renderer; switching into terminal view was a likely renderer-crash path shared by both Codex and Claude desktop sessions.
- For queued desktop `session_input`, persist the `user_message` event as soon as the message is accepted into the queue instead of waiting until the delayed submit fires; otherwise Events can look blank long after the user already pressed send.
- Electron desktop dev launches should treat a denied single-instance lock as a clean secondary-instance handoff, not a failure path; log the handoff/quit/child-process lifecycle so `npm run dev -w desktop` can be distinguished from a real crash.
- Electron desktop quit diagnostics now record `quit source` and `window:close` sender metadata (`tray`, `auto_updater`, `electronAPI.close`, or `unknown`) in `desktop-runtime.log`, because recent flash-exit reports were clean `before-quit` exits rather than renderer crashes.
- Codex queued desktop input readiness now needs to recognize the real `· 96% left ·` status line and a plain terminal prompt fallback; otherwise `initialCommand` can stay stuck until some later UI interaction makes the session look ready.
- Schedule UIs should normalize automation `schedule` data before rendering or editing it; malformed or legacy automation records can otherwise blank the mobile schedules page even when the underlying automation API still responds.
- Desktop fresh-session routing must keep using the same `pendingNewSessionId` after the first send: later desktop sends should become `session_input` for that pending session, not a second `attach`, until `activeSessions` finally includes the new id.
- Desktop Events should semantically merge generic fallback agent replies like `Codex responded` into the later structured `response` event, and the Events panel should not hide that fallback outright; otherwise users can see duplicated replies when both sources arrive or terminal-only output when the watcher reply is late.

- Desktop dashboard must not auto-expand every newly observed active session: external Codex/CLI sessions in the same project can appear in `activeSessions`, and auto-expanding them steals focus from the user's explicit desktop workflow.
- Desktop expanded session panels should only auto-attach recoverable sessions. Active panels should `request_events` only, because re-attaching live sessions can replay old watcher output, duplicate Events, and re-surface unrelated Codex sessions.
- Desktop fresh-session routing now relies on ref-backed handshake state inside `CommandCenter`, so stale `attached` / expand events cannot yank the input target back to an older session before the new one becomes visible in `activeSessions`.
- Desktop `+` / `Ctrl+N` must remain the session launcher entrypoint: users expect agent selection and resume-history choices there. The explicit "fresh session for next send" action now lives in the target menu as `New`, instead of hijacking the launcher button.
- Desktop Quick Launch resume must forward `resumeSessionId` all the way through `Dashboard` into `onLaunch(...)`; otherwise the resume picker looks functional but silently starts a brand-new session.

## 2026-03-26 Update
- Session event persistence is now centralized in a shared daemon-side buffer helper. Live watcher / PTY / replay-derived events now create a `sessionRecentEvents` buffer on first write instead of silently skipping disk persistence when the buffer was missing.
- Session event history is now kept at `500` entries end-to-end instead of mixing `200` on disk with `500` in memory. This reduces the case where long-running or recently restarted sessions still show activity in terminal scrollback but the Events panel can only replay a shorter tail.
- Init-status events (`Initializing project memory` / completion), queued client-stored events, replayed resume decisions, and delayed PTY-derived events now all flow through the same persistence path, so Events replay after restart is less dependent on which producer created the event.

## 2026-04-04 Update
- Double-tap-to-send for gallery images is fixed: `InputBar` tracks active `FileReader` instances and defers the send until all images are loaded. Single tap now reliably sends text + images together.
- Image instruction to agent is now explicit: instead of `[Attached images — please read these files:]`, the PTY input now says `Please use your View/Read tool to open this image file before responding:` with forward-slash paths, so Claude Code reliably invokes View.
- FileBrowser safe area fixed: header now uses `calc(env(safe-area-inset-top, 0px) + 48px)` so content is not hidden behind the status bar on edge-to-edge Android (BUG-001 from QA report).
- Same safe area fix applied to SettingsSheet, InsightSheet, and LaunchPad headers.
- QA report v0.2.24: all actionable bugs confirmed fixed (BUG-001 today, BUG-003/004/005/006/IMP-001 previously). BUG-002 (Seasons) is not a feature in this codebase.
- Codex session binding is stricter now: fresh AgentRune Codex launches no longer attach to the most recently modified Codex JSONL from the same project tree. New watchers wait for a JSONL created after the fresh launch window, and resumed/live sessions reuse a persisted `codexJsonlPath` so mobile does not accidentally mirror an older desktop Codex run.
- Mobile `SettingsSheet` now gives Gemini and Cursor the same preset-first model UX as Codex. Common model IDs are tappable cards, while manual typing remains available as an advanced fallback for custom IDs.
- Desktop Windows packaging now avoids stale `release/win-unpacked` lock failures by building into `desktop/release-build` first and then mirroring the top-level installer artifacts back into `desktop/release`. Keep using `npm run package -w desktop`; do not switch back to a direct `electron-builder --win` call unless the old locked-output issue is re-audited.
- Release staging now has a root `npm run release:assets` step that copies both updater-native desktop files using the exact `latest.yml` names (`AgentRune-Setup-<version>.exe` + `.blockmap`) and website-friendly aliases (`agentrune-desktop.exe`, `agentrune.apk`, `agentrune.aab`) into `.release-assets`, so AgentLore can keep using its fixed `releases/latest/download/...` links without extra website changes.
- Desktop packaging now launches `electron-builder` through an explicit `cmd.exe /c` wrapper on Windows instead of `shell: true`, which removes the Node child-process safety warning from release builds.

## 2026-03-28 Update
- Mobile image sends are now single-shot across both `MissionControl` and `TerminalView`: the client no longer pre-uploads images or injects a temporary file path into the terminal input before the real send. Image payloads ride with the actual `input` / `session_input` message, which fixes the "press send twice" regression and avoids stale upload paths that Codex later reports as missing.
- App-side REST auth is now normalized through `agentrune_api_token`. WebSocket session tokens are mirrored into local storage on connect and refresh, and `authedFetch()` now prefers that token before falling back to the older cloud token. File-browse and project-management flows can therefore authenticate even when there is no separate cloud token in storage.
- File browsing and folder creation now use authenticated first-party APIs instead of a brittle "connected computer" heuristic. `FileBrowser` builds URLs through `buildApiUrl(...)`, reads directories with `authedFetch(...)`, surfaces real server errors inline, and creates folders through the new daemon route `POST /api/mkdir`.
- The daemon now owns folder creation through `/api/mkdir`, including path validation, home-directory confinement, and conflict handling. This replaces the old silent failure path from the mobile browser UI and gives the app a single source of truth for directory creation.
- Project creation errors are no longer swallowed in the app. `App.tsx`, `LaunchPad`, and `NewSessionSheet` now preserve server-side failure details and keep the form open instead of dismissing it on a failed create.
- Theme preference now supports `system` end-to-end. The app resolves light/dark from `prefers-color-scheme`, persists the explicit preference separately from the resolved theme, and updates mobile/desktop theme toggles to reflect the three-state cycle.
- The legacy QA report for `0.2.24` was triaged against the current tree. The actionable items were project-create failure handling, file browser/new folder behavior, and system-theme support; the old `Seasons` issue does not map to a current feature in this repository.
- Validation completed locally after a safe daemon restart: `npm run typecheck -w app`, `npm run typecheck -w cli`, `npm run typecheck -w desktop`, full app/cli/desktop test suites, `npm run test:e2e -w app`, and a real daemon WebSocket smoke that attached a session and sent a single message carrying an inline base64 image payload.

## How To Maintain
- 開 session 先讀這份索引，不要預設把所有 context section 一次讀完
- 依目前任務只打開相關 section，需要時再補讀其他 section
- Stack / key files / build 流程更新到 `context/stack.md`
- 架構選擇與長期約束更新到 `context/decisions.md`
- 踩坑、操作提醒、測試經驗更新到 `context/lessons.md`
- 安全審查、修補與剩餘風險更新到 `context/security.md`
- 重要修正與驗證結果更新到 `context/changelog.md`
- 問題根因與修法更新到 `context/bugs.md`
- 這份索引保持精簡，不再把長篇內容堆回單一檔案
