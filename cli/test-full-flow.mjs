import WebSocket from "ws";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const tokensPath = join(homedir(), ".agentrune", "tokens.json");
const tokens = JSON.parse(readFileSync(tokensPath, "utf-8"));
const cloudToken = Object.entries(tokens.sessionTokens).find(([,v]) => v.deviceId === "cloud")?.[0];

const ws = new WebSocket(`ws://localhost:3456?token=${cloudToken}`);
const startTime = Date.now();
function elapsed() { return ((Date.now() - startTime) / 1000).toFixed(1); }

function stripAnsi(s) {
  return s.replace(/\x1b\[\d+;\d+H/g, "\n").replace(/\x1b\[\d*[ABCD]/g, " ").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\(B/g, "").replace(/\r/g, "");
}

const allEvents = [];
const problems = [];
let phase = "init"; // init -> claude_starting -> resume_tui -> session_selected -> working

function validateEvent(e) {
  const t = e.title || "";
  const d = e.detail || "";
  const combined = t + " " + d;

  // No banner leaks
  if (/Claude Code v\d/i.test(combined)) problems.push(`BANNER: "${combined.slice(0, 80)}"`)
  // No status bar leaks
  if (/plan mode on|shift\+tab to cycle|Found \d+ settings issue/i.test(combined)) problems.push(`STATUSBAR: "${combined.slice(0, 80)}"`)
  // No /resume menu text leaks
  if (/\/resume\s+\/resume|Resume a previous conversation/i.test(combined)) problems.push(`RESUME_NOISE: "${combined.slice(0, 80)}"`)
  // No TUI rendering artifacts
  if (/Resume Session \(\d+ of \d+\).*Ctrl\+[AVR]/i.test(combined)) problems.push(`TUI_LEAK: "${combined.slice(0, 80)}"`)
  // No node -e spam
  if (/^\$ node -e/i.test(t)) problems.push(`NODE_SPAM: "${t.slice(0, 80)}"`)
}

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "attach", projectId: "agentlore", agentId: "claude" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "attached") {
    console.log(`[${elapsed()}s] ATTACHED: ${msg.sessionId}`);
    phase = "claude_starting";
    // Start claude
    setTimeout(() => {
      console.log(`[${elapsed()}s] >>> claude`);
      ws.send(JSON.stringify({ type: "input", data: "claude\r" }));
    }, 1000);
    // /resume
    setTimeout(() => {
      console.log(`[${elapsed()}s] >>> /resume`);
      phase = "resume_tui";
      ws.send(JSON.stringify({ type: "input", data: "/resume\r" }));
    }, 5000);
  } else if (msg.type === "event") {
    const e = msg.event;
    allEvents.push(e);
    validateEvent(e);
    const tag = e.decision ? `[DECISION ${e.decision.options.length} opts]` : "";
    console.log(`[${elapsed()}s] [${phase}] EVENT: ${e.type} "${(e.title || "").slice(0, 80)}" ${tag}`);

    // When we get the resume decision, select first session after 2s
    if (e.type === "decision_request" && /Resume Session/i.test(e.title) && phase === "resume_tui") {
      setTimeout(() => {
        console.log(`[${elapsed()}s] >>> Selecting first session (Enter)`);
        phase = "session_selected";
        ws.send(JSON.stringify({ type: "input", data: "\r" }));
        // Give claude time to resume then check for events
        setTimeout(() => { phase = "working"; }, 3000);
      }, 2000);
    }
  } else if (msg.type === "output" && phase === "working") {
    // In working phase, log significant output to see if parse engine is missing things
    const clean = stripAnsi(msg.data || "").trim();
    if (clean.length > 20 && /[●✻]/.test(msg.data || "")) {
      console.log(`[${elapsed()}s] [OUTPUT w/ bullet] ${clean.slice(0, 120).replace(/\n/g, "\\n")}`);
    }
  } else if (msg.type === "events_replay") {
    const events = msg.events || [];
    const waiting = events.filter(e => e.type === "decision_request" && e.status === "waiting");
    console.log(`[${elapsed()}s] REPLAY: ${events.length} events, ${waiting.length} stale decisions`);
    if (waiting.length > 0) problems.push(`STALE_DECISIONS_IN_REPLAY: ${waiting.length}`);
  }
});

ws.on("error", (e) => console.log("ERR:", e.message));

setTimeout(() => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`FULL FLOW TEST (${allEvents.length} events in ${elapsed()}s)`);
  console.log(`${"=".repeat(60)}`);

  if (problems.length === 0) {
    console.log(`\n  ✅ ALL CHECKS PASSED\n`);
  } else {
    console.log(`\n  ❌ ${problems.length} PROBLEM(S):\n`);
    for (const p of problems) console.log(`    - ${p}`);
    console.log();
  }

  // Event summary
  console.log("  Events by phase:");
  const phases = {};
  for (const e of allEvents) {
    // Crude phase assignment by timestamp
    const key = `${e.type}`;
    phases[key] = (phases[key] || 0) + 1;
  }
  for (const [k, v] of Object.entries(phases)) console.log(`    ${k}: ${v}`);

  // Show all event titles
  console.log("\n  All event titles:");
  for (const e of allEvents) {
    console.log(`    [${e.type}] ${(e.title || "").slice(0, 100)}`);
    if (e.detail) console.log(`      detail: ${e.detail.slice(0, 150).replace(/\n/g, "\\n")}`);
  }

  ws.close();
  process.exit(problems.length > 0 ? 1 : 0);
}, 50000);
