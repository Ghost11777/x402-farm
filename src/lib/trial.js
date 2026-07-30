// 1er appel GRATUIT par jour et par client sur les routes data ≤ $0.01.
// Pourquoi : 45 clients MCP/48 h nous branchent SANS wallet — ils ne peuvent pas payer
// ce qu'ils n'ont jamais goûté. Le 1er appel sert la vraie donnée ; le 402 n'arrive
// qu'au 2e. Anti-abus : 1/jour/ip (pk en base), cap global quotidien, routes
// navigateur exclues (compute), upstreams gratuits uniquement.
import { createHash } from "node:crypto";

const GLOBAL_CAP_PER_DAY = 300;
const hashIp = (ip) => (ip ? createHash("sha256").update(ip + "x402farm").digest("hex").slice(0, 16) : null);

let globalCount = { day: "", n: 0 }; // approximation par instance, le vrai garde-fou est la pk

export function buildTrialEligible(catalog) {
  // Le gratuit ne sert QUE des routes à coût amont NUL (APIs publiques). Mesuré le
  // 2026-07-30 : 937 IP ont pris du gratuit en 7 j, 2 ont converti (0,2 %). Offrir des
  // routes qui NOUS coûtent (LLM=crédit DeepSeek, search=quota Serper, navigateur=mini +
  // ZenRows) = brûler de l'argent pour zéro conversion. On les exclut toutes.
  const EXCLUDED = new Set([
    "/v1/extract", "/v1/render", "/v1/screenshot", "/v1/pdf", "/v1/links", "/v1/meta", // navigateur
    "/v1/llm",                                                                          // crédit LLM
    "/v1/search",                                                                       // quota Serper
    "/v1/maps", "/v1/amazon", "/v1/fr/immo", "/v1/fr/leboncoin", "/v1/fr/seloger",      // mini + ZenRows
    "/v1/fr/qualified-leads", "/v1/fr/deals", "/v1/fr/biens-sous-cotes", "/v1/unblock", // composites lourds
  ]);
  const set = new Set();
  for (const e of catalog) {
    const [, path] = e.route.split(" ");
    const price = Number(e.price.replace("$", ""));
    if (price <= 0.01 && !EXCLUDED.has(path) && !path.endsWith("/partial")) set.add(path);
  }
  return set;
}

// Renvoie true si ce client a droit à son appel gratuit du jour (et le consomme).
export async function grantFreeCall(req) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip;
  const ipHash = hashIp(ip);
  if (!ipHash) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (globalCount.day !== today) globalCount = { day: today, n: 0 };
  if (globalCount.n >= GLOBAL_CAP_PER_DAY) return false;
  try {
    // L'insert échoue (409) si (ip, jour) existe déjà -> quota consommé
    const r = await fetch(`${url}/rest/v1/free_first_calls`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ ip_hash: ipHash, day: today, route: req.path }),
      signal: AbortSignal.timeout(2500),
    });
    if (r.status === 201) { globalCount.n++; return true; }
    return false;
  } catch { return false; }
}
