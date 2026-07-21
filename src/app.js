import express from "express";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import webRoutes from "./routes/web.js";
import dataRoutes from "./routes/data.js";
import { cacheStats } from "./lib/cache.js";
import { closeBrowser } from "./lib/browser.js";

const PORT = Number(process.env.PORT || 3402);
const PAY_TO = process.env.PAY_TO || "";
// eip155:84532 = Base Sepolia (testnet) — passer à eip155:8453 (Base mainnet) pour encaisser en vrai
const NETWORK = process.env.NETWORK || "eip155:84532";
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.org/facilitator";

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

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "256kb" }));

// Compteur d'appels par route (le radar lira ça)
const hits = {};
app.use((req, _res, next) => {
  const key = `${req.method} ${req.path}`;
  hits[key] = (hits[key] || 0) + 1;
  next();
});

// Routes gratuites : vitrine machine-lisible + santé + stats
app.get("/", (_req, res) =>
  res.json({
    name: "x402-farm",
    payment: PAY_TO ? { protocol: "x402", network: NETWORK, payTo: PAY_TO } : { mode: "FREE (no PAY_TO configured)" },
    endpoints: CATALOG,
  })
);
app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime(), cache: cacheStats() }));
// Selftest navigateur (URL fixe, aucune donnée utile -> pas d'abus possible)
app.get("/selftest", async (_req, res) => {
  try {
    const { withPage } = await import("./lib/browser.js");
    const title = await withPage("https://example.com", (page) => page.title());
    res.json({ browser: "ok", title });
  } catch (e) {
    res.status(500).json({ browser: "fail", error: String(e).slice(0, 300) });
  }
});
app.get("/stats", (_req, res) => res.json({ hits }));

if (PAY_TO) {
  // Mainnet -> facilitateur Coinbase CDP authentifié (verify/settle + indexation Bazaar).
  // Testnet -> facilitateur public x402.org.
  let facilitatorConfig = { url: FACILITATOR_URL };
  if (NETWORK === "eip155:8453") {
    const { facilitator } = await import("@coinbase/x402");
    facilitatorConfig = facilitator;
  }
  const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);
  const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());
  const routes = Object.fromEntries(
    CATALOG.map((e) => [
      e.route,
      {
        accepts: { scheme: "exact", price: e.price, network: NETWORK, payTo: PAY_TO },
        description: e.desc,
        ...(e.bazaar ? { extensions: declareDiscoveryExtension(e.bazaar) } : {}),
      },
    ])
  );
  app.use(paymentMiddleware(routes, resourceServer));
  console.log(`[x402] paywall ON — ${NETWORK} -> ${PAY_TO} via ${facilitatorConfig.url}`);
} else {
  console.warn("[x402] PAY_TO absent — mode GRATUIT (dev/test uniquement)");
}

app.use(webRoutes);
app.use(dataRoutes);

export default app;
