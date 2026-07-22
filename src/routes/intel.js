import { Router } from "express";
import { cached } from "../lib/cache.js";

// APIs d'INTELLIGENCE : croisements à forte valeur (anti-fraude, concurrence,
// vérification, valorisation). Coût ~0, remplacent des prestations à 50-500 €.
const router = Router();
const RE = "https://recherche-entreprises.api.gouv.fr/search";
const UA = { "user-agent": "x402-farm/0.1", accept: "application/json" };
const q = (req, n) => (req.query[n] || "").toString().trim();
const getJson = (url, t = 10_000, h = {}) =>
  fetch(url, { headers: { ...UA, ...h }, signal: AbortSignal.timeout(t) }).then((r) => {
    if (!r.ok) throw Object.assign(new Error(`upstream_${r.status}`), { status: 502 });
    return r.json();
  });
const settle = (p) => p.then((v) => ({ ok: true, v })).catch(() => ({ ok: false }));
const lastFin = (e) => { const f = e.finances || {}; const y = Object.keys(f).sort().pop(); return y ? { annee: y, ...f[y] } : null; };

// ===== /fr/reseau-dirigeant : toutes les sociétés d'une personne + drapeaux =====
// Anti-fraude / due diligence : un dirigeant lié à des liquidations = signal.
router.all("/v1/fr/reseau-dirigeant", async (req, res) => {
  const nom = q(req, "nom");
  const prenom = q(req, "prenom");
  if (!nom) return res.status(400).json({ error: "missing_nom" });
  try {
    const data = await cached(`reseau:${nom}:${prenom}`, 12 * 3600_000, async () => {
      const params = new URLSearchParams({ nom_personne: nom, per_page: "25", page: "1" });
      if (prenom) params.set("prenoms_personne", prenom);
      const r = await getJson(`${RE}?${params}`);
      const societes = (r.results || []).map((e) => {
        const dir = (e.dirigeants || []).find((d) => (d.nom || "").toUpperCase() === nom.toUpperCase());
        return { siren: e.siren, nom: e.nom_complet, naf: e.activite_principale,
          etat: e.etat_administratif === "A" ? "active" : "cessée",
          creation: e.date_creation, role: dir?.qualite || null, ville: e.siege?.libelle_commune };
      });
      const cessees = societes.filter((s) => s.etat === "cessée").length;
      const actives = societes.length - cessees;
      const alerte = cessees >= 3 ? "élevée" : cessees >= 1 ? "modérée" : "aucune";
      return {
        personne: [prenom, nom].filter(Boolean).join(" "),
        total_societes: r.total_results,
        affichees: societes.length,
        actives, cessees,
        niveau_alerte: alerte,
        societes,
        note: cessees >= 3 ? "Plusieurs sociétés cessées liées à cette personne — vérification approfondie recommandée." : undefined,
        methode: "Recherche par dirigeant (RNE). Homonymes possibles : vérifier avec le prénom. Indicatif.",
        sources: ["recherche-entreprises"],
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "network_failed" }); }
});

// ===== /fr/concurrents : paysage concurrentiel d'une entreprise, avec finances =====
router.all("/v1/fr/concurrents", async (req, res) => {
  const input = q(req, "q") || q(req, "siren");
  if (!input) return res.status(400).json({ error: "missing_q_or_siren" });
  const zone = q(req, "zone") || "departement"; // departement | region | national
  try {
    const data = await cached(`concur:${input}:${zone}`, 12 * 3600_000, async () => {
      const ref = (await getJson(`${RE}?q=${encodeURIComponent(input)}&per_page=1`)).results?.[0];
      if (!ref) return { found: false, query: input };
      const naf = ref.activite_principale;
      const dep = ref.siege?.departement;
      const params = new URLSearchParams({ activite_principale: naf, per_page: "25", etat_administratif: "A", page: "1" });
      if (zone === "departement" && dep) params.set("departement", dep);
      if (zone === "region" && ref.siege?.region) params.set("region", ref.siege.region);
      const r = await getJson(`${RE}?${params}`);
      const concurrents = (r.results || [])
        .filter((e) => e.siren !== ref.siren)
        .map((e) => ({ siren: e.siren, nom: e.nom_complet, ville: e.siege?.libelle_commune,
          effectif: e.tranche_effectif_salarie, finances: lastFin(e) }))
        .sort((a, b) => (b.finances?.ca || 0) - (a.finances?.ca || 0));
      const refFin = lastFin(ref);
      const cas = concurrents.map((c) => c.finances?.ca).filter(Boolean);
      const rangCA = refFin?.ca && cas.length ? cas.filter((v) => v > refFin.ca).length + 1 : null;
      return {
        entreprise: { siren: ref.siren, nom: ref.nom_complet, finances: refFin },
        naf, zone, total_marche: r.total_results,
        position_ca: rangCA ? `${rangCA}${rangCA === 1 ? "er" : "e"} sur ${cas.length + 1} avec CA connu` : null,
        top_concurrents: concurrents.slice(0, 15),
        methode: "Concurrents = même code NAF et zone (RNE), classés par CA déclaré. CA disponible pour une partie des sociétés seulement.",
        sources: ["recherche-entreprises"],
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "competitors_failed" }); }
});

// ===== /fr/verif-artisan : vérifier un artisan avant de commander des travaux =====
// Croise : santé entreprise + certification RGE + dirigeant lié à des faillites.
router.all("/v1/fr/verif-artisan", async (req, res) => {
  const input = q(req, "q") || q(req, "siren");
  if (!input) return res.status(400).json({ error: "missing_q_or_siren" });
  try {
    const data = await cached(`artisan:${input}`, 12 * 3600_000, async () => {
      const e = (await getJson(`${RE}?q=${encodeURIComponent(input)}&per_page=1`)).results?.[0];
      if (!e) return { found: false, query: input };
      const siren = e.siren;
      const siret = e.siege?.siret;
      const [bodaccR, rgeR] = await Promise.all([
        settle(getJson(`https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=${encodeURIComponent(`registre like "${siren}"`)}&limit=20&order_by=${encodeURIComponent("dateparution desc")}`, 12_000)),
        siret ? settle(getJson(`https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-2/lines?size=10&qs=${encodeURIComponent(`siret:${siret}`)}`, 12_000)) : Promise.resolve({ ok: false }),
      ]);
      const proc = bodaccR.ok ? (bodaccR.v.results || []).filter((a) => /procédure|redressement|liquidation|sauvegarde/i.test(`${a.familleavis_lib} ${a.typeavis_lib}`)) : [];
      const rge = rgeR.ok ? (rgeR.v.results || []) : [];
      const age = e.date_creation ? 2026 - Number(e.date_creation.slice(0, 4)) : null;

      const alertes = [];
      if (e.etat_administratif !== "A") alertes.push("entreprise cessée/radiée");
      if (proc.some((a) => (a.dateparution || "") >= "2024-01-01")) alertes.push("procédure collective récente");
      if (age !== null && age < 1) alertes.push("entreprise très récente (< 1 an)");
      const confiance = e.etat_administratif !== "A" || proc.some((a) => (a.dateparution || "") >= "2024-01-01") ? "faible"
        : rge.length ? "élevée" : alertes.length ? "moyenne" : "correcte";

      return {
        siren, denomination: e.nom_complet, siret,
        confiance,
        active: e.etat_administratif === "A",
        anciennete_ans: age,
        naf: e.activite_principale,
        certifie_rge: rge.length > 0,
        qualifications_rge: rge.map((r) => r.nom_qualification),
        procedures_collectives: proc.length,
        alertes,
        finances: lastFin(e),
        methode: "Vérification artisan : état RNE + ancienneté + certification RGE (ADEME) + procédures collectives (BODACC). Aide à la décision avant travaux, indicatif.",
        sources: ["recherche-entreprises", "ADEME RGE", "BODACC"],
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "verif_failed" }); }
});

// ===== /fr/valorisation : estimation de valeur d'entreprise (multiples) =====
router.all("/v1/fr/valorisation", async (req, res) => {
  const input = q(req, "q") || q(req, "siren");
  if (!input) return res.status(400).json({ error: "missing_q_or_siren" });
  try {
    const data = await cached(`valo:${input}`, 24 * 3600_000, async () => {
      const e = (await getJson(`${RE}?q=${encodeURIComponent(input)}&per_page=1`)).results?.[0];
      if (!e) return { found: false, query: input };
      const fin = lastFin(e);
      if (!fin?.ca) return { found: true, siren: e.siren, denomination: e.nom_complet,
        valorisation: null, note: "Chiffre d'affaires non disponible publiquement pour cette entreprise" };
      const ca = fin.ca, rn = fin.resultat_net ?? null;
      // Multiples sectoriels prudents (fourchette générique PME/ETI françaises)
      const parCA = { bas: Math.round(ca * 0.5), median: Math.round(ca * 0.8), haut: Math.round(ca * 1.2) };
      const parResultat = rn && rn > 0 ? { bas: Math.round(rn * 6), median: Math.round(rn * 9), haut: Math.round(rn * 12) } : null;
      // Synthèse : moyenne des médianes disponibles
      const medians = [parCA.median, parResultat?.median].filter(Boolean);
      const estimation = Math.round(medians.reduce((a, b) => a + b, 0) / medians.length);
      return {
        siren: e.siren, denomination: e.nom_complet,
        exercice: fin.annee, chiffre_affaires: ca, resultat_net: rn,
        valorisation: {
          estimation_centrale: estimation,
          fourchette: [Math.round(estimation * 0.7), Math.round(estimation * 1.4)],
          methode_ca: parCA,
          methode_resultat: parResultat,
        },
        avertissement: "Estimation indicative par multiples génériques (0,5-1,2× CA ; 6-12× résultat net). NE remplace PAS une valorisation professionnelle qui intègre dette, actifs, secteur, perspectives.",
        sources: ["recherche-entreprises"],
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "valuation_failed" }); }
});

export default router;
