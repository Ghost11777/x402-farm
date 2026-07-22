import { Router } from "express";
import { cached } from "../lib/cache.js";
import { registerPartial } from "../lib/partial.js";

// APIs DE DÉCISION : croisent plusieurs sources en un score/verdict actionnable.
// Coût marginal ~0 (on possède déjà les sources), valeur pour l'agent = le jugement
// assemblé qu'il ne referait pas seul. Remplace des rapports payants à 30-200 €.
const router = Router();
const UA = { "user-agent": "x402-farm/0.1", accept: "application/json" };
const INPI = "https://registre-national-entreprises.inpi.fr/api";

const q = (req, n) => (req.query[n] || "").toString().trim();
const getJson = (url, t = 10_000, h = {}) =>
  fetch(url, { headers: { ...UA, ...h }, signal: AbortSignal.timeout(t) }).then((r) => {
    if (!r.ok) throw Object.assign(new Error(`upstream_${r.status}`), { status: 502 });
    return r.json();
  });
const settle = (p) => p.then((v) => ({ ok: true, v })).catch(() => ({ ok: false }));
const num = (s) => { if (s == null) return null; const n = Number(String(s).replace(/^(-?)0+(?=\d)/, "$1")); return Number.isFinite(n) ? n : null; };

// --- INPI token partagé (mêmes creds que /fr/bilans) ---
let inpiTok = { token: null, expires: 0 };
async function inpiToken() {
  if (inpiTok.token && inpiTok.expires > Date.now()) return inpiTok.token;
  const u = process.env.INPI_USERNAME, p = process.env.INPI_PASSWORD;
  if (!u || !p) return null;
  try {
    const r = await fetch(`${INPI}/sso/login`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: u, password: p }), signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    inpiTok = { token: (await r.json()).token, expires: Date.now() + 50 * 60_000 };
    return inpiTok.token;
  } catch { return null; }
}
async function inpiBilans(siren) {
  const token = await inpiToken();
  if (!token) return [];
  try {
    const att = await getJson(`${INPI}/companies/${siren}/attachments`, 15_000, { authorization: `Bearer ${token}` });
    const LIASSE = { FJ: "ca", GW: "resultat_exploitation", GU: "resultat_courant", CO: "total_bilan" };
    return (att.bilansSaisis || []).map((bs) => {
      const b = bs?.bilanSaisi?.bilan; if (!b) return null;
      const codes = {}; for (const p of b.detail?.pages || []) for (const l of p.liasses || []) codes[l.code] = l;
      const f = {}; for (const [c, lbl] of Object.entries(LIASSE)) { const v = num(codes[c]?.m3); if (v) f[lbl] = v; }
      return { date: b.identite?.dateClotureExercice, ...f };
    }).filter(Boolean).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  } catch { return []; }
}

// --- Versions "partial" (prix réduit, champs de décision) — avant les routes complètes ---
registerPartial(router, "/v1/fr/score-entreprise", (d) => ({
  siren: d.siren, denomination: d.denomination, score: d.score, niveau: d.niveau,
  etat: d.etat, procedures_collectives: d.procedures_collectives,
}));
registerPartial(router, "/v1/fr/analyse-immo", (d) => ({
  adresse: d.adresse, ville: d.ville,
  prix_m2_median: d.estimation?.prix_m2_median, valeur_estimee: d.estimation?.valeur_estimee,
  score_investissement: d.score_investissement,
}));
registerPartial(router, "/v1/fr/kyb", (d) => ({
  siren: d.siren, denomination: d.denomination, verdict: d.verdict,
  etat: d.identite?.etat, tva_validee_vies: d.fiscal?.tva_validee_vies,
  procedures_collectives: d.procedures_collectives, nb_drapeaux: (d.drapeaux || []).length,
}));

