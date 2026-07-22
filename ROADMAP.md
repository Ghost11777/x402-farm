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
| 1.1 | Annuaires : ✅ Smithery publié+listé · ✅ mcp.so soumis (file de revue) · PulseMCP auto (ingère le registre, ≤1 sem) · Glama auto | 10 min/j | fiche visible sur ≥2 annuaires |
| 1.1b | 402 « conversationnel » ✅ : alternatives (LITE + free trial) dans l'enveloppe 402 (fait 22/07) | — | mesurer : appels /partial et /free en hausse |
| 1.1c | PR awesome-mcp-servers (section Finance) — token GitHub actuel trop restreint → Laurent (bouton Edit sur GitHub = fork auto) | 10 min | PR mergée |
| 1.2 | Bump registre : server.json 1.0.1 (« 54 tools », description à jour) | 15 min | version active au registre |
| 1.3 | ✅ ~~Étude stableenrich.dev~~ (fait 22/07 — voir « Enseignements stableenrich » ci-dessous) | — | — |
| 1.4 | Diffusion humaine (Laurent) : dev.to, Discord Coinbase #x402, X | — | 1 post/canal |
| 1.5 | Sauvegarder `.wallet.secret`/`.buyer.secret` hors du Mac (Laurent) | 10 min | copie off-site chiffrée |

## Enseignements stableenrich (étude 2026-07-22)

Modèle : **revendeur** — 39 routes qui enveloppent 13 APIs tierces connues (Google Maps ×11,
Serper, Exa, Hunter, FullEnrich/PDL/Clado…) derrière x402. L'agent paie sans compte, eux paient
l'amont avec leurs clés API, marge au milieu. Multichaîne Base + **Solana** + Tempo. PAS de MCP.
48 h mesurées (Base seulement) : 93 payeurs, **50 récurrents (>5 appels) = rétention réelle**,
~$76/j. Le volume d'appels vient du search à $0.01 (produit d'appel), le REVENU des
enrichissements à $0.14–0.28.

**À répliquer chez nous (ajouté en Phase 2)** :
- **Prix progressifs partial/full** : même route en version $0.02 (champs clés) et $0.08 (complète).
  Abaisse la barrière du 1er paiement, upsell naturel.
- **llms.txt pédagogique** : le leur enseigne des WORKFLOWS aux agents (« Agent Workflow
  (Progressive) », « Research Methodology (Fan-out) ») — pas une simple liste de routes.
- La demande prouvée = **utilitaires de marques connues sans compte**. Notre pari « données FR
  souveraines » est différenciant mais plus lent ; option hybride : 2-3 utilitaires revendus
  comme produits d'appel qui cross-sellent la data FR (gate : marge amont à calculer).

## Phase 2 — Offre à fort différentiel (dans l'ordre)

| # | Étape | Effort | Gate (avant de faire) |
|---|-------|--------|------------------------|
| 2.1 | ✅ ~~BODACC procédures collectives~~ (fait 22/07, $0.03) | — | — |
| 2.2 | `/fr/transactions-immo` (DVF : ventes réelles par adresse) — muscle le tier immo | ½ j | — (données déjà utilisées par estimation-immo) |
| 2.3 | MCP thématiques au registre : `online.x-402/france-company-intel` (8 outils due-diligence) puis `france-immo` | ½ j | 1.1 fait (voir si le générique se propage d'abord) |
| 2.4 | Kbis Infogreffe sur le mini (sessions loggées + captcha) | 2-3 j | radar/ventes montrent de la demande data FR OU 1er payeur externe |
| 2.5 | Surveillance SIREN (« watch » par appel : diff depuis dernier appel) | 1 j | demande exprimée |
| 2.6 | ✅ ~~Prix progressifs partial/full~~ (fait 22/07 : 4 routes LITE $0.02-0.03, `src/lib/partial.js`) | — | — |
| 2.7 | Réécrire llms.txt en manuel de workflows agent (due diligence FR en 4 appels, fan-out) | 2 h | — (enseignement stableenrich) |
| 2.8 | Étudier support Solana (payeurs invisibles pour nous aujourd'hui) | 1 j | volume Solana confirmé chez les leaders |

## Adéquation demande (analyse 402/404 du 2026-07-22)

Capteur : nos propres logs. Visiteurs sélectifs (vrais agents) sondent : dns, email-validate,
extract (58 hits/3 visiteurs), us/financials, fr/entreprise, uk/company → le catalogue est bon.
**Bug d'adéquation trouvé et corrigé : 24 visiteurs/72 h faisaient GET sur les routes POST
(extract/render/screenshot…) → 404 → partis.** Toutes les routes /v1 sont désormais bi-méthodes.
Ajouts catégorie prouvée : /v1/weather + /v1/crypto/price ($0.003, sans clé). Prêts si clés
fournies (Laurent) : /v1/search (SERPER_API_KEY, ~2 min à créer) + /v1/llm (OPENAI_API_KEY).

## Phase 3 — Boucle d'exploitation (hebdo, pilotée par le radar)

1. **Lundi** : lire le radar (tendances payeurs uniques par catégorie sur 7 j).
2. Ajouter 1-2 APIs max dans les catégories qui montent ; geler celles à 0 payeur 30 j.
3. Vérifier LEDs + `Top payeurs` : wallet inconnu = 1ʳᵉ vente → analyser ce qu'il achète, renforcer.
4. Mettre à jour ce fichier (cocher, re-prioriser).

## Corrections techniques en attente (non bloquantes)

- [ ] Radar : panneau « movers » (Δ payeurs 7 j) quand ≥7 snapshots.
- [ ] Radar : angle mort Solana — on ne mesure que les payTo EVM/Base (stableenrich et d'autres encaissent aussi sur Solana).
- [ ] Dashboard : conversion affichée biaisée par la vague d'indexation (11 k 402/j de crawlers) —
      distinguer « 402 servis à des payeurs potentiels » (visiteur ayant >1 route) du bruit.
- [ ] `api_daily.total_calls` inclut le trafic de crawl : ajouter une vue « trafic utile ».
- [ ] Piège connu Vercel : si une route disparaît en prod → `npx vercel --prod --force`.
- [ ] MD mini : les guides worker/*.md du repo ne doivent JAMAIS contenir de secret (repo public).

## Ce qu'on ne fait PAS (décidé)

- Recherche web générique (marché pris, hors moat), LinkedIn (ban), volume d'APIs à l'aveugle,
  wash trading (délistage Bazaar), musique/média hors moat.
