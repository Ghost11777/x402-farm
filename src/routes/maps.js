// /v1/maps — Google Maps local business scraper.
// Google bloque les IP datacenter : cette route est FORCÉE sur le mini résidentiel FR
// (tryWorker forcePost). Renvoie une liste de fiches (nom, note, avis, catégorie,
// téléphone, site web, URL Maps) pour une recherche activité + lieu.
import { Router } from "express";
import { withPage } from "../lib/browser.js";
import { tryWorker } from "../lib/worker-proxy.js";

const router = Router();

async function scrapeMaps(q, location, max) {
  const query = `${q} ${location}`.trim();
  const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=fr`;
  return withPage(url, async (page) => {
    await page.waitForSelector('div[role="feed"]', { timeout: 15000 }).catch(() => {});
    // Scroll du feed pour charger jusqu'à `max` fiches (Google lazy-load par ~20).
    for (let i = 0; i < 12; i++) {
      const n = await page.evaluate(() => document.querySelectorAll('div[role="feed"] a[href*="/maps/place/"]').length);
      if (n >= max) break;
      await page.evaluate(() => {
        const f = document.querySelector('div[role="feed"]');
        if (f) f.scrollTop = f.scrollHeight;
      });
      await page.waitForTimeout(1300);
    }
    return page.evaluate((MAX) => {
      const digits = (s) => (s ? parseInt(String(s).replace(/[^\d]/g, ""), 10) || null : null);
      const out = [];
      for (const c of document.querySelectorAll('div[role="feed"] > div')) {
        const link = c.querySelector('a[href*="/maps/place/"]');
        if (!link) continue;
        const name = (link.getAttribute("aria-label") || "").trim();
        if (!name) continue;
        const rEl = c.querySelector(".MW4etd");
        const rating = rEl ? parseFloat(rEl.textContent.replace(",", ".")) || null : null;
        const rvEl = c.querySelector(".UY7F9");
        const reviews = rvEl ? digits(rvEl.textContent) : null;
        const w4 = c.querySelector(".W4Efsd");
        let category = null;
        if (w4) category = (w4.textContent.split("·")[0] || "").replace(/Ouvert.*$/i, "").replace(/Ferm[ée].*$/i, "").trim() || null;
        const txt = c.innerText || "";
        const pm = txt.match(/0\d(?:[ .]\d{2}){4}/);
        const phEl = c.querySelector(".UsdlK");
        const phone = (phEl ? phEl.textContent.trim() : null) || (pm ? pm[0].replace(/\s+/g, " ") : null);
        const siteEl = c.querySelector('a[data-value="Site Web"], a[aria-label*="Site Web"]');
        out.push({
          name, rating, reviews, category, phone,
          website: siteEl ? siteEl.getAttribute("href") : null,
          mapsUrl: (link.getAttribute("href") || "").split("?")[0] || null,
        });
        if (out.length >= MAX) break;
      }
      return out;
    }, max);
  });
}

router.all("/v1/maps", async (req, res) => {
  // Doit tourner sur le mini résidentiel (Google bloque les datacenters).
  if (await tryWorker(req, res, { forcePost: true })) return;
  const p = { ...req.query, ...(req.body || {}) };
  const q = p.q || p.activity || p.query;
  const location = p.location || p.city || p.where || "";
  const max = Math.min(Math.max(Number(p.max || p.maxResults || 20) || 20, 1), 120);
  if (!q) return res.status(400).json({ error: "missing_query", hint: "provide ?q= (business type / keyword) and optional ?location=" });
  try {
    const results = await scrapeMaps(String(q), String(location), max);
    if (!results.length) return res.status(502).json({ error: "no_results", query: { q, location }, hint: "Google Maps returned an empty feed (blocked or no match)." });
    res.json({ source: "google_maps", query: { q, location }, count: results.length, results });
  } catch (e) {
    res.status(502).json({ error: "maps_scrape_failed", detail: String(e).slice(0, 160) });
  }
});

export default router;
