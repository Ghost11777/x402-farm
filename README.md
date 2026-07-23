# x402-farm

**64 pay-per-call APIs that AI agents pay for autonomously** — via the [x402 protocol](https://github.com/coinbase/x402) (USDC on Base). No account, no API key, no subscription: the agent gets an HTTP `402`, signs a micro-payment, retries, gets the data. Settlement is on-chain, per call, from $0.002.

**Live at [api.x-402.online](https://api.x-402.online)** · MCP: `online.x-402/mcp` on the [official registry](https://registry.modelcontextprotocol.io/v0/servers?search=x-402) and [Smithery](https://smithery.ai/servers/laurenthalbrun/x402-farm)

## Try it in 60 seconds

**Free taste, no wallet** — every client gets **1 free call per day** on any data route ≤ $0.01. Just call:

```bash
curl "https://api.x-402.online/v1/weather?city=Tokyo"
curl "https://api.x-402.online/v1/crypto/price?ids=bitcoin,ethereum&vs=usd"
```

**Paid, with any x402 client** (funded USDC wallet on Base):

```js
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const f = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(privateKeyToAccount(PRIVATE_KEY)) }],
});
const r = await f("https://api.x-402.online/v1/search?q=x402"); // $0.003, settled on-chain
console.log(await r.json());
```

## What's inside

| Category | Routes | From |
|---|---|---|
| 🤖 **LLM inference** | prompt in, completion out (DeepSeek v4) — among the cheapest $/call on x402 | $0.002 |
| 🔎 **Web + news search** | real Google results (organic + answer box + knowledge graph) & fresh news | $0.003 |
| 🕸️ **Residential-IP scraping** | extract, render (JS), screenshot, PDF, links, meta — through a **French residential IP**, reaches sites that block datacenters | $0.005 |
| 🌍 **Utilities** | weather (worldwide), crypto prices, DNS, email validation, IBAN | $0.003 |
| 🇫🇷 **French business data** (deepest x402 coverage) | company identity (SIREN/SIRET), **annual accounts (INPI)**, **insolvency (BODACC)**, KYB + VIES VAT, credit-style score, director networks, competitors | $0.003–0.12 |
| 🏠 **French real estate** | DVF sale-price valuations, DPE energy, risks, investment scorecard | $0.02–0.08 |
| 🇬🇧🇺🇸 **UK / US** | Companies House, SEC EDGAR filings & financials | $0.005–0.08 |
| 🧩 **Composites** | entreprise-360, KYB dossier, location studies — several sources in one call | $0.02–0.12 |

Full machine-readable docs: [`/llms.txt`](https://api.x-402.online/llms.txt) · [`/openapi.json`](https://api.x-402.online/openapi.json) · [`/.well-known/x402`](https://api.x-402.online/.well-known/x402)

## Agent-friendly by design

- **Every route accepts GET and POST** (query params or JSON body — your call)
- **Progressive pricing**: big composites have a `/partial` LITE version from $0.02; every `402` response advertises the cheaper alternative and free trial in an `alternatives` field
- **MCP server** at [`/mcp`](https://api.x-402.online/mcp) (JSON-RPC, Streamable HTTP): 64 tools, x402 payment relayed end-to-end — proven on-chain
- **Multi-surface discovery**: Bazaar extensions, `llms.txt`, OpenAPI, agent-skills, `Link` headers

## Architecture

Vercel (paywall x402 + fast APIs) → Cloudflare named tunnel → **Mac mini worker** (residential IP, real Chromium, auth-gated sources like INPI) with automatic datacenter fallback. Analytics + a daily on-chain **market radar** (unique payers per service across the whole x402 ecosystem) drive which APIs live or die.

## Stack

Express · `@x402/express` (multi-network resource server) · Coinbase CDP facilitator · Supabase (analytics) · Playwright · deployed on Vercel + a Mac mini.

---

*Built by [Laurent Halbrun](https://github.com/Ghost11777). USDC revenue wallet: [`0x2c87…735F`](https://basescan.org/address/0x2c871C2b8876dc35e9E19646FDa5ABF1cd27735F) — every sale is verifiable on-chain.*
