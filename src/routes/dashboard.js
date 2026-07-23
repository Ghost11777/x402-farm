import { Router } from "express";
import { CATALOG } from "../catalog.js";
import { ICON_512, ICON_192, ICON_180 } from "./dashboard-icons.js";

// Centre de contrôle temps réel (token) : plein écran, poll JSON toutes les 6 s,
// ticker, feed live, graphes minute/heure, statut des sous-systèmes.
// URL : /dashboard?token=ADMIN_TOKEN  ·  données : /dashboard/data?token=…
const router = Router();

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RPC = "https://mainnet.base.org";
const EUR = 0.92;

// ---------- Sources de données ----------
async function sb(view, qs = "") {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/rest/v1/${view}${qs}`, {
      headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    return await r.json();
  } catch { return null; }
}

// Solde on-chain, caché 25 s (le front poll toutes les 6 s, inutile de marteler le RPC)
let balCache = { v: null, t: 0 };
async function usdcBalance(addr) {
  if (Date.now() - balCache.t < 25000) return balCache.v;
  try {
    const data = "0x70a08231" + addr.slice(2).padStart(64, "0");
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: BASE_USDC, data }, "latest"] }),
      signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    balCache = { v: j.result ? Number(BigInt(j.result)) / 1e6 : null, t: Date.now() };
  } catch { balCache.t = Date.now(); }
  return balCache.v;
}

// Statut des sous-systèmes, caché (worker 60 s, registre 10 min)
let statusCache = { v: null, t: 0 };
async function subsystems() {
  if (statusCache.v && Date.now() - statusCache.t < 60000) return statusCache.v;
  const out = { worker: { ok: null }, registry: statusCache.v?.registry || { ok: null } };
  if (process.env.WORKER_URL) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${process.env.WORKER_URL}/health`, { signal: AbortSignal.timeout(3000) });
      out.worker = { ok: r.ok, ms: Date.now() - t0 };
    } catch { out.worker = { ok: false }; }
  }
  // Re-check registre au max toutes les 10 min. Il est souvent LENT (7-8 s) : timeout large,
  // et sur échec on GARDE le dernier bon statut (une lenteur transitoire ne doit pas
  // faire clignoter la LED en rouge tant qu'on l'a déjà vu vert récemment).
  if (!statusCache.v?.registry?.ok || Date.now() - (statusCache.regT || 0) > 600000) {
    try {
      const r = await fetch("https://registry.modelcontextprotocol.io/v0/servers?search=x-402", { signal: AbortSignal.timeout(12000) });
      const j = await r.json();
      const s = (j.servers || []).find((x) => x._meta?.["io.modelcontextprotocol.registry/official"]?.isLatest) || j.servers?.[0];
      if (s) out.registry = { ok: true, name: s.server?.name, status: s._meta?.["io.modelcontextprotocol.registry/official"]?.status };
      else if (!statusCache.v?.registry?.ok) out.registry = { ok: false };
    } catch {
      // timeout/erreur réseau : conserver le dernier statut connu, ne pas forcer le rouge
      if (!statusCache.v?.registry?.ok) out.registry = { ok: false };
    }
    statusCache.regT = Date.now();
  }
  statusCache = { ...statusCache, v: out, t: Date.now() };
  return out;
}

const priceByRoute = Object.fromEntries(CATALOG.map((e) => [e.route.split(" ")[1], e.price]));

function auth(req, res) {
  if (!process.env.ADMIN_TOKEN || req.query.token !== process.env.ADMIN_TOKEN) {
    res.status(401).type("html").send("<h1>401</h1><p>Ajoutez ?token=VOTRE_ADMIN_TOKEN à l'URL.</p>");
    return false;
  }
  return true;
}

// ---------- Endpoint JSON (pollé par le front) ----------
router.get("/dashboard/data", async (req, res) => {
  if (!auth(req, res)) return;
  const [routes, daily, byCountry, feed, hourly, minutely, payers, latency, bal, status] = await Promise.all([
    sb("api_revenue_by_route", "?order=revenue_usd.desc"),
    sb("api_daily", "?order=jour.desc&limit=15"),
    sb("api_by_country", ""),
    sb("api_live_feed", ""),
    sb("api_hourly", ""),
    sb("api_minutely", ""),
    sb("api_top_payers", ""),
    sb("api_latency_24h", ""),
    usdcBalance(process.env.PAY_TO || "0x0"),
    subsystems(),
  ]);
  const radar = await sb("radar_latest", "?limit=12");
  const list = Array.isArray(routes) ? routes : [];
  const days = Array.isArray(daily) ? daily : [];
  const paidRoutes = list.filter((r) => r.route?.startsWith("/v1/"))
    .map((r) => ({ ...r, price: priceByRoute[r.route] || null }));
  const totalPaid = list.reduce((s, x) => s + Number(x.paid_calls || 0), 0);
  const total402 = list.reduce((s, x) => s + Number(x.saw_paywall || 0), 0);
  res.json({
    now: Date.now(),
    balance: bal, eur: bal != null ? bal * EUR : null,
    payTo: process.env.PAY_TO || null, network: process.env.NETWORK || null,
    cumulative: {
      revenue: list.reduce((s, x) => s + Number(x.revenue_usd || 0), 0),
      paid: totalPaid, paywalls: total402,
      conversion: total402 + totalPaid > 0 ? (totalPaid / (total402 + totalPaid)) * 100 : 0,
    },
    today: days[0] || null, yesterday: days[1] || null,
    daily: days.slice().reverse(),
    routes: paidRoutes,
    countries: Array.isArray(byCountry) ? byCountry : [],
    feed: Array.isArray(feed) ? feed : [],
    hourly: Array.isArray(hourly) ? hourly : [],
    minutely: Array.isArray(minutely) ? minutely : [],
    payers: Array.isArray(payers) ? payers : [],
    latency: Array.isArray(latency) ? latency[0] : null,
    radar: Array.isArray(radar) ? radar : [],
    status: { api: true, mcp: { ok: true, tools: CATALOG.length }, ...status },
  });
});

