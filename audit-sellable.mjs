// Chaque route du catalogue est-elle réellement vendable ?
// Sans paiement, on DOIT recevoir 402. Tout le reste est un bug commercial :
//   200 sans en-tête d'essai gratuit = fuite gratuite (revenu perdu)
//   404/405 = route annoncée mais pas servie (l'agent part)
//   5xx = casse (et pire : encaissement possible avant l'échec)
// On mesure aussi la taille du payload de paiement (le bug de ce soir).
import { CATALOG } from "./src/catalog.js";
const BASE = "https://api.x-402.online";
const rows = [];
for (const e of CATALOG) {
  const [method, path] = e.route.split(" ");
  const url = BASE + path + (e.bazaar?.input && method === "GET"
    ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(e.bazaar.input).map(([k, v]) => [k, String(v)]))).toString()
    : "");
  const init = { method };
  if (method === "POST") { init.headers = { "content-type": "application/json" }; init.body = JSON.stringify(e.bazaar?.input || {}); }
  let status = 0, free = "", size = 0, err = "";
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
    const r = await fetch(url, { ...init, signal: ctl.signal });
    clearTimeout(t);
    status = r.status;
    free = r.headers.get("x-free-trial") ? "essai-gratuit" : "";
    const h = r.headers.get("payment-required");
    if (h) size = Buffer.from(h, "base64").length;
  } catch (ex) { err = String(ex.message).slice(0, 40); }
  rows.push({ route: e.route, price: e.price, status, free, size, err });
}
const bad = rows.filter(r => r.status !== 402 && !r.free);
console.log(`${rows.length} routes testées — ${rows.length - bad.length} en 402 (vendables)\n`);
if (bad.length) {
  console.log("⚠️  ANOMALIES :");
  for (const r of bad) console.log(`  ${String(r.status || r.err).padEnd(6)} ${r.route.padEnd(38)} ${r.price}`);
} else console.log("Aucune anomalie de statut.");
const big = rows.filter(r => r.size > 1800).sort((a, b) => b.size - a.size);
console.log(`\nPayloads de paiement les plus lourds (limite empirique ~2 ko) :`);
for (const r of big.slice(0, 8)) console.log(`  ${String(r.size).padStart(5)} o  ${r.route}`);
const freeOnes = rows.filter(r => r.free);
if (freeOnes.length) console.log(`\n(${freeOnes.length} routes servies via l'essai gratuit du jour — comportement normal)`);
