import React, { useState, useEffect, useCallback } from "react"
import type { ProjectSettings, ClaudeEffort, CodexModel, CodexMode, CodexReasoningEffort, CursorMode, CursorSandbox, GeminiApprovalMode, AiderModel, OpenClawProvider, RoutingRule } from "../../../types"
import { DEFAULT_SETTINGS, AGENTS } from "../../../types"
import { getSettings, saveSettings, getWorktreeEnabled, setWorktreeEnabled } from "../../../lib/storage"
import { useLocale, SUPPORTED_LOCALES } from "../../../lib/i18n/index.js"
import { RoutingRulesEditor } from "../RoutingRulesEditor"

interface SettingsToolProps {
  projectId: string | null
  theme: "light" | "dark"
  t: (key: string) => string
  /** Called when a setting changes — parent handles session restart/command injection */
  onSettingsChange?: (prev: ProjectSettings, next: ProjectSettings) => void
}

export function SettingsTool({ projectId, theme, t, onSettingsChange }: SettingsToolProps) {
  const dark = theme === "dark"
  const { locale, setLocale } = useLocale()
  const [selectedAgent, setSelectedAgent] = useState("claude")
  const [settings, setSettings] = useState<ProjectSettings>({ ...DEFAULT_SETTINGS })
  const [worktree, setWorktreeState] = useState(true)
  const [globalRules, setGlobalRules] = useState<RoutingRule[]>([])
  const [projectRules, setProjectRules] = useState<RoutingRule[]>([])

  useEffect(() => {
    if (projectId) {
      // Load from server (single source of truth)
      fetch(`/api/settings/${projectId}`).then(r => r.json()).then(serverSettings => {
        const merged = { ...DEFAULT_SETTINGS, ...serverSettings }
        setSettings(merged)
        saveSettings(projectId, merged) // sync to localStorage too
      }).catch(() => setSettings(getSettings(projectId)))
      fetch(`/api/routing-rules/${projectId}`).then(r => r.json()).then(setProjectRules).catch(() => {})
    }
    setWorktreeState(getWorktreeEnabled())
    fetch("/api/routing-rules").then(r => r.json()).then(setGlobalRules).catch(() => {})
  }, [projectId])

  const update = useCallback(<K extends keyof ProjectSettings>(key: K, value: ProjectSettings[K]) => {
    if (!projectId) return
    const prev = { ...settings }
    const next = { ...settings, [key]: value }
    setSettings(next)
    saveSettings(projectId, next)
    onSettingsChange?.(prev, next)
  }, [projectId, settings, onSettingsChange])

  const textPrimary = dark ? "#e2e8f0" : "#1e293b"
  const textSecondary = dark ? "#94a3b8" : "#64748b"
  const textMuted = dark ? "#475569" : "#94a3b8"
  const sectionBg = dark ? "rgba(30,41,59,0.4)" : "rgba(255,255,255,0.6)"
  const sectionBorder = dark ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.1)"
  const inputBg = dark ? "rgba(15,23,42,0.6)" : "rgba(241,245,249,0.8)"
  const inputBorder = dark ? "rgba(148,163,184,0.1)" : "rgba(148,163,184,0.15)"

  if (!projectId) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: textSecondary, fontSize: 14 }}>
        {t("settings.selectProject")}
      </div>
    )
  }

  // ── Reusable components ──

  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 20, borderRadius: 10,
        background: checked ? "#37ACC0" : (dark ? "rgba(148,163,184,0.2)" : "rgba(148,163,184,0.25)"),
        border: "none", cursor: "pointer",
        position: "relative", transition: "background 0.2s",
        flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: checked ? 18 : 2,
        width: 16, height: 16, borderRadius: 8,
        background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        transition: "left 0.2s",
      }} />
    </button>
  )

  const Row = ({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) => (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 0",
      borderBottom: `1px solid ${sectionBorder}`,
      gap: 16,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: textPrimary }}>{label}</div>
        {description && <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>{description}</div>}
      </div>
      {children}
    </div>
  )

  function SelectField<T extends string>({ value, options, onChange }: {
    value: T; options: { value: T; label: string }[]; onChange: (v: T) => void
  }) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        style={{
          padding: "5px 10px", borderRadius: 6,
          border: `1px solid ${inputBorder}`,
          background: inputBg, color: textPrimary,
          fontSize: 12, fontFamily: "inherit",
          outline: "none", cursor: "pointer",
          minWidth: 120,
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }

  function RadioGroup<T extends string>({ value, options, onChange }: {
    value: T; options: { value: T; label: string }[]; onChange: (v: T) => void
  }) {
    return (
      <div style={{ display: "flex", gap: 4 }}>
        {options.map(o => {
          const active = value === o.value
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              style={{
                padding: "4px 12px", borderRadius: 6,
                border: active ? "1px solid #37ACC0" : `1px solid ${inputBorder}`,
                background: active ? (dark ? "rgba(55,172,192,0.15)" : "rgba(55,172,192,0.1)") : inputBg,
                color: active ? "#37ACC0" : textSecondary,
                fontSize: 12, fontWeight: active ? 600 : 400,
                cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.15s",
              }}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    )
  }

  const TextInput = ({ value, onChange, placeholder }: {
    value: string; onChange: (v: string) => void; placeholder?: string
  }) => (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        padding: "5px 10px", borderRadius: 6,
        border: `1px solid ${inputBorder}`,
        background: inputBg, color: textPrimary,
        fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
        outline: "none", minWidth: 160,
      }}
    />
  )

  // ── Agent-specific settings ──

  const renderClaudeSettings = () => (
    <>
      <Row label={t("settings.model")}>
        <RadioGroup
          value={settings.model}
          options={[
            { value: "sonnet" as const, label: "Sonnet" },
            { value: "opus" as const, label: "Opus" },
            { value: "haiku" as const, label: "Haiku" },
          ]}
          onChange={(v) => update("model", v)}
        />
      </Row>
      <Row label={t("settings.effort")} description={t("settings.effortDefaultDesc")}>
        <SelectField
          value={settings.claudeEffort}
          options={[
            { value: "default" as ClaudeEffort, label: t("settings.effortDefault") },
            { value: "low" as ClaudeEffort, label: t("settings.effortLow") },
            { value: "medium" as ClaudeEffort, label: t("settings.effortMedium") },
            { value: "high" as ClaudeEffort, label: t("settings.effortHigh") },
            { value: "max" as ClaudeEffort, label: t("settings.effortMax") },
          ]}
          onChange={(v) => update("claudeEffort", v)}
        />
      </Row>
      <Row label={t("settings.thinking")} description={t("settings.thinkingDesc")}>
        <Toggle checked={settings.claudeThinking} onChange={(v) => update("claudeThinking", v)} />
      </Row>
      <Row label={t("settings.fastMode")} description={t("settings.fastModeDesc")}>
        <Toggle checked={settings.fastMode} onChange={(v) => update("fastMode", v)} />
      </Row>
    </>
  )

  const renderCodexSettings = () => (
    <>
      <Row label={t("settings.codexModel")}>
        <SelectField
          value={settings.codexModel}
          options={[
            { value: "default" as CodexModel, label: "Default" },
            { value: "gpt-5" as CodexModel, label: "GPT-5" },
            { value: "gpt-5.4" as CodexModel, label: "GPT-5.4" },
            { value: "gpt-5.3" as CodexModel, label: "GPT-5.3" },
            { value: "gpt-5-codex" as CodexModel, label: "GPT-5 Codex" },
            { value: "codex-mini-latest" as CodexModel, label: "Codex Mini" },
          ]}
          onChange={(v) => update("codexModel", v)}
        />
      </Row>
      <Row label={t("settings.mode")}>
        <SelectField
          value={settings.codexMode}
          options={[
            { value: "default" as CodexMode, label: t("settings.codexModeDefault") },
            { value: "full-auto" as CodexMode, label: t("settings.codexModeFullAuto") },
            { value: "danger-full-access" as CodexMode, label: t("settings.codexModeDanger") },
          ]}
          onChange={(v) => update("codexMode", v)}
        />
      </Row>
      <Row label={t("settings.codexReasoning")}>
        <SelectField
          value={settings.codexReasoningEffort}
          options={[
            { value: "default" as CodexReasoningEffort, label: t("settings.reasoningDefault") },
            { value: "low" as CodexReasoningEffort, label: t("settings.reasoningLow") },
            { value: "medium" as CodexReasoningEffort, label: t("settings.reasoningMedium") },
            { value: "high" as CodexReasoningEffort, label: t("settings.reasoningHigh") },
            { value: "xhigh" as CodexReasoningEffort, label: t("settings.reasoningXHigh") },
          ]}
          onChange={(v) => update("codexReasoningEffort", v)}
        />
      </Row>
    </>
  )

  const renderGeminiSettings = () => (
    <>
      <Row label={t("settings.geminiModel")} description={t("settings.geminiModelDesc")}>
        <TextInput
          value={settings.geminiModel}
          onChange={(v) => update("geminiModel", v)}
          placeholder="gemini-2.5-pro"
        />
      </Row>
      <Row label={t("settings.geminiApprovalMode")}>
        <SelectField
          value={settings.geminiApprovalMode}
          options={[
            { value: "default" as GeminiApprovalMode, label: "Default" },
            { value: "auto_edit" as GeminiApprovalMode, label: "Auto Edit" },
            { value: "yolo" as GeminiApprovalMode, label: "YOLO" },
            { value: "plan" as GeminiApprovalMode, label: "Plan" },
          ]}
          onChange={(v) => update("geminiApprovalMode", v)}
        />
      </Row>
      <Row label={t("settings.geminiSandbox")} description={t("settings.geminiSandboxDesc")}>
        <Toggle checked={settings.geminiSandbox} onChange={(v) => update("geminiSandbox", v)} />
      </Row>
    </>
  )

  const renderCursorSettings = () => (
    <>
      <Row label={t("settings.cursorMode")}>
        <RadioGroup
          value={settings.cursorMode}
          options={[
            { value: "default" as CursorMode, label: "Agent" },
            { value: "plan" as CursorMode, label: "Plan" },
            { value: "ask" as CursorMode, label: "Ask" },
          ]}
          onChange={(v) => update("cursorMode", v)}
        />
      </Row>
      <Row label={t("settings.cursorModel")} description={t("settings.cursorModelDesc")}>
        <TextInput
          value={settings.cursorModel}
          onChange={(v) => update("cursorModel", v)}
          placeholder="default"
        />
      </Row>
      <Row label={t("settings.cursorSandbox")}>
        <SelectField
          value={settings.cursorSandbox}
          options={[
            { value: "default" as CursorSandbox, label: t("settings.cursorSandboxDefault") },
            { value: "enabled" as CursorSandbox, label: t("settings.cursorSandboxEnabled") },
            { value: "disabled" as CursorSandbox, label: t("settings.cursorSandboxDisabled") },
          ]}
          onChange={(v) => update("cursorSandbox", v)}
        />
      </Row>
    </>
  )

  const renderAiderSettings = () => (
    <>
      <Row label={t("settings.aiderModel")}>
        <SelectField
          value={settings.aiderModel}
          options={[
            { value: "default" as AiderModel, label: "Default" },
            { value: "gpt-4o" as AiderModel, label: "GPT-4o" },
            { value: "claude-3.5-sonnet" as AiderModel, label: "Claude 3.5" },
            { value: "deepseek-chat" as AiderModel, label: "DeepSeek" },
            { value: "o3-mini" as AiderModel, label: "o3-mini" },
          ]}
          onChange={(v) => update("aiderModel", v)}
        />
      </Row>
      <Row label={t("settings.aiderAutoCommit")} description={t("settings.aiderAutoCommitDesc")}>
        <Toggle checked={settings.aiderAutoCommit} onChange={(v) => update("aiderAutoCommit", v)} />
      </Row>
      <Row label={t("settings.aiderArchitect")} description={t("settings.aiderArchitectDesc")}>
        <Toggle checked={settings.aiderArchitect} onChange={(v) => update("aiderArchitect", v)} />
      </Row>
    </>
  )

  const renderClineSettings = () => (
    <Row label={t("settings.clineAutoApprove")} description={t("settings.clineAutoApproveDesc")}>
      <Toggle checked={settings.clineAutoApprove} onChange={(v) => update("clineAutoApprove", v)} />
    </Row>
  )

  const renderOpenClawSettings = () => (
    <>
      <Row label={t("settings.openclawProvider")}>
        <SelectField
          value={settings.openclawProvider}
          options={[
            { value: "default" as OpenClawProvider, label: "Default" },
            { value: "openai" as OpenClawProvider, label: "OpenAI" },
            { value: "anthropic" as OpenClawProvider, label: "Anthropic" },
            { value: "ollama" as OpenClawProvider, label: "Ollama" },
            { value: "custom" as OpenClawProvider, label: "Custom" },
          ]}
          onChange={(v) => update("openclawProvider", v)}
        />
      </Row>
      <Row label={t("settings.openclawGateway")} description={t("settings.openclawGatewayDesc")}>
        <TextInput
          value={settings.openclawGatewayUrl}
          onChange={(v) => update("openclawGatewayUrl", v)}
          placeholder="https://..."
        />
      </Row>
    </>
  )

  const renderAgentSettings = () => {
    switch (selectedAgent) {
      case "claude": return renderClaudeSettings()
      case "codex": return renderCodexSettings()
      case "gemini": return renderGeminiSettings()
      case "cursor": return renderCursorSettings()
      case "aider": return renderAiderSettings()
      case "cline": return renderClineSettings()
      case "openclaw": return renderOpenClawSettings()
      default: return <div style={{ padding: "16px 0", color: textMuted, fontSize: 13 }}>{t("settings.noSettings")}</div>
    }
  }

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", overflow: "auto" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 20,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: textPrimary }}>
          {t("settings.title")}
        </div>
      </div>

      {/* Agent tabs */}
      <div style={{
        display: "flex", gap: 2, marginBottom: 16,
        padding: 3, borderRadius: 10,
        background: dark ? "rgba(15,23,42,0.4)" : "rgba(241,245,249,0.6)",
        border: `1px solid ${sectionBorder}`,
      }}>
        <button
          onClick={() => setSelectedAgent("routing")}
          style={{
            padding: "6px 12px", borderRadius: 7, border: "none",
            fontSize: 12, fontWeight: selectedAgent === "routing" ? 600 : 400,
            background: selectedAgent === "routing"
              ? (dark ? "rgba(55,172,192,0.15)" : "rgba(255,255,255,0.9)")
              : "transparent",
            color: selectedAgent === "routing" ? "#37ACC0" : textSecondary,
            cursor: "pointer", fontFamily: "inherit",
            transition: "all 0.15s",
            boxShadow: selectedAgent === "routing" ? (dark ? "0 1px 3px rgba(0,0,0,0.2)" : "0 1px 3px rgba(0,0,0,0.08)") : "none",
            flex: 1,
          }}
        >
          {t("routing.title") || "Routing"}
        </button>
        {AGENTS.map(agent => {
          const active = selectedAgent === agent.id
          return (
            <button
              key={agent.id}
              onClick={() => setSelectedAgent(agent.id)}
              style={{
                padding: "6px 12px", borderRadius: 7, border: "none",
                fontSize: 12, fontWeight: active ? 600 : 400,
                background: active
                  ? (dark ? "rgba(55,172,192,0.15)" : "rgba(255,255,255,0.9)")
                  : "transparent",
                color: active ? "#37ACC0" : textSecondary,
                cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.15s",
                boxShadow: active ? (dark ? "0 1px 3px rgba(0,0,0,0.2)" : "0 1px 3px rgba(0,0,0,0.08)") : "none",
                flex: 1,
              }}
            >
              {agent.name}
            </button>
          )
        })}
      </div>

      {/* Agent-specific settings / Routing section */}
      <div style={{
        fontSize: 11, fontWeight: 700, color: textMuted,
        textTransform: "uppercase", letterSpacing: 1,
        marginBottom: 8, paddingLeft: 2,
      }}>
        {selectedAgent === "routing" ? (t("routing.title") || "Routing") : (AGENTS.find(a => a.id === selectedAgent)?.name || selectedAgent)}
      </div>
      <div style={{
        padding: selectedAgent === "routing" ? "12px 16px" : "4px 16px",
        borderRadius: 10,
        background: sectionBg,
        border: `1px solid ${sectionBorder}`,
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        marginBottom: 24,
      }}>
        {selectedAgent === "routing" ? (
          <RoutingRulesEditor
            globalRules={globalRules}
            projectRules={projectRules}
            onSaveGlobal={(rules) => {
              setGlobalRules(rules)
              fetch("/api/routing-rules", {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rules }),
              }).catch(() => {})
            }}
            onSaveProject={(rules) => {
              setProjectRules(rules)
              if (!projectId) return
              fetch(`/api/routing-rules/${projectId}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rules }),
              }).catch(() => {})
            }}
            hasProject={!!projectId}
            theme={theme}
            t={t}
            locale={locale}
          />
        ) : renderAgentSettings()}
      </div>

      {/* General settings section */}
      <div style={{
        fontSize: 11, fontWeight: 700, color: textMuted,
        textTransform: "uppercase", letterSpacing: 1,
        marginBottom: 8, paddingLeft: 2,
      }}>
        {t("settings.general")}
      </div>
      <div style={{
        padding: "4px 16px", borderRadius: 10,
        background: sectionBg,
        border: `1px solid ${sectionBorder}`,
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      }}>
        <Row label={t("settings.language")}>
          <SelectField
            value={locale}
            options={SUPPORTED_LOCALES.map(l => ({ value: l.id, label: l.label }))}
            onChange={(v) => setLocale(v as any)}
          />
        </Row>
        <Row label={t("settings.worktreeIsolation")} description={t("settings.worktreeIsolationDesc")}>
          <Toggle
            checked={worktree}
            onChange={(v) => { setWorktreeState(v); setWorktreeEnabled(v) }}
          />
        </Row>
        <Row label={t("settings.bypass")} description={t("settings.bypassDesc")}>
          <Toggle checked={settings.bypass} onChange={(v) => update("bypass", v)} />
        </Row>
        <Row label={t("settings.planMode")} description={t("settings.planModeDesc")}>
          <Toggle checked={settings.planMode} onChange={(v) => update("planMode", v)} />
        </Row>
        <Row label={t("settings.autoEdit")} description={t("settings.autoEditDesc")}>
          <Toggle checked={settings.autoEdit} onChange={(v) => update("autoEdit", v)} />
        </Row>
      </div>
    </div>
  )
}
