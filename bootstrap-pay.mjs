// Bootstrap mainnet : le wallet acheteur paie plusieurs APIs de la ferme en USDC
// sur Base (eip155:8453), pour créer un historique de transactions réel et varié.
// Le facilitateur Coinbase règle on-chain et paie le gas ; l'acheteur n'a besoin
// que d'USDC (aucun ETH). Usage : node bootstrap-pay.mjs [baseUrl]
import { readFileSync } from "node:fs";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.argv[2] || "https://x402-farm.vercel.app";
const NETWORK = "eip155:8453"; // Base mainnet

const pk = readFileSync(".buyer.secret", "utf8").match(/BUYER_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)[1];
const account = privateKeyToAccount(pk);
console.log(`Agent acheteur ${account.address} -> ${BASE} (${NETWORK})\n`);

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
});

async function buy(label, path) {
  const t0 = Date.now();
  try {
    const res = await fetchWithPayment(`${BASE}${path}`, { method: "GET" });
    const ms = Date.now() - t0;
    const payHeader = res.headers.get("payment-response") || res.headers.get("x-payment-response");
    let settled = null;
    if (payHeader) { try { settled = decodePaymentResponseHeader(payHeader); } catch {} }
    const body = await res.text();
    const tx = settled?.transaction;
    console.log(`[${label}] HTTP ${res.status} en ${ms}ms ${tx ? `— PAYÉ ✅ ${tx.slice(0, 18)}…` : "(pas payé)"}`);
    return { ok: res.status === 200, tx, label };
  } catch (e) {
    console.log(`[${label}] ERREUR: ${String(e).slice(0, 160)}`);
    return { ok: false, label };
  }
}

// Routes pures et publiques (aucune dépendance worker/navigateur, aucune clé tierce),
// paramètres tous différents -> ressemble à de l'exploration réelle et diverse.
const calls = [
  ["dns amazon",        "/v1/dns?domain=amazon.com"],
  ["dns cloudflare",    "/v1/dns?domain=cloudflare.com"],
  ["email openai",      "/v1/email/validate?email=hello@openai.com"],
  ["email anthropic",   "/v1/email/validate?email=support@anthropic.com"],
  ["FR entreprise LVMH","/v1/fr/entreprise?q=LVMH"],
  ["FR entreprise Airbus","/v1/fr/entreprise?q=Airbus"],
  ["FR geocode",        "/v1/fr/geocode?q=8+boulevard+du+Port+80000+Amiens"],
  ["FR commune Paris",  "/v1/fr/commune?code=75056"],
  ["FR codes-postaux",  "/v1/fr/codes-postaux?code=75001"],
  ["FR jours-feries",   "/v1/fr/jours-feries?year=2026"],
  ["FR iban",           "/v1/fr/iban?iban=FR7630006000011234567890189"],
  ["US company TSLA",   "/v1/us/company?ticker=TSLA"],
  ["US company NVDA",   "/v1/us/company?ticker=NVDA"],
  ["US filings AMZN",   "/v1/us/filings?ticker=AMZN"],
  ["US financials GOOGL","/v1/us/financials?ticker=GOOGL"],
];

const results = [];
for (const [label, path] of calls) {
  results.push(await buy(label, path));
  await new Promise((r) => setTimeout(r, 800)); // léger espacement -> plus naturel
}

const txs = results.filter((r) => r.tx);
console.log(`\n=== BILAN : ${txs.length}/${calls.length} appels payés on-chain ===`);
txs.forEach((r) => console.log(`  ${r.label.padEnd(22)} https://basescan.org/tx/${r.tx}`));
process.exit(txs.length > 0 ? 0 : 1);
