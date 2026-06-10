# navi-x402-mcp

MCP server that gives your AI agent **paid superpowers with zero API keys**: live
crypto prices, weather + air quality, translation, AI market reports, web page
intelligence, Google Sheets reading, URL previews — and `navi_x402_scout`, which
finds the best x402 service in the ecosystem for any task.

Every call is paid per-request in **USDC on Base** via the
[x402 protocol](https://docs.cdp.coinbase.com/x402/welcome) (prices: $0.001–$0.02).
No accounts, no API keys, no subscriptions: your agent's wallet pays only for
what it uses.

## Setup

1. Fund a wallet with a few USDC on **Base mainnet** (a dollar goes a long way).
2. Add to your MCP client config (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "navi-x402": {
      "command": "npx",
      "args": ["-y", "navi-x402-mcp"],
      "env": {
        "X402_PRIVATE_KEY": "0x<private key of the paying wallet>",
        "MAX_PRICE_USDC": "0.05"
      }
    }
  }
}
```

## Tools

Tools are generated dynamically from the live
[Navi catalog](https://navi-x402-dashboard.vercel.app/catalog/navi) — new
endpoints appear automatically. Current highlights:

| Tool | What it does | Price |
|---|---|---|
| `navi_x402_scout` | Top-3 x402 services for a task, ranked by real 30-day usage | $0.005 |
| `navi_crypto_prices` | Live prices, 7d/30d change, ATH context (CoinGecko) | $0.001 |
| `navi_market_report` | Structured AI crypto market analysis | $0.02 |
| `navi_weather` | Forecast + air quality for any location | $0.001 |
| `navi_translate` | Translation with BCP-47 normalization + formality | $0.005 |
| `navi_web_intelligence` | AI page analysis: summary, entities, sentiment | $0.005 |
| `navi_page_context` | Page structure, link taxonomy, repo metadata | $0.005 |
| `navi_google_sheets` | Read any shared Google Sheet as typed JSON | $0.003 |
| `navi_url_preview` | OpenGraph/Twitter card metadata | $0.001 |
| `navi_timestamp` | Timezone-aware time with DST/week signals | $0.001 |

## Safety

- `MAX_PRICE_USDC` (default `0.05`) hard-caps the per-call price the server
  will ever authorize.
- The private key never leaves your machine: it signs EIP-3009 transfer
  authorizations locally; settlement happens on-chain via the Coinbase
  facilitator.
- Without `X402_PRIVATE_KEY`, tools are listed and explain how to enable
  payments instead of failing silently.

## Env reference

| Var | Default | Purpose |
|---|---|---|
| `X402_PRIVATE_KEY` | — | Paying wallet (USDC on Base mainnet) |
| `MAX_PRICE_USDC` | `0.05` | Per-call price ceiling |
| `NAVI_CATALOG_URL` | Navi public catalog | Alternative catalog source |

MIT — built by [Navi](https://navi-x402-dashboard.vercel.app/catalog/navi).
