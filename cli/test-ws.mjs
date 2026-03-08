import WebSocket from "ws";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const tokensPath = join(homedir(), ".agentrune", "tokens.json");
const tokens = JSON.parse(readFileSync(tokensPath, "utf-8"));
const cloudToken = Object.entries(tokens.sessionTokens).find(([,v]) => v.deviceId === "cloud")?.[0];
if (!cloudToken) { console.log("No cloud token found"); process.exit(1); }

const ws = new WebSocket(`ws://localhost:3456?token=${cloudToken}`);
const startTime = Date.now();

ws.on("open", () => {
  console.log("WS OPEN");
  ws.send(JSON.stringify({ type: "attach", projectId: "agentlore", agentId: "claude" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if (msg.type === "event") {
    const e = msg.event;
    const decision = e.decision ? ` [DECISION options=${e.decision.options.length}]` : "";
    console.log(`[${elapsed}s] EVENT: type=${e.type} status=${e.status} title="${(e.title || "").substring(0, 80)}"${decision}`);
  } else if (msg.type === "attached") {
    console.log(`[${elapsed}s] ATTACHED: session=${msg.sessionId} resumed=${msg.resumed}`);
  } else if (msg.type === "token_refresh") {
    console.log(`[${elapsed}s] TOKEN_REFRESH`);
  } else if (msg.type === "events_replay") {
    console.log(`[${elapsed}s] EVENTS_REPLAY: count=${msg.events?.length || 0}`);
  } else if (msg.type !== "output" && msg.type !== "scrollback") {
    console.log(`[${elapsed}s] ${msg.type}`);
  }
});

ws.on("error", (e) => console.log("ERR:", e.message));
setTimeout(() => { console.log("--- 25s timeout, closing ---"); ws.close(); process.exit(0); }, 25000);
