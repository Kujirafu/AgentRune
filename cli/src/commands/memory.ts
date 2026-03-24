import { resolve } from "node:path"
import { getMemoryPath, getProjectMemory } from "../server/behavior-rules.js"
import {
  isAllowedContextSectionFile,
  listContextSections,
  readContextSection,
  routeContextSections,
  searchContextSections,
} from "../server/agentlore-init.js"
import { ensureProjectMemoryReady } from "../server/project-memory.js"
import { log } from "../shared/logger.js"

function resolveProjectCwd(projectPath?: string): string {
  return resolve(projectPath || process.cwd())
}

export async function memoryInitCommand(projectPath?: string) {
  const cwd = resolveProjectCwd(projectPath)
  const result = ensureProjectMemoryReady(cwd)

  log.success(`Project memory ready: ${cwd}`)
  log.dim(`Index: ${getMemoryPath(cwd)}`)

  if (result.migrated.migrated) {
    log.info(`Migrated sections: ${result.migrated.sections.join(", ")}`)
  }
  if (result.initialized.created.length > 0) {
    log.info(`Created sections: ${result.initialized.created.join(", ")}`)
  }
  if (!result.migrated.migrated && result.initialized.created.length === 0) {
    log.dim("No new files were needed.")
  }
}

export async function memoryIndexCommand(projectPath?: string) {
  const cwd = resolveProjectCwd(projectPath)
  ensureProjectMemoryReady(cwd)
  const content = getProjectMemory(cwd)
  if (!content) {
    log.warn(`No memory index found at ${getMemoryPath(cwd)}`)
    return
  }
  console.log(content)
}

export async function memorySectionsCommand(projectPath?: string) {
  const cwd = resolveProjectCwd(projectPath)
  ensureProjectMemoryReady(cwd)
  const sections = listContextSections(cwd)
  for (const section of sections) {
    const status = section.exists ? "present" : "missing"
    console.log(`${section.file} [${status}]`)
    console.log(`  ${section.description}`)
    console.log(`  keywords: ${section.keywords.join(", ")}`)
  }
}

export async function memoryReadCommand(file: string, projectPath?: string) {
  if (!isAllowedContextSectionFile(file)) {
    throw new Error(`Invalid memory section: ${file}`)
  }
  const cwd = resolveProjectCwd(projectPath)
  ensureProjectMemoryReady(cwd)
  const content = readContextSection(cwd, file)
  console.log(content)
}

export async function memorySearchCommand(query: string, projectPath?: string, limit?: string) {
  const cwd = resolveProjectCwd(projectPath)
  ensureProjectMemoryReady(cwd)
  const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined
  const results = searchContextSections(cwd, query, {
    limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
  })
  console.log(JSON.stringify({ projectCwd: cwd, results }, null, 2))
}

export async function memoryRouteCommand(
  task: string,
  options?: { path?: string; files?: string[]; max?: string },
) {
  const cwd = resolveProjectCwd(options?.path)
  ensureProjectMemoryReady(cwd)
  const parsedMax = options?.max ? Number.parseInt(options.max, 10) : undefined
  const route = routeContextSections(cwd, {
    task,
    changedFiles: options?.files || [],
    maxSections: Number.isFinite(parsedMax) ? parsedMax : undefined,
  })
  console.log(JSON.stringify({ projectCwd: cwd, ...route }, null, 2))
}
