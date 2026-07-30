// SEED D'INDEXATION BAZAAR — paie CHAQUE nouvelle route une fois (via facilitateur
// Coinbase) pour déclencher son indexation dans le Bazaar CDP. Ciblé sur les routes
// ajoutées le 2026-07-28 (pack crypto/DeFi + guard + due-diligence). Coût total ~$0.05.
// Wallet : ../.buyer.secret (mainnet Base, x402 gasless).
//
//   node seed-new-routes.mjs                 # paie et indexe les nouvelles routes
//   node seed-new-routes.mjs https://api.x-402.online
//
// ⚠️ Mouvement de fonds réel (USDC on-chain). À lancer par Laurent.
import { readFileSync } from "node:fs";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

// N'utilise argv[2] que si c'est une vraie URL http (zsh ne traite pas '#' comme commentaire
// en interactif -> un '# commentaire' collé après la commande arriverait ici sinon).
const argUrl = process.argv.find((a) => /^https?:\/\//.test(a));
const BASE = argUrl || "https://api.x-402.online";
const NETWORK = "eip155:8453";

const ROUTES = [
  ["GET", "/v1/crypto/token?address=0x4200000000000000000000000000000000000006&chain=base"],
  ["GET", "/v1/crypto/security?address=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48&chain=ethereum"],
  ["GET", "/v1/crypto/gas"],
  ["GET", "/v1/crypto/trending?chain=base"],
  ["GET", "/v1/crypto/new-pools?chain=base"],
  ["GET", "/v1/crypto/sentiment"],
  ["GET", "/v1/defi/yields?token=USDC&chain=base"],
  ["GET", "/v1/defi/protocol?protocol=aave"],
  ["GET", "/v1/guard?content=testcontent"], // pas d'espace/encodage : évite le mismatch %20 à la vérif du paiement x402
  ["GET", "/v1/fr/due-diligence?q=Decathlon"],
];

// Filtre optionnel : `node seed-new-routes.mjs /v1/guard` ne seede que les routes qui matchent.
const only = process.argv.find((a) => a.startsWith("/v1/"));

const pk = readFileSync(new URL("./.buyer.secret", import.meta.url), "utf8").match(/(?:BUYER_)?PRIVATE_KEY=(0x[0-9a-fA-F]+)/)[1];
const account = privateKeyToAccount(pk);
console.log(`Seed depuis ${account.address} -> ${BASE} (${NETWORK}) — ${ROUTES.length} routes\n`);

const pay = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }] });

let ok = 0, spent = 0;
const todo = only ? ROUTES.filter(([, p]) => p.startsWith(only)) : ROUTES;
for (const [method, path, body] of todo) {
  try {
    const init = { method };
    if (body) { init.headers = { "content-type": "application/json" }; init.body = JSON.stringify(body); }
    const t0 = Date.now();
    const res = await pay(`${BASE}${path}`, init);
    const ph = res.headers.get("payment-response") || res.headers.get("x-payment-response");
    let tx = "";
    if (ph) { try { tx = decodePaymentResponseHeader(ph)?.transaction?.slice(0, 18) || ""; } catch {} }
    console.log(`${res.status === 200 ? "✅" : "⚠️ "} ${path.split("?")[0].padEnd(28)} HTTP ${res.status} ${Date.now() - t0}ms ${tx ? "· tx " + tx + "…" : ""}`);
    if (res.status === 200) { ok++; if (ph) spent += 0.01; }
  } catch (e) {
    console.log(`❌ ${path.split("?")[0]} — ${String(e.message).slice(0, 80)}`);
  }
}
console.log(`\n${ok}/${todo.length} routes payées & servies. Elles s'indexeront dans le Bazaar sous peu.`);
console.log(`Vérifier ensuite : node check-bazaar-index.mjs`);
