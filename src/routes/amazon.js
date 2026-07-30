// /v1/amazon — Amazon product & search scraper via the residential stealth browser.
// Amazon fingerprints headless bots; this route runs on the mini with playwright-extra
// stealth (forced via tryWorker forcePost). Two modes:
//   - product : ?asin= or ?url=  -> title, price, rating, reviews, brand, image
//   - search  : ?q=              -> up to ~20 products {asin, title, price, rating, url}
import { Router } from "express";
import { withStealthPage } from "../lib/browser.js";
import { tryWorker } from "../lib/worker-proxy.js";

const router = Router();
const DOMAIN = process.env.AMAZON_DOMAIN || "amazon.fr";

const clean = (s) => (s ? String(s).replace(/\s+/g, " ").trim() : null);
// Amazon sert amazon.fr en anglais au mini : les prix arrivent en "€75.05" (point
// décimal) alors que la locale FR donnerait "75,05 €". On accepte les deux : le dernier
// séparateur rencontré est le séparateur décimal s'il précède 1 à 2 chiffres finaux.
const priceVal = (s) => {
  if (!s) return null;
  const raw = String(s).replace(/[^\d.,]/g, "");
  if (!raw) return null;
  const m = raw.match(/^(.*?)([.,])(\d{1,2})$/);
  const n = m ? `${m[1].replace(/[.,]/g, "")}.${m[3]}` : raw.replace(/[.,]/g, "");
  const v = parseFloat(n);
  return Number.isFinite(v) ? v : null;
};

async function scrapeProduct(idOrUrl) {
  const url = /^https?:\/\//.test(idOrUrl) ? idOrUrl : `https://www.${DOMAIN}/dp/${idOrUrl}`;
  return withStealthPage(url, async (page) => {
    return page.evaluate(() => {
      const t = (sel) => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };
      // Amazon a changé son balisage (constaté le 2026-07-30) : ni ".a-price .a-offscreen"
      // ni ".a-price-whole" ne renvoient plus rien sur les pages de résultats. Le prix vit
      // dans un noeud FEUILLE de [data-cy="price-recipe"]. On cherche donc par le CONTENU
      // (un montant avec devise) plutôt que par une classe, et on écarte le prix barré
      // (.a-text-price = prix conseillé) pour ne pas vendre l'ancien prix.
      const CUR = /(?:€|\$|£)\s?\d[\d\s.,]*|\d[\d\s.,]*\s?(?:€|\$|£)/;
      const findPrice = (root) => {
        const scopes = [root.querySelector('[data-cy="price-recipe"]'), root].filter(Boolean);
        for (const scope of scopes) {
          const leaves = [...scope.querySelectorAll("*")].filter((n) => !n.children.length && CUR.test(n.textContent || ""));
          for (const n of leaves) {
            if (n.closest(".a-text-price")) continue;               // prix barré
            const m = (n.textContent || "").match(CUR);
            if (m) return m[0].replace(/\s+/g, " ").trim();
          }
        }
        return null;
      };
      // Les avis sont désormais dans [data-cy="reviews-block"], entre parenthèses et
      // parfois abrégés ("(51.4K)").
      const findReviews = (root) => {
        const b = root.querySelector('[data-cy="reviews-block"]') || root;
        const txt = (b.textContent || "").replace(/\s+/g, " ");
        const m = txt.match(/\(([\d.,]+)\s*([KMk])?\)/);
        if (!m) { const n = txt.match(/([\d.,]{2,})\s*(?:ratings|avis|évaluations)/i); return n ? parseInt(n[1].replace(/[.,]/g, ""), 10) || null : null; }
        const base = parseFloat(m[1].replace(",", "."));
        const mult = m[2] ? (m[2].toUpperCase() === "M" ? 1e6 : 1e3) : 1;
        return Number.isFinite(base) ? Math.round(base * mult) : null;
      };
      const priceRaw = t("#corePrice_feature_div .a-offscreen") || t(".a-price .a-offscreen")
        || findPrice(document.querySelector("#corePrice_feature_div") || document.querySelector("#centerCol") || document.body)
        || t("#priceblock_ourprice") || t(".a-price-whole");
      const ratingRaw = t("#acrPopover .a-icon-alt") || t("span[data-hook=rating-out-of-text]");
      const asin = (document.querySelector("input#ASIN") || {}).value
        || (location.pathname.match(/\/dp\/([A-Z0-9]{10})/) || [])[1] || null;
      return {
        asin,
        title: t("#productTitle"),
        price: priceRaw,
        rating: ratingRaw ? parseFloat(ratingRaw.replace(",", ".")) : null,
        reviews: (() => { const r = t("#acrCustomerReviewText"); return r ? parseInt(r.replace(/[^\d]/g, ""), 10) || null : null; })(),
        availability: (() => { const a = document.querySelector("#availability"); const txt = a ? a.textContent.replace(/\s+/g, " ").trim() : null; return txt && txt.length < 120 ? txt : null; })(),
        brand: t("#bylineInfo"),
        image: (document.querySelector("#landingImage") || {}).src || null,
        url: location.href.split("?")[0],
      };
    });
  }, { waitMs: 3000 });
}

