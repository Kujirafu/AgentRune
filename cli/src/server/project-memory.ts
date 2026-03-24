import { basename } from "node:path"
import { initAgentloreStructure, migrateMonolithicAgentlore } from "./agentlore-init.js"
import { ensurePrdApiSection, ensureRulesFile } from "./behavior-rules.js"

export function inferProjectName(projectCwd: string): string {
  return basename(projectCwd) || "Project"
}

export function inferProjectId(projectCwd: string): string {
  const name = inferProjectName(projectCwd)
  const normalized = name.replace(/[^a-zA-Z0-9_-]/g, "_")
  return normalized || "project"
}

export function ensureProjectMemoryReady(
  projectCwd: string,
  options?: { projectName?: string; projectId?: string; port?: number },
): {
  migrated: ReturnType<typeof migrateMonolithicAgentlore>
  initialized: ReturnType<typeof initAgentloreStructure>
} {
  const migrated = migrateMonolithicAgentlore(projectCwd)
  const initialized = initAgentloreStructure(projectCwd, {
    projectName: options?.projectName || inferProjectName(projectCwd),
  })

  ensureRulesFile(projectCwd)
  ensurePrdApiSection(projectCwd, options?.port ?? 3457, options?.projectId || inferProjectId(projectCwd))

  return { migrated, initialized }
}
