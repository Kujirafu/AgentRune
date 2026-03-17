import { useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { AutomationResult } from "../data/automation-types"
import { useLocale } from "../lib/i18n/index.js"
import {
  buildAutomationReport,
  getAutomationResultStatusLabel,
  type AutomationReportLocale,
} from "../lib/automation-report"

interface AutomationReportSheetProps {
  open: boolean
  automationName: string
  results: AutomationResult[]
  selectedResultId?: string | null
  onSelectResult: (resultId: string) => void
  onClose: () => void
}

interface SheetCopy {
  title: string
  runLabel: string
  startedAt: string
  duration: string
  originalLog: string
  empty: string
  noSummary: string
  backLabel: string
}

function getSheetCopy(locale: AutomationReportLocale): SheetCopy {
  if (locale === "zh-TW") {
    return {
      title: "排程報告",
      runLabel: "執行",
      startedAt: "開始時間",
      duration: "耗時",
      originalLog: "原始紀錄",
      empty: "這次執行還沒有可閱讀的報告內容。",
      noSummary: "這次執行還沒有整理好的報告，先展開原始紀錄查看細節。",
      backLabel: "返回",
    }
  }

  return {
    title: "Automation Report",
    runLabel: "Run",
    startedAt: "Started At",
    duration: "Duration",
    originalLog: "Original Log",
    empty: "No readable report is available for this run yet.",
    noSummary: "This run does not have a readable report yet. Expand the original log for raw details.",
    backLabel: "Back",
  }
}

function formatDuration(ms: number, locale: AutomationReportLocale): string {
  if (ms < 60_000) {
    return locale === "zh-TW" ? `${Math.round(ms / 1000)} 秒` : `${Math.round(ms / 1000)}s`
  }

  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.round((ms % 60_000) / 1000)
    return locale === "zh-TW" ? `${minutes} 分 ${seconds} 秒` : `${minutes}m ${seconds}s`
  }

  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.round((ms % 3_600_000) / 60_000)
  return locale === "zh-TW" ? `${hours} 小時 ${minutes} 分` : `${hours}h ${minutes}m`
}

function formatStartedAt(timestamp: number, locale: AutomationReportLocale): string {
  try {
    return new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp))
  } catch {
    return new Date(timestamp).toISOString()
  }
}

function getStatusTone(status: AutomationResult["status"], locale: AutomationReportLocale) {
  const label = getAutomationResultStatusLabel(status, locale)

  if (status === "success") {
    return {
      label,
      color: "#1f9d55",
      border: "rgba(34,197,94,0.22)",
      background: "rgba(34,197,94,0.14)",
    }
  }

  if (status === "timeout") {
    return {
      label,
      color: "#d97706",
      border: "rgba(245,158,11,0.24)",
      background: "rgba(245,158,11,0.14)",
    }
  }

  if (status === "skipped_no_action" || status === "skipped_no_confirmation" || status === "skipped_daily_limit") {
    return {
      label,
      color: "#64748b",
      border: "rgba(100,116,139,0.20)",
      background: "rgba(100,116,139,0.12)",
    }
  }

  if (status === "pending_reauth") {
    return {
      label,
      color: "#e11d48",
      border: "rgba(251,113,133,0.24)",
      background: "rgba(251,113,133,0.14)",
    }
  }

  return {
    label,
    color: "#dc2626",
    border: "rgba(239,68,68,0.22)",
    background: "rgba(239,68,68,0.14)",
  }
}

