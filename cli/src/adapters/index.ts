// adapters/index.ts
import type { AgentAdapter } from "./types.js"
import { universalAdapter } from "./universal.js"
import { claudeCodeAdapter } from "./claude-code.js"
import { codexAdapter } from "./codex.js"
import { openclawAdapter } from "./openclaw.js"
import { aiderAdapter } from "./aider.js"
import { clineAdapter } from "./cline.js"
import { geminiAdapter } from "./gemini.js"
import { cursorAdapter } from "./cursor.js"

const adapters = new Map<string, AgentAdapter>()

// Register built-in adapters
adapters.set(universalAdapter.id, universalAdapter)
adapters.set(claudeCodeAdapter.id, claudeCodeAdapter)
adapters.set(codexAdapter.id, codexAdapter)
adapters.set(openclawAdapter.id, openclawAdapter)
adapters.set(aiderAdapter.id, aiderAdapter)
adapters.set(clineAdapter.id, clineAdapter)
adapters.set(geminiAdapter.id, geminiAdapter)
adapters.set(cursorAdapter.id, cursorAdapter)

export function getAdapter(agentId: string): AgentAdapter {
  return adapters.get(agentId) || universalAdapter
}

export function getAllAdapters(): AgentAdapter[] {
  return [...adapters.values()]
}
