import { Router } from "express";
import { assertPublicUrl } from "../lib/guard.js";
import { cached } from "../lib/cache.js";

// Aperçus GRATUITS : l'agent goûte, la version complète est payante.
// Volontairement légers (fetch simple, pas de navigateur) et très cachés.
const router = Router();

router.post("/free/extract", async (req, res) => {
  try {
    const url = await assertPublicUrl(req.body?.url);
    const data = await cached(`free-extract:${url}`, 30 * 60_000, async () => {
      const r = await fetch(url.href, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; x402-farm-preview)" },
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
      });
      const html = await r.text();
      const title = html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim() || null;
      const text = html
        .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { title, preview: text.slice(0, 300) };
    });
    res.json({
      url: url.href,
      ...data,
      note: "Free preview (static fetch, 300 chars). Full JS-rendered markdown: POST /v1/extract — $0.005 via x402.",
    });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || "upstream_error" });
  }
});

router.get("/free/entreprise", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ error: "missing_q" });
  try {
    const data = await cached(`free-ent:${q}`, 24 * 3600_000, async () => {
      const r = await fetch(
        `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&per_page=1`,
        { headers: { "user-agent": "x402-farm/0.1" }, signal: AbortSignal.timeout(10_000) }
      );
      if (!r.ok) throw Object.assign(new Error(`upstream_${r.status}`), { status: 502 });
      const raw = await r.json();
      const e = raw.results?.[0];
      return {
        total: raw.total_results,
        first: e ? { siren: e.siren, nom: e.nom_complet, ville: e.siege?.libelle_commune } : null,
      };
    });
    res.json({
      query: q,
      ...data,
      note: "Free preview (1 result, 3 fields). Full results with officers, NAF, HQ, status: GET /v1/fr/entreprise?q= — $0.02 via x402.",
    });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || "upstream_error" });
  }
});

export default router;