// ===================== /fr/score-entreprise =====================
// Score de solidité 0-100 croisant : finances (tendance CA/résultat INPI),
// signaux légaux (BODACC : procédures collectives...), ancienneté, activité.
router.all("/v1/fr/score-entreprise", async (req, res) => {
  const input = q(req, "q") || q(req, "siren");
  if (!input) return res.status(400).json({ error: "missing_q_or_siren" });
  try {
    const data = await cached(`score-ent:${input}`, 12 * 3600_000, async () => {
      const search = await getJson(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(input)}&per_page=1`);
      const e = search.results?.[0];
      if (!e) return { found: false, query: input };
      const siren = e.siren;

      const [bodaccR, bilans] = await Promise.all([
        settle(getJson(`https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=${encodeURIComponent(`registre like "${siren}"`)}&limit=30&order_by=${encodeURIComponent("dateparution desc")}`, 12_000)),
        inpiBilans(siren),
      ]);
      const annonces = bodaccR.ok ? bodaccR.v.results || [] : [];

      // --- Scoring (0-100), transparent ---
      let score = 50;
      const signaux = [];

      // 1) Ancienneté (max +15)
      const anneeCrea = e.date_creation ? Number(e.date_creation.slice(0, 4)) : null;
      const age = anneeCrea ? 2026 - anneeCrea : null;
      if (age !== null) {
        const bonus = Math.min(15, Math.round(age / 2));
        score += bonus;
        signaux.push({ facteur: "anciennete", annees: age, impact: `+${bonus}` });
      }

      // 2) État administratif (radiation = lourd)
      if (e.etat_administratif !== "A") { score -= 30; signaux.push({ facteur: "etat", valeur: "cessée/radiée", impact: "-30" }); }

      // 3) Procédures collectives dans BODACC (redressement, liquidation, sauvegarde)
      const proc = annonces.filter((a) => /procédure|redressement|liquidation|sauvegarde|cessation/i.test(`${a.familleavis_lib} ${a.typeavis_lib}`));
      if (proc.length) {
        const recent = proc.find((a) => (a.dateparution || "") >= "2024-01-01");
        const malus = recent ? 40 : 20;
        score -= malus;
        signaux.push({ facteur: "procedure_collective", nb: proc.length, recente: !!recent, impact: `-${malus}` });
      }

      // 4) Tendance financière (CA et résultat sur les exercices dispo)
      let finance = null;
      if (bilans.length >= 2) {
        const [n, n1] = bilans;
        const caTrend = n.ca && n1.ca ? (n.ca - n1.ca) / n1.ca : null;
        const rentable = n.resultat_courant != null ? n.resultat_courant > 0 : (n.resultat_exploitation > 0);
        let impact = 0;
        if (rentable) impact += 10; else impact -= 15;
        if (caTrend != null) { if (caTrend > 0.03) impact += 8; else if (caTrend < -0.1) impact -= 12; }
        score += impact;
        finance = {
          ca_dernier: n.ca, ca_precedent: n1.ca,
          croissance_ca_pct: caTrend != null ? Math.round(caTrend * 1000) / 10 : null,
          resultat_courant: n.resultat_courant ?? n.resultat_exploitation, rentable, impact: (impact >= 0 ? "+" : "") + impact,
        };
        signaux.push({ facteur: "finances", rentable, croissance_ca_pct: finance.croissance_ca_pct, impact: finance.impact });
      } else {
        signaux.push({ facteur: "finances", note: "comptes annuels indisponibles", impact: "0" });
      }

      score = Math.max(0, Math.min(100, Math.round(score)));
      const niveau = score >= 75 ? "solide" : score >= 55 ? "correct" : score >= 40 ? "vigilance" : "risque élevé";

      return {
        siren, denomination: e.nom_complet, score, niveau,
        etat: e.etat_administratif === "A" ? "active" : "cessée",
        creation: e.date_creation, effectif: e.tranche_effectif_salarie, naf: e.activite_principale,
        finance, procedures_collectives: proc.length,
        signaux,
        methode: "Score 0-100 pondéré : ancienneté, état administratif, procédures collectives (BODACC), rentabilité & croissance CA (comptes annuels INPI). Indicatif, non un avis de crédit réglementaire.",
        sources: ["recherche-entreprises", "BODACC", "INPI RNE"],
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "scoring_failed" }); }
});

// ===================== /fr/analyse-immo =====================
// Scorecard investissement d'une adresse : valeur estimée (DVF) + énergie (DPE)
// + risques naturels (GéoRisques) + démographie commune (INSEE).
router.all("/v1/fr/analyse-immo", async (req, res) => {
  const adresse = q(req, "adresse");
  const surface = Number(q(req, "surface")) || null;
  const typeBien = (q(req, "type") || "appartement").toLowerCase();
  if (!adresse) return res.status(400).json({ error: "missing_adresse" });
  try {
    const data = await cached(`analyse-immo:${adresse}:${typeBien}:${surface}`, 24 * 3600_000, async () => {
      const geo = await getJson(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(adresse)}&limit=1`);
      const f = geo.features?.[0];
      if (!f) return { found: false, adresse };
      const insee = f.properties.citycode, ville = f.properties.city, cp = f.properties.postcode;

      const wantMaison = typeBien.startsWith("maison");
      const [dvfPack, dpeR, risqR, communeR] = await Promise.all([
        (async () => { // DVF prix/m² médian
          for (const an of [2024, 2023, 2022]) {
            const d = await settle(getJson(`https://apidf-preprod.cerema.fr/dvf_opendata/mutations/?code_insee=${insee}&page_size=250&anneemut=${an}`, 13_000));
            if (d.ok && d.v.results?.length) {
              const px = d.v.results.filter((m) => m.libnatmut === "Vente" && Number(m.valeurfonc) && Number(m.sbati) >= 9 && (Number(m.sterr) > 0) === wantMaison)
                .map((m) => Number(m.valeurfonc) / Number(m.sbati)).filter((p) => p > 300 && p < 25000).sort((a, b) => a - b);
              if (px.length >= 5) return { annee: an, median: Math.round(px[Math.floor(px.length / 2)]), n: px.length };
            }
          }
          return null;
        })(),
        settle(getJson(`https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines?size=20&q=${encodeURIComponent(`code_insee_ban:${insee}`)}`, 12_000)),
        settle(getJson(`https://www.georisques.gouv.fr/api/v1/gaspar/risques?code_insee=${insee}&page=1&page_size=50`, 12_000)),
        settle(getJson(`https://geo.api.gouv.fr/communes/${insee}?fields=nom,population,surface`, 8_000)),
      ]);

      // DPE : répartition des étiquettes du secteur
      let dpe = null;
      if (dpeR.ok && dpeR.v.results?.length) {
        const dist = {}; for (const r of dpeR.v.results) { const et = r.etiquette_dpe; if (et) dist[et] = (dist[et] || 0) + 1; }
        dpe = { echantillon: dpeR.v.results.length, repartition_etiquettes: dist };
      }
      // Risques
      let risques = [];
      if (risqR.ok) {
        const seen = new Set();
        for (const r of risqR.v.data?.[0]?.risques_detail || []) if (r.libelle_risque_long && !seen.has(r.libelle_risque_long)) { seen.add(r.libelle_risque_long); risques.push(r.libelle_risque_long); }
      }
      const commune = communeR.ok ? communeR.v : null;
      const densite = commune?.population && commune?.surface ? Math.round(commune.population / (commune.surface / 100)) : null;

      const prixM2 = dvfPack?.median || null;
      const valeur = prixM2 && surface ? prixM2 * surface : null;
      // Estimation grossière du rendement locatif brut via loyer ~ prix/m² * facteur zone
      const loyerM2Est = prixM2 ? Math.round(prixM2 / 220 * 10) / 10 : null; // approximation prudente
      const rendementBrut = prixM2 && loyerM2Est ? Math.round((loyerM2Est * 12 / prixM2) * 1000) / 10 : null;

      // Verdict synthétique
      let score = 50; const points = [];
      if (rendementBrut != null) { if (rendementBrut >= 6) { score += 15; points.push("bon rendement locatif potentiel"); } else if (rendementBrut < 3.5) { score -= 10; points.push("rendement locatif faible"); } }
      if (risques.length >= 4) { score -= 10; points.push(`${risques.length} risques naturels/techno recensés`); }
      if (densite && densite > 1000) { score += 8; points.push("zone dense (liquidité/locatif favorables)"); }
      if (dpe && (dpe.repartition_etiquettes.F || dpe.repartition_etiquettes.G)) points.push("parc partiellement passoire thermique (levier négociation/travaux)");
      score = Math.max(0, Math.min(100, Math.round(score)));

      return {
        adresse: f.properties.label, ville, cp, insee,
        estimation: { type: typeBien, prix_m2_median: prixM2, annee_reference: dvfPack?.annee, nb_comparables: dvfPack?.n,
          valeur_estimee: valeur ? Math.round(valeur) : null, surface },
        rendement_locatif_brut_estime_pct: rendementBrut,
        energie: dpe,
        risques_naturels: risques,
        demographie: commune ? { population: commune.population, densite_hab_km2: densite } : null,
        score_investissement: score, points_cles: points,
        methode: "Croisement DVF (prix réels) + DPE (ADEME) + GéoRisques + démographie INSEE. Rendement locatif = estimation prudente indicative, pas un conseil en investissement.",
        sources: ["DVF Cerema", "ADEME DPE", "GéoRisques", "INSEE"],
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "analysis_failed" }); }
});

