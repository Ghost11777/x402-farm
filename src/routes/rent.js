// /rent — vitrine HUMAINE de location de proxy mobile FR/DOM (opérateurs multi-comptes).
// Réutilise le backend proxy existant. Checkout crypto (Base/Solana) + x402 pour les agents.
// Contact de commande via env ORDER_CONTACT (Telegram/email). Statut d'exit live côté client.
import { Router } from "express";
const router = Router();

const BASE_PAYTO = "0x2c871C2b8876dc35e9E19646FDa5ABF1cd27735F";
const SOL_PAYTO = "3tvSUk2R16rrL4eo2diYpMUsBH1wa3tafqJE44x3bVgs";

const page = (contact) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>French & Guadeloupe 4G Mobile Proxy — for agencies, ad verification & French data</title>
<meta name="description" content="Dedicated 4G mobile proxy on a real French / Guadeloupe (Orange, AS16028) carrier IP — a trusted, geo-accurate French mobile exit for social media agencies, ad verification, SERP tracking and French web scraping. Pay in USDC on Base or Solana. Instant, no signup.">
<style>
:root{--bg:#0a0e17;--card:#121826;--card2:#0d1320;--line:#1e2636;--fg:#e8edf6;--dim:#98a4b8;--faint:#6b7688;--acc:#00e58a;--acc2:#5b8cff;--warn:#f5b544;--mono:ui-monospace,"SF Mono",Menlo,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--acc2);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1000px;margin:0 auto;padding:0 20px}
header{padding:64px 0 34px}
.eyebrow{font:700 12px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--acc)}
h1{font-size:clamp(30px,5.2vw,50px);line-height:1.06;margin:16px 0 16px;letter-spacing:-1.2px}
h1 b{color:var(--acc)}
.sub{font-size:19px;color:var(--dim);max-width:680px}
.live{display:inline-flex;align-items:center;gap:8px;margin-top:20px;font-size:13px;color:var(--dim);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 14px}
.dot{width:8px;height:8px;border-radius:50%;background:#3a4356}.dot.on{background:var(--acc);box-shadow:0 0 0 4px #00e58a22}
.cta{display:flex;gap:12px;flex-wrap:wrap;margin:28px 0 0}
.btn{background:var(--acc);color:#04120b;font-weight:700;padding:13px 22px;border-radius:11px;font-size:15px}
.btn.alt{background:transparent;color:var(--fg);border:1px solid var(--line)}
section{margin:52px 0}
h2{font-size:26px;letter-spacing:-.5px;margin:0 0 6px}
.muted{color:var(--dim);margin:0 0 22px;max-width:640px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px}
.card h3{margin:0 0 8px;font-size:16px}.card p{margin:0;color:var(--dim);font-size:14px}
.card .ic{font-size:22px;margin-bottom:10px}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.plan{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;display:flex;flex-direction:column}
.plan.feat{border-color:var(--acc);box-shadow:0 0 0 1px var(--acc)}
.plan .name{font-weight:700;font-size:15px}.plan .badge{float:right;font:700 10px/1 var(--mono);letter-spacing:.1em;color:var(--acc);background:#00e58a15;padding:4px 8px;border-radius:6px}
.plan .price{font-size:36px;font-weight:800;letter-spacing:-1px;margin:12px 0 2px}.plan .price span{font-size:15px;color:var(--dim);font-weight:600}
.plan .gb{color:var(--dim);font-size:14px;margin-bottom:16px}
.plan ul{list-style:none;padding:0;margin:0 0 20px;font-size:14px;color:var(--dim)}
.plan li{padding:5px 0 5px 22px;position:relative}.plan li:before{content:"✓";color:var(--acc);position:absolute;left:0}
.plan .buy{margin-top:auto}
.use{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.use div{background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:14px;font-size:14px}
.use b{color:var(--fg)}
.pay{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px}
.addr{font:13px/1.5 var(--mono);background:var(--card2);border:1px solid var(--line);border-radius:9px;padding:12px;word-break:break-all;margin:6px 0 16px;color:#cfe3ff}
.chip{display:inline-block;font:700 11px/1 var(--mono);color:var(--acc);border:1px solid var(--line);border-radius:6px;padding:5px 9px;margin-right:6px}
.faq details{border-bottom:1px solid var(--line);padding:14px 0}.faq summary{cursor:pointer;font-weight:600}.faq p{color:var(--dim);margin:10px 0 0}
footer{border-top:1px solid var(--line);margin-top:60px;padding:28px 0 60px;color:var(--faint);font-size:13px}
.soon{color:var(--warn);font-size:12px;font-weight:700}
</style></head><body>
<div class="wrap">
<header>
  <p class="eyebrow">Real physical SIM · Orange AS16028 · Instant, no signup</p>
  <h1>Dedicated <b>4G mobile proxy</b> on a real French &amp; Guadeloupe carrier IP.</h1>
  <p class="sub">A trusted, geo-accurate French mobile exit — for agencies, ad verification, SERP tracking and data teams that need an IP sites actually trust. A rare France/DOM geo almost no provider offers.</p>
  <div class="live" id="live"><span class="dot" id="dot"></span><span id="livetxt">checking live exit…</span></div>
  <div class="cta">
    <a class="btn" href="#pricing">Get a dedicated port</a>
    <a class="btn alt" href="#pricing">Try 7 days — $19</a>
  </div>
</header>

<section>
  <h2>Why it beats a datacenter or a reseller pool</h2>
  <p class="muted">Sites treat a mobile-carrier IP like a real person on their phone — a fundamentally different level of trust than a datacenter range gets.</p>
  <div class="grid">
    <div class="card"><div class="ic">🛡️</div><h3>Highest-trust IP class</h3><p>Sites treat a mobile-carrier IP like a real French subscriber — the reliability agencies and scrapers need to reach pages that block datacenter and cloud ranges.</p></div>
    <div class="card"><div class="ic">🇫🇷</div><h3>Rare France / DOM geo</h3><p>A genuine Orange (AS16028) mobile IP in France / Guadeloupe. Everyone else ships US/EU-major carriers — this geo is almost impossible to find.</p></div>
    <div class="card"><div class="ic">📱</div><h3>A physical SIM we run</h3><p>Not a resold pool. Your own dedicated, sticky port — one client per line, the stable consistent exit agencies and automation rely on.</p></div>
    <div class="card"><div class="ic">🛰️</div><h3>Live-verified exit</h3><p>Carrier / ASN / uptime probed every 10 minutes and returned with your key. If no mobile exit is up, you get a 503 — never a charge.</p></div>
  </div>
</section>

<section>
  <h2>Who rents these</h2>
  <div class="use">
    <div><b>Social media agencies</b><br>manage client accounts on a clean, consistent French IP</div>
    <div><b>Ad verification</b><br>check French-targeted campaigns from a real FR mobile</div>
    <div><b>Scraping &amp; SERP</b><br>Cdiscount · Fnac · LeBonCoin · Google.fr rankings</div>
    <div><b>Market research</b><br>monitor the French market &amp; competitors as a local</div>
  </div>
</section>

<section id="pricing">
  <h2>Pricing</h2>
  <p class="muted">Market rate for a dedicated mobile port is $50–$300/mo. Priced at the accessible end for a scarce geo.</p>
  <div class="plans">
    <div class="plan"><span class="name">7-day test port</span><div class="price">$19</div><div class="gb">up to 25 GB · 7 days</div><ul><li>Qualify the exit first</li><li>Full mobile IP, no limits on use</li><li>Crypto payment, instant</li></ul><a class="btn alt buy" href="#order">Start the test</a></div>
    <div class="plan feat"><span class="name">Dedicated port <span class="badge">Most popular</span></span><div class="price">$75<span>/mo</span></div><div class="gb">up to 100 GB · 30 days</div><ul><li>Your own sticky mobile IP</li><li>France / Guadeloupe (Orange)</li><li>Self-rotating egress</li><li>No KYC · same-day delivery</li></ul><a class="btn buy" href="#order">Rent this port</a></div>
    <div class="plan"><span class="name">Metered</span><div class="price">$5<span>/GB</span></div><div class="gb">pay as you go · key valid 30 days</div><ul><li>1 GB $5 · 5 GB $22</li><li>Residential from $3/GB too</li><li>For bursty / low-volume needs</li></ul><a class="btn alt buy" href="#order">Buy GB</a></div>
  </div>
</section>

<section id="order">
  <h2>Order</h2>
  <p class="muted">Pay in crypto, get your port credentials the same day. No account, no KYC.</p>
  <div class="pay">
    <p><span class="chip">USDC · BASE</span> send the plan amount to:</p>
    <div class="addr">${BASE_PAYTO}</div>
    <p><span class="chip">USDC · SOLANA</span> or on Solana:</p>
    <div class="addr">${SOL_PAYTO}</div>
    <p style="color:var(--dim);font-size:14px">Then message us with the transaction and the plan you paid — we send your <b>http://user:key@host:port</b> credentials the same day.</p>
    <div class="cta">
      <a class="btn" href="${contact.href}">${contact.label}</a>
      <span class="soon">💳 Card &amp; 300+ cryptos — coming soon</span>
    </div>
    <p style="color:var(--faint);font-size:13px;margin-top:18px">Autonomous agents: pay pay-per-request via x402 — <span style="font-family:var(--mono)">GET /v1/proxy/port/30d</span> (USDC on Base or Solana) and get the key instantly. Live status &amp; specs: <a href="/proxy">/proxy</a>.</p>
  </div>
</section>

<section class="faq">
  <h2>FAQ</h2>
  <details><summary>What exactly do I get?</summary><p>A dedicated HTTP/HTTPS forward proxy on a real French/Guadeloupe 4G mobile IP: <span style="font-family:var(--mono)">http://user:key@host:port</span>. Point your browser, antidetect (AdsPower, GoLogin…), scraper or app at it.</p></details>
  <details><summary>Why France / Guadeloupe specifically?</summary><p>It's a real Orange (AS16028) carrier IP — the same pool ordinary French smartphones get, so it's trusted and hard to ban. The Guadeloupe/DOM geo is rare; if you need metropolitan France, ask us.</p></details>
  <details><summary>How fast is delivery?</summary><p>Same day. Crypto payments settle in seconds; we issue your credentials as soon as we confirm the transaction.</p></details>
  <details><summary>Refunds?</summary><p>If no mobile exit is verified live when you buy via the API, you're not charged (503). For manual orders, if we can't deliver a working port we refund in full.</p></details>
  <details><summary>Do I need to sign up?</summary><p>No signup required — pay and go. We run the SIM ourselves, so you get a dedicated line, not a slice of a resold pool.</p></details>
</section>

<footer>
  <div class="wrap" style="padding:0">Real physical SIM · Orange AS16028 · France / Guadeloupe · USDC on Base &amp; Solana · <a href="/proxy">live specs</a> · <a href="/free/proxy/status">exit status</a></div>
</footer>
</div>
<script>
fetch("/free/proxy/status").then(r=>r.json()).then(s=>{
  const ex = s.exits && (s.exits.mobile1 || Object.values(s.exits).find(e=>e&&e.mobile));
  const up = s.exit_uptime_hours ? Math.round(s.exit_uptime_hours)+"h uptime" : "";
  const el=document.getElementById("livetxt"), dot=document.getElementById("dot");
  if(ex&&ex.ok){ dot.classList.add("on"); el.textContent = "Mobile exit online — "+(ex.carrier||"Orange")+" · "+(ex.country||"GP")+(up?" · "+up:""); }
  else { el.textContent = "Provisioning a mobile exit — check back shortly"; }
}).catch(()=>{document.getElementById("livetxt").textContent="Live status unavailable";});
</script>
</body></html>`;

router.get("/rent", (_req, res) => {
  const c = (process.env.ORDER_CONTACT || "").trim();
  const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c); // a real email, not a @telegram handle
  const contact = c
    ? (isEmail ? { href: "mailto:" + c, label: "Order — email us" }
       : { href: c.startsWith("http") ? c : "https://t.me/" + c.replace(/^@/, ""), label: "Order — message us on Telegram" })
    : { href: "/proxy", label: "See live specs to order" };
  res.type("html").send(page(contact));
});

export default router;
