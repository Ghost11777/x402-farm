// Proxy vers le worker Mac mini (IP résidentielle, vrais navigateurs, sessions loggées).
// Si WORKER_URL est défini (sur Vercel), les routes navigateur y sont déléguées.
// Sinon (worker lui-même, ou dev), on exécute Playwright localement.
const WORKER_URL = (process.env.WORKER_URL || "").replace(/\/+$/, "");
const WORKER_SECRET = process.env.WORKER_SECRET || "";
export const usesWorker = !!WORKER_URL;

// Renvoie true si la requête a été servie par le worker (réponse déjà pipée).
// opts.fallbackStatuses : statuts upstream sur lesquels on préfère le fallback local
// (ex. 503 quand le mini n'a pas encore les credentials d'une source).
// Rend une URL via le mini résidentiel et RENVOIE le HTML (pour parsing côté backend).
// Sert les routes structurées (immo, maps, amazon…) : elles ont besoin du HTML, pas d'un pipe.
// Renvoie { html, servedBy } ou lève. waitFor : ms d'attente JS côté worker (si supporté).
export async function renderViaWorker(url, { waitFor } = {}) {
  if (!WORKER_URL) throw new Error("no_worker");
  const upstream = await fetch(`${WORKER_URL}/v1/render`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-secret": WORKER_SECRET },
    body: JSON.stringify({ url, ...(waitFor ? { waitFor } : {}) }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!upstream.ok) throw new Error(`worker_render_${upstream.status}`);
  const j = await upstream.json();
  return { html: j.html || "", servedBy: upstream.headers.get("x-served-by") || null };
}

export async function tryWorker(req, res, opts = {}) {
  if (!WORKER_URL) return false;
  try {
    // forcePost : les routes navigateur DOIVENT être servies par le mini (IP résidentielle).
    // On envoie toujours en POST avec les params fusionnés, pour que le worker réponde
    // quelle que soit la méthode entrante (un GET ne doit pas retomber en datacenter).
    const params = { ...req.query, ...(req.body || {}) };
    const method = opts.forcePost ? "POST" : req.method;
    const sendBody = method === "POST";
    // Sur forcePost, cibler le chemin sans query (les params passent dans le body)
    const target = opts.forcePost ? `${WORKER_URL}${req.path}` : `${WORKER_URL}${req.originalUrl}`;
    const upstream = await fetch(target, {
      method,
      headers: {
        "content-type": "application/json",
        "x-worker-secret": WORKER_SECRET,
      },
      body: sendBody ? JSON.stringify(sendBody ? params : req.body || {}) : undefined,
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
