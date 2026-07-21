import { Router } from "express";
import { cached } from "../lib/cache.js";

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

// ===================== /fr/score-entreprise =====================
// Score de solidité 0-100 croisant : finances (tendance CA/résultat INPI),
// signaux légaux (BODACC : procédures collectives...), ancienneté, activité.
router.get("/v1/fr/score-entreprise", async (req, res) => {
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
router.get("/v1/fr/analyse-immo", async (req, res) => {
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

export default router;
