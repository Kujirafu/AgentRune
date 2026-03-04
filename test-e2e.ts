// End-to-end test: simulate real Claude Code PTY output through the full pipeline
// Tests: PTY → ParseEngine → events → would-be WS messages
import { ParseEngine } from "./server/parse-engine.js"

const engine = new ParseEngine("claude", "test-project")
const allEvents: any[] = []

function feed(label: string, data: string) {
  const events = engine.feed(data)
  for (const e of events) allEvents.push(e)
  const stripped = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/[\x00-\x1f]/g, " ").trim()
  const preview = stripped.slice(0, 80)
  const evtStr = events.length > 0
    ? events.map(e => `${e.type}:"${e.title}"`).join(", ")
    : "(none)"
  console.log(`[${label.padEnd(30)}] events=${events.length}  ${evtStr}`)
  if (preview) console.log(`  stripped: "${preview}"`)
}

console.log("═══ Test 1: Clean output (newlines present) ═══")
feed("shell prompt", "❯ \n")
feed("user types claude", "claude\r\n")
feed("thinking start", "∴ Thinking...\r\n")
feed("thinking text", "  The user is testing AgentRune\r\n")
feed("response", "● 了解，你正在測試 AgentRune。有什麼需要幫忙的嗎？\r\n")
feed("token info", "↑ 28,852 tokens · 2.1s\r\n")
feed("prompt", "❯ \n")

console.log(`\nTotal events: ${allEvents.length}`)
allEvents.length = 0

console.log("\n═══ Test 2: Ink-style (NO newlines, cursor positioning) ═══")
const engine2 = new ParseEngine("claude", "test-project")
const allEvents2: any[] = []
function feed2(label: string, data: string) {
  const events = engine2.feed(data)
  for (const e of events) allEvents2.push(e)
  const stripped = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/[\x00-\x1f]/g, " ").trim()
  const evtStr = events.length > 0
    ? events.map(e => `${e.type}:"${e.title}"`).join(", ")
    : "(none)"
  console.log(`[${label.padEnd(30)}] events=${events.length}  ${evtStr}`)
}

// Ink sends cursor moves + content WITHOUT newlines
feed2("hide cursor", "\x1b[?25l")
feed2("cursor+thinking", "\x1b[3;1H\x1b[2K\x1b[3m∴ Thinking...\x1b[23m")
feed2("cursor+think text", "\x1b[4;1H\x1b[2K\x1b[2m  The user is testing\x1b[22m")
feed2("cursor+response", "\x1b[6;1H\x1b[2K\x1b[1m●\x1b[22m 了解！你在用 AgentRune 測試連線。一切運作正常嗎？")
feed2("show cursor", "\x1b[?25h")
feed2("cursor+tokens", "\x1b[8;1H\x1b[2K\x1b[2m↑ 28,852 tokens · 2.1s\x1b[22m")
feed2("cursor+prompt", "\x1b[10;1H\x1b[2K❯ ")

console.log(`\nTotal events: ${allEvents2.length}`)

console.log("\n═══ Test 3: Ink-style SPLIT (● in one chunk, text in another) ═══")
const engine3 = new ParseEngine("claude", "test-project")
const allEvents3: any[] = []
function feed3(label: string, data: string) {
  const events = engine3.feed(data)
  for (const e of events) allEvents3.push(e)
  const evtStr = events.length > 0
    ? events.map(e => `${e.type}:"${e.title}" detail="${(e.detail||"").slice(0,40)}"`).join(", ")
    : "(none)"
  console.log(`[${label.padEnd(30)}] events=${events.length}  ${evtStr}`)
}

feed3("thinking no-newline", "\x1b[3;1H\x1b[2K∴ Thinking...")
feed3("think text no-newline", "\x1b[4;1H\x1b[2K  Analyzing")
// ● arrives alone (no text after it)
feed3("● bullet alone", "\x1b[6;1H\x1b[2K\x1b[1m●\x1b[22m")
// Response text arrives in NEXT chunk
feed3("response text after ●", " 了解！你在用 AgentRune 測試連線。")
// More text
feed3("more response", "一切運作正常嗎？有發現什麼問題？")
// Newline finally arrives
feed3("newline", "\r\n")
feed3("tokens no-newline", "\x1b[8;1H\x1b[2K↑ 28,852 tokens")

console.log(`\nTotal events: ${allEvents3.length}`)

console.log("\n═══ Test 4: Full Ink screen redraw (all at once) ═══")
const engine4 = new ParseEngine("claude", "test-project")
const allEvents4: any[] = []
function feed4(label: string, data: string) {
  const events = engine4.feed(data)
  for (const e of events) allEvents4.push(e)
  const evtStr = events.length > 0
    ? events.map(e => `${e.type}:"${e.title}" detail="${(e.detail||"").slice(0,60)}"`).join(", ")
    : "(none)"
  console.log(`[${label.padEnd(30)}] events=${events.length}  ${evtStr}`)
}

// Ink might send entire screen as one chunk
const fullRedraw = [
  "\x1b[?25l",
  "\x1b[1;1H\x1b[2J",  // clear screen
  "\x1b[1;1H╭─ AgentRune ─╮",
  "\x1b[3;1H\x1b[3m∴ Thinking...\x1b[23m",
  "\x1b[4;1H\x1b[2m  The user is testing\x1b[22m",
  "\x1b[6;1H\x1b[1m●\x1b[22m 了解！連線測試看起來正常。你想要做什麼？",
  "\x1b[8;1H  - 修復發現的 bug？",
  "\x1b[9;1H  - 加新功能？",
  "\x1b[11;1H\x1b[2m↑ 28,852 tokens · 2.1s\x1b[22m",
  "\x1b[13;1H❯ ",
  "\x1b[?25h",
].join("")

feed4("full screen redraw", fullRedraw)
console.log(`\nTotal events: ${allEvents4.length}`)

// Summary
console.log("\n═══ SUMMARY ═══")
console.log(`Test 1 (clean):       ${allEvents.length > 0 ? "✓ PASS" : "✗ FAIL"} (${allEvents.length} events)`)
console.log(`Test 2 (ink no-\\n):   ${allEvents2.length > 0 ? "✓ PASS" : "✗ FAIL"} (${allEvents2.length} events)`)
console.log(`Test 3 (ink split):   ${allEvents3.length > 0 ? "✓ PASS" : "✗ FAIL"} (${allEvents3.length} events)`)
console.log(`Test 4 (full redraw): ${allEvents4.length > 0 ? "✓ PASS" : "✗ FAIL"} (${allEvents4.length} events)`)
