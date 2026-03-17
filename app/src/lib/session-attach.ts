import type { ProjectSettings } from "../types"

export interface SessionAttachMessage extends Record<string, unknown> {
  type: "attach"
  projectId: string
  agentId: string
  sessionId?: string
  autoSaveKeys: boolean
  autoSaveKeysPath: string
  isAgentResume: boolean
  claudeSessionId?: string
  settings: Record<string, unknown>
}

export function getAttachSettings(settings: ProjectSettings, locale: string): Record<string, unknown> {
  return {
    model: settings.model,
    bypass: settings.bypass,
    planMode: settings.planMode,
    autoEdit: settings.autoEdit,
    fastMode: settings.fastMode,
    claudeEffort: settings.claudeEffort,
    claudeThinking: settings.claudeThinking,
    codexModel: settings.codexModel,
    codexMode: settings.codexMode,
    codexReasoningEffort: settings.codexReasoningEffort,
    aiderModel: settings.aiderModel,
    aiderAutoCommit: settings.aiderAutoCommit,
    aiderArchitect: settings.aiderArchitect,
    clineAutoApprove: settings.clineAutoApprove,
    openclawProvider: settings.openclawProvider,
    geminiModel: settings.geminiModel,
    geminiApprovalMode: settings.geminiApprovalMode,
    geminiSandbox: settings.geminiSandbox,
    cursorMode: settings.cursorMode,
    cursorModel: settings.cursorModel,
    cursorSandbox: settings.cursorSandbox,
    locale,
  }
}

export function buildSessionAttachMessage(options: {
  projectId: string
  agentId: string
  sessionId?: string
  autoSaveKeys: boolean
  autoSaveKeysPath: string
  settings: ProjectSettings
  locale: string
  shouldResumeAgent?: boolean
  claudeSessionId?: string
}): SessionAttachMessage {
  return {
    type: "attach",
    projectId: options.projectId,
    agentId: options.agentId,
    sessionId: options.sessionId,
    autoSaveKeys: options.autoSaveKeys,
    autoSaveKeysPath: options.autoSaveKeysPath,
    isAgentResume: options.shouldResumeAgent === true,
    claudeSessionId: options.claudeSessionId || undefined,
    settings: getAttachSettings(options.settings, options.locale),
  }
}
