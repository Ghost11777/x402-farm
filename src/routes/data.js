import { Router } from "express";
import dns from "node:dns/promises";
import { cached } from "../lib/cache.js";

const router = Router();

async function proxyJson(res, cacheKey, ttlMs, url, transform = (x) => x) {
  try {
    const data = await cached(cacheKey, ttlMs, async () => {
      const r = await fetch(url, { headers: { "user-agent": "x402-farm/0.1" }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw Object.assign(new Error(`upstream_${r.status}`), { status: 502 });
      return transform(await r.json());
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || "upstream_error" });
  }
}

// Entreprises françaises : recherche par nom ou SIREN/SIRET (source : recherche-entreprises.api.gouv.fr)
router.all("/v1/fr/entreprise", (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ error: "missing_q" });
  proxyJson(
    res, `ent:${q}`, 24 * 3600_000,
    `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&per_page=10`,
    (raw) => ({
      query: q,
      total: raw.total_results,
      results: (raw.results || []).map((e) => ({
        siren: e.siren,
        nom: e.nom_complet,
        naf: e.activite_principale,
        etat: e.etat_administratif,
        creation: e.date_creation,
        effectif: e.tranche_effectif_salarie,
        siege: e.siege ? { siret: e.siege.siret, adresse: e.siege.adresse, cp: e.siege.code_postal, ville: e.siege.libelle_commune } : null,
        dirigeants: (e.dirigeants || []).map((d) => ({ nom: d.nom, prenoms: d.prenoms, qualite: d.qualite, denomination: d.denomination })),
      })),
    })
  );
});

// Géocodage France + DOM (source : Base Adresse Nationale)
router.all("/v1/fr/geocode", (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ error: "missing_q" });
  proxyJson(
    res, `geo:${q}`, 7 * 24 * 3600_000,
    `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=5`,
    (raw) => ({
      query: q,
      results: (raw.features || []).map((f) => ({
        label: f.properties.label,
        score: f.properties.score,
        type: f.properties.type,
        cp: f.properties.postcode,
        ville: f.properties.city,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      })),
    })
  );
});

// DNS complet d'un domaine
router.all("/v1/dns", async (req, res) => {
  const domain = (req.query.domain || "").toString().trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return res.status(400).json({ error: "invalid_domain" });
  const data = await cached(`dns:${domain}`, 3600_000, async () => {
    const grab = (p) => p.then((v) => v).catch(() => null);
    const [a, aaaa, mx, txt, ns, cname] = await Promise.all([
      grab(dns.resolve4(domain)), grab(dns.resolve6(domain)), grab(dns.resolveMx(domain)),
      grab(dns.resolveTxt(domain)), grab(dns.resolveNs(domain)), grab(dns.resolveCname(domain)),
    ]);
    return { domain, a, aaaa, mx, txt: txt?.map((t) => t.join("")), ns, cname,
      spf: txt?.map((t) => t.join("")).find((t) => t.startsWith("v=spf1")) || null };
  });
  res.json(data);
});

// Validation email : syntaxe + existence du domaine + MX (aucun envoi)
router.all("/v1/email/validate", async (req, res) => {
  const email = (req.query.email || "").toString().trim().toLowerCase();
  const syntaxOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  if (!syntaxOk) return res.json({ email, valid: false, reason: "syntax" });
  const domain = email.split("@")[1];
  const data = await cached(`emailv:${domain}`, 3600_000, async () => {
    const mx = await dns.resolveMx(domain).catch(() => null);
    return { hasMx: !!mx?.length, mx: mx?.sort((x, y) => x.priority - y.priority)[0]?.exchange || null };
  });
  res.json({ email, valid: data.hasMx, reason: data.hasMx ? null : "no_mx", mx: data.mx, disposable: null });
});

export default router;
