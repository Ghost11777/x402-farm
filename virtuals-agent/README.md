# French Data Butler — agent vendeur Virtuals ACP

Vend les données FR de la ferme x402 (KYB, immobilier DVF, extraction résidentielle…)
**à d'autres agents IA**, payé en **USDC** via l'escrow ACP (vendeur = **95 %**, protocole = 5 %).
Coût de fulfillment ≈ 0 (on appelle notre propre backend `api.x-402.online` avec une clé interne).

- SDK : `@virtuals-protocol/acp-node-v2` (v2, event-driven). Le v1 `acp-node` est **déprécié**.
- Paiement : **USDC** sur Base. Escrow on-chain : acheteur finance → on livre → USDC libéré.
- **Pas besoin de $VIRTUAL ni de capital pour VENDRE.** Tokeniser l'agent est optionnel
  (c'est ça, et seulement ça, qui demande du $VIRTUAL — seuil 42 000 sur la bonding curve).
- Gas : sur Base, quelques cents/tx, très probablement **sponsorisé** (smart wallet Privy+Alchemy,
  chaînes ERC20-sponsored). Garder une petite marge d'ETH Base par sécurité (non confirmé à 100 %).

---

## Ce que le CODE fait tout seul (headless) vs. ce que TOI seul peut faire

| Étape | Automatisé (code) | À faire par toi (UI web + wallet + signature) |
|---|---|---|
| Créer le profil agent + l'enregistrer au **Service Registry**, déclarer offerings/prix/SLA | — | **app.virtuals.io** (wallet connecté) |
| Générer le **signer** (walletId + signerPrivateKey) | — | **app.virtuals.io** onglet Signers |
| (Optionnel) **tokeniser** l'agent | — | UI web + wallet + $VIRTUAL |
| Faucet testnet (sandbox) | — | clics faucet |
| **Runtime** : écouter, fixer le prix, appeler backend, livrer, encaisser | **✅ 100 % headless** (ce repo) | — |

> Le geste bloquant = l'enregistrement web avec **connexion wallet + signature on-chain**.
> Je (Claude) ne connecte pas de wallet et ne signe rien à ta place. Suis les étapes ci-dessous.

---

## 1) Enregistrement — ✅ FAIT LE 2026-07-28 (via Playwright)

- **Agent créé** : French Data Butler — id `019fa92a-1edc-7f20-baeb-e7ab50567ace`
  https://app.virtuals.io/acp/agents/019fa92a-1edc-7f20-baeb-e7ab50567ace
  (non tokenisé — aucun $VIRTUAL dépensé ; aucune signature n'a été requise pour la création ni les offres)
- **6 offres LIVE** (onglet ACP > Jobs Offered), noms/champs alignés avec `offerings.js` :

   | Job Name (exact) | Prix USDC | SLA | Champ requis |
   |---|---|---|---|
   | frenchCompanyKyb | 0.60 | 5 min | q |
   | frenchRealEstateValuation | 0.40 | 5 min | insee |
   | frenchCompanyInsolvency | 0.30 | 5 min | siren |
   | frenchCompanyIdentity | 0.20 | 5 min | q |
   | webContentExtraction | 0.08 | 5 min | url |
   | frenchAddressGeocoding | 0.05 | 5 min | q |

- **EVM Wallet ID** (Privy) : `syy3yqbrwysha83lil11dtbp` → déjà dans `.env` (SELLER_WALLET_ID).

### Reste à faire par TOI (2 secrets — Claude ne les manipule pas)
1. **Adresse EVM complète** : header de l'agent, icône copier à côté de `EVM 0x4bc1…d550` → colle dans `.env` (SELLER_WALLET_ADDRESS).
2. **Clé signer** : Wallet > Signers > **+ Add Key** > **Generate Key Pair** > copie la clé privée révélée (P-256, ne s'affiche qu'une fois) → colle dans `.env` (SELLER_SIGNER_PRIVATE_KEY).

## 2) Câbler le fulfillment gratuit — ✅ FAIT

Le backend accepte une **var dédiée** `VIRTUALS_API_KEY` (canal « virtuals », ajoutée à `src/app.js`
sans toucher à `INTERNAL_API_KEYS`). La var est déjà posée sur Vercel + redeployée. La valeur de la
clé est dans le `.env` local (`X402_INTERNAL_KEY`), jamais commitée. Vérifié : appel avec la clé = 200
(gratuit), sans = 402.

(Alternative sans clé : laisse `X402_INTERNAL_KEY` vide → l'agent paie le backend en USDC via le wallet.)

## 3) Bac à sable (recommandé avant le mainnet)

- Sandbox = **Base Sepolia** (testnet, argent fictif). Fonds de test gratuits :
  - ETH : https://www.alchemy.com/faucets/base-sepolia
  - USDC : https://faucet.circle.com
- Il faut un **agent acheteur de test** qui envoie un job (l'agent vendeur n'apparaît qu'après ≥ 1 job).
- Lance : `SANDBOX=true npm start`
- **Graduation** hors sandbox : 10 transactions sandbox réussies.

## 4) Production (mainnet)

```bash
npm install
npm start
```

L'agent écoute les jobs, fixe le prix depuis le registre, appelle le backend, livre, encaisse en USDC.
Les revenus se suivent dans le **cockpit** (https://cockpit-revenus.vercel.app) via le canal analytics « virtuals ».

---

## Fichiers
- `seller.js` — boucle event-driven ACP v2 (setBudget → fulfill → submit).
- `offerings.js` — mapping offering → route backend x402 + prix conseillés.
- `fulfill.js` — appel backend (clé interne gratuite, ou paiement x402 fallback).
- `.env.example` — les 3 secrets de signer + config.

## Sécurité
- `.env` et toute clé privée ne doivent JAMAIS être commités (déjà couvert par le .gitignore parent).
- Wallet de l'agent conseillé **séparé** du wallet x402, pour cloisonner le risque.
