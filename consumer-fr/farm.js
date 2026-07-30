// Client de la ferme x402 pour l'agent de due-diligence.
// Deux modes :
//  - x402-pay (défaut si pas de clé interne) : paie chaque appel en USDC via le
//    wallet (VRAIE demande on-chain, indexation Bazaar, réputation). Le wallet est
//    lu depuis X402_WALLET_KEY ou ../.buyer.secret / ../.wallet.secret.
//  - internal-key : si X402_INTERNAL_KEY est défini -> paywall sauté (DEV/tests, coût 0).
//
// Chaque appel renvoie { ok, status, data, priceUsd, mode } et cumule le coût.

import { readFileSync } from "node:fs";

const BASE = process.env.X402_BACKEND || "https://api.x-402.online";
const INTERNAL_KEY = process.env.X402_INTERNAL_KEY || "";
const NETWORK = process.env.NETWORK || "eip155:8453";

// Prix catalogue (USD) — pour le suivi de dépense côté agent.
export const PRICES = {
  "/v1/fr/entreprise": 0.02,
  "/v1/fr/kyb/partial": 0.03,
  "/v1/fr/kyb": 0.10,
  "/v1/fr/score-entreprise/partial": 0.02,
  "/v1/fr/score-entreprise": 0.08,
  "/v1/fr/procedures-collectives": 0.03,
  "/v1/fr/bodacc": 0.02,
  "/v1/fr/etablissements": 0.02,
  "/v1/fr/entreprise-360/partial": 0.02,
  "/v1/fr/entreprise-360": 0.04,
  "/v1/fr/tva": 0.005,
  "/v1/fr/vat-eu": 0.02,
};

const priceOf = (path) => PRICES[path.split("?")[0]] ?? 0;

let payFetch = null;
async function getPayFetch() {
  if (payFetch) return payFetch;
  const { wrapFetchWithPaymentFromConfig } = await import("@x402/fetch");
  const { ExactEvmScheme } = await import("@x402/evm");
  const { privateKeyToAccount } = await import("viem/accounts");
  const readKey = () => {
    if (process.env.X402_WALLET_KEY) return process.env.X402_WALLET_KEY;
    for (const f of ["../.buyer.secret", "../.wallet.secret"]) {
      try {
        const m = readFileSync(new URL(f, import.meta.url), "utf8").match(/(?:BUYER_)?PRIVATE_KEY=(0x[0-9a-fA-F]+)/);
        if (m) return m[1];
      } catch { /* next */ }
    }
    throw new Error("Aucun wallet pour payer x402 (X402_WALLET_KEY / .buyer.secret / .wallet.secret)");
  };
  const account = privateKeyToAccount(readKey());
  payFetch = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }] });
  return payFetch;
}

/**
 * Appel GET d'une route de la ferme.
 * @param {string} path  ex. "/v1/fr/kyb/partial?q=Decathlon"
 * @returns {Promise<{ok, status, data, priceUsd, mode}>}
 */
export async function call(path) {
  const url = `${BASE}${path}`;
  const priceUsd = priceOf(path);
  let res, mode;
  if (INTERNAL_KEY) {
    mode = "internal-key";
    res = await fetch(url, { headers: { "x-api-key": INTERNAL_KEY } });
  } else {
    mode = "x402-pay";
    const f = await getPayFetch();
    res = await f(url);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data, priceUsd: res.ok ? priceUsd : 0, mode };
}
