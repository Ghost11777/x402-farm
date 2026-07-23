// /v1/fr/enrich — enrichissement entreprise (le "Clearbit/Apollo FR").
// Entrée : un SIREN OU un nom (+ ville). Sortie : dossier commercial complet =
// identité légale + dirigeants + santé + RISQUE (BODACC) + CONTACT (tél/site via Maps résidentiel).
// Croise registre + annonces légales + Google Maps -> ce qu'un CRM veut, en un appel.
import { Router } from "express";
import { callWorker } from "../lib/worker-proxy.js";

const router = Router();
const REG = "https://recherche-entreprises.api.gouv.fr/search";
const BODACC = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";
const YEAR = 2026;

async function getJson(url, t = 9000) {
  const r = await fetch(url, { headers: { "user-agent": "x402-farm" }, signal: AbortSignal.timeout(t) });
  return r.json();
}

async function registry({ siren, name, city }) {
  const q = siren ? `q=${siren}` : `q=${encodeURIComponent(name)}${city ? `&code_postal=&terme=${encodeURIComponent(city)}` : ""}`;
  const d = await getJson(`${REG}?${siren ? `q=${siren}` : `q=${encodeURIComponent([name, city].filter(Boolean).join(" "))}`}&per_page=1&minimal=true&include=dirigeants,siege,finances`);
  const c = (d.results || [])[0];
  if (!c) return null;
  const fin = c.finances && Object.keys(c.finances).length
    ? (() => { const y = Object.keys(c.finances).sort().pop(); return { annee: y, ...c.finances[y] }; })() : null;
  return {
    siren: c.siren,
    legalName: c.nom_complet || c.nom_raison_sociale,
    naf: c.activite_principale || null,
    natureJuridique: c.nature_juridique || null,
    categorie: c.categorie_entreprise || null,
    effectif: c.tranche_effectif_salarie || null,
    dateCreation: c.date_creation || null,
    ageYears: c.date_creation ? YEAR - Number(String(c.date_creation).slice(0, 4)) : null,
    etat: c.etat_administratif || null,
    dirigeants: (c.dirigeants || []).slice(0, 6).map((di) => ({
      nom: [di.prenoms, (di.nom || "").replace(/\s*\(.*\)$/, "").trim()].filter(Boolean).join(" ").trim() || di.nom,
      qualite: di.qualite || null,
    })),
    hq: c.siege ? [c.siege.adresse, c.siege.code_postal, c.siege.commune].filter(Boolean).join(", ") : null,
    commune: c.siege?.commune || null,
    finances: fin,
  };
}

async function risk(siren) {
  try {
    const d = await getJson(`${BODACC}?where=${encodeURIComponent(`registre like "${siren}"`)}&order_by=dateparution desc&limit=5`, 8000);
    const recs = (d.results || []);
    const collective = recs.filter((r) => /collective/i.test(r.familleavis_lib || r.familleavis || ""));
    return {
      hasInsolvencyHistory: collective.length > 0,
      recentAnnouncements: recs.slice(0, 3).map((r) => ({ date: r.dateparution, type: r.familleavis_lib || r.familleavis })),
    };
  } catch { return { hasInsolvencyHistory: null, recentAnnouncements: [] }; }
}

async function contact(name, commune) {
  try {
    const maps = await callWorker("/v1/maps", { q: name, location: commune || "", max: 1 }, 60000);
    const b = (maps.results || [])[0];
    if (!b) return null;
    return { phone: b.phone || null, website: b.website || null, rating: b.rating ?? null, reviews: b.reviews ?? null, mapsUrl: b.mapsUrl || null };
  } catch { return null; }
}

router.all("/v1/fr/enrich", async (req, res) => {
  const p = { ...req.query, ...(req.body || {}) };
  const siren = (p.siren || "").toString().replace(/\s/g, "") || null;
  const name = p.name || p.q || p.company || null;
  const city = p.city || p.location || "";
  const wantContact = p.contact !== "false" && p.contact !== false; // par défaut on cherche le contact
  if (!siren && !name) return res.status(400).json({ error: "missing_input", hint: "provide ?siren= or ?name= (&city=)" });

  const company = await registry({ siren, name, city });
  if (!company) return res.status(404).json({ error: "company_not_found", query: { siren, name, city } });

  const [riskInfo, contactInfo] = await Promise.all([
    risk(company.siren),
    wantContact ? contact(company.legalName || name, company.commune || city) : Promise.resolve(null),
  ]);

  res.json({
    source: "french_registry + bodacc + google_maps",
    company,
    risk: riskInfo,
    contact: contactInfo,
  });
});

export default router;
