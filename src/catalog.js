// Le catalogue : 10 APIs, leur prix, leur description (sert aussi de page d'accueil découvrable)
const urlBody = { bodyType: "json", method: "POST", input: { url: "https://example.com" } };
export const CATALOG = [
  { route: "GET /v1/weather", price: "$0.003", desc: "Worldwide weather: current conditions + 3-day forecast by lat/lon or city name. Query: ?city= or ?lat=&lon=",
    bazaar: { method: "GET", input: { city: "Paris" }, output: { example: { current: { temperature_2m: 21.4, wind_speed_10m: 12 }, daily: { temperature_2m_max: [24] } } } } },
  { route: "GET /v1/crypto/price", price: "$0.003", desc: "Spot prices + 24h change for any CoinGecko-listed tokens, multi-currency. Query: ?ids=bitcoin,ethereum&vs=usd,eur",
    bazaar: { method: "GET", input: { ids: "bitcoin,ethereum", vs: "usd" }, output: { example: { prices: { bitcoin: { usd: 97250, usd_24h_change: 1.2 } } } } } },
  { route: "POST /v1/extract",       price: "$0.005", desc: "URL -> main content as clean markdown, from a FRENCH RESIDENTIAL IP + real Chromium (JS-rendered). Reaches sites that block datacenter/cloud IPs (Firecrawl/ScrapingBee territory) at a fraction of the price. Input: {url}",
    bazaar: { ...urlBody, output: { example: { url: "https://example.com/", title: "Example Domain", markdown: "# Example Domain…" } } } },
  { route: "POST /v1/render",        price: "$0.005", desc: "URL -> full HTML after JS execution, from a French residential IP + real browser (bypasses datacenter blocks). Input: {url}",
    bazaar: { ...urlBody, output: { example: { url: "https://example.com/", html: "<html>…</html>" } } } },
  { route: "POST /v1/screenshot",    price: "$0.01",  desc: "URL -> PNG screenshot from a French residential IP + real browser (renders sites that block cloud IPs). Input: {url, fullPage?}",
    bazaar: { bodyType: "json", method: "POST", input: { url: "https://example.com", fullPage: false } } },
  { route: "POST /v1/pdf",           price: "$0.01",  desc: "URL -> A4 PDF from a French residential IP + real browser. Input: {url}",
    bazaar: urlBody },
  { route: "POST /v1/links",        price: "$0.005", desc: "URL -> deduplicated links (internal/external + anchor text), fetched from a French residential IP. Input: {url}",
    bazaar: { ...urlBody, output: { example: { url: "https://example.com/", count: 1, internal: [], external: [{ href: "https://iana.org", text: "Learn more" }] } } } },
  { route: "POST /v1/meta",          price: "$0.005", desc: "URL -> SEO meta, OpenGraph, canonical, JSON-LD, from a French residential IP + real browser. Input: {url}",
    bazaar: { ...urlBody, output: { example: { url: "https://example.com/", title: "Example Domain", meta: {}, jsonLd: [] } } } },
  { route: "GET /v1/fr/entreprise",  price: "$0.02",  desc: "French company lookup by name or SIREN/SIRET: officers, NAF, HQ, status. Query: ?q=",
    bazaar: { method: "GET", input: { q: "Decathlon" }, output: { example: { query: "Decathlon", total: 151, results: [{ siren: "306138900", nom: "DECATHLON" }] } } } },
  { route: "GET /v1/fr/geocode",     price: "$0.005", desc: "Geocode any French address incl. overseas territories (lat/lon, score). Query: ?q=",
    bazaar: { method: "GET", input: { q: "Pointe-à-Pitre" }, output: { example: { results: [{ label: "Pointe-à-Pitre", lat: 16.23619, lon: -61.537759 }] } } } },
  { route: "GET /v1/dns",            price: "$0.005", desc: "Full DNS records for a domain: A, AAAA, MX, TXT, NS, SPF. Query: ?domain=",
    bazaar: { method: "GET", input: { domain: "example.com" }, output: { example: { domain: "example.com", a: ["1.2.3.4"], mx: [] } } } },
  { route: "GET /v1/email/validate", price: "$0.005", desc: "Email validation: syntax + domain MX check, no email sent. Query: ?email=",
    bazaar: { method: "GET", input: { email: "test@gmail.com" }, output: { example: { email: "test@gmail.com", valid: true, mx: "gmail-smtp-in.l.google.com" } } } },

  // ===== Données publiques françaises (le fossé défensif) =====
  { route: "GET /v1/fr/tva", price: "$0.005", desc: "Compute French intra-EU VAT number from a SIREN (offline, instant). Query: ?siren=",
    bazaar: { method: "GET", input: { siren: "306138900" }, output: { example: { siren: "306138900", tva: "FR51306138900" } } } },
  { route: "GET /v1/fr/vat-eu", price: "$0.02", desc: "Validate any EU VAT number via the official VIES service, returns trader name/address. Query: ?vat=",
    bazaar: { method: "GET", input: { vat: "FR40306138900" }, output: { example: { vat: "FR40306138900", valid: true, name: "DECATHLON", country: "FR" } } } },
  { route: "GET /v1/fr/commune", price: "$0.005", desc: "French commune info: population, INSEE code, postal codes, EPCI, department, region, coords. Query: ?q= or ?cp=",
    bazaar: { method: "GET", input: { q: "Basse-Terre" }, output: { example: { results: [{ nom: "Basse-Terre", insee: "97105", population: 9417, region: "Guadeloupe" }] } } } },
  { route: "GET /v1/fr/reverse-geocode", price: "$0.005", desc: "Reverse geocode lat/lon to a French address (incl. overseas). Query: ?lat=&lon=",
    bazaar: { method: "GET", input: { lat: "16.24", lon: "-61.53" }, output: { example: { label: "Pointe-à-Pitre", cp: "97110", ville: "Pointe-à-Pitre" } } } },
  { route: "GET /v1/fr/jours-feries", price: "$0.005", desc: "French public holidays for a year and zone (metropole, alsace-moselle, guadeloupe, etc.). Query: ?annee=&zone=",
    bazaar: { method: "GET", input: { annee: "2026", zone: "metropole" }, output: { example: { annee: "2026", jours: [{ date: "2026-01-01", nom: "1er janvier" }] } } } },
  { route: "GET /v1/fr/georisques", price: "$0.02", desc: "Natural & technological risks for a French commune (flood, seismic, industrial...). Query: ?insee=",
    bazaar: { method: "GET", input: { insee: "97120" }, output: { example: { insee: "97120", risques: [{ libelle: "Séisme" }] } } } },
  { route: "GET /v1/fr/carburants", price: "$0.01", desc: "Live fuel prices at stations near a French postal code (gazole, SP95/98, E85, GPL). Query: ?cp=",
    bazaar: { method: "GET", input: { cp: "97110" }, output: { example: { cp: "97110", stations: [{ nom: "Station", prix: { gazole: 1.7 } }] } } } },
  { route: "GET /v1/fr/etablissements", price: "$0.02", desc: "French company HQ + establishment counts by SIREN (SIRET, address, status). Query: ?siren=",
    bazaar: { method: "GET", input: { siren: "306138900" }, output: { example: { siren: "306138900", nb_etablissements: 385, siege: { siret: "30613890001294" } } } } },
  { route: "GET /v1/fr/association", price: "$0.02", desc: "Search French associations (RNA) by name: SIREN, RNA id, creation date, city. Query: ?q=",
    bazaar: { method: "GET", input: { q: "Croix Rouge" }, output: { example: { total: 42, results: [{ nom: "CROIX ROUGE FRANCAISE" }] } } } },
  { route: "GET /v1/fr/dpe", price: "$0.02", desc: "Energy performance diagnostics (DPE/GES labels) for dwellings in a French area. Query: ?insee= or ?cp=",
    bazaar: { method: "GET", input: { cp: "97110" }, output: { example: { results: [{ adresse: "...", etiquette_dpe: "D", etiquette_ges: "B" }] } } } },
  { route: "GET /v1/fr/vacances-scolaires", price: "$0.005", desc: "French school holidays by zone and year. Query: ?zone=&annee=",
    bazaar: { method: "GET", input: { zone: "Zone A", annee: "2025-2026" }, output: { example: { zone: "Zone A", vacances: [{ description: "Vacances de la Toussaint" }] } } } },
  { route: "GET /v1/fr/ecoles", price: "$0.01", desc: "French schools directory lookup by name or postal code (type, status, address, phone). Query: ?q= or ?cp=",
    bazaar: { method: "GET", input: { cp: "97110" }, output: { example: { results: [{ nom: "Lycée", type: "Lycée", ville: "Pointe-à-Pitre" }] } } } },
  { route: "GET /v1/fr/iban", price: "$0.005", desc: "Validate an IBAN (mod-97 checksum), returns country and French bank code. Query: ?iban=",
    bazaar: { method: "GET", input: { iban: "FR7630006000011234567890189" }, output: { example: { iban: "FR76...", valid: true, pays: "FR" } } } },
  { route: "GET /v1/fr/codes-postaux", price: "$0.005", desc: "Map a French postal code to its communes (name + INSEE code). Query: ?cp=",
    bazaar: { method: "GET", input: { cp: "97110" }, output: { example: { cp: "97110", communes: [{ nom: "Pointe-à-Pitre", insee: "97120" }] } } } },
  { route: "GET /v1/fr/cadastre", price: "$0.01", desc: "French cadastral parcel at given coordinates: parcel id, section, number, surface (IGN). Query: ?lat=&lon=",
    bazaar: { method: "GET", input: { lat: "48.8606", lon: "2.3364" }, output: { example: { idu: "75101000AI0002", section: "AI", contenance_m2: 4322 } } } },
  { route: "GET /v1/fr/valeurs-foncieres", price: "$0.02", desc: "Real French real-estate sale prices (DVF) for a commune: date, price, surface, type. Query: ?insee=&annee=",
    bazaar: { method: "GET", input: { insee: "75101", annee: "2023" }, output: { example: { insee: "75101", total: 478, mutations: [{ date: "2023-06-01", valeur_fonciere: 258000, surface_bati_m2: 22 }] } } } },
  { route: "GET /v1/fr/insee-commune", price: "$0.01", desc: "INSEE commune stats: population, area, computed density, department, region, EPCI. Query: ?insee=",
    bazaar: { method: "GET", input: { insee: "97120" }, output: { example: { insee: "97120", nom: "Pointe-à-Pitre", population: 15040, densite_hab_km2: 5419 } } } },
  { route: "GET /v1/fr/meteo", price: "$0.005", desc: "Current weather + up to 7-day forecast for any coordinates (France & overseas), French descriptions. Query: ?lat=&lon=&jours=",
    bazaar: { method: "GET", input: { lat: "16.24", lon: "-61.53", jours: "3" }, output: { example: { actuel: { temperature: 30.7, description: "Principalement clair" }, previsions: [{ date: "2026-07-22", tmax: 31 }] } } } },
  { route: "GET /v1/fr/rge", price: "$0.02", desc: "RGE-certified renovation contractors near a French postal code (name, trade, phone, email). Query: ?cp=&domaine=",
    bazaar: { method: "GET", input: { cp: "97110", domaine: "Isolation" }, output: { example: { cp: "97110", artisans: [{ nom: "EURL X", domaine: "Isolation", telephone: "0590..." }] } } } },
  { route: "GET /v1/fr/rge-check", price: "$0.01", desc: "Check whether a French company (by SIRET) is RGE-certified, with its qualifications. Query: ?siret=",
    bazaar: { method: "GET", input: { siret: "49974034800028" }, output: { example: { siret: "49974034800028", rge: true, qualifications: [{ domaine: "Architecte" }] } } } },
  { route: "GET /v1/fr/transport", price: "$0.01", desc: "Public-transit & mobility open datasets for a French area with GTFS/NeTEx/GBFS feed URLs. Query: ?q=",
    bazaar: { method: "GET", input: { q: "Guadeloupe" }, output: { example: { query: "Guadeloupe", datasets: [{ titre: "...", type: "public-transit", feeds: [{ format: "GTFS", url: "https://..." }] }] } } } },
  { route: "GET /v1/fr/irve", price: "$0.01", desc: "EV charging stations in a French commune: operator, power, connectors, access, coords (IRVE). Query: ?insee=",
    bazaar: { method: "GET", input: { insee: "75101" }, output: { example: { insee: "75101", bornes: [{ station: "QPARK RIVOLI", operateur: "IZIVIA", puissance_kw: 22 }] } } } },
  { route: "GET /v1/fr/bodacc", price: "$0.02", desc: "BODACC legal announcements for a French company by SIREN (filings, sales, insolvency, changes). Query: ?siren=",
    bazaar: { method: "GET", input: { siren: "306138900" }, output: { example: { siren: "306138900", total: 98, annonces: [{ date: "2026-07-09", type: "Avis initial", famille: "Dépôts des comptes" }] } } } },
  { route: "GET /v1/fr/bio", price: "$0.02", desc: "Certified organic (AB) operators in France by department and/or text search: farms, processors, productions. Query: ?departement=&q=",
    bazaar: { method: "GET", input: { departement: "971", q: "vignoble" }, output: { example: { total: 475, operateurs: [{ nom: "...", numeroBio: 136219, activites: ["Production"] }] } } } },

  // ===== APIs composites (valeur = agrégation / calcul, pas la donnée brute) =====
  { route: "GET /v1/fr/entreprise-360/partial", price: "$0.02", desc: "LITE version of entreprise-360 (identity, HQ city, establishments count, legal notices count). Try cheap, upgrade to /v1/fr/entreprise-360 for officers, finances, RGE. Query: ?q= or ?siren=",
    bazaar: { method: "GET", input: { q: "Decathlon" }, output: { example: { identite: { denomination: "DECATHLON" }, annonces_legales_total: 45, _partial: true } } } },
  { route: "GET /v1/fr/entreprise-360", price: "$0.04", desc: "Full French company report in ONE call: identity, VAT, HQ, officers, establishments, finances, legal notices (BODACC), RGE cert. Aggregates 3 sources. Free trial: /free/entreprise-360. Query: ?q= or ?siren=",
    bazaar: { method: "GET", input: { q: "Decathlon" }, output: { example: { found: true, identite: { siren: "306138900", tva: "FR51306138900" }, annonces_legales: { total: 98 } } } } },
  { route: "GET /v1/fr/estimation-immo", price: "$0.05", desc: "Real-estate price estimate (AVM) computed from real DVF sale comparables: €/m² median + range and value for a surface. Free trial: /free/estimation-immo. Query: ?adresse=&surface=&type=appartement|maison",
    bazaar: { method: "GET", input: { adresse: "10 rue de Rivoli Paris", surface: "50", type: "appartement" }, output: { example: { ville: "Paris", prix_m2: { median: 12110 }, estimation: { valeur_estimee: 605476 } } } } },
  { route: "GET /v1/fr/bilans", price: "$0.06", desc: "French company annual accounts & financial statements (revenue, net income, capital) + list of filed accounts, via INPI RNE (auth-gated source). Query: ?siren=",
    bazaar: { method: "GET", input: { siren: "306138900" }, output: { example: { siren: "306138900", denomination: "DECATHLON", comptes_annuels_deposes: [{ date_cloture: "2024-12-31" }] } } } },
  { route: "GET /v1/fr/procedures-collectives", price: "$0.03", desc: "Is this French company in insolvency proceedings (sauvegarde, redressement, liquidation judiciaire)? Official BODACC court announcements: synthetic status, full judgment history, RCS deregistration flag. The #1 B2B check before signing. Query: ?siren=",
    bazaar: { method: "GET", input: { siren: "812501419" }, output: { example: { siren: "812501419", statut: "procedure_cloturee", alerte: false, procedures: [{ famille: "Jugement de clôture", nature: "Jugement de clôture pour insuffisance d'actif", date_jugement: "2026-07-10" }] } } } },
  { route: "GET /v1/fr/score-entreprise/partial", price: "$0.02", desc: "LITE version of score-entreprise: score 0-100 + level + insolvency count only. Upgrade to /v1/fr/score-entreprise for factor breakdown & financials. Query: ?q= or ?siren=",
    bazaar: { method: "GET", input: { q: "Decathlon" }, output: { example: { siren: "306138900", score: 82, niveau: "solide", _partial: true } } } },
  { route: "GET /v1/fr/score-entreprise", price: "$0.08", desc: "Company solidity/risk score 0-100 for a French company: crosses INPI financials (revenue/profit trend), BODACC legal proceedings, age, status. Replaces a paid solvency report. Free trial: /free/score-entreprise. Query: ?q= or ?siren=",
    bazaar: { method: "GET", input: { q: "Decathlon" }, output: { example: { siren: "306138900", score: 82, niveau: "solide" } } } },
  { route: "GET /v1/fr/analyse-immo/partial", price: "$0.03", desc: "LITE version of analyse-immo: median price/m2, estimated value, investment score. Upgrade to /v1/fr/analyse-immo for energy, risks, demographics, yield. Query: ?adresse=&surface=",
    bazaar: { method: "GET", input: { adresse: "10 rue de Rivoli Paris", surface: "50" }, output: { example: { prix_m2_median: 12110, valeur_estimee: 605476, score_investissement: 73, _partial: true } } } },
  { route: "GET /v1/fr/analyse-immo", price: "$0.08", desc: "Real-estate investment scorecard for an address: DVF value estimate + energy (DPE) + natural risks + demographics + rental yield estimate. Query: ?adresse=&surface=&type=appartement|maison",
    bazaar: { method: "GET", input: { adresse: "10 rue de Rivoli Paris", surface: "50" }, output: { example: { ville: "Paris", estimation: { prix_m2_median: 12110 }, score_investissement: 73 } } } },
  { route: "GET /v1/fr/kyb/partial", price: "$0.03", desc: "LITE version of kyb: compliance verdict + VAT VIES validity + insolvency + red-flag count. Upgrade to /v1/fr/kyb for full dossier (officers, financials, flags detail). Query: ?q= or ?siren=",
    bazaar: { method: "GET", input: { q: "Decathlon" }, output: { example: { siren: "306138900", verdict: "CONFORME", tva_validee_vies: true, _partial: true } } } },
  { route: "GET /v1/fr/kyb", price: "$0.10", desc: "Know-Your-Business compliance dossier for a French company in one call: identity, VAT + VIES validation, officers, financial health (INPI), legal proceedings (BODACC), risk verdict. Free trial: /free/kyb. Query: ?q= or ?siren=",
    bazaar: { method: "GET", input: { q: "Decathlon" }, output: { example: { siren: "306138900", verdict: "CONFORME", fiscal: { tva_validee_vies: true } } } } },
  { route: "GET /v1/fr/etude-implantation", price: "$0.12", desc: "Business location study: competitor saturation (same activity in commune), demographics, commercial real-estate prices, opportunity score. Query: ?activite=&commune=",
    bazaar: { method: "GET", input: { activite: "boulangerie", commune: "Pointe-à-Pitre" }, output: { example: { commune: "Pointe-à-Pitre", concurrents_actifs: 56, habitants_par_concurrent: 268, score_opportunite: 45 } } } },
  { route: "GET /v1/fr/reseau-dirigeant", price: "$0.08", desc: "All French companies linked to a person (director search) with active/ceased flags and fraud-risk level. Query: ?nom=&prenom=",
    bazaar: { method: "GET", input: { nom: "Arnault", prenom: "Bernard" }, output: { example: { total_societes: 40, cessees: 2, niveau_alerte: "modérée" } } } },
  { route: "GET /v1/fr/concurrents", price: "$0.08", desc: "Competitive landscape of a French company: same-NAF rivals in its area ranked by revenue, with CA position. Query: ?q= or ?siren= &zone=departement|region",
    bazaar: { method: "GET", input: { q: "Decathlon", zone: "departement" }, output: { example: { total_marche: 297, top_concurrents: [{ nom: "...", finances: { ca: 1000000 } }] } } } },
  { route: "GET /v1/fr/verif-artisan", price: "$0.08", desc: "Verify a French contractor before hiring: company health, age, RGE certification, insolvency proceedings, trust level. Query: ?q= or ?siren=",
    bazaar: { method: "GET", input: { q: "EURL LAURENT LAVALL" }, output: { example: { confiance: "élevée", certifie_rge: true, procedures_collectives: 0 } } } },
  { route: "GET /v1/fr/valorisation", price: "$0.10", desc: "Company valuation estimate from public financials (revenue & earnings multiples), with range. Query: ?q= or ?siren=",
    bazaar: { method: "GET", input: { q: "Decathlon" }, output: { example: { chiffre_affaires: 16207285000, valorisation: { estimation_centrale: 15000000000 } } } } },
  { route: "GET /v1/uk/company", price: "$0.02", desc: "UK company profile (Companies House): status, incorporation, SIC codes, registered office, accounts due dates, insolvency/charges flags. Query: ?q= or ?number=",
    bazaar: { method: "GET", input: { q: "Tesco PLC" }, output: { example: { company_number: "00445790", name: "TESCO PLC", status: "active" } } } },
  { route: "GET /v1/uk/officers", price: "$0.02", desc: "UK company directors/officers (Companies House): name, role, appointment/resignation, nationality. Query: ?q= or ?number=",
    bazaar: { method: "GET", input: { number: "00445790" }, output: { example: { total: 12, officers: [{ name: "...", role: "director" }] } } } },
  { route: "GET /v1/uk/psc", price: "$0.03", desc: "UK beneficial owners — Persons with Significant Control (Companies House), key for KYB/AML. Query: ?q= or ?number=",
    bazaar: { method: "GET", input: { number: "00445790" }, output: { example: { total: 1, controllers: [{ name: "...", nature_of_control: ["ownership-of-shares-75-to-100-percent"] }] } } } },
  { route: "GET /v1/uk/company-check", price: "$0.08", desc: "UK company KYB verdict in one call: status, accounts/filing compliance, insolvency history, officers, beneficial owners. Query: ?q= or ?number=",
    bazaar: { method: "GET", input: { q: "Tesco PLC" }, output: { example: { name: "TESCO PLC", verdict: "PASS", active_officers: 12 } } } },
  { route: "GET /v1/us/company", price: "$0.02", desc: "US public company profile (SEC EDGAR): name, CIK, tickers, exchange, SIC, state, fiscal year, latest filing. Query: ?ticker= or ?cik=",
    bazaar: { method: "GET", input: { ticker: "AAPL" }, output: { example: { cik: "0000320193", name: "Apple Inc.", exchanges: ["Nasdaq"] } } } },
  { route: "GET /v1/us/financials", price: "$0.05", desc: "US public company key annual financials from SEC XBRL: revenue, net income, assets, liabilities, equity, cash (3 years). Query: ?ticker= or ?cik=",
    bazaar: { method: "GET", input: { ticker: "AAPL" }, output: { example: { name: "Apple Inc.", net_income: [{ end: "2025-09-27", value: 112010000000 }] } } } },
  { route: "GET /v1/us/filings", price: "$0.02", desc: "Recent SEC filings for a US company (10-K, 10-Q, 8-K...) with dates and document URLs. Query: ?ticker= or ?cik= &type=",
    bazaar: { method: "GET", input: { ticker: "AAPL", type: "10-K" }, output: { example: { name: "Apple Inc.", filings: [{ form: "10-K", filed: "2025-11-01" }] } } } },
  { route: "GET /v1/us/snapshot", price: "$0.06", desc: "One-call US company financial snapshot: revenue, growth, net income, margin, ROE, profitability from SEC XBRL. Query: ?ticker= or ?cik=",
    bazaar: { method: "GET", input: { ticker: "AAPL" }, output: { example: { name: "Apple Inc.", revenue_growth_pct: 6.2, net_margin_pct: 24.3 } } } },
];

