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

let events = [];

ws.on("open", () => {
  console.log("OPEN");
  ws.send(JSON.stringify({ type: "attach", projectId: "agentlore", agentId: "claude" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "attached") {
    console.log(`[${elapsed()}s] ATTACHED: ${msg.sessionId}`);
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "input", data: "echo PTY_WORKS\r" }));
    }, 500);
  } else if (msg.type === "output") {
    const clean = stripAnsi(msg.data || "").trim();
    if (clean && clean.length > 2) console.log(`[${elapsed()}s] OUT: ${clean.slice(0, 150).replace(/\n/g, "\\n")}`);
  } else if (msg.type === "event") {
    events.push(msg.event);
    console.log(`[${elapsed()}s] EVENT: ${msg.event.type} "${(msg.event.title || "").slice(0, 60)}"`);
  }
});

ws.on("error", (e) => console.log("ERR:", e.message));
setTimeout(() => {
  console.log(`\n--- ${events.length} events ---`);
  ws.close();
  process.exit(0);
}, 5000);
