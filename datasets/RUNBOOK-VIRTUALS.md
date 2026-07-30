# Runbook — Agent vendeur sur Virtuals (économie agent-à-agent)

## État (2026-07-28) — CODE AGENT LIVRÉ ✅, reste enregistrement web (Laurent)
Agent complet monté et validé dans **`~/x402-farm/virtuals-agent/`** (voir son README.md).

### Réponse à « pourquoi il me faut du capital ? »
**Pour VENDRE des services, il n'en faut PAS.** Vérifié sur sources primaires (whitepaper + SDK) :
- Les agents **non-tokenisés transigent normalement** sur ACP. Paiements en **USDC**, vendeur touche **95 %**.
- Le seul besoin de « capital »/$VIRTUAL = **tokeniser** l'agent (lancer un token, seuil 42 000 $VIRTUAL
  sur la bonding curve) — **optionnel**, pas requis pour vendre.
- Gas Base : quelques cents/tx, très probablement **sponsorisé** (smart wallet Privy+Alchemy). Garder une
  petite marge d'ETH Base par sécurité (non confirmé à 100 %).
- Wallet ferme `0x2c87…735F` : **3,02 USDC, 0 ETH**. Les 3 USDC suffisent au mode fulfillment payant
  (x402 gasless) mais ne servent PAS à Virtuals. Le mode recommandé (clé interne) coûte 0.

## SDK & architecture (vérifié)
- **`@virtuals-protocol/acp-node-v2` v0.1.10** (le v1 `acp-node` est DÉPRÉCIÉ). Event-driven : `AcpAgent` + `JobSession`.
- Wallet modèle **Privy server wallet** : 3 secrets `SELLER_WALLET_ADDRESS` / `SELLER_WALLET_ID` / `SELLER_SIGNER_PRIVATE_KEY`.
- Escrow : acheteur finance → vendeur `setBudget` (prix) → `submit` (livraison) → USDC libéré. Refund si SLA raté.
- Sandbox = **Base Sepolia** (84532), fonds testnet gratuits (faucets Alchemy/Circle). Graduation = 10 tx sandbox OK.

## Ce qui est LIVRÉ (code, headless)
`virtuals-agent/` : `seller.js` (boucle ACP v2), `offerings.js` (6 offres → routes backend x402),
`fulfill.js` (clé interne gratuite OU paiement x402 fallback), `.env.example`, `README.md`.
- Dépendances installées, imports SDK vérifiés contre les packages réels, syntaxe OK.
- Fulfillment testé E2E : offering → route x402 → backend renvoie la vraie donnée (HTTP 200).
- 6 offres : KYB Dossier $0.60 · Insolvency $0.30 · Real Estate Valuation $0.40 · Company Identity $0.20 ·
  Web Extraction $0.08 · Geocoding $0.05.
- Clé interne dédiée générée : **`532f7fe7ce1428a2d7dcc583929268fb1e0b93d7`** (canal `virtuals`), dans le `.env.example`
  (gitignored). À append à `INTERNAL_API_KEYS` du backend Vercel pour un fulfillment gratuit.

## Ce qui RESTE (toi — UI web + wallet, je ne signe rien à ta place)
1. **app.virtuals.io/acp/join** : connecter le wallet, créer l'agent « French Data Butler », déclarer les 6 offerings
   (mêmes noms/prix que le tableau du README), générer le Signer.
2. Remplir `virtuals-agent/.env` avec les 3 secrets du signer.
3. Append la clé interne à `INTERNAL_API_KEYS` (Vercel x402-farm) + redeploy.
4. Sandbox d'abord : `SANDBOX=true npm start` + un agent acheteur de test (faucets Base Sepolia).
5. Mainnet : `npm start`. Revenus suivis dans le cockpit (canal analytics « virtuals »).

## Incertitudes signalées (non confirmées source primaire)
- Gas vendeur 100 % sponsorisé ? (probable via ERC20_SPONSORED_CHAINS, non écrit noir sur blanc).
- Sandbox pur Base Sepolia vs micro-USDC mainnet selon versions de doc.
- Crédits de test fournis par Virtuals : non confirmés → prévoir faucets publics.
