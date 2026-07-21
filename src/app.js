import express from "express";
import { CATALOG } from "./catalog.js";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import webRoutes from "./routes/web.js";
import discoveryRoutes from "./routes/discovery.js";
import freeRoutes from "./routes/free.js";
import dataRoutes from "./routes/data.js";
import frdataRoutes from "./routes/frdata.js";
import { cacheStats } from "./lib/cache.js";
import { closeBrowser } from "./lib/browser.js";

const PORT = Number(process.env.PORT || 3402);
const PAY_TO = process.env.PAY_TO || "";
// eip155:84532 = Base Sepolia (testnet) — passer à eip155:8453 (Base mainnet) pour encaisser en vrai
const NETWORK = process.env.NETWORK || "eip155:84532";
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.org/facilitator";


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
app.get("/stats", (_req, res) => res.json({ hits }));
app.use(discoveryRoutes);
app.use(freeRoutes);

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
app.use(frdataRoutes);

export { CATALOG };
export default app;