// Google Maps local business scraper — via IP résidentielle FR (Google bloque les datacenters).
// Un appel = une recherche activité+lieu -> jusqu'à 120 fiches. Attention : le feed Maps
// ne porte ni téléphone, ni site, ni nombre d'avis ; ces champs viennent d'une 2e passe
// (une navigation par fiche) plafonnée par detailsMax -> d'où le champ `enriched`.
CATALOG.push({
  route: "GET /v1/maps", price: "$0.03",
  desc: "Google Maps local business scraper via a FRENCH RESIDENTIAL IP (Google blocks datacenter IPs). One call = one activity+location search -> up to 120 businesses with name, rating, category, address, Maps URL. The first `detailsMax` results (default 25, max 60) are also enriched with phone, website and review count; beyond that these three fields are null. Query: ?q=<activity>&location=<city>&max=&detailsMax=&details=false (feed only, faster)",
  bazaar: { method: "GET", input: { q: "plombier", location: "Bordeaux" }, output: { example: { source: "google_maps", count: 20, enriched: 20, results: [{ name: "JFS Plombier Bordeaux", rating: 4.9, reviews: 120, category: "Plombier", address: "12 Rue Sainte-Catherine, 33000 Bordeaux", phone: "06 48 56 65 03", website: "https://…", bookingUrl: null, placeId: "ChIJ…", mapsUrl: "https://www.google.com/maps/place/…" }] } } },
});

