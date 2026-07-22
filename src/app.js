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
import { cacheStats } from "./lib/cache.js";
import { closeBrowser } from "./lib/browser.js";
import { logCall, analyticsEnabled } from "./lib/analytics.js";

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
          const body = Buffer.from(String(h), "base64").toString("utf8");
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

// Prix par "METHOD /path" pour reconnaître un appel payant et son montant
const PRICE_BY_ROUTE = Object.fromEntries(CATALOG.map((e) => [e.route, Number(e.price.replace("$", ""))]));

// Compteur en mémoire (fallback /stats) + logging persistant Supabase (fire-and-forget)
const hits = {};
const NOLOG = /^\/(dashboard|favicon|radar)/;
app.use((req, res, next) => {
  if (NOLOG.test(req.path)) return next();
  const startedAt = Date.now();
  const routeKey = `${req.method} ${req.path}`;
  hits[routeKey] = (hits[routeKey] || 0) + 1;
  res.on("finish", () => {
    const price = PRICE_BY_ROUTE[routeKey];
    const paid = price !== undefined && res.statusCode >= 200 && res.statusCode < 300;
    logCall(req, res, { startedAt, paid, amountUsd: price, freeTier: req.path.startsWith("/free/") });
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
app.use(freeRoutes);

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
  const routes = Object.fromEntries(
    CATALOG.map((e) => [
      e.route,
      {
        accepts: NETWORKS.map((n) => ({ scheme: "exact", price: e.price, network: n, payTo: PAY_TO })),
        description: e.desc,
        ...(e.bazaar ? { extensions: declareDiscoveryExtension({ ...e.bazaar, discoverable: true }) } : {}),
      },
    ])
  );
  app.use(paymentMiddleware(routes, resourceServer));
  console.log(`[x402] paywall ON — [${NETWORKS.join(", ")}] -> ${PAY_TO} via ${facilitatorConfig.url}`);
} else {
  console.warn("[x402] PAY_TO absent — mode GRATUIT (dev/test uniquement)");
}

app.use(webRoutes);
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
