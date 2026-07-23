// /start — page d'accueil HUMAINE (la racine / reste du JSON pour les machines/agents).
// Une seule URL partageable pour l'amorçage : hero + 3 canaux + exemples live + CTA.
import { Router } from "express";
const router = Router();

const PAGE = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402-farm — Residential-IP scraping & French data for AI agents and developers</title>
<meta name="description" content="Residential-IP web scraping (Google Maps, Amazon, Pages Jaunes) + deep French business & open data. Pay per call (crypto) for AI agents, or pay per result (fiat) on Apify. Reaches sites that block datacenters.">
<style>
:root{--bg:#0a0e17;--card:#121826;--line:#1e2636;--fg:#e8edf6;--dim:#98a4b8;--acc:#00e58a;--acc2:#5b8cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--acc2);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
header{padding:70px 0 40px;text-align:center}
.logo{font-weight:800;letter-spacing:-.5px;font-size:15px;color:var(--dim)}
h1{font-size:clamp(30px,5vw,46px);line-height:1.1;margin:18px 0 14px;letter-spacing:-1px}
h1 b{color:var(--acc)}
.sub{font-size:19px;color:var(--dim);max-width:680px;margin:0 auto}
.cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:30px 0 0}
.btn{background:var(--acc);color:#04120b;font-weight:700;padding:12px 20px;border-radius:10px}
.btn.alt{background:transparent;color:var(--fg);border:1px solid var(--line)}
section{margin:46px 0}
h2{font-size:24px;letter-spacing:-.4px;margin:0 0 6px}
.muted{color:var(--dim);margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.card h3{margin:0 0 6px;font-size:17px}.card p{margin:0;color:var(--dim);font-size:14px}
.tag{display:inline-block;font-size:11px;font-weight:700;color:var(--acc);background:#00e58a12;padding:2px 8px;border-radius:6px;margin-bottom:10px}
pre{background:#080b12;border:1px solid var(--line);border-radius:12px;padding:16px;overflow-x:auto;font-size:13px;color:#cfe3ff}
pre .c{color:#5a6b85}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}
.chan{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.chan h3{margin:0 0 4px}.chan .who{font-size:12px;color:var(--acc);font-weight:700;text-transform:uppercase;letter-spacing:.5px}
footer{border-top:1px solid var(--line);margin-top:60px;padding:30px 0 60px;color:var(--dim);font-size:13px;text-align:center}
.li{color:var(--dim);font-size:14px;margin:4px 0}.li b{color:var(--fg)}
</style></head><body>
<div class="wrap">
<header>
  <div class="logo">x402-farm</div>
  <h1>Scrape the sites that <b>block the cloud</b>.<br>Plus deep French data.</h1>
  <p class="sub">A real browser on a <b>French residential IP</b> reaches Google Maps, Amazon, Pages Jaunes and more — where datacenter scrapers get blocked. Company data, KYB, real estate, UK/US filings on top. Buy it the way that fits you.</p>
  <div class="cta">
    <a class="btn" href="https://apify.com/x402farm">Browse the Apify actors →</a>
    <a class="btn alt" href="/llms.txt">Machine docs (agents)</a>
  </div>
</header>

<section>
  <h2>What you get</h2>
  <p class="muted">Seven scrapers and 60+ data endpoints, one backend.</p>
  <div class="grid">
    <div class="card"><span class="tag">RESIDENTIAL</span><h3>Google Maps leads</h3><p>Local businesses by keyword + city: name, rating, reviews, phone, website. The feed cloud scrapers never load.</p></div>
    <div class="card"><span class="tag">RESIDENTIAL</span><h3>Amazon products</h3><p>Product & search: title, price, rating, reviews, brand, image. Stealth browser past the bot wall.</p></div>
    <div class="card"><span class="tag">RESIDENTIAL</span><h3>Pages Jaunes B2B leads</h3><p>French business directory with verified phone numbers pulled from JSON-LD. A ready call list.</p></div>
    <div class="card"><span class="tag">RESIDENTIAL</span><h3>Structured extract</h3><p>URL + the fields you want → clean JSON. Firecrawl-extract territory, on a residential IP.</p></div>
    <div class="card"><span class="tag">🇫🇷 DATA</span><h3>French company & KYB</h3><p>SIREN/SIRET, officers, VAT/VIES, INPI financials, insolvency (BODACC), compliance verdict.</p></div>
    <div class="card"><span class="tag">🇫🇷 DATA</span><h3>Real estate</h3><p>Live listings (asking €/m²) + DVF sold prices to compare asking vs actually-sold by area.</p></div>
  </div>
</section>

<section>
  <h2>Three ways to buy</h2>
  <p class="muted">Same engine — pick your rail.</p>
  <div class="row">
    <div class="chan">
      <div class="who">AI agents</div><h3>x402 · pay per call</h3>
      <p class="li">USDC on Base, no account, no key. The agent gets a 402, pays, retries. From <b>$0.002</b>/call. On the CDP <b>Bazaar</b> + official <b>MCP registry</b>.</p>
    </div>
    <div class="chan">
      <div class="who">Developers</div><h3>Apify · pay per result</h3>
      <p class="li">No subscription. Run an actor, pay per row delivered. Billing handled by Apify. <a href="https://apify.com/x402farm">x402farm on Apify →</a></p>
    </div>
    <div class="chan">
      <div class="who">Teams</div><h3>API subscription</h3>
      <p class="li">Monthly quotas + overage via an API marketplace. Same endpoints, fiat billing. <span style="color:var(--dim)">(coming online)</span></p>
    </div>
  </div>
</section>

<section>
  <h2>Try it in 10 seconds</h2>
  <p class="muted">Every client gets 1 free call/day on data routes ≤ $0.01 — no wallet needed.</p>
  <pre><span class="c"># Free taste — worldwide weather</span>
curl "https://api.x-402.online/v1/weather?city=Tokyo"

<span class="c"># French company lookup (SIREN, officers, status)</span>
curl "https://api.x-402.online/v1/fr/entreprise?q=Decathlon"

<span class="c"># Structured extract — URL + fields → JSON (paid, residential)</span>
curl "https://api.x-402.online/v1/extract-structured?url=https://books.toscrape.com&fields=title,price"</pre>
</section>

<footer>
  Built by <a href="https://github.com/Ghost11777/x402-farm">Laurent Halbrun</a> · revenue wallet verifiable on
  <a href="https://basescan.org/address/0x2c871C2b8876dc35e9E19646FDa5ABF1cd27735F">BaseScan</a> ·
  <a href="/openapi.json">OpenAPI</a> · <a href="/.well-known/x402">x402 manifest</a>
</footer>
</div>
</body></html>`;

router.get("/start", (_req, res) => res.type("html").set("cache-control", "public, max-age=300").send(PAGE));
// Alias humains fréquents
router.get(["/hub", "/home"], (_req, res) => res.redirect(302, "/start"));

export default router;
