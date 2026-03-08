import WebSocket from "ws";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const tokensPath = join(homedir(), ".agentrune", "tokens.json");
const tokens = JSON.parse(readFileSync(tokensPath, "utf-8"));
const cloudToken = Object.entries(tokens.sessionTokens).find(([,v]) => v.deviceId === "cloud")?.[0];

const ws = new WebSocket(`ws://localhost:3456?token=${cloudToken}`);
const startTime = Date.now();
let sessionId = null;
let eventCount = 0;

function elapsed() { return ((Date.now() - startTime) / 1000).toFixed(1); }

ws.on("open", () => {
  console.log("WS OPEN");
  ws.send(JSON.stringify({ type: "attach", projectId: "agentlore", agentId: "claude" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "attached") {
    sessionId = msg.sessionId;
    console.log(`[${elapsed()}s] ATTACHED: session=${msg.sessionId}`);
    // Wait for shell prompt, then start claude
    setTimeout(() => {
      console.log(`[${elapsed()}s] >>> Starting claude`);
      ws.send(JSON.stringify({ type: "input", data: "claude\r" }));
    }, 1500);
    // Wait for claude to start, then type /resume
    setTimeout(() => {
      console.log(`[${elapsed()}s] >>> Typing /resume`);
      ws.send(JSON.stringify({ type: "input", data: "/resume\r" }));
    }, 5000);
  } else if (msg.type === "event") {
    eventCount++;
    const e = msg.event;
    const decision = e.decision ? ` [DECISION options=${e.decision.options.length}]` : "";
    const titleClean = (e.title || "").substring(0, 100).replace(/\n/g, "\\n");
    console.log(`[${elapsed()}s] EVENT #${eventCount}: type=${e.type} status=${e.status} title="${titleClean}"${decision}`);
  } else if (msg.type === "events_replay") {
    console.log(`[${elapsed()}s] EVENTS_REPLAY: count=${msg.events?.length || 0}`);
  } else if (msg.type === "token_refresh") {
    console.log(`[${elapsed()}s] TOKEN_REFRESH`);
  } else if (msg.type !== "output" && msg.type !== "scrollback") {
    console.log(`[${elapsed()}s] ${msg.type}`);
  }
});

ws.on("error", (e) => console.log("ERR:", e.message));
// Wait 25s for resume TUI to appear and be parsed
setTimeout(() => {
  console.log(`\n--- SUMMARY: ${eventCount} events total ---`);
  ws.close();
  process.exit(0);
}, 25000);
