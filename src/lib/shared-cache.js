// Cache PARTAGÉ (Supabase) pour les réponses lentes : scraping navigateur (12-25 s),
// DVF (13 s et instable), composites multi-sources. Le cache mémoire de cache.js ne suffit
// pas sur Vercel : chaque instance a le sien, et deux appels consécutifs tombent souvent sur
// deux instances différentes (mesuré le 2026-07-30 : aucun hit sur /v1/maps).
//
// SÉCURITÉ — on n'a que la clé anon (publique) côté serveur :
//   • la table response_cache n'a AUCUNE politique RLS => inaccessible directement ;
//   • tout passe par cache_get / cache_put (security definer) ; cache_get ne rend qu'une
//     correspondance EXACTE, donc personne ne peut lister le cache ;
//   • les clés sont des HMAC-SHA256 tronqués, calculés avec un secret serveur : un tiers ne
//     peut ni deviner la clé d'une requête payante (lecture gratuite) ni empoisonner une
//     entrée ciblée.
// Tout échec côté cache est silencieux : on recalcule, on ne casse jamais la route.
import crypto from "node:crypto";

const URL_ = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_ANON_KEY || "";
const SECRET = process.env.CACHE_SECRET || process.env.ADMIN_TOKEN || "";
export const sharedCacheEnabled = !!(URL_ && KEY && SECRET);

const hash = (k) => crypto.createHmac("sha256", SECRET).update(k).digest("hex").slice(0, 48);

async function rpc(fn, body, timeout = 2500) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`${fn}_${r.status}`);
  return r.json();
}

export async function sharedGet(key) {
  if (!sharedCacheEnabled) return null;
  try {
    const v = await rpc("cache_get", { k: hash(key) });
    return v ?? null;
  } catch { return null; }
}

// Écriture en tâche de fond : ne jamais retarder la réponse à l'acheteur.
export function sharedPut(key, payload, ttlMs) {
  if (!sharedCacheEnabled || payload == null) return;
  rpc("cache_put", { k: hash(key), v: payload, ttl_seconds: Math.round(ttlMs / 1000) }, 4000)
    .catch((e) => console.warn(`[shared-cache] écriture ignorée: ${String(e).slice(0, 60)}`));
}

// Enveloppe façon cached() : partagé d'abord (durable), sinon on calcule et on publie.
export async function sharedCached(key, ttlMs, fn) {
  const hit = await sharedGet(key);
  if (hit != null) return hit;
  const value = await fn();
  if (value != null) sharedPut(key, value, ttlMs);
  return value;
}
