# APP Navigation Redesign — 指令驅動多 Session 協作 UI

## 設計摘要

**核心轉變**：從「終端機搬到手機」轉為「指令 → 結構化結果」的多 agent 協作介面。

**設計決策記錄**：

| 問題 | 選項 | 決策 | 理由 |
|------|------|------|------|
| 專案管理範圍 | 單專案 / 多專案 | 多專案（1~N） | 手機管理多 agent 多 session 是未來開發趨勢 |
| Grid 卡片層級 | session / 專案 / 兩層 | 兩層（專案 → session） | 專案卡片彙總，session grid 看個別 |
| Session 排列方式 | Grid / 垂直列表+展開 / Kanban / 垂直列表+inline card | 垂直列表 + inline progress card | 一眼掌握全局 + 直接操作，不用點擊展開 |
| 設定位置 | 卡片齒輪 / 詳情頁 tab / 建立時 / 兩層 | 兩層（全域+session 長按） | 全域設定在 Project Panel，session 設定在一級頁面長按 |
| 一級交互模式 | 純指揮 / 指揮+快速回應 / 指揮+全域指令 | 指揮+快速回應 | Blocked 時不用切頁面，展開輸入框直接回應 |
| 二級交互模式 | 純指令 / 指令+對話切換 / 混合 | 混合 | /command 出結果卡，自然語言是對話，零模式切換 |
| PRD/規劃 | /command / 獨立按鈕 / 新 session 引導 | 新 session 自動引導 | 新手被引導不害怕，老手可永久跳過，PRD 存入 vault |

---

## 導航架構

```
Project Panel（左滑進入）
  └─ Session Overview（一級頁面，垂直列表 + inline progress card）
       ├─ 長按 session → 設定浮層（model、mode 等）
       ├─ Blocked → 展開輸入框直接回應
       ├─ 點「合併」/「丟棄」→ 直接操作
       └─ 點卡片 → Session Detail（二級頁面）
            ├─ 混合顯示：ProgressCard + 對話氣泡
            ├─ Terminal（原始輸出）
            └─ Diff（檔案變更）
```

---

## UI 設計規範

- **零 emoji** — 所有狀態、標題、按鈕都不使用 emoji
- **雙色主題** — 延續現有亮/暗雙主題設計
- **色條指示** — 卡片左邊條表示狀態（綠=done、藍=working、紅=blocked）
- **線條風格 icon** — 不使用填滿式圖標
- **指示燈** — 小圓點表示狀態

---

## 一級頁面：Session Overview

### 頂部
- 專案名稱 + 全域設定齒輪 + 「+ 新 Session」按鈕

### 主體：垂直捲動 session 卡片列表

每張卡片結構：

```
┌─────────────────────────────────┐
│ [綠色左邊條]                    │
│ [Claude Code icon]     [綠色點] │
│ fix-api-endpoint                │
│ ┌─────────────────────────────┐ │
│ │ [Done] 重構 auth middleware │ │
│ │ 改了 3 個檔案，測試全過 5/5 │ │
│ └─────────────────────────────┘ │
│ 下一步：部署到 staging    [>]   │
└─────────────────────────────────┘
```

**卡片內容：**
- Agent icon + 名稱 + 狀態指示燈（Working 藍 / Done 綠 / Blocked 紅）
- Session 標籤（task slug 或自訂名稱）
- 最近一張 ProgressCard 精簡版（標題 + summary）
- 動作按鈕（依狀態）：
  - Working → 「查看詳情」
  - Done → 「合併到 main」「丟棄」「查看詳情」
  - Blocked → 「回應」「查看詳情」

### 互動
- **長按卡片** → 浮層顯示 session 設定（model、mode、重新命名、刪除）
- **點動作按鈕** → 直接執行（不離開一級頁面）
- **Blocked 快速回應** → 展開卡片內輸入框，直接回應 agent，不離開一級頁面
- **點卡片本體** → 進入二級詳情頁
- **左滑卡片** → 快捷動作（合併/丟棄/刪除）
- **「+ 新 Session」** → 選 agent → 規劃引導（可跳過/永久關閉）→ 設定 model/mode → 可選 worktree 隔離 → 開始

