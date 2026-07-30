# Posts de lancement — API RapidAPI (à publier par Laurent)

Fiche : https://rapidapi.com/Ghost11777/api/residential-scraper-crypto-company-data
Règle d'or : **1 douleur résolue en titre**, pas « 85 endpoints ». Un post = un angle = un public.

---

## ANGLE 1 — Scraping résidentiel (r/webdev, r/webscraping, r/SaaS, X)

**Titre :** I built a web scraper API that runs on a *residential* IP — reaches the sites that block AWS/GCP scrapers

**Corps :**
> Datacenter scrapers (and most cheap APIs) get instantly blocked by Cloudflare/anti-bot on the sites that matter. Mine runs a real browser on a **residential IP**, so it gets through — Google Maps, marketplaces, JS-heavy SPAs, geo-restricted pages.
>
> `POST /v1/extract` → URL in, clean **markdown** out. Also render (full HTML), screenshot, PDF, links, meta.
>
> Pay-per-call, **free tier to try**, one key. Firecrawl/ScrapingBee quality at a fraction of the price.
>
> 👉 https://rapidapi.com/Ghost11777/api/residential-scraper-crypto-company-data
>
> Feedback welcome — what site is blocking you right now? I'll test it live.

---

## ANGLE 2 — Honeypot / rug check (r/cryptodevs, r/ethdev, crypto Discords, X crypto)

**Titre :** Free API endpoint: know if a token is a honeypot/rug BEFORE your bot buys it

**Corps :**
> If your trading agent apes a token, one `is_honeypot` or a 99% sell-tax wipes you. I wrapped a pre-trade safety check into one call:
>
> `GET /v1/crypto/security?address=0x…&chain=ethereum`
> → `{ "verdict": "AVOID", "isHoneypot": true, "sellTaxPct": 99, "flags": [...] }`
>
> Verdict OK / CAUTION / HIGH_RISK / AVOID across 8 chains. Plus token price/liquidity, DeFi yields, gas, trending & new pools.
>
> Pay-per-call, free tier. Built for autonomous agents — one key, no wallet needed.
> 👉 https://rapidapi.com/Ghost11777/api/residential-scraper-crypto-company-data

---

## ANGLE 3 — Data agents / x402 (X #x402 #AIagents, agent-builder Discords, Farcaster)

**Titre :** One API for AI agents: residential scraping + token security + global company data — pay-per-call, MCP-ready

**Corps :**
> Building an agent that needs to *read the untrusted web* or *check a token before trading*? I put it in one API:
> • Residential-IP scraping (bypasses datacenter blocks)
> • Token honeypot/rug check (8 chains)
> • Global company data (US SEC, UK Companies House, FR KYB)
>
> Works over **MCP** (Rapid has a playground) and pay-per-call x402 (USDC on Base) if your agent has a wallet — or fiat via RapidAPI if it doesn't.
> 👉 https://rapidapi.com/Ghost11777/api/residential-scraper-crypto-company-data

---

## ANGLE 4 — Show HN / IndieHackers (build-in-public)

**Titre :** Show HN: A pay-per-call data API — residential scraping, crypto safety checks, company data (85 endpoints, one key)

**Corps :**
> I got tired of juggling 6 API keys + rotating proxies just to enrich data. So I bundled it: residential-IP web scraping (reaches anti-bot sites), crypto/DeFi data + honeypot checks, and global company data (US/UK/FR) — 85 endpoints, GET+POST on every route, free tier to try.
> Payable pay-per-call (crypto, x402) or subscription (fiat, RapidAPI). Would love feedback on the DX.
> 👉 https://rapidapi.com/Ghost11777/api/residential-scraper-crypto-company-data

---

## Conseils de publication
- **Ne spam pas** : 1 post par communauté, pertinent, avec une vraie question à la fin (« what site is blocking you? ») pour amorcer l'engagement.
- **Réponds vite** aux commentaires (teste leur cas en live = preuve + premier abonné).
- Ordre conseillé : commence par **crypto** (douleur la plus vive + audience la plus prête à payer), puis scraping, puis HN/IH.
- Mets une **capture** du résultat honeypot/scraping dans le post — le visuel convertit.
