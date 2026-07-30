# Runbook — Cloudflare Pay Per Crawl (péage à crawlers IA)

## État (2026-07-28) — CANDIDATURE BETA SOUMISE ✅
- **Beta FERMÉE** (« closed beta ») — pas d'activation self-service. On rejoint via formulaire.
- **Candidature envoyée le 28/07** via https://www.cloudflare.com/paypercrawl-signup/
  - Prénom/Nom : Laurent Halbrun · Email : contact@kalinnfwi.com (→ redirigé Gmail)
  - Website : x-402.online · Current customer : Yes · Rôle : **Publisher** · Pays : France
  - Réponse form : « Thank You — Someone from Cloudflare will be in touch with you shortly. »
- Une seule zone sur le compte Cloudflare : `x-402.online` (endpoint d'API — **peu/pas de contenu crawlable**, donc peu de valeur péage).
- La config Pay Per Crawl n'est pas pilotable par API avec le jeton actuel → dashboard uniquement (onglet **AI Crawl Control** → action **Charge** par crawler, prix plancher 0,01 $, paiements via **Stripe**).

## BLOQUEUR STRUCTUREL restant (décision Laurent)
Le péage ne rapporte QUE s'il y a un **domaine de CONTENU** derrière Cloudflare avec des pages à valeur pour les IA. Aujourd'hui il n'y en a pas sur le compte CF. Options :
1. Migrer le DNS d'un site de contenu existant vers Cloudflare (proxy orange) — ex. un site de l'usine à sites, ou kalinnfwi.com.
2. Créer un domaine « médias » alimenté par les routines (veille réglementaire, marchés, immobilier) = pages structurées, datées, machine-désirables.

## Étapes restantes (Laurent)
1. Attendre le contact Cloudflare (arrive sur contact@kalinnfwi.com → Gmail) → accepter dans la beta.
2. **Onboarding Stripe** pour recevoir les paiements = saisie coordonnées bancaires **par Laurent** (je ne le fais pas à ta place).
3. Choisir/migrer le domaine de contenu (cf. bloqueur ci-dessus).
4. Dashboard CF → AI Crawl Control → action **Charge** sur les crawlers voulus + prix par récupération.

## Stratégie de contenu (automatisable ensuite)
Republier la veille (réglementaire, marchés, immobilier) de nos pipelines en pages structurées et datées = contenu machine-désirable généré par routines. À brancher une fois la beta accordée + le domaine de contenu choisi.
