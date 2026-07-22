import { Router } from "express";
import { cached } from "../lib/cache.js";
import { registerPartial } from "../lib/partial.js";

// APIs COMPOSITES : la valeur n'est pas la donnée (publique) mais le TRAVAIL —
// agréger plusieurs sources en un appel, ou calculer un modèle. Ce qu'un agent
// ne refera pas seul (5 appels + logique, ou un modèle d'estimation).
const router = Router();

const UA = { "user-agent": "x402-farm/0.1", accept: "application/json" };
const q = (req, name) => (req.query[name] || "").toString().trim();

async function getJson(url, timeout = 10_000, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw Object.assign(new Error(`upstream_${r.status}`), { status: 502 });
  return r.json();
}
const settle = (p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e: String(e) }));

// ===== 1. ENTREPRISE 360 : tout sur une entreprise FR en un seul appel =====
// Agrège : identité + siège + dirigeants + finances (recherche-entreprises)
//        + annonces légales (BODACC) + certification RGE — en parallèle.
registerPartial(router, "/v1/fr/entreprise-360", (d) => ({
  identite: d.identite, siege: d.siege ? { ville: d.siege.ville, cp: d.siege.cp } : null,
  etablissements: d.etablissements, annonces_legales_total: d.annonces_legales?.total,
}));

router.get("/v1/fr/entreprise-360", async (req, res) => {
  const input = q(req, "q") || q(req, "siren");
  if (!input) return res.status(400).json({ error: "missing_q_or_siren" });
  try {
    const data = await cached(`e360:${input}`, 6 * 3600_000, async () => {
      // 1) Résolution de l'entreprise
      const search = await getJson(
        `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(input)}&per_page=1`
      );
      const e = search.results?.[0];
      if (!e) return { found: false, query: input };
      const siren = e.siren;
      const siege = e.siege || {};

      // 2) Enrichissements en parallèle (chacun peut échouer sans casser le tout)
      const [bodacc, rge] = await Promise.all([
        settle(getJson(
          `https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=${encodeURIComponent(`registre like "${siren}"`)}&limit=5&order_by=${encodeURIComponent("dateparution desc")}`,
          12_000)),
        settle(getJson(
          `https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-2/lines?size=10&qs=${encodeURIComponent(`siret:${siege.siret || siren + "*"}`)}`,
          12_000)),
      ]);

      // 3) TVA intracommunautaire (calcul offline)
      const key = (12 + 3 * (Number(siren) % 97)) % 97;
      const tva = `FR${String(key).padStart(2, "0")}${siren}`;

      const bodaccRows = bodacc.ok ? bodacc.v.results || [] : [];
      const rgeRows = rge.ok ? rge.v.results || [] : [];

      return {
        found: true,
        identite: {
          siren, nom: e.nom_complet, sigle: e.sigle, tva,
          naf: e.activite_principale, forme_juridique: e.nature_juridique,
          date_creation: e.date_creation, etat: e.etat_administratif,
          categorie: e.categorie_entreprise, effectif: e.tranche_effectif_salarie,
          economie_sociale: e.complements?.est_ess || false,
        },
        siege: {
          siret: siege.siret, adresse: siege.adresse, cp: siege.code_postal,
          ville: siege.libelle_commune, lat: siege.latitude, lon: siege.longitude,
        },
        etablissements: { total: e.nombre_etablissements, ouverts: e.nombre_etablissements_ouverts },
        dirigeants: (e.dirigeants || []).map((d) => ({
          nom: d.nom, prenoms: d.prenoms, qualite: d.qualite, denomination: d.denomination,
        })),
        finances: e.finances || null,
        annonces_legales: {
          total: bodacc.ok ? bodacc.v.total_count : null,
          recentes: bodaccRows.map((a) => ({ date: a.dateparution, type: a.typeavis_lib, famille: a.familleavis_lib })),
        },
        rge: { certifie: rgeRows.length > 0, qualifications: rgeRows.map((r) => r.nom_qualification) },
        sources: ["recherche-entreprises.api.gouv.fr", "bodacc", "ademe-rge"],
      };
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || "aggregation_failed" });
  }
});

