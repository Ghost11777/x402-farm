import { Router } from "express";
import { cached } from "../lib/cache.js";

// Module US — SEC EDGAR (sociétés cotées américaines). Entièrement OUVERT (pas de
// clé) mais exige un User-Agent + parsing XBRL complexe : la valeur = la structuration.
const router = Router();
const UA = { "user-agent": "x402-farm laurenthalbrun@gmail.com", accept: "application/json" };
const q = (req, n) => (req.query[n] || "").toString().trim();
const getJson = (url, t = 12_000) =>
  fetch(url, { headers: UA, signal: AbortSignal.timeout(t) }).then((r) => {
    if (r.status === 404) throw Object.assign(new Error("not_found"), { status: 404 });
    if (!r.ok) throw Object.assign(new Error(`sec_${r.status}`), { status: 502 });
    return r.json();
  });
const cik10 = (c) => String(c).replace(/\D/g, "").padStart(10, "0");

// Résolution ticker -> CIK (map SEC mise en cache 24h)
let tickerMap = null;
async function resolveCik(input) {
  if (/^\d+$/.test(input)) return cik10(input);
  if (!tickerMap) {
    const raw = await getJson("https://www.sec.gov/files/company_tickers.json");
    tickerMap = {};
    for (const v of Object.values(raw)) tickerMap[v.ticker.toUpperCase()] = v.cik_str;
  }
  const cik = tickerMap[input.toUpperCase()];
  return cik ? cik10(cik) : null;
}

// Dernier fait annuel (10-K, FY) d'un concept XBRL, dédupliqué par date de clôture
function latestAnnual(facts, concepts) {
  const gaap = facts?.facts?.["us-gaap"] || {};
  for (const c of concepts) {
    const units = gaap[c]?.units?.USD;
    if (!units) continue;
    const fy = units.filter((x) => x.form === "10-K" && x.fp === "FY" && x.val != null);
    if (!fy.length) continue;
    const byEnd = {};
    for (const x of fy) if (!byEnd[x.end] || x.fy > byEnd[x.end].fy) byEnd[x.end] = x;
    const rows = Object.values(byEnd).sort((a, b) => b.end.localeCompare(a.end));
    return rows.slice(0, 3).map((x) => ({ end: x.end, value: x.val, fy: x.fy }));
  }
  return [];
}

