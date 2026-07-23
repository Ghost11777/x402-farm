// /v1/fr/leboncoin — annonces Leboncoin via l'API interne mobile + cookie DataDome récolté.
// Leboncoin (site ET api mobile) est protégé par DataDome. La parade GRATUITE :
// un humain résout le captcha UNE fois sur le mini (worker/leboncoin-harvest.mjs), on
// stocke le cookie `datadome` (lié à l'IP résidentielle du mini), et cette route le rejoue
// pour interroger api.leboncoin.fr/finder/search (JSON structuré). Forcée sur le mini.
import { Router } from "express";
import { readFileSync } from "node:fs";
import { tryWorker } from "../lib/worker-proxy.js";

const router = Router();
const COOKIE_FILE = process.env.LEBONCOIN_COOKIE_FILE || "./worker/.leboncoin-cookie.json";
const API = "https://api.leboncoin.fr/finder/search";
const API_KEY = process.env.LEBONCOIN_API_KEY || "ba0c2dad52b3ec";

// Catégories Leboncoin usuelles (id numérique). Sinon passer ?category=<id> directement.
const CATS = {
  immobilier: "8", ventes_immobilieres: "9", locations: "10", colocations: "11",
  voitures: "2", motos: "3", utilitaires: "4", caravaning: "5",
  emploi: "33", "prestations de services": "33",
  informatique: "15", telephonie: "17", electromenager: "20", meubles: "16",
  vetements: "22", bricolage: "24", jardinage: "25", velos: "50",
};

function readCookie() {
  try {
    const d = JSON.parse(readFileSync(COOKIE_FILE, "utf8"));
    if (!d.cookies || !d.cookies.length) return null;
    return d;
  } catch { return null; }
}

function parseAd(a) {
  const price = Array.isArray(a.price) ? a.price[0] : (a.price ?? null);
  const attrs = {};
  for (const at of (a.attributes || [])) if (at.key && at.value_label) attrs[at.key] = at.value_label;
  return {
    id: a.list_id || a.ad_id || null,
    title: a.subject || null,
    price: typeof price === "number" ? price : (price ? Number(price) : null),
    priceLabel: a.price_calendar || null,
    category: a.category_name || null,
    city: a.location?.city || null,
    zipcode: a.location?.zipcode || null,
    department: a.location?.department_name || null,
    date: a.index_date || a.first_publication_date || null,
    url: a.url || (a.list_id ? `https://www.leboncoin.fr/ad/${a.list_id}` : null),
    thumbnail: a.images?.thumb_url || (a.images?.urls || [])[0] || null,
    nbImages: a.images?.nb_images ?? null,
    attributes: attrs,
    owner: a.owner ? { type: a.owner.type || null, name: a.owner.name || null } : null,
  };
}

router.all("/v1/fr/leboncoin", async (req, res) => {
  if (await tryWorker(req, res, { forcePost: true })) return; // cookie + IP résidentielle = sur le mini
  const p = { ...req.query, ...(req.body || {}) };
  const text = p.text || p.q || p.keyword || "";
  const category = p.category ? (CATS[String(p.category).toLowerCase()] || String(p.category)) : null;
  const city = p.city || p.location || "";
  const zipcode = p.zipcode || p.cp || "";
  const limit = Math.min(Math.max(Number(p.limit || p.max || 20) || 20, 1), 100);
  if (!text && !category) return res.status(400).json({ error: "missing_input", hint: "provide ?text=<keyword> and/or ?category=&city=&zipcode=" });

  const ck = readCookie();
  if (!ck) return res.status(503).json({ error: "leboncoin_cookie_missing", hint: "run `node worker/leboncoin-harvest.mjs` on the mini to solve the captcha once" });

  const filters = { enums: {}, ranges: {}, keywords: {}, location: {} };
  if (text) filters.keywords.text = String(text);
  if (category) filters.category = { id: String(category) };
  if (city || zipcode) filters.location.locations = [{ locationType: "city", ...(city ? { city: String(city), label: String(city) } : {}), ...(zipcode ? { zipcode: String(zipcode) } : {}) }];

  const cookieHeader = ck.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": ck.ua || "LBC;Android;13;Pixel;phone;abc;wifi;8.0.0;0;1",
        "api_key": API_KEY,
        "cookie": cookieHeader,
      },
      body: JSON.stringify({ filters, limit, offset: 0, sort_by: "time", sort_order: "desc" }),
      signal: AbortSignal.timeout(20000),
    });
    if (r.status === 403 || r.status === 401) {
      return res.status(502).json({ error: "leboncoin_blocked", hint: "DataDome cookie expired — re-run worker/leboncoin-harvest.mjs on the mini", status: r.status });
    }
    const d = await r.json();
    const ads = (d.ads || []).map(parseAd);
    res.json({ source: "leboncoin.fr", query: { text, category, city, zipcode }, total: d.total ?? ads.length, count: ads.length, ads });
  } catch (e) {
    res.status(502).json({ error: "leboncoin_failed", detail: String(e).slice(0, 160) });
  }
});

export default router;
