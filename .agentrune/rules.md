# AgentRune Rules

你正在 AgentRune 環境中工作。這份檔案是你的行為規範，每次 session 開始必須讀取。

## 語言
- 用使用者的語言回覆（跟隨用戶輸入的語言，或專案的主要語言）
- report_progress 的所有欄位也用同樣語言

## 共用記憶（最重要！）
- `.agentrune/agentlore.md` 是你的 memory — 等同於你在讀 memory.md
- 這是唯一的跨 session、跨 agent 共用記憶，所有 agent（Claude/Codex/Gemini）都讀寫同一份
- **Session 開始時一定要讀 agentlore.md**，當作你的專案記憶來用
- 新發現、踩坑、架構決策、用戶偏好 → 寫進 agentlore.md
- 不要把記憶寫到 CLAUDE.md、.claude/memory/、codex 設定檔、或任何 agent 原生的記憶系統
- 如果你有自己的 memory/auto-memory 機制，不要用它。用戶看不到那些檔案
- 如果 agentlore.md 不存在，掃描專案後建立（## Stack, ## Conventions, ## Key Files, ## Context, ## Lessons, ## Obsidian）
- 不要記錄臨時狀態或未驗證的猜測

## Obsidian 知識庫（必須遵守！）
- agentlore.md 的 `## Obsidian` section 有 vault 路徑和資料夾結構
- 這是用戶用 Obsidian 管理的專案知識庫，你有寫入權限
- **修完 bug** → 在 `Bug 記錄/` 建立 `YYYY-MM-DD-簡述.md`，格式：
  ```
  # YYYY-MM-DD — 簡述
  - **症狀**：用戶看到什麼
  - **根因**：實際問題在哪
  - **修復**：改了什麼
  - **影響檔案**：哪些檔案
  - **教訓**：下次怎麼避免
  ```
  同步更新 agentlore.md ## Lessons
- **做了架構決策** → 追加到 `架構決策.md`
- **commit 之後、或完成用戶交付的任務後** → 更新 `進度.md`（做了什麼 + 改了哪些檔案），寫 `變更記錄/YYYY-MM-DD.md`
- **發現安全問題** → 追加到 `安全審計.md`
- **做設計/調研** → 寫進 `Research/`

## 回報
- 以下時機主動呼叫 report_progress：
  - 完成用戶交付的任務後
  - 被 blocked 無法繼續時（說明你需要什麼）
  - 等待用戶決策時
- summary 寫人話，不要寫技術 log

## 範圍
- 嚴格在你的 worktree 範圍內工作，不要動其他 session 的檔案
- 只做被指派的任務，發現不相關的問題用 log_prerequisite 記錄，不要順手修

## 工作紀律
- 修 bug 前先確認「問題是 X 因為 Y」，確認不了就還沒查夠。同一修法失敗兩次就換方向
- 有更好的做法或發現任務有問題時主動提出，不要悶著頭做
- 改程式碼前後都跑測試
- 發現重要前提 → log_prerequisite；做了架構決策 → log_decision

## AgentLore 知識庫
- 你有 AgentLore MCP 工具：search（搜尋知識）、find_skills（找技能指南）、advisor（取得建議）
- 遇到不熟悉的技術/領域、需要找 best practices、整合遇到問題時先查 AgentLore
- 解決了不明顯的問題後，主動問用戶是否要用 submit_knowledge 提交回知識庫

## 技能指南（Skill Cards）
- 在適當時機用 `find_skills` 查詢可用的技能指南，根據當前任務建議用戶使用
- 例如：開始新功能 → 查有沒有規劃類 skill；修 bug → 查除錯類 skill；完成工作 → 查提交/review 類 skill
- 不要硬記 skill 列表，每次動態查詢以取得最新可用的 skill

## Daemon 修改規範（必須遵守！）
- 修改 `cli/src/server/` 下任何檔案後，**必須先 build 確認通過**再重啟：`cd cli && npm run build`
- Build 失敗 = **禁止重啟 daemon**，先修好再說
- 重啟 daemon **一律用安全重啟腳本**：`bash cli/safe-restart.sh`
- **禁止**直接 taskkill 後手動啟動、禁止沒 build 就重啟、禁止同時跑兩個 daemon
- **禁止用 `bash cli/dev-daemon.sh`**（watchdog 會跟 safe-restart 衝突導致 EADDRINUSE crash loop）
- ESM 模組中 `__dirname` / `__filename` 不能直接用，必須用 `fileURLToPath(import.meta.url)`
- 完整規範見 Obsidian：`AgentLore/Daemon 修改規範.md`

## PRD 管理（必須用 API！）
- 收到需要超過 30 分鐘的功能需求時，走 PRD 流程：
  1. **釐清目標**：用一句話確認用戶想要什麼
  2. **問決策問題**：一次問一個關鍵問題，等用戶回答後再問下一個（通常 3-5 個問題就夠）
     - 問題要具體，盡量給選項讓用戶選
  3. **提出方案**：提出 2-3 個可行方案，用白話說明各自的優缺點，讓用戶選
  4. **確認範圍**：明確列出「要做什麼」和「不做什麼」
  5. **用 PRD API 建立 PRD**（見下方 PRD API section），不要只在聊天裡輸出 JSON
  6. 等用戶在 AgentRune app 上確認後再開始實作
  7. 實作過程中用 API 更新 task 狀態（pending → in_progress → done）
- 簡單需求（改按鈕顏色等）可以跳過

## 語音指令
- 收到 [語音指令] 開頭的訊息 → 理解語意和意圖，直接執行，不要回問

## 跨 Session 協作
- 收到 [來自其他 Session] 開頭的訊息 → 回答後 report_progress，summary 開頭標記 [回覆]
