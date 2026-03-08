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
| 交互模式（一級） | 純指揮 / 指揮+快速回應 / 指揮+全域指令 | 指揮+快速回應 | Blocked 時不用切頁面就能回應，最常用操作零步驟 |
| 交互模式（二級） | 純指令 / 指令+對話切換 / 混合 | 混合 | /command 出結果卡，自然語言就是對話，不需切換思維 |
| PRD/規劃功能 | /command / 按鈕 / 新 session 引導 | 新 session 自動引導 | 新手自然被引導，老手可永久跳過，PRD 存入 vault |

---

## 架構六大支柱

### 1. MCP Gate Keeper（統一規範層）

AgentLore 雲端定義 command 和行為規範，AgentRune CLI 執行約束。不綁定任何特定 agent（Claude Code、Codex、Gemini CLI 皆適用）。

**Command 生命週期：**
1. CLI 啟動時從 AgentLore 拉取 command 定義
2. 用戶在 APP 選擇 /command 或輸入自然語言
3. CLI 注入對應的 MCP tool 呼叫提示到 agent PTY
4. Agent 呼叫 MCP tool（例如 `report_progress`）
5. MCP server 驗證結果格式，不符合則拒絕 + PTY 注入引導提示
6. 驗證通過 → CLI 發送結構化結果到 APP

**預定義 Command（11 個）：**

核心：
- `/resume` — 統整過去的工作故事 + 建議下一步（讀取 vault）
- `/status` — 回報所有 session 狀態
- `/report` — 強制結構化回報最近完成的工作 → 進度.md + 變更記錄/

開發流程：
- `/test` — 跑測試 + 結構化回報 → 測試結果/
- `/deploy` — 部署 + 回報結果 → 變更記錄/
- `/merge` — 合併 worktree 回 main → 變更記錄/
- `/review` — 自我 review 改動 + diff 摘要

知識管理：
- `/note` — 記錄前提條件或決策 → 前提條件.md / 架構決策.md
- `/context` — 讀取專案上下文（手動觸發 get_project_context）

分析：
- `/analysis` — 分析程式碼（效能/安全/架構），產出結構化報告
- `/insight` — 提煉洞察（踩坑/pattern/發現）→ 前提條件.md / 架構決策.md

### 2. 結構化結果卡（取代原始事件流）

Agent 完成工作後必須呼叫 `report_progress` MCP tool。CLI 攔截驗證，通過後渲染成任務完成卡。

**結果卡結構（自然語言優先）：**
```typescript
interface ProgressReport {
  title: string           // "重構了 auth middleware"（用用戶的語言）
  status: "done" | "blocked" | "in_progress"
  summary: string         // "改了 3 個檔案，測試全過（5/5）"（自然語言描述）
  nextSteps: string[]     // ["部署到 staging", "寫整合測試"]
  details?: string        // 展開面板的詳細說明
}
```

注意：不使用 `filesChanged`、`linesAdded`、`testResults` 等技術欄位。所有數據由 agent 用自然語言寫在 `summary` 裡，用戶直接看得懂。

**APP 渲染：**
- 主畫面只顯示結果卡（標題、摘要、下一步建議）
- 展開面板包含：diff、tool calls、思考過程、原始 agent 回覆
- Terminal panel 保留給進階用戶查看原始輸出
- **零 emoji** — 所有狀態用色條、圓點指示燈、線條風格 icon 表示
- 延續現有 APP 的雙色主題（亮/暗）設計語言

**結果卡視覺設計：**

精簡版（一級頁面 inline）：
```
┌─────────────────────────────────┐
│ [綠色圓點] 重構 auth middleware │
│ 3 files  +42  -18  Tests 5/5   │
└─────────────────────────────────┘
```

