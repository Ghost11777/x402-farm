import { Router } from "express";

// Dashboard visuel privé (token) : KPIs, graphiques SVG (revenu/jour, top routes,
// répartition pays), jauges, solde USDC on-chain. URL : /dashboard?token=ADMIN_TOKEN
const router = Router();

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RPC = "https://mainnet.base.org";

async function usdcBalance(addr) {
  try {
    const data = "0x70a08231" + addr.slice(2).padStart(64, "0");
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: BASE_USDC, data }, "latest"] }),
      signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return j.result ? Number(BigInt(j.result)) / 1e6 : null;
  } catch { return null; }
}
async function sb(view, qs = "") {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/rest/v1/${view}${qs}`, { headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    return await r.json();
  } catch { return null; }
}
const eur = (n) => (n * 0.92).toFixed(2);
const esc = (s) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

// Barres SVG horizontales (top routes / pays)
function barChart(items, { label, value, max, fmt = (v) => v, color = "#5b8cff" }) {
  if (!items.length) return `<div class="empty">Aucune donnée</div>`;
  const m = max || Math.max(...items.map(value), 1);
  return `<div class="bars">` + items.map((it) => {
    const v = value(it), w = Math.max(2, Math.round((v / m) * 100));
    return `<div class="bar-row"><div class="bar-label mono">${esc(label(it))}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>
      <div class="bar-val">${fmt(v)}</div></div>`;
  }).join("") + `</div>`;
}

// Sparkline/colonnes revenu par jour
function columns(days) {
  if (!days.length) return `<div class="empty">Aucune donnée encore</div>`;
  const max = Math.max(...days.map((d) => Number(d.revenue_usd) || 0), 0.001);
  return `<div class="cols">` + days.map((d) => {
    const v = Number(d.revenue_usd) || 0;
    const h = Math.max(3, Math.round((v / max) * 90));
    const day = (d.jour || "").slice(5);
    return `<div class="col"><div class="col-bar" style="height:${h}px" title="$${v.toFixed(3)}"></div><div class="col-lbl">${day}</div></div>`;
  }).join("") + `</div>`;
}

// Jauge de conversion (donut)
function gauge(pct, label) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const dash = (p / 100) * 314;
  return `<svg viewBox="0 0 120 120" class="gauge">
    <circle cx="60" cy="60" r="50" fill="none" stroke="#1b2044" stroke-width="12"/>
    <circle cx="60" cy="60" r="50" fill="none" stroke="url(#g)" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${dash} 314" transform="rotate(-90 60 60)"/>
    <text x="60" y="56" text-anchor="middle" class="gauge-val">${p.toFixed(0)}%</text>
    <text x="60" y="76" text-anchor="middle" class="gauge-lbl">${label}</text>
  </svg>`;
}

router.get("/dashboard", async (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(401).type("html").send("<h1>401</h1><p>Ajoutez ?token=VOTRE_ADMIN_TOKEN à l'URL.</p>");
  }
  const [routes, daily, byCountry, bal] = await Promise.all([
    sb("api_revenue_by_route", "?order=revenue_usd.desc"),
    sb("api_daily", "?order=jour.asc&limit=14"),
    sb("api_by_country", ""),
    usdcBalance(process.env.PAY_TO || "0x0"),
  ]);
  const list = Array.isArray(routes) ? routes : [];
  const days = Array.isArray(daily) ? daily : [];
  const countries = Array.isArray(byCountry) ? byCountry : [];
  const paidRoutes = list.filter((r) => r.route?.startsWith("/v1/"));

  const totalRev = list.reduce((s, x) => s + Number(x.revenue_usd || 0), 0);
  const totalPaid = list.reduce((s, x) => s + Number(x.paid_calls || 0), 0);
  const totalPayers = Math.max(0, ...list.map((x) => Number(x.unique_payers || 0)));
  const total402 = list.reduce((s, x) => s + Number(x.saw_paywall || 0), 0);
  const convGlobal = total402 + totalPaid > 0 ? (totalPaid / (total402 + totalPaid)) * 100 : 0;
  const topRoutes = [...paidRoutes].sort((a, b) => (b.paid_calls || 0) - (a.paid_calls || 0)).slice(0, 8);
  const countryColors = { FR: "#5b8cff", UK: "#8f6bff", US: "#3fcaa0", GENERIC: "#e0a13c", OTHER: "#8891b0" };

  res.type("html").send(`<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>x402-farm — Dashboard</title><meta http-equiv="refresh" content="60">
<style>
:root{color-scheme:dark}*{box-sizing:border-box;margin:0;padding:0}
body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(1200px 600px at 20% -10%,#182046,#0a0c1c);color:#e8eaf2;padding:24px;max-width:1120px;margin:0 auto}
h1{font-size:21px}.sub{color:#8891b0;font-size:13px;margin-bottom:22px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px}
.card{background:linear-gradient(160deg,#141833,#0f1226);border:1px solid #232a52;border-radius:16px;padding:18px}
.card .label{color:#8891b0;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
.card .val{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}
.val.big{background:linear-gradient(90deg,#5b8cff,#8f6bff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.hint{color:#6b7396;font-size:12px;margin-top:4px}
.grid{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px}
@media(max-width:760px){.grid{grid-template-columns:1fr}}
.panel{background:#0f1226;border:1px solid #232a52;border-radius:16px;padding:18px}
.panel h2{font-size:13px;color:#aeb6d8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:16px}
.cols{display:flex;align-items:flex-end;gap:6px;height:110px}
.col{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px}
.col-bar{width:100%;max-width:34px;background:linear-gradient(180deg,#5b8cff,#8f6bff);border-radius:5px 5px 0 0}
.col-lbl{font-size:10px;color:#6b7396}
.gauge{width:150px;height:150px;display:block;margin:0 auto}
.gauge-val{fill:#e8eaf2;font-size:22px;font-weight:700}.gauge-lbl{fill:#8891b0;font-size:9px;text-transform:uppercase}
.bars{display:flex;flex-direction:column;gap:9px}
.bar-row{display:grid;grid-template-columns:150px 1fr 60px;align-items:center;gap:10px}
.bar-label{font-size:12px;color:#b9c2e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-track{background:#1b2044;border-radius:6px;height:14px;overflow:hidden}
.bar-fill{height:100%;border-radius:6px;min-width:2px;transition:width .3s}
.bar-val{font-size:12px;color:#aeb6d8;text-align:right;font-variant-numeric:tabular-nums}
.ctry{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.chip{display:flex;align-items:center;gap:6px;font-size:12px;color:#aeb6d8}
.dot{width:10px;height:10px;border-radius:3px}
table{width:100%;border-collapse:collapse;margin-top:4px}
th,td{padding:9px 10px;text-align:left;border-bottom:1px solid #1b2044;font-size:13px}
th{color:#8891b0;font-size:11px;text-transform:uppercase}
.num{text-align:right;font-variant-numeric:tabular-nums}.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#b9c2e6}
tr:last-child td{border-bottom:none}.empty{color:#6b7396;text-align:center;padding:22px;font-size:13px}
.foot{color:#6b7396;font-size:12px;margin-top:18px}a{color:#5b8cff}
svg defs{display:none}
</style></head><body>
<svg width="0" height="0"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b8cff"/><stop offset="1" stop-color="#8f6bff"/></linearGradient></defs></svg>
<h1>🌾 x402-farm — Dashboard</h1>
<div class="sub">53 APIs · FR/UK/US · auto-refresh 60s</div>

<div class="cards">
  <div class="card"><div class="label">Solde wallet</div><div class="val big">${bal != null ? bal.toFixed(4) : "—"}<span style="font-size:14px"> USDC</span></div><div class="hint">≈ ${bal != null ? eur(bal) : "—"} € · Base</div></div>
  <div class="card"><div class="label">Revenu cumulé</div><div class="val">$${totalRev.toFixed(3)}</div><div class="hint">≈ ${eur(totalRev)} €</div></div>
  <div class="card"><div class="label">Appels payés</div><div class="val">${totalPaid}</div></div>
  <div class="card"><div class="label">Payeurs uniques</div><div class="val">${totalPayers}</div></div>
  <div class="card"><div class="label">402 servis</div><div class="val">${total402}</div><div class="hint">paywall vu</div></div>
</div>

<div class="grid">
  <div class="panel"><h2>Revenu par jour (14 j)</h2>${columns(days)}</div>
  <div class="panel"><h2>Conversion 402→paiement</h2>${gauge(convGlobal, "global")}</div>
</div>

<div class="grid">
  <div class="panel"><h2>Top routes (appels payés)</h2>
    ${barChart(topRoutes, { label: (r) => r.route.replace("/v1/", ""), value: (r) => Number(r.paid_calls || 0), fmt: (v) => v })}
  </div>
  <div class="panel"><h2>Répartition par pays</h2>
    ${barChart(countries, { label: (c) => c.pays, value: (c) => Number(c.revenue_usd || 0), fmt: (v) => "$" + v.toFixed(2), color: "#8f6bff" })}
    <div class="ctry">${countries.map((c) => `<span class="chip"><span class="dot" style="background:${countryColors[c.pays] || "#8891b0"}"></span>${esc(c.pays)}: ${c.paid_calls || 0}</span>`).join("")}</div>
  </div>
</div>

<div class="panel"><h2>Détail par route</h2>
${paidRoutes.length ? `<table><thead><tr><th>Route</th><th class="num">Payés</th><th class="num">Payeurs</th><th class="num">Revenu</th><th class="num">Conv.</th><th class="num">p50</th></tr></thead><tbody>
${paidRoutes.map((r) => `<tr><td class="mono">${esc(r.route)}</td><td class="num">${r.paid_calls || 0}</td><td class="num">${r.unique_payers || 0}</td><td class="num">$${Number(r.revenue_usd || 0).toFixed(3)}</td><td class="num">${r.conversion_pct != null ? r.conversion_pct + "%" : "—"}</td><td class="num">${r.p50_ms != null ? Math.round(r.p50_ms) + "ms" : "—"}</td></tr>`).join("")}
</tbody></table>` : `<div class="empty">Aucun appel payant encore — le premier paiement bootstrap allumera ces graphiques.</div>`}
</div>

<div class="foot">Wallet <span class="mono">${esc(process.env.PAY_TO || "—")}</span> · <a href="https://basescan.org/address/${esc(process.env.PAY_TO || "")}" target="_blank">BaseScan</a></div>
</body></html>`);
});

export default router;
