# AgentRune v2 — 指令驅動多 Agent 協作平台

## 設計摘要

**核心轉變**：從「把終端機搬到手機」轉為「指令驅動的多 agent 協作平台」。

**用戶旅程**：指令 → 結構化結果 → 指令 → 結構化結果。用戶不需要懂技術細節。

**設計決策記錄**：

| 問題 | 選項 | 決策 | 理由 |
|------|------|------|------|
| 指令形式 | 自然語言 / /command / 混合 | 混合 | 自然語言保留彈性，/command 確保關鍵流程品質 |
| 多 session 模型 | 單一 / 平行 worktree / 主從 | 平行 worktree | Codex 驗證可行，用戶可控，是主從模式的基礎設施 |
| 規範機制 | _reminder / MCP gate / MCP+CLAUDE.md | MCP gate keeper | 統一規範，不綁定特定 agent |
| 結果呈現 | 原始事件流 / 結構化摘要 / 對話式 | 結構化摘要卡 | 一致性高、agent 無關、手機友好 |
| Command 定義 | 硬編碼 / 雲端 / 本地設定檔 | AgentLore 雲端 | 可遠端更新、不需升級 CLI |
| 約束執行 | PTY 攔截 / MCP 唯一出口 | PTY 攔截 + 注入提示 | 保留透明度、容易實作 |
| APP 導航 | Grid / 垂直列表+展開 / Kanban / 垂直+inline card | 垂直列表 + inline progress card | 一眼全局 + 直接操作，不用展開 |
| 設定位置 | 卡片齒輪 / 詳情 tab / 建立時 / 兩層 | 兩層（全域齒輪 + session 長按） | 全域在 Project Panel，session 在一級頁面長按 |
| Obsidian 同步 | 手動 / 自動 | 自動（MCP tool 觸發寫入） | agent 之間透過 Obsidian 傳遞知識 |

---

## 架構五大支柱

### 1. MCP Gate Keeper（統一規範層）

AgentLore 雲端定義 command 和行為規範，AgentRune CLI 執行約束。不綁定任何特定 agent（Claude Code、Codex、Gemini CLI 皆適用）。

**Command 生命週期：**
1. CLI 啟動時從 AgentLore 拉取 command 定義
2. 用戶在 APP 選擇 /command 或輸入自然語言
3. CLI 注入對應的 MCP tool 呼叫提示到 agent PTY
4. Agent 呼叫 MCP tool（例如 `report_progress`）
5. MCP server 驗證結果格式，不符合則拒絕並要求補充
6. 驗證通過 → CLI 發送結構化結果到 APP

**預定義 Command 範例：**
- `/resume` — agent 統整過去的工作故事 + 建議下一步可做的事
- `/status` — agent 回報當前專案狀態（改了什麼、還有什麼待做）
- `/report` — 強制 agent 用結構化格式回報最近完成的工作
- `/deploy` — 觸發部署流程並回報結果
- `/test` — 跑測試並回報結構化結果

### 2. 結構化結果卡（取代原始事件流）

Agent 完成工作後必須呼叫 `report_progress` MCP tool。CLI 攔截驗證，通過後渲染成任務完成卡。

**結果卡結構：**
```typescript
interface ProgressReport {
  title: string           // "API 重構完成"
  status: "done" | "blocked" | "in_progress"
  filesChanged: number
  linesAdded: number
  linesRemoved: number
  testResults?: {
    total: number
    passed: number
    failed: number
  }
  nextSteps: string[]     // ["部署到 staging", "寫整合測試"]
  details?: string        // 展開面板的詳細說明
}
```

**APP 渲染：**
- 主畫面只顯示結果卡（標題、摘要指標、下一步建議）
- 展開面板包含：diff、tool calls、思考過程、原始 agent 回覆
- Terminal panel 保留給進階用戶查看原始輸出

### 3. 多 Session / Worktree 並行

