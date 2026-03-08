import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "fs"
import { join } from "path"
import { homedir } from "os"

// === CODEX ===
console.log("========== CODEX ==========")
const codexSession = join(homedir(), ".codex", "sessions", "2026", "03", "06",
  "rollout-2026-03-06T14-49-08-019cc1e8-3b9d-7bf3-95e3-c9fe1c17682a.jsonl")
const codexLines = readFileSync(codexSession, "utf-8").split("\n").filter(Boolean)
const codexTypes = new Map()
for (const l of codexLines) {
  try {
    const o = JSON.parse(l)
    const t = o.type
    if (!codexTypes.has(t)) codexTypes.set(t, [])
    codexTypes.get(t).push(o)
  } catch {}
}
for (const [t, arr] of codexTypes) {
  console.log(`  ${t}: ${arr.length}`)
}
// Find tool calls
console.log("\nCodex tool calls:")
for (const l of codexLines) {
  try {
    const o = JSON.parse(l)
    if (o.type === "response_item" && o.payload?.type === "function_call") {
      console.log(`  CALL: ${o.payload.name} args=${JSON.stringify(o.payload.arguments || "").slice(0, 120)}`)
    }
    if (o.type === "response_item" && o.payload?.content) {
      for (const c of o.payload.content) {
        if (c.type === "function_call" || c.call_id) {
          console.log(`  CONTENT-CALL: ${c.name || c.type} ${JSON.stringify(c).slice(0, 150)}`)
        }
      }
    }
  } catch {}
}

// === GEMINI ===
console.log("\n========== GEMINI ==========")
const geminiDir = join(homedir(), ".gemini", "history")
try {
  const geminiFiles = readdirSync(geminiDir).sort().reverse().slice(0, 3)
  console.log("Recent files:", geminiFiles)
  if (geminiFiles.length > 0) {
    const first = join(geminiDir, geminiFiles[0])
    const stat = statSync(first)
    console.log(`  ${geminiFiles[0]}: ${stat.size} bytes`)
    // Read first 5KB
    const readSize = Math.min(stat.size, 5000)
    const buf = Buffer.alloc(readSize)
    const fd = openSync(first, "r")
    readSync(fd, buf, 0, readSize, 0)
    closeSync(fd)
    const text = buf.toString("utf-8")
    // Try JSON parse
    try {
      const data = JSON.parse(text)
      console.log("  Format: JSON, keys:", Object.keys(data))
      if (Array.isArray(data)) {
        console.log("  Array of", data.length, "items, first keys:", Object.keys(data[0] || {}))
      }
    } catch {
      // Maybe JSONL
      const lines = text.split("\n").filter(Boolean).slice(0, 3)
      for (const l of lines) {
        try {
          const o = JSON.parse(l)
          console.log("  JSONL line:", Object.keys(o))
        } catch {
          console.log("  Raw line:", l.slice(0, 100))
        }
      }
    }
  }
} catch (e) {
  console.log("  Error:", e.message)
}
