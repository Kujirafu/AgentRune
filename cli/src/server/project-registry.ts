import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs"
import type { Project } from "../shared/types.js"

const TEST_PROJECT_ID_RE = /^(?:claude|codex|cursor|gemini|aider|cline|openclaw)-(?:smoke|trust)-\d{10,}$/i
const TEST_PROJECT_NAME_RE = /^(?:claude|codex|cursor|gemini|aider|cline|openclaw)\s+(?:smoke|trust)\s+\d{10,}$/i

function normalizeProjectPath(cwd: string): string {
  return cwd
    .replace(/[\\/]+/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase()
}

function isTmpPath(cwd: string): boolean {
  return /(?:^|\/)tmp(?:\/|$)/i.test(normalizeProjectPath(cwd))
}

function hasCanonicalDuplicate(project: Project, projects: Project[]): boolean {
  const normalized = normalizeProjectPath(project.cwd)
  return projects.some((candidate) => (
    candidate.id !== project.id
    && normalizeProjectPath(candidate.cwd) === normalized
    && !TEST_PROJECT_ID_RE.test(candidate.id)
    && !TEST_PROJECT_NAME_RE.test(candidate.name)
  ))
}

export function isEphemeralTestProject(project: Project, projects: Project[]): boolean {
  const looksLikeTestProject = TEST_PROJECT_ID_RE.test(project.id) || TEST_PROJECT_NAME_RE.test(project.name)
  if (!looksLikeTestProject) return false
  return isTmpPath(project.cwd) || hasCanonicalDuplicate(project, projects)
}

export function sanitizeProjectList(projects: Project[]): { projects: Project[]; changed: boolean } {
  const filtered = projects.filter((project) => !isEphemeralTestProject(project, projects))
  if (filtered.length !== projects.length) {
    return { projects: filtered, changed: true }
  }
  return { projects, changed: false }
}

export function loadProjectsFromDisk(path: string, fallbackProject: Project): { projects: Project[]; changed: boolean } {
  if (!existsSync(path)) {
    return { projects: [fallbackProject], changed: false }
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Project[]
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { projects: [fallbackProject], changed: true }
    }
    return sanitizeProjectList(parsed)
  } catch {
    return { projects: [fallbackProject], changed: true }
  }
}

export function saveProjectsToDisk(path: string, projects: Project[]): void {
  const tmpPath = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tmpPath, JSON.stringify(projects, null, 2))
    renameSync(tmpPath, path)
  } catch (err) {
    try { unlinkSync(tmpPath) } catch { /* ignore cleanup failure */ }
    throw err
  }
}
