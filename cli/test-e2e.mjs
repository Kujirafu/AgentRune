import WebSocket from "ws";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const tokensPath = join(homedir(), ".agentrune", "tokens.json");
const tokens = JSON.parse(readFileSync(tokensPath, "utf-8"));
const cloudToken = Object.entries(tokens.sessionTokens).find(([,v]) => v.deviceId === "cloud")?.[0];
if (!cloudToken) { console.log("FAIL: No cloud token found"); process.exit(1); }

const ws = new WebSocket(`ws://localhost:3456?token=${cloudToken}`);
const startTime = Date.now();
let sessionId = null;
const allEvents = [];
const problems = [];

function elapsed() { return ((Date.now() - startTime) / 1000).toFixed(1); }

// --- Validation rules ---
function validateEvent(e) {
  const t = e.title || "";
  const d = e.detail || "";
  const combined = t + " " + d;

  // Rule 1: No "$ node -e" or diagnostic bash spam
  if (/^\$ node -e/i.test(t) || /^\$ node\s+[^\s]+\.(mjs|js|ts)/i.test(t)) {
    problems.push(`BASH_SPAM: "${t.slice(0, 80)}"`)
  }

  // Rule 2: No Claude Code banner/startup text
  if (/Claude Code v\d/i.test(combined) || /Opus \d.*Claude Max/i.test(combined)) {
    problems.push(`BANNER_LEAK: "${combined.slice(0, 100)}"`)
  }

  // Rule 3: No status bar text
  if (/plan mode on|shift\+tab to cycle|Found \d+ settings issue|\/doctor for details/i.test(combined)) {
    problems.push(`STATUSBAR_LEAK: "${combined.slice(0, 100)}"`)
  }

  // Rule 4: No raw TUI artifacts (box chars, cursor garbage)
  if (/[\u2500\u2502\u250c\u2510\u2514\u2518\u256d\u256e\u2570\u256f]{3,}/.test(combined)) {
    problems.push(`TUI_GARBAGE: "${combined.slice(0, 100)}"`)
  }

  // Rule 5: No "/resume /resume Resume a previous" noise
  if (/\/resume\s+\/resume|Resume a previous conversation/i.test(combined)) {
    problems.push(`RESUME_NOISE: "${combined.slice(0, 100)}"`)
  }
}

function validateResumeDecision(e) {
  if (e.type !== "decision_request" || !/Resume Session/i.test(e.title)) return;
  const opts = e.decision?.options || [];

  // Rule 6: No duplicate options
  const labels = opts.map(o => o.label.replace(/\s+/g, " ").trim());
  const unique = new Set(labels);
  if (unique.size < labels.length) {
    problems.push(`RESUME_DUPLICATES: ${labels.length} options but only ${unique.size} unique. Dupes: ${labels.filter((l, i) => labels.indexOf(l) !== i).slice(0, 3).map(l => `"${l.slice(0, 50)}"`).join(", ")}`)
  }
}

ws.on("open", () => {
  console.log(`[${elapsed()}s] WS OPEN`);
  ws.send(JSON.stringify({ type: "attach", projectId: "agentlore", agentId: "claude" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "attached") {
    sessionId = msg.sessionId;
    console.log(`[${elapsed()}s] ATTACHED: session=${msg.sessionId}`);
    // Start claude
    setTimeout(() => {
      console.log(`[${elapsed()}s] >>> Starting claude`);
      ws.send(JSON.stringify({ type: "input", data: "claude\r" }));
    }, 1500);
    // Type /resume after claude starts
    setTimeout(() => {
      console.log(`[${elapsed()}s] >>> Typing /resume`);
      ws.send(JSON.stringify({ type: "input", data: "/resume\r" }));
    }, 5000);
  } else if (msg.type === "event") {
    const e = msg.event;
    allEvents.push(e);
    validateEvent(e);
    validateResumeDecision(e);
    const decision = e.decision ? ` [DECISION opts=${e.decision.options.length}]` : "";
    const titleClean = (e.title || "").substring(0, 100).replace(/\n/g, "\\n");
    console.log(`[${elapsed()}s] EVENT #${allEvents.length}: type=${e.type} status=${e.status} title="${titleClean}"${decision}`);
  } else if (msg.type === "events_replay") {
    const replayEvents = msg.events || [];
    console.log(`[${elapsed()}s] EVENTS_REPLAY: count=${replayEvents.length}`);
    // Validate replayed events too
    for (const e of replayEvents) {
      validateEvent(e);
    }
  } else if (msg.type === "token_refresh") {
    console.log(`[${elapsed()}s] TOKEN_REFRESH`);
  } else if (msg.type !== "output" && msg.type !== "scrollback") {
    console.log(`[${elapsed()}s] ${msg.type}`);
  }
});

ws.on("error", (e) => console.log("ERR:", e.message));

// Wait 30s for resume TUI to appear, be parsed, and potentially select
setTimeout(() => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`E2E TEST RESULTS (${allEvents.length} events in ${elapsed()}s)`);
  console.log(`${"=".repeat(60)}`);

  if (problems.length === 0) {
    console.log(`\n  ✅ ALL CHECKS PASSED — no garbage, no duplicates, no spam\n`);
  } else {
    console.log(`\n  ❌ ${problems.length} PROBLEM(S) FOUND:\n`);
    for (const p of problems) {
      console.log(`    - ${p}`);
    }
    console.log();
  }

  // Summary of events by type
  const byType = {};
  for (const e of allEvents) {
    const key = `${e.type}:${e.status}`;
    byType[key] = (byType[key] || 0) + 1;
  }
  console.log("  Event breakdown:");
  for (const [key, count] of Object.entries(byType)) {
    console.log(`    ${key}: ${count}`);
  }

  ws.close();
  process.exit(problems.length > 0 ? 1 : 0);
}, 30000);
