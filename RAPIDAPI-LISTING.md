# Kit de publication RapidAPI — x402-farm (canal fiat)

But : monétiser en **fiat** le trafic qui rebondit aujourd'hui sur le paywall crypto (les devs/agents sans wallet USDC). RapidAPI gère facturation + abonnements ; **tu touches 70%**. Le backend est déjà prêt (`RAPIDAPI_PROXY_SECRET` posé sur Vercel → une requête proxifiée par RapidAPI fait sauter le paywall x402 et sert la donnée).

## Spec technique (prête)
- OpenAPI 3.1.0 : `https://api.x-402.online/openapi.json` (85 endpoints, tous avec summary/description, serveur pointé).
- Base URL cible : `https://api.x-402.online`
- Header injecté par RapidAPI vers notre backend : `x-rapidapi-proxy-secret: <RAPIDAPI_PROXY_SECRET>` (déjà validé côté serveur, `src/app.js:235`).

---

## Fiche marketing (à copier)

**Nom (title) :**
> Residential Web Scraper + Crypto & Company Data

**Tagline (short description) :**
> Scrape sites that block datacenters (residential IP + real browser), check token honeypots/rugs before trading, and pull global company, DeFi & market data — 85 endpoints, one key, no per-source setup.

**Catégorie :** Data (secondaire : Business / Finance)

**Tags :** web scraping, residential proxy, crypto, defi, token security, honeypot, kyb, company data, sec edgar, companies house, market data, screenshot, pdf, extraction

**Long description :**
> One API for the data agents and apps actually need — and can't easily get elsewhere:
>
> • **Residential-IP web scraping** — extract clean markdown, render JS, screenshot or PDF any URL through a *real browser on a residential IP*. Reaches pages that block AWS/GCP/datacenter scrapers (Firecrawl/ScrapingBee territory) at a fraction of the price.
> • **Crypto & DeFi** — live token price/liquidity/volume across 8 chains, **honeypot / rug-pull security checks before you trade**, best DeFi yields, gas, trending & new pools, market sentiment.
> • **Global company data** — French KYB & SIREN/SIRET, insolvency (BODACC), solidity score, real-estate valuations (DVF); UK Companies House; US SEC EDGAR filings & financials.
> • **Utilities** — worldwide weather, geocoding, DNS, IBAN/VAT validation, and more.
>
> No account juggling, no per-source API keys, no rotating proxies. One subscription, 85 endpoints, GET+POST on every route. Full OpenAPI included.

## Tiers de prix (freemium — à saisir dans RapidAPI)

| Tier | Prix/mois | Quota inclus | Overage | Rate limit |
|---|---|---|---|---|
| **Basic** (gratuit, l'hameçon) | $0 | 100 req/mois | — (hard limit) | 5 req/s |
| **Pro** | $9.99 | 5 000 req/mois | $0.004/req | 15 req/s |
| **Ultra** | $49 | 50 000 req/mois | $0.002/req | 30 req/s |
| **Mega** | $199 | 500 000 req/mois | $0.0015/req | 60 req/s |

> Logique : Basic gratuit pour hameçonner (les devs testent la vraie donnée), puis conversion. Prix aligné sur le fait qu'un scrape résidentiel / un honeypot-check vaut bien plus que $0.004 pour un dev.

---

## Étapes de publication (une fois le compte créé)

1. **Créer un compte RapidAPI** (studio.rapidapi.com) → devenir **Provider** *(ton geste — création de compte)*.
2. **Add New API** → **Import from OpenAPI** → coller l'URL `https://api.x-402.online/openapi.json`.
3. **Base URL / routing** : cible `https://api.x-402.online`, et configurer l'injection du header `x-rapidapi-proxy-secret` = la valeur de `RAPIDAPI_PROXY_SECRET` (Vercel). *(C'est ce secret qui authentifie RapidAPI auprès de notre backend et fait sauter le paywall crypto.)*
4. **Plans & pricing** : saisir les 4 tiers ci-dessus.
5. **Fiche** : coller nom / tagline / description / tags / catégorie.
6. **Publier** → l'API apparaît sur le marketplace, les devs s'abonnent et paient en fiat, RapidAPI reverse 70%.

## Ce que je fais / ce que tu fais
- **Moi** : tout ce qui est ci-dessus est prêt ; je pilote la config via Playwright (import OpenAPI, saisie des tiers, de la fiche) une fois que tu es loggué.
- **Toi** : créer le compte RapidAPI + valider la publication finale (bouton Publish).
