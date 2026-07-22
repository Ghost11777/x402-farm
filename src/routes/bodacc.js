import { Router } from "express";
import { cached } from "../lib/cache.js";

// /fr/procedures-collectives : la question B2B n°1 avant de signer —
// « cette entreprise est-elle en procédure collective (sauvegarde/RJ/LJ) ? »
// Source : BODACC (annonces officielles), API opendatasoft publique.
const router = Router();
const BODACC = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";

async function bodacc(where, limit) {
  const u = `${BODACC}?where=${encodeURIComponent(where)}&order_by=dateparution%20desc&limit=${limit}`;
  const r = await fetch(u, { signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw Object.assign(new Error(`bodacc_${r.status}`), { status: 502 });
  return r.json();
}

const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

router.all("/v1/fr/procedures-collectives", async (req, res) => {
  const siren = (req.query.siren || "").toString().replace(/\D/g, "");
  if (siren.length !== 9) return res.status(400).json({ error: "siren_must_be_9_digits" });
  try {
    const data = await cached(`bodacc-pc:${siren}`, 12 * 3600_000, async () => {
      const [pc, rad] = await Promise.all([
        bodacc(`registre like "${siren}" and familleavis="collective"`, 20),
        bodacc(`registre like "${siren}" and familleavis="radiation"`, 1),
      ]);
      const procedures = (pc.results || []).map((r) => {
        const j = parseJson(r.jugement) || {};
        return {
          date_jugement: j.date || null,
          famille: j.famille || null,
          nature: j.nature || null,
          complement: j.complementJugement || null,
          tribunal: r.tribunal || null,
          date_parution: r.dateparution,
          annonce: r.url_complete || null,
        };
      });
      // Statut synthétique : le jugement le plus récent fait foi.
      // clôture/plan arrêté = sortie de procédure ; ouverture/conversion/extension = en cours.
      let statut = "aucune_procedure";
      if (procedures.length) {
        const dernier = `${procedures[0].famille || ""} ${procedures[0].nature || ""}`.toLowerCase();
        statut = /cl[oô]ture|arr[eê]t du plan|homologation/.test(dernier)
          ? "procedure_cloturee"
          : "procedure_en_cours";
      }
      const radie = (rad.results || []).length > 0;
      const denomination =
        (pc.results?.[0] || rad.results?.[0])?.commercant || null;
      return {
        siren,
        denomination,
        statut,
        alerte: statut === "procedure_en_cours" || radie,
        radiee_rcs: radie,
        annonces_collectives: pc.total_count || 0,
        procedures,
        source: "BODACC (Bulletin officiel des annonces civiles et commerciales)",
      };
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || "bodacc_error" });
  }
});

export default router;
