// /v1/fr/leboncoin — annonces Leboncoin (le #1 des petites annonces FR), DataDome contourné.
// Leboncoin est protégé par DataDome : on passe par un web-unlocker (ZenRows) qui fournit une
// IP résidentielle FR + résout DataDome, puis on extrait les annonces du __NEXT_DATA__.
// Tourne sur Vercel (pas besoin du mini). Ce que les scrapers cloud ne sortent pas.
import { Router } from "express";

const router = Router();
const ZKEY = process.env.ZENROWS_API_KEY;

// Catégories Leboncoin usuelles (id numérique). Sinon passer ?category=<id>.
const CATS = {
  immobilier: "8", ventes_immobilieres: "9", locations: "10", colocations: "11",
  voitures: "2", motos: "3", utilitaires: "4", caravaning: "5",
  informatique: "15", telephonie: "17", electromenager: "20", meubles: "16",
  vetements: "22", bricolage: "24", jardinage: "25", velos: "50", emploi: "33",
};

function parseAd(a) {
  const price = Array.isArray(a.price) ? a.price[0] : (a.price ?? (a.price_cents ? a.price_cents / 100 : null));
  const attrs = {};
  for (const at of (a.attributes || [])) if (at.key && at.value_label) attrs[at.key] = at.value_label;
  return {
    id: a.list_id ?? null,
    title: a.subject || null,
    price: typeof price === "number" ? price : (price ? Number(price) : null),
    category: a.category_name || null,
    city: a.location?.city || null,
    zipcode: a.location?.zipcode || null,
    department: a.location?.department_name || null,
    region: a.location?.region_name || null,
    date: a.index_date || a.first_publication_date || null,
    url: a.url || (a.list_id ? `https://www.leboncoin.fr/ad/${a.list_id}` : null),
    thumbnail: a.images?.thumb_url || (a.images?.urls || [])[0] || null,
    nbImages: a.images?.nb_images ?? null,
    hasPhone: a.has_phone ?? null,
    sellerType: a.owner?.type || null,
    sellerName: a.owner?.name || null,
    attributes: attrs,
  };
}

function buildUrl({ text, category, city, zipcode }) {
  const q = new URLSearchParams();
  if (text) q.set("text", String(text));
  if (category) q.set("category", String(category));
  if (city || zipcode) q.set("locations", `${city ? String(city) : ""}${zipcode ? `_${zipcode}` : ""}`);
  return `https://www.leboncoin.fr/recherche?${q.toString()}`;
}

router.all("/v1/fr/leboncoin", async (req, res) => {
  if (!ZKEY) return res.status(503).json({ error: "unblocker_unconfigured", hint: "set ZENROWS_API_KEY" });
  const p = { ...req.query, ...(req.body || {}) };
  const text = p.text || p.q || p.keyword || "";
  const category = p.category ? (CATS[String(p.category).toLowerCase()] || String(p.category)) : null;
  const city = p.city || p.location || "";
  const zipcode = p.zipcode || p.cp || "";
  const limit = Math.min(Math.max(Number(p.limit || p.max || 35) || 35, 1), 100);
  if (!text && !category) return res.status(400).json({ error: "missing_input", hint: "provide ?text=<keyword> and/or ?category=&city=&zipcode=" });

  const target = buildUrl({ text, category, city, zipcode });
  const zr = `https://api.zenrows.com/v1/?apikey=${ZKEY}&url=${encodeURIComponent(target)}&js_render=true&antibot=true&premium_proxy=true&proxy_country=fr`;
  try {
    const r = await fetch(zr, { signal: AbortSignal.timeout(75000) });
    if (!r.ok) return res.status(502).json({ error: "unblocker_failed", status: r.status, detail: (await r.text()).slice(0, 160) });
    const html = await r.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return res.status(502).json({ error: "no_data", hint: "Leboncoin layout changed or blocked" });
    let ads = [];
    try { ads = JSON.parse(m[1])?.props?.pageProps?.searchData?.ads || []; } catch { /* */ }
    const total = (() => { try { return JSON.parse(m[1])?.props?.pageProps?.searchData?.total ?? null; } catch { return null; } })();
    const out = ads.slice(0, limit).map(parseAd);
    res.json({ source: "leboncoin.fr", query: { text, category, city, zipcode }, total, count: out.length, ads: out });
  } catch (e) {
    res.status(502).json({ error: "leboncoin_failed", detail: String(e).slice(0, 160) });
  }
});

export default router;
