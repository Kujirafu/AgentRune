import WebSocket from "ws";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const tokensPath = join(homedir(), ".agentrune", "tokens.json");
const tokens = JSON.parse(readFileSync(tokensPath, "utf-8"));
const cloudToken = Object.entries(tokens.sessionTokens).find(([,v]) => v.deviceId === "cloud")?.[0];

const startTime = Date.now();
function elapsed() { return ((Date.now() - startTime) / 1000).toFixed(1); }

let sessionId = null;
let allDecisions = [];

function connect(label) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:3456?token=${cloudToken}`);
    const decisions = [];

    ws.on("open", () => {
      console.log(`[${elapsed()}s] ${label}: OPEN`);
      ws.send(JSON.stringify({ type: "attach", projectId: "agentlore", agentId: "claude", sessionId }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "attached") {
        sessionId = msg.sessionId;
        console.log(`[${elapsed()}s] ${label}: ATTACHED ${msg.sessionId} resumed=${msg.resumed}`);
      } else if (msg.type === "event") {
        const e = msg.event;
        if (e.type === "decision_request") {
          decisions.push(e);
          allDecisions.push(e);
          console.log(`[${elapsed()}s] ${label}: DECISION EVENT "${(e.title || "").slice(0, 60)}" opts=${e.decision?.options?.length || 0}`);
        }
      } else if (msg.type === "events_replay") {
        const replayDecisions = (msg.events || []).filter(e => e.type === "decision_request" && e.status === "waiting");
        if (replayDecisions.length > 0) {
          console.log(`[${elapsed()}s] ${label}: REPLAY has ${replayDecisions.length} waiting decisions (BUG!)`);
          allDecisions.push(...replayDecisions);
        } else {
          console.log(`[${elapsed()}s] ${label}: REPLAY ${(msg.events || []).length} events (no stale decisions ✓)`);
        }
      }
    });

    ws.on("error", (e) => console.log(`${label} ERR:`, e.message));

    resolve({ ws, decisions });
  });
}

async function run() {
  // Phase 1: Connect, start claude, /resume
  const c1 = await connect("CONN-1");
  await new Promise(r => setTimeout(r, 500));
  c1.ws.send(JSON.stringify({ type: "input", data: "claude\r" }));
  console.log(`[${elapsed()}s] >>> Started claude`);
  await new Promise(r => setTimeout(r, 4000));
  c1.ws.send(JSON.stringify({ type: "input", data: "/resume\r" }));
  console.log(`[${elapsed()}s] >>> Typed /resume`);

  // Wait for decision event
  await new Promise(r => setTimeout(r, 8000));
  console.log(`[${elapsed()}s] CONN-1 decisions: ${c1.decisions.length}`);

  // Phase 2: Simulate app switch — disconnect and reconnect
  console.log(`\n[${elapsed()}s] === Simulating app switch (disconnect + reconnect) ===`);
  c1.ws.close();
  await new Promise(r => setTimeout(r, 2000));

  const c2 = await connect("CONN-2");
  await new Promise(r => setTimeout(r, 8000));

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Total decisions seen: ${allDecisions.length}`);
  if (allDecisions.length <= 1) {
    console.log("✅ No duplicate resume decisions on reconnect");
  } else {
    console.log(`❌ ${allDecisions.length} decisions — duplicates on reconnect!`);
  }

  c2.ws.close();
  process.exit(allDecisions.length <= 1 ? 0 : 1);
}

run();
