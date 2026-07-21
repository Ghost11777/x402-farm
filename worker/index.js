// Worker Mac mini : exécute les routes "lourdes" (navigateur, IP résidentielle,
// sessions loggées) que Vercel proxifie via Cloudflare Tunnel. PAS de paywall ici :
// il est privé, joignable uniquement par Vercel qui présente le WORKER_SECRET.
import express from "express";
import webRoutes from "../src/routes/web.js";

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

app.get("/health", (_req, res) => res.json({ ok: true, role: "worker", uptime: process.uptime() }));

// Les mêmes routes navigateur que Vercel — mais ici Playwright tourne pour de vrai,
// avec l'IP résidentielle de la box et (à venir) des contextes navigateur connectés.
app.use(webRoutes);

app.listen(PORT, "127.0.0.1", () =>
  console.log(`[worker] x402-farm worker sur 127.0.0.1:${PORT} (tunnel Cloudflare devant)`)
);
