# Session Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Win+Tab floating session picker with a 2-panel swipe navigation — Panel 0 (Projects list) and Panel 1 (Session Dashboard with inline reply for blocked sessions).

**Architecture:** Add swipe navigation to `ProjectOverview.tsx` using `useState` for panel index + CSS `translateX` transition. Panel 1 shows a vertical session card list for the selected project, with inline reply input for blocked sessions. Also add a "Worktree Isolation" toggle in SettingsSheet stored via localStorage.

**Tech Stack:** React, inline styles (glass morphism CSS vars), TypeScript, i18n via `useLocale()` hook

---

### Task 1: Add i18n keys for Session Dashboard and Worktree toggle

**Files:**
- Modify: `app/src/lib/i18n/en.ts`
- Modify: `app/src/lib/i18n/zh-TW.ts`

**Step 1: Add English translation keys**

In `app/src/lib/i18n/en.ts`, add these keys before the closing `}`:

```typescript
  // Session Dashboard (Panel 1)
  "sessions.title": "Sessions",
  "sessions.noSessions": "No sessions yet",
  "sessions.startFirst": "Start your first session",
  "sessions.replyPlaceholder": "Reply to agent...",
  "sessions.blocked": "Blocked",

  // Settings — Worktree
  "settings.worktreeIsolation": "Worktree Isolation",
  "settings.worktreeIsolationDesc": "Run each session in its own git worktree",
```

**Step 2: Add zh-TW translations**

In `app/src/lib/i18n/zh-TW.ts`, add the corresponding keys:

```typescript
  // Session Dashboard (Panel 1)
  "sessions.title": "工作階段",
  "sessions.noSessions": "尚無工作階段",
  "sessions.startFirst": "開始第一個工作階段",
  "sessions.replyPlaceholder": "回覆 Agent...",
  "sessions.blocked": "需要回應",

  // Settings — Worktree
  "settings.worktreeIsolation": "Worktree 隔離",
  "settings.worktreeIsolationDesc": "每個 Session 在獨立的 git worktree 中執行",
```

**Step 3: Commit**

```bash
cd "C:/Users/agres/Documents/Test/AgentRune-New"
git add app/src/lib/i18n/en.ts app/src/lib/i18n/zh-TW.ts
git commit -m "feat(i18n): add session dashboard + worktree toggle translation keys"
```

---

### Task 2: Add worktree localStorage helpers

**Files:**
- Modify: `app/src/lib/storage.ts` (add 2 functions at end, after `saveLastProject`)

**Step 1: Add getter/setter**

Append to `app/src/lib/storage.ts`:

```typescript
export function getWorktreeEnabled(): boolean {
  const val = localStorage.getItem("agentrune_worktree_enabled")
  return val === null ? true : val === "true"  // default true
}

export function setWorktreeEnabled(enabled: boolean) {
  localStorage.setItem("agentrune_worktree_enabled", enabled ? "true" : "false")
}
```

**Step 2: Commit**

```bash
cd "C:/Users/agres/Documents/Test/AgentRune-New"
git add app/src/lib/storage.ts
git commit -m "feat(storage): add worktree enabled localStorage helpers"
```

---

### Task 3: Add Worktree toggle to SettingsSheet

**Files:**
- Modify: `app/src/components/SettingsSheet.tsx`

**Step 1: Add import**

Add `getWorktreeEnabled, setWorktreeEnabled` to the existing import from `"../lib/storage"`:

```typescript
import { getVolumeKeysEnabled, setVolumeKeysEnabled, getKeepAwakeEnabled, setKeepAwakeEnabled, getWorktreeEnabled, setWorktreeEnabled } from "../lib/storage"
```

**Step 2: Add state**

After the `keepAwake` state declaration (line ~29), add:

```typescript
const [worktreeIsolation, setWorktreeIsolation] = useState(true)
```

**Step 3: Initialize in useEffect**

In the `useEffect` that reads from localStorage (the one with `setVolumeKeys(getVolumeKeysEnabled())` around line ~33), add:

```typescript
setWorktreeIsolation(getWorktreeEnabled())
```

**Step 4: Add ToggleCard**

After the `keepAwake` ToggleCard (before `</div>` and `</div>` that close the settings section, around line ~804), add:

```tsx
            <ToggleCard
              label={t("settings.worktreeIsolation")}
              description={t("settings.worktreeIsolationDesc")}
              icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>}
              active={worktreeIsolation}
              onChange={(v) => {
                setWorktreeIsolation(v)
                setWorktreeEnabled(v)
              }}
            />
```

**Step 5: Verify build**

