// Service OTP / réception SMS pour agents x402. La SOURCE est un numéro physique (SIM d'un
// téléphone Android) que le bot ne peut PAS reproduire — le vrai moat. L'agent téléphone
// POUSSE ses SMS ici ; on les vend. Aucune dépendance au mini.
//
//   POST /sms/ingest       (agent téléphone, HMAC)  -> stocke device + messages
//   GET  /v1/sms/number    (payant)                 -> loue un numéro disponible
//   GET  /v1/sms/inbox     (payant)                 -> lit les SMS reçus (l'OTP)
//   GET  /free/sms/status  (gratuit)                -> y a-t-il un numéro en ligne ?
import { Router } from "express";
import crypto from "node:crypto";

const router = Router();
const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SB_KEY = process.env.SUPABASE_ANON_KEY || "";
const INGEST_SECRET = process.env.SMS_INGEST_SECRET || "";

async function rpc(fn, body) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error(`${fn}_${r.status}`);
  return r.json();
}

// --- ingestion : l'agent téléphone pousse ses SMS -----------------------------
// Auth HMAC : l'agent signe {phone, ts} ; on refuse les rejeux > 5 min.
router.post("/sms/ingest", async (req, res) => {
  if (!INGEST_SECRET) return res.status(503).json({ error: "sms_not_configured" });
  const { phone, carrier, country, messages, ts, sig } = req.body || {};
  if (!phone || !ts || !sig) return res.status(400).json({ error: "missing_fields" });
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return res.status(401).json({ error: "stale" });
  const expect = crypto.createHmac("sha256", INGEST_SECRET).update(`${phone}.${ts}`).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return res.status(401).json({ error: "bad_sig" });
  try {
    const n = await rpc("sms_ingest", { p_phone: phone, p_carrier: carrier || null, p_country: country || null, p_msgs: Array.isArray(messages) ? messages : [] });
    res.json({ ok: true, stored: n });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 80) }); }
});

// --- vente : louer un numéro --------------------------------------------------
router.all("/v1/sms/number", async (_req, res) => {
  try {
    const rows = await rpc("sms_pick_number", {});
    const d = Array.isArray(rows) ? rows[0] : null;
    if (!d) return res.status(503).json({ error: "no_number_online", detail: "No phone agent is online right now. You were not charged." });
    res.json({
      phone: d.phone, carrier: d.carrier, country: d.country,
      poll: `/v1/sms/inbox?phone=${encodeURIComponent(d.phone)}&since=${new Date().toISOString()}`,
      note: "Use this number to receive an OTP, then poll /v1/sms/inbox with ?since= (the ISO time you started) to read it. Real physical SIM — the class of number services can't easily block.",
    });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 80) }); }
});

// --- vente : lire l'inbox -----------------------------------------------------
router.all("/v1/sms/inbox", async (req, res) => {
  const p = { ...req.query, ...(req.body || {}) };
  const phone = p.phone;
  if (!phone) return res.status(400).json({ error: "missing_phone", hint: "get one from /v1/sms/number" });
  const since = p.since ? new Date(p.since) : null;
  try {
    const msgs = await rpc("sms_inbox", { p_phone: String(phone), p_since: since ? since.toISOString() : null });
    // extraction opportuniste du code OTP (4 à 8 chiffres) du dernier message
    const otp = (Array.isArray(msgs) && msgs[0]) ? (String(msgs[0].body).match(/\b(\d{4,8})\b/) || [])[1] || null : null;
    res.json({ phone, count: Array.isArray(msgs) ? msgs.length : 0, otp, messages: msgs });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 80) }); }
});

// --- gratuit : y a-t-il un numéro dispo ? (l'agent vérifie avant de payer) -----
router.get("/free/sms/status", async (_req, res) => {
  try {
    const rows = await rpc("sms_pick_number", {});
    const d = Array.isArray(rows) ? rows[0] : null;
    res.json({ available: !!d, ...(d ? { country: d.country, carrier: d.carrier } : {}) });
  } catch { res.json({ available: false }); }
});

