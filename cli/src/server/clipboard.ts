// server/clipboard.ts
// Cross-platform clipboard access
import { execSync } from "node:child_process"

export function readClipboard(): string {
  try {
    if (process.platform === "darwin") {
      return execSync("pbpaste", { encoding: "utf-8", timeout: 3000 })
    } else if (process.platform === "win32") {
      return execSync("powershell.exe -command Get-Clipboard", { encoding: "utf-8", timeout: 3000 }).trimEnd()
    } else {
      // Linux — try xclip, then xsel
      try {
        return execSync("xclip -selection clipboard -o", { encoding: "utf-8", timeout: 3000 })
      } catch {
        return execSync("xsel --clipboard --output", { encoding: "utf-8", timeout: 3000 })
      }
    }
  } catch {
    return ""
  }
}

export function writeClipboard(text: string): boolean {
  try {
    if (process.platform === "darwin") {
      execSync("pbcopy", { input: text, timeout: 3000 })
    } else if (process.platform === "win32") {
      execSync("powershell.exe -command Set-Clipboard -Value $input", { input: text, timeout: 3000 })
    } else {
      try {
        execSync("xclip -selection clipboard", { input: text, timeout: 3000 })
      } catch {
        execSync("xsel --clipboard --input", { input: text, timeout: 3000 })
      }
    }
    return true
  } catch {
    return false
  }
}
