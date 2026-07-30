// Démo publique gratuite : "colle un token -> verdict honeypot en direct".
// Vitrine de /v1/crypto/security. Self-call avec la clé interne (les sources
// GoPlus/DexScreener sont gratuites -> coût marginal ~0). Rate-limit best-effort
// pour éviter que la démo serve d'API gratuite. CTA vers helper/MCP/RapidAPI.
import { Router } from "express";

const router = Router();
const SELF_KEY = process.env.VIRTUALS_API_KEY || process.env.SELF_INTERNAL_KEY || "";
const CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "solana"];

// Rate-limit best-effort (module-level ; se réinitialise au cold start serverless — suffisant pour bloquer l'abus casual).
const hits = new Map(); // ipHash -> [timestamps ms]
let dayCount = 0, dayStamp = 0;
const PER_IP_HOUR = 30, GLOBAL_DAY = 2000;
function allow(ip, now) {
  const day = Math.floor(now / 86400000);
  if (day !== dayStamp) { dayStamp = day; dayCount = 0; }
  if (dayCount >= GLOBAL_DAY) return false;
  const arr = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  if (arr.length >= PER_IP_HOUR) { hits.set(ip, arr); return false; }
  arr.push(now); hits.set(ip, arr); dayCount++; return true;
}

router.get("/honeypot/check", async (req, res) => {
  const address = String(req.query.address || "").trim();
  const chain = CHAINS.includes(String(req.query.chain)) ? String(req.query.chain) : "ethereum";
  if (!/^0x[0-9a-fA-F]{40}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
    return res.status(400).json({ error: "Invalid token address" });
  if (!SELF_KEY) return res.status(503).json({ error: "demo_unavailable" });
  const now = Date.now();
  const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "0").slice(0, 64);
  if (!allow(ip, now)) return res.status(429).json({ error: "Demo rate limit — grab a wallet/key for unlimited checks (see the API options below)." });
  try {
    const base = `${req.protocol}://${req.get("host")}`;
    const r = await fetch(`${base}/v1/crypto/security?address=${encodeURIComponent(address)}&chain=${chain}`, {
      headers: { "x-api-key": SELF_KEY }, signal: AbortSignal.timeout(30000),
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: "check_failed", detail: String(e.message || e).slice(0, 120) });
  }
});

router.get("/honeypot", (_req, res) => {
  res.set("content-type", "text/html; charset=utf-8").send(PAGE);
});

