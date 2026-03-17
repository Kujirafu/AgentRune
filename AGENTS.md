# AgentRune — Codex 專案指引

## 第一步
**開 session 先讀 `.agentrune/agentlore.md`** — 那是專案的完整上下文（stack、conventions、key files、decisions、lessons）。這個檔案才是 AgentRune 的專案記憶，不是 Codex 的 memory 系統。

改了東西要更新 agentlore.md，不要只更新 Codex memory。

## 語言
- **所有回覆、摘要、說明一律用繁體中文**。不得用英文回覆。

## 用戶偏好（強制）
- **絕對不用 emoji** — 所有 icon 一律用 Lucide 風格 SVG 線條圖
- **Dark mode 和 Light mode 必須分開設計配色** — 不共用同一個色值
- 整個 APP 風格必須一致，不要顏色跳來跳去
- 設計語言：毛玻璃（backdrop-blur）+ 背景霧化
- 用戶從手機操作（Termius SSH），Codex 跑在 PC 上

## 共享資源
- **Obsidian vault**: see CLAUDE.md (not committed to public repo)
- **剪貼簿**: see CLAUDE.md
- **金鑰庫**: see CLAUDE.md — 找 API key 的唯一來源，不要問用戶貼金鑰

## AgentLore 與 AgentRune
- **AgentLore**（`../AgentWiki/`）= AI 驗證知識庫 web app + MCP server
- **AgentRune** = AI agent 手機控制台 App
- AgentRune 的 agent 透過 AgentLore MCP 查詢知識
- AgentLore GitHub: (private repo — see CLAUDE.md)
- AgentRune GitHub: https://github.com/Kujirafu/AgentRune（PUBLIC, AGPL-3.0）
- **Release/APK 只放 AgentRune repo，絕對不放 agentlore repo**

## 社群發文
- 發文腳本: `scripts/post-social.ts`（X + Threads）
- Threads API 正常可用，X API 目前需手動（credit $0）
- 語氣：口語、隨性、短句、不包裝、中英混用、不用 emoji/hashtag
