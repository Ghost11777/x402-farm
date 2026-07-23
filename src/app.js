import express from "express";
import { CATALOG } from "./catalog.js";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import webRoutes from "./routes/web.js";
import discoveryRoutes from "./routes/discovery.js";
import mcpRoutes from "./routes/mcp.js";
import freeRoutes from "./routes/free.js";
import dataRoutes from "./routes/data.js";
import frdataRoutes from "./routes/frdata.js";
import compositeRoutes from "./routes/composite.js";
import inpiRoutes from "./routes/inpi.js";
import bodaccRoutes from "./routes/bodacc.js";
import scoringRoutes from "./routes/scoring.js";
import intelRoutes from "./routes/intel.js";
import ukRoutes from "./routes/uk.js";
import usRoutes from "./routes/us.js";
import dashboardRoutes from "./routes/dashboard.js";
import radarRoutes from "./routes/radar.js";
import utilityRoutes from "./routes/utility.js";
import mapsRoutes from "./routes/maps.js";
import amazonRoutes from "./routes/amazon.js";
import immoRoutes from "./routes/immo.js";
import extractStructuredRoutes from "./routes/extract-structured.js";
import landingRoutes from "./routes/landing.js";
import leadsRoutes from "./routes/leads.js";
import enrichRoutes from "./routes/enrich.js";
import leboncoinRoutes from "./routes/leboncoin.js";
import { cacheStats } from "./lib/cache.js";
import { closeBrowser } from "./lib/browser.js";
import { logCall, analyticsEnabled } from "./lib/analytics.js";
import { buildTrialEligible, grantFreeCall } from "./lib/trial.js";

const PORT = Number(process.env.PORT || 3402);
const PAY_TO = process.env.PAY_TO || "";
// eip155:84532 = Base Sepolia (testnet) — passer à eip155:8453 (Base mainnet) pour encaisser en vrai
const NETWORK = process.env.NETWORK || "eip155:84532";
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.org/facilitator";


const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "256kb" }));

// Découvrabilité agent :
//  - header Link exposant nos surfaces machine-lisibles (api-catalog, openapi, llms, x402, mcp, agent-skills)
//  - l'enveloppe x402 (exigences de paiement) est aussi renvoyée dans le BODY du 402,
//    en plus du header PAYMENT-REQUIRED : certains clients x402 ne lisent que le body.
app.use((req, res, next) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.setHeader(
    "Link",
    [
      `<${base}/>; rel="api-catalog"; type="application/json"`,
      `<${base}/openapi.json>; rel="service-desc"; type="application/json"`,
      `<${base}/llms.txt>; rel="describedby"; type="text/plain"`,
      `<${base}/.well-known/x402>; rel="payment"`,
      `<${base}/.well-known/agent-skills.json>; rel="agent-skills"; type="application/json"`,
      `<${base}/.well-known/mcp>; rel="mcp-server"; type="application/json"`,
    ].join(", ")
  );
  const origEnd = res.end.bind(res);
  res.end = function (chunk, encoding, cb) {
    try {
      if (res.statusCode === 402 && !res.headersSent) {
        const h = res.getHeader("payment-required") || res.getHeader("PAYMENT-REQUIRED");
        const len = chunk ? Buffer.byteLength(chunk) : 0;
        if (h && len <= 2) {
          let body = Buffer.from(String(h), "base64").toString("utf8");
          // Conversion : proposer le chemin de moindre friction DANS le 402
          // (version LITE moins chère et/ou essai gratuit). Champ additif,
          // ignoré par les clients x402 stricts, lu par les agents curieux.
          const alt = ALTERNATIVES[req.path];
          if (alt) {
            try { body = JSON.stringify({ ...JSON.parse(body), alternatives: alt }); } catch { /* body non-JSON : inchangé */ }
          }
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("content-length", Buffer.byteLength(body));
          return origEnd(body, encoding, cb);
        }
      }
    } catch {
      /* en cas de souci on retombe sur le comportement d'origine */
    }
    return origEnd(chunk, encoding, cb);
  };
  next();
});

// Alternatives par route payante : version /partial moins chère (si elle existe au
// catalogue) + essai gratuit /free/* (si servi). Construit une fois au démarrage.
const FREE_ROUTES = new Set(["entreprise", "entreprise-360", "estimation-immo", "bilans", "score-entreprise", "analyse-immo", "kyb"]);
const ALTERNATIVES = (() => {
  const priceOf = Object.fromEntries(CATALOG.map((e) => [e.route.split(" ")[1], e.price]));
  const out = {};
  for (const e of CATALOG) {
    const path = e.route.split(" ")[1];
    if (path.endsWith("/partial")) continue;
    const alt = {};
    if (priceOf[`${path}/partial`]) {
      alt.cheaper_lite_version = { url: `${path}/partial`, price: priceOf[`${path}/partial`], note: "key decision fields only" };
    }
    const name = path.replace("/v1/fr/", "").replace("/v1/", "");
    if (FREE_ROUTES.has(name)) alt.free_trial = { url: `/free/${name}`, note: "limited sample, no payment" };
    if (Object.keys(alt).length) out[path] = alt;
  }
  return out;
})();

