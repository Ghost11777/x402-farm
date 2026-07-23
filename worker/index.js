// Worker Mac mini : exécute les routes "lourdes" (navigateur, IP résidentielle,
// sessions loggées) que Vercel proxifie via Cloudflare Tunnel. PAS de paywall ici :
// il est privé, joignable uniquement par Vercel qui présente le WORKER_SECRET.
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Charge worker/.env (WORKER_SECRET, INPI_USERNAME/PASSWORD…) sans dépendance :
// le plist launchd n'injecte que le secret, le reste vit ici.
try {
  const envFile = readFileSync(join(dirname(fileURLToPath(import.meta.url)), ".env"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=("?)(.*)\2$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[3];
  }
} catch {}

const { default: webRoutes } = await import("../src/routes/web.js");
const { default: inpiRoutes } = await import("../src/routes/inpi.js");
const { default: mapsRoutes } = await import("../src/routes/maps.js");
const { default: amazonRoutes } = await import("../src/routes/amazon.js");
const { default: immoRoutes } = await import("../src/routes/immo.js");
const { default: leboncoinRoutes } = await import("../src/routes/leboncoin.js");

const PORT = Number(process.env.WORKER_PORT || 4020);
const SECRET = process.env.WORKER_SECRET || "";

const app = express();
app.use(express.json({ limit: "256kb" }));

// Auth : seul Vercel (qui connaît le secret) peut appeler. /health reste ouvert.
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (!SECRET || req.get("x-worker-secret") !== SECRET) {
    return res.status(401).json({ error: "unauthorized_worker" });
  }
  next();
});

app.get("/health", (_req, res) =>
  res.json({ ok: true, role: "worker", uptime: process.uptime(), inpi: !!process.env.INPI_USERNAME }));

// Traçabilité : permet de vérifier depuis l'extérieur qu'une réponse vient bien du mini
app.use((_req, res, next) => { res.set("x-served-by", "macmini-worker"); next(); });

// Les mêmes routes navigateur que Vercel — mais ici Playwright tourne pour de vrai,
// avec l'IP résidentielle de la box et (à venir) des contextes navigateur connectés.
app.use(webRoutes);
// Google Maps : scrape local via l'IP résidentielle (Google bloque les datacenters)
app.use(mapsRoutes);
// Amazon + immo (Bien'ici) : navigateur furtif anti-anti-bot sur l'IP résidentielle
app.use(amazonRoutes);
app.use(immoRoutes);
app.use(leboncoinRoutes);
// INPI RNE : appelé depuis l'IP résidentielle (l'INPI tolère mal les IP datacenter)
app.use(inpiRoutes);

app.listen(PORT, "127.0.0.1", () =>
  console.log(`[worker] x402-farm worker sur 127.0.0.1:${PORT} (tunnel Cloudflare devant)`)
);
