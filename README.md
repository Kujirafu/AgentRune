# AgentRune

> Mobile command center for AI coding agents. Control Claude Code, Aider, Codex, and more from your phone.

AgentRune turns your phone into a remote control for AI agents running on your computer. Connect over local WiFi, monitor agent activity in real-time, and interact through a mobile-optimized interface.

## Features

- **Multi-agent support** — Claude Code, Aider, OpenAI Codex, Cline, or plain terminal
- **Mission Control** — Real-time event cards showing file edits, commands, decisions
- **Mobile-first UI** — Designed for phone screens with swipe navigation
- **Voice input** — Speak commands instead of typing on mobile keyboard
- **QR pairing** — Scan to connect, no manual IP entry
- **Session management** — Run multiple agents across multiple projects
- **File browser** — Browse and create folders from your phone
- **i18n** — English + Traditional Chinese

## Quick Start

### Computer (Server)

```bash
npx agentrune
```

A QR code will appear in the terminal.

### Phone (Client)

1. Install AgentRune from [Google Play](#) <!-- TODO: add link -->
2. Open the app and scan the QR code
3. Select a project and launch an agent

## Development

```bash
# Install dependencies
npm install

# Start dev server (backend)
npm run dev:server

# Start dev server (frontend)
npm run dev:web

# Type check
npm run typecheck

# Production build
npm run build
```

### Android Build

```bash
npm run build
rm -rf android/app/src/main/assets/public
npx cap sync android
cd android && ./gradlew assembleDebug
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

## Architecture

```
web/           React 19 + Vite frontend
  App.tsx      Root component, WebSocket, session state
  components/  LaunchPad, MissionControl, FileBrowser, etc.
server/        Express 5 + node-pty backend
  index.ts     HTTP + WebSocket server
  sessions.ts  PTY session management
  adapters/    Per-agent adapters (claude-code, aider, etc.)
shared/        Shared TypeScript types
android/       Capacitor 8 Android shell
```

## Tech Stack

- **Frontend**: React 19, TypeScript, xterm.js, Vite
- **Backend**: Express 5, node-pty, WebSocket
- **Mobile**: Capacitor 8 (Android / iOS)
- **Payments**: Lemon Squeezy

## License

[AGPL-3.0](LICENSE) — AgentRune is free and open source software.

Copyright 2025 AgentRune Contributors.
