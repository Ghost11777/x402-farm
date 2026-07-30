import { Router } from "express";
import { cached } from "../lib/cache.js";

// COMPOSITE PREMIUM : due-diligence B2B France en UN appel payant.
// Orchestration à dépense adaptative : triage pas cher -> approfondissement
// SEULEMENT si un risque est détecté. En interne on appelle nos propres routes
// avec la clé interne (paywall sauté côté serveur), donc coût marginal ~0 :
// la valeur vendue = l'orchestration + le verdict, pas la donnée brute.
//
// Sortie : dossier structuré { risk 🟢/🟠/🔴, verdict, score, identité, insolvabilité,
// événements BODACC, TVA VIES, coût interne, appels }.

const router = Router();

// Clé interne pour les self-calls (réutilise le canal interne déjà posé sur Vercel).
const SELF_KEY = process.env.VIRTUALS_API_KEY || process.env.SELF_INTERNAL_KEY || "";
const isSiren = (s) => /^\d{9}$/.test(String(s).replace(/\s/g, ""));
const enc = encodeURIComponent;

async function selfCall(base, path) {
  const r = await fetch(`${base}${path}`, {
    headers: { "x-api-key": SELF_KEY, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function buildDossier(base, input) {
  const q = String(input).trim();
  const calls = [];
  const hit = async (label, path) => {
    const t0 = Date.now();
    const r = await selfCall(base, path);
    calls.push({ label, ok: r.ok, ms: Date.now() - t0 });
    return r;
  };

  // 1) Triage (résout le SIREN + verdict + drapeaux + procédures + TVA VIES)
  const triage = await hit("triage", `/v1/fr/kyb/partial?q=${enc(q)}`);
  if (!triage.ok) return { input: q, error: "entreprise introuvable", calls };
  const t = triage.data || {};
  const siren = t.siren || (isSiren(q) ? q : null);

  // 2) Identité
  const idr = await hit("identity", `/v1/fr/entreprise?q=${enc(siren || q)}`);
  const ident = ((idr.data || {}).results || [])[0] || {};

  const insolvency = Number(t.procedures_collectives || 0) > 0;
  const flags = Number(t.nb_drapeaux || 0);
  const nonConforme = String(t.verdict || "").toUpperCase() !== "CONFORME";
  const inactive = String(t.etat || ident.etat || "").toUpperCase() !== "ACTIVE" && (ident.etat || "A") !== "A";
  let risk = "GREEN";
  if (insolvency || inactive) risk = "RED";
  else if (nonConforme || flags > 0) risk = "ORANGE";

  const dossier = {
    input: q, resolvedSiren: siren, denomination: t.denomination || ident.nom || null,
    risk, verdict: t.verdict || null, vatValidatedVies: t.tva_validee_vies ?? null, flags,
    identity: {
      siren, nom: ident.nom, naf: ident.naf, etat: ident.etat, creation: ident.creation,
      effectif: ident.effectif, siege: ident.siege || null, dirigeants: ident.dirigeants || null,
    },
    insolvency: { flag: insolvency }, events: [], score: null,
    generatedAt: new Date().toISOString(),
  };

  // 3) Approfondissement UNIQUEMENT si risque
  if (risk !== "GREEN" && siren) {
    const [proc, bod, sc] = await Promise.all([
      hit("procedures", `/v1/fr/procedures-collectives?siren=${enc(siren)}`),
      hit("bodacc", `/v1/fr/bodacc?siren=${enc(siren)}`),
      hit("score", `/v1/fr/score-entreprise?siren=${enc(siren)}`),
    ]);
    if (proc.ok) dossier.insolvency = { flag: insolvency, ...proc.data };
    if (bod.ok) dossier.events = ((bod.data || {}).annonces || []).slice(0, 8);
    if (sc.ok) dossier.score = sc.data?.score ?? null;
  }
  dossier.calls = calls;
  return dossier;
}

router.all("/v1/fr/due-diligence", async (req, res) => {
  const input = (req.query.q || req.query.siren || req.body?.q || req.body?.company || "").toString().trim();
  if (!input) return res.status(400).json({ error: "missing_q_or_siren", hint: "?q=<nom ou SIREN>" });
  if (!SELF_KEY) return res.status(503).json({ error: "self_key_unset" });
  try {
    const base = `${req.protocol}://${req.get("host")}`;
    const dossier = await cached(`dd:${input.toLowerCase()}`, 6 * 3600_000, () => buildDossier(base, input));
    return res.json(dossier);
  } catch (e) {
    return res.status(502).json({ error: "diligence_failed", detail: String(e.message || e) });
  }
});

export default router;
