import React, { useState, useMemo } from "react"
import { BUILTIN_CREWS, CHAIN_TEMPLATES } from "../../../data/builtin-crews"
import type { AutomationTemplate } from "../../../data/automation-types"
import { useLocale } from "../../../lib/i18n/index.js"

interface WorkflowsToolProps {
  theme: "light" | "dark"
  t: (key: string) => string
  onFireCrew: () => void
  onOpenChainBuilder: () => void
  onCreateFromTemplate?: (template: AutomationTemplate) => void
  onOpenChainEditor?: (slug: string) => void
}

// Group chains by subgroup
const CHAIN_GROUPS: { key: string; labelKey: string; fallback: string }[] = [
  { key: "chain_dev", labelKey: "desktop.chainDev", fallback: "Development" },
  { key: "chain_api", labelKey: "desktop.chainApi", fallback: "API" },
  { key: "chain_mobile", labelKey: "desktop.chainMobile", fallback: "Mobile / App" },
  { key: "chain_ai", labelKey: "desktop.chainAi", fallback: "AI" },
  { key: "chain_devops", labelKey: "desktop.chainDevops", fallback: "DevOps" },
  { key: "chain_security", labelKey: "desktop.chainSecurity", fallback: "Security & Quality" },
]

export function WorkflowsTool({ theme, t, onFireCrew, onOpenChainBuilder, onCreateFromTemplate, onOpenChainEditor }: WorkflowsToolProps) {
  const dark = theme === "dark"
  const { t: lt } = useLocale()
  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const border = dark ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)"
  const cardBg = dark ? "rgba(30,41,59,0.6)" : "rgba(255,255,255,0.8)"
  const inputBg = dark ? "rgba(30,41,59,0.5)" : "rgba(241,245,249,0.8)"

  const [search, setSearch] = useState("")
  const query = search.toLowerCase().trim()

  // Filter crews
  const filteredCrews = useMemo(() => {
    if (!query) return BUILTIN_CREWS
    return BUILTIN_CREWS.filter(c => {
      const name = lt(`crew.preset.${c.name}`) || c.name
      return name.toLowerCase().includes(query)
        || (c.tags || []).some(tag => tag.includes(query))
    })
  }, [query, lt])

  // Filter and group chains
  const filteredChainGroups = useMemo(() => {
    const filtered = query
      ? CHAIN_TEMPLATES.filter(c => {
          const name = lt(`chain.${c.name}.name`) || c.name
          return name.toLowerCase().includes(query)
            || (c.tags || []).some(tag => tag.includes(query))
        })
      : CHAIN_TEMPLATES

    return CHAIN_GROUPS.map(g => ({
      ...g,
      chains: filtered.filter(c => c.subgroup === g.key),
    })).filter(g => g.chains.length > 0)
  }, [query, lt])

  const handleTemplateClick = (template: AutomationTemplate) => {
    if (onCreateFromTemplate) {
      onCreateFromTemplate(template)
    }
  }

  return (
    <div style={{ overflow: "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: textPrimary, margin: 0 }}>
          {t("dash.workflows")}
        </h2>
        <button
          onClick={onFireCrew}
          style={{
            padding: "6px 14px", fontSize: 12, fontWeight: 600,
            borderRadius: 6, border: "none",
            background: "#37ACC0", color: "#fff", cursor: "pointer",
          }}
        >
          {t("desktop.fireCrew")}
        </button>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("desktop.searchWorkflows")}
          style={{
            width: "100%", padding: "8px 14px", borderRadius: 8,
            border: `1px solid ${border}`, background: inputBg,
            color: textPrimary, fontSize: 13, fontFamily: "inherit",
            outline: "none", boxSizing: "border-box",
          }}
        />
      </div>

      {/* Crew Templates */}
      <div style={{ fontSize: 13, fontWeight: 600, color: textSecondary, marginBottom: 8 }}>
        {t("dash.crewTemplates")} ({filteredCrews.length})
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
        {filteredCrews.map(crew => {
          const name = lt(`crew.preset.${crew.name}`) || crew.name
          const desc = lt(`crew.preset.${crew.name}.desc`) || ""
          const roleCount = crew.crew?.roles?.length || 0
          return (
            <button
              key={crew.id}
              onClick={() => handleTemplateClick(crew)}
              style={{
                width: "calc(33.33% - 7px)", minWidth: 200,
                padding: "12px 14px", borderRadius: 10,
                background: cardBg, border: `1px solid ${border}`,
                cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: "inherit",
                transition: "border-color 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: textPrimary }}>{name}</div>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0 }}>
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </div>
              {desc && <div style={{ fontSize: 11, color: textSecondary, marginTop: 3 }}>{desc}</div>}
              <div style={{ fontSize: 11, color: "#37ACC0", marginTop: 5 }}>{roleCount} {t("desktop.roles")}</div>
              {crew.tags && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                  {crew.tags.slice(0, 3).map(tag => (
                    <span key={tag} style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 4,
                      background: dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.08)",
                      color: textSecondary,
                    }}>{tag}</span>
                  ))}
                </div>
              )}
            </button>
          )
        })}
        {filteredCrews.length === 0 && (
          <div style={{ fontSize: 12, color: textSecondary, padding: 12 }}>{t("desktop.noMatchingCrews")}</div>
        )}
      </div>

      {/* Skill Chains */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: textSecondary }}>
          {t("dash.skillChains")} ({CHAIN_TEMPLATES.length})
        </div>
        <button
          onClick={onOpenChainBuilder}
          style={{
            padding: "5px 12px", fontSize: 11, fontWeight: 600,
            borderRadius: 5, border: `1px solid ${border}`,
            background: "transparent", color: textSecondary, cursor: "pointer",
          }}
        >
          + {t("desktop.newChain")}
        </button>
      </div>

      {filteredChainGroups.map(group => (
        <div key={group.key} style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: textSecondary,
            textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
          }}>
            {t(group.labelKey) || group.fallback}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {group.chains.map(chain => {
              const name = lt(`chain.${chain.name}.name`) || chain.name
              const desc = lt(`chain.${chain.name}.desc`) || ""
              return (
                <button
                  key={chain.id}
                  onClick={() => onOpenChainEditor ? onOpenChainEditor(chain.name) : handleTemplateClick(chain)}
                  style={{
                    width: "calc(25% - 8px)", minWidth: 160,
                    padding: "10px 12px", borderRadius: 8,
                    background: cardBg, border: `1px solid ${border}`,
                    cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: "inherit",
                    transition: "border-color 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: textPrimary }}>{name}</div>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, flexShrink: 0 }}>
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </div>
                  {desc && (
                    <div style={{
                      fontSize: 11, color: textSecondary, marginTop: 3,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{desc}</div>
                  )}
                  {chain.tags && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                      {chain.tags.slice(0, 2).map(tag => (
                        <span key={tag} style={{
                          fontSize: 10, padding: "1px 5px", borderRadius: 3,
                          background: dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.08)",
                          color: textSecondary,
                        }}>{tag}</span>
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {filteredChainGroups.length === 0 && query && (
        <div style={{ fontSize: 12, color: textSecondary, textAlign: "center", padding: 24 }}>
          {t("desktop.noMatchingChains")}
        </div>
      )}
    </div>
  )
}
