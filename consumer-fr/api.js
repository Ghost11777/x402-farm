// API HTTP de l'agent de due-diligence FR.
//   POST /diligence   { "company": "Decathlon" }        -> dossier JSON
//   GET  /diligence?q=Decathlon[&format=md]              -> JSON (ou markdown)
//   GET  /health
//
// Réutilise le moteur diligence.js (dépense adaptative sur la ferme x402).
// Mode gratuit/payant hérité de l'env (X402_INTERNAL_KEY), voir README.
//
// Option monétisation : protéger derrière une clé API maison (API_TOKEN) pour vendre
// l'accès à des clients humains ; ou plus tard exposer la route EN x402 (payante pour agents).
import "dotenv/config";
import express from "express";
import { runDiligence } from "./diligence.js";
import { toMarkdown } from "./report.js";

const app = express();
app.use(express.json({ limit: "256kb" }));

const API_TOKEN = process.env.API_TOKEN || ""; // si défini -> Bearer requis
app.use((req, res, next) => {
  if (req.path === "/health" || !API_TOKEN) return next();
  const tok = req.get("authorization")?.replace(/^Bearer\s+/i, "") || req.query.token;
  if (tok !== API_TOKEN) return res.status(401).json({ error: "unauthorized" });
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "consumer-fr-diligence" }));

async function handle(company, format, res) {
  if (!company) return res.status(400).json({ error: "champ 'company' (nom ou SIREN) requis" });
  try {
    const d = await runDiligence(company);
    if (format === "md") { res.type("text/markdown"); return res.send(toMarkdown(d)); }
    return res.json(d);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

app.post("/diligence", (req, res) => handle(req.body?.company || req.body?.q, req.body?.format, res));
app.get("/diligence", (req, res) => handle(req.query.q || req.query.company, req.query.format, res));

const PORT = process.env.PORT || 8899;
app.listen(PORT, () => console.log(`consumer-fr API sur http://localhost:${PORT}  (mode ${process.env.X402_INTERNAL_KEY ? "gratuit/dev" : "payant USDC"})`));
