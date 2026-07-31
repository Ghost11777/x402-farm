// Test e2e SOLANA : paie une route x402 en USDC-SPL depuis le wallet acheteur Solana,
// pour prouver que le settlement Solana fonctionne AVANT de l'annoncer en prod.
//
// Prérequis :
//   1. Le DÉPLOIEMENT ciblé doit avoir SOL_PAY_TO posé (sinon Solana absent des accepts).
//      → poser SOL_PAY_TO sur un PREVIEW Vercel, déployer, viser son URL ici.
//   2. Alimenter .sol-buyer.secret avec ~1 $ d'USDC-SPL sur Solana (l'acheteur n'a PAS
//      besoin de SOL : le facilitateur CDP est feePayer, gasless pour l'acheteur).
//
//   node sol-e2e.mjs [url_base] [route]
//   ex: node sol-e2e.mjs https://x402-farm-xxxxx.vercel.app /v1/sms/number
import { readFileSync } from "node:fs";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactSvmScheme, MAINNET_RPC_URL } from "@x402/svm";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC mainnet (SPL)
const RPC = process.env.SOLANA_RPC_URL || MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";
const BASE = (process.argv[2] || "https://api.x-402.online").replace(/\/$/, "");
const ROUTE = process.argv[3] || "/v1/sms/number"; // $0.05, sans paramètre
const URL_ = BASE + ROUTE;

const secret = Uint8Array.from(JSON.parse(readFileSync("./.sol-buyer.secret", "utf8")));
const signer = await createKeyPairSignerFromBytes(secret);
console.log(`acheteur Solana : ${signer.address}`);
console.log(`cible : ${URL_}  ·  réseau ${NETWORK}  ·  RPC ${RPC}`);

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  return (await r.json()).result;
}

// 1) solde USDC-SPL de l'acheteur (informatif + garde-fou)
try {
  const res = await rpc("getTokenAccountsByOwner", [signer.address, { mint: USDC_MINT }, { encoding: "jsonParsed" }]);
  const bal = res?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
  console.log(`solde USDC-SPL de l'acheteur : ${bal} $`);
  if (!bal) {
    console.log(`\n⛔ 0 USDC-SPL. Envoie ~1 $ d'USDC (réseau Solana) à :\n   ${signer.address}\npuis relance. (Pas besoin de SOL : le facilitateur paie les frais.)`);
    process.exit(1);
  }
} catch (e) { console.log("(vérif solde ignorée :", String(e.message).slice(0, 60), "— RPC public rate-limité ? SOLANA_RPC_URL=… pour un RPC dédié)"); }

// 2) vérifie que Solana est bien annoncé sur cette URL (sinon SOL_PAY_TO pas posé)
const probe = await fetch(URL_, { method: "GET" }).catch(() => null);
if (probe && probe.status === 402) {
  const j = await probe.json().catch(() => ({}));
  const nets = [...new Set((j.accepts || []).map((a) => a.network))];
  console.log(`accepts annoncés : ${nets.join(", ") || "(vide)"}`);
  if (!nets.some((n) => n.startsWith("solana"))) {
    console.log(`\n⛔ Solana absent des accepts sur cette URL. Pose SOL_PAY_TO sur ce déploiement d'abord (preview Vercel), puis relance.`);
    process.exit(1);
  }
} else {
  console.log(`(sonde : HTTP ${probe ? probe.status : "?"} — on tente le paiement quand même)`);
}

// 3) paie via le scheme SVM (client signe le transfert USDC-SPL, facilitateur = feePayer)
const pay = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: NETWORK, client: new ExactSvmScheme(signer, { rpcUrl: RPC }) }],
});
const t0 = Date.now();
const res = await pay(URL_, { method: "GET" });
const ms = Date.now() - t0;
const ph = res.headers.get("payment-response") || res.headers.get("x-payment-response");
let tx = ""; if (ph) { try { tx = decodePaymentResponseHeader(ph)?.transaction || ""; } catch {} }
console.log(`\nHTTP ${res.status} en ${ms}ms${tx ? ` · signature Solana ${tx}` : ""}`);
const body = await res.json().catch(() => null);
if (res.status === 200) console.log(`✅ RÉGLÉ EN USDC-SPL SUR SOLANA — SOL_PAY_TO a encaissé. Solana prêt pour la prod.`);
else console.log("réponse :", (body && (body.error || JSON.stringify(body))) || "(vide)");
