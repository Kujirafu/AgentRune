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

---

## 導航架構

```
Project Panel（左滑進入）
  └─ Session Overview（一級頁面，垂直列表 + inline progress card）
       ├─ 長按 session → 設定浮層（model、mode 等）
       ├─ 點「回應」/「合併」→ 直接操作
       └─ 點 [→] 或卡片 → Session Detail（二級頁面）
            ├─ Progress 歷史（所有 ProgressCard 列表）
            ├─ Terminal（原始輸出）
            └─ Diff（檔案變更）
```

---

## 一級頁面：Session Overview

### 頂部
- 專案名稱 + ⚙️ 全域設定 + 「+ 新 Session」按鈕

### 主體：垂直捲動 session 卡片列表

每張卡片結構：

```
┌─────────────────────────────────┐
│ ⚡ Claude Code        ● Working │
│ fix-api-endpoint                │
│ ┌─────────────────────────────┐ │
│ │ ✅ 重構 auth middleware     │ │
│ │ 3 files  +42  -18  Tests 5/5│ │
│ └─────────────────────────────┘ │
│ 下一步：部署到 staging    [→]   │
└─────────────────────────────────┘
```

**卡片內容：**
- Agent icon + 名稱 + 狀態燈（Working 綠 / Done 灰 / Blocked 紅）
- Session 標籤（task slug 或自訂名稱）
- 最近一張 ProgressCard 精簡版（標題 + metrics）
- 動作按鈕（依狀態）：
  - Working → 「查看詳情」
  - Done → 「合併到 main」「丟棄」「查看詳情」
  - Blocked → 「回應」「查看詳情」

### 互動
- **長按卡片** → 浮層顯示 session 設定（model、mode、重新命名、刪除）
- **點動作按鈕** → 直接執行（不離開一級頁面）
- **點 [→] 或卡片本體** → 進入二級詳情頁
- **「+ 新 Session」** → 選 agent → 設定 model/mode → 可選 worktree 隔離 → 開始

---

## 二級頁面：Session Detail

### 頂部
- 返回箭頭 + session 名稱 + 狀態燈

### 主體
- ProgressCard 歷史（按時間排列，最新在上）
- 每張 ProgressCard 包含：標題、狀態、metrics、next steps、可展開 details

### 底部
- InputBar（下指令給這個 session 的 agent）

### 可切換 Panel
- Terminal（原始 PTY 輸出，進階用戶用）
- Diff（檔案變更）
- Files（檔案瀏覽）
- 收在底部 tab 或上滑抽屜

---

## Project Panel（左滑進入）

垂直列表顯示所有專案：
- 專案名稱 + 路徑
- 活躍 session 數量彙總（「2 working / 1 done」）
- 選取後進入該專案的 Session Overview

頂部：⚙️ 全域設定按鈕

---

## 全域設定

放在 Project Panel 頂部齒輪：
- 主題（亮/暗）
- 語言
- 連線設定
- AgentLore 帳號

---

## 與 v2 架構的關係

| v2 支柱 | UI 對應 |
|---------|---------|
| MCP Gate Keeper | ProgressCard 是 report_progress 的視覺化 |
| 結構化結果卡 | Session 卡片 inline progress + 二級頁面 ProgressCard 歷史 |
| 多 Session / Worktree | Session Overview grid + 合併/丟棄按鈕 |
| PTY 攔截 | 用戶無感（CLI 端執行），Terminal panel 保留給進階用戶 |
| Agent 無關 | Agent icon + 名稱區分，但 ProgressCard 格式統一 |

---

## 元件映射（現有 → 新）

| 現有元件 | 新角色 |
|---------|--------|
| `LaunchPad` → | Project Panel + 新 Session 建立流程 |
| `MissionControl` (board) → | 拆成 `SessionOverview`（一級）+ `SessionDetail`（二級） |
| `MissionControl` (terminal) → | `SessionDetail` 的 Terminal tab |
| `EventCard` → | 保留在 Terminal/詳情，但不再是主要展示 |
| `ProgressCard`（新） → | 一級 inline + 二級歷史 |
| `SettingsSheet` → | 全域設定 + session 長按浮層 |
| `InputBar` → | 二級頁面底部 |
| `DiffPanel` → | 二級頁面的 Diff tab |