```bash
cd "C:/Users/agres/Documents/Test/AgentRune-New/app" && npx vite build 2>&1 | tail -5
```

Expected: Build succeeds with no errors.

**Step 6: Commit**

```bash
cd "C:/Users/agres/Documents/Test/AgentRune-New"
git add app/src/components/SettingsSheet.tsx
git commit -m "feat(settings): add worktree isolation toggle (default ON)"
```

---

### Task 4: Refactor ProjectOverview — add 2-panel swipe navigation

This is the main task. Replace the Win+Tab floating session picker with a 2-panel layout.

**Files:**
- Modify: `app/src/components/ProjectOverview.tsx`

**Context for implementer:**
- Current file has ~790 lines
- Lines 416-528: Win+Tab floating session picker — DELETE entirely
- The `pickerProjectId` and `pickerSessions` state vars become unused — DELETE them
- Add new state: `panel` (0 or 1), `selectedProjectForSessions` (string | null), `replySessionId` (string | null), `replyText` (string)
- Touch handlers for swipe between panels

**Step 1: Add new state variables**

After the existing state declarations (~line 83-89), add:

```typescript
const [panel, setPanel] = useState(0)
const [selectedProjectForSessions, setSelectedProjectForSessions] = useState<string | null>(null)
const [replySessionId, setReplySessionId] = useState<string | null>(null)
const [replyText, setReplyText] = useState("")
const touchStartX = useRef(0)
const touchStartY = useRef(0)
const touchDeltaX = useRef(0)
const swiping = useRef(false)
const containerRef = useRef<HTMLDivElement>(null)
```

**Step 2: Remove old picker state**

Delete `pickerProjectId` state and `pickerSessions` derived variable:

```typescript
// DELETE these lines:
const [pickerProjectId, setPickerProjectId] = useState<string | null>(null)
// ...
const pickerSessions = pickerProjectId ? (sessionsByProject.get(pickerProjectId) || []) : []
```

**Step 3: Update handleProjectTap**

Replace the existing `handleProjectTap` function:

```typescript
const handleProjectTap = (projectId: string) => {
  const sessions = sessionsByProject.get(projectId) || []
  if (sessions.length === 0) {
    setContextProjectId(projectId)
    setShowNewSheet(true)
  } else {
    setSelectedProjectForSessions(projectId)
    setPanel(1)
  }
}
```

**Step 4: Add swipe touch handlers**

After `handleProjectTap`, add:

```typescript
const handleTouchStart = (e: React.TouchEvent) => {
  // Don't swipe from inputs
  if ((e.target as HTMLElement).closest("input, textarea")) return
  touchStartX.current = e.touches[0].clientX
  touchStartY.current = e.touches[0].clientY
  touchDeltaX.current = 0
  swiping.current = false
}

const handleTouchMove = (e: React.TouchEvent) => {
  const dx = e.touches[0].clientX - touchStartX.current
  const dy = e.touches[0].clientY - touchStartY.current
  if (!swiping.current && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
    swiping.current = true
  }
  if (swiping.current) {
    touchDeltaX.current = dx
  }
}

const handleTouchEnd = () => {
  if (!swiping.current) return
  const threshold = 50
  if (touchDeltaX.current < -threshold && panel === 0) {
    if (selectedProjectForSessions) setPanel(1)
  } else if (touchDeltaX.current > threshold && panel === 1) {
    setPanel(0)
  }
  swiping.current = false
  touchDeltaX.current = 0
}
```

**Step 5: Add inline reply handler**

```typescript
const handleInlineReply = (sessionId: string) => {
  if (!replyText.trim()) return
  onNextStep?.(sessionId, replyText.trim())
  setReplyText("")
  setReplySessionId(null)
}
```

**Step 6: Wrap the main return in a 2-panel container**

Replace the outer `<div>` structure. The return should become:

