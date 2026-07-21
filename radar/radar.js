// RADAR : photographie le Bazaar x402 (catalogue public CDP), archive un snapshot,
// et compare avec le précédent pour détecter les nouveaux services et les niches.
// Usage : node radar/radar.js
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "snapshots");
mkdirSync(DIR, { recursive: true });

const BASE = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";

async function fetchAll() {
  const items = [];
  let offset = 0;
  for (;;) {
    const r = await fetch(`${BASE}?limit=100&offset=${offset}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`discovery ${r.status}`);
    const j = await r.json();
    items.push(...(j.items || []));
    if (!j.items?.length || items.length >= (j.total ?? Infinity) || offset > 5000) break;
    offset += 100;
  }
  return items;
}

function categorize(desc = "") {
  const d = desc.toLowerCase();
  const rules = [
    ["scraping/extraction", /scrap|extract|crawl|markdown|screenshot|render|browser/],
    ["recherche/données", /search|data|lookup|enrich|record|dataset|feed|news/],
    ["ia/inférence", /llm|inference|model|gpt|claude|embedding|image gen|generat/],
    ["crypto/finance", /token|price|trading|defi|wallet|onchain|swap|market/],
    ["média", /image|video|audio|voice|tts|transcri/],
    ["email/comms", /email|sms|message|notification/],
    ["vérification", /verify|validation|kyc|proof|check/],
  ];
  for (const [cat, re] of rules) if (re.test(d)) return cat;
  return "autre";
}

const items = await fetchAll();
const today = new Date().toISOString().slice(0, 10);

const snapshot = items.map((it) => ({
  url: it.resource?.url || it.resource || "?",
  desc: (it.description || it.resource?.description || "").slice(0, 200),
  amounts: (it.accepts || []).map((a) => Number(a.amount) / 1e6),
  network: it.accepts?.[0]?.network,
  payTo: it.accepts?.[0]?.payTo,
  lastUpdated: it.lastUpdated,
}));
writeFileSync(join(DIR, `${today}.json`), JSON.stringify(snapshot, null, 1));

// Diff avec le snapshot précédent
const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const prevFile = files.filter((f) => f < `${today}.json`).pop();
const prev = prevFile ? JSON.parse(readFileSync(join(DIR, prevFile), "utf8")) : [];
const prevUrls = new Set(prev.map((s) => s.url));
const nouveaux = snapshot.filter((s) => !prevUrls.has(s.url));

// Rapport
const byCat = {};
for (const s of snapshot) {
  const cat = categorize(s.desc);
  (byCat[cat] ??= { n: 0, prices: [] }).n++;
  byCat[cat].prices.push(...s.amounts.filter((p) => p > 0 && p < 100));
}
const median = (a) => (a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

console.log(`RADAR BAZAAR x402 — ${today}`);
console.log(`${snapshot.length} services listés${prevFile ? ` (${nouveaux.length} nouveaux depuis ${prevFile.replace(".json", "")})` : " (premier snapshot)"}\n`);
console.log("Par catégorie (nb / prix médian $):");
for (const [cat, v] of Object.entries(byCat).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${cat.padEnd(22)} ${String(v.n).padStart(4)}   ~$${median(v.prices).toFixed(3)}`);
}
if (nouveaux.length) {
  console.log("\nNouveaux entrants:");
  nouveaux.slice(0, 15).forEach((s) => console.log(`  + ${s.url}\n    ${s.desc.slice(0, 100)}`));
}
