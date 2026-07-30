// Fulfillment : appelle le backend x402 pour produire la donnée à livrer.
//
// Deux modes (choisis via l'env) :
//  - MODE CLÉ INTERNE (recommandé, coût ~0) : X402_INTERNAL_KEY défini
//      -> on envoie `x-api-key`, le paywall x402 saute, canal tagué "virtuals"
//         dans l'analytics du backend. On appelle notre propre backend gratuitement.
//  - MODE PAIEMENT X402 (fallback) : X402_INTERNAL_KEY absent
//      -> on paie chaque appel en USDC via le wallet (.wallet.secret / X402_WALLET_KEY),
//         exactement comme un agent tiers. Circulaire (on se paie nous-mêmes) mais
//         fonctionne sans toucher au backend.
//
// La marge vient de l'écart entre le prix ACP encaissé (USDC via escrow) et ce coût.

import { readFileSync } from "node:fs";

const BACKEND = process.env.X402_BACKEND || "https://api.x-402.online";
const INTERNAL_KEY = process.env.X402_INTERNAL_KEY || "";

let payFetch = null;
async function getPayFetch() {
  if (payFetch) return payFetch;
  const { wrapFetchWithPaymentFromConfig } = await import("@x402/fetch");
  const { ExactEvmScheme } = await import("@x402/evm");
  const { privateKeyToAccount } = await import("viem/accounts");
  const network = process.env.NETWORK || "eip155:8453"; // Base mainnet par défaut
  const pk = process.env.X402_WALLET_KEY
    || readFileSync(new URL("../.wallet.secret", import.meta.url), "utf8").match(/PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error("Aucun X402_INTERNAL_KEY ni clé wallet pour payer x402");
  const account = privateKeyToAccount(pk);
  payFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network, client: new ExactEvmScheme(account) }],
  });
  return payFetch;
}

/**
 * Exécute une requête backend décrite par offering.build(requirement).
 * @returns {Promise<{ok:boolean, status:number, data:any, mode:string}>}
 */
export async function fulfill({ method, path, body }) {
  const url = `${BACKEND}${path}`;
  const init = { method, headers: {} };
  if (body) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }

  let res, mode;
  if (INTERNAL_KEY) {
    init.headers["x-api-key"] = INTERNAL_KEY;
    mode = "internal-key";
    res = await fetch(url, init);
  } else {
    mode = "x402-pay";
    const f = await getPayFetch();
    res = await f(url, init);
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data, mode };
}
