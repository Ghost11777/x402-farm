# Posts de lancement — à publier par Laurent

## 1. X / Twitter (EN — l'écosystème x402 est anglophone)

> I shipped a farm of 10 pay-per-call APIs for AI agents 🤖💸
>
> Web extraction, screenshots, French company data, DNS, email validation — all payable in USDC on @base via x402. No account, no API key. HTTP 402 → pay → done.
>
> Free previews + OpenAPI + MCP server included.
>
> https://x402-farm.vercel.app/llms.txt

*(Tag possibles : @CoinbaseDev, #x402, #AIagents)*

## 2. Discord développeurs Coinbase (canal showcase / x402)

> Hey! Just launched **x402-farm** — 10 pay-per-call APIs designed for agents:
> web extract (JS-rendered → markdown), screenshot, PDF, links, SEO meta, full DNS, email validation, French company registry lookup (SIREN/officers/status), French+overseas geocoding.
>
> - Catalog: https://x402-farm.vercel.app/ (JSON) · /llms.txt · /openapi.json
> - Prices $0.005–$0.02, exact scheme, Base mainnet, CDP facilitator
> - Free preview routes so agents can try before paying
> - MCP server included (10 tools) for Claude/Cursor users
>
> Feedback welcome — especially from anyone running agent fleets. What data would you pay for?

## 3. dev.to (EN, plus long — optionnel mais bon SEO)

Titre : **I built 10 APIs that AI agents pay for autonomously (x402 protocol)**

Plan suggéré :
1. Le concept : des robots comme clients (x402 = HTTP 402 + USDC, zéro compte)
2. Ce que j'ai construit (les 10 APIs + pourquoi ces niches, dont la data française sous-servie)
3. La stack : Express + @x402/express v2 + Playwright serverless sur Vercel + facilitateur Coinbase
4. Le circuit de paiement expliqué (402 → PAYMENT-REQUIRED header → sign → retry)
5. Les chiffres honnêtes du marché (~5 200 services sur le Bazaar, médiane $0.01/call)
6. Liens : catalogue, llms.txt, previews gratuits

## 4. Reddit r/LocalLLaMA ou r/ClaudeAI (angle MCP)

> Made an MCP server whose tools are paid per-call in USDC (x402) — no API keys, no subscriptions. 10 tools: web extraction, screenshots, DNS, French company data… Your agent pays $0.005/call from its own wallet. Free preview tools included if you just want to try.

---
**Conseil de timing** : poste X + Discord le même jour (l'un renforce l'autre), dev.to dans la semaine. Réponds aux commentaires dans les 2 premières heures — c'est ce qui fait monter le post.
