import { Router } from "express";
import { cached } from "../lib/cache.js";

// Données publiques françaises emballées pour les agents IA.
// Niche quasi vide sur le Bazaar — c'est le fossé défensif de la ferme.
const router = Router();

async function proxy(res, key, ttlMs, url, transform = (x) => x, opts = {}) {
  try {
    const data = await cached(key, ttlMs, async () => {
      const r = await fetch(url, {
        headers: { "user-agent": "x402-farm/0.1", accept: "application/json", ...(opts.headers || {}) },
        signal: AbortSignal.timeout(opts.timeout || 10_000),
      });
      if (!r.ok) throw Object.assign(new Error(`upstream_${r.status}`), { status: 502 });
      return transform(await r.json());
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || "upstream_error" });
  }
}

const q = (req, name) => (req.query[name] || "").toString().trim();

// ---- 1. TVA intracommunautaire FR depuis un SIREN (calcul pur, clé = (12 + 3*(SIREN%97))%97) ----
router.all("/v1/fr/tva", (req, res) => {
  const siren = q(req, "siren").replace(/\D/g, "");
  if (siren.length !== 9) return res.status(400).json({ error: "siren_must_be_9_digits" });
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  res.json({ siren, tva: `FR${String(key).padStart(2, "0")}${siren}`, key: String(key).padStart(2, "0") });
});

// ---- 2. Validation TVA UE via VIES (officiel Commission européenne) ----
router.all("/v1/fr/vat-eu", (req, res) => {
  const raw = q(req, "vat").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = raw.match(/^([A-Z]{2})(.+)$/);
  if (!m) return res.status(400).json({ error: "invalid_vat_format" });
  proxy(res, `vies:${raw}`, 6 * 3600_000,
    `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${m[1]}/vat/${m[2]}`,
    (d) => {
      if (d.userError && d.userError !== "VALID" && d.userError !== "INVALID") {
        return { vat: raw, valid: null, status: "service_unavailable", detail: d.userError };
      }
      const clean = (v) => (v && v !== "---" ? v : null);
      return { vat: raw, valid: d.isValid === true, name: clean(d.name), address: clean(d.address), country: d.countryCode };
    },
    { timeout: 12_000 });
});

// ---- 3. Info commune (population, CP, INSEE, département, région) ----
router.all("/v1/fr/commune", (req, res) => {
  const nom = q(req, "q");
  const cp = q(req, "cp");
  if (!nom && !cp) return res.status(400).json({ error: "missing_q_or_cp" });
  const base = "https://geo.api.gouv.fr/communes";
  const fields = "nom,code,codesPostaux,population,siren,codeEpci,epci,codeDepartement,departement,codeRegion,region,centre";
  const url = cp
    ? `${base}?codePostal=${encodeURIComponent(cp)}&fields=${fields}`
    : `${base}?nom=${encodeURIComponent(nom)}&fields=${fields}&boost=population&limit=5`;
  proxy(res, `commune:${nom}${cp}`, 7 * 24 * 3600_000, url, (arr) => ({
    results: (Array.isArray(arr) ? arr : []).map((c) => ({
      nom: c.nom, insee: c.code, codesPostaux: c.codesPostaux, population: c.population,
      siren: c.siren, epci: c.epci?.nom, departement: c.departement?.nom, region: c.region?.nom,
      lat: c.centre?.coordinates?.[1], lon: c.centre?.coordinates?.[0],
    })),
  }));
});

// ---- 4. Géocodage inverse (lat/lon -> adresse) ----
router.all("/v1/fr/reverse-geocode", (req, res) => {
  const lat = q(req, "lat"), lon = q(req, "lon");
  if (!lat || !lon) return res.status(400).json({ error: "missing_lat_lon" });
  proxy(res, `revgeo:${lat},${lon}`, 30 * 24 * 3600_000,
    `https://data.geopf.fr/geocodage/reverse?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}&limit=1`,
    (d) => {
      const f = d.features?.[0];
      return f ? { label: f.properties.label, cp: f.properties.postcode, ville: f.properties.city,
        insee: f.properties.citycode, type: f.properties.type, distance: f.properties.distance } : { label: null };
    });
});