// Page d'installation de l'agent (mobile) — protégée par ADMIN_TOKEN car la commande
// contient la clé d'ingestion. GET /install?token=ADMIN_TOKEN
const INSTALL_HTML = (cmd, cmd2) => `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Installer l'agent SMS</title>
<style>:root{--bg:#0e1116;--card:#171b22;--card2:#1e232c;--rule:#2a313c;--ink:#e8ecf1;--soft:#9aa6b4;--faint:#6b7683;--accent:#3ee0a0;--accent-ink:#06110c;--warn:#f0b429;--mono:ui-monospace,Menlo,monospace;--sans:-apple-system,system-ui,sans-serif}
@media(prefers-color-scheme:light){:root{--bg:#f5f7fa;--card:#fff;--card2:#eef2f6;--rule:#dbe1e9;--ink:#16202b;--soft:#4d5a6a;--faint:#8493a3;--accent:#0c9d6e;--accent-ink:#fff;--warn:#b57407}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5}
.wrap{max-width:32rem;margin:0 auto;padding:1.5rem 1.1rem 4rem;display:flex;flex-direction:column;gap:1.3rem}
h1{font-size:1.4rem;margin:0;letter-spacing:-.02em}.eyebrow{font-family:var(--mono);font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.step{background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:1rem;display:flex;flex-direction:column;gap:.55rem}
.step .n{font-family:var(--mono);font-size:.72rem;color:var(--accent);letter-spacing:.06em;text-transform:uppercase}.step h2{font-size:1rem;margin:0}.step p{margin:0;color:var(--soft);font-size:.9rem}.step a{color:var(--accent)}
.cmd{background:var(--card2);border:1px solid var(--rule);border-radius:6px;padding:.8rem;font-family:var(--mono);font-size:.78rem;line-height:1.5;word-break:break-all}
button.copy{appearance:none;border:none;border-radius:8px;background:var(--accent);color:var(--accent-ink);font-weight:700;font-size:1rem;padding:.85rem 1rem;cursor:pointer;font-family:var(--sans);min-height:52px}button.copy:active{transform:translateY(1px)}button.copy.ok{background:var(--card2);color:var(--accent);border:1px solid var(--accent)}
.fold{background:var(--card);border:1px solid var(--rule);border-radius:8px;padding:.9rem 1rem}.fold summary{cursor:pointer;font-size:.9rem;color:var(--soft)}.fold .cmd{margin-top:.7rem}
.note{font-size:.82rem;color:var(--faint);border-top:1px solid var(--rule);padding-top:.9rem}.warn{color:var(--warn)}</style></head><body>
<div class="wrap"><p class="eyebrow">x402 · agent téléphone</p><h1>Installer l'agent SMS</h1>
<div class="step"><span class="n">Étape 1</span><h2>Installe 2 apps depuis F-Droid</h2><p>Pas le Play Store. Ouvre <a href="https://f-droid.org/">f-droid.org</a>, installe F-Droid, puis dedans : <b>Termux</b> et <b>Termux:API</b>.</p></div>
<div class="step"><span class="n">Étape 2</span><h2>Ouvre Termux et colle ceci</h2><p>Une seule commande, elle installe tout et lance l'agent.</p><div class="cmd" id="c1">${cmd}</div><button class="copy" onclick="cp('c1',this)">📋 Copier la commande</button></div>
<div class="step"><span class="n">Étape 3</span><h2>Autorise les SMS</h2><p>Android demande la permission « SMS » — accepte. Ensuite ferme Termux ; garde le téléphone allumé avec du réseau.</p></div>
<details class="fold"><summary>Si le numéro n'est pas détecté</summary><p style="margin:.6rem 0 0;color:var(--soft);font-size:.88rem">Remplace par TON numéro (format international) :</p><div class="cmd" id="c2">${cmd2}</div><button class="copy" onclick="cp('c2',this)">📋 Copier avec numéro</button></details>
<p class="note"><span class="warn">⚠️ Page privée</span> — la commande contient ta clé. Ne la partage pas.</p></div>
<script>function cp(id,b){var t=document.getElementById(id).textContent.trim();function d(){var o=b.textContent;b.textContent="✅ Copié";b.classList.add("ok");setTimeout(function(){b.textContent=o;b.classList.remove("ok")},1600)}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(d).catch(function(){f(t,d)})}else f(t,d)}function f(t,d){var e=document.createElement("textarea");e.value=t;e.style.position="fixed";e.style.opacity="0";document.body.appendChild(e);e.select();try{document.execCommand("copy");d()}catch(x){}document.body.removeChild(e)}</script></body></html>`;

router.get("/install", (req, res) => {
  const admin = process.env.ADMIN_TOKEN || "";
  if (!admin || req.query.token !== admin) return res.status(404).send("Not found");
  const base = `${req.protocol}://${req.get("host")}`;
  const cmd = `curl -s ${base}/phone-agent.sh | INGEST_SECRET=${INGEST_SECRET} bash`;
  const cmd2 = `curl -s ${base}/phone-agent.sh | MY_NUMBER=+590690XXXXXX INGEST_SECRET=${INGEST_SECRET} bash`;
  res.type("html").send(INSTALL_HTML(cmd, cmd2));
});

export default router;
