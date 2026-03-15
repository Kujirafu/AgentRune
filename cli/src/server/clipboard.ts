// server/clipboard.ts
// Cross-platform clipboard access
import { execFileSync } from "node:child_process"

export function readClipboard(): string {
  try {
    if (process.platform === "darwin") {
      return execFileSync("pbpaste", [], { encoding: "utf-8", timeout: 3000 })
    } else if (process.platform === "win32") {
      return execFileSync("powershell.exe", ["-command", "Get-Clipboard"], { encoding: "utf-8", timeout: 3000 }).trimEnd()
    } else {
      // Linux — try xclip, then xsel
      try {
        return execFileSync("xclip", ["-selection", "clipboard", "-o"], { encoding: "utf-8", timeout: 3000 })
      } catch {
        return execFileSync("xsel", ["--clipboard", "--output"], { encoding: "utf-8", timeout: 3000 })
      }
    }
  } catch {
    return ""
  }
}

export function writeClipboard(text: string): boolean {
  try {
    if (process.platform === "darwin") {
      execFileSync("pbcopy", [], { input: text, timeout: 3000 })
    } else if (process.platform === "win32") {
      execFileSync("powershell.exe", ["-command", "Set-Clipboard", "-Value", "$input"], { input: text, timeout: 3000 })
    } else {
      try {
        execFileSync("xclip", ["-selection", "clipboard"], { input: text, timeout: 3000 })
      } catch {
        execFileSync("xsel", ["--clipboard", "--input"], { input: text, timeout: 3000 })
      }
    }
    return true
  } catch {
    return false
  }
}
