import { app } from "electron"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export function logRuntime(message: string) {
  const line = `${new Date().toISOString()} ${message}`
  console.error(line)
  try {
    const baseDir = app.isReady() ? app.getPath("userData") : process.cwd()
    const logDir = join(baseDir, "logs")
    mkdirSync(logDir, { recursive: true })
    appendFileSync(join(logDir, "desktop-runtime.log"), `${line}\n`, "utf8")
  } catch {}
}
