import { useEffect, type ReactNode } from "react"
import {
  buildAutomationReport,
  type AutomationReportLocale,
  type AutomationReportSection,
  type AutomationReportSectionKey,
} from "../lib/automation-report"
import type { AutomationResult } from "../data/automation-types"
import { useLocale } from "../lib/i18n/index.js"

interface AutomationReportSheetProps {
  open: boolean
  automationName: string
  results: AutomationResult[]
  selectedResultId?: string | null
  onSelectResult: (resultId: string) => void
  onClose: () => void
}

interface ParsedReportItem {
  label: string | null
  lead: string
  paragraphs: string[]
  bullets: string[]
}

interface SectionVisual {
  title: string
  eyebrow: string
  subtitle: string
  color: string
  tint: string
  panelBg: string
  icon: ReactNode
}

interface ReportCopy {
  title: string
  executive: string
  generatedAt: string
  duration: string
  sectionCount: string
  results: string
  risks: string
  decisions: string
  fullLog: string
  empty: string
  defaultSummary: string
  viewRun: string
  sectionMeta: Record<AutomationReportSectionKey, SectionVisual>
}

const SECTION_ACCENTS: Record<AutomationReportSectionKey, { color: string; tint: string; panelBg: string; icon: ReactNode }> = {
  actions: {
    color: "#37ACC0",
    tint: "rgba(55,172,192,0.16)",
    panelBg: "radial-gradient(circle at top right, rgba(55,172,192,0.22), rgba(55,172,192,0.04) 55%)",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" /></svg>,
  },
  results: {
    color: "#22c55e",
    tint: "rgba(34,197,94,0.16)",
    panelBg: "radial-gradient(circle at top right, rgba(34,197,94,0.22), rgba(34,197,94,0.04) 55%)",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>,
  },
  issues: {
    color: "#f59e0b",
    tint: "rgba(245,158,11,0.18)",
    panelBg: "radial-gradient(circle at top right, rgba(245,158,11,0.24), rgba(245,158,11,0.05) 55%)",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  },
  decisions: {
    color: "#FB7185",
    tint: "rgba(251,113,133,0.17)",
    panelBg: "radial-gradient(circle at top right, rgba(251,113,133,0.24), rgba(251,113,133,0.05) 55%)",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><path d="M21 12c.552 0 1.005.449.95.998a10 10 0 11-8.948-8.95A.951.951 0 0114 5c0 .552-.449 1-1 1a8 8 0 108 8c0-.551.448-1 1-1z" /></svg>,
  },
  notes: {
    color: "#8A6E5E",
    tint: "rgba(208,152,153,0.16)",
    panelBg: "radial-gradient(circle at top right, rgba(208,152,153,0.22), rgba(245,218,197,0.06) 55%)",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>,
  },
}

function getReportCopy(locale: AutomationReportLocale): ReportCopy {
  const zh = locale === "zh-TW"
  return {
    title: zh ? "排程報告" : "Automation Report",
    executive: zh ? "執行摘要" : "Executive Summary",
    generatedAt: zh ? "執行時間" : "Started At",
    duration: zh ? "耗時" : "Duration",
    sectionCount: zh ? "區塊數" : "Sections",
    results: zh ? "結果" : "Results",
    risks: zh ? "風險" : "Risks",
    decisions: zh ? "決策" : "Decisions",
    fullLog: zh ? "原始紀錄" : "Original Log",
    empty: zh ? "目前還沒有可顯示的排程報告。" : "No automation report is available yet.",
    defaultSummary: zh ? "這次執行沒有留下可讀摘要，請展開原始紀錄查看細節。" : "No readable summary was generated for this run. Expand the original log for the raw details.",
    viewRun: zh ? "執行紀錄" : "Run",
    sectionMeta: {
      actions: {
        ...SECTION_ACCENTS.actions,
        title: zh ? "做了哪些事" : "What Happened",
        eyebrow: zh ? "執行過程" : "Execution",
        subtitle: zh ? "按時間順序整理這次排程實際做過的事。" : "A readable timeline of what the automation actually did.",
      },
      results: {
        ...SECTION_ACCENTS.results,
        title: zh ? "結果如何" : "Outcome",
        eyebrow: zh ? "最終結果" : "Outcome",
        subtitle: zh ? "成功產出、狀態確認與重要回傳資訊。" : "The concrete outputs, confirmations, and final result.",
      },
      issues: {
        ...SECTION_ACCENTS.issues,
        title: zh ? "問題與風險" : "Issues & Risks",
        eyebrow: zh ? "風險提醒" : "Risk",
        subtitle: zh ? "這次執行遇到的阻塞、警告或需要注意的地方。" : "Warnings, blockers, and anything that needs attention.",
      },
      decisions: {
        ...SECTION_ACCENTS.decisions,
        title: zh ? "需要你決策" : "Decision Needed",
        eyebrow: zh ? "下一步" : "Next Step",
        subtitle: zh ? "需要你確認、批准或接手的後續動作。" : "What still needs human approval or follow-up.",
      },
      notes: {
        ...SECTION_ACCENTS.notes,
        title: zh ? "補充與備註" : "Notes",
        eyebrow: zh ? "補充資訊" : "Context",
        subtitle: zh ? "其他背景、附註或不適合放進主要結論的資訊。" : "Additional context that supports the report.",
      },
    },
  }
}

