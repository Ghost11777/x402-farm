import { Router } from "express";
import { cached } from "../lib/cache.js";

// /fr/bilans : comptes annuels & données financières via l'API INPI RNE.
// FRICTION RÉELLE : l'endpoint exige un compte INPI (login -> token). L'agent
// n'a pas ce compte ; nous oui. C'est ce qu'il ne peut pas faire seul.
const router = Router();
const INPI = "https://registre-national-entreprises.inpi.fr/api";

let tokenCache = { token: null, expires: 0 };

async function getToken() {
  if (tokenCache.token && tokenCache.expires > Date.now()) return tokenCache.token;
  const u = process.env.INPI_USERNAME, p = process.env.INPI_PASSWORD;
  if (!u || !p) throw Object.assign(new Error("inpi_not_configured"), { status: 503 });
  const r = await fetch(`${INPI}/sso/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: u, password: p }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw Object.assign(new Error("inpi_login_failed"), { status: 502 });
  const { token } = await r.json();
  tokenCache = { token, expires: Date.now() + 50 * 60_000 }; // token INPI ~1h, on garde 50min
  return token;
}

async function inpiGet(path) {
  const token = await getToken();
  const r = await fetch(`${INPI}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 401) {
    tokenCache = { token: null, expires: 0 }; // token périmé -> on force un relogin au prochain appel
    throw Object.assign(new Error("inpi_unauthorized"), { status: 502 });
  }
  if (!r.ok) throw Object.assign(new Error(`inpi_${r.status}`), { status: r.status === 404 ? 404 : 502 });
  return r.json();
}

// Extrait les bilans/comptes annuels structurés de la réponse RNE (structure variable)
function extractBilans(company) {
  const content = company?.formality?.content || {};
  // Les comptes annuels déposés sont parfois sous bilans / bilansSaisis / comptesAnnuels
  const bilans = content.bilans || content.bilansSaisis || content.comptesAnnuels || [];
  return Array.isArray(bilans) ? bilans : [];
}

// GET /v1/fr/bilans?siren=  -> données financières + liste des comptes annuels déposés
router.get("/v1/fr/bilans", async (req, res) => {
  const siren = (req.query.siren || "").toString().replace(/\D/g, "");
  if (siren.length !== 9) return res.status(400).json({ error: "siren_must_be_9_digits" });
  try {
    const data = await cached(`bilans:${siren}`, 24 * 3600_000, async () => {
      const company = await inpiGet(`/companies/${siren}`);
      const bilans = extractBilans(company);
      const c = company?.formality?.content || {};
      const identite = c.personneMorale?.identite || c.personnePhysique?.identite || {};
      // Liste des documents "comptes annuels" déposés (attachments)
      let comptes = [];
      try {
        const att = await inpiGet(`/companies/${siren}/attachments`);
        const list = att?.comptesAnnuels || att?.attachments?.comptesAnnuels || [];
        comptes = (Array.isArray(list) ? list : []).map((d) => ({
          id: d.id, date_cloture: d.dateCloture, type: d.typeComptes || d.type, confidentiel: d.confidentiality || d.confidentiel,
        }));
      } catch { /* attachments optionnels */ }
      return {
        siren,
        denomination: identite.entreprise?.denomination || identite.denomination || null,
        forme_juridique: identite.entreprise?.formeJuridique || null,
        capital: identite.description?.montantCapital ?? null,
        devise_capital: identite.description?.deviseCapital ?? null,
        comptes_annuels_deposes: comptes,
        bilans_structures: bilans.map((b) => ({
          date_cloture: b.dateCloture || b.dateClotureExercice,
          duree_exercice: b.dureeExercice,
          // postes principaux si présents
          chiffre_affaires: b.chiffreAffaires ?? b.ca ?? null,
          resultat_net: b.resultatNet ?? b.resultat ?? null,
        })),
        source: "INPI Registre National des Entreprises",
        note: comptes.length || bilans.length ? undefined : "Aucun compte annuel déposé publiquement pour ce SIREN",
      };
    });
    res.json(data);
  } catch (e) {
    const msg = e.message || "inpi_error";
    const status = e.status || 502;
    res.status(status).json({ error: msg, ...(msg === "inpi_not_configured" ? { hint: "INPI account not set on server yet" } : {}) });
  }
});

export default router;
