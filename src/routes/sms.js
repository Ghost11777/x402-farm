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

export default router;