// ---------- PWA : manifest, service worker, icônes (pas de donnée sensible) ----------
const png = (b64) => Buffer.from(b64, "base64");
router.get("/dashboard/icon-512.png", (_req, res) => res.type("png").set("cache-control", "public, max-age=604800").send(png(ICON_512)));
router.get("/dashboard/icon-192.png", (_req, res) => res.type("png").set("cache-control", "public, max-age=604800").send(png(ICON_192)));
router.get("/dashboard/icon-180.png", (_req, res) => res.type("png").set("cache-control", "public, max-age=604800").send(png(ICON_180)));

router.get("/dashboard/manifest.webmanifest", (_req, res) =>
  res.type("application/manifest+json").json({
    name: "X402 Control",
    short_name: "402 CTRL",
    description: "Centre de contrôle temps réel x402-farm",
    start_url: "/dashboard",
    scope: "/dashboard",
    display: "standalone",
    orientation: "any",
    background_color: "#04060d",
    theme_color: "#04060d",
    icons: [
      { src: "/dashboard/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/dashboard/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  }));

// SW à la racine du chemin /dashboard-sw.js : portée max "/" -> peut couvrir "/dashboard"
// (un SW servi sous /dashboard/ ne couvrirait PAS /dashboard sans slash final).
router.get("/dashboard-sw.js", (_req, res) =>
  res.type("application/javascript").set("cache-control", "no-cache").send(`
const V = "x402-ctrl-v2";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  // Icônes : cache-first (immuables)
  if (u.pathname.startsWith("/dashboard/icon")) {
    e.respondWith(caches.open(V).then((c) => c.match(e.request)
      .then((r) => r || fetch(e.request).then((n) => { c.put(e.request, n.clone()); return n; }))));
    return;
  }
  // Coquille + données : network-first, dernier snapshot en secours (mode hors-ligne)
  if (u.pathname === "/dashboard" || u.pathname === "/dashboard/data") {
    const key = u.pathname; // clé fixe : le token en query ne fragmente pas le cache
    e.respondWith(fetch(e.request).then((n) => {
      if (n.ok) caches.open(V).then((c) => c.put(key, n.clone()));
      return n;
    }).catch(() => caches.open(V).then((c) => c.match(key))));
  }
});
`));

// ---------- Coquille HTML (tout le rendu est côté client) ----------
// Servie SANS token : elle ne contient que l'interface. Toutes les données passent
// par /dashboard/data qui, lui, exige le token (saisi/stocké côté client -> PWA installable).
router.get("/dashboard", (_req, res) => {
  res.type("html").send(`<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>x402-farm — Control</title>
<link rel="manifest" href="/dashboard/manifest.webmanifest">
<meta name="theme-color" content="#04060d">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="402 CTRL">
<link rel="apple-touch-icon" href="/dashboard/icon-180.png">
<link rel="icon" type="image/png" href="/dashboard/icon-192.png">
<style>
:root{color-scheme:dark;
  --bg:#04060d;--panel:#0a0e1cdd;--line:#1a2140;--txt:#dfe4f5;--dim:#7581a6;--faint:#4a5578;
  --up:#00e58a;--down:#ff4d5e;--warn:#ffb02e;--blue:#4d9fff;--purple:#a06bff}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--txt);overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:
    radial-gradient(900px 500px at 15% -5%,#121b3f66,transparent),
    radial-gradient(700px 400px at 90% 110%,#0d2a2466,transparent),
    repeating-linear-gradient(0deg,transparent 0 39px,#ffffff05 39px 40px),
    repeating-linear-gradient(90deg,transparent 0 39px,#ffffff05 39px 40px)}
.mono,.num{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums}
.wrap{display:flex;flex-direction:column;min-height:100vh;gap:12px;
  padding:calc(14px + env(safe-area-inset-top)) calc(18px + env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) calc(18px + env(safe-area-inset-left))}

/* ---- overlay token (PWA : auth côté client) ---- */
.lock{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:#04060df2;backdrop-filter:blur(6px)}
.lock.hidden{display:none}
.lock-box{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:28px;width:min(360px,90vw);text-align:center}
.lock-box h3{font-size:15px;letter-spacing:.08em;margin-bottom:6px}
.lock-box p{font-size:12px;color:var(--dim);margin-bottom:16px}
.lock-box input{width:100%;background:#070a15;border:1px solid var(--line);border-radius:9px;color:var(--txt);
  font-family:ui-monospace,Menlo,monospace;font-size:13px;padding:10px 12px;outline:none;text-align:center}
.lock-box input:focus{border-color:var(--up)}
.lock-box button{margin-top:12px;width:100%;background:var(--up);color:#04120b;border:0;border-radius:9px;
  font-weight:700;font-size:13px;padding:10px;cursor:pointer}
.lock-err{color:var(--down);font-size:11px;margin-top:8px;min-height:14px}

/* ---- header ---- */
header{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.logo{font-size:17px;font-weight:800;letter-spacing:.08em}
.logo .x{color:var(--up)}
.logo::after{content:"▌";color:var(--up);animation:blink 1.1s steps(1) infinite;margin-left:2px}
@keyframes blink{50%{opacity:0}}
.clock{font-size:13px;color:var(--dim)}
.leds{display:flex;gap:14px;margin-left:auto;flex-wrap:wrap}
.led{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.08em;color:var(--dim);text-transform:uppercase}
.led i{width:8px;height:8px;border-radius:50%;background:var(--faint)}
.led.ok i{background:var(--up);box-shadow:0 0 8px var(--up);animation:pulse 2s ease-in-out infinite}
.led.ko i{background:var(--down);box-shadow:0 0 8px var(--down)}
.led.na i{background:var(--faint)}
@keyframes pulse{50%{box-shadow:0 0 2px var(--up)}}

/* ---- ticker tape ---- */
.tape{position:relative;overflow:hidden;border-block:1px solid var(--line);background:#070a15;height:30px}
.tape-inner{display:inline-flex;gap:38px;white-space:nowrap;padding-inline:20px;line-height:30px;
  animation:scroll 45s linear infinite;will-change:transform}
.tape:hover .tape-inner{animation-play-state:paused}
@keyframes scroll{to{transform:translateX(-50%)}}
.tk{font-size:12px;color:var(--dim)}
.tk b{color:var(--txt);font-weight:600}
.tk .up{color:var(--up)}.tk .down{color:var(--down)}.tk .warn{color:var(--warn)}

/* ---- KPI ---- */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;position:relative;overflow:hidden}
.kpi .lbl{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin-bottom:6px;padding-right:52px}
.kpi .v{font-size:24px;font-weight:750;font-family:ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
.kpi .s{font-size:11px;color:var(--faint);margin-top:3px}
.kpi.hero .v{background:linear-gradient(90deg,var(--up),#7dffc9);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.kpi .delta{position:absolute;top:10px;right:12px;font-size:11px;font-weight:700;padding:2px 7px;border-radius:20px}
.delta.up{color:var(--up);background:#00e58a1a}.delta.down{color:var(--down);background:#ff4d5e1a}
.kpi.flash::after{content:"";position:absolute;inset:0;background:radial-gradient(circle,#00e58a33,transparent 70%);animation:flash 1.2s ease-out forwards}
@keyframes flash{from{opacity:1}to{opacity:0}}

/* ---- layout ---- */
.main{display:grid;grid-template-columns:1fr 1fr 380px;gap:12px}
@media(max-width:1250px){.main{grid-template-columns:1fr 1fr}.feed-panel{grid-column:1/-1;max-height:420px}}
@media(max-width:820px){.main{grid-template-columns:1fr}}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;min-height:0}
.panel h2{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin-bottom:10px;display:flex;align-items:center;gap:8px}
.panel h2 .live{width:7px;height:7px;border-radius:50%;background:var(--down);animation:pulse2 1.4s ease-in-out infinite}
@keyframes pulse2{50%{opacity:.25}}
.panel h2 .right{margin-left:auto;color:var(--faint);text-transform:none;letter-spacing:0;font-weight:400}
.span2{grid-column:span 2}
@media(max-width:820px){.span2{grid-column:auto}}

/* ---- charts ---- */
.chart{height:216px;position:relative}
.chart svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.axis{font-size:9px;fill:var(--faint);font-family:ui-monospace,Menlo,monospace}
.area{fill:url(#ga);stroke:var(--blue);stroke-width:1.6}
.pbar{fill:var(--up)}
.rline{stroke:var(--up);stroke-width:1.4;fill:none;stroke-dasharray:2000;stroke-dashoffset:0}
.hbars{display:flex;align-items:flex-end;gap:2px;flex:1;min-height:170px}
.hb{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:1px;position:relative}
.hb .b402{background:#ffb02e59;border-radius:2px 2px 0 0;transition:height .6s cubic-bezier(.2,.8,.2,1)}
.hb .bpaid{background:var(--up);border-radius:2px;box-shadow:0 0 6px #00e58a66;transition:height .6s cubic-bezier(.2,.8,.2,1)}
.hb:hover::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);
  background:#050810;border:1px solid var(--line);padding:5px 8px;border-radius:7px;font-size:10px;white-space:pre;z-index:5;color:var(--txt)}

/* ---- feed ---- */
.feed-panel{grid-row:span 2}
.feed{flex:1;max-height:560px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
.ev{display:grid;grid-template-columns:44px 1fr auto auto;gap:8px;align-items:center;font-size:12px;
  padding:5px 8px;border-radius:7px;border-left:2px solid var(--faint);background:#ffffff05}
.ev.paid{border-left-color:var(--up);background:#00e58a0d}
.ev.pw{border-left-color:var(--warn)}
.ev.free{border-left-color:var(--blue)}
.ev.err{border-left-color:var(--down)}
.ev.new{animation:slidein .5s cubic-bezier(.2,.8,.2,1)}
@keyframes slidein{from{opacity:0;transform:translateX(18px)}}
.ev .t{color:var(--faint);font-size:10px}
.ev .r{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#b9c2e6}
.ev .a{font-weight:700}.ev.paid .a{color:var(--up)}
.ev .badge{font-size:9px;letter-spacing:.06em;padding:2px 6px;border-radius:9px;background:#ffffff0d;color:var(--dim)}
.ev.paid .badge{background:#00e58a22;color:var(--up)}
.ev.pw .badge{background:#ffb02e1c;color:var(--warn)}

/* ---- tables ---- */
table{width:100%;border-collapse:collapse}
th,td{padding:6px 8px;font-size:12px;text-align:left;border-bottom:1px solid #131a33}
th{color:var(--faint);font-size:10px;text-transform:uppercase;letter-spacing:.07em;position:sticky;top:0;background:#0a0e1c}
td.num,th.num{text-align:right}
tr:last-child td{border-bottom:none}
tr{transition:background .3s}tr.bump{background:#00e58a14}
.tbl-scroll{overflow-y:auto;flex:1;min-height:0;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
.trend{font-size:10px;margin-left:4px}.trend.up{color:var(--up)}.trend.down{color:var(--down)}
.price{color:var(--purple)}

/* ---- gauge + divers ---- */
.gwrap{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.gauge circle.fg{transition:stroke-dasharray 1s cubic-bezier(.2,.8,.2,1)}
.mini-stats{display:flex;flex-direction:column;gap:7px;font-size:12px;color:var(--dim)}
.mini-stats b{color:var(--txt);font-family:ui-monospace,Menlo,monospace}
footer{display:flex;gap:16px;flex-wrap:wrap;align-items:center;font-size:11px;color:var(--faint);padding-top:2px}
footer a{color:var(--blue);text-decoration:none}
.empty{color:var(--faint);font-size:12px;text-align:center;padding:18px}
</style></head><body>
<div class="wrap">
<header>
  <div class="logo"><span class="x">X402</span>-FARM // CONTROL</div>
  <div class="clock mono" id="clock">—</div>
  <div class="leds">
    <span class="led" id="led-api"><i></i>API</span>
    <span class="led" id="led-mcp"><i></i>MCP</span>
    <span class="led" id="led-worker"><i></i>Worker</span>
    <span class="led" id="led-reg"><i></i>Registre</span>
  </div>
</header>

<div class="tape"><div class="tape-inner" id="tape"><span class="tk">chargement du flux…</span></div></div>

<div class="kpis">
  <div class="kpi hero" id="k-bal"><div class="lbl">Solde wallet</div><div class="v num" id="v-bal">—</div><div class="s" id="s-bal">Base · USDC</div></div>
  <div class="kpi" id="k-rev"><div class="lbl">Revenu aujourd'hui</div><div class="v num" id="v-rev">—</div><div class="delta" id="d-rev"></div><div class="s" id="s-rev"></div></div>
  <div class="kpi"><div class="lbl">Revenu cumulé</div><div class="v num" id="v-cum">—</div><div class="s" id="s-cum"></div></div>
  <div class="kpi" id="k-paid"><div class="lbl">Appels payés (jour)</div><div class="v num" id="v-paid">—</div><div class="delta" id="d-paid"></div></div>
  <div class="kpi"><div class="lbl">Trafic / min</div><div class="v num" id="v-rpm">—</div><div class="s">moy. 15 min</div></div>
  <div class="kpi"><div class="lbl">Paywalls (jour)</div><div class="v num" id="v-402">—</div><div class="s">402 servis</div></div>
  <div class="kpi"><div class="lbl">Conversion</div><div class="v num" id="v-conv">—</div><div class="s">402 → paiement</div></div>
  <div class="kpi"><div class="lbl">Latence p50 / p95</div><div class="v num" id="v-lat" style="font-size:19px">—</div><div class="s" id="s-lat">24 h</div></div>
</div>

<div class="main">
  <div class="panel span2">
    <h2><span class="live"></span>Activité temps réel <span class="right" id="mn-sub">90 min · 1 pt/min</span></h2>
    <div class="chart" id="minutely"></div>
  </div>

  <div class="panel feed-panel">
    <h2><span class="live"></span>Flux live <span class="right" id="feed-sub"></span></h2>
    <div class="feed" id="feed"></div>
  </div>

  <div class="panel">
    <h2>Activité 48 h <span class="right"><span style="color:var(--up)">■</span> payés · <span style="color:var(--warn)">■</span> 402</span></h2>
    <div class="hbars" id="hourly"></div>
  </div>

  <div class="panel">
    <h2>Conversion & santé</h2>
    <div class="gwrap">
      <svg viewBox="0 0 120 120" width="120" height="120" class="gauge">
        <defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00e58a"/><stop offset="1" stop-color="#4d9fff"/></linearGradient>
        <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4d9fff44"/><stop offset="1" stop-color="#4d9fff00"/></linearGradient></defs>
        <circle cx="60" cy="60" r="50" fill="none" stroke="#161d3a" stroke-width="11"/>
        <circle class="fg" cx="60" cy="60" r="50" fill="none" stroke="url(#gg)" stroke-width="11" stroke-linecap="round" stroke-dasharray="0 314" transform="rotate(-90 60 60)"/>
        <text x="60" y="57" text-anchor="middle" fill="#dfe4f5" font-size="20" font-weight="700" id="g-val">—</text>
        <text x="60" y="75" text-anchor="middle" fill="#7581a6" font-size="8" letter-spacing=".1em" id="g-lbl">CONVERSION</text>
      </svg>
      <div class="mini-stats" id="health"></div>
    </div>
  </div>

  <div class="panel span2">
    <h2>Marché des routes <span class="right">volume · prix · revenu</span></h2>
    <div class="tbl-scroll" style="max-height:300px"><table id="routes"><thead>
      <tr><th>Route</th><th class="num">Prix</th><th class="num">Payés</th><th class="num">Payeurs</th><th class="num">Revenu</th><th class="num">Conv.</th><th class="num">p50</th></tr>
    </thead><tbody></tbody></table></div>
  </div>

  <div class="panel">
    <h2>Top payeurs 🐋</h2>
    <div class="tbl-scroll"><table id="payers"><thead>
      <tr><th>Wallet</th><th class="num">Appels</th><th class="num">Revenu</th><th class="num">Vu</th></tr>
    </thead><tbody></tbody></table></div>
  </div>

  <div class="panel span2">
    <h2>📡 Radar marché x402 <span class="right" id="radar-sub">demande réelle on-chain, 24 h</span></h2>
    <div class="tbl-scroll" style="max-height:280px"><table id="radar"><thead>
      <tr><th>Service</th><th>Catégorie</th><th class="num">Payeurs ★</th><th class="num">Appels</th><th class="num">Volume</th></tr>
    </thead><tbody></tbody></table></div>
  </div>
</div>

<footer>
  <span>Wallet <span class="mono" id="f-wallet">—</span></span>
  <a id="f-scan" target="_blank" rel="noopener">BaseScan ↗</a>
  <span id="f-reg"></span>
  <span id="f-upd" style="margin-left:auto"></span>
</footer>
</div>

<div class="lock hidden" id="lock">
  <div class="lock-box">
    <h3>🔒 X402 CONTROL</h3>
    <p>Entrez le token admin pour déverrouiller le centre de contrôle.</p>
    <input id="lock-input" type="password" placeholder="ADMIN_TOKEN" autocomplete="current-password">
    <button id="lock-btn">Déverrouiller</button>
    <div class="lock-err" id="lock-err"></div>
  </div>
</div>

<script>
"use strict";
// Token : URL (?token=) -> localStorage -> overlay de saisie. En PWA installée,
// l'app démarre sans query : le token vit dans localStorage.
var TOKEN = (function(){
  var q = new URLSearchParams(location.search).get("token");
  if (q) {
    try { localStorage.setItem("x402_token", q); } catch(e) {}
    history.replaceState(null, "", "/dashboard"); // le token ne traîne pas dans l'URL/l'historique
    return q;
  }
  try { return localStorage.getItem("x402_token"); } catch(e) { return null; }
})();
var state = { feedKeys: {}, routeRev: {}, lastRev: null, first: true };

function showLock(msg){
  document.getElementById("lock").classList.remove("hidden");
  document.getElementById("lock-err").textContent = msg || "";
}
document.getElementById("lock-btn").addEventListener("click", submitToken);
document.getElementById("lock-input").addEventListener("keydown", function(e){ if (e.key === "Enter") submitToken(); });
function submitToken(){
  var v = document.getElementById("lock-input").value.trim();
  if (!v) return;
  TOKEN = v;
  try { localStorage.setItem("x402_token", v); } catch(e) {}
  document.getElementById("lock").classList.add("hidden");
  refresh();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/dashboard-sw.js", { scope: "/dashboard" }).catch(function(){});
}

function $(id){ return document.getElementById(id); }
function fmt(n, d){ return n == null ? "—" : Number(n).toFixed(d == null ? 0 : d); }
function esc(s){ return String(s == null ? "" : s).replace(/[<>&]/g, function(c){ return {"<":"&lt;",">":"&gt;","&":"&amp;"}[c]; }); }

// Compteur animé (count-up) sur changement de valeur
function countUp(el, to, dec, prefix, suffix){
  if (to == null) { el.textContent = "—"; return; }
  var from = parseFloat((el.dataset.v || "0")); if (isNaN(from)) from = 0;
  el.dataset.v = to;
  var t0 = performance.now(), dur = Math.abs(to - from) < 1e-9 ? 0 : 700;
  function step(t){
    var k = dur ? Math.min(1, (t - t0) / dur) : 1;
    k = 1 - Math.pow(1 - k, 3);
    el.textContent = (prefix || "") + (from + (to - from) * k).toFixed(dec || 0) + (suffix || "");
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function relTime(iso){
  var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return Math.floor(s) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  return Math.floor(s / 3600) + "h";
}

function setLed(id, ok){
  var el = $(id); el.classList.remove("ok","ko","na");
  el.classList.add(ok === true ? "ok" : ok === false ? "ko" : "na");
}

// ---- horloge ----
setInterval(function(){
  var d = new Date();
  $("clock").textContent = d.toLocaleTimeString("fr-FR") + " Paris · " +
    d.toLocaleTimeString("fr-FR", { timeZone: "UTC", hour:"2-digit", minute:"2-digit" }) + " UTC";
}, 1000);

// ---- graphe minute (aire trafic + barres paiements) ----
function renderMinutely(mins){
  var el = $("minutely");
  // Axe continu : 90 dernières minutes, minutes vides = 0 (sinon les creux mentent)
  var byMin = {}, i;
  for (i = 0; i < mins.length; i++) byMin[new Date(mins[i].minute).setSeconds(0, 0)] = mins[i];
  var now = new Date(); now.setSeconds(0, 0);
  var series = [];
  for (i = 89; i >= 0; i--) {
    var t = now.getTime() - i * 60000;
    series.push(byMin[t] || { minute: new Date(t).toISOString(), total_calls: 0, paid_calls: 0, revenue_usd: 0 });
  }
  var any = false;
  for (i = 0; i < series.length; i++) if (series[i].total_calls > 0) { any = true; break; }
  if (!any) { el.innerHTML = '<div class="empty">Aucun trafic sur 90 min</div>'; return; }
  // Moyenne mobile 3 min pour la courbe (les barres de paiement restent brutes)
  var smooth = [];
  for (i = 0; i < series.length; i++) {
    var a = series[Math.max(0, i - 1)].total_calls, b = series[i].total_calls,
        c = series[Math.min(series.length - 1, i + 1)].total_calls;
    smooth.push((a + b + c) / 3);
  }
  var W = el.clientWidth || 600, H = el.clientHeight || 216, PB = 14, PT = 8;
  var maxC = 1;
  for (i = 0; i < smooth.length; i++) maxC = Math.max(maxC, smooth[i], series[i].paid_calls);
  var n = series.length, xw = W / n;
  function x(i){ return i * xw + xw / 2; }
  function y(v){ return PT + (H - PB - PT) * (1 - v / maxC); }
  var pts = "", bars = "";
  for (i = 0; i < n; i++) pts += (i ? " L" : "") + x(i) + "," + y(smooth[i]);
  var area = "M" + x(0) + "," + (H - PB) + " L" + pts.replace(/^ L/, "") + " L" + x(n - 1) + "," + (H - PB) + " Z";
  for (i = 0; i < n; i++) if (series[i].paid_calls > 0) {
    var bh = Math.max(4, (H - PB - PT) * series[i].paid_calls / maxC);
    bars += '<rect class="pbar" x="' + (x(i) - Math.max(2, xw * 0.35)) + '" y="' + (H - PB - bh) + '" width="' + Math.max(4, xw * 0.7) + '" height="' + bh + '" rx="2"><title>' + series[i].paid_calls + ' payé(s) · $' + fmt(series[i].revenue_usd, 3) + '</title></rect>';
  }
  var labels = "";
  for (i = 0; i < n; i += 15) {
    var hm = new Date(series[i].minute).toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" });
    labels += '<text class="axis" x="' + x(i) + '" y="' + (H - 2) + '" text-anchor="middle">' + hm + '</text>';
  }
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
    '<path class="area" d="' + area + '"/>' + bars + labels + '</svg>';
}

// ---- barres horaires 48 h ----
function renderHourly(hours){
  var el = $("hourly");
  if (!hours.length) { el.innerHTML = '<div class="empty">Aucune donnée</div>'; return; }
  var maxT = 1, i;
  for (i = 0; i < hours.length; i++) maxT = Math.max(maxT, hours[i].total_calls);
  var html = "";
  for (i = 0; i < hours.length; i++) {
    var h = hours[i];
    var hp = Math.round(160 * h.paywalls / maxT), hg = Math.round(160 * h.paid_calls / maxT);
    var lbl = new Date(h.heure).toLocaleString("fr-FR", { weekday:"short", hour:"2-digit" });
    html += '<div class="hb" data-tip="' + esc(lbl) + '\\n' + h.total_calls + ' appels · ' + h.paid_calls + ' payés\\n$' + fmt(h.revenue_usd, 3) + ' · ' + h.visitors + ' visiteurs">' +
      '<div class="b402" style="height:' + Math.max(h.paywalls ? 2 : 0, hp) + 'px"></div>' +
      '<div class="bpaid" style="height:' + Math.max(h.paid_calls ? 3 : 0, hg) + 'px"></div></div>';
  }
  el.innerHTML = html;
}

// ---- flux live ----
function renderFeed(feed){
  var el = $("feed"), html = "", i, seen = {};
  for (i = 0; i < feed.length; i++) {
    var e = feed[i], key = e.ts + "|" + e.route + "|" + e.status;
    seen[key] = 1;
    var cls = e.paid ? "paid" : e.status === 402 ? "pw" : e.status >= 500 ? "err" : e.free_tier ? "free" : "";
    var isNew = !state.first && !state.feedKeys[key];
    var badge = e.paid ? "PAYÉ" : e.status === 402 ? "402" : e.free_tier ? "FREE" : e.status;
    var amt = e.paid ? "+$" + fmt(e.amount_usd, 3) : "";
    var who = e.payer_short ? esc(e.payer_short) + "…" : (e.visitor ? "#" + esc(e.visitor) : "");
    html += '<div class="ev ' + cls + (isNew ? " new" : "") + '">' +
      '<span class="t" data-ts="' + esc(e.ts) + '">' + relTime(e.ts) + '</span>' +
      '<span class="r mono">' + esc(e.route) + (who ? ' <span style="color:var(--faint)">' + who + '</span>' : "") + '</span>' +
      '<span class="a num">' + amt + '</span>' +
      '<span class="badge">' + badge + '</span></div>';
  }
  el.innerHTML = html || '<div class="empty">En attente d\\u2019événements…</div>';
  state.feedKeys = seen;
  var n402 = 0, nPaid = 0;
  for (i = 0; i < feed.length; i++) { if (feed[i].paid) nPaid++; else if (feed[i].status === 402) n402++; }
  $("feed-sub").textContent = nPaid + " payés · " + n402 + " × 402 (80 derniers)";
}

// timestamps relatifs rafraîchis chaque seconde
setInterval(function(){
  var els = document.querySelectorAll(".ev .t"), i;
  for (i = 0; i < els.length; i++) els[i].textContent = relTime(els[i].dataset.ts);
}, 1000);

// ---- ticker tape ----
function renderTape(d){
  var items = [], i;
  items.push('<span class="tk">💰 <b>$' + fmt(d.cumulative.revenue, 3) + '</b> cumulés</span>');
  items.push('<span class="tk">🏦 solde <b class="up">' + fmt(d.balance, 4) + ' USDC</b></span>');
  if (d.today) items.push('<span class="tk">📅 aujourd\\u2019hui <b>' + d.today.total_calls + '</b> appels · <b class="up">' + d.today.paid_calls + ' payés</b> · <b class="warn">' + d.today.saw_paywall + ' × 402</b></span>');
  var paidEvents = [];
  for (i = 0; i < d.feed.length && paidEvents.length < 8; i++) if (d.feed[i].paid) paidEvents.push(d.feed[i]);
  for (i = 0; i < paidEvents.length; i++) {
    var e = paidEvents[i];
    items.push('<span class="tk"><span class="up">▲ +$' + fmt(e.amount_usd, 3) + '</span> <b>' + esc(e.route.replace("/v1/","")) + '</b> ' + relTime(e.ts) + '</span>');
  }
  if (d.latency) items.push('<span class="tk">⚡ p50 <b>' + fmt(d.latency.p50_ms) + 'ms</b> · p95 <b>' + fmt(d.latency.p95_ms) + 'ms</b></span>');
  if (d.status.registry && d.status.registry.ok) items.push('<span class="tk">📡 registre MCP <b class="up">' + esc(d.status.registry.name) + '</b> · ' + esc(d.status.registry.status) + '</span>');
  for (i = 0; i < d.routes.length && i < 5; i++) {
    var r = d.routes[i];
    if (r.paid_calls > 0) items.push('<span class="tk"><b>' + esc(r.route.replace("/v1/","")) + '</b> vol ' + r.paid_calls + ' · <span class="up">$' + fmt(r.revenue_usd, 2) + '</span></span>');
  }
  var half = items.join("");
  var tape = half + half; // doublé pour la boucle infinie
  if ($("tape").dataset.h !== half) { $("tape").innerHTML = tape; $("tape").dataset.h = half; }
}

// ---- tables ----
function renderRoutes(routes){
  var tb = $("routes").querySelector("tbody"), html = "", i;
  for (i = 0; i < routes.length; i++) {
    var r = routes[i];
    var prev = state.routeRev[r.route];
    var bump = prev != null && Number(r.revenue_usd) > prev;
    var trend = prev == null ? "" : Number(r.revenue_usd) > prev ? '<span class="trend up">▲</span>' : "";
    state.routeRev[r.route] = Number(r.revenue_usd);
    html += '<tr' + (bump ? ' class="bump"' : '') + '><td class="mono">' + esc(r.route.replace("/v1/","")) + trend + '</td>' +
      '<td class="num price">' + esc(r.price || "—") + '</td>' +
      '<td class="num">' + (r.paid_calls || 0) + '</td>' +
      '<td class="num">' + (r.unique_payers || 0) + '</td>' +
      '<td class="num" style="color:var(--up)">$' + fmt(r.revenue_usd, 3) + '</td>' +
      '<td class="num">' + (r.conversion_pct != null ? r.conversion_pct + "%" : "—") + '</td>' +
      '<td class="num">' + (r.p50_ms != null ? Math.round(r.p50_ms) + "ms" : "—") + '</td></tr>';
  }
  tb.innerHTML = html || '<tr><td colspan="7" class="empty">Aucun appel payé encore</td></tr>';
}

function renderRadar(rows){
  var tb = $("radar").querySelector("tbody"), html = "", i;
  for (i = 0; i < rows.length; i++) {
    var r = rows[i];
    var hl = r.is_ours ? ' style="background:#00e58a14"' : '';
    html += '<tr' + hl + '><td class="mono">' + (r.is_ours ? '🏠 ' : '') + esc(r.service) + '</td>' +
      '<td><span class="badge" style="font-size:10px;padding:2px 7px;border-radius:8px;background:#ffffff0d;color:var(--dim)">' + esc(r.category) + '</span></td>' +
      '<td class="num" style="color:var(--up);font-weight:700">' + r.payers + '</td>' +
      '<td class="num">' + r.txs + '</td>' +
      '<td class="num">$' + fmt(r.volume_usd, 2) + '</td></tr>';
  }
  tb.innerHTML = html || '<tr><td colspan="5" class="empty">Radar pas encore lancé — /radar/run</td></tr>';
  if (rows.length) $("radar-sub").textContent = "sweep " + relTime(rows[0].ts) + " · " +
    rows[0].total_payers + " payeurs · $" + fmt(rows[0].total_volume, 0) + " · ★ = métrique anti-wash";
}

function renderPayers(payers){
  var tb = $("payers").querySelector("tbody"), html = "", i;
  for (i = 0; i < payers.length; i++) {
    var p = payers[i];
    html += '<tr><td class="mono">' + esc(p.payer_short) + '…</td><td class="num">' + p.paid_calls + '</td>' +
      '<td class="num" style="color:var(--up)">$' + fmt(p.revenue_usd, 3) + '</td>' +
      '<td class="num" style="color:var(--faint)">' + relTime(p.last_seen) + '</td></tr>';
  }
  tb.innerHTML = html || '<tr><td colspan="4" class="empty">Aucun payeur encore</td></tr>';
}

// ---- boucle principale ----
function refresh(){
  if (!TOKEN) { showLock(); return; }
  fetch("/dashboard/data?token=" + encodeURIComponent(TOKEN))
    .then(function(r){
      if (r.status === 401) { try { localStorage.removeItem("x402_token"); } catch(e) {} TOKEN = null; showLock("Token invalide"); throw 0; }
      if (!r.ok) throw 0;
      return r.json();
    })
    .then(function(d){
      // LEDs
      setLed("led-api", true);
      setLed("led-mcp", d.status.mcp && d.status.mcp.ok);
      setLed("led-worker", d.status.worker ? d.status.worker.ok : null);
      setLed("led-reg", d.status.registry ? d.status.registry.ok : null);

      // KPIs
      countUp($("v-bal"), d.balance, 4);
      $("s-bal").textContent = d.eur != null ? "\\u2248 " + fmt(d.eur, 2) + " \\u20AC · USDC on-chain · Base" : "Base · USDC";
      var tRev = d.today ? Number(d.today.revenue_usd) : 0;
      var yRev = d.yesterday ? Number(d.yesterday.revenue_usd) : 0;
      countUp($("v-rev"), tRev, 3, "$");
      $("s-rev").textContent = "hier : $" + fmt(yRev, 3);
      var dr = $("d-rev");
      if (yRev > 0) { var pct = (tRev - yRev) / yRev * 100;
        dr.textContent = (pct >= 0 ? "+" : "") + pct.toFixed(0) + "%";
        dr.className = "delta " + (pct >= 0 ? "up" : "down");
      } else { dr.textContent = tRev > 0 ? "NEW" : ""; dr.className = "delta up"; }
      countUp($("v-cum"), d.cumulative.revenue, 3, "$");
      $("s-cum").textContent = "\\u2248 " + fmt(d.cumulative.revenue * 0.92, 2) + " \\u20AC";
      countUp($("v-paid"), d.today ? d.today.paid_calls : 0);
      var dp = $("d-paid"), yPaid = d.yesterday ? d.yesterday.paid_calls : 0;
      dp.textContent = "hier " + yPaid; dp.className = "delta " + ((d.today ? d.today.paid_calls : 0) >= yPaid ? "up" : "down");
      var recent = d.minutely.slice(-15), rpm = 0, i;
      for (i = 0; i < recent.length; i++) rpm += recent[i].total_calls;
      countUp($("v-rpm"), recent.length ? rpm / recent.length : 0, 1);
      countUp($("v-402"), d.today ? d.today.saw_paywall : 0);
      countUp($("v-conv"), d.cumulative.conversion, 1, "", "%");
      if (d.latency) { $("v-lat").textContent = fmt(d.latency.p50_ms) + " / " + fmt(d.latency.p95_ms) + " ms";
        $("s-lat").textContent = "24 h · " + d.latency.sample + " requêtes"; }

      // flash sur nouveau revenu
      if (state.lastRev != null && d.cumulative.revenue > state.lastRev) {
        ["k-bal","k-rev"].forEach(function(id){ var k = $(id); k.classList.remove("flash"); void k.offsetWidth; k.classList.add("flash"); });
      }
      state.lastRev = d.cumulative.revenue;

      // jauge
      var conv = Math.max(0, Math.min(100, d.cumulative.conversion || 0));
      document.querySelector(".gauge .fg").setAttribute("stroke-dasharray", (conv / 100 * 314) + " 314");
      $("g-val").textContent = conv.toFixed(1) + "%";
      var hs = "";
      hs += '<span>MCP · <b>' + (d.status.mcp ? d.status.mcp.tools : "—") + ' outils</b> exposés</span>';
      hs += '<span>Payeurs uniques · <b>' + (function(){ var m = 0; for (var j = 0; j < d.routes.length; j++) m = Math.max(m, d.routes[j].unique_payers || 0); return m; })() + '</b></span>';
      if (d.status.worker && d.status.worker.ok != null) hs += '<span>Worker Mac mini · <b>' + (d.status.worker.ok ? (d.status.worker.ms + " ms") : "OFFLINE") + '</b></span>';
      if (d.status.registry && d.status.registry.ok) hs += '<span>Registre · <b style="color:var(--up)">' + esc(d.status.registry.status) + '</b></span>';
      $("health").innerHTML = hs;

      renderMinutely(d.minutely);
      renderHourly(d.hourly);
      renderFeed(d.feed);
      renderTape(d);
      renderRoutes(d.routes);
      renderPayers(d.payers);
      renderRadar(d.radar || []);

      $("f-wallet").textContent = d.payTo || "—";
      if (d.payTo) $("f-scan").href = "https://basescan.org/address/" + d.payTo;
      $("f-reg").textContent = d.status.registry && d.status.registry.name ? "MCP: " + d.status.registry.name : "";
      $("f-upd").textContent = "maj " + new Date().toLocaleTimeString("fr-FR");
      state.first = false;
    })
    .catch(function(){ setLed("led-api", false); });
}
refresh();
setInterval(refresh, 6000);
window.addEventListener("resize", function(){ if (state.lastRev != null) refresh(); });
</script>
</body></html>`);
});

export default router;
