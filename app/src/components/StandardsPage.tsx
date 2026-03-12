// web/components/StandardsPage.tsx
import { useState, useEffect, useCallback } from "react"
import { getApiBase } from "../lib/storage"
import { useLocale } from "../lib/i18n/index.js"
import { SpringOverlay } from "./SpringOverlay"

// ── Types ──

interface StandardRule {
  id: string
  category: string
  severity: "error" | "warning" | "info"
  enabled: boolean
  title: string
  description: string
  trigger?: string
}

interface StandardCategory {
  id: string
  name: Record<string, string>
  icon: string
  description: Record<string, string>
  builtin: boolean
  rules: StandardRule[]
}

interface ComplexFeatureTrigger {
  type: string
  threshold?: number
  pattern?: string[]
  description: Record<string, string>
}

interface MergedStandards {
  categories: StandardCategory[]
  complexFeatureTriggers: {
    enabled: boolean
    requiredDocs: string[]
    defaultConditions: ComplexFeatureTrigger[]
  }
  source: string
}

interface ValidationReport {
  timestamp: number
  passed: boolean
  results: { ruleId: string; category: string; severity: string; title: string; passed: boolean; message: string }[]
  summary: { total: number; passed: number; failed: number; errors: number; warnings: number }
}

// ── Icons (Lucide-style inline SVG) ──

const ICONS: Record<string, string> = {
  "pen-line": "M12 20h9M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838.838-2.872a2 2 0 0 1 .506-.855z",
  "package": "M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12",
  "scan-search": "M10 13a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM14.5 15.5L17 18M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2",
  "git-branch": "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9",
  "lightbulb": "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4",
  "workflow": "M3 3h6v6H3zM15 3h6v6H15zM9 15h6v6H9zM6 9v3a3 3 0 0 0 3 3M18 9v3a3 3 0 0 1-3 3",
  "file-text": "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  "plus": "M12 5v14M5 12h14",
  "x": "M18 6L6 18M6 6l12 12",
  "info": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01",
  "chevron-left": "M15 18l-6-6 6-6",
  "check": "M20 6L9 17l-5-5",
  "shield-check": "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4",
  "alert-triangle": "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
  "trash-2": "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6",
  "edit-3": "M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  "play": "M5 3l14 9-14 9V3z",
}

function Icon({ name, size = 18, color = "currentColor" }: { name: string; size?: number; color?: string }) {
  const d = ICONS[name] || ICONS["file-text"]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {d.split("M").filter(Boolean).length > 3
        ? <path d={d} />
        : d.split("z").map((seg, i) => <path key={i} d={seg.trim().startsWith("M") ? seg.trim() : "M" + seg.trim()} />)
      }
    </svg>
  )
}

// ── Severity badge ──

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
    error: { bg: "rgba(239,68,68,0.12)", text: "#dc2626", darkBg: "rgba(239,68,68,0.2)", darkText: "#f87171" },
    warning: { bg: "rgba(245,158,11,0.12)", text: "#d97706", darkBg: "rgba(245,158,11,0.2)", darkText: "#fbbf24" },
    info: { bg: "rgba(59,130,246,0.12)", text: "#2563eb", darkBg: "rgba(59,130,246,0.2)", darkText: "#60a5fa" },
  }
  const c = colors[severity] || colors.info
  const isDark = document.documentElement.classList.contains("dark")
  return (
    <span style={{
      fontSize: 10, fontWeight: 600,
      padding: "2px 6px", borderRadius: 6,
      background: isDark ? c.darkBg : c.bg,
      color: isDark ? c.darkText : c.text,
      textTransform: "uppercase",
    }}>
      {severity}
    </span>
  )
}

// ── Props ──

interface StandardsPageProps {
  open: boolean
  onClose: () => void
}

// ── Embedded content (for use inside TaskBoard tab) ──

