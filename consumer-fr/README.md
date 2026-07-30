# consumer-fr — Agent de due-diligence B2B France

Un **vrai produit** qui *consomme* la ferme x402 (`api.x-402.online`) : donne-lui une entreprise
française (nom ou SIREN), il produit un **dossier de risque** (conformité KYB, insolvabilité, score,
événements légaux BODACC, TVA VIES) et un **verdict** 🟢/🟠/🔴.

Intérêt stratégique : c'est de la **demande réelle** pour la ferme (un besoin métier authentique —
prospection B2B, credit-risk, vetting fournisseur, KYC/KYB), **pas du wash volume**.

## Le cœur : dépense ADAPTATIVE
L'agent ne paie la profondeur que si un risque est détecté :
1. **Triage** ($0.03) — `kyb/partial` : résout le SIREN, verdict, drapeaux, procédures, TVA.
2. **Identité** ($0.02) — `entreprise` : dirigeants, NAF, siège, effectif.
3. **Approfondissement** (seulement si 🟠/🔴) — `procedures-collectives` + `bodacc` + `score-entreprise`.

→ Dossier **sain ≈ $0.05**, dossier **à risque ≈ $0.18**. Testé : Decathlon 🟢 $0.05 (2 appels) · Peugeot SA 🔴 $0.18 (5 appels).

## Usage
```bash
node cli.js "Decathlon"              # dossier markdown
node cli.js 552100554 --json         # JSON structuré
node cli.js x --batch prospects.txt  # lot (une entreprise/ligne) — prospection
```

## Deux modes (fichier `.env`)
- **DEV / gratuit** : `X402_INTERNAL_KEY=…` défini → paywall sauté, coût 0. Pour développer/tester.
- **DEMANDE RÉELLE** : **commenter** `X402_INTERNAL_KEY` → l'agent **paie chaque appel en USDC**
  via le wallet (`../.buyer.secret` ou `X402_WALLET_KEY`). C'est ça qui génère de la vraie demande
  on-chain sur la ferme (volume, indexation Bazaar, réputation).
  ⚠️ Mode payant = mouvement de fonds réel : à déclencher par Laurent.

## API HTTP (`api.js`)
```bash
npm run api            # http://localhost:8899
curl "http://localhost:8899/diligence?q=Decathlon&format=md"
curl -X POST http://localhost:8899/diligence -H "content-type: application/json" -d '{"company":"552100554"}'
```
Optionnel : `API_TOKEN=xxx` dans `.env` → exige `Authorization: Bearer xxx` (pour vendre l'accès).

## Intégration Twenty CRM (`crm-enrich.js`)
Pour chaque société du CRM : lance la due-diligence et **attache une Note-dossier** (verdict + faits + BODACC), liée à la fiche.
```bash
node crm-enrich.js --dry        # calcule, n'écrit RIEN dans le CRM
node crm-enrich.js --limit 100  # enrichit (crée les notes liées)
```
Env : `TWENTY_API_KEY`, `TWENTY_BASE_URL` (déjà dans `.env`). Testé E2E : notes créées + liées via la morph-relation `targetCompanyId`.

## Fichiers
- `farm.js` — client ferme (x402-pay ou clé interne) + suivi de coût.
- `diligence.js` — moteur de dépense adaptative.
- `report.js` — rendu markdown du dossier.
- `cli.js` — CLI (unitaire, `--batch`, `--json`).
- `api.js` — API HTTP.
- `crm-enrich.js` — enrichissement Twenty CRM (Notes).

## Passer en mode PAYANT (vraie demande on-chain)
Le wallet acheteur `../.buyer.secret` est financé (~12 USDC, x402 gasless). Pour un run payant ponctuel,
**vider la clé interne à la volée** (dotenv n'écrase pas une var déjà posée) :
```bash
X402_INTERNAL_KEY= node cli.js "Decathlon"          # paie ~$0.05 en USDC réel
X402_INTERNAL_KEY= node crm-enrich.js --limit 20    # enrichit + paie la ferme
```
⚠️ Mouvement de fonds réel — à déclencher par Laurent (Claude ne bascule pas d'USDC).
