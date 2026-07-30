// resi-proxy — an authenticated, metered HTTP/HTTPS forward proxy that routes
// buyers' traffic through this machine's RESIDENTIAL IP, or through a 4G/5G MOBILE
// exit when one is plugged in. Access is gated by a key with a byte quota (keys are
// minted when a buyer pays via x402 → captures ~100% of the bandwidth value).
//
// SAFETY: binds to 127.0.0.1 by default (NOT a public exit) — set PROXY_BIND=0.0.0.0
// only when you consciously go live. Blocks private/loopback targets and non-web ports
// to limit exit-node abuse. Meters bytes per key and enforces the quota. Every request
// is logged (exit, target host:port, bytes) so abuse can be traced.
//
//   node proxy.mjs --add-key 5           # mint a key with a 5 GB quota -> prints key
//   node proxy.mjs --probe               # test every exit and print its real public IP
//   node proxy.mjs                        # run the proxy (PROXY_PORT, PROXY_BIND)
//
// EXITS (exits.json, optional) — two topologies, both verified before being sold:
//   { "mobile1": "192.168.8.100" }                      // source-IP bind on THIS host
//                                                       //   (needs pf route-to: see
//                                                       //    setup-mobile-exit.sh)
//   { "mobile1": { "upstream": "http://192.168.1.50:8899",
//                  "user": "buyer", "key": "rp_…" } }    // chain to a 4G-only device
// exits-state.json is rewritten by the probe loop: it records, per exit, the PUBLIC IP
// actually observed and whether the carrier is a mobile network. The farm reads it (via
// the worker) and refuses to sell a tier that isn't verified — never sell what we can't
// deliver.
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { verifyKey } from "./sign.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const KF = path.join(DIR, "keys.json");
const SECRET_FILE = path.join(DIR, ".hmac_secret");
const EXITS_FILE = path.join(DIR, "exits.json");
const STATE_FILE = path.join(DIR, "exits-state.json");
// Stock vendable par sortie (Go/mois) : c'est l'enveloppe data réelle de la SIM /
// de l'abonnement. Sans ça on vendrait plus de Go qu'on n'en possède.
const INVENTORY_FILE = path.join(DIR, "inventory.json");
const USAGE_FILE = path.join(DIR, "usage.json");
const SECRET = process.env.PROXY_HMAC_SECRET
  || (fs.existsSync(SECRET_FILE) ? fs.readFileSync(SECRET_FILE, "utf8").trim() : "");
const PORT = Number(process.env.PROXY_PORT || 8899);
const BIND = process.env.PROXY_BIND || "127.0.0.1";
const PROBE_EVERY_MS = Number(process.env.PROXY_PROBE_MS || 10 * 60 * 1000);

const load = () => { try { return JSON.parse(fs.readFileSync(KF, "utf8")); } catch { return {}; } };
const save = (k) => fs.writeFileSync(KF, JSON.stringify(k, null, 2));

// --- mint a key --------------------------------------------------------------
if (process.argv.includes("--add-key")) {
  const gb = Number(process.argv[process.argv.indexOf("--add-key") + 1] || 1);
  const keys = load();
  const key = "rp_" + crypto.randomBytes(18).toString("hex");
  keys[key] = { quotaBytes: Math.round(gb * 1e9), usedBytes: 0, createdAt: Date.now() };
  save(keys);
  console.log(`key: ${key}\nquota: ${gb} GB\nuse as:  curl -x http://buyer:${key}@HOST:${PORT} https://api.ipify.org`);
  process.exit(0);
}

// --- helpers -----------------------------------------------------------------
function authKey(req) {
  const h = req.headers["proxy-authorization"] || "";
  const m = /^Basic\s+(.+)$/i.exec(h);
  if (!m) return {};
  const dec = Buffer.from(m[1], "base64").toString("utf8");
  const i = dec.indexOf(":");
  return { user: i >= 0 ? dec.slice(0, i) : "", key: i >= 0 ? dec.slice(i + 1) : dec };
}