// ---- 5. Jours fériés FR (par année + zone) ----
router.all("/v1/fr/jours-feries", (req, res) => {
  const annee = q(req, "annee") || String(new Date().getFullYear?.() || 2026);
  const zone = q(req, "zone") || "metropole";
  proxy(res, `jf:${zone}:${annee}`, 90 * 24 * 3600_000,
    `https://calendrier.api.gouv.fr/jours-feries/${encodeURIComponent(zone)}/${encodeURIComponent(annee)}.json`,
    (d) => ({ annee, zone, jours: Object.entries(d).map(([date, nom]) => ({ date, nom })) }));
});

// ---- 6. Risques naturels/technologiques par code INSEE (GeoRisques) ----
router.all("/v1/fr/georisques", (req, res) => {
  const insee = q(req, "insee");
  if (!/^\d{5}[AB0-9]?$/i.test(insee)) return res.status(400).json({ error: "invalid_insee" });
  proxy(res, `georisq:${insee}`, 7 * 24 * 3600_000,
    `https://www.georisques.gouv.fr/api/v1/gaspar/risques?code_insee=${encodeURIComponent(insee)}&page=1&page_size=50`,
    (d) => {
      const detail = (d.data || []).flatMap((r) => r.risques_detail || []);
      const seen = new Set();
      const risques = [];
      for (const r of detail) {
        if (r.libelle_risque_long && !seen.has(r.libelle_risque_long)) {
          seen.add(r.libelle_risque_long);
          risques.push({ libelle: r.libelle_risque_long, num: r.num_risque });
        }
      }
      return { insee, commune: d.data?.[0]?.libelle_commune, risques };
    });
});

// ---- 7. Prix carburants près d'une position ----
router.all("/v1/fr/carburants", (req, res) => {
  const cp = q(req, "cp");
  if (!/^\d{5}$/.test(cp)) return res.status(400).json({ error: "invalid_cp" });
  proxy(res, `carbu:${cp}`, 3600_000,
    `https://data.economie.gouv.fr/api/records/1.0/search/?dataset=prix-des-carburants-en-france-flux-instantane-v2&q=${cp}&rows=20`,
    (d) => ({
      cp,
      stations: (d.records || []).map((r) => {
        const f = r.fields;
        return { adresse: f.adresse, ville: f.ville, cp: f.cp,
          prix: { gazole: f.gazole_prix, sp95: f.sp95_prix, sp98: f.sp98_prix, e85: f.e85_prix, gplc: f.gplc_prix } };
      }),
    }));
});

// ---- 8. Tous les établissements d'un SIREN ----
router.all("/v1/fr/etablissements", (req, res) => {
  const siren = q(req, "siren").replace(/\D/g, "");
  if (siren.length !== 9) return res.status(400).json({ error: "siren_must_be_9_digits" });
  proxy(res, `etabs:${siren}`, 24 * 3600_000,
    `https://recherche-entreprises.api.gouv.fr/search?q=${siren}&page=1&per_page=1`,
    (raw) => {
      const e = raw.results?.[0];
      if (!e) return { siren, found: false };
      const s = e.siege;
      return { siren, nom: e.nom_complet,
        nb_etablissements: e.nombre_etablissements,
        nb_etablissements_ouverts: e.nombre_etablissements_ouverts,
        siege: s ? { siret: s.siret, adresse: s.adresse, cp: s.code_postal, ville: s.libelle_commune, etat: s.etat_administratif } : null };
    });
});

