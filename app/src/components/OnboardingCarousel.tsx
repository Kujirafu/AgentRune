import { useState, useRef, useCallback } from "react"
import { useLocale } from "../lib/i18n/index.js"

interface Props {
  onComplete: () => void
}

export function OnboardingCarousel({ onComplete }: Props) {
  const { t } = useLocale()
  const [page, setPage] = useState(0)
  const touchStartX = useRef(0)

  const handleComplete = useCallback(() => {
    localStorage.setItem("onboarding_seen", "1")
    onComplete()
  }, [onComplete])

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(dx) < 50) return
    if (dx < 0 && page < 2) setPage(page + 1)
    if (dx > 0 && page > 0) setPage(page - 1)
  }

  return (
    <div
      style={{
        height: "100dvh", display: "flex", flexDirection: "column",
        background: "var(--bg-primary, #0a0a0f)",
        color: "var(--text-primary, #fff)",
        position: "relative", overflow: "hidden",
        userSelect: "none",
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Skip button */}
      <button
        onClick={handleComplete}
        style={{
          position: "absolute", top: 16, right: 20, zIndex: 10,
          background: "none", border: "none",
          color: "var(--text-secondary, #888)", fontSize: 14, fontWeight: 500,
          cursor: "pointer", padding: "8px 4px",
        }}
      >
        {t("onboarding.skip")}
      </button>

      {/* Slide content */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          width: "100%", maxWidth: 360, padding: "0 32px",
          textAlign: "center",
          transition: "opacity 0.3s ease",
        }}>
          {page === 0 && <Slide1 />}
          {page === 1 && <Slide2 />}
          {page === 2 && <Slide3 onStart={handleComplete} t={t} />}
        </div>
      </div>

      {/* Dots */}
      <div style={{
        display: "flex", gap: 6, justifyContent: "center",
        paddingBottom: 48,
      }}>
        {[0, 1, 2].map(i => (
          <button
            key={i}
            onClick={() => setPage(i)}
            style={{
              width: page === i ? 24 : 8, height: 6,
              borderRadius: 3, border: "none", cursor: "pointer",
              background: page === i ? "#37ACC0" : "rgba(255,255,255,0.15)",
              transition: "all 0.3s ease",
            }}
          />
        ))}
      </div>
    </div>
  )
}

// ─── SVG Illustrations (Anthropic-style geometric line art) ───

