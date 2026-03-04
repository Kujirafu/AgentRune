# AirTerm (AgentRune) — Claude Instructions

## What This Project Is

AgentRune is a mobile command center for AI agents. You control Claude Code, Aider, Codex, etc. from your phone via a React web UI served over local WiFi. Uses xterm.js for terminal rendering, node-pty for PTY sessions, Express for the backend.

## Project Structure

```
web/           React 19 + Vite frontend
  App.tsx      Root component, WebSocket connection, session state
  components/  UI components (see below)
server/        Express 5 + node-pty backend
  index.ts     Entry point, HTTP + WebSocket server
  sessions.ts  PTY session management
  adapters/    Per-AI-tool adapters (claude-code, aider, cline, etc.)
  auth.ts      Auth modes: pairing | totp | none
shared/        Shared TypeScript types
```

## Dev Commands

```bash
npm run typecheck     # TypeScript check — run before EVERY claim of "done"
npm run build         # Vite build — run after any frontend change
npm run dev:server    # Start backend (tsx watch)
npm run dev:web       # Start Vite dev server
```

## MANDATORY WORKFLOW RULES

### Rule 1: ALWAYS verify before saying done
Use the `airterm-verify` skill for every task. This is not optional.

```
BEFORE saying "done", "fixed", "updated", or "complete":
  1. Run: npm run typecheck  (must pass with 0 errors)
  2. Run: npm run build      (must pass for any frontend change)
  3. Describe the visual change in detail
  4. Ask user to confirm
```

### Rule 2: One change at a time for UI/UX
Never make 3 CSS changes and say "done". Make one logical change, verify, confirm with user, then proceed.

### Rule 3: Describe visual state precisely
"The button looks better" is not acceptable.
"The button is now `h-11 w-full rounded-xl bg-white/10 border border-white/20 text-white text-sm font-medium` — white glass style, visible on dark background" is acceptable.

### Rule 4: When fixing a bug, explain WHY it's fixed
Don't just change code. Identify the root cause, explain it, then fix.

## Skills Available

- `airterm-verify` — verification checklist for this project (ALWAYS use)
- `superpowers:verification-before-completion` — general verification workflow
- `superpowers:systematic-debugging` — use when facing a bug that takes more than 2 attempts

## UI Design Language

Dark terminal aesthetic. See `airterm-verify` skill for full design reference.
- Dark backgrounds only
- Glass cards: `bg-white/5 border-white/10 backdrop-blur-md`
- Accent: `text-green-400` for active states
- NO light mode, NO Tailwind `bg-white` solid surfaces
