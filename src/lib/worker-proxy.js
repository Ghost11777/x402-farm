// Proxy vers le worker Mac mini (IP résidentielle, vrais navigateurs, sessions loggées).
// Si WORKER_URL est défini (sur Vercel), les routes navigateur y sont déléguées.
// Sinon (worker lui-même, ou dev), on exécute Playwright localement.
const WORKER_URL = (process.env.WORKER_URL || "").replace(/\/+$/, "");
const WORKER_SECRET = process.env.WORKER_SECRET || "";
export const usesWorker = !!WORKER_URL;

// Renvoie true si la requête a été servie par le worker (réponse déjà pipée).
// opts.fallbackStatuses : statuts upstream sur lesquels on préfère le fallback local
// (ex. 503 quand le mini n'a pas encore les credentials d'une source).
export async function tryWorker(req, res, opts = {}) {
  if (!WORKER_URL) return false;
  try {
    const upstream = await fetch(`${WORKER_URL}${req.originalUrl}`, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        "x-worker-secret": WORKER_SECRET,
      },
      body: req.method === "POST" ? JSON.stringify(req.body || {}) : undefined,
      signal: AbortSignal.timeout(45_000),
    });
    if (opts.fallbackStatuses?.includes(upstream.status)) {
      console.warn(`[worker] upstream ${upstream.status} sur ${req.path}, fallback local`);
      return false;
    }
    // Recopie statut + type + corps (gère JSON et binaire PNG/PDF)
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.type(ct);
    const via = upstream.headers.get("x-served-by");
    if (via) res.set("x-served-by", via);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
    return true;
  } catch (e) {
    // Le worker est injoignable (box éteinte…) -> on laisse le fallback local jouer
    console.warn(`[worker] injoignable, fallback local: ${String(e).slice(0, 120)}`);
    return false;
  }
}
