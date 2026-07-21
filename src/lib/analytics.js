// Analytics persistante : chaque appel (payé, 402, gratuit) est logué dans Supabase,
// en fire-and-forget pour ne jamais ralentir la réponse. Sans config -> no-op.
import { createHash } from "node:crypto";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const ENABLED = !!(URL && KEY);

const hashIp = (ip) => (ip ? createHash("sha256").update(ip + "x402farm").digest("hex").slice(0, 16) : null);

// Décode l'en-tête de règlement x402 posé par le middleware sur la réponse
function extractPayment(res) {
  const h = res.getHeader("payment-response") || res.getHeader("x-payment-response");
  if (!h) return {};
  try {
    const json = JSON.parse(Buffer.from(String(h), "base64").toString("utf8"));
    return { payer: json.payer || json.from || null, tx: json.transaction || json.txHash || null,
      network: json.network || null };
  } catch {
    return {};
  }
}

export function logCall(req, res, { startedAt, paid, amountUsd, freeTier }) {
  if (!ENABLED) return;
  const pay = paid ? extractPayment(res) : {};
  const row = {
    method: req.method,
    route: req.path,
    status: res.statusCode,
    paid: !!paid,
    amount_usd: paid ? amountUsd ?? null : null,
    network: pay.network || (paid ? process.env.NETWORK : null),
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
