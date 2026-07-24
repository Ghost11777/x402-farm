// /v1/unblock — débloque n'importe quelle URL protégée anti-bot (DataDome, Cloudflare…)
// et renvoie le contenu propre. On vend la CAPACITÉ, pas la donnée : les devs bloqués
// sur exactement ça paient. Résidentiel + résolution du challenge via ZenRows.
// Query: ?url= (&country=fr &render=true &format=html|text|markdown)
import { Router } from "express";

const router = Router();
const ZKEY = process.env.ZENROWS_API_KEY;

function toText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

router.all("/v1/unblock", async (req, res) => {
  if (!ZKEY) return res.status(503).json({ error: "unblocker_unconfigured" });
  const p = { ...req.query, ...(req.body || {}) };
  const url = p.url;
  if (!url || !/^https?:\/\//.test(String(url))) return res.status(400).json({ error: "missing_url", hint: "provide ?url=https://..." });
  const country = (p.country || "fr").toLowerCase();
  const render = p.render === undefined ? true : (p.render === "true" || p.render === true);
  const format = (p.format || "html").toLowerCase();

  const zr = `https://api.zenrows.com/v1/?apikey=${ZKEY}&url=${encodeURIComponent(String(url))}`
    + `&antibot=true&premium_proxy=true&proxy_country=${encodeURIComponent(country)}${render ? "&js_render=true" : ""}`;
  try {
    const r = await fetch(zr, { signal: AbortSignal.timeout(75000) });
    if (!r.ok) return res.status(502).json({ error: "unblock_failed", status: r.status, detail: (await r.text()).slice(0, 160) });
    const html = await r.text();
    if (format === "text") return res.json({ url, format: "text", content: toText(html) });
    if (format === "markdown") {
      // markdown léger : titres + texte (extraction propre = utiliser /v1/extract-structured)
      const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || null;
      return res.json({ url, format: "markdown", title, content: toText(html).slice(0, 20000) });
    }
    res.json({ url, format: "html", bytes: html.length, html });
  } catch (e) {
    res.status(502).json({ error: "unblock_failed", detail: String(e).slice(0, 160) });
  }
});

export default router;