// LEADS QUALIFIÉS : croise Google Maps résidentiel (contact) + registre officiel des entreprises
// (SIREN, dirigeants, ancienneté, santé) + scoring. Infaisable pour un dev seul (IP résidentielle +
// registre + orchestration). Un appel = jusqu'à 30 leads B2B enrichis et notés HOT/WARM/COLD.
CATALOG.push({
  route: "GET /v1/fr/qualified-leads", price: "$0.25",
  desc: "Qualified French B2B leads in one call: finds businesses by activity+city (Google Maps via residential IP -> phone, website, rating) then CROSS-REFERENCES each with the official company registry (SIREN, legal form, NAF, directors, age, status) and scores them HOT/WARM/COLD. A full call list + qualification a solo dev can't assemble (needs residential IP + registry + orchestration). Query: ?activity=&location=&max=",
  bazaar: { method: "GET", input: { activity: "plombier", location: "Bordeaux" }, output: { example: { count: 12, summary: { registryMatched: 9, hot: 5 }, leads: [{ name: "…", phone: "05…", website: "https://…", company: { siren: "…", dateCreation: "2012-05-02", ageYears: 14, dirigeants: [{ nom: "…", qualite: "Gérant" }] }, score: 85, tier: "HOT" }] } } },
});

// Amazon product & search via IP résidentielle + navigateur furtif (Amazon fingerprinte les bots datacenter).
CATALOG.push({
  route: "GET /v1/amazon", price: "$0.02",
  desc: "Amazon product & search scraper via a residential IP + stealth browser (bypasses Amazon bot detection). Product mode (?asin= or ?url=) -> title, price, rating, reviews, brand, image. Search mode (?q=) -> up to 60 products with price/rating. Great for price monitoring & competitive intel.",
  bazaar: { method: "GET", input: { asin: "B09XS7JWHH" }, output: { example: { source: "amazon.fr", mode: "product", product: { title: "Sony WH-1000XM5", price: "€204.92", priceValue: 204.92, rating: 4.3, reviews: 12614 } } } },
});
// Immobilier FR (annonces / prix affichés) via Bien'ici — source protégée anti-bot (datacenters bloqués).
CATALOG.push({
  route: "GET /v1/fr/immo", price: "$0.03",
  desc: "French real-estate listings (asking prices) from Bien'ici via a residential IP (datacenter IPs are blocked). One call = one city search -> listings with type, rooms, surface, price, €/m², postal code, URL + a median asking €/m². Pairs with /v1/fr/estimation-immo (DVF sold prices) to compare asking vs sold. Query: ?city=&cp=&type=achat|location",
  bazaar: { method: "GET", input: { city: "Bordeaux", cp: "33000" }, output: { example: { source: "bienici.com", count: 25, summary: { medianAskingPricePerM2: 4602 }, listings: [{ type: "Appartement", rooms: 4, surface: 132, price: 635000, pricePerM2: 4602, postalCode: "33100" }] } } },
});

