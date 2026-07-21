// Le catalogue : 10 APIs, leur prix, leur description (sert aussi de page d'accueil découvrable)
const urlBody = { bodyType: "json", method: "POST", input: { url: "https://example.com" } };
export const CATALOG = [
  { route: "POST /v1/extract",       price: "$0.005", desc: "URL -> main content as clean markdown (JS-rendered, real browser). Input: {url}",
    bazaar: { ...urlBody, output: { example: { url: "https://example.com/", title: "Example Domain", markdown: "# Example Domain…" } } } },
  { route: "POST /v1/render",        price: "$0.005", desc: "URL -> full HTML after JavaScript execution. Input: {url}",
    bazaar: { ...urlBody, output: { example: { url: "https://example.com/", html: "<html>…</html>" } } } },
  { route: "POST /v1/screenshot",    price: "$0.01",  desc: "URL -> PNG screenshot. Input: {url, fullPage?}",
    bazaar: { bodyType: "json", method: "POST", input: { url: "https://example.com", fullPage: false } } },
  { route: "POST /v1/pdf",           price: "$0.01",  desc: "URL -> PDF (A4, backgrounds). Input: {url}",
    bazaar: urlBody },
  { route: "POST /v1/links",        price: "$0.005", desc: "URL -> deduplicated links, internal/external with anchor text. Input: {url}",
    bazaar: { ...urlBody, output: { example: { url: "https://example.com/", count: 1, internal: [], external: [{ href: "https://iana.org", text: "Learn more" }] } } } },
  { route: "POST /v1/meta",          price: "$0.005", desc: "URL -> SEO meta, OpenGraph, canonical, JSON-LD. Input: {url}",
    bazaar: { ...urlBody, output: { example: { url: "https://example.com/", title: "Example Domain", meta: {}, jsonLd: [] } } } },
  { route: "GET /v1/fr/entreprise",  price: "$0.02",  desc: "French company lookup by name or SIREN/SIRET: officers, NAF, HQ, status. Query: ?q=",
    bazaar: { method: "GET", input: { q: "Decathlon" }, output: { example: { query: "Decathlon", total: 151, results: [{ siren: "306138900", nom: "DECATHLON" }] } } } },
  { route: "GET /v1/fr/geocode",     price: "$0.005", desc: "Geocode any French address incl. overseas territories (lat/lon, score). Query: ?q=",
    bazaar: { method: "GET", input: { q: "Pointe-à-Pitre" }, output: { example: { results: [{ label: "Pointe-à-Pitre", lat: 16.23619, lon: -61.537759 }] } } } },
  { route: "GET /v1/dns",            price: "$0.005", desc: "Full DNS records for a domain: A, AAAA, MX, TXT, NS, SPF. Query: ?domain=",
    bazaar: { method: "GET", input: { domain: "example.com" }, output: { example: { domain: "example.com", a: ["1.2.3.4"], mx: [] } } } },
  { route: "GET /v1/email/validate", price: "$0.005", desc: "Email validation: syntax + domain MX check, no email sent. Query: ?email=",
    bazaar: { method: "GET", input: { email: "test@gmail.com" }, output: { example: { email: "test@gmail.com", valid: true, mx: "gmail-smtp-in.l.google.com" } } } },
];
