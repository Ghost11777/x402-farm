// Indexeur Bazaar : paie CHAQUE route du catalogue une fois (via facilitateur
// Coinbase) pour qu'elle soit indexée dans le Bazaar CDP sous api.x-402.online.
// Auto-construit la requête depuis catalog.bazaar.input. Usage : node index-all-routes.mjs
import { readFileSync } from "node:fs";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { CATALOG } from "./src/catalog.js";

const BASE = process.argv[2] || "https://api.x-402.online";
const NETWORK = "eip155:8453";
const ONLY_MISSING = process.argv.includes("--skip-indexed");

// routes déjà indexées sous vercel.app (bootstrap) — on peut les sauter si demandé
const ALREADY = new Set(["/v1/dns","/v1/email/validate","/v1/fr/entreprise","/v1/fr/geocode",
  "/v1/fr/jours-feries","/v1/fr/iban","/v1/us/company","/v1/us/financials","/v1/us/filings","/v1/us/snapshot"]);

const pk = readFileSync(".buyer.secret", "utf8").match(/BUYER_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)[1];
const account = privateKeyToAccount(pk);
console.log(`Indexeur ${account.address} -> ${BASE} (${NETWORK}) — ${CATALOG.length} routes\n`);

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
});

const qs = (obj) => Object.entries(obj || {}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

async function hit(entry) {
  const [method, path] = entry.route.split(" ");
  const b = entry.bazaar || {};
  let url = `${BASE}${path}`;
  const init = { method, signal: AbortSignal.timeout(35000) };
  if (method === "GET") {
    const query = qs(b.input);
    if (query) url += `?${query}`;
  } else {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(b.input || {});
  }
  const t0 = Date.now();
  try {
    const res = await fetchWithPayment(url, init);
    const ms = Date.now() - t0;
    const h = res.headers.get("payment-response") || res.headers.get("x-payment-response");
    let tx = null;
    if (h) { try { tx = decodePaymentResponseHeader(h)?.transaction; } catch {} }
    return { route: path, status: res.status, tx, ms };
  } catch (e) {
    return { route: path, status: "ERR", err: String(e).slice(0, 80), ms: Date.now() - t0 };
  }
}

const results = [];
for (const entry of CATALOG) {
  const path = entry.route.split(" ")[1];
  if (ONLY_MISSING && ALREADY.has(path)) { console.log(`[skip] ${path} (déjà indexé)`); continue; }
  const r = await hit(entry);
  const mark = r.tx ? "PAYÉ ✅" : (r.status === 200 ? "200 sans tx" : `échec ${r.status}${r.err ? " " + r.err : ""}`);
  console.log(`${String(entry.route).padEnd(34)} ${mark}${r.tx ? " " + r.tx.slice(0, 16) + "…" : ""}`);
  results.push(r);
  await new Promise((res) => setTimeout(res, 500));
}

const paid = results.filter((r) => r.tx);
const failed = results.filter((r) => !r.tx);
console.log(`\n=== ${paid.length}/${results.length} routes payées & indexables ===`);
if (failed.length) {
  console.log(`Non indexées (${failed.length}) : ${failed.map((r) => r.route + "(" + r.status + ")").join(", ")}`);
}