完整版（二級頁面）：
```
┌─────────────────────────────────┐
│ [綠色左邊條]                    │
│ [Done 標籤] 重構 auth middleware│
│                                 │
│ 改了 3 個檔案，測試全過（5/5）  │
│ 耗時 2m 34s                     │
│                                 │
│ 下一步：                        │
│  > 部署到 staging               │
│  > 寫整合測試                   │
│                                 │
│ [v 展開詳情]                    │
└─────────────────────────────────┘
```

狀態視覺：
| 狀態 | 指示 | 卡片樣式 |
|------|------|---------|
| done | 綠色圓點 | 綠色左邊條 |
| in_progress | 藍色圓點 + 脈動動畫 | 藍色左邊條 |
| blocked | 紅色圓點 | 紅色左邊條 + 展開回應輸入框 |

### 3. 多 Session / Worktree 並行

用戶可同時開多個 session，各自跑在獨立 git worktree。

**Session 生命週期：**
1. 用戶在 APP 點「新 Session」，選擇 agent 類型
2. 規劃引導（可跳過/永久關閉）
3. CLI 建立 git worktree（`.worktrees/<branch-name>`）
4. 在 worktree 中啟動 agent PTY
5. Agent 工作完全隔離在自己的 worktree
6. 完成後用戶可在 APP 上：合併回 main / 建立 PR / 丟棄

**APP 顯示：**
- Session Overview 顯示所有 session 卡片，每個有獨立狀態指示
- 點進 session 看結果卡 + 對話混合列表
- 跨 session 切換不會干擾正在進行的工作

**Worktree 管理：**
- CLI 負責 worktree 建立和清理
- 自動命名：`worktrees/<date>-<task-slug>`
- Session 結束且已合併 → 自動清理 worktree
- Session 結束但未合併 → 保留 worktree，標記為「待處理」

### 4. PTY 攔截 + 智慧提示

CLI 監控 agent PTY 輸出，在關鍵時機自動注入提示。

**攔截規則：**
- 偵測到任務完成信號（agent idle + 有輸出）但沒呼叫 `report_progress` → 注入提示文字到 PTY
- 偵測到危險操作（force push、rm -rf、drop table）→ 攔截並發送確認請求到 APP
- 偵測到 agent 卡住（長時間 idle 無輸出）→ 通知 APP
- 偵測到依賴安裝指令（npm install、pip install 等）→ 攔截並請求確認
- 偵測到單檔案大量改動（超過閾值）→ 警告

**硬性執行機制（系統強制）：**
| 機制 | 說明 | 執行方式 |
|------|------|---------|
| 危險指令攔截 | force push、rm -rf、drop database | PTY 攔截，發確認到 APP |
| Worktree 隔離 | agent 不能操作 worktree 外的檔案 | PTY 攔截 cd 到 worktree 外 |
| 成本上限 | agent 陷入死循環時自動暫停 | PTY 偵測 token 用量，超閾值暫停通知用戶 |
| 依賴安裝攔截 | 防止 agent 亂升 package | PTY 攔截 install 指令，需確認 |
| 大改動警告 | 防止 agent 重寫整個檔案 | 偵測 diff 行數超閾值，警告 |
| Idle 超時 | agent 卡住通知用戶 | PTY idle 偵測 → 通知 APP |

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

**儲存位置：**
- 設定檔 `~/.agentrune/config.json` 裡的 `vaultPath` 欄位
- 預設：`~/.agentrune/knowledge/`（不依賴 Obsidian）
- 有 Obsidian 的用戶可設成自己的 vault 路徑（例如 `~/Documents/Obsidian/MyVault/`）
- 寫入的都是標準 markdown 檔案，任何編輯器都能看

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
- summary 中包含測試結果 → 同時寫 測試結果/
- log_prerequisite → 前提條件.md（merge 去重）
- log_decision → 架構決策.md（append）

---

## MCP 規範

### MCP Tool 定義