const PAGE = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Is this token a honeypot? — free check (8 chains)</title>
<meta name="description" content="Paste a token address, get an instant honeypot / rug-pull verdict across 8 chains. Powered by x402-farm.">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0b0e14;color:#e6e9ef;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:640px;margin:0 auto;padding:48px 20px 80px}
h1{font-size:30px;margin:0 0 6px;letter-spacing:-.02em}
.sub{color:#9aa4b2;margin:0 0 28px}
.card{background:#141924;border:1px solid #232a38;border-radius:16px;padding:20px}
label{display:block;font-size:13px;color:#9aa4b2;margin:0 0 6px}
.row{display:flex;gap:10px;flex-wrap:wrap}
input,select{background:#0b0e14;border:1px solid #2a3342;color:#e6e9ef;border-radius:10px;padding:12px 14px;font-size:15px}
input{flex:1;min-width:220px}
button{background:#4f7cff;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
.ex{margin:12px 0 0;font-size:13px;color:#9aa4b2}
.ex a{color:#8ab4ff;cursor:pointer;text-decoration:none}
#out{margin-top:20px}
.verdict{display:flex;align-items:center;gap:12px;padding:16px;border-radius:12px;font-weight:700;font-size:20px}
.v-OK{background:#0f2e1c;color:#54e08a;border:1px solid #1f5a3a}
.v-CAUTION{background:#33290a;color:#f0c15a;border:1px solid #6a5416}
.v-HIGH_RISK{background:#3a1a0c;color:#ff9a54;border:1px solid #7a3a1a}
.v-AVOID{background:#3a0f12;color:#ff6b74;border:1px solid #7a1f26}
.meta{margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:14px}
.meta div span{color:#9aa4b2}
.flags{margin-top:12px;display:flex;gap:6px;flex-wrap:wrap}
.flag{background:#2a1015;color:#ff9aa2;border:1px solid #5a1f26;border-radius:20px;padding:3px 10px;font-size:12px}
.err{color:#ff9aa2;padding:14px;background:#2a1015;border:1px solid #5a1f26;border-radius:12px}
.cta{margin-top:34px;padding-top:24px;border-top:1px solid #232a38;font-size:14px;color:#9aa4b2}
.cta code{background:#141924;border:1px solid #232a38;border-radius:6px;padding:2px 7px;color:#cdd5e0}
.cta a{color:#8ab4ff;text-decoration:none}
.cta .opts{margin-top:10px;line-height:2}
</style></head><body><div class="wrap">
<h1>Is this token a honeypot? 🍯</h1>
<p class="sub">Paste a token address — get an instant honeypot / rug-pull verdict across 8 chains. Free.</p>
<div class="card">
  <label for="addr">Token contract address</label>
  <div class="row">
    <input id="addr" placeholder="0x… (or Solana mint)" autocomplete="off" spellcheck="false">
    <select id="chain">
      <option>ethereum</option><option selected>base</option><option>arbitrum</option><option>optimism</option>
      <option>polygon</option><option>bsc</option><option>avalanche</option><option>solana</option>
    </select>
    <button id="go">Check</button>
  </div>
  <p class="ex">Try: <a data-a="0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" data-c="ethereum">USDC</a> ·
     <a data-a="0x4200000000000000000000000000000000000006" data-c="base">WETH (Base)</a></p>
  <div id="out"></div>
</div>
<div class="cta">
  This is a single call of <code>GET /v1/crypto/security</code>. Wire it into your bot:
  <div class="opts">
    🧰 npm: <code>npm i honeypot-guard</code> → <a href="https://www.npmjs.com/package/honeypot-guard" target="_blank">honeypot-guard</a><br>
    🤖 MCP: <code>npx -y x402farm-mcp</code> → <a href="https://smithery.ai/server/laurenthalbrun/x402farm" target="_blank">on Smithery</a><br>
    🔌 REST / fiat: <a href="https://rapidapi.com/Ghost11777/api/residential-scraper-crypto-company-data" target="_blank">on RapidAPI</a> ·
    ⚡ x402 (USDC on Base): <a href="https://api.x-402.online" target="_blank">api.x-402.online</a>
  </div>
</div>
<script>
const $=s=>document.querySelector(s), out=$("#out"), go=$("#go");
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
async function check(){
  const address=$("#addr").value.trim(), chain=$("#chain").value;
  if(!address)return;
  go.disabled=true; out.innerHTML='<p style="color:#9aa4b2">Checking…</p>';
  try{
    const r=await fetch('/honeypot/check?address='+encodeURIComponent(address)+'&chain='+chain);
    const d=await r.json();
    if(!r.ok){out.innerHTML='<div class="err">'+esc(d.error||'Error')+'</div>';return}
    if(d.found===false){out.innerHTML='<div class="err">Token not found on '+esc(chain)+'. Check the address/chain.</div>';return}
    const v=d.verdict||'CAUTION';
    const ic={OK:'✅',CAUTION:'⚠️',HIGH_RISK:'🔶',AVOID:'⛔'}[v]||'⚠️';
    const flags=(d.flags||[]).map(f=>'<span class="flag">'+esc(typeof f==='string'?f:(f.f||JSON.stringify(f)))+'</span>').join('');
    out.innerHTML='<div class="verdict v-'+esc(v)+'">'+ic+' '+esc(v)+(d.isHoneypot?' — HONEYPOT':'')+'</div>'+
      '<div class="meta">'+
      '<div><span>Token</span> '+esc((d.tokenName||'?')+' ('+(d.tokenSymbol||'?')+')')+'</div>'+
      '<div><span>Buy / sell tax</span> '+esc((d.buyTaxPct??'?')+'% / '+(d.sellTaxPct??'?')+'%')+'</div>'+
      '<div><span>Open source</span> '+(d.isOpenSource?'yes':'no')+'</div>'+
      '<div><span>Holders</span> '+esc(d.holderCount??'?')+'</div>'+
      '</div>'+(flags?'<div class="flags">'+flags+'</div>':'');
  }catch(e){out.innerHTML='<div class="err">Network error</div>'}
  finally{go.disabled=false}
}
go.onclick=check;
$("#addr").addEventListener('keydown',e=>{if(e.key==='Enter')check()});
document.querySelectorAll('.ex a').forEach(a=>a.onclick=()=>{$("#addr").value=a.dataset.a;$("#chain").value=a.dataset.c;check()});
</script>
</div></body></html>`;

export default router;
