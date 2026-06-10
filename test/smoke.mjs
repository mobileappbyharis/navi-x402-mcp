// Smoke test: spawns the MCP server over stdio, lists tools, and calls one
// tool without a payment key (expects the structured wallet-setup error).
// No network payment happens — safe to run anytime. Requires internet (catalog).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../index.mjs", import.meta.url));
const child = spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, X402_PRIVATE_KEY: "" },
});

let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => { pending.delete(id); reject(new Error(`timeout on ${method}`)); }, 30000);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function assert(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); process.exit(1); }
  console.log(`ok: ${label}`);
}

const init = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
assert(init.result?.serverInfo?.name === "navi-x402", "initialize returns server navi-x402");
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const tools = await rpc("tools/list", {});
const list = tools.result?.tools || [];
assert(list.length >= 10, `tools/list returns >= 10 tools (got ${list.length})`);
assert(list.some(t => t.name === "navi_x402_scout"), "navi_x402_scout tool present");
assert(list.every(t => t.inputSchema?.type === "object"), "every tool has an object inputSchema");
assert(list.every(t => /USDC per call/.test(t.description)), "every description discloses the price");

const call = await rpc("tools/call", { name: "navi_timestamp", arguments: { timezone: "UTC" } });
const text = call.result?.content?.[0]?.text || "";
assert(call.result?.isError === true, "call without wallet is flagged isError");
assert(text.includes("payment_wallet_not_configured"), "call without wallet returns structured setup error");

console.log("\nSmoke test passed.");
child.kill();
process.exit(0);