**`report_progress`** — 回報工作進度（核心 tool）
```typescript
{
  title: z.string(),                                    // 必填，用用戶語言
  status: z.enum(["done", "blocked", "in_progress"]),   // 必填
  summary: z.string(),                                  // 必填，自然語言描述
  nextSteps: z.array(z.string()),                       // 必填
  details: z.string().optional(),                       // 展開面板
}
```

驗證規則：
- `title` 和 `summary` 不可為空
- `status === "blocked"` 時 `summary` 必須說明原因和需要什麼
- `status === "done"` 時 `nextSteps` 至少一項
- 驗證失敗 → MCP 回傳 error + CLI 同時注入 PTY 提示教 agent 怎麼補

**`log_prerequisite`** — 記錄前提條件
```typescript
{
  content: z.string(),    // 前提條件內容（為什麼現在是這樣、踩了什麼坑）
  context: z.string().optional(),  // 相關的程式碼或檔案路徑
}
```

**`log_decision`** — 記錄架構決策
```typescript
{
  decision: z.string(),      // 決定了什麼
  reasoning: z.string(),     // 為什麼這樣決定
  alternatives: z.string().optional(),  // 考慮過的替代方案
}
```

**`get_project_context`** — 讀取專案上下文
```typescript
// 無參數，直接回傳 vault 內容
// 回傳：狀態總覽 + 前提條件 + 最近進度 + 架構決策
```

### MCP _reminder 規範

每個 tool 回傳時附帶簡短通知風格的 _reminder：

**`report_progress` _reminder：**
```
回報成功。提醒：
- summary 寫人話，用戶語言
- 卡住了就說你需要什麼
- 每完成一段有意義的工作就報一次
```

**`log_prerequisite` _reminder：**
```
前提條件已記錄。提醒：
- 記錄「為什麼」不是「是什麼」
- 未來的 agent 會讀這份紀錄
```

**`log_decision` _reminder：**
```
決策已記錄。提醒：
- 包含替代方案和理由
- 不要推翻已有決策，除非有明確理由
```

**`get_project_context` _reminder：**
```
上下文已載入。提醒：
- 先讀完再開始工作
- 注意前提條件中的限制和踩坑
```

### Agent 行為規範（CLI 啟動時注入 PTY）

分為硬性機制（系統強制）和軟性規則（提示注入，盡力而為）：

**軟性規則：**
```
你正在 AgentRune 環境中工作。

【語言】（全域通用）
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
```

注意：軟性規則只是建議，agent 有時會遵守有時不會。真正有效的約束靠硬性機制（見 PTY 攔截章節）。

### /Command 具體規範

每個 /command 被觸發時，CLI 注入到 PTY 的完整 prompt：

**核心：**

`/resume`：
```
統整過去的工作並建議下一步。步驟：
1. 呼叫 get_project_context 讀取 vault
2. 整理成工作摘要：最近做了什麼、目前狀態、未完成的事
3. 建議 2-3 個下一步，按優先順序
4. report_progress(status="done")
```

`/status`：
```
回報當前 session 的工作狀態。步驟：
1. 檢查 git status、最近的改動、未完成的工作
2. 彙整成簡短狀態報告
3. report_progress(status="in_progress" 或 "done")
```

`/report`：
```
強制回報最近完成的工作。步驟：
1. 檢查 git log 和 git diff 了解最近的改動
2. 彙整成結構化報告
3. report_progress，所有欄位盡量填完整
4. 這是強制回報，即使你覺得沒什麼好報的也要報
```

**開發流程：**

`/test`：
```
執行專案的測試套件並結構化回報結果。步驟：
1. 找到專案的測試指令（package.json scripts、Makefile、或常見測試框架）
2. 執行測試
3. 分析結果，失敗的說明原因和建議修法
4. report_progress，summary 包含通過/失敗數量
```

`/review`：
```
Review 目前的改動並產出結構化摘要。步驟：
1. git diff 查看所有變更
2. 逐檔案分析：改了什麼、潛在問題
3. 檢查測試覆蓋、安全、效能
4. report_progress，details 包含 review 摘要
```

