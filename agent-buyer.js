// Agent acheteur de test : paie nos APIs en USDC via x402, comme le ferait
// n'importe quel agent IA tiers. Usage : node agent-buyer.js [baseUrl]
import { readFileSync } from "node:fs";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.argv[2] || "http://localhost:3402";
const NETWORK = process.env.NETWORK || "eip155:84532";

const pk = readFileSync(".buyer.secret", "utf8").match(/BUYER_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)[1];
const account = privateKeyToAccount(pk);
console.log(`Agent acheteur ${account.address} -> ${BASE} (${NETWORK})\n`);

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
});

async function buy(label, path, init) {
  const t0 = Date.now();
  const res = await fetchWithPayment(`${BASE}${path}`, init);
  const ms = Date.now() - t0;
  const payHeader = res.headers.get("payment-response") || res.headers.get("x-payment-response");
  let settled = null;
  if (payHeader) {
    try { settled = decodePaymentResponseHeader(payHeader); } catch {}
  }
  const body = await res.text();
  console.log(`[${label}] HTTP ${res.status} en ${ms}ms ${settled ? `— payé, tx ${settled.transaction?.slice(0, 20)}…` : "(pas d'en-tête paiement)"}`);
  console.log(`  ${body.slice(0, 140).replace(/\n/g, " ")}\n`);
  return res.status;
}

const results = [];
results.push(await buy("extract", "/v1/extract", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ url: "https://example.com" }),
}));
results.push(await buy("entreprise FR", "/v1/fr/entreprise?q=Decathlon", { method: "GET" }));
results.push(await buy("dns", "/v1/dns?domain=google.com", { method: "GET" }));

const ok = results.every((s) => s === 200);
console.log(ok ? "✅ E2E PAIEMENT RÉUSSI : l'agent a payé et consommé les APIs" : "❌ échec, voir ci-dessus");
process.exit(ok ? 0 : 1);
