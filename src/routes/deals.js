// /v1/fr/biens-sous-cotes — deal-flow immobilier : biens listés SOUS le prix réellement vendu.
// 100% GRATUIT côté sources : Bien'ici (prix affiché, via le mini résidentiel) × DVF (prix
// vendu officiel, gratuit) × INSEE. Croise les deux -> candidats sous-cotés triés par décote.
// Ce que personne d'autre ne produit (asking vs sold à l'échelle). Query: ?city=&cp=&minGap=
import { Router } from "express";
import { callWorker } from "../lib/worker-proxy.js";
import { sharedCached } from "../lib/shared-cache.js";

const router = Router();
const DVF = "https://apidf-preprod.cerema.fr/dvf_opendata/mutations/";

function median(a) {
  const s = a.filter((x) => x != null).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

async function inseeCode(city, cp) {
  try {
    const u = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(city)}${cp ? `&codePostal=${cp}` : ""}&fields=code,nom&limit=1`;
    const d = await (await fetch(u, { signal: AbortSignal.timeout(6000) })).json();
    return d[0]?.code || null;
  } catch { return null; }
}

// Médiane €/m² des ventes réelles (DVF) pour une commune.
// ⚠️ La source Cerema est LENTE et instable : sur les grosses communes une requête non
// filtrée par année part en timeout, et 2024 renvoie parfois une page HTML. Motif retenu
// (identique à estimation-immo, qui tient en prod) : année la plus récente d'abord,
// page_size=250, 13 s par tentative, on s'arrête dès qu'on a assez de comparables — et le
// tout est CACHÉ 24 h par commune (DVF ne bouge que 2x/an), donc un échec ponctuel en
// amont ne casse plus la route une fois la commune réchauffée.
async function dvfMedian(insee) {
  return sharedCached(`dvfmed:${insee}`, 24 * 3600_000, async () => {
    const base = `${DVF}?code_insee=${insee}&page_size=250`;
    const ppm = [];
    let year = null;
    for (const an of [2024, 2023, 2022]) {
      const d = await fetch(`${base}&anneemut=${an}`, {
        headers: { "user-agent": "x402-farm" }, signal: AbortSignal.timeout(13_000),
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      for (const m of (d?.results || [])) {
        if (m.libnatmut && m.libnatmut !== "Vente") continue;
        const p = Number(m.valeurfonc), sb = Number(m.sbati);
        if (p > 10000 && sb > 9) { const v = p / sb; if (v > 400 && v < 15000) ppm.push(Math.round(v)); }
      }
      if (ppm.length) year = year || an;
      if (ppm.length >= 60) break;
    }
    if (ppm.length < 8) return null;
    return { median: median(ppm), sample: ppm.length, year };
  });
}

router.all("/v1/fr/biens-sous-cotes", async (req, res) => {
  const p = { ...req.query, ...(req.body || {}) };
  const city = p.city || p.ville || p.location;
  const cp = p.cp || p.postalCode || p.codePostal || null;
  const minGap = Math.min(Math.max(Number(p.minGap ?? 20) || 20, 0), 90); // décote minimale % pour être "candidat"
  const max = Math.min(Math.max(Number(p.max || p.maxResults || 40) || 40, 1), 60);
  if (!city) return res.status(400).json({ error: "missing_city", hint: "provide ?city= (&cp=, &minGap=20)" });

  const insee = p.insee || await inseeCode(String(city), cp);
  if (!insee) return res.status(404).json({ error: "city_not_resolved", hint: "unknown city — add ?cp=" });

  const [dvf, immoR] = await Promise.all([
    dvfMedian(insee),
    callWorker("/v1/fr/immo", { city, cp, max }, 90_000).catch((e) => ({ error: String(e).slice(0, 120) })),
  ]);
  const listings = immoR?.listings || [];
  // Le paiement x402 est déjà réglé quand on arrive ici : ne JAMAIS renvoyer une erreur
  // vide si on a quelque chose d'utile. Sans médiane DVF on livre les annonces + le motif.
  if (!dvf) {
    return res.json({
      source: "bienici (asking) x DVF (sold) — DEGRADED",
      degraded: true,
      reason: "DVF (official sold prices) unavailable for this commune right now — the upstream (Cerema) is slow/flaky. Retry in a few minutes: the median is cached 24h once computed.",
      query: { city, cp, insee, minGap },
      soldMedianPerM2: null,
      listingsAnalyzed: listings.length,
      candidatesCount: 0,
      listings: listings.slice(0, max),
    });
  }
  if (!listings.length) return res.status(502).json({ error: "no_listings", detail: immoR?.error || null });

  const soldMedian = dvf.median;
  const scored = listings
    .filter((l) => l.pricePerM2 && l.surface)
    .map((l) => ({
      type: l.type, rooms: l.rooms, surface: l.surface, price: l.price,
      pricePerM2: l.pricePerM2,
      gapPct: Math.round((l.pricePerM2 - soldMedian) / soldMedian * 100),
      postalCode: l.postalCode, url: l.url,
    }))
    .sort((a, b) => a.gapPct - b.gapPct);
  const candidates = scored.filter((l) => l.gapPct <= -minGap);

  res.json({
    source: "bienici (asking) x DVF (sold) x INSEE — free",
    query: { city, cp, insee, minGap },
    soldMedianPerM2: soldMedian,
    dvf: { sample: dvf.sample, year: dvf.year },
    listingsAnalyzed: scored.length,
    candidatesCount: candidates.length,
    note: "Candidates: listed at least minGap% below the commune's real sold median (DVF). Signal to investigate, not a guaranteed deal (check floor, condition, exact micro-location).",
    candidates,
  });
});

export default router;