// Exit interfaces = which IP a buyer's traffic leaves through.
// The primary residential NIC is the default. A 4G modem is either (a) another
// interface ON THIS HOST — then pf must route its source IP out that interface,
// see setup-mobile-exit.sh — or (b) a separate 4G-only device we chain to.
function ifaceMap() {
  const map = {};
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === "IPv4" && !a.internal) map[name] ??= a.address;
  }
  return map;
}
function exitsConfig() {
  const map = ifaceMap();
  const primary = Object.values(map)[0];
  let named = {};
  try { named = JSON.parse(fs.readFileSync(EXITS_FILE, "utf8")); } catch {}
  const out = { residential: { kind: "source", ip: primary } };
  for (const [name, v] of Object.entries(named)) {
    if (name === "residential") continue;
    if (typeof v === "string") out[name] = { kind: "source", ip: v };
    else if (v && v.upstream) out[name] = { kind: "chain", upstream: v.upstream, user: v.user || "buyer", key: v.key || "" };
    else if (v && v.ip) out[name] = { kind: "source", ip: v.ip };
  }
  return out;
}
// user selects the exit: "buyer"/"residential" -> primary; a named modem -> that exit.
function resolveExit(user) {
  const cfg = exitsConfig();
  if (!user || ["buyer", "default", "residential"].includes(user)) return { name: "residential", ...cfg.residential };
  if (cfg[user]) return { name: user, ...cfg[user] };
  return { name: "residential", ...cfg.residential, requested: user, fellBack: true };
}
function check(key) {
  const keys = load();
  let rec = keys[key];
  // Signed keys minted by the farm (rp1.…) materialize on first use, no shared DB.
  if (!rec && typeof key === "string" && key.startsWith("rp1.")) {
    const v = verifyKey(key, SECRET);
    if (!v.ok) return { ok: false, code: 407, msg: `invalid signed key (${v.reason})` };
    rec = keys[key] = { quotaBytes: Math.round(v.gb * 1e9), usedBytes: 0, createdAt: Date.now(), exp: v.exp };
    save(keys);
  }
  if (!rec) return { ok: false, code: 407, msg: "invalid or missing proxy key" };
  if (rec.exp && rec.exp * 1000 < Date.now()) return { ok: false, code: 407, msg: "key expired" };
  if (rec.usedBytes >= rec.quotaBytes) return { ok: false, code: 402, msg: "quota exhausted — buy more GB" };
  return { ok: true, keys, rec, key };
}
function meter(ctx, n, exitName) {
  ctx.rec.usedBytes += n;
  ctx._dirty = (ctx._dirty || 0) + n;
  ctx._exitDirty = (ctx._exitDirty || 0) + n;
  if (ctx._dirty > 2e6) { save(ctx.keys); ctx._dirty = 0; } // flush every ~2MB
  // Conso par sortie = ce qui décompte le forfait data de la SIM (flush ~2 Mo aussi)
  if (exitName && ctx._exitDirty > 2e6) { addUsage(exitName, ctx._exitDirty); ctx._exitDirty = 0; }
}
// --- stock & consommation par sortie -----------------------------------------
const monthKey = () => new Date().toISOString().slice(0, 7);
function inventory() {
  try { return JSON.parse(fs.readFileSync(INVENTORY_FILE, "utf8")); } catch { return {}; }
}
function usage() {
  let u = {};
  try { u = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")); } catch {}
  if (u.month !== monthKey()) u = { month: monthKey(), exits: {} };   // remise à zéro mensuelle
  u.exits ||= {};
  return u;
}
function addUsage(exitName, bytes) {
  const u = usage();
  u.exits[exitName] = (u.exits[exitName] || 0) + bytes;
  try { fs.writeFileSync(USAGE_FILE, JSON.stringify(u)); } catch {}
  return u.exits[exitName];
}
// Go restants pour une sortie (null = pas de plafond déclaré).
function remainingGB(exitName) {
  const cap = inventory()[exitName]?.capGB;
  if (typeof cap !== "number") return null;
  const used = (usage().exits[exitName] || 0) / 1e9;
  return Math.max(0, cap - used);
}
function exhausted(exitName) {
  const r = remainingGB(exitName);
  return r !== null && r <= 0;
}

const BLOCKED_PORTS = new Set([22, 23, 25, 3389, 445, 135, 139]);
function targetAllowed(host, port) {
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|fe80:)/i.test(host)) return false;
  if (BLOCKED_PORTS.has(Number(port))) return false;
  return true;
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
// Abuse trail: who (key tail), through which exit, to which host — never any payload.
const trace = (exit, key, target, extra = "") =>
  log(`→ exit=${exit.name}${exit.fellBack ? `(fallback from ${exit.requested})` : ""} key=…${String(key).slice(-8)} target=${target} ${extra}`);