async function scrapeSearch(q, max) {
  const url = `https://www.${DOMAIN}/s?k=${encodeURIComponent(q)}`;
  return withStealthPage(url, async (page) => {
    return page.evaluate((MAX) => {
      // Amazon a changé son balisage (constaté le 2026-07-30) : ni ".a-price .a-offscreen"
      // ni ".a-price-whole" ne renvoient plus rien sur les pages de résultats. Le prix vit
      // dans un noeud FEUILLE de [data-cy="price-recipe"]. On cherche donc par le CONTENU
      // (un montant avec devise) plutôt que par une classe, et on écarte le prix barré
      // (.a-text-price = prix conseillé) pour ne pas vendre l'ancien prix.
      const CUR = /(?:€|\$|£)\s?\d[\d\s.,]*|\d[\d\s.,]*\s?(?:€|\$|£)/;
      const findPrice = (root) => {
        const scopes = [root.querySelector('[data-cy="price-recipe"]'), root].filter(Boolean);
        for (const scope of scopes) {
          const leaves = [...scope.querySelectorAll("*")].filter((n) => !n.children.length && CUR.test(n.textContent || ""));
          for (const n of leaves) {
            if (n.closest(".a-text-price")) continue;               // prix barré
            const m = (n.textContent || "").match(CUR);
            if (m) return m[0].replace(/\s+/g, " ").trim();
          }
        }
        return null;
      };
      // Les avis sont désormais dans [data-cy="reviews-block"], entre parenthèses et
      // parfois abrégés ("(51.4K)").
      const findReviews = (root) => {
        const b = root.querySelector('[data-cy="reviews-block"]') || root;
        const txt = (b.textContent || "").replace(/\s+/g, " ");
        const m = txt.match(/\(([\d.,]+)\s*([KMk])?\)/);
        if (!m) { const n = txt.match(/([\d.,]{2,})\s*(?:ratings|avis|évaluations)/i); return n ? parseInt(n[1].replace(/[.,]/g, ""), 10) || null : null; }
        const base = parseFloat(m[1].replace(",", "."));
        const mult = m[2] ? (m[2].toUpperCase() === "M" ? 1e6 : 1e3) : 1;
        return Number.isFinite(base) ? Math.round(base * mult) : null;
      };
      const out = [];
      for (const el of document.querySelectorAll('div[data-asin][data-component-type="s-search-result"]')) {
        const asin = el.getAttribute("data-asin");
        if (!asin) continue;
        const t = (sel) => { const e = el.querySelector(sel); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };
        const price = findPrice(el) || t(".a-price .a-offscreen") || t(".a-price-whole");
        const ratingRaw = t(".a-icon-alt") || t('[data-cy="reviews-block"] .a-icon-alt');
        out.push({
          asin,
          title: t("h2 a span") || t("h2 span"),
          price,
          rating: ratingRaw ? parseFloat((ratingRaw.match(/[\d.,]+/) || [""])[0].replace(",", ".")) || null : null,
          reviews: findReviews(el),
          url: "https://www." + location.host.replace(/^www\./, "") + "/dp/" + asin,
        });
        if (out.length >= MAX) break;
      }
      return out;
    }, max);
  }, { waitMs: 3000 });
}

router.all("/v1/amazon", async (req, res) => {
  if (await tryWorker(req, res, { forcePost: true })) return; // stealth tourne sur le mini
  const p = { ...req.query, ...(req.body || {}) };
  const asin = p.asin || p.url;
  const q = p.q || p.query || p.search;
  const max = Math.min(Math.max(Number(p.max || p.maxResults || 20) || 20, 1), 60);
  try {
    if (asin) {
      const product = await scrapeProduct(String(asin));
      if (!product.title) return res.status(502).json({ error: "product_not_found", hint: "check the ASIN / URL" });
      return res.json({ source: DOMAIN, mode: "product", product: { ...product, priceValue: priceVal(product.price) } });
    }
    if (q) {
      const results = (await scrapeSearch(String(q), max)).map((r) => ({ ...r, priceValue: priceVal(r.price) }));
      if (!results.length) return res.status(502).json({ error: "no_results", query: q });
      return res.json({ source: DOMAIN, mode: "search", query: q, count: results.length, results });
    }
    return res.status(400).json({ error: "missing_input", hint: "provide ?asin= (or ?url=) for a product, or ?q= for a search" });
  } catch (e) {
    res.status(502).json({ error: "amazon_scrape_failed", detail: String(e).slice(0, 160) });
  }
});

export default router;
