// Analytics persistante : chaque appel (payé, 402, gratuit) est logué dans Supabase,
// en fire-and-forget pour ne jamais ralentir la réponse. Sans config -> no-op.
import { createHash } from "node:crypto";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const ENABLED = !!(URL && KEY);

const hashIp = (ip) => (ip ? createHash("sha256").update(ip + "x402farm").digest("hex").slice(0, 16) : null);

const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const decodeB64Json = (s) => { try { return JSON.parse(Buffer.from(String(s), "base64").toString("utf8")); } catch { return null; } };

// Détermine payeur / tx / RÉSEAU d'un paiement x402. Le réseau vient (par ordre de fiabilité) :
// 1) de l'en-tête de règlement (reçu) posé sur la réponse ; 2) de l'en-tête de paiement de la
// requête (le client y déclare la chaîne qu'il paie) ; 3) déduit du format d'adresse
// (base58 = Solana, 0x… = EVM). On ne retombe JAMAIS en dur sur process.env.NETWORK
// (ça étiquetait tout paiement Solana comme Base).
function extractPayment(req, res) {
  const receipt = decodeB64Json(res.getHeader("payment-response") || res.getHeader("x-payment-response") || "");
  const reqHdr = req.headers["payment-signature"] || req.headers["x-payment"] || req.headers["payment"];
  const sent = decodeB64Json(reqHdr || "");
  const payer = receipt?.payer || receipt?.from
    || sent?.payload?.authorization?.from || sent?.payload?.from || sent?.payer || null;
  const tx = receipt?.transaction || receipt?.txHash || null;
  let network = receipt?.network || sent?.network || null;
  if (!network) {
    const s = String(payer || tx || "");
    if (s.startsWith("0x")) network = process.env.NETWORK || "eip155:8453";
    else if (s) network = SOLANA_MAINNET; // base58 => Solana
  }
  return { payer, tx, network };
}

export function logCall(req, res, { startedAt, paid, amountUsd, freeTier }) {
  if (!ENABLED) return;
  const pay = paid ? extractPayment(req, res) : {};
  const row = {
    method: req.method,
    route: req.path,
    status: res.statusCode,
    paid: !!paid,
    amount_usd: paid ? amountUsd ?? null : null,
    network: pay.network || null,
    payer: pay.payer || null,
    tx_hash: pay.tx || null,
    latency_ms: startedAt ? Date.now() - startedAt : null,
    free_tier: !!freeTier,
    ip_hash: hashIp(req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip),
  };
  // fire-and-forget
  fetch(`${URL}/rest/v1/api_calls`, {
    method: "POST",
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(4000),
  }).catch(() => {});
}

export const analyticsEnabled = ENABLED;
