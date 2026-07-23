// /v1/fr/immo — French real-estate listings (asking prices) from Bien'ici, via the
// residential stealth browser (forced to the mini). Pairs with our DVF sold-price data
// (/v1/fr/estimation-immo) to compare asking vs actually-sold €/m².
// Query: ?city= (&cp= &type=achat|location &max=)
import { Router } from "express";
import { withStealthPage } from "../lib/browser.js";
import { tryWorker } from "../lib/worker-proxy.js";

const router = Router();

const slug = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function median(arr) {
  const a = arr.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

async function scrapeBienici(city, cp, type, max) {
  const kind = type === "location" ? "location" : "achat";
  const place = cp ? `${slug(city)}-${cp}` : slug(city);
  const url = `https://www.bienici.com/recherche/${kind}/${place}`;
  const ads = await withStealthPage(url, async (page) => {
    await page.waitForSelector("article", { timeout: 12000 }).catch(() => {});
    return page.evaluate((MAX) => {
      const num = (s) => (s ? parseInt(String(s).replace(/[^\d]/g, ""), 10) || null : null);
      const out = [];
      for (const el of document.querySelectorAll("article")) {
        const txt = (el.innerText || "").replace(/\s+/g, " ").trim();
        if (!/€/.test(txt)) continue;
        const price = (txt.match(/([\d][\d\s]*)\s*€(?!\s*\/)/) || [])[1];
        const ppm2 = (txt.match(/([\d][\d\s]*)\s*€\s*\/\s*m²/) || [])[1];
        const surface = (txt.match(/(\d+)\s*m²/) || [])[1];
        const rooms = (txt.match(/(\d+)\s*pi[eè]ces?/) || [])[1];
        const cpm = (txt.match(/\b(\d{5})\b/) || [])[1];
        const t = (txt.match(/(Appartement|Maison|Studio|Terrain|Immeuble|Parking|Local|Loft|Villa|Ch[aâ]teau)/i) || [])[1];
        const a = el.querySelector("a[href]");
        let href = a ? a.getAttribute("href") : null;
        if (href && !/^https?:/.test(href)) href = "https://www.bienici.com" + href;
        out.push({
          type: t || null,
          rooms: rooms ? +rooms : null,
          surface: surface ? +surface : null,
          price: num(price),
          pricePerM2: num(ppm2),
          postalCode: cpm || null,
          url: href ? href.split("?")[0] : null,
        });
        if (out.length >= MAX) break;
      }
      return out;
    }, max);
  }, { waitMs: 4500 });
  return ads;
}

router.all("/v1/fr/immo", async (req, res) => {
  if (await tryWorker(req, res, { forcePost: true })) return; // stealth sur le mini
  const p = { ...req.query, ...(req.body || {}) };
  const city = p.city || p.ville || p.location;
  const cp = p.cp || p.postalCode || p.codePostal || null;
  const type = (p.type || "achat").toLowerCase();
  const max = Math.min(Math.max(Number(p.max || p.maxResults || 25) || 25, 1), 60);
  if (!city) return res.status(400).json({ error: "missing_city", hint: "provide ?city= (and optional ?cp=, ?type=achat|location)" });
  try {
    const listings = await scrapeBienici(String(city), cp, type, max);
    if (!listings.length) return res.status(502).json({ error: "no_listings", query: { city, cp, type }, hint: "no ads parsed (check city spelling / add ?cp=)" });
    const ppm2 = listings.map((l) => l.pricePerM2).filter(Boolean);
    const prices = listings.map((l) => l.price).filter(Boolean);
    res.json({
      source: "bienici.com", query: { city, cp, type }, count: listings.length,
      summary: {
        medianAskingPricePerM2: median(ppm2),
        minPrice: prices.length ? Math.min(...prices) : null,
        maxPrice: prices.length ? Math.max(...prices) : null,
        note: "Asking prices. Compare with sold prices via /v1/fr/estimation-immo (DVF).",
      },
      listings,
    });
  } catch (e) {
    res.status(502).json({ error: "immo_scrape_failed", detail: String(e).slice(0, 160) });
  }
});

export default router;
