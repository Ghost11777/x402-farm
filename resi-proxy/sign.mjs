// Shared signed-key scheme for the residential proxy.
// The farm mints a self-describing key on x402 payment; the proxy validates it
// locally by HMAC — no callback / shared DB needed.
//
// key format:  rp1.<gb>.<expEpochSec>.<sig>
//   sig = base64url(HMAC_SHA256(secret, "<gb>.<exp>")).slice(0,22)
import crypto from "node:crypto";

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function signKey(gb, secret, ttlDays = 30) {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const body = `${gb}.${exp}`;
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest()).slice(0, 22);
  return `rp1.${body}.${sig}`;
}

// returns { ok, gb, exp } or { ok:false, reason }
export function verifyKey(key, secret) {
  if (typeof key !== "string" || !key.startsWith("rp1.")) return { ok: false, reason: "not_signed" };
  const parts = key.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };
  const [, gbStr, expStr, sig] = parts;
  const body = `${gbStr}.${expStr}`;
  const expect = b64url(crypto.createHmac("sha256", secret).update(body).digest()).slice(0, 22);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return { ok: false, reason: "bad_sig" };
  const exp = Number(expStr);
  if (Number.isFinite(exp) && exp * 1000 < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, gb: Number(gbStr), exp };
}
