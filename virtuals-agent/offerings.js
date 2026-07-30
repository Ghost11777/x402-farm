// Catalogue de l'agent vendeur "French Data Butler" sur Virtuals ACP.
//
// Les clés `name` correspondent EXACTEMENT aux "Job Name" déclarés dans le
// registre ACP via app.virtuals.io (onglet ACP > Jobs Offered). C'est ce nom
// qui identifie l'offre commandée (session.job.description côté SDK v2).
// Le prix est défini côté registre web ; ici on code COMMENT fulfiller
// (route backend x402 + parsing de la "requirement" JSON envoyée par l'acheteur).
//
// ⚠️ Les noms/champs ci-dessous ont été enregistrés LIVE le 2026-07-28 :
//   frenchCompanyIdentity  ($0.20, req: q)     frenchCompanyInsolvency  ($0.30, req: siren)
//   frenchCompanyKyb       ($0.60, req: q)     frenchRealEstateValuation($0.40, req: insee[,annee])
//   frenchAddressGeocoding ($0.05, req: q)     webContentExtraction     ($0.08, req: url)

export const OFFERINGS = [
  {
    name: "frenchCompanyIdentity",
    suggestedPriceUsdc: 0.20,
    slaMinutes: 5,
    build(req) {
      const q = req.q || req.siren || req.name || req.company;
      if (!q) throw new Error("champ manquant: q (nom ou SIREN)");
      return { method: "GET", path: `/v1/fr/entreprise?q=${encodeURIComponent(q)}` };
    },
  },
  {
    name: "frenchCompanyKyb",
    suggestedPriceUsdc: 0.60,
    slaMinutes: 5,
    build(req) {
      const q = req.q || req.siren || req.name || req.company;
      if (!q) throw new Error("champ manquant: q (nom ou SIREN)");
      // /v1/fr/entreprise-360 accepte ?siren= ou ?q=
      const isSiren = /^\d{9}$/.test(String(q).replace(/\s/g, ""));
      const key = isSiren ? "siren" : "q";
      return { method: "GET", path: `/v1/fr/entreprise-360?${key}=${encodeURIComponent(q)}` };
    },
  },
  {
    name: "frenchAddressGeocoding",
    suggestedPriceUsdc: 0.05,
    slaMinutes: 5,
    build(req) {
      const q = req.q || req.address || req.adresse;
      if (!q) throw new Error("champ manquant: q (adresse)");
      return { method: "GET", path: `/v1/fr/geocode?q=${encodeURIComponent(q)}` };
    },
  },
  {
    name: "frenchCompanyInsolvency",
    suggestedPriceUsdc: 0.30,
    slaMinutes: 5,
    build(req) {
      const siren = req.siren || req.q;
      if (!siren) throw new Error("champ manquant: siren");
      return { method: "GET", path: `/v1/fr/bodacc?siren=${encodeURIComponent(siren)}` };
    },
  },
  {
    name: "frenchRealEstateValuation",
    suggestedPriceUsdc: 0.40,
    slaMinutes: 5,
    build(req) {
      const insee = req.insee || req.code_insee;
      if (!insee) throw new Error("champ manquant: insee");
      const annee = req.annee || req.year;
      return { method: "GET", path: `/v1/fr/valeurs-foncieres?insee=${encodeURIComponent(insee)}${annee ? `&annee=${encodeURIComponent(annee)}` : ""}` };
    },
  },
  {
    name: "webContentExtraction",
    suggestedPriceUsdc: 0.08,
    slaMinutes: 5,
    build(req) {
      const url = req.url;
      if (!url) throw new Error("champ manquant: url");
      return { method: "POST", path: "/v1/extract", body: { url } };
    },
  },
];

export const OFFERINGS_BY_NAME = new Map(OFFERINGS.map((o) => [o.name, o]));