// ===================== /fr/kyb =====================
// Know Your Business : dossier de conformité fournisseur en un appel.
// Croise : identité + TVA (calcul + validation VIES) + dirigeants + santé
// financière (INPI bilans) + procédures légales (BODACC) + verdict.
router.all("/v1/fr/kyb", async (req, res) => {
  const input = q(req, "q") || q(req, "siren");
  if (!input) return res.status(400).json({ error: "missing_q_or_siren" });
  try {
    const data = await cached(`kyb:${input}`, 12 * 3600_000, async () => {
      const search = await getJson(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(input)}&per_page=1`);
      const e = search.results?.[0];
      if (!e) return { found: false, query: input };
      const siren = e.siren;
      const key = (12 + 3 * (Number(siren) % 97)) % 97;
      const tva = `FR${String(key).padStart(2, "0")}${siren}`;

      const [vies, bodaccR, bilans] = await Promise.all([
        settle(getJson(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/FR/vat/${key}${siren}`, 12_000)),
        settle(getJson(`https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=${encodeURIComponent(`registre like "${siren}"`)}&limit=20&order_by=${encodeURIComponent("dateparution desc")}`, 12_000)),
        inpiBilans(siren),
      ]);
      const annonces = bodaccR.ok ? bodaccR.v.results || [] : [];
      const proc = annonces.filter((a) => /procédure|redressement|liquidation|sauvegarde|cessation/i.test(`${a.familleavis_lib} ${a.typeavis_lib}`));
      // VIES peut être throttlé (userError) -> ne pas conclure "invalide" dans ce cas
      const viesUnavailable = vies.ok && vies.v.userError && !["VALID", "INVALID"].includes(vies.v.userError);
      const tvaValide = !vies.ok || viesUnavailable ? null : vies.v.isValid === true;

      // Drapeaux de conformité
      const flags = [];
      if (e.etat_administratif !== "A") flags.push({ niveau: "critique", motif: "entreprise cessée ou radiée" });
      if (proc.some((a) => (a.dateparution || "") >= "2024-01-01")) flags.push({ niveau: "élevé", motif: "procédure collective récente (BODACC)" });
      else if (proc.length) flags.push({ niveau: "moyen", motif: "procédure collective historique" });
      if (tvaValide === false) flags.push({ niveau: "moyen", motif: "TVA intracommunautaire non validée par VIES" });
      const last = bilans[0];
      if (last && (last.resultat_courant ?? last.resultat_exploitation) < 0) flags.push({ niveau: "moyen", motif: "dernier exercice déficitaire" });
      if (!bilans.length) flags.push({ niveau: "info", motif: "aucun compte annuel exploitable (micro-entreprise ou confidentiel)" });

      const verdict = flags.some((f) => f.niveau === "critique") ? "REJET"
        : flags.some((f) => f.niveau === "élevé") ? "VIGILANCE RENFORCÉE"
        : flags.some((f) => f.niveau === "moyen") ? "VIGILANCE" : "CONFORME";

      return {
        siren, denomination: e.nom_complet, verdict,
        identite: { forme_juridique: e.nature_juridique, naf: e.activite_principale, creation: e.date_creation,
          etat: e.etat_administratif === "A" ? "active" : "cessée", effectif: e.tranche_effectif_salarie, categorie: e.categorie_entreprise },
        fiscal: { tva_intracommunautaire: tva, tva_validee_vies: tvaValide },
        siege: e.siege ? { siret: e.siege.siret, adresse: e.siege.adresse, ville: e.siege.libelle_commune } : null,
        dirigeants: (e.dirigeants || []).map((d) => ({ nom: d.nom, prenoms: d.prenoms, qualite: d.qualite, denomination: d.denomination })),
        sante_financiere: last ? { dernier_exercice: last.date, ca: last.ca, resultat: last.resultat_courant ?? last.resultat_exploitation } : null,
        procedures_collectives: proc.length,
        drapeaux: flags,
        methode: "Dossier KYB : identité RNE + validation TVA VIES + dirigeants + santé financière INPI + procédures BODACC. Verdict indicatif d'aide à la décision, non un avis réglementaire LCB-FT.",
        sources: ["recherche-entreprises", "VIES", "BODACC", "INPI RNE"],
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "kyb_failed" }); }
});

