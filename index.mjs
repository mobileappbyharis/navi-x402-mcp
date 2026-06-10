#!/usr/bin/env node
/**
 * navi-x402-mcp — MCP server exposing the Navi x402 endpoint catalog as tools.
 *
 * Tools are generated dynamically from the public catalog, so new Navi
 * endpoints appear automatically without updating this package.
 *
 * Payment: each call is paid per-request in USDC on Base via the x402
 * protocol, signed with the wallet in X402_PRIVATE_KEY. No API keys.
 *
 * Env:
 *   X402_PRIVATE_KEY   0x... private key of the paying wallet (USDC on Base).
 *                      Without it, tools are listed but calls explain how to set it up.
 *   MAX_PRICE_USDC     refuse calls costing more than this per request (default 0.05)
 *   NAVI_CATALOG_URL   override the catalog source (default: Navi public catalog)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const CATALOG_URL = process.env.NAVI_CATALOG_URL || "https://navi-x402-dashboard.vercel.app/api/catalog/navi";
const GATEWAY_URL = "https://bazaar-gateway.vercel.app";
const MAX_PRICE_USDC = Number.parseFloat(process.env.MAX_PRICE_USDC || "0.05");
const CATALOG_TTL_MS = 10 * 60 * 1000;

// ---- x402 payment-enabled fetch (lazy: only built when a key is present) ----
let fetchWithPay = null;
let payerAddress = null;

async function initPayments() {
  const key = process.env.X402_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return;
  const { createPublicClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { base } = await import("viem/chains");
  const { wrapFetchWithPayment, x402Client } = await import("@x402/fetch");
  const { ExactEvmScheme, toClientEvmSigner } = await import("@x402/evm");

  const account = privateKeyToAccount(key);
  payerAddress = account.address;
  const publicClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
  const client = new x402Client();
  client.register("eip155:8453", new ExactEvmScheme(toClientEvmSigner(account, publicClient)));
  fetchWithPay = wrapFetchWithPayment(fetch, client);
}

// ---- Dynamic tool catalog ----
let catalogCache = { tools: [], bySlug: new Map(), loadedAt: 0 };

function slugFromPath(path) {
  return String(path).replace(/^\/api\//, "");
}

function toToolName(slug) {
  return "navi_" + slug.replace(/-/g, "_");
}

async function loadCatalog(force = false) {
  if (!force && catalogCache.tools.length && Date.now() - catalogCache.loadedAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const res = await fetch(CATALOG_URL, { headers: { "User-Agent": "navi-x402-mcp/1.0" } });
  if (!res.ok) throw new Error(`catalog fetch failed: HTTP ${res.status}`);
  const catalog = await res.json();

  const tools = [];
  const bySlug = new Map();
  for (const ep of catalog.endpoints || []) {
    const slug = slugFromPath(ep.path);
    const price = Number.parseFloat(ep.price_usdc) || 0;
    const inputSchema = ep.input_schema && ep.input_schema.type === "object"
      ? ep.input_schema
      : { type: "object", properties: {} };
    const tool = {
      name: toToolName(slug),
      description: `${ep.description} (Paid via x402: $${price} USDC per call on Base, settled automatically.)`,
      inputSchema,
    };
    tools.push(tool);
    bySlug.set(tool.name, { slug, path: ep.path, method: ep.method || "GET", price });
  }
  catalogCache = { tools, bySlug, loadedAt: Date.now() };
  return catalogCache;
}

// ---- MCP server ----
const server = new Server(
  { name: "navi-x402", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const { tools } = await loadCatalog();
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const { bySlug } = await loadCatalog();
  const ep = bySlug.get(name);

  if (!ep) {
    return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }], isError: true };
  }

  if (!fetchWithPay) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "payment_wallet_not_configured",
          message: `This tool costs $${ep.price} USDC per call, paid automatically via the x402 protocol. Set the X402_PRIVATE_KEY environment variable to a wallet holding USDC on Base mainnet, then retry.`,
          docs: "https://navi-x402-dashboard.vercel.app/catalog/navi",
        }),
      }],
      isError: true,
    };
  }

  if (ep.price > MAX_PRICE_USDC) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "price_above_limit",
          message: `This call costs $${ep.price} USDC, above your MAX_PRICE_USDC limit of $${MAX_PRICE_USDC}. Raise the limit to allow it.`,
        }),
      }],
      isError: true,
    };
  }

  try {
    let url = `${GATEWAY_URL}${ep.path}`;
    const options = { method: ep.method, headers: {} };

    if (ep.method === "GET") {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined && v !== null) qs.set(k, String(v));
      }
      const q = qs.toString();
      if (q) url += `?${q}`;
    } else {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(args);
    }

    const res = await fetchWithPay(url, options);
    const text = await res.text();

    // Paid endpoints always answer JSON (success or structured error) — pass
    // it through verbatim so the agent gets every field.
    return {
      content: [{ type: "text", text }],
      isError: res.status >= 400,
    };
  } catch (err) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "call_failed",
          message: String(err?.message || err),
          hint: "Check that the X402_PRIVATE_KEY wallet holds USDC on Base mainnet.",
        }),
      }],
      isError: true,
    };
  }
});

await initPayments();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `[navi-x402-mcp] ready — payments ${fetchWithPay ? `enabled (payer ${payerAddress})` : "DISABLED (set X402_PRIVATE_KEY)"}, max $${MAX_PRICE_USDC}/call`
);
