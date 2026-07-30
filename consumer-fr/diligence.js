// Agent de due-diligence B2B France — dépense ADAPTATIVE sur la ferme x402.
// Triage pas cher, approfondissement seulement si un risque est détecté.
//
//   Étape 1 (triage, $0.03) : kyb/partial?q=<nom|siren>
//       -> résout le SIREN + verdict conformité + nb drapeaux + procédures + TVA VIES
//   Étape 2 (identité, $0.02) : entreprise?q=<...>  (toujours, pour le dossier)
//   Étape 3 (SEULEMENT si risque) :
//       procedures-collectives ($0.03) + bodacc ($0.02) + score-entreprise ($0.08)
//
//   Cas sain  ~ $0.05 · cas à risque ~ $0.18  — l'agent ne paie la profondeur que si ça vaut le coup.

import { call } from "./farm.js";

const isSiren = (s) => /^\d{9}$/.test(String(s).replace(/\s/g, ""));
const enc = encodeURIComponent;

export async function runDiligence(input) {
  if (!input || !String(input).trim()) throw new Error("input requis (nom d'entreprise ou SIREN)");
  const q = String(input).trim();
  const calls = [];
  let cost = 0;
  let mode = null;
  const track = async (label, path) => {
    const t0 = Date.now();
    const r = await call(path);
    mode = r.mode;
    cost += r.priceUsd;
    calls.push({ label, path: path.split("?")[0], priceUsd: r.priceUsd, ms: Date.now() - t0, ok: r.ok, status: r.status });
    return r;
  };

  // --- Étape 1 : triage KYB (résout aussi le SIREN depuis un nom) ---
  const triage = await track("triage KYB", `/v1/fr/kyb/partial?q=${enc(q)}`);
  if (!triage.ok) {
    return { input: q, error: `entreprise introuvable ou service indisponible (HTTP ${triage.status})`, calls, totalCostUsd: round(cost), mode };
  }
  const t = triage.data || {};
  const siren = t.siren || (isSiren(q) ? q : null);

  // --- Étape 2 : identité (pour le dossier) ---
  const idres = await track("identité", `/v1/fr/entreprise?q=${enc(siren || q)}`);
  const ident = ((idres.data || {}).results || [])[0] || {};

  // --- Évaluation du risque ---
  const insolvency = Number(t.procedures_collectives || 0) > 0;
  const flags = Number(t.nb_drapeaux || 0);
  const nonConforme = (t.verdict || "").toUpperCase() !== "CONFORME";
  const inactive = (t.etat || ident.etat || "").toUpperCase() !== "ACTIVE" && (ident.etat || "A") !== "A";

  let risk = "GREEN";
  if (insolvency || inactive) risk = "RED";
  else if (nonConforme || flags > 0) risk = "ORANGE";

  const dossier = {
    input: q,
    resolvedSiren: siren,
    denomination: t.denomination || ident.nom || null,
    risk,
    verdict: t.verdict || null,
    vatValidatedVies: t.tva_validee_vies ?? null,
    flags,
    identity: {
      siren, nom: ident.nom, naf: ident.naf, etat: ident.etat,
      creation: ident.creation, effectif: ident.effectif,
      siege: ident.siege || null, dirigeants: ident.dirigeants || null,
    },
    insolvency: insolvency ? { flag: true } : { flag: false },
    events: [],
    score: null,
    generatedAt: new Date().toISOString(),
  };

  // --- Étape 3 : approfondissement UNIQUEMENT si risque ---
  if (risk !== "GREEN" && siren) {
    const [proc, bod, sc] = await Promise.all([
      track("procédures collectives", `/v1/fr/procedures-collectives?siren=${enc(siren)}`),
      track("annonces BODACC", `/v1/fr/bodacc?siren=${enc(siren)}`),
      track("score de solidité", `/v1/fr/score-entreprise?siren=${enc(siren)}`),
    ]);
    if (proc.ok) dossier.insolvency = { flag: insolvency, ...proc.data };
    if (bod.ok) dossier.events = ((bod.data || {}).annonces || []).slice(0, 8);
    if (sc.ok) dossier.score = sc.data?.score ?? sc.data ?? null;
  }

  dossier.calls = calls;
  dossier.totalCostUsd = round(cost);
  dossier.mode = mode;
  return dossier;
}

const round = (n) => Math.round(n * 1000) / 1000;
