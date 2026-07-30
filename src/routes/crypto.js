import { Router } from "express";
import { cached } from "../lib/cache.js";

// PACK CRYPTO / DeFi GLOBAL — ce que les agents crypto/trading pollent en boucle.
// Sources publiques gratuites (aucune clé) : DexScreener, GoPlus, DefiLlama, RPC.
// Global par nature (multi-chain), anglais, prix agressifs.
const router = Router();

const UA = { "user-agent": "x402-farm/1.0", accept: "application/json" };
async function getJson(url, timeout = 10_000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw Object.assign(new Error(`upstream_${r.status}`), { status: 502 });
  return r.json();
}
const q = (req, n) => (req.query[n] ?? req.body?.[n] ?? "").toString().trim();

// slug DexScreener/DefiLlama · id GoPlus · RPC
const CHAINS = {
  ethereum: { ds: "ethereum", gp: "1", llama: "Ethereum", gt: "eth", rpc: "https://ethereum-rpc.publicnode.com" },
  base: { ds: "base", gp: "8453", llama: "Base", gt: "base", rpc: "https://base-rpc.publicnode.com" },
  arbitrum: { ds: "arbitrum", gp: "42161", llama: "Arbitrum", gt: "arbitrum", rpc: "https://arbitrum-one-rpc.publicnode.com" },
  optimism: { ds: "optimism", gp: "10", llama: "Optimism", gt: "optimism", rpc: "https://optimism-rpc.publicnode.com" },
  polygon: { ds: "polygon", gp: "137", llama: "Polygon", gt: "polygon_pos", rpc: "https://polygon-bor-rpc.publicnode.com" },
  bsc: { ds: "bsc", gp: "56", llama: "BSC", gt: "bsc", rpc: "https://bsc-rpc.publicnode.com" },
  avalanche: { ds: "avalanche", gp: "43114", llama: "Avalanche", gt: "avax", rpc: "https://avalanche-c-chain-rpc.publicnode.com" },
  solana: { ds: "solana", gp: null, llama: "Solana", gt: "solana", rpc: null },
};
const chainAliases = { eth: "ethereum", matic: "polygon", avax: "avalanche", bnb: "bsc", op: "optimism", arb: "arbitrum" };
const resolveChain = (c) => { c = (c || "").toLowerCase(); return chainAliases[c] || c; };