```tsx
return (
  <div
    ref={containerRef}
    onTouchStart={handleTouchStart}
    onTouchMove={handleTouchMove}
    onTouchEnd={handleTouchEnd}
    style={{
      height: "100dvh",
      overflow: "hidden",
      position: "relative",
    }}
  >
    <div style={{
      display: "flex",
      width: "200vw",
      height: "100%",
      transform: `translateX(-${panel * 100}vw)`,
      transition: "transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
    }}>
      {/* Panel 0: Projects */}
      <div style={{
        width: "100vw",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-primary)",
        flexShrink: 0,
      }}>
        {/* ... existing header + project list ... */}
      </div>

      {/* Panel 1: Session Dashboard */}
      <div style={{
        width: "100vw",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-primary)",
        flexShrink: 0,
      }}>
        {/* Session Dashboard content — see Step 7 */}
      </div>
    </div>

    {/* Page indicator dots */}
    <div style={{
      position: "fixed",
      bottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
      left: 0, right: 0,
      display: "flex",
      justifyContent: "center",
      gap: 8,
      zIndex: 10,
    }}>
      {[0, 1].map((i) => (
        <div
          key={i}
          style={{
            width: panel === i ? 8 : 6,
            height: panel === i ? 8 : 6,
            borderRadius: "50%",
            background: panel === i ? "var(--accent-primary)" : "var(--text-secondary)",
            opacity: panel === i ? 1 : 0.3,
            transition: "all 0.3s",
          }}
        />
      ))}
    </div>

    {/* Keep all overlays (context menu, device sheet, NewSessionSheet) OUTSIDE the sliding panels */}
  </div>
)
```

**Step 7: Build Panel 1 — Session Dashboard**

The Session Dashboard panel content:

```tsx
{/* Panel 1 Header */}
<div style={{
  padding: "calc(env(safe-area-inset-top, 0px) + 16px) 20px 12px",
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexShrink: 0,
}}>
  <button
    onClick={() => setPanel(0)}
    style={{
      width: 36, height: 36, borderRadius: "50%",
      background: "var(--glass-bg)",
      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      border: "1px solid var(--glass-border)",
      color: "var(--text-primary)",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer",
    }}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  </button>
  <div style={{ flex: 1 }}>
    <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
      {projects.find(p => p.id === selectedProjectForSessions)?.name || t("sessions.title")}
    </div>
  </div>
  <button
    onClick={() => {
      setContextProjectId(selectedProjectForSessions)
      setShowNewSheet(true)
    }}
    style={{
      width: 36, height: 36, borderRadius: "50%",
      background: "var(--glass-bg)",
      backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      border: "1px solid var(--glass-border)",
      color: "var(--text-primary)",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", fontSize: 20, fontWeight: 300,
    }}
  >
    +
  </button>
</div>

{/* Session List */}
<div style={{
  flex: 1,
  overflowY: "auto",
  padding: "8px 16px 40px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
}}>
  {(() => {
    const sessions = selectedProjectForSessions
      ? (sessionsByProject.get(selectedProjectForSessions) || [])
      : []

    if (sessions.length === 0) {
      return (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 16,
          color: "var(--text-secondary)",
        }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{t("sessions.noSessions")}</div>
          <button
            onClick={() => {
              setContextProjectId(selectedProjectForSessions)
              setShowNewSheet(true)
            }}
            style={{
              padding: "10px 24px", borderRadius: 12,
              background: "var(--glass-bg)",
              backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
              border: "1px solid var(--glass-border)",
              boxShadow: "var(--glass-shadow)",
              color: "var(--text-primary)",
              fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            {t("sessions.startFirst")}
          </button>
        </div>
      )
    }

    return sessions.map((session) => {
      const events = sessionEvents.get(session.id) || []
      const status = getSessionStatus(events)
      const dotStyle = STATUS_DOT[status] || STATUS_DOT.idle
      const agentDef = AGENTS.find(a => a.id === session.agentId)
      const latestProgress = getLatestProgress(events)
      const label = labels[session.id]
      const isBlocked = status === "blocked"
      const isReplying = replySessionId === session.id

      return (
        <div key={session.id}>
          <button
            onClick={() => {
              if (longPressFired.current) return
              onSelectSession(session.id)
            }}
            onTouchStart={() => {
              longPressFired.current = false
              longPressTimer.current = setTimeout(() => {
                longPressFired.current = true
                // TODO: session context menu (reuse contextProjectId pattern or add sessionContextId)
                if (navigator.vibrate) navigator.vibrate(50)
              }, 500)
            }}
            onTouchEnd={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
            onTouchMove={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null } }}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: "var(--glass-bg)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              borderRadius: isReplying ? "20px 20px 0 0" : 20,
              border: isBlocked
                ? "1.5px solid rgba(239,68,68,0.3)"
                : "1px solid var(--glass-border)",
              boxShadow: `inset 4px 0 14px -4px ${dotStyle.glow}, var(--glass-shadow)`,
              padding: 16,
              cursor: "pointer",
              transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* Session header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: dotStyle.color,
                boxShadow: dotStyle.shadow,
                flexShrink: 0,
              }} />
              <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)", flex: 1 }}>
                {label || agentDef?.name || session.agentId}
              </div>
              <div style={{
                fontSize: 11, color: "var(--text-secondary)",
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {session.worktreeBranch
                  ? session.worktreeBranch.replace(/^agentrune\//, "")
                  : session.id.slice(0, 8)}
              </div>
            </div>

            {/* Progress summary */}
            {latestProgress ? (
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, marginLeft: 18 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  textTransform: "uppercase" as const,
                  letterSpacing: 0.5,
                  color: dotStyle.color,
                  marginRight: 6,
                }}>
                  {latestProgress.status === "done" ? t("overview.statusDone") : latestProgress.status === "blocked" ? t("overview.statusBlocked") : t("overview.statusWorking")}
                </span>
                {latestProgress.summary.length > 80
                  ? latestProgress.summary.slice(0, 80) + "..."
                  : latestProgress.summary}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "var(--text-secondary)", opacity: 0.6, marginLeft: 18 }}>
                {t("mc.sessionStarted")}
              </div>
            )}

            {/* Blocked — show reply button */}
            {isBlocked && !isReplying && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setReplySessionId(session.id)
                }}
                style={{
                  marginTop: 10, marginLeft: 18,
                  padding: "6px 14px", borderRadius: 10,
                  border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.08)",
                  color: "#ef4444",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                {t("sessions.blocked")}
              </button>
            )}
          </button>

          {/* Inline reply input */}
          {isReplying && (
            <div style={{
              display: "flex", gap: 8,
              padding: "10px 16px",
              background: "var(--glass-bg)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              borderRadius: "0 0 20px 20px",
              borderTop: "none",
              border: "1.5px solid rgba(239,68,68,0.3)",
              borderTopStyle: "none" as const,
            }}>
              <input
                autoFocus
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleInlineReply(session.id) }}
                placeholder={t("sessions.replyPlaceholder")}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: 10,
                  border: "1px solid var(--glass-border)",
                  background: "var(--icon-bg)", color: "var(--text-primary)",
                  fontSize: 13, outline: "none", boxSizing: "border-box",
                }}
              />
              <button
                onClick={() => handleInlineReply(session.id)}
                disabled={!replyText.trim()}
                style={{
                  padding: "8px 14px", borderRadius: 10,
                  border: "1px solid var(--glass-border)",
                  background: replyText.trim() ? "var(--glass-bg)" : "transparent",
                  color: "var(--text-primary)",
                  fontSize: 13, fontWeight: 600, cursor: replyText.trim() ? "pointer" : "default",
                  opacity: replyText.trim() ? 1 : 0.4,
                }}
              >
                {t("input.send")}
              </button>
            </div>
          )}
        </div>
      )
    })
  })()}
</div>
```

