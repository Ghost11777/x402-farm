// /v1/fr/marches-publics — appels d'offres publics français (BOAMP), en direct.
// L'ANGLE : les autres endpoints aident un agent à trouver des CLIENTS ou à vérifier un
// tiers ; celui-ci lui fait trouver des OPPORTUNITÉS DE REVENU (contrats publics à remporter).
// Nouveau type d'acheteur agent : le bot business-dev / veille marchés qui scanne en boucle
// par mot-clé + département, chaque jour. Source 100% publique (BOAMP), directe (pas de mini).
import { Router } from "express";
import { cached } from "../lib/cache.js";

const router = Router();
const BOAMP = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";

const S = (v) => (v == null ? null : String(v).replace(/\s+/g, " ").trim() || null);

router.all("/v1/fr/marches-publics", async (req, res) => {
  const p = { ...req.query, ...(req.body || {}) };
  const kw = S(p.q || p.mot || p.keyword || "");
  const dept = S(p.departement || p.dept || p.cp)?.replace(/\D/g, "").slice(0, 3) || null;
  // actif=true (défaut) : seulement les AO dont la date limite de réponse n'est pas passée.
  const actif = String(p.actif ?? "true").toLowerCase() !== "false";
  const max = Math.min(Math.max(Number(p.max || p.limit || 20) || 20, 1), 50);
  // Tri : "deadline" (échéance la plus proche = la plus actionnable) ou "recent" (parution).
  const recent = String(p.order || p.tri || "deadline").toLowerCase() === "recent";

  // Clause WHERE ODS : recherche plein-texte sur l'objet + filtre "encore ouvert".
  const parts = [];
  if (kw) parts.push(`search(objet, "${kw.replace(/"/g, '\\"')}")`);
  if (actif) parts.push("datelimitereponse>now()");
  const where = parts.join(" AND ");

  const u = new URL(BOAMP);
  u.searchParams.set("limit", String(max));
  if (where) u.searchParams.set("where", where);
  u.searchParams.set("order_by", recent ? "dateparution desc" : "datelimitereponse asc");
  if (dept) u.searchParams.set("refine", `code_departement:"${dept}"`);

  try {
    const key = `marches:${kw || "*"}:${dept || "*"}:${actif}:${recent}:${max}`;
    const data = await cached(key, 30 * 60_000, async () => {
      const r = await fetch(u, {
        headers: { "user-agent": "x402-farm/0.1", accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw Object.assign(new Error(`boamp_${r.status}`), { status: 502 });
      const j = await r.json();
      const now = Date.now();
      const tenders = (j.results || []).map((t) => {
        const dl = t.datelimitereponse ? new Date(t.datelimitereponse) : null;
        const daysLeft = dl ? Math.round((dl.getTime() - now) / 86_400_000) : null;
        return {
          id: t.idweb || null,
          url: t.idweb ? `https://www.boamp.fr/pages/avis/?q=idweb:${encodeURIComponent(t.idweb)}` : null,
          buyer: S(t.nomacheteur),
          object: S(t.objet),
          departments: Array.isArray(t.code_departement) ? t.code_departement : (t.code_departement ? [t.code_departement] : []),
          type: S(t.famille_libelle) || S(t.type_marche),
          nature: S(t.nature_libelle) || S(t.type_avis_libelle),
          published: t.dateparution || null,
          deadline: t.datelimitereponse || null,
          daysLeft,
        };
      });
      return {
        source: "BOAMP — French public procurement (official, data.gouv)",
        query: { q: kw || null, departement: dept, actif, order: recent ? "recent" : "deadline" },
        total: j.total_count ?? null,
        count: tenders.length,
        note: "Live public tenders. `total` = all matches; `count` = returned. daysLeft counts down to the response deadline. Loop by keyword+department for continuous BD/opportunity monitoring.",
        tenders,
      };
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || "boamp_error" });
  }
});

export default router;