function Slide1Illustration() {
  return (
    <svg width="200" height="160" viewBox="0 0 200 160" fill="none">
      {/* Phone */}
      <rect x="30" y="30" width="40" height="70" rx="8" stroke="#37ACC0" strokeWidth="1.5" opacity="0.9" />
      <rect x="42" y="40" width="16" height="24" rx="2" fill="rgba(55,172,192,0.1)" stroke="#37ACC0" strokeWidth="0.5" />
      <circle cx="50" cy="90" r="3" stroke="#37ACC0" strokeWidth="1" />

      {/* Connection lines — flowing dots */}
      <line x1="75" y1="65" x2="125" y2="65" stroke="url(#grad1)" strokeWidth="1.5" strokeDasharray="4 4" />
      <circle cx="90" cy="65" r="2" fill="#37ACC0" opacity="0.8" />
      <circle cx="110" cy="65" r="2" fill="#37ACC0" opacity="0.4" />

      {/* Computer */}
      <rect x="130" y="40" width="50" height="35" rx="4" stroke="#37ACC0" strokeWidth="1.5" opacity="0.9" />
      <line x1="145" y1="75" x2="165" y2="75" stroke="#37ACC0" strokeWidth="1.5" />
      <line x1="140" y1="80" x2="170" y2="80" stroke="#37ACC0" strokeWidth="1.5" />
      {/* Screen content lines */}
      <line x1="138" y1="50" x2="158" y2="50" stroke="rgba(55,172,192,0.3)" strokeWidth="1" />
      <line x1="138" y1="55" x2="172" y2="55" stroke="rgba(55,172,192,0.3)" strokeWidth="1" />
      <line x1="138" y1="60" x2="165" y2="60" stroke="rgba(55,172,192,0.3)" strokeWidth="1" />

      {/* Agent indicators on computer */}
      <circle cx="170" cy="50" r="3" fill="rgba(74,222,128,0.5)" stroke="#4ade80" strokeWidth="0.5" />

      {/* Subtle background circle */}
      <circle cx="100" cy="65" r="55" stroke="rgba(55,172,192,0.08)" strokeWidth="1" />
      <circle cx="100" cy="65" r="70" stroke="rgba(55,172,192,0.04)" strokeWidth="1" />

      <defs>
        <linearGradient id="grad1" x1="75" y1="65" x2="125" y2="65">
          <stop offset="0%" stopColor="#37ACC0" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#37ACC0" stopOpacity="0.2" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function Slide2Illustration() {
  return (
    <svg width="200" height="160" viewBox="0 0 200 160" fill="none">
      {/* Center node — AgentLore */}
      <circle cx="100" cy="75" r="20" stroke="#37ACC0" strokeWidth="1.5" />
      <text x="100" y="72" textAnchor="middle" fill="#37ACC0" fontSize="7" fontWeight="600" fontFamily="system-ui">Agent</text>
      <text x="100" y="82" textAnchor="middle" fill="#37ACC0" fontSize="7" fontWeight="600" fontFamily="system-ui">Lore</text>

      {/* Orbiting nodes with connection lines */}
      {/* Knowledge Base — top left */}
      <line x1="83" y1="60" x2="55" y2="35" stroke="rgba(55,172,192,0.3)" strokeWidth="1" />
      <circle cx="50" cy="30" r="14" stroke="rgba(99,102,241,0.6)" strokeWidth="1" fill="rgba(99,102,241,0.05)" />
      <text x="50" y="33" textAnchor="middle" fill="rgba(99,102,241,0.8)" fontSize="6" fontFamily="system-ui">KB</text>

      {/* Skill Chains — top right */}
      <line x1="117" y1="60" x2="145" y2="35" stroke="rgba(55,172,192,0.3)" strokeWidth="1" />
      <circle cx="150" cy="30" r="14" stroke="rgba(234,179,8,0.6)" strokeWidth="1" fill="rgba(234,179,8,0.05)" />
      <text x="150" y="33" textAnchor="middle" fill="rgba(234,179,8,0.8)" fontSize="6" fontFamily="system-ui">Skills</text>

      {/* Cloud Connect — bottom left */}
      <line x1="83" y1="90" x2="55" y2="115" stroke="rgba(55,172,192,0.3)" strokeWidth="1" />
      <circle cx="50" cy="120" r="14" stroke="rgba(74,222,128,0.6)" strokeWidth="1" fill="rgba(74,222,128,0.05)" />
      <text x="50" y="123" textAnchor="middle" fill="rgba(74,222,128,0.8)" fontSize="6" fontFamily="system-ui">Cloud</text>

      {/* Sync — bottom right */}
      <line x1="117" y1="90" x2="145" y2="115" stroke="rgba(55,172,192,0.3)" strokeWidth="1" />
      <circle cx="150" cy="120" r="14" stroke="rgba(251,129,132,0.6)" strokeWidth="1" fill="rgba(251,129,132,0.05)" />
      <text x="150" y="123" textAnchor="middle" fill="rgba(251,129,132,0.8)" fontSize="6" fontFamily="system-ui">Sync</text>

      {/* Outer ring */}
      <circle cx="100" cy="75" r="60" stroke="rgba(55,172,192,0.06)" strokeWidth="1" />
    </svg>
  )
}

function Slide3Illustration() {
  return (
    <svg width="200" height="160" viewBox="0 0 200 160" fill="none">
      {/* Step 1 */}
      <circle cx="40" cy="70" r="16" stroke="#37ACC0" strokeWidth="1.5" />
      <text x="40" y="74" textAnchor="middle" fill="#37ACC0" fontSize="14" fontWeight="600" fontFamily="system-ui">1</text>
      <text x="40" y="100" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="8" fontFamily="system-ui">Login</text>

      {/* Line 1→2 */}
      <line x1="58" y1="70" x2="82" y2="70" stroke="rgba(55,172,192,0.4)" strokeWidth="1.5" />
      <polygon points="80,66 88,70 80,74" fill="rgba(55,172,192,0.4)" />

      {/* Step 2 */}
      <circle cx="100" cy="70" r="16" stroke="#37ACC0" strokeWidth="1.5" opacity="0.7" />
      <text x="100" y="74" textAnchor="middle" fill="#37ACC0" fontSize="14" fontWeight="600" fontFamily="system-ui" opacity="0.7">2</text>
      <text x="100" y="100" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="system-ui">Install</text>

      {/* Line 2→3 */}
      <line x1="118" y1="70" x2="142" y2="70" stroke="rgba(55,172,192,0.3)" strokeWidth="1.5" />
      <polygon points="140,66 148,70 140,74" fill="rgba(55,172,192,0.3)" />

      {/* Step 3 */}
      <circle cx="160" cy="70" r="16" stroke="#37ACC0" strokeWidth="1.5" opacity="0.5" />
      <text x="160" y="74" textAnchor="middle" fill="#37ACC0" fontSize="14" fontWeight="600" fontFamily="system-ui" opacity="0.5">3</text>
      <text x="160" y="100" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="system-ui">Connect</text>

      {/* Subtle arc */}
      <path d="M 30 50 Q 100 20 170 50" stroke="rgba(55,172,192,0.06)" strokeWidth="1" fill="none" />
    </svg>
  )
}

// ─── Slide Components ───

function Slide1() {
  return (
    <>
      <div style={{ marginBottom: 32 }}>
        <Slide1Illustration />
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12, letterSpacing: -0.5 }}>
        用手機控制 AI Agents
      </h1>
      <p style={{ fontSize: 14, color: "var(--text-secondary, #888)", lineHeight: 1.7 }}>
        隨時隨地啟動、監控、審核你電腦上的 AI 開發工作
      </p>
    </>
  )
}

function Slide2() {
  return (
    <>
      <div style={{ marginBottom: 32 }}>
        <Slide2Illustration />
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12, letterSpacing: -0.5 }}>
        AgentLore 驅動一切
      </h1>
      <p style={{ fontSize: 14, color: "var(--text-secondary, #888)", lineHeight: 1.7 }}>
        知識庫、Skill Chains、雲端連線、跨裝置同步 — 登入即解鎖
      </p>
    </>
  )
}

function Slide3({ onStart, t }: { onStart: () => void; t: (k: string) => string }) {
  return (
    <>
      <div style={{ marginBottom: 32 }}>
        <Slide3Illustration />
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12, letterSpacing: -0.5 }}>
        3 分鐘開始
      </h1>
      <p style={{ fontSize: 14, color: "var(--text-secondary, #888)", lineHeight: 1.7, marginBottom: 32 }}>
        登入 → 裝 CLI → 自動連線
      </p>
      <button
        onClick={onStart}
        style={{
          width: "100%", padding: "16px", borderRadius: 14,
          background: "#37ACC0", color: "#fff", border: "none",
          fontSize: 16, fontWeight: 700, cursor: "pointer",
          boxShadow: "0 4px 20px rgba(55,172,192,0.3)",
        }}
      >
        {t("onboarding.start")}
      </button>
    </>
  )
}
