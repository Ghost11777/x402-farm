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

// Essai GRATUIT entreprise-360 : identité de base seulement, le reste est payant.
router.get("/free/entreprise-360", async (req, res) => {
  const input = (req.query.q || req.query.siren || "").toString().trim();
  if (!input) return res.status(400).json({ error: "missing_q_or_siren" });
  try {
    const data = await cached(`free-e360:${input}`, 6 * 3600_000, async () => {
      const r = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(input)}&per_page=1`,
        { headers: { "user-agent": "x402-farm/0.1" }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw Object.assign(new Error(`upstream_${r.status}`), { status: 502 });
      const e = (await r.json()).results?.[0];
      if (!e) return { found: false };
      const key = (12 + 3 * (Number(e.siren) % 97)) % 97;
      return { found: true, siren: e.siren, nom: e.nom_complet, tva: `FR${String(key).padStart(2, "0")}${e.siren}`,
        ville: e.siege?.libelle_commune };
    });
    res.json({ ...data,
      note: "Free trial (identity only). Full report — officers, establishments, finances, BODACC legal notices, RGE — via GET /v1/fr/entreprise-360 ($0.05 x402).",
      locked: ["dirigeants", "etablissements", "finances", "annonces_legales", "rge"] });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || "upstream_error" });
  }
});

// Essai GRATUIT estimation-immo : juste la ville reconnue + prix médian arrondi, sans fourchette ni estimation.
router.get("/free/estimation-immo", async (req, res) => {
  const adresse = (req.query.adresse || "").toString().trim();
  if (!adresse) return res.status(400).json({ error: "missing_adresse" });
  try {
    const data = await cached(`free-avm:${adresse}`, 24 * 3600_000, async () => {
      const geo = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(adresse)}&limit=1`,
        { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
      const f = geo?.features?.[0];
      if (!f) return { found: false };
      const insee = f.properties.citycode;
      let rows = [];
      for (const an of [2024, 2023]) {
        const d = await fetch(`https://apidf-preprod.cerema.fr/dvf_opendata/mutations/?code_insee=${insee}&page_size=250&anneemut=${an}`,
          { headers: { "user-agent": "x402-farm/0.1" }, signal: AbortSignal.timeout(12_000) }).then((r) => r.json()).catch(() => null);
        if (d?.results?.length) { rows = d.results; break; }
      }
      const prixM2 = rows.filter((m) => m.libnatmut === "Vente" && Number(m.valeurfonc) && Number(m.sbati) >= 9)
        .map((m) => Number(m.valeurfonc) / Number(m.sbati)).filter((p) => p > 300 && p < 25000).sort((a, b) => a - b);
      return { found: true, ville: f.properties.city, insee,
        prix_m2_median: prixM2.length >= 5 ? Math.round(prixM2[Math.floor(prixM2.length / 2)] / 100) * 100 : null };
    });
    res.json({ ...data,
      note: "Free trial (rounded commune median only). Precise €/m² range, comparables count and value estimate for your surface via GET /v1/fr/estimation-immo ($0.08 x402)." });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || "upstream_error" });
  }
});

export default router;
