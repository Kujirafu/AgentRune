// server/behavior-rules.ts
// /command prompt definitions + project memory helpers
// Behavior rules are now in .agentrune/rules.md (read by agent via --append-system-prompt)
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** Get the agentlore.md memory file path for a project */
export function getMemoryPath(projectCwd: string): string {
  return join(projectCwd, ".agentrune", "agentlore.md")
}

/** Read the shared agentlore.md memory for a project, or return empty string */
export function getProjectMemory(projectCwd: string): string {
  const memPath = getMemoryPath(projectCwd)
  if (!existsSync(memPath)) return ""
  try {
    return readFileSync(memPath, "utf-8")
  } catch {
    return ""
  }
}

/** Write/update the shared agentlore.md memory for a project */
export function updateProjectMemory(projectCwd: string, content: string): void {
  const memDir = join(projectCwd, ".agentrune")
  mkdirSync(memDir, { recursive: true })
  writeFileSync(getMemoryPath(projectCwd), content, "utf-8")
}

const COMMAND_PROMPTS: Record<string, string> = {
  "/resume": `統整過去的工作並建議下一步。步驟：
1. 呼叫 read_memory 讀取共用記憶（agentlore.md）
2. 呼叫 get_project_context 讀取 vault
3. 整理成工作摘要：最近做了什麼、目前狀態、未完成的事
4. 建議 2-3 個下一步，按優先順序
5. 如果有新的理解或發現，用 update_memory 更新共用記憶
6. report_progress(status="done")`,

  "/status": `回報當前 session 的工作狀態。步驟：
1. 檢查 git status、最近的改動、未完成的工作
2. 彙整成簡短狀態報告
3. report_progress(status="in_progress" 或 "done")`,

  "/report": `強制回報最近完成的工作。步驟：
1. 檢查 git log 和 git diff 了解最近的改動
2. 彙整成結構化報告
3. report_progress，所有欄位盡量填完整
4. 這是強制回報，即使你覺得沒什麼好報的也要報`,

  "/test": `執行專案的測試套件並結構化回報結果。步驟：
1. 找到專案的測試指令（package.json scripts、Makefile、或常見測試框架）
2. 執行測試
3. 分析結果，失敗的說明原因和建議修法
4. report_progress，summary 包含通過/失敗數量`,

  "/review": `Review 目前的改動並產出結構化摘要。步驟：
1. git diff 查看所有變更
2. 逐檔案分析：改了什麼、潛在問題
3. 檢查測試覆蓋、安全、效能
4. report_progress，details 包含 review 摘要`,

  "/deploy": `執行部署流程並回報結果。步驟：
1. 先跑測試，失敗就 blocked 停止
2. 執行部署
3. 驗證是否成功
4. report_progress 包含結果和 URL`,

  "/merge": `合併當前 worktree 的改動回 main。步驟：
1. 先 /review + /test
2. 執行 merge/rebase
3. 有衝突嘗試解決，記錄原因
4. 解不了就 blocked
5. 成功就 report_progress`,

  "/note": `記錄前提條件或架構決策。步驟：
1. 判斷是前提條件還是架構決策
2. 前提 → log_prerequisite | 決策 → log_decision
3. report_progress(status="done")`,

  "/context": `讀取專案上下文。步驟：
1. 呼叫 read_memory 讀取共用記憶
2. 呼叫 get_project_context 讀取 vault
3. 整理成易讀摘要
4. report_progress(status="done")`,

  "/analysis": `分析程式碼並產出結構化報告。步驟：
1. 確認分析方向（效能/安全/架構/全部）
2. 深入分析，每個發現標嚴重程度
3. report_progress，details 包含完整報告`,

  "/insight": `提煉工作中的洞察。步驟：
1. 呼叫 read_memory 讀取現有共用記憶
2. 回顧最近工作
3. 提煉踩坑、pattern、技術決定
4. 分類記錄：前提 → log_prerequisite | 決策 → log_decision
5. 用 update_memory 把新洞察整合進共用記憶
6. report_progress 列出記錄了什麼`,

  "/watch": `進入 Watch 模式 — 持續監聽檔案變化並自動回應。步驟：
1. report_progress(status="in_progress", summary="Watch mode activated")
2. 監聽當前 worktree 的檔案變化（git status --porcelain 每 10 秒輪詢）
3. 偵測到有意義的變化時（新檔案、修改、刪除，忽略 node_modules/.git/dist 等）：
   - 分析變化內容
   - 如果是測試失敗 → 自動修復
   - 如果是新程式碼 → review 並建議改進
   - 如果是 CI/build 錯誤 → 分析並修復
4. 每次自動回應後 report_progress
5. 收到 /watch stop 或任何新的用戶輸入時退出 watch 模式
6. 退出時 report_progress(status="done", summary="Watch mode ended")`,

  "/watch stop": `退出 Watch 模式。
1. 停止監聯檔案變化
2. 彙整 watch 期間做的所有改動
3. report_progress(status="done")`,
}

/** Get command prompt for a /command, or null if not a known command */
export function getCommandPrompt(command: string): string | null {
  return COMMAND_PROMPTS[command] || null
}
