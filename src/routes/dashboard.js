import { Router } from "express";

// Dashboard visuel privé (protégé par token) : revenu, appels, conversion par route,
// et solde USDC on-chain du wallet encaisseur. URL : /dashboard?token=ADMIN_TOKEN
const router = Router();

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC sur Base mainnet
const RPC = "https://mainnet.base.org";

async function usdcBalance(addr) {
  try {
    const data = "0x70a08231" + addr.slice(2).padStart(64, "0"); // balanceOf(address)
    const r = await fetch(RPC, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: BASE_USDC, data }, "latest"] }),
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    return j.result ? Number(BigInt(j.result)) / 1e6 : null;
  } catch { return null; }
}

async function fetchAnalytics() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/rest/v1/api_revenue_by_route?order=revenue_usd.desc`, {
      headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
    });
    return await r.json();
  } catch { return null; }
}

const eur = (n) => (n * 0.92).toFixed(2); // approximation USD->EUR
const esc = (s) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

router.get("/dashboard", async (req, res) => {
  const token = req.query.token;
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).type("html").send("<h1>401</h1><p>Ajoutez ?token=VOTRE_ADMIN_TOKEN à l'URL.</p>");
  }
  const [rows, bal] = await Promise.all([fetchAnalytics(), usdcBalance(process.env.PAY_TO || "0x0")]);
  const list = Array.isArray(rows) ? rows : [];
  const totalRev = list.reduce((s, x) => s + Number(x.revenue_usd || 0), 0);
  const totalPaid = list.reduce((s, x) => s + Number(x.paid_calls || 0), 0);
  const totalPayers = Math.max(0, ...list.map((x) => Number(x.unique_payers || 0)));
  const total402 = list.reduce((s, x) => s + Number(x.saw_paywall || 0), 0);

  const routeRows = list.filter((r) => r.route?.startsWith("/v1/")).map((r) => `
    <tr>
      <td class="mono">${esc(r.route)}</td>
      <td class="num">${r.paid_calls || 0}</td>
      <td class="num">${r.unique_payers || 0}</td>
      <td class="num">$${Number(r.revenue_usd || 0).toFixed(3)}</td>
      <td class="num">${r.saw_paywall || 0}</td>
      <td class="num">${r.conversion_pct != null ? r.conversion_pct + "%" : "—"}</td>
      <td class="num">${r.p50_ms != null ? Math.round(r.p50_ms) + "ms" : "—"}</td>
    </tr>`).join("");

  res.type("html").send(`<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>x402-farm — Dashboard</title>
<meta http-equiv="refresh" content="60">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0a0c1c;color:#e8eaf2;padding:24px;max-width:1100px;margin:0 auto}
h1{font-size:20px;font-weight:700;margin-bottom:2px}
.sub{color:#8891b0;font-size:13px;margin-bottom:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:26px}
.card{background:linear-gradient(160deg,#141833,#0f1226);border:1px solid #232a52;border-radius:14px;padding:18px}
.card .label{color:#8891b0;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
.card .val{font-size:28px;font-weight:700}
.card .val.big{background:linear-gradient(90deg,#5b8cff,#8f6bff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.card .hint{color:#6b7396;font-size:12px;margin-top:4px}
table{width:100%;border-collapse:collapse;background:#0f1226;border:1px solid #232a52;border-radius:14px;overflow:hidden}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #1b2044;font-size:13px}
th{color:#8891b0;font-size:11px;text-transform:uppercase;letter-spacing:.05em;background:#141833}
.num{text-align:right;font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#b9c2e6}
tr:last-child td{border-bottom:none}
.empty{color:#6b7396;text-align:center;padding:30px}
.foot{color:#6b7396;font-size:12px;margin-top:18px}
a{color:#5b8cff}
</style></head><body>
<h1>🌾 x402-farm — Dashboard</h1>
<div class="sub">53 APIs · FR/UK/US · rafraîchi automatiquement toutes les 60s</div>

<div class="cards">
  <div class="card"><div class="label">Solde wallet (on-chain)</div><div class="val big">${bal != null ? bal.toFixed(4) + " USDC" : "—"}</div><div class="hint">≈ ${bal != null ? eur(bal) : "—"} € · Base mainnet</div></div>
  <div class="card"><div class="label">Revenu cumulé</div><div class="val">$${totalRev.toFixed(3)}</div><div class="hint">≈ ${eur(totalRev)} €</div></div>
  <div class="card"><div class="label">Appels payés</div><div class="val">${totalPaid}</div></div>
  <div class="card"><div class="label">Payeurs uniques</div><div class="val">${totalPayers}</div></div>
  <div class="card"><div class="label">402 servis</div><div class="val">${total402}</div><div class="hint">vus le paywall</div></div>
</div>

${list.length ? `<table>
  <thead><tr><th>Route</th><th class="num">Payés</th><th class="num">Payeurs</th><th class="num">Revenu</th><th class="num">402</th><th class="num">Conv.</th><th class="num">p50</th></tr></thead>
  <tbody>${routeRows || `<tr><td colspan="7" class="empty">Aucun appel payant encore — le premier paiement bootstrap allumera ce tableau.</td></tr>`}</tbody>
</table>` : `<div class="card empty">Analytics indisponible (Supabase non configuré) ou aucun appel enregistré.</div>`}

<div class="foot">Wallet : <span class="mono">${esc(process.env.PAY_TO || "—")}</span> · <a href="https://basescan.org/address/${esc(process.env.PAY_TO || "")}" target="_blank">voir sur BaseScan</a></div>
</body></html>`);
});

export default router;
