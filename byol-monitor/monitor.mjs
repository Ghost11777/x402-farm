// byol-monitor — "Bring-Your-Own-Login" monitoring on a warm residential browser.
// Attaches to the persistent Chromium (CDP :9222, profile ~/.x402-browser-profile)
// where the user is already logged into their accounts, polls each target on its
// schedule, diffs the watched value, and fires an alert on change (ntfy / webhook).
//
// The moat: the session stays warm on a residential IP — so it can read gated
// dashboards (marketplace seller consoles, ad accounts, supplier portals) that
// datacenter scrapers and logged-out change-detectors can't reach.
//
//   node monitor.mjs            # run the loop (pm2-friendly)
//   node monitor.mjs --once     # single pass (for testing)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SF = path.join(DIR, "state.json");
const CDP = process.env.BYOL_CDP || "http://localhost:9222";
const ONCE = process.argv.includes("--once");

const cfg = () => JSON.parse(fs.readFileSync(path.join(DIR, "targets.json"), "utf8"));
let state = {};
try { state = JSON.parse(fs.readFileSync(SF, "utf8")); } catch {}
const save = () => fs.writeFileSync(SF, JSON.stringify(state, null, 2));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function ctx() {
  const b = await chromium.connectOverCDP(CDP);
  return b.contexts()[0] || (await b.newContext());
}

// Read the watched value for a target. Supports: json (dot-path on a JSON URL),
// selector (innerText of an element on a logged-in page), jsExpr (evaluate), title.
async function extract(page, t) {
  await page.goto(t.url, { waitUntil: t.waitUntil || "domcontentloaded", timeout: 60000 });
  if (t.waitMs) await page.waitForTimeout(t.waitMs);
  if (t.json) {
    const body = await page.innerText("body");
    try { return String(t.json.split(".").reduce((o, k) => o?.[k], JSON.parse(body))); }
    catch { return body.slice(0, 200); }
  }
  if (t.selector) { const el = await page.$(t.selector); return el ? (await el.innerText()).trim() : "(not found)"; }
  if (t.jsExpr) return String(await page.evaluate(t.jsExpr));
  return await page.title();
}

async function alert(t, oldV, newV) {
  const title = `BYOL: ${t.label || t.id} changed`;
  const msg = `${t.label || t.id}\nwas: ${oldV}\nnow: ${newV}\n${t.url}`;
  try {
    if (t.ntfy) await fetch(`https://ntfy.sh/${t.ntfy}`, { method: "POST", body: msg, headers: { Title: title, Priority: t.priority || "default" } });
    if (t.webhook) await fetch(t.webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: t.id, label: t.label, old: oldV, new: newV, url: t.url, at: Date.now() }) });
  } catch (e) { log("alert failed", t.id, e.message); }
  log("🔔 ALERT", t.id, `${oldV} -> ${newV}`);
}

async function tick(context) {
  const now = Date.now();
  const due = cfg().targets.filter((t) => !state[t.id]?.nextAt || now >= state[t.id].nextAt);
  if (!due.length) return;
  const page = await context.newPage();
  for (const t of due) {
    try {
      const val = await extract(page, t);
      const prev = state[t.id]?.value;
      const dir = t.alertOn; // "change" (default) | "increase" | "decrease"
      let fire = prev !== undefined && prev !== val;
      if (fire && (dir === "increase" || dir === "decrease")) {
        const a = parseFloat(prev), b = parseFloat(val);
        fire = Number.isFinite(a) && Number.isFinite(b) && (dir === "increase" ? b > a : b < a);
      }
      if (fire) await alert(t, prev, val);
      state[t.id] = { value: val, checkedAt: now, nextAt: now + (t.intervalMin || 30) * 60000 };
      save();
      log(`✓ ${t.id}: ${String(val).slice(0, 60)}`);
    } catch (e) {
      log(`✗ ${t.id}: ${e.message.slice(0, 80)}`);
      state[t.id] = { ...(state[t.id] || {}), checkedAt: now, nextAt: now + Math.min((t.intervalMin || 30), 10) * 60000 };
      save();
    }
  }
  await page.close().catch(() => {});
}

async function main() {
  let context;
  try { context = await ctx(); }
  catch (e) { log("❌ cannot reach warm browser on", CDP, "— start worker/browser-control.mjs first.", e.message); process.exit(1); }
  log(`byol-monitor up — CDP ${CDP}, ${cfg().targets.length} target(s), mode=${ONCE ? "once" : "loop"}`);
  await tick(context);
  if (ONCE) { process.exit(0); }
  setInterval(() => tick(context).catch((e) => log("tick error", e.message)), 60000);
}
main();