// ===== /us/company : profil société cotée =====
router.all("/v1/us/company", async (req, res) => {
  const input = q(req, "ticker") || q(req, "cik") || q(req, "q");
  if (!input) return res.status(400).json({ error: "missing_ticker_or_cik" });
  try {
    const data = await cached(`us-co:${input}`, 12 * 3600_000, async () => {
      const cik = await resolveCik(input);
      if (!cik) return { found: false, query: input };
      const s = await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
      const recent = s.filings?.recent || {};
      return {
        found: true, cik, name: s.name, tickers: s.tickers, exchanges: s.exchanges,
        sic: s.sicDescription, sic_code: s.sic, category: s.category,
        state_of_incorporation: s.stateOfIncorporation, fiscal_year_end: s.fiscalYearEnd,
        ein: s.ein, website: s.website || null,
        address: s.addresses?.business,
        latest_filing: recent.form?.[0] ? { form: recent.form[0], date: recent.filingDate[0], accession: recent.accessionNumber[0] } : null,
        source: "SEC EDGAR",
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "sec_error" }); }
});

// ===== /us/financials : principaux postes financiers annuels (XBRL) =====
router.all("/v1/us/financials", async (req, res) => {
  const input = q(req, "ticker") || q(req, "cik") || q(req, "q");
  if (!input) return res.status(400).json({ error: "missing_ticker_or_cik" });
  try {
    const data = await cached(`us-fin:${input}`, 24 * 3600_000, async () => {
      const cik = await resolveCik(input);
      if (!cik) return { found: false, query: input };
      const facts = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, 15_000);
      const pick = (concepts) => latestAnnual(facts, concepts);
      return {
        found: true, cik, name: facts.entityName,
        currency: "USD",
        revenue: pick(["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"]),
        net_income: pick(["NetIncomeLoss"]),
        total_assets: pick(["Assets"]),
        total_liabilities: pick(["Liabilities"]),
        stockholders_equity: pick(["StockholdersEquity"]),
        cash: pick(["CashAndCashEquivalentsAtCarryingValue"]),
        operating_income: pick(["OperatingIncomeLoss"]),
        note: "Latest annual (10-K, fiscal year) figures from SEC XBRL. Each array is most-recent-first (up to 3 years).",
        source: "SEC EDGAR XBRL",
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "sec_error" }); }
});

// ===== /us/filings : dépôts récents (10-K, 10-Q, 8-K...) =====
router.all("/v1/us/filings", async (req, res) => {
  const input = q(req, "ticker") || q(req, "cik") || q(req, "q");
  if (!input) return res.status(400).json({ error: "missing_ticker_or_cik" });
  const type = q(req, "type").toUpperCase();
  try {
    const data = await cached(`us-fil:${input}:${type}`, 6 * 3600_000, async () => {
      const cik = await resolveCik(input);
      if (!cik) return { found: false, query: input };
      const s = await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
      const r = s.filings?.recent || {};
      const out = [];
      for (let i = 0; i < (r.form || []).length && out.length < 20; i++) {
        if (type && r.form[i] !== type) continue;
        const acc = r.accessionNumber[i].replace(/-/g, "");
        out.push({ form: r.form[i], filed: r.filingDate[i], period: r.reportDate[i] || null,
          description: r.primaryDocDescription?.[i] || null,
          url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${r.primaryDocument[i]}` });
      }
      return { cik, name: s.name, count: out.length, filings: out };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "sec_error" }); }
});

// ===== /us/snapshot : synthèse financière + croissance (composite premium) =====
router.all("/v1/us/snapshot", async (req, res) => {
  const input = q(req, "ticker") || q(req, "cik") || q(req, "q");
  if (!input) return res.status(400).json({ error: "missing_ticker_or_cik" });
  try {
    const data = await cached(`us-snap:${input}`, 24 * 3600_000, async () => {
      const cik = await resolveCik(input);
      if (!cik) return { found: false, query: input };
      const [s, facts] = await Promise.all([
        getJson(`https://data.sec.gov/submissions/CIK${cik}.json`),
        getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, 15_000),
      ]);
      const rev = latestAnnual(facts, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"]);
      const ni = latestAnnual(facts, ["NetIncomeLoss"]);
      const assets = latestAnnual(facts, ["Assets"]);
      const equity = latestAnnual(facts, ["StockholdersEquity"]);
      const growth = rev.length >= 2 && rev[1].value ? Math.round((rev[0].value - rev[1].value) / rev[1].value * 1000) / 10 : null;
      const margin = rev[0]?.value && ni[0]?.value != null ? Math.round(ni[0].value / rev[0].value * 1000) / 10 : null;
      const roe = equity[0]?.value && ni[0]?.value != null ? Math.round(ni[0].value / equity[0].value * 1000) / 10 : null;
      return {
        cik, name: s.name, tickers: s.tickers, exchange: s.exchanges?.[0], sic: s.sicDescription,
        fiscal_year: rev[0]?.fy || ni[0]?.fy,
        revenue: rev[0]?.value ?? null,
        revenue_growth_pct: growth,
        net_income: ni[0]?.value ?? null,
        net_margin_pct: margin,
        total_assets: assets[0]?.value ?? null,
        return_on_equity_pct: roe,
        profitable: ni[0]?.value != null ? ni[0].value > 0 : null,
        method: "One-call financial snapshot from SEC XBRL: latest fiscal-year revenue, growth, net income, margin, ROE. Public issuers only.",
        source: "SEC EDGAR",
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "sec_error" }); }
});

export default router;
