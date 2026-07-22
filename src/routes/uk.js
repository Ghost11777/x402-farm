import { Router } from "express";
import { cached } from "../lib/cache.js";

// Module UK — Companies House (registre des sociétés britanniques).
// FRICTION : exige une clé API gratuite (auth Basic). L'agent ne l'a pas, nous oui.
// Ouvre le marché anglophone (agents US/UK = les plus nombreux sur x402).
const router = Router();
const CH = "https://api.company-information.service.gov.uk";

const q = (req, n) => (req.query[n] || "").toString().trim();
function authHeader() {
  const key = process.env.CH_API_KEY;
  if (!key) throw Object.assign(new Error("uk_not_configured"), { status: 503 });
  return "Basic " + Buffer.from(`${key}:`).toString("base64");
}
async function chGet(path, timeout = 12_000) {
  const r = await fetch(`${CH}${path}`, { headers: { authorization: authHeader(), accept: "application/json" }, signal: AbortSignal.timeout(timeout) });
  if (r.status === 404) throw Object.assign(new Error("not_found"), { status: 404 });
  if (r.status === 401) throw Object.assign(new Error("uk_bad_key"), { status: 502 });
  if (r.status === 429) throw Object.assign(new Error("uk_rate_limited"), { status: 429 });
  if (!r.ok) throw Object.assign(new Error(`ch_${r.status}`), { status: 502 });
  return r.json();
}
const settle = (p) => p.then((v) => ({ ok: true, v })).catch(() => ({ ok: false }));

async function resolveNumber(input) {
  if (/^[A-Z0-9]{6,8}$/i.test(input)) return input.toUpperCase();
  const s = await chGet(`/search/companies?q=${encodeURIComponent(input)}&items_per_page=1`);
  return s.items?.[0]?.company_number || null;
}

// ===== /uk/company : profil société =====
router.all("/v1/uk/company", async (req, res) => {
  const input = q(req, "q") || q(req, "number");
  if (!input) return res.status(400).json({ error: "missing_q_or_number" });
  try {
    const data = await cached(`uk-co:${input}`, 12 * 3600_000, async () => {
      const number = await resolveNumber(input);
      if (!number) return { found: false, query: input };
      const c = await chGet(`/company/${number}`);
      return {
        found: true, company_number: c.company_number, name: c.company_name,
        status: c.company_status, type: c.type, incorporated: c.date_of_creation,
        sic_codes: c.sic_codes, registered_office: c.registered_office_address,
        accounts: { last_made_up_to: c.accounts?.last_accounts?.made_up_to,
          next_due: c.accounts?.next_due, overdue: c.accounts?.overdue || false },
        confirmation_statement: { next_due: c.confirmation_statement?.next_due, overdue: c.confirmation_statement?.overdue || false },
        has_insolvency_history: c.has_insolvency_history || false,
        has_charges: c.has_charges || false,
        source: "UK Companies House",
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "uk_error", ...(e.message === "uk_not_configured" ? { hint: "Companies House API key not set on server yet" } : {}) }); }
});

// ===== /uk/officers : dirigeants =====
router.all("/v1/uk/officers", async (req, res) => {
  const input = q(req, "q") || q(req, "number");
  if (!input) return res.status(400).json({ error: "missing_q_or_number" });
  try {
    const data = await cached(`uk-off:${input}`, 12 * 3600_000, async () => {
      const number = await resolveNumber(input);
      if (!number) return { found: false };
      const o = await chGet(`/company/${number}/officers?items_per_page=35`);
      return { company_number: number, total: o.total_results,
        officers: (o.items || []).map((x) => ({ name: x.name, role: x.officer_role,
          appointed: x.appointed_on, resigned: x.resigned_on || null, nationality: x.nationality,
          occupation: x.occupation, country_of_residence: x.country_of_residence })) };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "uk_error" }); }
});

// ===== /uk/psc : bénéficiaires effectifs (Persons with Significant Control) =====
// Donnée clé pour KYB/AML : qui contrôle réellement la société.
router.all("/v1/uk/psc", async (req, res) => {
  const input = q(req, "q") || q(req, "number");
  if (!input) return res.status(400).json({ error: "missing_q_or_number" });
  try {
    const data = await cached(`uk-psc:${input}`, 12 * 3600_000, async () => {
      const number = await resolveNumber(input);
      if (!number) return { found: false };
      const p = await chGet(`/company/${number}/persons-with-significant-control?items_per_page=25`);
      return { company_number: number, total: p.total_results,
        controllers: (p.items || []).map((x) => ({ name: x.name, kind: x.kind,
          nature_of_control: x.natures_of_control, nationality: x.nationality,
          country_of_residence: x.country_of_residence, notified_on: x.notified_on,
          ceased: x.ceased_on || null })) };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "uk_error" }); }
});

// ===== /uk/company-check : vérification/KYB en un appel (composite premium) =====
router.all("/v1/uk/company-check", async (req, res) => {
  const input = q(req, "q") || q(req, "number");
  if (!input) return res.status(400).json({ error: "missing_q_or_number" });
  try {
    const data = await cached(`uk-check:${input}`, 12 * 3600_000, async () => {
      const number = await resolveNumber(input);
      if (!number) return { found: false, query: input };
      const [c, offR, pscR] = await Promise.all([
        chGet(`/company/${number}`),
        settle(chGet(`/company/${number}/officers?items_per_page=35`)),
        settle(chGet(`/company/${number}/persons-with-significant-control?items_per_page=25`)),
      ]);
      const age = c.date_of_creation ? 2026 - Number(c.date_of_creation.slice(0, 4)) : null;
      const activeOfficers = offR.ok ? (offR.v.items || []).filter((o) => !o.resigned_on).length : null;

      const flags = [];
      if (c.company_status !== "active") flags.push({ level: "critical", reason: `status: ${c.company_status}` });
      if (c.accounts?.overdue) flags.push({ level: "high", reason: "accounts overdue" });
      if (c.confirmation_statement?.overdue) flags.push({ level: "medium", reason: "confirmation statement overdue" });
      if (c.has_insolvency_history) flags.push({ level: "high", reason: "insolvency history" });
      if (age !== null && age < 1) flags.push({ level: "medium", reason: "incorporated < 1 year ago" });
      if (activeOfficers === 0) flags.push({ level: "medium", reason: "no active officers" });

      const verdict = flags.some((f) => f.level === "critical") ? "REJECT"
        : flags.some((f) => f.level === "high") ? "ENHANCED DUE DILIGENCE"
        : flags.some((f) => f.level === "medium") ? "REVIEW" : "PASS";

      return {
        company_number: number, name: c.company_name, verdict,
        status: c.company_status, incorporated: c.date_of_creation, age_years: age,
        sic_codes: c.sic_codes, registered_office: c.registered_office_address,
        accounts_overdue: c.accounts?.overdue || false,
        insolvency_history: c.has_insolvency_history || false,
        active_officers: activeOfficers,
        beneficial_owners: pscR.ok ? (pscR.v.items || []).filter((x) => !x.ceased_on).map((x) => ({ name: x.name, control: x.natures_of_control })) : [],
        flags,
        method: "UK KYB check: Companies House status, accounts/filing compliance, insolvency history, officers and beneficial owners (PSC). Indicative decision aid, not a regulated AML report.",
        sources: ["UK Companies House"],
      };
    });
    res.json(data);
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "uk_error" }); }
});

export default router;
