# x402-farm

Ferme de 10 APIs payables par des agents IA via le protocole [x402](https://github.com/coinbase/x402) — paiement USDC sur Base, à l'appel, sans compte client.

## Les 10 APIs

| Route | Prix | Description |
|---|---|---|
| `POST /v1/extract` | $0.005 | URL → contenu principal en markdown propre (navigateur réel, JS exécuté) |
| `POST /v1/render` | $0.005 | URL → HTML complet après JS |
| `POST /v1/screenshot` | $0.01 | URL → PNG (option `fullPage`) |
| `POST /v1/pdf` | $0.01 | URL → PDF A4 |
| `POST /v1/links` | $0.005 | URL → liens dédupliqués internes/externes + ancres |
| `POST /v1/meta` | $0.005 | URL → SEO meta, OpenGraph, canonical, JSON-LD |
| `GET /v1/fr/entreprise?q=` | $0.02 | Entreprises FR par nom ou SIREN/SIRET : dirigeants, NAF, siège, état |
| `GET /v1/fr/geocode?q=` | $0.005 | Géocodage France + DOM (BAN/Géoplateforme) |
| `GET /v1/dns?domain=` | $0.005 | DNS complet : A, AAAA, MX, TXT, NS, SPF |
| `GET /v1/email/validate?email=` | $0.005 | Validation email : syntaxe + MX (aucun envoi) |

Routes gratuites : `GET /` (catalogue machine-lisible), `GET /health`, `GET /stats` (compteurs pour le radar).

## Lancer

```bash
npm install && npx playwright install chromium
cp .env.example .env    # renseigner PAY_TO quand le wallet existe
npm start               # PAY_TO vide = mode gratuit (dev)
```

## Passage en production (dans l'ordre)

1. **Wallet** : compte Coinbase Developer Platform → adresse USDC → `PAY_TO` dans `.env`.
2. **Test E2E testnet** : `NETWORK=eip155:84532` (Base Sepolia), USDC de faucet, un agent client avec `@x402/fetch` paie et consomme.
3. **Mainnet** : `NETWORK=eip155:8453` + facilitateur Coinbase CDP (clés API CDP) → indexation Bazaar automatique (`discovery`), c'est le canal d'acquisition.
4. **VPS** : `docker build -t x402-farm . && docker run -d --restart=always -p 3402:3402 --env-file .env x402-farm` derrière nginx + domaine + TLS.
5. **Référencement** : vérifier la présence sur le Bazaar CDP et x402scan.

## Sécurité

- Anti-SSRF : IPs privées/link-local bloquées (`src/lib/guard.js`), http/https uniquement.
- Sémaphore navigateur (`BROWSER_CONCURRENCY`, défaut 4) + timeouts de navigation.
- Cache TTL en mémoire (marge ~100 % sur les hits répétés).

## Modèle économique

Prix par appel < coût pour l'agent de faire lui-même (tokens + temps + risque d'échec).
Le radar (dossier `radar/`, à venir) surveille la demande réelle du Bazaar pour décider quelles APIs ajouter/tuer.
