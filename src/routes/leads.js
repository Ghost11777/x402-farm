// /v1/fr/qualified-leads — le produit croisé-multi-sources : leads B2B QUALIFIÉS.
// Impossible à assembler par un dev seul : IP résidentielle (Google Maps) + registre
// officiel des entreprises + dirigeants + santé + scoring, en un appel.
//   activity + location -> pour chaque commerce : contact (tél/site/note via Maps résidentiel)
//   croisé avec le registre (SIREN, forme juridique, NAF, dirigeants, ancienneté, effectif)
//   + un score de qualification (contactable, immatriculé, actif, établi).
import { Router } from "express";
import { callWorker } from "../lib/worker-proxy.js";

const router = Router();
const REG = "https://recherche-entreprises.api.gouv.fr/search";
const YEAR = 2026; // pas de Date.now() côté serverless déterministe -> constante d'ancienneté

const norm = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const tokens = (s) => norm(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 2);
// mots trop génériques pour discriminer un match
const STOP = new Set(["sarl", "sas", "sasu", "eurl", "sci", "societe", "entreprise", "france", "group", "groupe", "the", "and", "les", "des", "du", "de", "la", "le"]);

function overlap(a, b) {
  const A = new Set(tokens(a).filter((t) => !STOP.has(t)));
  const B = new Set(tokens(b).filter((t) => !STOP.has(t)));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}

// Numéro de voie d'une adresse ("22 Rue des Carmes" -> "22").
const streetNo = (s) => (String(s || "").match(/\b(\d{1,4})(?:\s?(?:bis|ter))?\b/) || [])[1] || null;
// Comparaison d'adresses : même numéro de voie + ≥1 token de rue commun = signal fort.
function addrMatch(a, b) {
  const n1 = streetNo(a), n2 = streetNo(b);
  if (!n1 || !n2 || n1 !== n2) return 0;
  const t1 = new Set(tokens(a).filter((t) => !/^\d+$/.test(t)));
  const t2 = new Set(tokens(b).filter((t) => !/^\d+$/.test(t)));
  let common = 0;
  for (const t of t1) if (t2.has(t)) common++;
  return common >= 1 ? 1 : 0.55; // même n° + rue commune = quasi certain
}

async function fetchReg(q, cp) {
  const url = `${REG}?q=${encodeURIComponent(q)}${cp ? `&code_postal=${cp}` : ""}&per_page=10&minimal=true&include=dirigeants,siege,finances`;
  const r = await fetch(url, { headers: { "user-agent": "x402-farm" }, signal: AbortSignal.timeout(9000) });
  return (await r.json()).results || [];
}

