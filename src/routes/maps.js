// /v1/maps — Google Maps local business scraper.
// Google bloque les IP datacenter : cette route est FORCÉE sur le mini résidentiel FR
// (tryWorker forcePost). Renvoie une liste de fiches (nom, note, avis, catégorie,
// adresse, téléphone, site web, URL Maps) pour une recherche activité + lieu.
//
// Deux passes, parce que le feed de résultats ne contient PAS tout :
//   1. feed  -> nom, note, catégorie, adresse courte, lien de réservation, mapsUrl, placeId
//   2. fiche -> avis, téléphone, site web, adresse complète (1 navigation / résultat)
// La passe 2 coûte ~2-3 s par fiche : elle est plafonnée (detailsMax) et
// désactivable (details=false) pour les gros volumes.
import { Router } from "express";
import { withPage } from "../lib/browser.js";
import { tryWorker } from "../lib/worker-proxy.js";

const router = Router();

const DETAILS_MAX_DEFAULT = 25;
const DETAILS_MAX_CAP = 60;

// --- passe 1 : le feed -------------------------------------------------------
// Exécutée dans la page. Les classes Google sont obfusquées et changent :
// on s'appuie autant que possible sur la structure (feuilles, séparateurs "·").
function extractFeed(MAX) {
  const out = [];
  // Lignes d'horaires à écarter quand on cherche la ligne "catégorie · adresse".
  const HOURS = /^(Ouvert|Ouvre|Ferm|Temporairement|Définitivement|24\s*h|Open|Clos)/i;

  for (const c of document.querySelectorAll('div[role="feed"] > div')) {
    const link = c.querySelector('a[href*="/maps/place/"]');
    if (!link) continue;
    const name = (link.getAttribute("aria-label") || "").trim();
    if (!name) continue;

    const rEl = c.querySelector(".MW4etd");
    const rating = rEl ? parseFloat(rEl.textContent.replace(",", ".")) || null : null;

    // Catégorie + adresse : la ligne ".W4Efsd" FEUILLE qui n'est ni le bloc note
    // ni les horaires. Format : "Salon de coiffure · €€ · 22 Rue des Carmes"
    // (le segment du milieu est souvent vide). Ancien bug : querySelector('.W4Efsd')
    // attrapait le 1er noeud de cette classe, qui contient la note -> catégorie = "4,7".
    let category = null;
    let address = null;
    const leaves = [...c.querySelectorAll(".W4Efsd")].filter((e) => !e.querySelector(".W4Efsd"));
    for (const el of leaves) {
      if (el.querySelector(".MW4etd")) continue; // bloc note
      const t = el.textContent.replace(/\u00a0/g, " ").trim();
      if (!t || HOURS.test(t)) continue;
      const parts = t.split("·").map((s) => s.trim()).filter(Boolean);
      if (!parts.length) continue;
      category = parts[0] || null;
      address = parts.length > 1 ? parts[parts.length - 1] : null;
      break;
    }

    // a.A1zNzb : lien d'action de la fiche. C'est presque toujours "Réserver en
    // ligne" (Planity, Shortcuts...) et PAS le site web -> on le classe d'après
    // son libellé. Le vrai site web n'est disponible que dans la passe 2.
    const act = c.querySelector("a.A1zNzb");
    let bookingUrl = null;
    let website = null;
    if (act) {
      const href = act.getAttribute("href") || null;
      if (/r[ée]serv|book|rendez-vous|prendre/i.test(act.textContent || "")) bookingUrl = href;
      else website = href;
    }

    const href = link.getAttribute("href") || "";
    // Le place id Google est encodé dans le lien : ...!19sChIJMWulaqDuBUgRo6LfGkPiJzI
    const pid = href.match(/!19s([^!?&]+)/);

    out.push({
      name,
      rating,
      reviews: null, // absent du feed -> passe 2
      category,
      address,
      phone: null, // absent du feed -> passe 2
      website,
      bookingUrl,
      placeId: pid ? decodeURIComponent(pid[1]) : null,
      mapsUrl: href.split("?")[0] || null,
    });
    if (out.length >= MAX) break;
  }
  return out;
}

