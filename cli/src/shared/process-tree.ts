import { execFileSync } from "node:child_process"

export function killProcessTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return

  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        windowsHide: true,
      })
      return
    }

    process.kill(-pid, "SIGTERM")
    return
  } catch {
    try {
      process.kill(pid, "SIGTERM")
    } catch {}
  }
}