// ---- 9. Recherche d'associations (RNA / recherche-entreprises) ----
router.all("/v1/fr/association", (req, res) => {
  const query = q(req, "q");
  if (!query) return res.status(400).json({ error: "missing_q" });
  proxy(res, `asso:${query}`, 24 * 3600_000,
    `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(query)}&type=association&per_page=10`,
    (raw) => ({ query, total: raw.total_results, results: (raw.results || []).map((a) => ({
      nom: a.nom_complet, siren: a.siren, rna: a.complements?.identifiant_association,
      creation: a.date_creation, ville: a.siege?.libelle_commune })) }));
});

// ---- 10. DPE (diagnostic performance énergétique) par commune (ADEME) ----
router.all("/v1/fr/dpe", (req, res) => {
  const insee = q(req, "insee");
  const cp = q(req, "cp");
  if (!insee && !cp) return res.status(400).json({ error: "missing_insee_or_cp" });
  const qs = insee ? `code_insee_ban:${insee}` : `code_postal_ban:${cp}`;
  proxy(res, `dpe:${insee}${cp}`, 24 * 3600_000,
    `https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines?size=10&q=${encodeURIComponent(qs)}`,
    (d) => ({ results: (d.results || []).map((r) => ({
      adresse: r.adresse_ban || r.adresse_brute, etiquette_dpe: r.etiquette_dpe, etiquette_ges: r.etiquette_ges,
      surface: r.surface_habitable_logement, conso: r.conso_5_usages_ep_par_m2, date: r.date_etablissement_dpe })) }),
    { timeout: 12_000 });
});

// ---- 11. Vacances scolaires (par zone/année) ----
router.all("/v1/fr/vacances-scolaires", (req, res) => {
  const zone = q(req, "zone") || "Zone A";
  const annee = q(req, "annee") || "2025-2026";
  proxy(res, `vac:${zone}:${annee}`, 30 * 24 * 3600_000,
    `https://data.education.gouv.fr/api/records/1.0/search/?dataset=fr-en-calendrier-scolaire&q=${encodeURIComponent(zone)}&refine.annee_scolaire=${encodeURIComponent(annee)}&rows=30`,
    (d) => ({ zone, annee, vacances: (d.records || []).map((r) => ({
      description: r.fields.description, debut: r.fields.start_date, fin: r.fields.end_date, zones: r.fields.zones })) }));
});

// ---- 12. Établissements scolaires (annuaire éducation nationale) ----
router.all("/v1/fr/ecoles", (req, res) => {
  const query = q(req, "q");
  const cp = q(req, "cp");
  if (!query && !cp) return res.status(400).json({ error: "missing_q_or_cp" });
  const refine = cp ? `&refine.code_postal=${cp}` : "";
  proxy(res, `ecoles:${query}${cp}`, 7 * 24 * 3600_000,
    `https://data.education.gouv.fr/api/records/1.0/search/?dataset=fr-en-annuaire-education&q=${encodeURIComponent(query)}${refine}&rows=15`,
    (d) => ({ results: (d.records || []).map((r) => {
      const f = r.fields;
      return { nom: f.nom_etablissement, type: f.type_etablissement, statut: f.statut_public_prive,
        adresse: f.adresse_1, cp: f.code_postal, ville: f.nom_commune, tel: f.telephone };
    }) }));
});

// ---- 13. Validation IBAN (mod-97, pur) ----
router.all("/v1/fr/iban", (req, res) => {
  const iban = q(req, "iban").toUpperCase().replace(/\s/g, "");
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return res.json({ iban, valid: false, reason: "format" });
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  res.json({ iban, valid: rem === 1, pays: iban.slice(0, 2), banque: iban.startsWith("FR") ? iban.slice(4, 9) : null });
});

// ---- 14. Codes postaux <-> communes (IGN apicarto) ----
router.all("/v1/fr/codes-postaux", (req, res) => {
  const cp = q(req, "cp");
  if (!/^\d{5}$/.test(cp)) return res.status(400).json({ error: "invalid_cp" });
  proxy(res, `cp:${cp}`, 30 * 24 * 3600_000,
    `https://apicarto.ign.fr/api/codes-postaux/communes/${cp}`,
    (arr) => ({ cp, communes: (Array.isArray(arr) ? arr : []).map((c) => ({ nom: c.nomCommune, insee: c.codeCommune })) }));
});