function formatDuration(ms: number, locale: AutomationReportLocale): string {
  if (ms < 60_000) return locale === "zh-TW" ? `${Math.round(ms / 1000)} 秒` : `${Math.round(ms / 1000)}s`
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

function getStatusMeta(status: AutomationResult["status"], locale: AutomationReportLocale): { label: string; color: string; bg: string; tone: string } {
  const zh = locale === "zh-TW"
  if (status === "success") {
    return {
      label: zh ? "成功" : "Success",
      color: "#22c55e",
      bg: "rgba(34,197,94,0.16)",
      tone: zh ? "這次排程已完成，下面是整理過的執行結果與關鍵細節。" : "This run finished successfully. Here is the cleaned-up summary and what it produced.",
    }
  }
  if (status === "timeout") {
    return {
      label: zh ? "逾時" : "Timed Out",
      color: "#f59e0b",
      bg: "rgba(245,158,11,0.18)",
      tone: zh ? "這次排程執行到時間上限而停止，需要特別看結果與風險區塊。" : "This run hit its time limit. Review the results and risks to see what completed before it stopped.",
    }
  }
  if (status === "blocked_by_risk") {
    return {
      label: zh ? "已阻擋" : "Blocked",
      color: "#ef4444",
      bg: "rgba(239,68,68,0.18)",
      tone: zh ? "系統因風險判定而停止執行，請先處理問題再繼續。" : "The run was blocked by a risk check. Resolve the issue before retrying.",
    }
  }
  if (status === "skipped_no_confirmation" || status === "skipped_no_action" || status === "skipped_daily_limit") {
    return {
      label: zh ? "已略過" : "Skipped",
      color: "#64748b",
      bg: "rgba(100,116,139,0.18)",
      tone: zh ? "這次排程沒有真的執行工作，通常是條件不符、沒有動作，或達到限制。" : "This run was skipped because the conditions were not met or the automation had nothing to do.",
    }
  }
  if (status === "interrupted") {
    return {
      label: zh ? "已中斷" : "Interrupted",
      color: "#f97316",
      bg: "rgba(249,115,22,0.18)",
      tone: zh ? "這次執行被中途打斷，請特別檢查是否留下未完成狀態。" : "This run was interrupted mid-flight. Check for partial progress before retrying.",
    }
  }
  if (status === "pending_reauth") {
    return {
      label: zh ? "待重新驗證" : "Reauth Needed",
      color: "#FB7185",
      bg: "rgba(251,113,133,0.18)",
      tone: zh ? "這次排程卡在需要重新驗證，後續需要你補一次登入或授權。" : "This run needs reauthentication before it can continue.",
    }
  }
  return {
    label: zh ? "失敗" : "Failed",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.18)",
    tone: zh ? "這次排程沒有成功完成，請先看問題與風險區塊。" : "This run did not complete successfully. Start with the issues section.",
  }
}

