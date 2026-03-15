# AgentRune

AI agent mobile control panel. Launch, monitor, and schedule AI agents from your phone.

## What is AgentRune?

AgentRune lets you control AI coding agents (Claude Code, Codex, Gemini, Aider, Cline, Cursor) from an Android app. A CLI daemon runs on your PC and exposes a WebSocket + HTTP API through a Cloudflare tunnel, so you can manage sessions from anywhere.

## Features

### Session Control
- **Session management** -- start, stop, resume, and monitor agent sessions in real time
- **Session recovery** -- daemon crashes or network drops? One tap to restore full context
- **Voice input** -- speak prompts to your agents via Android speech recognition
- **Multi-agent support** -- Claude Code, Codex, Gemini, Aider, Cline, Cursor
- **Dual-daemon failover** -- dev + release daemons with automatic failover/failback
- **Settings sync** -- planMode, autoEdit, effort level sync directly to CLI flags

### Automation
- **Automation scheduling** -- cron-style scheduling with 24+ built-in templates
- **Skill chains** -- multi-step automation pipelines, chain tasks sequentially or in parallel
- **Crew system** -- multi-role workflows (PM → engineer → QA) with phase gates and per-role token budgets, built on top of skill chains
- **Sandbox system** -- 4-tier configurable sandbox (strict / moderate / permissive / none) with prompt conflict scanning

### Trust & Security
- **Trust profiles** -- 4 security levels (Autonomous / Supervised / Guarded / Custom) to control what agents can do unattended
- **Plan panel** -- agents submit execution plans for review before they build
- **Runtime authority** -- restrict agent operations (file write, HTTP requests, git push) per schedule
- **Audit log** -- all agent operations recorded for review
- **AES-256-GCM encryption** for stored secrets and auth tokens
- **OAuth login** -- GitHub and Google authentication

### Integrations
- **AgentLore MCP** -- agents query an AI-verified knowledge base
- **Push notifications** -- FCM alerts for agent decisions, automation completions, version updates
- **Telemetry** -- self-hosted analytics with opt-out support

## Architecture

```
Phone (Android app)
  |
  | WebSocket + HTTPS (Cloudflare tunnel)
  |
PC (CLI daemon)
  |
  |-- PTY adapter (real-time terminal I/O)
  |-- JSONL watcher (session replay / token tracking)
  |-- Express HTTP API
  |-- AgentLore MCP server
```

**Monorepo structure:**

| Directory | Description |
|-----------|-------------|
| `app/` | Vite + React + TypeScript + Capacitor (Android) |
| `cli/` | Node.js CLI daemon (Express + WebSocket + PTY) |
| `docs/` | Design documents and plans |

## Getting Started

### Prerequisites

- Node.js 20+
- Android SDK (for APK builds)
- One or more AI agents installed (e.g. `claude`, `codex`, `cursor`)

### Install

```bash
npm install
```

### Run the CLI daemon (dev)

```bash
cd cli && npm run dev
```

This starts the daemon on port 3457 in foreground mode with file watching.

### Build the app

```bash
# Development build
cd app && npm run build:dev

# Production build
cd app && npm run build
```

### Build APK

```bash
cd app
npx cap sync android
cd android && ./gradlew assembleDebug
```

APK output: `app/android/app/build/outputs/apk/debug/app-debug.apk`

### Install the CLI globally

```bash
npm install -g agentrune
agentrune start
```

## Community

Join us for testing, feedback, and discussion:

- **Telegram** -- [AgentLore & AgentRune](https://t.me/AgentLore_n_AgentRune)
- **X (Twitter)** -- [@AGLO_Official](https://x.com/AGLO_Official)
- **Moltbook** -- [agentlore](https://www.moltbook.com/u/agentlore)

## Community

Join us for testing, feedback, and discussion:

- **Telegram** -- [AgentLore & AgentRune](https://t.me/AgentLore_n_AgentRune)
- **X (Twitter)** -- [@AGLO_Official](https://x.com/AGLO_Official)
- **Moltbook** -- [agentlore](https://www.moltbook.com/u/agentlore)

## License

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html)