// Routes à clé amont : n'apparaissent (catalogue + paywall + MCP) que si la clé est configurée.
if (process.env.SERPER_API_KEY) {
  CATALOG.push({
    route: "GET /v1/search", price: "$0.003",
    desc: "Cheap web search (real Google results via Serper): top 10 organic results + answer box + knowledge graph. Cheaper than Exa /search on x402. Query: ?q=&gl=&hl=",
    bazaar: { method: "GET", input: { q: "x402 protocol" }, output: { example: { results: [{ title: "x402", url: "https://x402.org", snippet: "…" }] } } },
  });
  CATALOG.push({
    route: "GET /v1/search/news", price: "$0.003",
    desc: "Fresh news search (Google News via Serper): latest headlines with source, date, snippet. Great for crypto/market/current-events agents. Query: ?q=&gl=&hl=",
    bazaar: { method: "GET", input: { q: "bitcoin" }, output: { example: { news: [{ title: "…", link: "…", date: "1h ago", source: "…" }] } } },
  });
}
if (process.env.OPENAI_API_KEY || process.env.LLM_API_KEY) {
  CATALOG.push({
    route: "POST /v1/llm", price: "$0.002",
    desc: "Cheap LLM inference pay-per-call, no account, no API key: prompt in, completion out (DeepSeek v4, up to 2000 output tokens). Among the lowest $/call on x402. Body: {prompt, system?, max_tokens?}",
    bazaar: { bodyType: "json", method: "POST", input: { prompt: "Summarize x402 in one sentence" }, output: { example: { output: "x402 lets agents pay APIs per call in stablecoins.", usage: { output_tokens: 18 } } } },
  });
  CATALOG.push({
    route: "GET /v1/extract-structured", price: "$0.015",
    desc: "URL + wanted fields -> clean JSON. Scrapes the page from a French residential IP (reaches sites that block datacenters) and uses an LLM to return exactly the fields you ask for. The 'scrape into this shape' call agents love (Firecrawl-extract territory), cheaper. Query: ?url=&fields=price,rating,stock (or ?schema=free-text)",
    bazaar: { method: "GET", input: { url: "https://example.com", fields: "title,price" }, output: { example: { url: "https://…", data: { title: "…", price: 19.9 } } } },
  });
  CATALOG.push({
    route: "POST /v1/llm/pro", price: "$0.006",
    desc: "Smart LLM inference (DeepSeek v4 Pro): stronger reasoning for hard prompts, up to 2000 output tokens, no account. Body: {prompt, system?, max_tokens?}",
    bazaar: { bodyType: "json", method: "POST", input: { prompt: "Explain the tradeoffs of x402 vs API keys" }, output: { example: { output: "…", usage: { output_tokens: 300 } } } },
  });
}
