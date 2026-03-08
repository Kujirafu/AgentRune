# AgentRune Schedule UI Redesign

## Problem

排程管理的入口散亂（project card、長按 menu、時鐘按鈕、+ 彈出選單），功能拆太碎，用戶找不到。AutomationSheet 作為獨立 bottom sheet 與 session panel 割裂，操作路徑太長。

## Solution

把 Session panel 擴展成三 tab 架構，將排程管理、範本瀏覽整合到同一個面板。廢除 AutomationSheet 作為獨立入口。

---

## Architecture: 三 Tab Panel

### Panel 結構

- **Panel 0（不變）** — Project cards 列表
- **Panel 1** — 點專案進入，頂部三 tab：Sessions | Schedules | Templates

### Header

```
┌─────────────────────────────────────┐
│  專案名稱                    [+] [+]│
│                              時鐘  新│
│  ┌─Sessions─┬─Schedules─┬─Templates─┐
```

右上角固定兩個按鈕，不隨 tab 變化：
- `+` — 永遠是新建 session
- 時鐘 `+` — 永遠是新建排程（開 overlay 表單）

Tab pill 沿用現有 pill toggle 元件樣式，改為三格。

---

## Tab 1: Sessions

現有 session 列表，移除排程相關的按鈕和彈出選單。多選按鈕保留。Session card 不變。

---

## Tab 2: Schedules

### 排程卡片（摺疊 — 垂直式）

```
┌──────────────────────────────────────┐
│  09:00                        [===] │  大字時間 + toggle
│  Mo Tu We Th Fr                     │  星期幾 dots
│  每日掃描 Commits                    │  名稱
│  掃描最近的 commit 找潛在 bug...     │  prompt (2 行 clamp)
│                                     │
│  OK 14:30  ·  跑過 12 次 3 次有發現  │  上次狀態 + 戰績
│                                     │
│  [編輯]  [立即執行]          [刪除]   │  常用操作一排攤開
└──────────────────────────────────────┘
```

設計重點：
- 垂直排列，空間充裕，常用操作直接攤開不藏二級選單
- Toggle、編輯、立即執行、刪除 — 全部一級可見
- disabled 整張卡片半透明，操作按鈕仍可點
- 戰績用正面角度：「跑過 N 次 · M 次有發現」，沒發現 = 專案健康

### 排程卡片（展開）

點卡片空白處展開，顯示：
- 最近 3 次執行結果 summary（output 前 2-3 行）
- 每條結果有 `>` 箭頭，點擊進入獨立詳情頁

### 空狀態

時鐘 icon + 「還沒有排程」+ 提示文字。不顯示範本推薦（那是 Templates tab 的事）。

---

## Tab 3: Templates

### 範本卡片

```
┌──────────────────────────────────────┐
│  icon  安全掃描                  [pin]│
│  掃描 XSS、injection、secrets 洩漏   │
│                                      │
│  跑過 12 次 · 上次發現 1 個問題       │  你的使用紀錄
│                                      │
│  [建立排程]                           │
└──────────────────────────────────────┘
```

功能：
- 頂部搜尋欄
- Pinned 的排最前面，其餘按使用次數排
- 戰績只顯示「跑過 N 次」+ 上次結果 summary，沒跑過不顯示
- 「建立排程」帶入範本 prompt 跳到新建排程表單

### Starter Pack（新專案）

第一次進 Templates tab 且沒有排程時，頂部顯示推薦卡：
- 掃描專案 tech stack（package.json、目錄結構）
- 「偵測到 Next.js + Prisma，推薦這 4 個排程」
- 一鍵全部啟用
- 用戶關掉就不再出現

### 範本戰績資料結構（V1 先埋）

```typescript
interface TemplateStats {
  templateId: string
  projectId: string
  runCount: number
  findingCount: number  // 有發現東西的次數
  lastRunAt?: number
  lastSummary?: string
}
```

---

## 排程詳情頁

從展開的結果條目點 `>` 進入。全螢幕 overlay，左上角返回。

內容：
- 排程設定摘要（時間、星期、agent、模式、prompt）
- 統計：跑過 N 次 · M 次有發現
- 完整執行歷史列表（所有結果）
- 每條顯示 summary（前 2-3 行），點展開看完整 output
- 底部保留擴充區（V2：分析圖表、趨勢、技術債比例）

---

## 新建排程表單

任何 tab 點時鐘 `+` 叫出。Bottom sheet overlay 蓋在 panel 上。

表單由上到下：名稱 → Prompt（打字時即時推薦範本）→ 排程設定（Daily/Interval、時間、星期幾）→ 執行環境（Agent、Local/Worktree）→ 建立按鈕。

與現有 add 表單邏輯相同，只是從 AutomationSheet 搬到 panel overlay。

---

## 廢除項目

- `AutomationSheet` 作為獨立 bottom sheet 入口 — 功能全部搬進 Panel 1 三 tab
- Project card 的排程數量入口 — 改為點擊後跳到 Panel 1 Schedules tab
- 長按 context menu 的 Automations 選項 — 改為跳到 Panel 1 Schedules tab
- `+` 按鈕的彈出選單 — 改為直接新建 session

---

## 商業模式（V2，先記錄）

排程額度制：
- 免費：3 個排程、每天最多 5 次執行
- Pro：無限排程、無限次數、interval 最短 5 分鐘
- 用戶付的是「自動化管理基礎設施」的錢，不是 agent 算力

---

## 未來擴充（V2+）

- 每日情報摘要（跨專案 aggregated feed）
- 範本進化（根據專案 pattern auto-tune prompt）
- 社群範本市集（上傳、評分、平台抽成）
- 排程詳情頁分析圖表（趨勢、技術債比例）
- 雲端執行（代管 agent，手機排程雲端跑）
