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

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "attach", projectId: "agentlore", agentId: "claude" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "attached") {
    setTimeout(() => ws.send(JSON.stringify({ type: "input", data: "claude\r" })), 1000);
    setTimeout(() => ws.send(JSON.stringify({ type: "input", data: "/resume\r" })), 5000);
  } else if (msg.type === "event" && msg.event.type === "decision_request") {
    const opts = msg.event.decision?.options || [];
    console.log(`Resume Session — ${opts.length} options:\n`);
    for (let i = 0; i < opts.length; i++) {
      console.log(`  [${i+1}] ${opts[i].label.replace(/\n/g, " | ")}`);
    }

    // Check duplicates
    const labels = opts.map(o => o.label.replace(/\s+/g, " ").trim());
    const unique = [...new Set(labels)];
    console.log(`\nUnique: ${unique.length}/${labels.length}`);
    if (unique.length < labels.length) {
      console.log("❌ DUPLICATES FOUND!");
      process.exit(1);
    } else {
      console.log("✅ No duplicates");
      process.exit(0);
    }
  }
});

ws.on("error", (e) => console.log("ERR:", e.message));
setTimeout(() => { console.log("Timeout — no resume event"); ws.close(); process.exit(1); }, 20000);