// Prix par "METHOD /path" pour reconnaître un appel payant et son montant
const PRICE_BY_ROUTE = Object.fromEntries(CATALOG.map((e) => [e.route, Number(e.price.replace("$", ""))]));
const PRICE_BY_PATH = Object.fromEntries(CATALOG.map((e) => [e.route.split(" ")[1], Number(e.price.replace("$", ""))]));

// Compteur en mémoire (fallback /stats) + logging persistant Supabase (fire-and-forget)
const hits = {};
// Les handlers lisent query (routes GET) ou body (routes POST) : on fusionne les
// deux sens pour que la méthode ne soit jamais un mur.
app.use("/v1", (req, res, next) => {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "method_not_allowed", allowed: ["GET", "POST"] });
  if (req.method === "GET" && (!req.body || !Object.keys(req.body).length)) req.body = { ...req.query };
  else if (req.method === "POST" && req.body) for (const [k, v] of Object.entries(req.body)) if (req.query[k] === undefined && (typeof v === "string" || typeof v === "number")) req.query[k] = String(v);
  next();
});

const NOLOG = /^\/(dashboard|favicon|radar)/;
app.use((req, res, next) => {
  if (NOLOG.test(req.path)) return next();
  const startedAt = Date.now();
  const routeKey = `${req.method} ${req.path}`;
  hits[routeKey] = (hits[routeKey] || 0) + 1;
  res.on("finish", () => {
    const price = PRICE_BY_ROUTE[routeKey] ?? PRICE_BY_PATH[req.path];
    // "payé" = le facilitateur a posé l'en-tête de règlement (preuve on-chain),
    // jamais déduit du seul statut 2xx (les HEAD passaient pour payés).
    const settled = !!(res.getHeader("payment-response") || res.getHeader("x-payment-response"));
    const paid = price !== undefined && settled && res.statusCode >= 200 && res.statusCode < 300;
    logCall(req, res, { startedAt, paid, amountUsd: price, freeTier: req.path.startsWith("/free/") || req._freeTrial === true || req._apiKey === true });
  });
  next();
});

// Routes gratuites : vitrine machine-lisible + santé + stats
app.get("/", (_req, res) =>
  res.json({
    name: "x402-farm",
    description:
      "The x402 farm for business & open data, agent-first. Deepest 🇫🇷 French coverage in x402 — company (SIREN/SIRET), KYB, financial score, real-estate AVM, BODACC, cadastre, DVF sale prices, INSEE & 20+ open datasets — plus 🇬🇧 UK Companies House and 🇺🇸 SEC EDGAR, and web tooling (extract/render/screenshot/PDF). Pay-per-call USDC, no account, no API key.",
    payment: PAY_TO ? { protocol: "x402", network: NETWORK, payTo: PAY_TO } : { mode: "FREE (no PAY_TO configured)" },
    discovery: { openapi: "/openapi.json", llms: "/llms.txt", mcp: "/mcp", well_known: "/.well-known/x402" },
    highlights: [
      "Cheap LLM inference from $0.002/call (DeepSeek v4) — among the lowest $/call on x402",
      "Real Google web + news search from $0.003/call",
      "Residential-IP web scraping (extract/render/screenshot/PDF) — rare on x402",
      "Deepest French company data (INPI, BODACC, KYB) + UK/US filings",
      "1 free call/day per client, all routes GET+POST, progressive /partial pricing",
    ],
    quickstart: {
      cheapest_probe: "POST /v1/llm {\"prompt\":\"...\"} — $0.002, or GET /v1/weather?city=Paris — $0.003",
      note: "All /v1 routes accept GET and POST. First daily call is free. Each 402 lists cheaper alternatives.",
      docs: "/llms.txt",
    },
    endpoints: CATALOG,
  })
);
app.get("/favicon.ico", (_req, res) => {
  res.type("image/x-icon").sendFile(new URL("../favicon.ico", import.meta.url).pathname);
});
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
app.get("/stats", (_req, res) => res.json({ hits, analytics: analyticsEnabled }));

