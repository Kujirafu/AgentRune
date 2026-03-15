# AgentRune

AI agent mobile control panel. Launch, monitor, and schedule AI agents from your phone.

## What is AgentRune?

AgentRune lets you control AI coding agents (Claude Code, Codex, Gemini, Aider, Cline, Cursor) from an Android app. A CLI daemon runs on your PC and exposes a WebSocket + HTTP API through a Cloudflare tunnel, so you can manage sessions from anywhere.

Key capabilities:

- **Session management** -- start, stop, resume, and monitor agent sessions in real time
- **Voice input** -- speak prompts to your agents via Android speech recognition
- **Automation scheduling** -- cron-style scheduling with 24+ built-in templates
- **Multi-agent support** -- Claude Code, Codex, Gemini, Aider, Cline, Cursor
- **Dual-daemon failover** -- dev + release daemons with automatic failover/failback
- **Sandbox system** -- 4-tier configurable sandbox (strict / moderate / permissive / none)
- **AgentLore integration** -- agents query an AI-verified knowledge base via MCP

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
cd cli && npm run build
npm link
agentrune start
```

## Security

- All remote connections require authentication (session token via Authorization header or query param)
- Local connections (127.0.0.1) bypass auth by design
- AES-256-GCM encryption for stored secrets and auth tokens
- Input validation on all user-facing parameters
- Security headers on all HTTP responses
- See commit history for detailed security audit trail

## Community

Join us for testing, feedback, and discussion:

- **Telegram** -- [AgentLore & AgentRune](https://t.me/AgentLore_n_AgentRune)
- **X (Twitter)** -- [@AGLO_Official](https://x.com/AGLO_Official)
- **Moltbook** -- [agentlore](https://www.moltbook.com/u/agentlore)

## License

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html)
