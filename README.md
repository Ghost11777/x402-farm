# x402-farm

**10 pay-per-call APIs that AI agents pay for autonomously** — via the [x402 protocol](https://github.com/coinbase/x402) (USDC on Base). No account, no API key, no subscription: the agent gets an HTTP `402`, signs a micro-payment, retries. Live at **https://x402-farm.vercel.app**.

Also ships an **MCP server** so Claude / Cursor / any MCP client can use these as paid tools.

## The 10 APIs

| Route | Price | What it does |
|---|---|---|
| `POST /v1/extract` | $0.005 | URL → main content as clean markdown (JS-rendered, real browser) |
| `POST /v1/render` | $0.005 | URL → full HTML after JavaScript execution |
| `POST /v1/screenshot` | $0.01 | URL → PNG (optional `fullPage`) |
| `POST /v1/pdf` | $0.01 | URL → A4 PDF |
| `POST /v1/links` | $0.005 | URL → deduplicated links, internal/external + anchor text |
| `POST /v1/meta` | $0.005 | URL → SEO meta, OpenGraph, canonical, JSON-LD |
| `GET /v1/fr/entreprise?q=` | $0.02 | French company lookup by name or SIREN/SIRET: officers, NAF, HQ, status |
| `GET /v1/fr/geocode?q=` | $0.005 | Geocode any French address incl. overseas territories |
| `GET /v1/dns?domain=` | $0.005 | Full DNS records: A, AAAA, MX, TXT, NS, SPF |
| `GET /v1/email/validate?email=` | $0.005 | Email validation: syntax + MX (no email sent) |

**Free (no payment):** `GET /` (JSON catalog) · `/llms.txt` · `/openapi.json` · `POST /free/extract` · `GET /free/entreprise` (truncated previews).

## Pay from an agent

```js
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const pay = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(privateKeyToAccount(PK)) }],
});
const r = await pay("https://x402-farm.vercel.app/v1/dns?domain=example.com");
console.log(await r.json()); // paid $0.005 in USDC, got the data
```

## Use as an MCP server (Claude / Cursor)

```json
{
  "mcpServers": {
    "x402-farm": {
      "command": "npx",
      "args": ["-y", "github:Ghost11777/x402-farm"],
      "env": {
        "X402_PRIVATE_KEY": "0x…",
        "X402_FARM_URL": "https://x402-farm.vercel.app"
      }
    }
  }
}
```

Without `X402_PRIVATE_KEY`, only the free preview tool works. With a funded Base USDC wallet, every tool pays per call from that wallet.

## Run it yourself

```bash
npm install && npx playwright install chromium
cp .env.example .env      # set PAY_TO to your USDC address; leave empty for free dev mode
npm start
```

Deploy: `vercel deploy --prod` (serverless Chromium via `@sparticuz/chromium`) or `docker build -t x402-farm . && docker run -p 3402:3402 --env-file .env x402-farm`.

## Notes

- `NETWORK=eip155:8453` (Base mainnet) uses the Coinbase CDP facilitator; `eip155:84532` (Base Sepolia) uses the public `x402.org` facilitator for testing.
- Anti-SSRF guard blocks private/link-local addresses. In-memory TTL cache. Browser concurrency semaphore.
- Listed on [x402scan](https://www.x402scan.com).

MIT