// Dashboard analytics (revenu/conversion par route) — protégé par ADMIN_TOKEN.
// Utilise la clé service-role côté lecture (RLS bloque l'anon en SELECT).
app.get("/admin/analytics", async (req, res) => {
  const token = req.get("x-admin-token") || req.query.token;
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const key = process.env.SUPABASE_ANON_KEY;
  if (!process.env.SUPABASE_URL || !key) return res.status(503).json({ error: "analytics_not_configured" });
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/api_revenue_by_route?order=revenue_usd.desc`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    const rows = await r.json();
    const totalRevenue = rows.reduce?.((s, x) => s + Number(x.revenue_usd || 0), 0) || 0;
    const totalPaid = rows.reduce?.((s, x) => s + Number(x.paid_calls || 0), 0) || 0;
    res.json({ total_revenue_usd: totalRevenue, total_paid_calls: totalPaid, by_route: rows });
  } catch (e) {
    res.status(502).json({ error: String(e).slice(0, 200) });
  }
});
app.use(dashboardRoutes);
app.use(radarRoutes);
app.use(discoveryRoutes);
app.use(mcpRoutes);
app.use(landingRoutes);
app.use(freeRoutes);

// ===== Accès par clé API interne (canaux non-x402 : Apify, RapidAPI…) =====
// Une clé valide fait sauter le paywall x402 : le canal (Apify) facture l'utilisateur
// en fiat de son côté et nous reverse sa part ; notre backend sert la donnée.
// INTERNAL_API_KEYS = "chan1:cle1,chan2:cle2" (préfixe = nom du canal, pour l'analytics).
const API_KEYS = new Map(
  (process.env.INTERNAL_API_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean)
    .map((pair) => { const i = pair.indexOf(":"); return i > 0 ? [pair.slice(i + 1), pair.slice(0, i)] : [pair, "api"]; })
);
// RapidAPI proxifie les requêtes des abonnés en y ajoutant un secret partagé
// (X-RapidAPI-Proxy-Secret). Il facture l'abonné en fiat de son côté ; on sert la donnée.
const RAPIDAPI_SECRET = process.env.RAPIDAPI_PROXY_SECRET || "";
app.use((req, res, next) => {
  const key = req.get("x-api-key") || req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (key && API_KEYS.has(key)) { req._apiKey = true; req._apiChannel = API_KEYS.get(key); }
  else if (RAPIDAPI_SECRET && req.get("x-rapidapi-proxy-secret") === RAPIDAPI_SECRET) {
    req._apiKey = true; req._apiChannel = "rapidapi";
  }
  next();
});

// ===== 1er appel gratuit / jour / client (routes data <= $0.01) =====
const TRIAL_ELIGIBLE = buildTrialEligible(CATALOG);
app.use(async (req, res, next) => {
  if (req.method !== "GET" && req.method !== "POST") return next();
  if (!TRIAL_ELIGIBLE.has(req.path)) return next();
  const hasPayment = req.get("payment-signature") || req.get("x-payment");
  if (hasPayment) return next(); // il paie : ne pas gaspiller son quota gratuit
  if (await grantFreeCall(req)) {
    res.set("x-free-trial", "1 free call per client per day (data, search, LLM <= $0.01) - this one was on us");
    req._freeTrial = true; // fait sauter le paywall ci-dessous, la route sert la donnée normalement
  }
  next();
});

if (PAY_TO) {
  // Mainnet -> facilitateur Coinbase CDP authentifié (verify/settle + indexation Bazaar).
  // Testnet -> facilitateur public x402.org.
  let facilitatorConfig = { url: FACILITATOR_URL };
  const isMainnet = NETWORK === "eip155:8453";
  if (isMainnet) {
    const { facilitator } = await import("@coinbase/x402");
    facilitatorConfig = facilitator;
  }
  // En mainnet, on accepte plusieurs chaînes (Base + Polygon + Arbitrum) : l'agent paie
  // depuis celle qui lui est pratique. En testnet, uniquement le réseau de test.
  const NETWORKS = isMainnet
    ? (process.env.NETWORKS || "eip155:8453,eip155:137,eip155:42161").split(",").map((s) => s.trim())
    : [NETWORK];
  const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);
  let resourceServer = new x402ResourceServer(facilitatorClient);
  for (const n of NETWORKS) resourceServer = resourceServer.register(n, new ExactEvmScheme());
  // Tolérance de méthode : les agents sondent en GET des routes POST (24 visiteurs/72 h
  // sur extract/render/screenshot) et inversement. Chaque route /v1 est payable en GET ET POST.
  const routes = Object.fromEntries(
    CATALOG.flatMap((e) => {
      const val = {
        accepts: NETWORKS.map((n) => ({ scheme: "exact", price: e.price, network: n, payTo: PAY_TO })),
        description: e.desc,
        ...(e.bazaar ? { extensions: declareDiscoveryExtension({ ...e.bazaar, discoverable: true }) } : {}),
      };
      const [method, path] = e.route.split(" ");
      const other = method === "GET" ? "POST" : "GET";
      return [[e.route, val], [`${other} ${path}`, val]];
    })
  );
  const pm = paymentMiddleware(routes, resourceServer);
  app.use((req, res, next) => (req._freeTrial || req._apiKey ? next() : pm(req, res, next)));
  console.log(`[x402] paywall ON — [${NETWORKS.join(", ")}] -> ${PAY_TO} via ${facilitatorConfig.url}`);
} else {
  console.warn("[x402] PAY_TO absent — mode GRATUIT (dev/test uniquement)");
}

app.use(webRoutes);
app.use(mapsRoutes);
app.use(amazonRoutes);
app.use(immoRoutes);
app.use(extractStructuredRoutes);
app.use(leadsRoutes);
app.use(enrichRoutes);
app.use(leboncoinRoutes);
app.use(utilityRoutes);
app.use(dataRoutes);
app.use(frdataRoutes);
app.use(compositeRoutes);
app.use(inpiRoutes);
app.use(bodaccRoutes);
app.use(scoringRoutes);
app.use(intelRoutes);
app.use(ukRoutes);
app.use(usRoutes);

export { CATALOG };
export default app;