**Step 8: Delete the Win+Tab floating session picker**

Remove the entire block from `{/* Floating session picker (Win+Tab style) */}` through the matching closing `</>` (lines ~416-528 in current file).

**Step 9: Verify build**

```bash
cd "C:/Users/agres/Documents/Test/AgentRune-New/app" && npx vite build 2>&1 | tail -5
```

Expected: Build succeeds.

**Step 10: Commit**

```bash
cd "C:/Users/agres/Documents/Test/AgentRune-New"
git add app/src/components/ProjectOverview.tsx
git commit -m "feat(overview): replace Win+Tab picker with 2-panel swipe session dashboard"
```

---

### Task 5: Build APK and update release

**Files:**
- Output: `public/agentrune.apk`

**Step 1: Build web assets**

```bash
cd "C:/Users/agres/Documents/Test/AgentRune-New/app" && npx vite build
```

**Step 2: Sync to Android**

```bash
cd "C:/Users/agres/Documents/Test/AgentRune-New/app" && npx cap sync android
```

**Step 3: Build APK**

```bash
cd "C:/Users/agres/Documents/Test/AgentRune-New/app/android" && JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.10.7-hotspot" ./gradlew assembleDebug
```

**Step 4: Copy APK to public and install via ADB**

```bash
cp "C:/Users/agres/Documents/Test/AgentRune-New/app/android/app/build/outputs/apk/debug/app-debug.apk" "C:/Users/agres/Documents/Test/AgentWiki/public/agentrune.apk"
adb install -r "C:/Users/agres/Documents/Test/AgentRune-New/app/android/app/build/outputs/apk/debug/app-debug.apk"
```

**Step 5: Upload to GitHub Release**

```bash
cd "C:/Users/agres/Documents/Test/AgentWiki"
gh release upload v0.1.0 public/agentrune.apk --clobber
```

**Step 6: Commit APK**

```bash
cd "C:/Users/agres/Documents/Test/AgentWiki"
git add public/agentrune.apk
git commit -m "chore: update APK (session dashboard + worktree toggle)"
```