function MetricCard({ label, value, helper, accent, tint }: { label: string; value: string; helper?: string; accent: string; tint: string }) {
  return (
    <div style={{
      padding: "14px 16px",
      borderRadius: 18,
      background: `linear-gradient(180deg, ${tint}, rgba(255,255,255,0.08))`,
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      border: `1px solid ${tint}`,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35), 0 12px 24px rgba(15,23,42,0.08)`,
      minWidth: 0,
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute",
        inset: "0 auto 0 0",
        width: 4,
        background: accent,
      }} />
      <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.2, wordBreak: "break-word" }}>
        {value}
      </div>
      {helper && (
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.5 }}>
          {helper}
        </div>
      )}
    </div>
  )
}

function stripBulletPrefix(line: string): string {
  return line.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "").trim()
}

function parseKeyValue(line: string): { label: string; value: string } | null {
  const match = line.match(/^([^:：]{1,28})[:：]\s*(.+)$/)
  if (!match) return null
  return { label: match[1].trim(), value: match[2].trim() }
}

function parseReportItem(item: string): ParsedReportItem {
  const lines = item
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const bullets: string[] = []
  const paragraphs: string[] = []

  for (const line of lines) {
    const normalizedBullet = stripBulletPrefix(line)
    if (normalizedBullet !== line) {
      bullets.push(normalizedBullet)
    } else {
      paragraphs.push(line)
    }
  }

  let label: string | null = null
  let body = paragraphs
  if (paragraphs[0]) {
    const pair = parseKeyValue(paragraphs[0])
    if (pair) {
      label = pair.label
      body = [pair.value, ...paragraphs.slice(1)]
    }
  }

  const lead = body[0] || bullets[0] || item.trim()
  return {
    label,
    lead,
    paragraphs: body.slice(1),
    bullets: label ? bullets : (body.length > 1 ? bullets : bullets.slice(1)),
  }
}

function isMetricLikeItem(item: ParsedReportItem): boolean {
  return !!item.label && item.lead.length <= 120 && item.paragraphs.length === 0 && item.bullets.length === 0
}

function renderTextBlock(item: ParsedReportItem, accentColor: string, tint: string, label?: string) {
  return (
    <div style={{
      padding: "14px 14px 14px 16px",
      borderRadius: 16,
      background: `linear-gradient(180deg, ${tint}, rgba(255,255,255,0.1))`,
      border: `1px solid ${tint}`,
      boxShadow: `inset 3px 0 0 ${accentColor}`,
    }}>
      {label && (
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: accentColor,
          marginBottom: 8,
        }}>
          {label}
        </div>
      )}
      <div style={{
        fontSize: 14,
        lineHeight: 1.7,
        color: "var(--text-primary)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        {item.lead}
      </div>
      {item.paragraphs.map((paragraph, index) => (
        <div key={`p-${index}`} style={{
          marginTop: 8,
          fontSize: 13,
          lineHeight: 1.7,
          color: "var(--text-secondary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {paragraph}
        </div>
      ))}
      {item.bullets.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {item.bullets.map((bullet, index) => (
            <div key={`b-${index}`} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: accentColor,
                marginTop: 6,
                flexShrink: 0,
              }} />
              <div style={{
                fontSize: 13,
                lineHeight: 1.65,
                color: "var(--text-primary)",
                wordBreak: "break-word",
              }}>
                {bullet}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function renderSection(section: AutomationReportSection, meta: SectionVisual, locale: AutomationReportLocale) {
  const parsedItems = section.items.map(parseReportItem)
  const metricItems = parsedItems.filter(isMetricLikeItem)
  const narrativeItems = parsedItems.filter((item) => !isMetricLikeItem(item))
  const itemLabel = locale === "zh-TW" ? "項目" : "Item"
  const decisionLabel = locale === "zh-TW" ? "待決策事項" : "Decision"
  const issueLabel = locale === "zh-TW" ? "風險" : "Risk"

  return (
    <section key={section.key} style={{
      padding: "18px 16px 16px",
      borderRadius: 24,
      background: "linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.06))",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      border: "1px solid var(--glass-border)",
      boxShadow: "0 18px 32px rgba(15,23,42,0.08)",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 14px 16px",
        borderRadius: 18,
        background: `${meta.panelBg}, linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.06))`,
        border: `1px solid ${meta.tint}`,
        marginBottom: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38,
            height: 38,
            borderRadius: 14,
            background: meta.tint,
            color: meta.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            {meta.icon}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 10,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: meta.color,
              fontWeight: 700,
              marginBottom: 4,
            }}>
              {meta.eyebrow}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>
              {meta.title}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.6 }}>
              {meta.subtitle}
            </div>
          </div>
        </div>
      </div>

      {metricItems.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(156px, 1fr))",
          gap: 10,
          marginBottom: narrativeItems.length > 0 ? 12 : 0,
        }}>
          {metricItems.map((item, index) => (
            <MetricCard
              key={`${section.key}-metric-${index}`}
              label={item.label || itemLabel}
              value={item.lead}
              accent={meta.color}
              tint={meta.tint}
            />
          ))}
        </div>
      )}

      {section.key === "actions" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {narrativeItems.map((item, index) => (
            <div key={`${section.key}-${index}`} style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
              <div style={{
                width: 34,
                flexShrink: 0,
                borderRadius: 14,
                background: meta.tint,
                color: meta.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: 0.4,
              }}>
                {index + 1}
              </div>
              <div style={{ flex: 1 }}>
                {renderTextBlock(item, meta.color, meta.tint, item.label || undefined)}
              </div>
            </div>
          ))}
        </div>
      ) : section.key === "decisions" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {narrativeItems.map((item, index) => (
            <div key={`${section.key}-${index}`} style={{
              padding: "14px 14px 14px 16px",
              borderRadius: 18,
              background: `linear-gradient(180deg, ${meta.tint}, rgba(255,255,255,0.1))`,
              border: `1px solid ${meta.tint}`,
              boxShadow: `inset 3px 0 0 ${meta.color}`,
            }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                <div style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.8)",
                  color: meta.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 800,
                  flexShrink: 0,
                }}>
                  {index + 1}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: meta.color, letterSpacing: 1, textTransform: "uppercase" }}>
                  {decisionLabel}
                </div>
              </div>
              {renderTextBlock(item, meta.color, "rgba(255,255,255,0.28)", item.label || undefined)}
            </div>
          ))}
        </div>
      ) : section.key === "issues" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {narrativeItems.map((item, index) => (
            <div key={`${section.key}-${index}`} style={{
              padding: "14px 14px 14px 16px",
              borderRadius: 18,
              background: `linear-gradient(180deg, ${meta.tint}, rgba(255,255,255,0.1))`,
              border: `1px solid ${meta.tint}`,
              boxShadow: `inset 3px 0 0 ${meta.color}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: meta.color, marginBottom: 10 }}>
                {issueLabel} {index + 1}
              </div>
              {renderTextBlock(item, meta.color, "rgba(255,255,255,0.28)", item.label || undefined)}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {narrativeItems.map((item, index) => (
            <div key={`${section.key}-${index}`}>
              {renderTextBlock(item, meta.color, meta.tint, item.label || undefined)}
            </div>
          ))}
        </div>
      )}
    </section>
  )
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
  const copy = getReportCopy(reportLocale)

  useEffect(() => {
    if (!open) return
    const handler = (event: Event) => {
      event.preventDefault()
      onClose()
    }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [open, onClose])

  if (!open) return null

  const sortedResults = [...results].sort((a, b) => b.startedAt - a.startedAt)
  const activeResult = sortedResults.find((result) => result.id === selectedResultId) || sortedResults[0]
  const report = activeResult ? buildAutomationReport(activeResult, reportLocale) : null
  const statusMeta = activeResult ? getStatusMeta(activeResult.status, reportLocale) : null
  const issuesCount = report?.sections.find((section) => section.key === "issues")?.items.length || 0
  const decisionsCount = report?.sections.find((section) => section.key === "decisions")?.items.length || 0
  const resultCount = report?.sections.find((section) => section.key === "results")?.items.length || 0

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1300,
        background: "rgba(3,7,18,0.58)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        flexDirection: "column",
      }}
      onClick={onClose}
    >
      <div
        style={{
          flexShrink: 0,
          padding: "max(env(safe-area-inset-top, 0px), 12px) 16px 12px",
          borderBottom: "1px solid var(--glass-border)",
          background: "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08))",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={onClose}
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            border: "1px solid var(--glass-border)",
            background: "rgba(255,255,255,0.18)",
            color: "var(--text-secondary)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text-primary)" }}>
            {copy.title}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {automationName}
          </div>
        </div>
        {sortedResults.length > 1 && (
          <select
            value={activeResult?.id || ""}
            onChange={(event) => onSelectResult(event.target.value)}
            style={{
              maxWidth: 164,
              padding: "8px 10px",
              borderRadius: 12,
              border: "1px solid var(--glass-border)",
              background: "rgba(255,255,255,0.16)",
              color: "var(--text-primary)",
              fontSize: 11,
              outline: "none",
            }}
          >
            {sortedResults.map((result) => (
              <option key={result.id} value={result.id}>
                {copy.viewRun} {formatStartedAt(result.startedAt, reportLocale)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: `18px 16px calc(env(safe-area-inset-bottom, 0px) + 28px)`,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {!activeResult || !report || !statusMeta ? (
          <div style={{
            margin: "24px auto 0",
            maxWidth: 760,
            padding: "18px 16px",
            borderRadius: 18,
            background: "linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.06))",
            border: "1px solid var(--glass-border)",
            color: "var(--text-secondary)",
            textAlign: "center",
          }}>
            {copy.empty}
          </div>
        ) : (
          <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{
              padding: "20px 18px 18px",
              borderRadius: 26,
              background: `radial-gradient(circle at top right, ${statusMeta.bg}, rgba(255,255,255,0) 42%), radial-gradient(circle at top left, rgba(55,172,192,0.20), rgba(55,172,192,0) 34%), linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.06))`,
              border: "1px solid var(--glass-border)",
              boxShadow: "0 18px 36px rgba(15,23,42,0.10)",
              overflow: "hidden",
              position: "relative",
            }}>
              <div style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 14,
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 10,
                    letterSpacing: 1.6,
                    textTransform: "uppercase",
                    color: "var(--text-secondary)",
                    marginBottom: 8,
                    fontWeight: 700,
                  }}>
                    {copy.executive}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1.3, wordBreak: "break-word" }}>
                    {report.summary || copy.defaultSummary}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 10, lineHeight: 1.65, maxWidth: 520 }}>
                    {statusMeta.tone}
                  </div>
                </div>
                <div style={{
                  alignSelf: "flex-start",
                  padding: "7px 11px",
                  borderRadius: 999,
                  background: statusMeta.bg,
                  color: statusMeta.color,
                  fontSize: 11,
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                  border: `1px solid ${statusMeta.bg}`,
                }}>
                  {statusMeta.label}
                </div>
              </div>

              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 10,
                marginBottom: 12,
              }}>
                <MetricCard label={copy.generatedAt} value={formatStartedAt(activeResult.startedAt, reportLocale)} accent="#37ACC0" tint="rgba(55,172,192,0.18)" />
                <MetricCard label={copy.duration} value={formatDuration(activeResult.finishedAt - activeResult.startedAt, reportLocale)} accent="#37ACC0" tint="rgba(55,172,192,0.18)" />
                <MetricCard
                  label={copy.sectionCount}
                  value={String(report.sections.length)}
                  helper={report.sections.map((section) => copy.sectionMeta[section.key].title).join(" · ") || "—"}
                  accent="#37ACC0"
                  tint="rgba(55,172,192,0.18)"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
                <MetricCard label={copy.results} value={String(resultCount)} accent={copy.sectionMeta.results.color} tint={copy.sectionMeta.results.tint} />
                <MetricCard label={copy.risks} value={String(issuesCount)} accent={copy.sectionMeta.issues.color} tint={issuesCount > 0 ? copy.sectionMeta.issues.tint : "rgba(148,163,184,0.14)"} />
                <MetricCard label={copy.decisions} value={String(decisionsCount)} accent={copy.sectionMeta.decisions.color} tint={decisionsCount > 0 ? copy.sectionMeta.decisions.tint : "rgba(148,163,184,0.14)"} />
              </div>
            </div>

            {report.sections.map((section) => renderSection(section, copy.sectionMeta[section.key], reportLocale))}

            {report.fullLog && (
              <details style={{
                padding: "15px 16px",
                borderRadius: 22,
                background: "linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.05))",
                border: "1px solid var(--glass-border)",
                boxShadow: "0 12px 24px rgba(15,23,42,0.08)",
              }}>
                <summary style={{
                  cursor: "pointer",
                  listStyle: "none",
                  userSelect: "none",
                  fontSize: 14,
                  fontWeight: 800,
                  color: "var(--text-primary)",
                }}>
                  {copy.fullLog}
                </summary>
                <div style={{
                  marginTop: 12,
                  padding: "12px 14px",
                  borderRadius: 16,
                  background: "rgba(15,23,42,0.08)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                  lineHeight: 1.65,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: 360,
                  overflowY: "auto",
                }}>
                  {report.fullLog}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