// ===== 1) TOKEN MARKET DATA (multi-chain) — DexScreener =====
router.all("/v1/crypto/token", async (req, res) => {
  const address = q(req, "address") || q(req, "token");
  const chain = resolveChain(q(req, "chain"));
  if (!address) return res.status(400).json({ error: "missing_address", hint: "?address=0x…&chain=base" });
  try {
    const data = await cached(`ctok:${address}:${chain}`, 60_000, async () => {
      const j = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
      let pairs = j.pairs || [];
      if (chain && CHAINS[chain]) pairs = pairs.filter((p) => p.chainId === CHAINS[chain].ds);
      pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      const top = pairs[0];
      if (!top) return { found: false, address, chain: chain || null };
      return {
        found: true, address, chain: top.chainId, symbol: top.baseToken?.symbol, name: top.baseToken?.name,
        priceUsd: top.priceUsd ? Number(top.priceUsd) : null, priceChange: top.priceChange || {},
        liquidityUsd: top.liquidity?.usd ?? null, volume24hUsd: top.volume?.h24 ?? null,
        fdvUsd: top.fdv ?? null, marketCapUsd: top.marketCap ?? null,
        dex: top.dexId, pairAddress: top.pairAddress, pairsFound: pairs.length,
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: "source_error", detail: String(e.message) }); }
});

// ===== 2) TOKEN SECURITY / HONEYPOT / RUG CHECK — GoPlus (le tueur) =====
router.all("/v1/crypto/security", async (req, res) => {
  const address = (q(req, "address") || q(req, "token")).toLowerCase();
  const chain = resolveChain(q(req, "chain") || "ethereum");
  if (!address) return res.status(400).json({ error: "missing_address", hint: "?address=0x…&chain=base" });
  const gp = CHAINS[chain]?.gp;
  if (!gp) return res.status(400).json({ error: "unsupported_chain", supported: Object.keys(CHAINS) });
  try {
    const data = await cached(`csec:${address}:${chain}`, 300_000, async () => {
      const j = await getJson(`https://api.gopluslabs.io/api/v1/token_security/${gp}?contract_addresses=${address}`);
      const r = (j.result || {})[address] || Object.values(j.result || {})[0];
      if (!r) return { found: false, address, chain };
      const yes = (v) => v === "1" || v === 1;
      const flags = [];
      if (yes(r.is_honeypot)) flags.push({ f: "honeypot", sev: "critical" });
      if (yes(r.cannot_sell_all)) flags.push({ f: "cannot_sell_all", sev: "critical" });
      if (yes(r.is_blacklisted)) flags.push({ f: "blacklist_function", sev: "high" });
      if (yes(r.can_take_back_ownership)) flags.push({ f: "can_take_back_ownership", sev: "high" });
      if (yes(r.hidden_owner)) flags.push({ f: "hidden_owner", sev: "high" });
      if (yes(r.is_mintable)) flags.push({ f: "mintable", sev: "medium" });
      if (yes(r.transfer_pausable)) flags.push({ f: "transfer_pausable", sev: "medium" });
      if (yes(r.owner_change_balance)) flags.push({ f: "owner_can_change_balance", sev: "critical" });
      if (r.is_open_source === "0") flags.push({ f: "not_open_source", sev: "medium" });
      const buyTax = Number(r.buy_tax || 0), sellTax = Number(r.sell_tax || 0);
      if (sellTax >= 0.10) flags.push({ f: `high_sell_tax_${Math.round(sellTax * 100)}%`, sev: sellTax >= 0.5 ? "critical" : "high" });
      const crit = flags.some((x) => x.sev === "critical");
      const high = flags.some((x) => x.sev === "high");
      const verdict = crit ? "AVOID" : high ? "HIGH_RISK" : flags.length ? "CAUTION" : "OK";
      return {
        found: true, address, chain, verdict,
        isHoneypot: yes(r.is_honeypot), buyTaxPct: buyTax * 100, sellTaxPct: sellTax * 100,
        isOpenSource: r.is_open_source === "1", holderCount: r.holder_count ? Number(r.holder_count) : null,
        flags, tokenName: r.token_name, tokenSymbol: r.token_symbol,
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: "source_error", detail: String(e.message) }); }
});

// ===== 3) DeFi YIELDS / BEST APY — DefiLlama =====
router.all("/v1/defi/yields", async (req, res) => {
  const token = q(req, "token").toUpperCase();
  const chain = resolveChain(q(req, "chain"));
  const minTvl = Number(q(req, "min_tvl") || 100000);
  try {
    const data = await cached(`yields:${token}:${chain}:${minTvl}`, 600_000, async () => {
      const j = await getJson("https://yields.llama.fi/pools", 15_000);
      let pools = j.data || [];
      if (chain && CHAINS[chain]) pools = pools.filter((p) => p.chain === CHAINS[chain].llama);
      if (token) pools = pools.filter((p) => (p.symbol || "").toUpperCase().includes(token));
      pools = pools.filter((p) => (p.tvlUsd || 0) >= minTvl).sort((a, b) => (b.apy || 0) - (a.apy || 0)).slice(0, 15);
      return {
        query: { token: token || null, chain: chain || "all", minTvl },
        count: pools.length,
        pools: pools.map((p) => ({ project: p.project, symbol: p.symbol, chain: p.chain, apy: p.apy, apyBase: p.apyBase, apyReward: p.apyReward, tvlUsd: p.tvlUsd, stablecoin: p.stablecoin, ilRisk: p.ilRisk })),
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: "source_error", detail: String(e.message) }); }
});

// ===== 4) PROTOCOL TVL & INFO — DefiLlama =====
router.all("/v1/defi/protocol", async (req, res) => {
  const slug = q(req, "protocol") || q(req, "slug");
  if (!slug) return res.status(400).json({ error: "missing_protocol", hint: "?protocol=aave" });
  try {
    const data = await cached(`proto:${slug.toLowerCase()}`, 600_000, async () => {
      const j = await getJson(`https://api.llama.fi/protocol/${encodeURIComponent(slug.toLowerCase())}`, 15_000);
      const tvlByChain = j.currentChainTvls || {};
      const totalTvl = Object.entries(tvlByChain).filter(([k]) => !/-/.test(k)).reduce((a, [, v]) => a + (Number(v) || 0), 0);
      const chains = (j.chains && j.chains.length ? j.chains : Object.keys(tvlByChain).filter((k) => !/-/.test(k)));
      return {
        name: j.name, symbol: j.symbol, category: j.category || j.category_name || null, url: j.url, chains,
        totalTvlUsd: totalTvl, tvlByChain, mcap: j.mcap ?? null, twitter: j.twitter,
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: "not_found_or_source_error", detail: String(e.message) }); }
});

// ===== 5) GAS TRACKER (multi-chain) — RPC =====
router.all("/v1/crypto/gas", async (req, res) => {
  const only = resolveChain(q(req, "chain"));
  const targets = only && CHAINS[only] ? [only] : Object.keys(CHAINS);
  try {
    const data = await cached(`gas:${targets.join(",")}`, 15_000, async () => {
      const out = {};
      await Promise.all(targets.map(async (c) => {
        try {
          const r = await fetch(CHAINS[c].rpc, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }),
            signal: AbortSignal.timeout(6000),
          });
          const j = await r.json();
          out[c] = { gwei: Math.round((Number(BigInt(j.result)) / 1e9) * 1000) / 1000 };
        } catch { out[c] = { error: "rpc_timeout" }; }
      }));
      return { gas: out, at: new Date().toISOString() };
    });
    res.json(data);
  } catch (e) { res.status(502).json({ error: "source_error", detail: String(e.message) }); }
});

// helper GeckoTerminal : mappe un "pool" en objet propre
const mapPool = (p) => {
  const a = p.attributes || {};
  return {
    name: a.name, address: a.address, priceUsd: a.base_token_price_usd ? Number(a.base_token_price_usd) : null,
    volume24hUsd: a.volume_usd?.h24 ? Number(a.volume_usd.h24) : null,
    priceChange24h: a.price_change_percentage?.h24 ? Number(a.price_change_percentage.h24) : null,
    liquidityUsd: a.reserve_in_usd ? Number(a.reserve_in_usd) : null, createdAt: a.pool_created_at,
  };
};

// ===== 6) TRENDING TOKENS/POOLS (par chaîne) — GeckoTerminal =====
router.all("/v1/crypto/trending", async (req, res) => {
  const chain = resolveChain(q(req, "chain") || "base");
  const gt = CHAINS[chain]?.gt;
  if (!gt) return res.status(400).json({ error: "unsupported_chain", supported: Object.keys(CHAINS) });
  try {
    const data = await cached(`trend:${gt}`, 120_000, async () => {
      const j = await getJson(`https://api.geckoterminal.com/api/v2/networks/${gt}/trending_pools?page=1`);
      return { chain, count: (j.data || []).length, pools: (j.data || []).slice(0, 15).map(mapPool) };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: "source_error", detail: String(e.message) }); }
});

// ===== 7) NEW POOLS / FRESH LAUNCHES (par chaîne) — GeckoTerminal =====
router.all("/v1/crypto/new-pools", async (req, res) => {
  const chain = resolveChain(q(req, "chain") || "base");
  const gt = CHAINS[chain]?.gt;
  if (!gt) return res.status(400).json({ error: "unsupported_chain", supported: Object.keys(CHAINS) });
  try {
    const data = await cached(`newp:${gt}`, 60_000, async () => {
      const j = await getJson(`https://api.geckoterminal.com/api/v2/networks/${gt}/new_pools?page=1`);
      return { chain, count: (j.data || []).length, pools: (j.data || []).slice(0, 20).map(mapPool) };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: "source_error", detail: String(e.message) }); }
});

// ===== 8) MARKET SENTIMENT (Fear&Greed + mcap global + dominance BTC) =====
router.all("/v1/crypto/sentiment", async (_req, res) => {
  try {
    const data = await cached("sentiment", 300_000, async () => {
      const [fng, glob] = await Promise.all([
        getJson("https://api.alternative.me/fng/?limit=1").catch(() => null),
        getJson("https://api.coingecko.com/api/v3/global").catch(() => null),
      ]);
      const f = fng?.data?.[0] || {};
      const g = glob?.data || {};
      return {
        fearGreedIndex: f.value ? Number(f.value) : null,
        fearGreedLabel: f.value_classification || null,
        totalMarketCapUsd: g.total_market_cap?.usd ? Math.round(g.total_market_cap.usd) : null,
        total24hVolumeUsd: g.total_volume?.usd ? Math.round(g.total_volume.usd) : null,
        btcDominancePct: g.market_cap_percentage?.btc ? Math.round(g.market_cap_percentage.btc * 10) / 10 : null,
        ethDominancePct: g.market_cap_percentage?.eth ? Math.round(g.market_cap_percentage.eth * 10) / 10 : null,
        marketCapChange24hPct: g.market_cap_change_percentage_24h_usd ? Math.round(g.market_cap_change_percentage_24h_usd * 100) / 100 : null,
        at: new Date().toISOString(),
      };
    });
    res.json(data);
  } catch (e) { res.status(502).json({ error: "source_error", detail: String(e.message) }); }
});

export default router;
