import { Router } from "express";
import { cached } from "../lib/cache.js";
import { tryWorker } from "../lib/worker-proxy.js";

// /fr/bilans : comptes annuels & données financières via l'API INPI RNE.
// FRICTION RÉELLE : l'endpoint exige un compte INPI avec accès API activé
// (login -> token). L'agent n'a pas ce compte ; nous oui.
const router = Router();
const INPI = "https://registre-national-entreprises.inpi.fr/api";

let tokenCache = { token: null, expires: 0 };
// Anti-verrouillage : si le login échoue (mauvais mdp, compte bloqué…), on cesse
// TOUTE tentative pendant ce délai. Évite de marteler l'INPI et d'aggraver un blocage.
let loginBlockedUntil = 0;

async function getToken() {
  if (tokenCache.token && tokenCache.expires > Date.now()) return tokenCache.token;
  if (Date.now() < loginBlockedUntil) {
    throw Object.assign(new Error("inpi_login_cooldown"), { status: 503 });
  }
  const u = process.env.INPI_USERNAME, p = process.env.INPI_PASSWORD;
  if (!u || !p) throw Object.assign(new Error("inpi_not_configured"), { status: 503 });
  let r;
  try {
    r = await fetch(`${INPI}/sso/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e) {
    loginBlockedUntil = Date.now() + 15 * 60_000; // réseau KO : on souffle 15 min
    throw Object.assign(new Error("inpi_login_unreachable"), { status: 502 });
  }
  if (!r.ok) {
    // login refusé -> backoff 15 min (ne PAS retenter à chaque requête)
    loginBlockedUntil = Date.now() + 15 * 60_000;
    throw Object.assign(new Error("inpi_login_failed"), { status: 502 });
  }
  const { token } = await r.json();
  tokenCache = { token, expires: Date.now() + 50 * 60_000 };
  return token;
}

async function inpiGet(path) {
  const token = await getToken();
  const r = await fetch(`${INPI}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 401) {
    tokenCache = { token: null, expires: 0 };
    throw Object.assign(new Error("inpi_unauthorized"), { status: 502 });
  }
  if (!r.ok) throw Object.assign(new Error(`inpi_${r.status}`), { status: r.status === 404 ? 404 : 502 });
  return r.json();
}

// Codes liasse fiscale FR (confirmés empiriquement) -> libellé
const LIASSE = {
  FJ: "chiffre_affaires_net",
  FR: "total_produits_exploitation",
  GF: "total_charges_exploitation",
  GW: "resultat_exploitation",
  GU: "resultat_courant_avant_impot",
  GV: "resultat_exceptionnel",
  CO: "total_bilan",
};
const num = (s) => {
  if (s == null) return null;
  const n = Number(String(s).replace(/^(-?)0+(?=\d)/, "$1"));
  return Number.isFinite(n) ? n : null;
};

// Extrait les postes clés d'un "bilan saisi" (structure INPI : pages -> liasses code/m3)
function parseBilanSaisi(bs) {
  const b = bs?.bilanSaisi?.bilan;
  if (!b) return null;
  const codes = {};
  for (const p of b.detail?.pages || []) {
    for (const l of p.liasses || []) codes[l.code] = l;
  }
  const financials = {};
  for (const [code, label] of Object.entries(LIASSE)) {
    const v = num(codes[code]?.m3); // m3 = montant net exercice N
    if (v !== null && v !== 0) financials[label] = v;
  }
  return {
    date_cloture: b.identite?.dateClotureExercice,
    duree_mois: Number(b.identite?.dureeExerciceN) || null,
    devise: b.identite?.codeDevise,
    type_bilan: bs.typeBilan,
    confidentiel: bs.confidentiality !== "Public",
    financials,
  };
}

// GET /v1/fr/bilans?siren=  -> identité + comptes annuels déposés + données financières
router.all("/v1/fr/bilans", async (req, res) => {
  const siren = (req.query.siren || "").toString().replace(/\D/g, "");
  if (siren.length !== 9) return res.status(400).json({ error: "siren_must_be_9_digits" });
  // Sur Vercel : déléguer au Mac mini (IP résidentielle FR, l'INPI tolère mal les
  // IP datacenter). Fallback local si le worker est injoignable, pas encore à jour
  // (404) ou sans credentials INPI (503).
  if (await tryWorker(req, res, { fallbackStatuses: [404, 503] })) return;
  try {
    const data = await cached(`bilans:${siren}`, 24 * 3600_000, async () => {
      const [company, attachments] = await Promise.all([
        inpiGet(`/companies/${siren}`).catch(() => null),
        inpiGet(`/companies/${siren}/attachments`).catch(() => ({})),
      ]);
      const content = company?.formality?.content || {};
      const identite = content.personneMorale?.identite?.entreprise || {};

      const bilansSaisis = attachments.bilansSaisis || [];
      const bilansPdf = attachments.bilans || [];

      // Données financières structurées, du plus récent au plus ancien
      const exercices = bilansSaisis
        .map(parseBilanSaisi)
        .filter(Boolean)
        .sort((a, b) => (b.date_cloture || "").localeCompare(a.date_cloture || ""));

      return {
        siren,
        denomination: identite.denomination || bilansSaisis[0]?.denomination || bilansPdf[0]?.denomination || null,
        forme_juridique: identite.formeJuridique || null,
        comptes_annuels_deposes: bilansPdf.length,
        dernier_depot: bilansPdf[0]?.dateDepot || null,
        exercices: exercices.slice(0, 5), // 5 derniers exercices avec chiffres
        source: "INPI Registre National des Entreprises (données publiques)",
        note: exercices.length ? undefined : "Aucun compte annuel non-confidentiel exploitable pour ce SIREN",
      };
    });
    res.json(data);
  } catch (e) {
    const msg = e.message || "inpi_error";
    res.status(e.status || 502).json({
      error: msg,
      ...(msg === "inpi_not_configured" ? { hint: "INPI account/API access not set on server yet" } : {}),
    });
  }
});

export default router;
