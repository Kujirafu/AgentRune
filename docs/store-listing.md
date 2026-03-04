# AgentRune — Store Listing

## App Name
AgentRune

## Short Description (80 chars)
Mobile command center for AI agents — Claude Code, Codex, OpenClaw & more

## Full Description (EN)

AgentRune is the human command center for the AI agent era.

In a world where AI agents do the coding, you don't need to stare at terminals. You need to express intent, review decisions, and track progress. AgentRune lets you command any AI coding agent from your phone — the human-friendly way.

KEY FEATURES:

- Mission Control — See your agent's work as structured event cards, not raw terminal text. File edits, test results, decisions, errors — all visualized.
- Multi-Agent Support — Works with Claude Code, Codex CLI, OpenClaw, Aider, Cline, and any terminal-based agent.
- Decision Cards — When your agent needs human input, get a card with clear options. Tap to respond.
- Voice Input — Speak commands to your agent using built-in speech recognition.
- Session History — Review past agent sessions with event replay.
- Terminal Escape Hatch — Pull down to access the full terminal anytime.
- Secure Connection — Device pairing with 6-digit codes, QR code support, or TOTP authentication.

HOW IT WORKS:
1. Run the AgentRune server on your PC (npm start)
2. Pair your phone using the 6-digit code
3. Select a project and AI agent
4. Direct your agent from Mission Control

AgentRune is part of the AgentLore ecosystem — where agents gain capabilities and humans gain control.

## Full Description (繁體中文)

AgentRune 是 AI Agent 時代的人類指揮中心。

在 AI Agent 負責寫程式的世界裡，你不需要盯著終端機。你需要的是表達意圖、審核決策、追蹤進度。AgentRune 讓你從手機指揮任何 AI 編程 Agent——以人性化的方式。

主要功能：

- Mission Control — 以結構化事件卡片呈現 Agent 的工作，而非原始終端文字
- 多 Agent 支援 — 支援 Claude Code、Codex CLI、OpenClaw、Aider、Cline
- 決策卡片 — 當 Agent 需要人類輸入時，顯示清晰的選項卡片
- 語音輸入 — 內建語音辨識，用說的指揮你的 Agent
- Session 歷史 — 回顧過去的 Agent 工作記錄
- 終端逃生門 — 下拉手勢隨時切換到完整終端
- 安全連線 — 6 位數配對碼、QR Code、或 TOTP 認證

使用方式：
1. 在電腦上執行 AgentRune 伺服器（npm start）
2. 用 6 位數配對碼連接手機
3. 選擇專案和 AI Agent
4. 從 Mission Control 指揮你的 Agent

## Category
Developer Tools

## Tags
AI, coding, terminal, agent, Claude, Codex, developer tools, remote control

## Content Rating
Everyone

## Privacy Policy
AgentRune runs entirely on your local network. No data is sent to external servers. All communication stays between your phone and your PC.

## Screenshots Needed
1. LaunchPad — Project + Agent selection
2. Mission Control — Event card stream with decision card
3. Terminal Detail — Full xterm.js terminal
4. Settings — Model and mode configuration
5. Auth Screen — 6-digit pairing code input

## Build Instructions

### Prerequisites
- Java 17+ (install via `winget install Microsoft.OpenJDK.17`)
- Android Studio (or just Android SDK command-line tools)

### Build Debug APK
```bash
npm run cap:build
cd android
./gradlew assembleDebug
```
APK will be at: `android/app/build/outputs/apk/debug/app-debug.apk`

### Build Release AAB (for Play Store)
```bash
# 1. Create keystore (one time)
keytool -genkey -v -keystore agentrune.keystore -alias agentrune -keyalg RSA -keysize 2048 -validity 10000

# 2. Build release
cd android
./gradlew bundleRelease

# 3. Sign (or use Play App Signing)
```

### iOS
Requires macOS with Xcode. Run:
```bash
npm install @capacitor/ios
npx cap add ios
npx cap open ios
```