export default function AutomationReportSheet({
  open,
  automationName,
  results,
  selectedResultId,
  onSelectResult,
  onClose,
}: AutomationReportSheetProps) {
  const { locale } = useLocale()
  const reportLocale: AutomationReportLocale = locale === "zh-TW" ? "zh-TW" : "en"
  const copy = getSheetCopy(reportLocale)
  const isDark = document.documentElement.classList.contains("dark")

  useEffect(() => {
    if (!open) return

    const handleBack = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      onClose()
    }

    document.addEventListener("app:back", handleBack, true)
    document.addEventListener("keydown", handleKeyDown, true)

    return () => {
      document.removeEventListener("app:back", handleBack, true)
      document.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [open, onClose])

  if (!open) return null

  const sortedResults = [...results].sort((a, b) => b.startedAt - a.startedAt)
  const activeResult = sortedResults.find((result) => result.id === selectedResultId) || sortedResults[0]
  const report = activeResult ? buildAutomationReport(activeResult, reportLocale) : null
  const statusTone = activeResult ? getStatusTone(activeResult.status, reportLocale) : null

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1300,
        background: isDark ? "rgba(2, 8, 20, 0.78)" : "rgba(15, 23, 42, 0.24)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          color: "var(--text-primary)",
          background: isDark
            ? "linear-gradient(180deg, rgba(8,12,20,0.98), rgba(8,12,20,0.94))"
            : "linear-gradient(180deg, rgba(250,252,255,0.98), rgba(244,247,251,0.98))",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            flexShrink: 0,
            padding: "max(env(safe-area-inset-top, 0px), 14px) 16px 14px",
            borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)"}`,
            background: isDark
              ? "linear-gradient(180deg, rgba(14,20,32,0.96), rgba(14,20,32,0.84))"
              : "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,251,255,0.9))",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={onClose}
              aria-label={copy.backLabel}
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                border: `1px solid ${isDark ? "rgba(85, 212, 226, 0.24)" : "rgba(52, 119, 146, 0.18)"}`,
                background: isDark ? "rgba(55,172,192,0.16)" : "rgba(55,172,192,0.10)",
                color: isDark ? "#9ce7f0" : "#347792",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  lineHeight: 1.2,
                  color: "var(--text-primary)",
                }}
              >
                {copy.title}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {automationName}
              </div>
            </div>

            {sortedResults.length > 1 && (
              <select
                value={activeResult?.id || ""}
                onChange={(event) => onSelectResult(event.target.value)}
                style={{
                  maxWidth: 176,
                  padding: "9px 11px",
                  borderRadius: 12,
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.10)"}`,
                  background: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.92)",
                  color: "var(--text-primary)",
                  fontSize: 11,
                  outline: "none",
                }}
              >
                {sortedResults.map((result) => (
                  <option key={result.id} value={result.id}>
                    {copy.runLabel} {formatStartedAt(result.startedAt, reportLocale)}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: "18px 16px calc(env(safe-area-inset-bottom, 0px) + 28px)",
          }}
        >
          {!activeResult || !report || !statusTone ? (
            <div
              style={{
                maxWidth: 780,
                margin: "0 auto",
                padding: "22px 20px",
                borderRadius: 24,
                background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.88)",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)"}`,
                color: "var(--text-secondary)",
                textAlign: "center",
              }}
            >
              {copy.empty}
            </div>
          ) : (
            <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
              <div
                style={{
                  padding: "18px 18px 20px",
                  borderRadius: 26,
                  background: isDark
                    ? "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))"
                    : "linear-gradient(180deg, rgba(255,255,255,0.94), rgba(249,251,255,0.88))",
                  border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)"}`,
                  boxShadow: isDark
                    ? "0 24px 48px rgba(0,0,0,0.24)"
                    : "0 24px 48px rgba(15,23,42,0.10)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    marginBottom: 14,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        lineHeight: 1.35,
                        letterSpacing: "-0.02em",
                        color: "var(--text-primary)",
                        wordBreak: "break-word",
                      }}
                    >
                      {report.summary || copy.noSummary}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: "7px 11px",
                      borderRadius: 999,
                      background: statusTone.background,
                      border: `1px solid ${statusTone.border}`,
                      color: statusTone.color,
                      fontSize: 11,
                      fontWeight: 800,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {statusTone.label}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 16,
                  }}
                >
                  {[{
                    label: copy.startedAt,
                    value: formatStartedAt(activeResult.startedAt, reportLocale),
                  }, {
                    label: copy.duration,
                    value: formatDuration(activeResult.finishedAt - activeResult.startedAt, reportLocale),
                  }].map((item) => (
                    <div
                      key={item.label}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "7px 10px",
                        borderRadius: 999,
                        background: isDark ? "rgba(255,255,255,0.05)" : "rgba(55,172,192,0.08)",
                        color: "var(--text-secondary)",
                        fontSize: 11,
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>{item.label}</span>
                      <span>{item.value}</span>
                    </div>
                  ))}
                </div>

                <style>
                  {`
                    .automation-report-md h1,
                    .automation-report-md h2,
                    .automation-report-md h3,
                    .automation-report-md h4 {
                      margin: 1.2em 0 0.55em;
                      line-height: 1.28;
                      font-weight: 800;
                      color: var(--text-primary);
                      letter-spacing: -0.02em;
                    }
                    .automation-report-md h1:first-child,
                    .automation-report-md h2:first-child,
                    .automation-report-md h3:first-child,
                    .automation-report-md h4:first-child {
                      margin-top: 0;
                    }
                    .automation-report-md p,
                    .automation-report-md li {
                      line-height: 1.82;
                      color: var(--text-primary);
                    }
                    .automation-report-md ul,
                    .automation-report-md ol {
                      margin: 0.4em 0 1.1em;
                      padding-left: 1.25em;
                    }
                    .automation-report-md li + li {
                      margin-top: 0.32em;
                    }
                    .automation-report-md code {
                      background: ${isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)"};
                      color: ${isDark ? "#d7f3f7" : "#245a63"};
                      border-radius: 8px;
                      padding: 0.16em 0.42em;
                      font-size: 0.92em;
                    }
                    .automation-report-md pre {
                      background: ${isDark ? "rgba(0,0,0,0.32)" : "rgba(15,23,42,0.05)"};
                      border: 1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)"};
                      border-radius: 16px;
                      padding: 14px;
                      overflow: auto;
                    }
                    .automation-report-md pre code {
                      background: transparent;
                      padding: 0;
                      color: inherit;
                    }
                    .automation-report-md blockquote {
                      margin: 1em 0;
                      padding: 0.15em 0 0.15em 1em;
                      border-left: 3px solid #37ACC0;
                      color: var(--text-secondary);
                    }
                    .automation-report-md table {
                      width: 100%;
                      border-collapse: collapse;
                      margin: 1em 0;
                      font-size: 0.95em;
                    }
                    .automation-report-md th,
                    .automation-report-md td {
                      padding: 10px 12px;
                      border: 1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)"};
                      text-align: left;
                    }
                    .automation-report-md th {
                      background: ${isDark ? "rgba(255,255,255,0.06)" : "rgba(55,172,192,0.08)"};
                    }
                    .automation-report-md a {
                      color: ${isDark ? "#86e5ef" : "#347792"};
                    }
                    .automation-report-md hr {
                      border: none;
                      border-top: 1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)"};
                      margin: 1.4em 0;
                    }
                  `}
                </style>

                <div
                  className="automation-report-md"
                  style={{
                    fontSize: 14,
                    lineHeight: 1.8,
                    color: "var(--text-primary)",
                  }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    urlTransform={(url) => (url.startsWith("http://") || url.startsWith("https://") ? url : "")}
                  >
                    {report.markdown || copy.noSummary}
                  </ReactMarkdown>
                </div>
              </div>

              {report.fullLog && (
                <details
                  style={{
                    padding: "16px 18px",
                    borderRadius: 22,
                    background: isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.76)",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)"}`,
                  }}
                >
                  <summary
                    style={{
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: 800,
                      color: "var(--text-primary)",
                      userSelect: "none",
                    }}
                  >
                    {copy.originalLog}
                  </summary>

                  <pre
                    style={{
                      margin: "12px 0 0",
                      padding: "14px 16px",
                      borderRadius: 16,
                      background: isDark ? "rgba(0,0,0,0.30)" : "rgba(15,23,42,0.05)",
                      border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)"}`,
                      fontSize: 12,
                      lineHeight: 1.65,
                      color: "var(--text-secondary)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 360,
                      overflowY: "auto",
                    }}
                  >
                    {report.fullLog}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