用戶可同時開多個 session，各自跑在獨立 git worktree。

**Session 生命週期：**
1. 用戶在 APP 點「新 Session」，選擇 agent 類型
2. CLI 建立 git worktree（`.worktrees/<branch-name>`）
3. 在 worktree 中啟動 agent PTY
4. Agent 工作完全隔離在自己的 worktree
5. 完成後用戶可在 APP 上：合併回 main / 建立 PR / 丟棄

**APP 顯示：**
- LaunchPad 顯示所有 session 卡片，每個有獨立狀態指示
- 點進 session 看結果卡列表
- 跨 session 切換不會干擾正在進行的工作

**Worktree 管理：**
- CLI 負責 worktree 建立和清理
- 自動命名：`worktrees/<date>-<task-slug>`
- Session 結束且已合併 → 自動清理 worktree
- Session 結束但未合併 → 保留 worktree，標記為「待處理」

### 4. PTY 攔截 + 智慧提示

CLI 監控 agent PTY 輸出，在關鍵時機自動注入提示。

**攔截規則：**
- 偵測到任務完成信號（agent idle + 有輸出）但沒呼叫 `report_progress` → 注入提示文字到 PTY：「請呼叫 report_progress MCP tool 回報你的工作成果」
- 偵測到危險操作（force push、rm -rf、drop table）→ 攔截並發送確認請求到 APP
- 偵測到 agent 卡住（長時間 idle 無輸出）→ 通知 APP

**原始輸出保留：**
- Agent 的所有 PTY 輸出仍然記錄在 terminal panel
- 進階用戶可隨時切換到 terminal 查看完整交互
- 結構化結果卡和原始 terminal 是兩個平行的 view

### 5. Agent 無關性

所有規範通過 MCP 統一執行。任何支援 MCP 的 agent 都可以接入。

**目前支援的 Agent：**
- Claude Code（JSONL watcher + PTY adapter）
- Codex CLI（codex-watcher adapter）
- Gemini CLI（gemini-watcher adapter）
- Aider、Cline、OpenClaw（PTY adapter）

**統一接口：**
- 不管用哪個 agent，用戶看到的都是相同的結構化結果卡
- 不管用哪個 agent，/command 的行為都一樣
- Agent 差異由 adapter 層吸收，上層完全無感

### 6. Obsidian 共享記憶體（跨 Session 知識傳遞）

每個 agent session 是 fresh 的，但透過 Obsidian vault 獲得完整專案知識。Obsidian 是 agent 之間的共享記憶體。

**MCP Documentation Tools：**

寫入（agent 做完事後呼叫）：
- `report_progress` — 回報工作成果 → 寫入 進度.md + 變更記錄/ + 狀態總覽.md
- `log_prerequisite` — 記錄前提條件（踩過的坑、限制、為什麼現在長這樣）→ 寫入 前提條件.md
- `log_decision` — 記錄架構決策（選了什麼、為什麼、替代方案）→ 寫入 架構決策.md

讀取（新 session 啟動時自動呼叫）：
- `get_project_context` — 回傳 狀態總覽 + 前提條件 + 最近進度 + 架構決策

**知識循環：**
```
Agent A 做事 → report_progress / log_prerequisite / log_decision → 寫入 Obsidian
                                                                       ↓
Agent B 新 session → get_project_context → 讀取 Obsidian → 帶完整上下文工作
```

**Obsidian 自動同步結構（每專案一個資料夾）：**
```
{專案名}/
├── 狀態總覽.md       ← 覆寫：各 session 狀態表格
├── 進度.md           ← append：最近 progress reports
├── 前提條件.md       ← merge：為什麼現在長這樣（去重）
├── 架構決策.md       ← append：重大決策記錄
├── 開發流程.md       ← 覆寫：技術棧 + 指令參考
├── 變更記錄/
│   └── YYYY-MM-DD.md ← append：當天詳細 report
├── Bug記錄/
│   └── YYYY-MM-DD.md ← append：blocked/error 的 report
└── 測試結果/
    └── YYYY-MM-DD.md ← append：有 testResults 的 report
```

