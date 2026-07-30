// Paiement d'amorçage UNIQUE d'une route, pour l'indexer dans le Bazaar CDP.
//   node seed-one-route.mjs https://api.x-402.online/v1/xxx
// Amorçage seulement — jamais de volume répété (wash trading = délistage Bazaar).
// Historique : /v1/mobile-proxy/1gb payée 5 USDC le 2026-07-30 (tx 0x4f7148f6…)
// sous le domaine pro. Net-zéro : 5 USDC du wallet acheteur (0x430E) vers le wallet
// revenus (0x2c87) — les deux sont à nous. Une seule fois : pas de volume artificiel.
import { readFileSync } from "node:fs";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
const NETWORK = "eip155:8453";
const URL_ = process.argv.find(a=>/^https?:\/\//.test(a)) || "https://api.x-402.online/v1/mobile-proxy/1gb";
const pk = readFileSync("/Users/yggucci/x402-farm/.buyer.secret", "utf8").match(/(?:BUYER_)?PRIVATE_KEY=(0x[0-9a-fA-F]+)/)[1];
const account = privateKeyToAccount(pk);
console.log(`acheteur ${account.address} -> ${URL_}`);
const pay = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }] });
const t0 = Date.now();
const res = await pay(URL_, { method: "GET" });
const ph = res.headers.get("payment-response") || res.headers.get("x-payment-response");
let tx = "";
if (ph) { try { tx = decodePaymentResponseHeader(ph)?.transaction || ""; } catch {} }
console.log(`HTTP ${res.status} en ${Date.now() - t0}ms${tx ? ` · tx ${tx}` : ""}`);
const body = await res.json().catch(() => null);
if (body) console.log("ERREUR COMPLETE:\n" + (body.error || JSON.stringify(body)));
