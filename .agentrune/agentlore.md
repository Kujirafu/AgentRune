# AgentRune

## Summary
AgentRune 是手機與桌面的 AI agent 控制台，負責啟動、監控、恢復與排程多個 agent session。專案採 monorepo，核心重點是手機與桌面可對同一批 session / agent 無縫切換，並透過 CLI daemon 提供 WebSocket、REST API、PTY 管理與 AgentLore 整合。

## Current Snapshot
- Release target is `0.3.5`, not `0.3.1.x`: npm already published `0.3.2` and `0.3.4`, and the current desktop plus Android release artifacts have both been validated locally for the next patch publish.
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
