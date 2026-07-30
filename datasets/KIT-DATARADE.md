# Kit de mise en vente — datasets (Datarade Data Commerce Cloud)

## Étape unique à faire à la main (15 min)
Créer le compte fournisseur : https://datarade.ai/sell-data → profil société (DefiConsulting), puis créer les 2 produits ci-dessous (textes prêts à coller). Datarade amène les acheteurs ; la livraison peut être un lien CSV/API fourni à chaque client.

---

## Produit 1 — French Real Estate Listings (Weekly)

**Titre** : French Real Estate Listings & Asking Prices — Weekly (8 major cities)

**Description (EN, à coller)** :
Weekly refreshed dataset of French residential property listings (for-sale) across Paris, Lyon, Marseille, Bordeaux, Toulouse, Nantes, Nice and Montpellier. Each record: property type, rooms, surface (m²), asking price (€), price per m², postal code, listing URL, plus a median €/m² market summary per city. Sourced through residential-IP collection (high completeness). Delivered as CSV/JSON, weekly on Mondays. Custom cities/volumes on request. GDPR-safe: property data only, no personal data.

**Catégories** : Real Estate Data, Property Listings, France
**Prix suggéré** : 490 €/mois (8 villes hebdo) ; option « custom cities » 990 €/mois ; échantillon gratuit : `echantillon-immobilier-bordeaux.csv`
**Production** : schedule Apify `dataset-immobilier-fr-hebdo` (x9IyLfbzbvOJtmocq), lundis 09:00 UTC, 8 tâches `ds-immo-*`. Livraison client : export CSV des datasets de runs (automatisable par routine dès le 1er client).

## Produit 2 — French Company KYB Records (On-demand)

**Titre** : French Company KYB & Compliance Records — On-demand API/bulk

**Description (EN)** :
Complete KYB dossiers for any French company by name or SIREN: legal identity, NAF activity, incorporation, HQ, officers, intra-EU VAT (VIES-validated), insolvency proceedings (BODACC), financial filings (INPI) and a compliance verdict. Bulk CSV delivery or API access. Fresh at query time (no stale database). GDPR: public registry data.

**Catégories** : Company Data, KYB, Firmographic, France
**Prix suggéré** : 0,15 €/entreprise en bulk (min 500) ou 290 €/mois pour 5 000 requêtes API
**Production** : actor `french-company-data` (déjà en prod) — zéro travail supplémentaire.

---

## Après le 1er client
Demander à Claude Code : « automatise la livraison Datarade : routine qui exporte les datasets de la semaine en CSV, les dépose sur R2 avec lien signé et l'envoie au client » .
