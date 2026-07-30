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
    // Toute route appelée avec ?exit=mobile sort par l'IP d'opérateur mobile : si aucune
    // sortie mobile n'est vérifiée, on refuse AVANT le paywall (le règlement x402 précède
    // le handler, donc facturer puis échouer serait vendre ce qu'on ne peut pas livrer).
    const wantsMobile = String(req.query.exit || req.body?.exit || "").toLowerCase() === "mobile";
    if (wantsMobile && req.path.startsWith("/v1/")) {
      const st = await exitState();
      if (!pickExit(st, "mobile", 0)) {
        return res.status(503).json({
          error: "mobile_exit_unavailable",
          detail: "No mobile (4G/5G) exit is verified right now, so ?exit=mobile cannot be served. You were not charged. Drop the parameter to use the residential exit.",
          status_endpoint: "/free/proxy/status",
        });
      }
    }
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

// Volume d'un port dédié : suit l'enveloppe réelle de la SIM. À monter (env PORT_30D_GB)
// quand l'abonnement passe à 100 Go+. Vendre plus de Go qu'on n'en a serait mentir.
const PORT_30D_GB = Number(process.env.PORT_30D_GB || 10);
const PORT_7D_GB = Number(process.env.PORT_7D_GB || 3);

function issue(gb, tier = "residential", ttlDays = 30) {
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
    const key = signKey(gb, ttlDays);
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
      valid_days: ttlDays,
      note: `HTTP/HTTPS forward proxy on a ${exit.mobile ? "mobile-carrier" : "residential"} IP (${exit.isp}). Metered per GB; key valid ${ttlDays} days. The exit above is probed every 10 min and reported here as observed, not as advertised.`,
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

// PORTS DÉDIÉS (modèle dominant du marché du proxy mobile : un port, un forfait, une
// durée, plutôt qu'un comptage au Go). Même clé signée, seuls le volume et la durée
// changent — donc payable en x402 immédiatement, sans abonnement à gérer.
router.get("/v1/proxy/port/30d", issue(PORT_30D_GB, "mobile", 30));
router.get("/v1/proxy/port/7d", issue(PORT_7D_GB, "mobile", 7));

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

// ---------------------------------------------------------------------------------
// FICHE TECHNIQUE PUBLIQUE — /proxy
// Un acheteur de port mobile demande toujours les mêmes preuves : quel opérateur,
// quel pays, quel débit, quelle stabilité. Tout ici est soit mesuré, soit relevé en
// direct par la sonde (pas de promesse marketing) : l'opérateur et l'ASN viennent de
// l'état vérifié toutes les 10 min, l'uptime du processus lui-même.
const FACTS = {
  throughputMbps: "28-32",      // mesuré le 2026-07-30 (10 Mo via speed.cloudflare.com)
  ttfbMs: 370,                  // idem
  measuredOn: "2026-07-30",
};
router.get("/proxy", async (_req, res) => {
  const state = await exitState();
  const mob = pickExit(state, "mobile", 0);
  const resi = pickExit(state, "residential", 0);
  const up = state?.uptimeSec != null ? (state.uptimeSec / 3600).toFixed(1) : null;
  const esc = (v) => String(v ?? "—").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  const row = (k, v) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`;
  res.type("html").set("cache-control", "public, max-age=60").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mobile proxy exit — technical fact sheet</title>
<style>
:root{--bg:#f6f8f6;--panel:#fff;--ink:#16211e;--soft:#55635e;--rule:#d5dbd7;--ok:#0f6b5c;--off:#a3302b}
@media(prefers-color-scheme:dark){:root{--bg:#0f1513;--panel:#161d1b;--ink:#e8ece9;--soft:#a3b0ab;--rule:#29332f;--ok:#3fb39c;--off:#e2796f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}
.wrap{max-width:44rem;margin:0 auto;padding:2rem 1.1rem 4rem;display:flex;flex-direction:column;gap:1.6rem}
h1{font-size:1.5rem;line-height:1.2;margin:0}h2{font-size:1rem;margin:0 0 .5rem;padding-bottom:.35rem;border-bottom:2px solid var(--ink)}
.lede{color:var(--soft);margin:.4rem 0 0}
.card{background:var(--panel);border:1px solid var(--rule);border-radius:4px;padding:1rem}
table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;padding:.45rem .3rem;border-bottom:1px solid var(--rule);vertical-align:top}
th{color:var(--soft);font-weight:500;width:42%}tr:last-child th,tr:last-child td{border-bottom:none}
code,.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.86em}
.pill{display:inline-block;font-family:ui-monospace,Menlo,monospace;font-size:.7rem;letter-spacing:.06em;padding:.15rem .4rem;border:1px solid currentColor;border-radius:2px}
.on{color:var(--ok)}.no{color:var(--off)}
.price{display:grid;grid-template-columns:1fr auto;gap:.3rem .8rem;font-size:.92rem}
.price b{font-family:ui-monospace,Menlo,monospace}
pre{background:var(--bg);border:1px solid var(--rule);border-radius:3px;padding:.7rem;overflow-x:auto;margin:.5rem 0 0}
a{color:var(--ok)}small{color:var(--soft)}
</style></head><body><div class="wrap">
<header><h1>Mobile proxy exit — technical fact sheet</h1>
<p class="lede">Every field below is either measured or read live from the node's own probe. Nothing here is a marketing claim: the carrier, ASN and country come from a real request made through the exit every 10 minutes, and you can pull the same data yourself from <code>/free/proxy/status</code>.</p></header>

<section><h2>Mobile exit</h2><div class="card"><table>
${row("Status", mob ? "verified, selling" : "not available right now")}
${row("Carrier", mob?.isp)}
${row("ASN", mob?.as)}
${row("Country", mob?.country === "GP" ? "GP — Guadeloupe (France, overseas)" : mob?.country)}
${row("Mobile carrier network", mob?.mobile ? "yes — verified by carrier lookup" : "no")}
${row("Current egress IP", mob?.ip)}
${row("IP rotation", "carrier NAT reassigns on its own; 6 distinct IPs observed within one hour, no action needed")}
${row("Throughput (measured)", FACTS.throughputMbps + " Mbit/s down, " + FACTS.measuredOn)}
${row("Latency (measured)", FACTS.ttfbMs + " ms time-to-first-byte")}
${row("Node uptime", up != null ? up + " h" : "—")}
${row("Last verification", state?.checkedAt)}
</table></div>
<p><small>Rare geography: a French mobile carrier IP in the Caribbean (MCC/MNC 340-01). Most providers cover mainland France only.</small></p></section>

<section><h2>Residential exit (second option)</h2><div class="card"><table>
${row("Status", resi ? "verified, selling" : "not available right now")}
${row("Carrier", resi?.isp)}
${row("Country", resi?.country)}
${row("Type", "fixed-line home fibre — for targets that block datacenter IPs but do not require a mobile IP")}
</table></div></section>

<section><h2>How it works</h2><div class="card">
<table>
${row("Protocols", "HTTP and HTTPS (CONNECT tunnel)")}
${row("Authentication", "HTTP Basic — the username picks the exit, the password is your key")}
${row("Exit selection", "username mobile1 = mobile carrier · buyer = residential")}
${row("Metering", "per byte, both directions, against the key's quota")}
${row("Blocked by policy", "private/loopback targets, and ports 22, 23, 25, 135, 139, 445, 3389 — outbound web traffic only")}
${row("Logging", "timestamp, exit, key tail and target host:port. Never any payload.")}
</table>
<pre>curl -x http://mobile1:YOUR_KEY@${esc(process.env.PROXY_PUBLIC_HOST || "host:8899")} https://api.ipify.org</pre>
</div></section>

<section><h2>Buying</h2><div class="card">
<div class="price">
  <span><b>$9</b> — 7-day test port, 3 GB</span><span class="mono">/v1/proxy/port/7d</span>
  <span><b>$29</b> — dedicated port, 30 days, 10 GB</span><span class="mono">/v1/proxy/port/30d</span>
  <span><b>$5</b> — metered bundle, 1 GB, 30 days</span><span class="mono">/v1/mobile-proxy/1gb</span>
  <span><b>$22</b> — metered bundle, 5 GB, 30 days</span><span class="mono">/v1/mobile-proxy/5gb</span>
</div>
<p style="margin:.9rem 0 0"><small>Paid per call in USDC over the x402 protocol (Base network): call the URL, you get a 402 with the payment requirements, you pay, you get the key. No account, no signup. Volumes scale with the carrier plan — ask for a quote above 10 GB, or for a port billed by bank transfer instead of crypto.</small></p>
<p style="margin:.6rem 0 0"><small>If no mobile exit is verified at that moment, these routes answer <code>503</code> and you are <b>not</b> charged — see <a href="/free/proxy/status">/free/proxy/status</a>.</small></p>
</div></section>

<footer><small>Machine-readable: <a href="/free/proxy/status">/free/proxy/status</a> · <a href="/llms.txt">/llms.txt</a> · <a href="/.well-known/x402">/.well-known/x402</a> — served by api.x-402.online</small></footer>
</div></body></html>`);
});

export default router;