// ---- 15. Parcelle cadastrale par coordonnées (IGN) ----
router.all("/v1/fr/cadastre", (req, res) => {
  const lat = q(req, "lat"), lon = q(req, "lon");
  if (!lat || !lon) return res.status(400).json({ error: "missing_lat_lon" });
  const geom = JSON.stringify({ type: "Point", coordinates: [Number(lon), Number(lat)] });
  proxy(res, `cadastre:${lat},${lon}`, 30 * 24 * 3600_000,
    `https://apicarto.ign.fr/api/cadastre/parcelle?geom=${encodeURIComponent(geom)}`,
    (d) => {
      const p = d.features?.[0]?.properties;
      return p ? { idu: p.idu, section: p.section, numero: p.numero, feuille: p.feuille,
        commune: p.nom_com, insee: p.code_insee, contenance_m2: p.contenance } : { idu: null };
    }, { timeout: 12_000 });
});

// ---- 16. DVF : valeurs foncières (transactions immobilières réelles) ----
router.all("/v1/fr/valeurs-foncieres", (req, res) => {
  const insee = q(req, "insee");
  if (!/^\d{5}[AB0-9]?$/i.test(insee)) return res.status(400).json({ error: "invalid_insee" });
  const annee = q(req, "annee");
  const anneeParam = /^\d{4}$/.test(annee) ? `&anneemut=${annee}` : "";
  proxy(res, `dvf:${insee}:${annee}`, 24 * 3600_000,
    `https://apidf-preprod.cerema.fr/dvf_opendata/mutations/?code_insee=${encodeURIComponent(insee)}${anneeParam}&page_size=50&ordering=-datemut`,
    (d) => ({
      insee, total: d.count,
      mutations: (d.results || []).map((m) => ({
        date: m.datemut, nature: m.libnatmut, valeur_fonciere: Number(m.valeurfonc),
        surface_bati_m2: Number(m.sbati) || null, surface_terrain_m2: Number(m.sterr) || null,
        nb_locaux: m.nblocmut, vefa: m.vefa, parcelles: m.l_idpar })),
    }), { timeout: 12_000 });
});

// ---- 17. Statistiques INSEE d'une commune (population, superficie, densité) ----
router.all("/v1/fr/insee-commune", (req, res) => {
  const insee = q(req, "insee");
  if (!/^\d{5}[AB0-9]?$/i.test(insee)) return res.status(400).json({ error: "invalid_insee" });
  proxy(res, `insee:${insee}`, 30 * 24 * 3600_000,
    `https://geo.api.gouv.fr/communes/${encodeURIComponent(insee)}?fields=nom,code,population,surface,codeDepartement,departement,codeRegion,region,siren,codeEpci,epci,centre`,
    (c) => ({
      insee: c.code, nom: c.nom, population: c.population,
      superficie_ha: c.surface, superficie_km2: c.surface ? Math.round(c.surface / 100 * 100) / 100 : null,
      densite_hab_km2: c.population && c.surface ? Math.round(c.population / (c.surface / 100)) : null,
      departement: c.departement?.nom, region: c.region?.nom, epci: c.epci?.nom, siren: c.siren,
      lat: c.centre?.coordinates?.[1], lon: c.centre?.coordinates?.[0],
    }));
});

// Codes météo WMO -> libellé FR
const WMO = {
  0: "Ciel clair", 1: "Principalement clair", 2: "Partiellement nuageux", 3: "Couvert",
  45: "Brouillard", 48: "Brouillard givrant", 51: "Bruine légère", 53: "Bruine", 55: "Bruine dense",
  61: "Pluie faible", 63: "Pluie", 65: "Pluie forte", 66: "Pluie verglaçante", 67: "Pluie verglaçante forte",
  71: "Neige faible", 73: "Neige", 75: "Neige forte", 77: "Grains de neige",
  80: "Averses faibles", 81: "Averses", 82: "Averses violentes", 85: "Averses de neige", 86: "Averses de neige fortes",
  95: "Orage", 96: "Orage avec grêle", 99: "Orage avec forte grêle",
};