async function matchRegistry(name, cp, city, address) {
  const q = tokens(name).filter((t) => !STOP.has(t) && t !== norm(city)).join(" ") || name;
  try {
    // 1er essai filtré par code postal ; repli sans filtre si vide (le CP du siège peut différer)
    let results = await fetchReg(q, cp);
    if (!results.length && cp) results = await fetchReg(q, null);
    if (!results.length) return null;
    // meilleur match : nom + ADRESSE (numéro+rue) + commune. L'adresse prime.
    let best = null, bestScore = 0, bestAddr = 0;
    for (const c of results) {
      const nm = c.nom_complet || c.nom_raison_sociale || "";
      const nameS = overlap(name, nm);
      const sameCp = cp && c.siege?.code_postal === String(cp);
      const am = address ? addrMatch(address, c.siege?.adresse) : 0;
      // score combiné : le match d'adresse vaut très cher (jusqu'à +0.6)
      let s = nameS + am * 0.6 + (sameCp ? 0.15 : 0) + (city && norm(c.siege?.commune || "").includes(norm(city)) ? 0.1 : 0);
      if (s > bestScore) { bestScore = s; best = c; bestAddr = am; }
    }
    // Accepter si : nom correct (≥0.34) OU adresse (numéro+rue) qui matche (même si nom marketing ≠ légal)
    if (!best || (bestScore < 0.34 && bestAddr < 1)) return null;
    const fin = best.finances && Object.keys(best.finances).length
      ? (() => { const y = Object.keys(best.finances).sort().pop(); return { annee: y, ...best.finances[y] }; })()
      : null;
    const age = best.date_creation ? YEAR - Number(String(best.date_creation).slice(0, 4)) : null;
    return {
      siren: best.siren,
      legalName: best.nom_complet || best.nom_raison_sociale,
      naf: best.activite_principale || null,
      natureJuridique: best.nature_juridique || null,
      categorie: best.categorie_entreprise || null,
      effectif: best.tranche_effectif_salarie || null,
      dateCreation: best.date_creation || null,
      ageYears: age,
      etat: best.etat_administratif || null,
      dirigeants: (best.dirigeants || []).slice(0, 4).map((di) => ({
        nom: [di.prenoms, (di.nom || "").replace(/\s*\(.*\)$/, "").trim()].filter(Boolean).join(" ").trim() || di.nom,
        qualite: di.qualite || null,
      })),
      hq: best.siege ? [best.siege.adresse, best.siege.code_postal, best.siege.commune].filter(Boolean).join(", ") : null,
      finances: fin,
      matchConfidence: Math.round(Math.min(bestScore, 1) * 100) / 100,
      matchedBy: bestAddr >= 1 ? "address" : "name",
    };
  } catch { return null; }
}

function scoreLead(lead) {
  let s = 0;
  if (lead.phone) s += 30;
  if (lead.website) s += 15;
  const c = lead.company;
  if (c) {
    s += 25; // immatriculé/trouvé au registre
    if (c.etat === "A") s += 15;
    if (c.ageYears != null && c.ageYears >= 3) s += 10;
  }
  if (lead.rating != null && lead.rating >= 4) s += 5;
  s = Math.min(s, 100);
  return { score: s, tier: s >= 75 ? "HOT" : s >= 50 ? "WARM" : "COLD" };
}

// petite limite de concurrence pour l'enrichissement
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

router.all("/v1/fr/qualified-leads", async (req, res) => {
  const p = { ...req.query, ...(req.body || {}) };
  const activity = p.activity || p.q || p.query;
  const location = p.location || p.city || p.where || "";
  const max = Math.min(Math.max(Number(p.max || p.maxResults || 12) || 12, 1), 30);
  if (!activity) return res.status(400).json({ error: "missing_activity", hint: "provide ?activity=<business type>&location=<city>" });

  let businesses;
  try {
    const maps = await callWorker("/v1/maps", { q: activity, location, max }, 90_000);
    businesses = (maps.results || []).filter((b) => b.name);
  } catch (e) {
    return res.status(502).json({ error: "lead_source_failed", detail: String(e).slice(0, 140) });
  }
  if (!businesses.length) return res.status(502).json({ error: "no_businesses", query: { activity, location } });

  const leads = await mapLimit(businesses, 5, async (b) => {
    const cp = (String(b.address || "").match(/\b(\d{5})\b/) || [])[1] || null;
    const company = await matchRegistry(b.name, cp, location, b.address);
    const lead = {
      name: b.name,
      phone: b.phone || null,
      website: b.website || null,
      address: b.address || null,
      city: location || null,
      category: b.category || activity,
      rating: b.rating ?? null,
      reviews: b.reviews ?? null,
      mapsUrl: b.mapsUrl || null,
      company: company || null,
    };
    return { ...lead, ...scoreLead(lead) };
  });

  leads.sort((a, b) => b.score - a.score);
  const matched = leads.filter((l) => l.company).length;
  res.json({
    source: "google_maps + french_business_registry",
    query: { activity, location },
    count: leads.length,
    summary: {
      registryMatched: matched,
      withPhone: leads.filter((l) => l.phone).length,
      hot: leads.filter((l) => l.tier === "HOT").length,
      warm: leads.filter((l) => l.tier === "WARM").length,
    },
    leads,
  });
});

export default router;
