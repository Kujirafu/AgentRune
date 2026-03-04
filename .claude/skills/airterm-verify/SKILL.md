# AirTerm Verification Checklist

**Use this skill BEFORE claiming any task is complete.** This is a HARD REQUIREMENT — do not say "done" without running these checks.

## Stack

- **Frontend:** React 19 + Vite + xterm.js, all source in `web/`
- **Backend:** Express 5 + node-pty, all source in `server/`
- **Mobile:** Capacitor (Android wrapper), config in `capacitor.config.ts`
- **Shared types:** `shared/types.ts`
- **No test suite** — verification is manual via typecheck + build + runtime

## Verification Steps (run IN ORDER)

### Step 1: TypeScript check (ALWAYS)
```bash
npm run typecheck
```
Expected: zero errors. If errors → fix before proceeding. Never skip this.

### Step 2: Build (for any frontend change)
```bash
npm run build
```
Expected: exits 0 with no errors. Catches import errors, missing files, broken JSX.

### Step 3: Server start (for any server change)
```bash
npm run dev:server
```
Expected: server starts and prints the port without crashing. Let it run 5 seconds, then kill with Ctrl+C.

### Step 4: Describe visual state (for any UI/UX change)

After Step 2 passes, describe EXACTLY what changed visually:
- Which component file was modified
- What CSS classes/styles were changed and what they look like now
- What the user will see on their phone screen

**Do NOT say "the button now looks better" — say "the button is now `rounded-xl bg-white/20 backdrop-blur-md`, approximately 44px tall, full-width, with visible white border on dark background".**

Then ask the user: "Can you check if this looks right? I've verified typecheck and build pass."

## Anti-Patterns (NEVER do these)

| Wrong | Right |
|-------|-------|
| Edit CSS, say "done" | Edit CSS → typecheck → build → describe visual state → ask user |
| "I've updated the component" | "I've updated X. typecheck ✅ build ✅. The button now has [exact description]. Does this match what you want?" |
| Fix bug, assume it works | Fix bug → typecheck → attempt to reproduce → explain why it's fixed |
| Multiple UI changes in one go | One change → verify → confirm with user → next change |

## UI Design Reference

AirTerm uses a **dark terminal aesthetic**:
- Background: near-black (`#0a0a0a` or `bg-gray-950`)
- Glass cards: `bg-white/5 border border-white/10 backdrop-blur-md`
- Text: `text-white` / `text-white/70` / `text-white/40`
- Accent: green terminal green (`text-green-400`, `#4ade80`) for active/connected states
- Font: monospace for terminal content, system sans for UI chrome
- Border radius: `rounded-xl` for cards, `rounded-lg` for buttons
- NO light backgrounds, NO bright colors (this is a terminal app)

## Common Issues in This Project

- `node-pty` binding errors on Windows → requires `npm rebuild`
- Capacitor live reload requires `npx cap sync android` after `npm run build`
- WebSocket connects to `ws://[server-ip]:PORT` — hardcoded in `web/App.tsx`
- `xterm` FitAddon must be called after the terminal DOM element is mounted
