// Sells residential- and mobile-proxy access as x402 bundles. On payment (the paywall
// lets the handler run only after settlement), we mint a self-describing HMAC-signed
// key the proxy node validates locally — no callback to the node needed. The buyer
// routes traffic through the exit, metered per GB. ~100% of the bandwidth value is
// captured (no proxyware middleman); buyers are agents.
//
// TIER TRUTH: the node probes each exit (real request, real public IP, carrier lookup)
// and publishes the result; we read it here and refuse to sell a tier that isn't
// verified live — a mobile bundle is only sold when a mobile carrier IP is actually
// serving. Never sell what we can't deliver (same rule as the Polygon/LLM incidents).
import { Router } from "express";
import crypto from "node:crypto";

const router = Router();
const SECRET = process.env.PROXY_HMAC_SECRET || "";
const PROXY_HOST = process.env.PROXY_PUBLIC_HOST || "RESIDENTIAL_PROXY_HOST:8899";
const WORKER_URL = process.env.WORKER_URL || "";
const WORKER_SECRET = process.env.WORKER_SECRET || "";

const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function signKey(gb, ttlDays = 30) {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const body = `${gb}.${exp}`;
  const sig = b64url(crypto.createHmac("sha256", SECRET).update(body).digest()).slice(0, 22);
  return `rp1.${body}.${sig}`;
}

// --- verified exits, cached 60 s ---------------------------------------------
let cache = { at: 0, state: null };
async function exitState() {
  if (Date.now() - cache.at < 60_000) return cache.state;
  let state = null;
  if (WORKER_URL) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(`${WORKER_URL.replace(/\/$/, "")}/proxy-exits`, {
        headers: { "x-worker-secret": WORKER_SECRET }, signal: ctl.signal,
      });
      clearTimeout(t);
      if (r.ok) state = await r.json();
    } catch { /* node unreachable → nothing verified → nothing sold */ }
  }
  cache = { at: Date.now(), state };
  return state;
}
// Returns the exit that can serve this tier AND still has the bandwidth in stock, or
// null. `gb` = size of the bundle asked for: an exit whose monthly data allowance can't
// cover it is not sellable — we don't promise gigabytes we don't own.
function pickExit(state, tier, gb = 0) {
  if (!state || state.stale || !state.exits) return null;
  const inStock = (e) => e.remainingGB === null || e.remainingGB === undefined || e.remainingGB >= gb;
  const entries = Object.entries(state.exits).filter(([, e]) => e.ok);
  if (tier === "mobile") {
    const hit = entries.find(([name, e]) => e.mobile && name !== "residential" && inStock(e));
    return hit ? { name: hit[0], ...hit[1] } : null;
  }
  const hit = entries.find(([name, e]) => name === "residential" && inStock(e)) || entries.find(([, e]) => inStock(e));
  return hit ? { name: hit[0], ...hit[1] } : null;
}
// Y a-t-il une sortie de ce tier, indépendamment du volume ? (pour distinguer
// « tier absent » de « stock insuffisant » dans les messages d'erreur)
const tierExists = (state, tier) => !!pickExit(state, tier, 0);

// Garde À MONTER AVANT LE PAYWALL : le règlement x402 a lieu avant le handler, donc un
// 503 dans le handler ferait payer un bundle qu'on ne peut pas livrer. Ici on répond
// 503 avant toute demande de paiement — l'agent n'est jamais débité pour rien.
export function proxyTierGuard() {
  return async (req, res, next) => {
    if (!req.path.startsWith("/v1/proxy/") && !req.path.startsWith("/v1/mobile-proxy/")) return next();
    const tier = /^\/v1\/(proxy\/mobile|mobile-proxy)\//.test(req.path) ? "mobile" : "residential";
    const gb = Number(/\/(\d+)gb$/.exec(req.path)?.[1] || 0);
    const state = await exitState();
    if (pickExit(state, tier, gb)) return next();
    // Le tier existe mais le forfait data restant ne couvre pas ce bundle : on le dit,
    // et on propose la taille qui passe encore. Vendre 5 Go quand il en reste 2 = mentir.
    if (tierExists(state, tier)) {
      const left = pickExit(state, tier, 0)?.remainingGB ?? 0;
      return res.status(503).json({
        error: "bandwidth_out_of_stock",
        detail: `This ${gb} GB bundle exceeds the data allowance left on the ${tier} exit this month (${left} GB). You were not charged.`,
        remaining_gb: left,
        smaller_bundle: left >= 1 ? (tier === "mobile" ? "/v1/proxy/mobile/1gb" : "/v1/proxy/1gb") : null,
        status_endpoint: "/free/proxy/status",
      });
    }
    res.status(503).json({
      error: tier === "mobile" ? "mobile_tier_unavailable" : "proxy_unavailable",
      detail: tier === "mobile"
        ? "No mobile (4G/5G) exit is verified right now — this bundle is not for sale until one is. You were not charged."
        : "The proxy node is not reachable right now. You were not charged.",
      checked_at: state?.checkedAt || null,
      status_endpoint: "/free/proxy/status",
      alternatives: tier === "mobile" ? ["/v1/proxy/1gb", "/v1/proxy/5gb"] : [],
    });
  };
}

