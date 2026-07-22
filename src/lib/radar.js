// Radar marché x402 : mesure la demande RÉELLE de l'écosystème, on-chain.
// Source des services : catalogue Bazaar (facilitateur Coinbase). Mesure : transferts
// USDC Base vers leurs payTo (txs, PAYEURS UNIQUES — la métrique anti-wash — volume).
// Stratégie darwinienne : on développe ce que le radar montre qui se vend.

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RPC = "https://mainnet.base.org";
const BAZAAR = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?limit=100";

const CATEGORIES = [
  ["llm", /llm|inference|gpt|claude|model|chat|completion/i],
  ["search", /search|serp|exa|lookup/i],
  ["scrape", /scrap|extract|crawl|browser|screenshot|render/i],
  ["email", /email|mail|inbox/i],
  ["commerce", /gift|refill|card|shop|buy|commerce/i],
  ["data", /data|company|entreprise|financ|registr|kyb|enrich/i],
  ["media", /image|video|audio|voice|tts|photo/i],
  ["social", /twitter|tweet|social|post|farcaster/i],
  ["crypto", /token|swap|defi|wallet|price|trading/i],
];
const categorize = (s) => (CATEGORIES.find(([, re]) => re.test(s)) || ["autre"])[0];

async function rpc(method, params, timeout = 30000) {
  const r = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeout),
  });
  return (await r.json());
}

// getLogs avec découpe adaptative (les gros services font déborder les chunks fixes)
async function getLogsAdaptive(from, to, topics2) {
  const res = await rpc("eth_getLogs", [{
    address: USDC, fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16),
    topics: [TRANSFER, null, topics2],
  }]);
  if (res.error) {
    if (to - from < 100) return [];
    const mid = (from + to) >> 1;
    return [...(await getLogsAdaptive(from, mid, topics2)), ...(await getLogsAdaptive(mid + 1, to, topics2))];
  }
  return res.result;
}

// Sweep complet : catalogue -> logs 24 h -> agrégat par service
export async function sweep({ windowHours = 24 } = {}) {
  const items = (await (await fetch(BAZAAR, { signal: AbortSignal.timeout(15000) })).json()).items || [];
  // payTo EVM uniquement (le Bazaar liste aussi des services Solana en base58)
  const meta = {}; // payto -> {service, description}
  for (const i of items) {
    for (const a of i.accepts || []) {
      const to = (a.payTo || "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(to) || meta[to]) continue;
      let service; try { service = new URL(i.resource).hostname; } catch { service = null; }
      meta[to] = { service: service || (i.description || "").slice(0, 40), description: (i.description || "").slice(0, 200) };
    }
  }
  const paytos = Object.keys(meta);
  const ours = (process.env.PAY_TO || "").toLowerCase();
  if (ours && !meta[ours]) { meta[ours] = { service: "api.x-402.online (nous)", description: "x402-farm" }; paytos.push(ours); }

  const bn = parseInt((await rpc("eth_blockNumber", [])).result, 16);
  const topics2 = paytos.map((a) => "0x" + a.slice(2).padStart(64, "0"));
  const range = Math.round(windowHours * 1800); // ~1800 blocs Base/heure
  const logs = [];
  for (let from = bn - range; from < bn; from += 2000) {
    logs.push(...(await getLogsAdaptive(from, Math.min(from + 1999, bn), topics2)));
  }

  const agg = {};
  for (const l of logs) {
    const to = "0x" + l.topics[2].slice(26), payer = "0x" + l.topics[1].slice(26);
    const a = (agg[to] ||= { txs: 0, payers: new Set(), vol: 0 });
    a.txs++; a.payers.add(payer); a.vol += Number(BigInt(l.data)) / 1e6;
  }
  const services = Object.entries(agg)
    .map(([to, a]) => ({
      payto: to,
      service: meta[to]?.service || to.slice(0, 12),
      description: meta[to]?.description || "",
      category: to === ours ? "nous" : categorize(meta[to]?.service + " " + meta[to]?.description),
      txs: a.txs, payers: a.payers.size, volume_usd: Math.round(a.vol * 100) / 100,
      is_ours: to === ours,
    }))
    .sort((x, y) => y.payers - x.payers || y.volume_usd - x.volume_usd);

  return {
    windowHours, servicesTotal: paytos.length, servicesActifs: services.length,
    txs: logs.length,
    payers: new Set(logs.map((l) => l.topics[1])).size,
    volume: Math.round(services.reduce((s, x) => s + x.volume_usd, 0) * 100) / 100,
    services,
  };
}

// Persiste un sweep dans Supabase (snapshot + top 40 services)
export async function storeSweep(result) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const H = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  const snap = await (await fetch(`${url}/rest/v1/radar_snapshots`, {
    method: "POST", headers: { ...H, prefer: "return=representation" },
    body: JSON.stringify({
      window_hours: result.windowHours, services_total: result.servicesTotal,
      services_actifs: result.servicesActifs, txs: result.txs,
      payers: result.payers, volume_usd: result.volume,
    }),
    signal: AbortSignal.timeout(8000),
  })).json();
  const id = snap?.[0]?.id;
  if (!id) return null;
  await fetch(`${url}/rest/v1/radar_services`, {
    method: "POST", headers: { ...H, prefer: "return=minimal" },
    body: JSON.stringify(result.services.slice(0, 40).map((s) => ({ snapshot_id: id, ...s }))),
    signal: AbortSignal.timeout(8000),
  });
  return id;
}
