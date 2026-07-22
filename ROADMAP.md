# ROADMAP x402-farm

> Règle darwinienne : le **radar** (`/radar/run`, panneau 📡 du dashboard) décide.
> On investit dans ce qui montre des payeurs uniques, on tue ce qui n'en montre pas.
> Prix par appel toujours < coût DIY de l'agent en tokens.

## État (2026-07-22)

- 54 APIs · MCP `online.x-402/mcp` au registre officiel · dashboard PWA · tunnel stable
  `worker.x-402.online` · `/fr/bilans` INPI + routes navigateur sur le Mac mini · radar quotidien.
- Marché mesuré (radar 24 h) : 560 payeurs uniques, ~21 k$/j sur 38 services actifs.
  Catégories qui vendent : LLM (blockrun 118 payeurs), commerce (bitrefill 113),
  **data enrichment (stableenrich 65 — notre catégorie ✅)**.
- Nous : 1 payeur (bootstrap interne). Le goulot est la DEMANDE, pas l'offre.

## Phase 1 — Distribution & confiance (le vrai déblocage) 🎯

| # | Étape | Effort | Critère de succès |
|---|-------|--------|-------------------|
| 1.1 | Vérifier reprise annuaires (Glama, PulseMCP, mcp.so) — publiés ~22/07, cycle ~24-48 h | 10 min/j | fiche visible sur ≥2 annuaires |
| 1.2 | Bump registre : server.json 1.0.1 (« 54 tools », description à jour) | 15 min | version active au registre |
| 1.3 | Étudier stableenrich.dev (notre comparable direct à 65 payeurs/j) : offre, prix, distribution | 1 h | 3 enseignements actionnables |
| 1.4 | Diffusion humaine (Laurent) : dev.to, Discord Coinbase #x402, X | — | 1 post/canal |
| 1.5 | Sauvegarder `.wallet.secret`/`.buyer.secret` hors du Mac (Laurent) | 10 min | copie off-site chiffrée |

## Phase 2 — Offre à fort différentiel (dans l'ordre)

| # | Étape | Effort | Gate (avant de faire) |
|---|-------|--------|------------------------|
| 2.1 | ✅ ~~BODACC procédures collectives~~ (fait 22/07, $0.03) | — | — |
| 2.2 | `/fr/transactions-immo` (DVF : ventes réelles par adresse) — muscle le tier immo | ½ j | — (données déjà utilisées par estimation-immo) |
| 2.3 | MCP thématiques au registre : `online.x-402/france-company-intel` (8 outils due-diligence) puis `france-immo` | ½ j | 1.1 fait (voir si le générique se propage d'abord) |
| 2.4 | Kbis Infogreffe sur le mini (sessions loggées + captcha) | 2-3 j | radar/ventes montrent de la demande data FR OU 1er payeur externe |
| 2.5 | Surveillance SIREN (« watch » par appel : diff depuis dernier appel) | 1 j | demande exprimée |

## Phase 3 — Boucle d'exploitation (hebdo, pilotée par le radar)

1. **Lundi** : lire le radar (tendances payeurs uniques par catégorie sur 7 j).
2. Ajouter 1-2 APIs max dans les catégories qui montent ; geler celles à 0 payeur 30 j.
3. Vérifier LEDs + `Top payeurs` : wallet inconnu = 1ʳᵉ vente → analyser ce qu'il achète, renforcer.
4. Mettre à jour ce fichier (cocher, re-prioriser).

## Corrections techniques en attente (non bloquantes)

- [ ] Radar : panneau « movers » (Δ payeurs 7 j) quand ≥7 snapshots.
- [ ] Dashboard : conversion affichée biaisée par la vague d'indexation (11 k 402/j de crawlers) —
      distinguer « 402 servis à des payeurs potentiels » (visiteur ayant >1 route) du bruit.
- [ ] `api_daily.total_calls` inclut le trafic de crawl : ajouter une vue « trafic utile ».
- [ ] Piège connu Vercel : si une route disparaît en prod → `npx vercel --prod --force`.
- [ ] MD mini : les guides worker/*.md du repo ne doivent JAMAIS contenir de secret (repo public).

## Ce qu'on ne fait PAS (décidé)

- Recherche web générique (marché pris, hors moat), LinkedIn (ban), volume d'APIs à l'aveugle,
  wash trading (délistage Bazaar), musique/média hors moat.