// ---- 18. Météo actuelle + prévisions (open-meteo, couvre France + DOM) ----
router.all("/v1/fr/meteo", (req, res) => {
  const lat = q(req, "lat"), lon = q(req, "lon");
  if (!lat || !lon) return res.status(400).json({ error: "missing_lat_lon" });
  const jours = Math.min(Math.max(Number(q(req, "jours")) || 3, 1), 7);
  proxy(res, `meteo:${lat},${lon}:${jours}`, 30 * 60_000,
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=${jours}`,
    (d) => {
      const c = d.current || {};
      const dly = d.daily || {};
      return {
        lat: d.latitude, lon: d.longitude,
        actuel: { temperature: c.temperature_2m, humidite: c.relative_humidity_2m,
          vent_kmh: c.wind_speed_10m, code: c.weather_code, description: WMO[c.weather_code] || null },
        previsions: (dly.time || []).map((date, i) => ({
          date, code: dly.weather_code?.[i], description: WMO[dly.weather_code?.[i]] || null,
          tmin: dly.temperature_2m_min?.[i], tmax: dly.temperature_2m_max?.[i], precipitations_mm: dly.precipitation_sum?.[i] })),
      };
    });
});

// ---- 19. Artisans RGE (rénovation énergétique certifiés) près d'un code postal ----
router.all("/v1/fr/rge", (req, res) => {
  const cp = q(req, "cp");
  if (!/^\d{5}$/.test(cp)) return res.status(400).json({ error: "invalid_cp" });
  const domaine = q(req, "domaine");
  const dq = domaine ? ` AND domaine:*${domaine}*` : "";
  proxy(res, `rge:${cp}:${domaine}`, 7 * 24 * 3600_000,
    `https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-2/lines?size=20&qs=${encodeURIComponent(`code_postal:${cp}${dq}`)}`,
    (d) => {
      const seen = new Set();
      const artisans = [];
      for (const r of d.results || []) {
        const key = r.siret;
        if (seen.has(key)) continue;
        seen.add(key);
        artisans.push({ nom: r.nom_entreprise, siret: r.siret, commune: r.commune, cp: r.code_postal,
          domaine: r.domaine, qualification: r.nom_qualification, telephone: r.telephone,
          email: r.email, site: r.site_internet });
      }
      return { cp, total: d.total, artisans };
    });
});

// ---- 20. Vérifier si une entreprise est certifiée RGE (par SIRET) ----
router.all("/v1/fr/rge-check", (req, res) => {
  const siret = q(req, "siret").replace(/\D/g, "");
  if (siret.length !== 14) return res.status(400).json({ error: "siret_must_be_14_digits" });
  proxy(res, `rgecheck:${siret}`, 7 * 24 * 3600_000,
    `https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-2/lines?size=30&qs=${encodeURIComponent(`siret:${siret}`)}`,
    (d) => {
      const rows = d.results || [];
      return { siret, rge: rows.length > 0,
        nom: rows[0]?.nom_entreprise || null,
        qualifications: rows.map((r) => ({ domaine: r.domaine, qualification: r.nom_qualification,
          organisme: r.organisme, debut: r.lien_date_debut, fin: r.lien_date_fin })) };
    });
});

// ---- 21. Jeux de données transport/mobilité pour un territoire (transport.data.gouv) ----
router.all("/v1/fr/transport", (req, res) => {
  const query = q(req, "q");
  if (!query) return res.status(400).json({ error: "missing_q" });
  proxy(res, `transport:${query}`, 24 * 3600_000,
    `https://transport.data.gouv.fr/api/datasets`,
    (arr) => {
      const needle = query.toLowerCase();
      const matches = (Array.isArray(arr) ? arr : [])
        .filter((ds) => (ds.title || "").toLowerCase().includes(needle) || (ds.covered_area?.name || "").toLowerCase().includes(needle))
        .slice(0, 15)
        .map((ds) => ({ titre: ds.title, type: ds.type, territoire: ds.covered_area?.name,
          formats: [...new Set((ds.resources || []).map((r) => r.format).filter(Boolean))],
          feeds: (ds.resources || []).filter((r) => /GTFS|NeTEx|gbfs/i.test(r.format || "")).map((r) => ({ format: r.format, url: r.url })).slice(0, 5),
          page: ds.page_url }));
      return { query, total: matches.length, datasets: matches };
    }, { timeout: 12_000 });
});