// --- dialing through an exit --------------------------------------------------
// Source mode: bind the outgoing socket to the exit's IP (pf sends it out the right NIC).
// Chain mode: CONNECT through a 4G-only device that owns the mobile uplink.
function openTunnel(exit, host, port, onReady, onError) {
  if (exit.kind === "chain") {
    const u = new URL(exit.upstream);
    const s = net.connect({ host: u.hostname, port: Number(u.port) || 8899 });
    let buf = "";
    const onData = (d) => {
      buf += d.toString("latin1");
      const i = buf.indexOf("\r\n\r\n");
      if (i < 0) return;
      s.removeListener("data", onData);
      if (!/^HTTP\/1\.[01] 200/.test(buf)) { onError(new Error(`upstream refused CONNECT: ${buf.slice(0, 48)}`)); return s.destroy(); }
      const rest = Buffer.from(buf.slice(i + 4), "latin1");
      onReady(s, rest.length ? rest : null);
    };
    s.on("data", onData);
    s.once("error", onError);
    s.once("connect", () => {
      const auth = Buffer.from(`${exit.user}:${exit.key}`).toString("base64");
      s.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`);
    });
    return s;
  }
  const s = net.connect({ host, port, localAddress: exit.ip }, () => onReady(s, null));
  s.once("error", onError);
  return s;
}
// Plain HTTP request options for an exit (chain mode = absolute-URI to the upstream).
function httpOptsFor(exit, target, req) {
  if (exit.kind === "chain") {
    const u = new URL(exit.upstream);
    const headers = { ...req.headers };
    headers["proxy-authorization"] = "Basic " + Buffer.from(`${exit.user}:${exit.key}`).toString("base64");
    return { host: u.hostname, port: Number(u.port) || 8899, path: target.toString(), method: req.method, headers };
  }
  return {
    host: target.hostname, port: target.port || 80, path: target.pathname + target.search,
    method: req.method, headers: req.headers, localAddress: exit.ip,
  };
}

// --- exit verification (what the farm is allowed to sell) ---------------------
// Probes each exit the same way a buyer would use it, and asks ip-api.com to describe
// the IP it came out of: `mobile:true` = a real carrier network. No key needed.
function probeExit(exit) {
  return new Promise((resolve) => {
    const target = new URL("http://ip-api.com/json/?fields=status,query,isp,as,mobile,proxy,countryCode");
    const opts = httpOptsFor(exit, target, { method: "GET", headers: { host: target.host, "user-agent": "resi-proxy/probe" } });
    const req = http.request({ ...opts, timeout: 12000 }, (r) => {
      let body = "";
      r.on("data", (d) => { body += d; });
      r.on("end", () => {
        try {
          const j = JSON.parse(body);
          if (j.status !== "success") return resolve({ ok: false, error: `ip-api: ${j.message || "failed"}` });
          resolve({ ok: true, ip: j.query, isp: j.isp, as: j.as, mobile: !!j.mobile, flaggedProxy: !!j.proxy, country: j.countryCode });
        } catch {
          // Pas du JSON = l'opérateur intercepte (portail captif). On remonte la
          // redirection : c'est elle qui nomme le problème (ex. Orange Caraïbe
          // « Nocredit_Erecharge » = forfait data épuisé, rien à voir avec le routage).
          const loc = r.headers.location;
          resolve({
            ok: false,
            error: loc
              ? `carrier captive portal (HTTP ${r.statusCode} -> ${loc})${/nocredit|recharge/i.test(loc) ? " — DATA PLAN EMPTY: top up the SIM" : ""}`
              : `unparsable probe response (HTTP ${r.statusCode}): ${body.slice(0, 60).replace(/\s+/g, " ")}`,
          });
        }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.end();
  });
}
async function probeAll() {
  const cfg = exitsConfig();
  const exits = {};
  for (const [name, e] of Object.entries(cfg)) {
    const r = await probeExit({ name, ...e });
    const cap = inventory()[name]?.capGB ?? null;
    const usedGB = Number(((usage().exits[name] || 0) / 1e9).toFixed(3));
    exits[name] = { kind: e.kind, bind: e.ip || e.upstream, ...r, capGB: cap, usedGB, remainingGB: remainingGB(name) };
  }
  // A source-bound exit that comes out on the SAME public IP as residential is not a
  // separate exit at all (routing not in place) — mark it so nothing gets sold as mobile.
  const resiIp = exits.residential?.ip;
  for (const [name, r] of Object.entries(exits)) {
    if (name !== "residential" && r.ok && r.ip === resiIp) {
      r.ok = false;
      r.error = "same public IP as residential — routing not effective (see setup-mobile-exit.sh)";
    }
  }
  // Garde-fou inverse : si la sortie "résidentielle" ressort sur un opérateur MOBILE,
  // la route par défaut est passée sur la 4G (ordre des services réseau inversé sur le
  // mini). On refuse alors de vendre du "résidentiel" qui n'en est pas.
  if (exits.residential?.ok && exits.residential.mobile) {
    exits.residential.ok = false;
    exits.residential.error = "default route is on a MOBILE carrier — set Ethernet above Wi-Fi in Network > Set Service Order (residential tier suspended)";
  }
  const state = { checkedAt: new Date().toISOString(), host: os.hostname(), exits };
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
  return state;
}

if (process.argv.includes("--probe")) {
  const s = await probeAll();
  for (const [name, r] of Object.entries(s.exits)) {
    const stock = r.capGB === null ? "stock non plafonné" : `stock ${r.remainingGB}/${r.capGB} Go restants ce mois`;
    console.log(`${name.padEnd(12)} ${r.ok ? `${r.ip}  ${r.mobile ? "MOBILE ✅" : "fixe (non-mobile)"}  ${r.isp} [${r.as}]  — ${stock}` : `KO — ${r.error}`}`);
  }
  process.exit(0);
}

// --- HTTPS via CONNECT (tunnel) ---------------------------------------------
const server = http.createServer();
server.on("connect", (req, clientSocket, head) => {
  const { user, key } = authKey(req);
  const c = check(key);
  if (!c.ok) { clientSocket.write(`HTTP/1.1 ${c.code} ${c.msg}\r\nProxy-Authenticate: Basic\r\n\r\n`); return clientSocket.destroy(); }
  const [host, port] = req.url.split(":");
  if (!targetAllowed(host, port || 443)) { clientSocket.write("HTTP/1.1 403 target blocked\r\n\r\n"); return clientSocket.destroy(); }
  const exit = resolveExit(user); // username picks the exit: residential (default) or a named 4G modem
  if (exhausted(exit.name)) {
    clientSocket.write(`HTTP/1.1 502 exit "${exit.name}" monthly data allowance exhausted\r\n\r\n`);
    return clientSocket.destroy();
  }
  trace(exit, key, `${host}:${port || 443}`, "CONNECT");
  const upstream = openTunnel(exit, host, Number(port) || 443,
    (sock, pending) => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (pending?.length) clientSocket.write(pending);
      if (head?.length) sock.write(head);
      sock.pipe(clientSocket);
      clientSocket.pipe(sock);
    },
    () => clientSocket.destroy());
  const onData = (buf) => { meter(c, buf.length, exit.name); if (c.rec.usedBytes >= c.rec.quotaBytes) { save(c.keys); upstream.destroy(); clientSocket.destroy(); } };
  upstream.on("data", onData); clientSocket.on("data", onData);
  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
  clientSocket.on("close", () => { save(c.keys); if (c._exitDirty) { addUsage(exit.name, c._exitDirty); c._exitDirty = 0; } upstream.destroy(); });
});

// --- plain HTTP proxy --------------------------------------------------------
server.on("request", (req, res) => {
  const { user, key } = authKey(req);
  // local admin: exits detected + their last verified public IP / carrier
  if (req.url === "/_exits" && (req.socket.remoteAddress || "").includes("127.0.0.1")) {
    let state = {}; try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
    return res.writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ config: exitsConfig(), verified: state }, null, 2));
  }
  const c = check(key);
  if (!c.ok) { res.writeHead(c.code, { "Proxy-Authenticate": "Basic" }); return res.end(c.msg); }
  let target; try { target = new URL(req.url); } catch { res.writeHead(400); return res.end("bad target"); }
  if (!targetAllowed(target.hostname, target.port || 80)) { res.writeHead(403); return res.end("target blocked"); }
  const exit = resolveExit(user);
  if (exhausted(exit.name)) { res.writeHead(502); return res.end(`exit "${exit.name}" monthly data allowance exhausted`); }
  trace(exit, key, `${target.hostname}:${target.port || 80}`, req.method);
  const up = http.request(httpOptsFor(exit, target, req), (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.on("data", (b) => { meter(c, b.length, exit.name); });
    r.pipe(res);
    r.on("end", () => { save(c.keys); if (c._exitDirty) { addUsage(exit.name, c._exitDirty); c._exitDirty = 0; } });
  });
  up.on("error", () => { res.writeHead(502); res.end("upstream error"); });
  req.on("data", (b) => meter(c, b.length, exit.name));
  req.pipe(up);
});

server.listen(PORT, BIND, async () => {
  log(`resi-proxy on ${BIND}:${PORT} — hmacSecret=${SECRET.length}B — exits: ${Object.keys(exitsConfig()).join(", ")}. ${BIND === "127.0.0.1" ? "(LOCAL ONLY — set PROXY_BIND=0.0.0.0 to go public)" : "⚠️ PUBLIC EXIT"}`);
  const s = await probeAll();
  for (const [name, r] of Object.entries(s.exits)) log(`  exit ${name}: ${r.ok ? `${r.ip} ${r.mobile ? "MOBILE" : "fixe"} (${r.isp})` : `KO — ${r.error}`}`);
  setInterval(probeAll, PROBE_EVERY_MS).unref?.();
});
