// /v1/fr/seloger — annonces immobilières SeLoger (DataDome contourné via ZenRows).
// Comme Leboncoin : ZenRows fournit l'IP résidentielle FR + résout DataDome. Tourne sur Vercel.
// Résout la ville -> code INSEE (geo.api.gouv.fr), interroge SeLoger, parse les cartes (cheerio).
// Query: ?city= (&cp= &type=achat|location &max=)
import { Router } from "express";
import * as cheerio from "cheerio";

const router = Router();
const ZKEY = process.env.ZENROWS_API_KEY;

function median(arr) {
  const a = arr.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}
const digits = (s) => (s ? parseInt(String(s).replace(/[^\d]/g, ""), 10) || null : null);

async function inseeCode(city, cp) {
  try {
    const u = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(city)}${cp ? `&codePostal=${cp}` : ""}&fields=code,nom&limit=1`;
    const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    return d[0]?.code || null;
  } catch { return null; }
}

function parseCards(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('[data-testid="sl.explore.card-container"]').each((_, el) => {
    const $c = $(el);
    const priceTxt = $c.find('[data-testid="sl.explore-card-price"]').first().text();
    const price = digits((priceTxt.match(/^\s*([\d\s]+)\s*€/) || [])[1]); // 1er montant = prix
    const ppm2 = digits((priceTxt.match(/€\s*([\d\s]+)\s*€\s*le\s*m²/) || priceTxt.match(/([\d\s]+)\s*€\s*le\s*m²/) || [])[1]);
    const text = $c.text().replace(/\s+/g, " ");
    const surface = (text.match(/(\d+)\s*m²/) || [])[1];
    const rooms = (text.match(/(\d+)\s*pi[èe]ces?/) || [])[1];
    const type = (text.match(/(Appartement|Maison|Studio|Terrain|Immeuble|Villa|Loft|Parking|Local|Ch[aâ]teau)/i) || [])[1];
    let url = $c.find('a[href*="/annonces/"]').attr("href") || null;
    if (url && !/^https?:/.test(url)) url = "https://www.seloger.com" + url;
    if (price == null && !surface) return; // carte non-annonce (pub, etc.)
    out.push({
      type: type || null,
      rooms: rooms ? +rooms : null,
      surface: surface ? +surface : null,
      price,
      pricePerM2: ppm2,
      url,
    });
  });
  return out;
}

router.all("/v1/fr/seloger", async (req, res) => {
  if (!ZKEY) return res.status(503).json({ error: "unblocker_unconfigured", hint: "set ZENROWS_API_KEY" });
  const p = { ...req.query, ...(req.body || {}) };
  const city = p.city || p.ville || p.location;
  const cp = p.cp || p.postalCode || p.codePostal || null;
  const type = (p.type || "achat").toLowerCase();
  const max = Math.min(Math.max(Number(p.max || p.maxResults || 25) || 25, 1), 60);
  if (!city) return res.status(400).json({ error: "missing_city", hint: "provide ?city= (&cp=, &type=achat|location)" });

  const code = (p.insee || p.inseeCode) || await inseeCode(String(city), cp);
  if (!code) return res.status(404).json({ error: "city_not_resolved", hint: "unknown city — try adding ?cp=" });

  const projects = type === "location" ? "1" : "2";
  const target = `https://www.seloger.com/list.htm?projects=${projects}&types=1,2&places=[{"inseeCodes":[${code}]}]&mandatorycommodities=0&enterprise=0&qsVersion=1.0`;
  const zr = `https://api.zenrows.com/v1/?apikey=${ZKEY}&url=${encodeURIComponent(target)}&js_render=true&antibot=true&premium_proxy=true&proxy_country=fr`;
  try {
    const r = await fetch(zr, { signal: AbortSignal.timeout(75000) });
    if (!r.ok) return res.status(502).json({ error: "unblocker_failed", status: r.status, detail: (await r.text()).slice(0, 160) });
    const listings = parseCards(await r.text()).slice(0, max);
    if (!listings.length) return res.status(502).json({ error: "no_listings", query: { city, cp, type }, hint: "SeLoger layout may have changed" });
    const ppm2 = listings.map((l) => l.pricePerM2).filter(Boolean);
    const prices = listings.map((l) => l.price).filter(Boolean);
    res.json({
      source: "seloger.com", query: { city, cp, type, insee: code }, count: listings.length,
      summary: {
        medianAskingPricePerM2: median(ppm2),
        minPrice: prices.length ? Math.min(...prices) : null,
        maxPrice: prices.length ? Math.max(...prices) : null,
        note: "Asking prices. Compare with sold prices via /v1/fr/estimation-immo (DVF).",
      },
      listings,
    });
  } catch (e) {
    res.status(502).json({ error: "seloger_failed", detail: String(e).slice(0, 160) });
  }
});

export default router;