`/deploy`：
```
執行部署流程並回報結果。步驟：
1. 先跑測試，失敗就 blocked 停止
2. 執行部署
3. 驗證是否成功
4. report_progress 包含結果和 URL
```

`/merge`：
```
合併當前 worktree 的改動回 main。步驟：
1. 先 /review + /test
2. 執行 merge/rebase
3. 有衝突嘗試解決，記錄原因
4. 解不了就 blocked
5. 成功就 report_progress
```

**知識管理：**

`/note`：
```
記錄前提條件或架構決策。步驟：
1. 判斷是前提條件還是架構決策
2. 前提 → log_prerequisite | 決策 → log_decision
3. report_progress(status="done")
```

`/context`：
```
讀取專案上下文。步驟：
1. 呼叫 get_project_context
2. 整理成易讀摘要
3. report_progress(status="done")
```

**分析：**

`/analysis`：
```
分析程式碼並產出結構化報告。步驟：
1. 確認分析方向（效能/安全/架構/全部）
2. 深入分析，每個發現標嚴重程度
3. report_progress，details 包含完整報告
```

`/insight`：
```
提煉工作中的洞察。步驟：
1. 回顧最近工作
2. 提煉踩坑、pattern、技術決定
3. 分類記錄：前提 → log_prerequisite | 決策 → log_decision
4. report_progress 列出記錄了什麼
```

---

## APP 導航架構

### 導航層級

```
Project Panel（左滑進入）
  └─ Session Overview（一級頁面，垂直列表 + inline progress card）
       ├─ 長按 session → 設定浮層（model、mode 等）
       ├─ Blocked → 展開輸入框直接回應（不離開一級頁面）
       ├─ 點「合併」/「丟棄」→ 直接操作
       └─ 點卡片 → Session Detail（二級頁面）
            ├─ 混合顯示：ProgressCard + 對話氣泡
            ├─ Terminal（原始輸出）
            └─ Diff（檔案變更）
```

### 一級頁面：Session Overview

- **頂部**：專案名稱 + 全域設定齒輪 + 「+ 新 Session」按鈕
- **主體**：垂直捲動 session 卡片列表，每張包含：
  - Agent icon + 名稱 + 狀態指示燈（Working / Done / Blocked）
  - Session 標籤（task slug 或自訂名稱）
  - 最近一張 ProgressCard 精簡版
  - 動作按鈕：Working→查看 | Done→合併/丟棄 | Blocked→回應
- **長按卡片** → session 設定浮層（model、mode、重命名、刪除）
- **交互模式**：指揮 + 快速回應 — Blocked 的 session 可直接在卡片展開輸入框回應

### 新 Session 規劃引導

**流程：**
1. 用戶點「+ 新 Session」→ 選 agent
2. 自動跳出「要先規劃一下嗎？」
   - 「開始規劃」→ 進入引導式 brainstorm 對話（一次一個問題，多選為主，含分析和建議）
   - 「跳過，直接開始」→ 直接開 session
   - 「以後都跳過」→ 記住偏好（全域設定可恢復）
3. Brainstorm 完成 → 產出結構化 PRD 卡片（目標、建議架構、風險、步驟）
4. PRD 自動存入 vault
5. 「要根據這個規劃開 session 嗎？」→ 是：直接開 session，agent 啟動時讀 PRD | 先不要：PRD 存著備用

### 二級頁面：Session Detail

- **頂部**：返回 + session 名稱 + 狀態
- **主體**：混合顯示 — ProgressCard（結構化結果）+ 對話氣泡（自然語言交互），視覺樣式區分
- **底部**：InputBar — 打 /command 出結果卡，打自然語言就是對話，不需切換模式
- **可切換 panel**：Terminal / Diff / Files

### Project Panel（左滑）

專案列表，每個顯示名稱 + 活躍 session 數量。頂部全域設定齒輪。

### UI 設計規範