function issue(gb, tier = "residential") {
  return async (_req, res) => {
    if (!SECRET) return res.status(503).json({ error: "proxy_not_configured" });
    const state = await exitState();
    const exit = pickExit(state, tier, gb);
    if (!exit) {
      // Not settled yet at this point? The paywall settles before the handler runs, so
      // be explicit: the buyer must not be charged for an unavailable tier. See below.
      return res.status(503).json({
        error: tier === "mobile" ? "mobile_tier_unavailable" : "proxy_unavailable",
        detail: tier === "mobile"
          ? "No mobile (4G/5G) exit is currently verified. Nothing was charged for a tier we cannot serve — use /v1/proxy/1gb (residential) instead."
          : "The proxy node is not reachable right now. Nothing was charged.",
        checked_at: state?.checkedAt || null,
        alternatives: tier === "mobile" ? ["/v1/proxy/1gb", "/v1/proxy/5gb"] : [],
      });
    }
    const key = signKey(gb);
    const user = exit.name === "residential" ? "buyer" : exit.name;
    res.json({
      key,
      gb,
      unit: "GB",
      tier,
      exit: {
        ip: exit.ip, carrier: exit.isp, asn: exit.as, mobile: !!exit.mobile, country: exit.country,
        verified_at: state.checkedAt,
        uptime_hours: state.uptimeSec != null ? Number((state.uptimeSec / 3600).toFixed(2)) : null,
      },
      ...(exit.remainingGB !== null && exit.remainingGB !== undefined
        ? { exit_allowance_left_gb: Number((exit.remainingGB - gb).toFixed(2)) } : {}),
      proxy: `http://${user}:${key}@${PROXY_HOST}`,
      usage: `curl -x http://${user}:${key}@${PROXY_HOST} https://api.ipify.org`,
      note: `HTTP/HTTPS forward proxy on a ${exit.mobile ? "mobile-carrier" : "residential"} IP (${exit.isp}). Metered per GB; key valid 30 days. The exit above is probed every 10 min and reported here as observed, not as advertised.`,
    });
  };
}

// Residential tier — the home fibre IP of the node.
router.get("/v1/proxy/1gb", issue(1, "residential"));
router.get("/v1/proxy/5gb", issue(5, "residential"));
router.get("/v1/proxy/20gb", issue(20, "residential"));
// Mobile (4G/5G) tier — premium: carrier IPs are much harder to block. Sold only while
// a mobile exit is verified up (otherwise 503, see issue()).
router.get("/v1/proxy/mobile/1gb", issue(1, "mobile"));
router.get("/v1/proxy/mobile/5gb", issue(5, "mobile"));
// Nom commercial (celui qu'on met en avant dans les annuaires d'agents) : un agent qui
// cherche « mobile proxy » doit tomber sur un chemin qui le dit. Mêmes handlers.
router.get("/v1/mobile-proxy/1gb", issue(1, "mobile"));
router.get("/v1/mobile-proxy/5gb", issue(5, "mobile"));

// Free preview: lets an agent (or us) check what's actually serving before paying.
router.get("/free/proxy/status", async (_req, res) => {
  const state = await exitState();
  const tiers = {
    residential: !!pickExit(state, "residential"),
    mobile: !!pickExit(state, "mobile"),
  };
  res.json({
    tiers_available: tiers,
    exits: state?.exits
      ? Object.fromEntries(Object.entries(state.exits).map(([n, e]) => [n, {
          ok: e.ok, mobile: !!e.mobile, carrier: e.isp, country: e.country,
          allowance_left_gb: e.remainingGB ?? null, allowance_total_gb: e.capGB ?? null,
        }]))
      : null,
    checked_at: state?.checkedAt || null,
    // Stabilité de la sortie : un acheteur de bande passante veut savoir depuis quand le
    // nœud tourne sans interruption avant d'engager son budget.
    exit_uptime_hours: state?.uptimeSec != null ? Number((state.uptimeSec / 3600).toFixed(2)) : null,
    exit_running_since: state?.startedAt || null,
    buy: { residential: "/v1/proxy/1gb", mobile: tiers.mobile ? "/v1/proxy/mobile/1gb" : null },
  });
});

export default router;
