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

let outputChunks = 0;
let outputBytes = 0;
let lastOutput = "";

ws.on("open", () => {
  console.log("WS OPEN");
  ws.send(JSON.stringify({ type: "attach", projectId: "agentlore", agentId: "claude" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "attached") {
    console.log(`[${elapsed()}s] ATTACHED: session=${msg.sessionId}`);
    // Send a simple echo to verify PTY works
    setTimeout(() => {
      console.log(`[${elapsed()}s] >>> Sending: echo HELLO_PTY`);
      ws.send(JSON.stringify({ type: "input", data: "echo HELLO_PTY\r" }));
    }, 1000);
    // Then try claude
    setTimeout(() => {
      console.log(`[${elapsed()}s] >>> Sending: claude --version`);
      ws.send(JSON.stringify({ type: "input", data: "claude --version\r" }));
    }, 3000);
  } else if (msg.type === "output") {
    outputChunks++;
    const data = msg.data || "";
    outputBytes += data.length;
    // Strip ANSI for display
    const clean = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\r/g, "");
    if (clean.trim()) {
      lastOutput = clean.trim().slice(0, 200);
      console.log(`[${elapsed()}s] OUTPUT (${data.length}b): ${lastOutput}`);
    }
  } else if (msg.type === "scrollback") {
    console.log(`[${elapsed()}s] SCROLLBACK: ${(msg.data || "").length}b`);
  } else if (msg.type === "event") {
    console.log(`[${elapsed()}s] EVENT: type=${msg.event.type} title="${(msg.event.title || "").slice(0, 60)}"`);
  } else if (msg.type !== "token_refresh") {
    console.log(`[${elapsed()}s] ${msg.type}`);
  }
});

ws.on("error", (e) => console.log("ERR:", e.message));

setTimeout(() => {
  console.log(`\n--- PTY TEST: ${outputChunks} chunks, ${outputBytes} bytes ---`);
  console.log(`Last output: ${lastOutput}`);
  ws.close();
  process.exit(0);
}, 8000);