// ===================== /fr/etude-implantation =====================
// « Ouvrir ce type de commerce ici, bonne idée ? » Croise : concurrents (NAF+
// commune) + démographie INSEE + immobilier commercial (DVF) -> saturation & score.
const NAF_ALIAS = {
  boulangerie: "10.71C", restaurant: "56.10A", coiffure: "96.02A", "salle de sport": "93.13Z",
  pharmacie: "47.73Z", "fleuriste": "47.76Z", tabac: "47.26Z", "auto-école": "85.53Z",
  bar: "56.30Z", opticien: "47.78A", boucherie: "47.22Z", pizzeria: "56.10C",
};
router.all("/v1/fr/etude-implantation", async (req, res) => {
  const activite = q(req, "activite");
  const commune = q(req, "commune") || q(req, "insee");
  if (!activite || !commune) return res.status(400).json({ error: "missing_activite_or_commune" });
  try {
    const data = await cached(`implant:${activite}:${commune}`, 24 * 3600_000, async () => {
      // Résoudre commune -> INSEE + démographie
      const isInsee = /^\d{5}[AB0-9]?$/i.test(commune);
      const communeData = await getJson(
        isInsee ? `https://geo.api.gouv.fr/communes/${commune}?fields=nom,code,population,surface`
                : `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(commune)}&fields=nom,code,population,surface&boost=population&limit=1`
      );
      const c = isInsee ? communeData : communeData[0];
      if (!c) return { found: false, commune };
      const insee = c.code;
      const naf = NAF_ALIAS[activite.toLowerCase()] || (/^\d{2}\.\d{2}[A-Z]?$/.test(activite) ? activite : null);

      // Concurrents actifs (NAF+commune) + total entreprises commune
      const [concurR, prixM2] = await Promise.all([
        naf ? settle(getJson(`https://recherche-entreprises.api.gouv.fr/search?activite_principale=${naf}&code_commune=${insee}&etat_administratif=A&per_page=1`, 10_000)) : Promise.resolve({ ok: false }),
        (async () => { for (const an of [2024, 2023]) { const d = await settle(getJson(`https://apidf-preprod.cerema.fr/dvf_opendata/mutations/?code_insee=${insee}&page_size=200&anneemut=${an}`, 12_000)); if (d.ok && d.v.results?.length) { const px = d.v.results.filter((m) => m.libnatmut === "Vente" && Number(m.valeurfonc) && Number(m.sbati) >= 9).map((m) => Number(m.valeurfonc) / Number(m.sbati)).filter((p) => p > 300 && p < 25000).sort((a, b) => a - b); if (px.length >= 5) return Math.round(px[Math.floor(px.length / 2)]); } } return null; })(),
      ]);

      const concurrents = concurR.ok ? concurR.v.total_results : null;
      const pop = c.population || null;
      // Paris/Lyon/Marseille : la recherche par code commune global renvoie 0 (données par arrondissement)
      const arrondissementCommune = ["75056", "69123", "13055"].includes(insee);
      const densiteConcurrence = concurrents && pop ? Math.round(pop / concurrents) : null;

      // Score d'opportunité (0-100) : plus d'habitants/concurrent = mieux
      let score = 50; const analyse = [];
      if (naf == null) analyse.push("activité non reconnue — fournir un code NAF (ex. 56.10A) ou un mot-clé connu (boulangerie, restaurant, coiffure...)");
      else if (arrondissementCommune) analyse.push("commune à arrondissements (Paris/Lyon/Marseille) : préciser l'INSEE d'arrondissement pour un décompte fiable");
      else if (densiteConcurrence != null) {
        if (densiteConcurrence > 3000) { score += 20; analyse.push(`marché peu saturé (${densiteConcurrence} hab./établissement)`); }
        else if (densiteConcurrence < 1000) { score -= 20; analyse.push(`marché saturé (${densiteConcurrence} hab./établissement)`); }
        else analyse.push(`concurrence moyenne (${densiteConcurrence} hab./établissement)`);
      } else if (concurrents === 0) analyse.push("aucun concurrent recensé sur cette activité dans la commune (opportunité ou activité inadaptée)");
      if (pop && pop > 20000) { score += 8; analyse.push("bassin de population significatif"); }
      if (pop && pop < 2000) { score -= 10; analyse.push("faible population locale"); }
      score = Math.max(0, Math.min(100, Math.round(score)));

      return {
        commune: c.nom, insee, population: pop,
        activite, code_naf: naf,
        concurrents_actifs: concurrents,
        habitants_par_concurrent: densiteConcurrence,
        prix_immobilier_m2_median: prixM2,
        score_opportunite: score, analyse,
        methode: "Croisement concurrents actifs (RNE, même NAF+commune) + population (INSEE) + prix immobilier (DVF). Aide à la décision d'implantation, indicatif.",
        sources: ["recherche-entreprises", "INSEE", "DVF Cerema"],
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "study_failed" }); }
});

export default router;