- **零 emoji** — 所有狀態、標題、按鈕都不使用 emoji
- **雙色主題** — 延續現有亮/暗雙主題設計
- **色條指示** — 卡片左邊條表示狀態（綠=done、藍=working、紅=blocked）
- **線條風格 icon** — 不使用填滿式圖標
- **指示燈** — 小圓點表示狀態

**手勢操作：**
- 左滑 session 卡片 → 快捷動作（合併/丟棄/刪除）
- 下拉 → 重新整理所有 session 狀態
- 左滑整個頁面 → Project Panel

**動畫：**
- 新結果卡出現 → 從上方滑入
- Session 狀態改變 → 狀態燈顏色過渡
- Working 的 session → 結果卡區域微妙脈動

---

## 與現有架構的關係

**保留：**
- WebSocket server（CLI <-> APP 通訊）
- PTY manager（管理 agent 進程）
- Adapter 層（agent 特定的解析邏輯）
- MCP stdio server（AgentLore proxy + local tools）
- JSONL watcher（Claude Code 結構化事件）
- APP 的 Capacitor 架構

**修改：**
- Parse engine：增加任務完成偵測 + 提示注入邏輯
- MCP server：新增 `report_progress`、`log_prerequisite`、`log_decision`、`get_project_context` 等 tool
- ws-server：新增 worktree 管理、多 session 路由、硬性攔截機制
- APP：從 LaunchPad+MissionControl 重構為 SessionOverview+SessionDetail+ProjectPanel

**新增：**
- Worktree manager（CLI 端管理 git worktree 生命週期）
- Command registry（從 AgentLore 拉取 command 定義）
- Progress interceptor（偵測任務完成 + 注入提示 + 硬性攔截）
- Vault sync module（MCP tool → Obsidian vault 自動寫入）
- AgentLore API：`/api/agentrune/commands` 端點（command 定義 CRUD）

---

## 優先順序

1. **MCP Gate Keeper** — `report_progress` + `log_prerequisite` + `log_decision` + `get_project_context` + 驗證邏輯 + _reminder
2. **Vault 寫入模組** — report_progress → markdown 自動寫入 + get_project_context 讀取
3. **Agent 行為規範注入** — CLI 啟動時注入全域規範到 PTY
4. **結構化結果卡** — APP 端 ProgressCard 元件（零 emoji、色條、雙主題）
5. **PTY 攔截 + 硬性機制** — idle 偵測 + 危險指令攔截 + 成本上限 + 依賴攔截
6. **多 Session / Worktree** — worktree manager + 多 session 路由
7. **APP 導航重構** — SessionOverview + SessionDetail + ProjectPanel（取代 LaunchPad+MissionControl）
8. **新 Session 規劃引導** — PRD brainstorm 流程 + vault 存儲
9. **Command Registry** — AgentLore 端 /command 定義 + CLI 拉取 + APP 選單

---

## 補充設計決策

| 議題 | 決策 | 理由 |
|------|------|------|
| 通知 | Capacitor Local Notification 先做，FCM 未來 | 零成本零依賴，主動監控場景為主 |
| 合併衝突 | 派 agent 解決 + 記錄到 vault | 手機上解 conflict 體驗差，符合「指令→結果」 |
| Agent 啟動流程 | CLI 先讀 vault，直接注入上下文到 PTY | 不依賴 agent 配合，所有 agent 通用 |
| 成本追蹤 | Parse engine 從 PTY 輸出解析 | agent 不知道自己花費，只能被動收集 |
| 斷線恢復 | 現有 events_replay 機制 | progress_report 存入現有 event 存儲，零額外工作 |
| APP 視覺 | 零 emoji + 雙色主題 + 色條指示燈 + 線條 icon | 延續現有設計語言，專業感 |
| 規範執行力 | 硬性機制（系統強制）+ 軟性規則（提示注入） | 軟性規則不可靠，核心約束靠系統執行 |