### 手勢
- 下拉 → 重新整理所有 session 狀態
- 左滑整個頁面 → Project Panel

---

## 新 Session 規劃引導

用戶點「+ 新 Session」→ 選 agent 後自動跳出：

```
要先規劃一下嗎？

  [ 開始規劃 ]        — 進入引導式 brainstorm
  [ 跳過，直接開始 ]   — 直接開 session
  [ 以後都跳過 ]       — 記住偏好（全域設定可恢復）
```

**引導式 brainstorm：**
- 一次一個問題，多選為主
- 含分析和建議（不只問，還給方向）
- 完成後產出結構化 PRD 卡片（目標、建議架構、風險、步驟）
- PRD 自動存入 vault（agent 啟動時可讀取）
- 可直接接著開 session 或先存著備用

---

## 二級頁面：Session Detail

### 頂部
- 返回箭頭 + session 名稱 + 狀態指示燈

### 主體：混合顯示
- **ProgressCard**（結構化結果）和**對話氣泡**（自然語言交互）混合排列
- 視覺樣式明確區分：結果卡有邊框、色條和 metrics，對話是輕量氣泡
- 按時間排列，最新在上
- 每張 ProgressCard 包含：標題、狀態、summary、next steps、可展開 details

### 底部
- **InputBar**（統一輸入）：
  - 打 `/command` → agent 執行指令 → 出 ProgressCard 結果卡
  - 打自然語言 → 跟 agent 對話 → 出對話氣泡
  - 不需切換模式，打什麼出什麼

### 可切換 Panel
- Terminal（原始 PTY 輸出，進階用戶用）
- Diff（檔案變更）
- Files（檔案瀏覽）
- 收在底部 tab 或上滑抽屜

### 動畫
- 新結果卡出現 → 從上方滑入
- Session 狀態改變 → 狀態燈顏色過渡
- Working 的 session → 結果卡區域微妙脈動

---

## Project Panel（左滑進入）

垂直列表顯示所有專案：
- 專案名稱 + 路徑
- 活躍 session 數量彙總（「2 working / 1 done」）
- 選取後進入該專案的 Session Overview

頂部：全域設定齒輪按鈕

---

## 全域設定

放在 Project Panel 頂部齒輪：
- 主題（亮/暗）
- 語言
- 連線設定
- AgentLore 帳號
- 「新 Session 時顯示規劃引導」開關

---

## 與 v2 架構的關係

| v2 支柱 | UI 對應 |
|---------|---------|
| MCP Gate Keeper | ProgressCard 是 report_progress 的視覺化 |
| 結構化結果卡 | Session 卡片 inline progress + 二級頁面混合顯示 |
| 多 Session / Worktree | Session Overview 列表 + 合併/丟棄按鈕 |
| PTY 攔截 | 用戶無感（CLI 端執行），Terminal panel 保留給進階用戶 |
| Agent 無關 | Agent icon + 名稱區分，但 ProgressCard 格式統一 |
| Obsidian 共享記憶體 | PRD 存入 vault，agent 啟動讀取 vault |

---

## 元件映射（現有 → 新）

| 現有元件 | 新角色 |
|---------|--------|
| `LaunchPad` → | Project Panel + 新 Session 建立流程（含規劃引導） |
| `MissionControl` (board) → | 拆成 `SessionOverview`（一級）+ `SessionDetail`（二級） |
| `MissionControl` (terminal) → | `SessionDetail` 的 Terminal tab |
| `EventCard` → | 保留在 Terminal/詳情，但不再是主要展示 |
| `ProgressCard`（新） → | 一級 inline + 二級混合顯示 |
| `SettingsSheet` → | 全域設定 + session 長按浮層 |
| `InputBar` → | 二級頁面底部（支援 /command + 自然語言混合） |
| `DiffPanel` → | 二級頁面的 Diff tab |
| `TaskBoard` → | 被規劃引導取代（PRD 功能整合進新 session 流程） |