// --- passe 2 : la fiche ------------------------------------------------------
function extractDetail() {
  const clean = (s) => (s || "").replace(/\u00a0/g, " ").trim() || null;

  // "Numéro de téléphone: 02 51 84 13 99" -> "02 51 84 13 99".
  // Repli sur data-item-id="phone:tel:0251841399" si le libellé change de langue.
  let phone = null;
  const phEl = document.querySelector('[data-item-id^="phone:tel:"]');
  if (phEl) {
    const al = clean(phEl.getAttribute("aria-label"));
    if (al && al.includes(":")) phone = clean(al.slice(al.indexOf(":") + 1));
    if (!phone) phone = clean(phEl.getAttribute("data-item-id").split("tel:")[1]);
  }

  const wEl = document.querySelector('a[data-item-id="authority"]');
  const website = wEl ? wEl.getAttribute("href") : null;

  // .F7nice = "4,7\n(335)" ; .jANrlb = "4,7\n335 avis"
  let reviews = null;
  let rating = null;
  const rBlock = document.querySelector(".F7nice") || document.querySelector(".jANrlb");
  if (rBlock) {
    const t = rBlock.innerText.replace(/\u00a0/g, " ");
    const par = t.match(/\(([\d\s.,]+)\)/) || t.match(/([\d\s.,]+)\s*avis/i) || t.match(/([\d\s.,]+)\s*review/i);
    if (par) reviews = parseInt(par[1].replace(/[^\d]/g, ""), 10) || null;
    const rt = t.match(/^\s*([\d],[\d]|[\d]\.[\d]|[\d])/);
    if (rt) rating = parseFloat(rt[1].replace(",", ".")) || null;
  }

  const addrEl = document.querySelector('button[data-item-id="address"]');
  let address = null;
  if (addrEl) {
    const al = clean(addrEl.getAttribute("aria-label"));
    address = al && al.includes(":") ? clean(al.slice(al.indexOf(":") + 1)) : clean(addrEl.innerText);
  }

  return {
    name: clean(document.querySelector("h1.DUwDvf")?.textContent),
    phone,
    website,
    reviews,
    rating,
    address,
    category: clean(document.querySelector("button.DkEaL")?.textContent),
  };
}

// Comparaison de noms tolérante (accents, ponctuation, casse) pour vérifier
// qu'on lit bien la fiche attendue.
function sameName(a, b) {
  const norm = (s) =>
    (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const k = Math.min(18, x.length, y.length);
  return k >= 6 && x.slice(0, k) === y.slice(0, k);
}

// Ouvre chaque fiche par son URL. On NE clique PAS dans le feed : Google le
// réordonne (annonces, personnalisation) entre deux navigations, donc l'index
// nth(i) ne correspond plus au snapshot de la passe 1 -> les téléphones se
// retrouvaient collés sur les mauvais commerces. La navigation par mapsUrl est
// déterministe, et le nom du panneau sert de garde-fou.
async function enrich(page, results, count) {
  let done = 0;
  for (let i = 0; i < count; i++) {
    const r = results[i];
    if (!r || !r.mapsUrl) continue;
    try {
      await page.goto(r.mapsUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForSelector("h1.DUwDvf", { timeout: 10000 });
      await page.waitForTimeout(450); // le panneau se remplit après le titre
      const d = await page.evaluate(extractDetail);
      // Mauvaise fiche (redirection, doublon Google) : on garde les nuls plutôt
      // que d'écrire des coordonnées fausses.
      if (!sameName(d.name, r.name)) continue;
      for (const [k, v] of Object.entries(d)) {
        if (k === "name") continue;
        if (v !== null && v !== undefined && v !== "") r[k] = v;
      }
      done++;
    } catch {
      /* fiche récalcitrante : on garde les données du feed */
    }
  }
  return done;
}

async function scrapeMaps(q, location, max, { details, detailsMax }) {
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

    const results = await page.evaluate(extractFeed, max);
    let enriched = 0;
    if (details && results.length) enriched = await enrich(page, results, Math.min(results.length, detailsMax));
    return { results, enriched };
  });
}

router.all("/v1/maps", async (req, res) => {
  // Doit tourner sur le mini résidentiel (Google bloque les datacenters).
  if (await tryWorker(req, res, { forcePost: true })) return;
  const p = { ...req.query, ...(req.body || {}) };
  const q = p.q || p.activity || p.query;
  const location = p.location || p.city || p.where || "";
  const max = Math.min(Math.max(Number(p.max || p.maxResults || 20) || 20, 1), 120);
  // details=false -> feed seul (rapide, mais sans téléphone/site/avis).
  const details = !(p.details === false || p.details === "false" || p.details === "0");
  const detailsMax = Math.min(Math.max(Number(p.detailsMax) || DETAILS_MAX_DEFAULT, 1), DETAILS_MAX_CAP);

  if (!q) return res.status(400).json({ error: "missing_query", hint: "provide ?q= (business type / keyword) and optional ?location=" });
  try {
    const { results, enriched } = await scrapeMaps(String(q), String(location), max, { details, detailsMax });
    if (!results.length) return res.status(502).json({ error: "no_results", query: { q, location }, hint: "Google Maps returned an empty feed (blocked or no match)." });
    res.json({
      source: "google_maps",
      query: { q, location },
      count: results.length,
      // Transparence : au-delà de `enriched`, phone/website/reviews restent nuls
      // (ces champs n'existent pas dans le feed, il faut ouvrir chaque fiche).
      enriched,
      results,
    });
  } catch (e) {
    res.status(502).json({ error: "maps_scrape_failed", detail: String(e).slice(0, 160) });
  }
});

export default router;