// ---- 22. Bornes de recharge électrique (IRVE) par code INSEE ----
router.all("/v1/fr/irve", (req, res) => {
  const insee = q(req, "insee");
  if (!/^\d{5}[AB0-9]?$/i.test(insee)) return res.status(400).json({ error: "invalid_insee" });
  proxy(res, `irve:${insee}`, 7 * 24 * 3600_000,
    `https://tabular-api.data.gouv.fr/api/resources/eb76d20a-8501-400e-b336-d85724de5435/data/?code_insee_commune__exact=${encodeURIComponent(insee)}&page_size=30`,
    (d) => ({ insee, total: (d.data || []).length, bornes: (d.data || []).map((b) => ({
      station: b.nom_station, adresse: b.adresse_station, enseigne: b.nom_enseigne, operateur: b.nom_operateur,
      puissance_kw: b.puissance_nominale, nb_points: b.nbre_pdc, acces: b.condition_acces,
      id_itinerance: b.id_station_itinerance, coords: b.coordonneesXY })) }),
    { timeout: 12_000 });
});

// ---- 23. Annonces légales BODACC d'une entreprise (par SIREN) ----
router.all("/v1/fr/bodacc", (req, res) => {
  const siren = q(req, "siren").replace(/\D/g, "");
  if (siren.length !== 9) return res.status(400).json({ error: "siren_must_be_9_digits" });
  const where = encodeURIComponent(`registre like "${siren}"`);
  proxy(res, `bodacc:${siren}`, 24 * 3600_000,
    `https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=${where}&limit=20&order_by=${encodeURIComponent("dateparution desc")}`,
    (d) => ({ siren, total: d.total_count, annonces: (d.results || []).map((a) => ({
      date: a.dateparution, type: a.typeavis_lib, famille: a.familleavis_lib,
      commercant: a.commercant, ville: a.ville, tribunal: a.tribunal, numero_annonce: a.numeroannonce })) }),
    { timeout: 12_000 });
});

// ---- 24. Opérateurs bio certifiés (AB) par département + recherche ----
router.all("/v1/fr/bio", (req, res) => {
  const dep = q(req, "departement");
  const query = q(req, "q");
  if (!dep && !query) return res.status(400).json({ error: "missing_departement_or_q" });
  const params = new URLSearchParams({ nb: "20" });
  if (dep) params.set("departements", dep);
  if (query) params.set("q", query);
  proxy(res, `bio:${dep}:${query}`, 7 * 24 * 3600_000,
    `https://opendata.agencebio.org/api/gouv/operateurs/?${params.toString()}`,
    (d) => ({ departement: dep || null, query: query || null, total: Number(d.nbTotal) || 0,
      operateurs: (d.items || []).slice(0, 20).map((o) => ({
        nom: o.denominationcourante || o.raisonSociale, siret: o.siret || null, numeroBio: o.numeroBio,
        gerant: o.gerant, naf: o.codeNAF,
        activites: (o.activites || []).map((a) => a.nom),
        productions: (o.productions || []).map((p) => p.nom).slice(0, 8) })) }),
    { timeout: 12_000 });
});

export default router;