// ===== 2. ESTIMATION IMMOBILIÈRE : AVM sur comparables DVF réels =====
// Prend une adresse -> géocode -> trouve la commune -> récupère les ventes DVF
// récentes -> calcule un prix au m² (médiane) et une estimation pour une surface.
router.get("/v1/fr/estimation-immo", async (req, res) => {
  const adresse = q(req, "adresse");
  const surface = Number(q(req, "surface")) || null;
  const typeBien = (q(req, "type") || "appartement").toLowerCase(); // appartement | maison
  if (!adresse) return res.status(400).json({ error: "missing_adresse" });
  try {
    const data = await cached(`avm:${adresse}:${typeBien}`, 24 * 3600_000, async () => {
      // 1) Géocodage -> code INSEE
      const geo = await getJson(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(adresse)}&limit=1`);
      const f = geo.features?.[0];
      if (!f) return { found: false, adresse };
      const insee = f.properties.citycode;
      const ville = f.properties.city;

      // 2) DVF : ventes récentes. On filtre par année (sinon le tri global timeout
      // sur les grosses communes). On prend la dernière année qui a des données.
      const base = `https://apidf-preprod.cerema.fr/dvf_opendata/mutations/?code_insee=${insee}&page_size=250`;
      let rows = [];
      let anneeUtilisee = null;
      for (const an of [2024, 2023, 2022]) {
        const dvf = await getJson(`${base}&anneemut=${an}`, 13_000).catch(() => null);
        if (dvf?.results?.length) {
          rows = rows.concat(dvf.results);
          anneeUtilisee = anneeUtilisee || an;
          if (rows.length >= 120) break; // assez de comparables
        }
      }

      // 3) Filtrage : ventes de logements bâtis avec surface exploitable
      const wantMaison = typeBien.startsWith("maison");
      const prixM2 = [];
      for (const m of rows) {
        if (m.libnatmut !== "Vente") continue;
        const val = Number(m.valeurfonc);
        const sbati = Number(m.sbati);
        const sterr = Number(m.sterr);
        if (!val || !sbati || sbati < 9) continue;
        // heuristique type : maison = terrain présent, appart = pas/peu de terrain
        const estMaison = sterr > 0;
        if (wantMaison !== estMaison) continue;
        const p = val / sbati;
        if (p > 300 && p < 25000) prixM2.push(p); // bornes anti-aberrations
      }

      if (prixM2.length < 5) {
        return { found: true, adresse, ville, insee, type: typeBien,
          estimation: null, note: "Pas assez de comparables DVF fiables sur cette commune", nb_comparables: prixM2.length };
      }

      prixM2.sort((a, b) => a - b);
      const median = prixM2[Math.floor(prixM2.length / 2)];
      const p25 = prixM2[Math.floor(prixM2.length * 0.25)];
      const p75 = prixM2[Math.floor(prixM2.length * 0.75)];
      const round = (n) => Math.round(n);

      return {
        found: true, adresse, ville, insee, type: typeBien,
        prix_m2: { median: round(median), fourchette_basse: round(p25), fourchette_haute: round(p75) },
        nb_comparables: prixM2.length,
        estimation: surface ? {
          surface,
          valeur_estimee: round(median * surface),
          fourchette: [round(p25 * surface), round(p75 * surface)],
        } : null,
        annee_reference: anneeUtilisee,
        methode: "Médiane du prix/m² des ventes DVF réelles de la commune (source Cerema), filtrées par type de bien",
        avertissement: "Estimation indicative de niveau commune, non un avis de valeur réglementaire",
      };
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || "estimation_failed" });
  }
});

export default router;