**自動分流規則：**
- 每次 report_progress → 進度.md + 變更記錄/
- 狀態總覽.md → 每次覆寫更新
- status: "blocked" 或有 error → 同時寫 Bug記錄/
- 有 testResults → 同時寫 測試結果/
- log_prerequisite → 前提條件.md（merge 去重）
- log_decision → 架構決策.md（append）

---

## APP 導航架構

### 導航層級

```
Project Panel（左滑進入）
  └─ Session Overview（一級頁面，垂直列表 + inline progress card）
       ├─ 長按 session → 設定浮層（model、mode 等）
       ├─ 點「回應」/「合併」→ 直接操作
       └─ 點卡片 → Session Detail（二級頁面）
            ├─ Progress 歷史（ProgressCard 列表）
            ├─ Terminal（原始輸出）
            └─ Diff（檔案變更）
```

### 一級頁面：Session Overview

- **頂部**：專案名稱 + ⚙️ 全域設定 + 「+ 新 Session」按鈕
- **主體**：垂直捲動 session 卡片列表，每張包含：
  - Agent icon + 名稱 + 狀態燈（Working / Done / Blocked）
  - Session 標籤（task slug 或自訂名稱）
  - 最近一張 ProgressCard 精簡版
  - 動作按鈕：Working→查看 | Done→合併/丟棄 | Blocked→回應
- **長按卡片** → session 設定浮層（model、mode、重命名、刪除）
- **新增 session** → 選 agent → 設定 → 可選 worktree 隔離 → 開始

### 二級頁面：Session Detail

- **頂部**：返回 + session 名稱 + 狀態
- **主體**：ProgressCard 歷史（最新在上）
- **底部**：InputBar（下指令）
- **可切換 panel**：Terminal / Diff / Files

### Project Panel（左滑）

專案列表，每個顯示名稱 + 活躍 session 數量。頂部 ⚙️ 全域設定。

---

## 與現有架構的關係

**保留：**
- WebSocket server（CLI ↔ APP 通訊）
- PTY manager（管理 agent 進程）
- Adapter 層（agent 特定的解析邏輯）
- MCP stdio server（AgentLore proxy + local tools）
- JSONL watcher（Claude Code 結構化事件）
- APP 的 Capacitor 架構

**修改：**
- Parse engine：增加任務完成偵測 + 提示注入邏輯
- MCP server：新增 `report_progress`、`log_prerequisite`、`log_decision`、`get_project_context`、`fetch_commands` 等 tool
- ws-server：新增 worktree 管理、多 session 路由
- APP MissionControl：從事件流列表改為結果卡列表
- APP LaunchPad：多 session 卡片管理

**新增：**
- Worktree manager（CLI 端管理 git worktree 生命週期）
- Command registry（從 AgentLore 拉取 command 定義）
- Progress interceptor（偵測任務完成 + 注入提示）
- Obsidian sync module（MCP tool → Obsidian vault 自動寫入）
- AgentLore API：`/api/agentrune/commands` 端點（command 定義 CRUD）

---

## 優先順序

1. **MCP Gate Keeper** — `report_progress` + `log_prerequisite` + `log_decision` + 驗證邏輯
2. **Obsidian 共享記憶體** — 自動寫入 vault + `get_project_context` 讀取
3. **結構化結果卡** — APP 端 UI 改造（EventCard → ProgressCard）
4. **PTY 攔截 + 提示注入** — 偵測任務完成 + 注入 MCP 呼叫提示
5. **多 Session / Worktree** — worktree manager + 多 session UI
6. **APP 導航重構** — Project Panel + Session Overview + Session Detail
7. **Command Registry** — AgentLore 端 command 定義 + CLI 拉取 + APP 選單