export function StandardsContent() {
  const { t, locale } = useLocale()
  const lang = locale.startsWith("zh") ? "zh-TW" : "en"
  const isDark = document.documentElement.classList.contains("dark")

  const [standards, setStandards] = useState<MergedStandards | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [editingRule, setEditingRule] = useState<StandardRule | null>(null)
  const [infoCategory, setInfoCategory] = useState<string | null>(null)
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null)
  const [validating, setValidating] = useState(false)

  const fetchStandards = useCallback(() => {
    setLoading(true)
    fetch(`${getApiBase()}/api/standards`)
      .then(r => r.json())
      .then(data => setStandards(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchStandards() }, [fetchStandards])

  const runValidation = useCallback(() => {
    setValidating(true)
    fetch(`${getApiBase()}/api/standards/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(r => r.json())
      .then(report => { setValidationReport(report); setValidating(false) })
      .catch(() => setValidating(false))
  }, [])

  const toggleRule = useCallback((categoryId: string, rule: StandardRule) => {
    const updated = { ...rule, enabled: !rule.enabled }
    fetch(`${getApiBase()}/api/standards/rules`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId, rule: updated }),
    }).then(() => fetchStandards()).catch(() => {})
  }, [fetchStandards])

  const handleDeleteRule = useCallback((categoryId: string, ruleId: string) => {
    fetch(`${getApiBase()}/api/standards/rules/${encodeURIComponent(categoryId)}/${encodeURIComponent(ruleId)}`, { method: "DELETE" })
      .then(() => fetchStandards()).catch(() => {})
  }, [fetchStandards])

  const handleSaveRule = useCallback((categoryId: string, rule: StandardRule) => {
    fetch(`${getApiBase()}/api/standards/rules`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId, rule }),
    }).then(() => { fetchStandards(); setEditingRule(null) }).catch(() => {})
  }, [fetchStandards])

  const selectedCat = standards?.categories.find(c => c.id === selectedCategory)
  const infoCat = standards?.categories.find(c => c.id === infoCategory)

  const cardStyle: React.CSSProperties = {
    padding: 14, borderRadius: 14,
    background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.7)",
    backdropFilter: "blur(20px)",
    border: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
    cursor: "pointer", transition: "background 0.15s",
  }

  const ruleCardStyle: React.CSSProperties = { ...cardStyle, display: "flex", alignItems: "flex-start", gap: 10, cursor: "default" }

  // ── Validation Report ──
  if (validationReport) {
    const rpt = validationReport
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0 12px" }}>
          <button onClick={() => setValidationReport(null)} style={{ background: "none", border: "none", color: "inherit", padding: 4, cursor: "pointer" }}>
            <Icon name="chevron-left" size={20} />
          </button>
          <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{t("standards.validationReport") || "Validation Report"}</span>
          <span style={{
            padding: "3px 10px", borderRadius: 16, fontSize: 12, fontWeight: 700,
            background: rpt.passed ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            color: rpt.passed ? "#22c55e" : "#ef4444",
          }}>{rpt.passed ? (t("standards.passed") || "PASSED") : (t("standards.failed") || "FAILED")}</span>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {[
            { label: t("standards.total") || "Total", value: rpt.summary.total, color: isDark ? "#94a3b8" : "#64748b" },
            { label: t("standards.passed") || "Passed", value: rpt.summary.passed, color: "#22c55e" },
            { label: t("standards.errors") || "Errors", value: rpt.summary.errors, color: "#ef4444" },
            { label: t("standards.warnings") || "Warnings", value: rpt.summary.warnings, color: "#f59e0b" },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, textAlign: "center", padding: "6px 2px", borderRadius: 8, background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: isDark ? "#94a3b8" : "#64748b" }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {rpt.results.filter(r => !r.passed).map(r => (
            <div key={r.ruleId} style={{ ...cardStyle, cursor: "default", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <SeverityBadge severity={r.severity} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{r.title}</span>
              </div>
              <div style={{ fontSize: 11, color: isDark ? "#94a3b8" : "#64748b", whiteSpace: "pre-wrap" }}>{r.message}</div>
            </div>
          ))}
          {rpt.results.filter(r => r.passed).map(r => (
            <div key={r.ruleId} style={{ ...cardStyle, cursor: "default", marginBottom: 4, opacity: 0.6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="check" size={13} color="#22c55e" />
                <span style={{ fontSize: 12 }}>{r.title}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Rule Editor ──
  if (editingRule) {
    return (
      <RuleEditor
        rule={editingRule}
        categoryId={selectedCategory || ""}
        isDark={isDark}
        onSave={(rule) => handleSaveRule(selectedCategory || "", rule)}
        onCancel={() => setEditingRule(null)}
        t={t}
      />
    )
  }

  // ── Category Detail ──
  if (selectedCat) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0 12px" }}>
          <button onClick={() => setSelectedCategory(null)} style={{ background: "none", border: "none", color: "inherit", padding: 4, cursor: "pointer" }}>
            <Icon name="chevron-left" size={20} />
          </button>
          <Icon name={selectedCat.icon} size={18} color={isDark ? "#37ACC0" : "#347792"} />
          <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{selectedCat.name[lang] || selectedCat.name.en}</span>
          <button onClick={() => setEditingRule({ id: "", category: selectedCat.id, severity: "warning", enabled: true, title: "", description: "" })}
            style={{ background: isDark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)", border: "none", borderRadius: 8, padding: "4px 10px", color: "#37ACC0", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
            <Icon name="plus" size={13} color="#37ACC0" />{t("standards.addRule") || "Add"}
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {selectedCat.rules.map(rule => (
            <div key={rule.id} style={ruleCardStyle}>
              <button onClick={() => toggleRule(selectedCat.id, rule)} style={{
                width: 34, height: 18, borderRadius: 9, border: "none", cursor: "pointer",
                background: rule.enabled ? "#37ACC0" : (isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"),
                position: "relative", flexShrink: 0, marginTop: 2, transition: "background 0.2s",
              }}>
                <div style={{ width: 14, height: 14, borderRadius: 7, background: "#fff", position: "absolute", top: 2, left: rule.enabled ? 18 : 2, transition: "left 0.2s" }} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, opacity: rule.enabled ? 1 : 0.5 }}>{rule.title}</span>
                  <SeverityBadge severity={rule.severity} />
                </div>
                <div style={{ fontSize: 11, color: isDark ? "#94a3b8" : "#64748b", lineHeight: 1.4, opacity: rule.enabled ? 1 : 0.5 }}>
                  {rule.description.length > 100 ? rule.description.slice(0, 100) + "..." : rule.description}
                </div>
              </div>
              <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                <button onClick={() => setEditingRule(rule)} style={{ background: "none", border: "none", padding: 3, cursor: "pointer", color: isDark ? "#94a3b8" : "#64748b" }}>
                  <Icon name="edit-3" size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Main: category list ──
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0 12px" }}>
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{t("standards.title") || "Development Standards"}</span>
        <button onClick={runValidation} disabled={validating} style={{
          background: isDark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)",
          border: "none", borderRadius: 8, padding: "4px 10px",
          color: "#37ACC0", fontSize: 11, fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 3, opacity: validating ? 0.5 : 1,
        }}>
          <Icon name="play" size={13} color="#37ACC0" />
          {validating ? (t("standards.validating") || "...") : (t("standards.validate") || "Validate")}
        </button>
      </div>

      {loading && <div style={{ padding: 20, textAlign: "center", color: isDark ? "#64748b" : "#94a3b8", fontSize: 12 }}>{t("standards.loading") || "Loading..."}</div>}

      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {standards?.categories.map(cat => {
          const enabledCount = cat.rules.filter(r => r.enabled).length
          return (
            <div key={cat.id} onClick={() => setSelectedCategory(cat.id)} style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: isDark ? "rgba(55,172,192,0.12)" : "rgba(55,172,192,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={cat.icon} size={16} color={isDark ? "#37ACC0" : "#347792"} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{cat.name[lang] || cat.name.en}</div>
                  <div style={{ fontSize: 10, color: isDark ? "#64748b" : "#94a3b8" }}>{enabledCount}/{cat.rules.length} {t("standards.rulesEnabled") || "rules enabled"}</div>
                </div>
                {cat.builtin && (
                  <button onClick={(e) => { e.stopPropagation(); setInfoCategory(infoCategory === cat.id ? null : cat.id) }}
                    style={{ background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", border: "none", borderRadius: 6, padding: "3px 6px", color: isDark ? "#94a3b8" : "#64748b", cursor: "pointer", fontSize: 10 }}>
                    <Icon name="info" size={12} />
                  </button>
                )}
              </div>
              {infoCategory === cat.id && infoCat && (
                <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: isDark ? "rgba(55,172,192,0.08)" : "rgba(55,172,192,0.05)", border: `1px solid ${isDark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)"}`, fontSize: 11, color: isDark ? "#BDD1C6" : "#347792", lineHeight: 1.5 }}>
                  {infoCat.description[lang] || infoCat.description.en}
                </div>
              )}
            </div>
          )
        })}

        {standards?.complexFeatureTriggers.enabled && (
          <div style={{ ...cardStyle, cursor: "default", borderLeft: `3px solid ${isDark ? "#f59e0b" : "#d97706"}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
              <Icon name="alert-triangle" size={14} color={isDark ? "#fbbf24" : "#d97706"} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>{t("standards.complexDocs") || "Complex Feature Docs"}</span>
            </div>
            <div style={{ fontSize: 11, color: isDark ? "#94a3b8" : "#64748b", lineHeight: 1.5, marginBottom: 4 }}>
              {t("standards.complexDocsDesc") || "When a feature meets any of these conditions, Guide/Flow/Sequence documents are required:"}
            </div>
            {standards.complexFeatureTriggers.defaultConditions.map((cond, i) => (
              <div key={i} style={{ fontSize: 11, color: isDark ? "#BDD1C6" : "#347792", padding: "1px 0 1px 8px" }}>
                {cond.description[lang] || cond.description.en}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Standalone overlay (kept for potential future use) ──

export function StandardsPage({ open, onClose }: StandardsPageProps) {
  const { t, locale } = useLocale()
  const lang = locale.startsWith("zh") ? "zh-TW" : "en"
  const isDark = document.documentElement.classList.contains("dark")

  const [standards, setStandards] = useState<MergedStandards | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [editingRule, setEditingRule] = useState<StandardRule | null>(null)
  const [infoCategory, setInfoCategory] = useState<string | null>(null)
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null)
  const [validating, setValidating] = useState(false)

  // Fetch standards
  const fetchStandards = useCallback(() => {
    setLoading(true)
    fetch(`${getApiBase()}/api/standards`)
      .then(r => r.json())
      .then(data => setStandards(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (open) fetchStandards()
  }, [open, fetchStandards])

  // Hardware back
  useEffect(() => {
    if (!open) return
    const handler = (e: Event) => {
      e.preventDefault()
      if (editingRule) setEditingRule(null)
      else if (validationReport) setValidationReport(null)
      else if (selectedCategory) setSelectedCategory(null)
      else onClose()
    }
    document.addEventListener("app:back", handler)
    return () => document.removeEventListener("app:back", handler)
  }, [open, onClose, editingRule, validationReport, selectedCategory])

  // Run validation
  const runValidation = useCallback(() => {
    setValidating(true)
    fetch(`${getApiBase()}/api/standards/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(r => r.json())
      .then(report => { setValidationReport(report); setValidating(false) })
      .catch(() => setValidating(false))
  }, [])

  // Toggle rule
  const toggleRule = useCallback((categoryId: string, rule: StandardRule) => {
    const updated = { ...rule, enabled: !rule.enabled }
    fetch(`${getApiBase()}/api/standards/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId, rule: updated }),
    }).then(() => fetchStandards()).catch(() => {})
  }, [fetchStandards])

  // Delete rule
  const handleDeleteRule = useCallback((categoryId: string, ruleId: string) => {
    fetch(`${getApiBase()}/api/standards/rules/${encodeURIComponent(categoryId)}/${encodeURIComponent(ruleId)}`, { method: "DELETE" })
      .then(() => fetchStandards())
      .catch(() => {})
  }, [fetchStandards])

  // Save rule from editor
  const handleSaveRule = useCallback((categoryId: string, rule: StandardRule) => {
    fetch(`${getApiBase()}/api/standards/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId, rule }),
    }).then(() => { fetchStandards(); setEditingRule(null) }).catch(() => {})
  }, [fetchStandards])

  const selectedCat = standards?.categories.find(c => c.id === selectedCategory)

  // ── Styles ──

  const pageStyle: React.CSSProperties = {
    height: "100%",
    background: isDark ? "#0f0f1a" : "#f5f5f0",
    color: isDark ? "#e8e6e3" : "#1a1a2e",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  }

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "calc(env(safe-area-inset-top, 0px) + 16px) 16px 12px",
    borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
  }

  const cardStyle: React.CSSProperties = {
    padding: 14,
    borderRadius: 14,
    background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.7)",
    backdropFilter: "blur(20px)",
    border: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
    cursor: "pointer",
    transition: "background 0.15s",
  }

  const ruleCardStyle: React.CSSProperties = {
    ...cardStyle,
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    cursor: "default",
  }

  // ── Validation Report View ──

  if (validationReport) {
    const rpt = validationReport
    return (
      <SpringOverlay open={open}>
        <div style={pageStyle}>
          <div style={headerStyle}>
            <button onClick={() => setValidationReport(null)} style={{ background: "none", border: "none", color: "inherit", padding: 4, cursor: "pointer" }}>
              <Icon name="chevron-left" size={22} />
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{t("standards.validationReport") || "Validation Report"}</div>
            </div>
            <div style={{
              padding: "4px 12px", borderRadius: 20, fontSize: 13, fontWeight: 700,
              background: rpt.passed ? (isDark ? "rgba(34,197,94,0.15)" : "rgba(34,197,94,0.1)") : (isDark ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.1)"),
              color: rpt.passed ? "#22c55e" : "#ef4444",
            }}>
              {rpt.passed ? (t("standards.passed") || "PASSED") : (t("standards.failed") || "FAILED")}
            </div>
          </div>

          {/* Summary */}
          <div style={{ padding: "12px 16px", display: "flex", gap: 8 }}>
            {[
              { label: t("standards.total") || "Total", value: rpt.summary.total, color: isDark ? "#94a3b8" : "#64748b" },
              { label: t("standards.passed") || "Passed", value: rpt.summary.passed, color: "#22c55e" },
              { label: t("standards.errors") || "Errors", value: rpt.summary.errors, color: "#ef4444" },
              { label: t("standards.warnings") || "Warnings", value: rpt.summary.warnings, color: "#f59e0b" },
            ].map(s => (
              <div key={s.label} style={{
                flex: 1, textAlign: "center", padding: "8px 4px", borderRadius: 10,
                background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
              }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 10, color: isDark ? "#94a3b8" : "#64748b", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Results */}
          <div style={{ flex: 1, overflow: "auto", padding: "0 16px 16px" }}>
            {rpt.results.filter(r => !r.passed).length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#ef4444", padding: "8px 0 4px" }}>
                  {t("standards.failedRules") || "Failed Rules"}
                </div>
                {rpt.results.filter(r => !r.passed).map(r => (
                  <div key={r.ruleId} style={{ ...cardStyle, cursor: "default", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <SeverityBadge severity={r.severity} />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: isDark ? "#94a3b8" : "#64748b", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{r.message}</div>
                  </div>
                ))}
              </>
            )}
            {rpt.results.filter(r => r.passed).length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#22c55e", padding: "8px 0 4px" }}>
                  {t("standards.passedRules") || "Passed Rules"}
                </div>
                {rpt.results.filter(r => r.passed).map(r => (
                  <div key={r.ruleId} style={{ ...cardStyle, cursor: "default", marginBottom: 8, opacity: 0.7 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Icon name="check" size={14} color="#22c55e" />
                      <span style={{ fontSize: 13 }}>{r.title}</span>
                      <SeverityBadge severity={r.severity} />
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </SpringOverlay>
    )
  }

  // ── Rule Editor View ──

  if (editingRule) {
    return (
      <SpringOverlay open={open}>
        <div style={pageStyle}>
          <RuleEditor
            rule={editingRule}
            categoryId={selectedCategory || ""}
            isDark={isDark}
            onSave={(rule) => handleSaveRule(selectedCategory || "", rule)}
            onCancel={() => setEditingRule(null)}
            t={t}
          />
        </div>
      </SpringOverlay>
    )
  }

  // ── Category Detail View ──

  if (selectedCat) {
    return (
      <SpringOverlay open={open}>
        <div style={pageStyle}>
          <div style={headerStyle}>
            <button onClick={() => setSelectedCategory(null)} style={{ background: "none", border: "none", color: "inherit", padding: 4, cursor: "pointer" }}>
              <Icon name="chevron-left" size={22} />
            </button>
            <Icon name={selectedCat.icon} size={20} color={isDark ? "#37ACC0" : "#347792"} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedCat.name[lang] || selectedCat.name.en}</div>
              <div style={{ fontSize: 11, color: isDark ? "#64748b" : "#94a3b8" }}>{selectedCat.rules.length} {t("standards.rules") || "rules"}</div>
            </div>
            <button
              onClick={() => setEditingRule({ id: "", category: selectedCat.id, severity: "warning", enabled: true, title: "", description: "" })}
              style={{
                background: isDark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)",
                border: "none", borderRadius: 10, padding: "6px 12px",
                color: "#37ACC0", fontSize: 12, fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <Icon name="plus" size={14} color="#37ACC0" />
              {t("standards.addRule") || "Add"}
            </button>
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {selectedCat.rules.map(rule => (
              <div key={rule.id} style={ruleCardStyle}>
                {/* Toggle */}
                <button
                  onClick={() => toggleRule(selectedCat.id, rule)}
                  style={{
                    width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
                    background: rule.enabled ? "#37ACC0" : (isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"),
                    position: "relative", flexShrink: 0, marginTop: 2, transition: "background 0.2s",
                  }}
                >
                  <div style={{
                    width: 16, height: 16, borderRadius: 8, background: "#fff",
                    position: "absolute", top: 2,
                    left: rule.enabled ? 18 : 2,
                    transition: "left 0.2s",
                  }} />
                </button>
                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, opacity: rule.enabled ? 1 : 0.5 }}>{rule.title}</span>
                    <SeverityBadge severity={rule.severity} />
                  </div>
                  <div style={{ fontSize: 12, color: isDark ? "#94a3b8" : "#64748b", lineHeight: 1.5, opacity: rule.enabled ? 1 : 0.5 }}>
                    {rule.description.length > 120 ? rule.description.slice(0, 120) + "..." : rule.description}
                  </div>
                </div>
                {/* Actions */}
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button onClick={() => setEditingRule(rule)} style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: isDark ? "#94a3b8" : "#64748b" }}>
                    <Icon name="edit-3" size={14} />
                  </button>
                  {!selectedCat.builtin && (
                    <button onClick={() => handleDeleteRule(selectedCat.id, rule.id)} style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: "#ef4444" }}>
                      <Icon name="trash-2" size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SpringOverlay>
    )
  }

  // ── Info Popup ──

  const infoCat = standards?.categories.find(c => c.id === infoCategory)

  // ── Main Categories View ──

  return (
    <SpringOverlay open={open}>
      <div style={pageStyle}>
        <div style={headerStyle}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "inherit", padding: 4, cursor: "pointer" }}>
            <Icon name="chevron-left" size={22} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{t("standards.title") || "Development Standards"}</div>
            <div style={{ fontSize: 11, color: isDark ? "#64748b" : "#94a3b8" }}>
              {standards ? `${standards.categories.length} ${t("standards.categories") || "categories"}` : ""}
            </div>
          </div>
          <button
            onClick={runValidation}
            disabled={validating}
            style={{
              background: isDark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)",
              border: "none", borderRadius: 10, padding: "6px 12px",
              color: "#37ACC0", fontSize: 12, fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
              opacity: validating ? 0.5 : 1,
            }}
          >
            <Icon name="play" size={14} color="#37ACC0" />
            {validating ? (t("standards.validating") || "...") : (t("standards.validate") || "Validate")}
          </button>
        </div>

        {loading && (
          <div style={{ padding: 32, textAlign: "center", color: isDark ? "#64748b" : "#94a3b8", fontSize: 13 }}>
            {t("standards.loading") || "Loading..."}
          </div>
        )}

        <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {standards?.categories.map(cat => {
            const enabledCount = cat.rules.filter(r => r.enabled).length
            const totalCount = cat.rules.length
            return (
              <div
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                style={cardStyle}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: isDark ? "rgba(55,172,192,0.12)" : "rgba(55,172,192,0.08)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon name={cat.icon} size={18} color={isDark ? "#37ACC0" : "#347792"} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{cat.name[lang] || cat.name.en}</div>
                    <div style={{ fontSize: 11, color: isDark ? "#64748b" : "#94a3b8", marginTop: 1 }}>
                      {enabledCount}/{totalCount} {t("standards.rulesEnabled") || "rules enabled"}
                    </div>
                  </div>
                  {cat.builtin && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setInfoCategory(infoCategory === cat.id ? null : cat.id) }}
                      style={{
                        background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                        border: "none", borderRadius: 8, padding: "4px 8px",
                        color: isDark ? "#94a3b8" : "#64748b", cursor: "pointer",
                        fontSize: 11, display: "flex", alignItems: "center", gap: 3,
                      }}
                    >
                      <Icon name="info" size={13} />
                    </button>
                  )}
                </div>

                {/* Info popup */}
                {infoCategory === cat.id && infoCat && (
                  <div style={{
                    marginTop: 10, padding: "10px 12px", borderRadius: 10,
                    background: isDark ? "rgba(55,172,192,0.08)" : "rgba(55,172,192,0.05)",
                    border: `1px solid ${isDark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)"}`,
                    fontSize: 12, color: isDark ? "#BDD1C6" : "#347792", lineHeight: 1.6,
                  }}>
                    {infoCat.description[lang] || infoCat.description.en}
                  </div>
                )}
              </div>
            )
          })}

          {/* Complex Feature Triggers section */}
          {standards?.complexFeatureTriggers.enabled && (
            <div style={{
              ...cardStyle,
              cursor: "default",
              borderLeft: `3px solid ${isDark ? "#f59e0b" : "#d97706"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <Icon name="alert-triangle" size={16} color={isDark ? "#fbbf24" : "#d97706"} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>{t("standards.complexDocs") || "Complex Feature Docs"}</span>
              </div>
              <div style={{ fontSize: 12, color: isDark ? "#94a3b8" : "#64748b", lineHeight: 1.6, marginBottom: 6 }}>
                {t("standards.complexDocsDesc") || "When a feature meets any of these conditions, Guide/Flow/Sequence documents are required:"}
              </div>
              {standards.complexFeatureTriggers.defaultConditions.map((cond, i) => (
                <div key={i} style={{ fontSize: 12, color: isDark ? "#BDD1C6" : "#347792", padding: "2px 0", paddingLeft: 8 }}>
                  {cond.description[lang] || cond.description.en}
                </div>
              ))}
              <div style={{ fontSize: 11, color: isDark ? "#64748b" : "#94a3b8", marginTop: 6 }}>
                {t("standards.requiredDocs") || "Required"}: {standards.complexFeatureTriggers.requiredDocs.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(", ")}
              </div>
            </div>
          )}
        </div>
      </div>
    </SpringOverlay>
  )
}

// ── Rule Editor sub-component ──

function RuleEditor({ rule, categoryId, isDark, onSave, onCancel, t }: {
  rule: StandardRule
  categoryId: string
  isDark: boolean
  onSave: (rule: StandardRule) => void
  onCancel: () => void
  t: (key: string) => string
}) {
  const [id, setId] = useState(rule.id)
  const [title, setTitle] = useState(rule.title)
  const [description, setDescription] = useState(rule.description)
  const [severity, setSeverity] = useState(rule.severity)
  const [enabled, setEnabled] = useState(rule.enabled)
  const isNew = !rule.id

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
    background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.8)",
    color: isDark ? "#e8e6e3" : "#1a1a2e",
    fontSize: 13,
    outline: "none",
    fontFamily: "inherit",
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600,
    color: isDark ? "#94a3b8" : "#64748b",
    marginBottom: 4, display: "block",
  }

  return (
    <>
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "calc(env(safe-area-inset-top, 0px) + 16px) 16px 12px",
        borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
      }}>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: "inherit", padding: 4, cursor: "pointer" }}>
          <Icon name="x" size={22} />
        </button>
        <div style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>
          {isNew ? (t("standards.newRule") || "New Rule") : (t("standards.editRule") || "Edit Rule")}
        </div>
        <button
          onClick={() => {
            const ruleId = id || title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
            onSave({ id: ruleId, category: categoryId, severity, enabled, title: title || ruleId, description })
          }}
          disabled={!title && !id}
          style={{
            background: "#37ACC0", border: "none", borderRadius: 10, padding: "6px 16px",
            color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            opacity: (!title && !id) ? 0.4 : 1,
          }}
        >
          {t("standards.save") || "Save"}
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {isNew && (
          <div>
            <label style={labelStyle}>ID</label>
            <input
              value={id}
              onChange={e => setId(e.target.value)}
              placeholder="rule-id (auto-generated from title if empty)"
              style={inputStyle}
            />
          </div>
        )}
        <div>
          <label style={labelStyle}>{t("standards.ruleTitle") || "Title"}</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Rule title" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>{t("standards.ruleDescription") || "Description"}</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What this rule requires..."
            rows={6}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>
        <div>
          <label style={labelStyle}>{t("standards.severity") || "Severity"}</label>
          <div style={{ display: "flex", gap: 8 }}>
            {(["error", "warning", "info"] as const).map(s => (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 10, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", textTransform: "uppercase",
                  border: severity === s ? "2px solid #37ACC0" : `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
                  background: severity === s ? (isDark ? "rgba(55,172,192,0.12)" : "rgba(55,172,192,0.08)") : "transparent",
                  color: severity === s ? "#37ACC0" : (isDark ? "#94a3b8" : "#64748b"),
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ ...labelStyle, marginBottom: 0, flex: 1 }}>{t("standards.enabled") || "Enabled"}</label>
          <button
            onClick={() => setEnabled(!enabled)}
            style={{
              width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer",
              background: enabled ? "#37ACC0" : (isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"),
              position: "relative", transition: "background 0.2s",
            }}
          >
            <div style={{
              width: 20, height: 20, borderRadius: 10, background: "#fff",
              position: "absolute", top: 2,
              left: enabled ? 22 : 2,
              transition: "left 0.2s",
            }} />
          </button>
        </div>
      </div>
    </>
  )
}
