// La route LIVRE-T-ELLE après paiement ? La clé interne traverse le paywall et exécute
// le vrai handler : ce qui casse ici casserait aussi APRÈS encaissement (le pire cas,
// on facture et on ne livre pas).
import { CATALOG } from "./src/catalog.js";
const BASE = "https://api.x-402.online";
const KEY = process.env.IKEY;
const out = [];
for (const e of CATALOG) {
  const [method, path] = e.route.split(" ");
  if (path.startsWith("/v1/proxy") || path.startsWith("/v1/mobile-proxy")) continue; // déjà validées, et ça mint des clés
  const qs = e.bazaar?.input && method === "GET"
    ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(e.bazaar.input).map(([k, v]) => [k, String(v)]))).toString() : "";
  const init = { method, headers: { "x-api-key": KEY } };
  if (method === "POST") { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(e.bazaar?.input || {}); }
  let status = 0, note = "";
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 40000);
    const r = await fetch(BASE + path + qs, { ...init, signal: ctl.signal });
    clearTimeout(t);
    status = r.status;
    const txt = await r.text();
    if (status === 200) {
      if (txt.length < 15) note = "réponse vide";
      else { try { const j = JSON.parse(txt); if (j.error) note = "erreur: " + String(j.error).slice(0, 45); } catch { /* non-JSON (png/pdf) = ok */ } }
    } else note = txt.slice(0, 90).replace(/\s+/g, " ");
  } catch (ex) { status = 0; note = "timeout/exception: " + String(ex.message).slice(0, 40); }
  out.push({ route: e.route, price: e.price, status, note });
  process.stdout.write(status === 200 && !note ? "." : "!");
}
console.log("\n");
const ko = out.filter(r => r.status !== 200 || r.note);
console.log(`${out.length} routes testées en livraison réelle — ${out.length - ko.length} OK`);
if (ko.length) { console.log("\n⚠️  ROUTES QUI ENCAISSERAIENT SANS LIVRER CORRECTEMENT :"); for (const r of ko) console.log(`  ${String(r.status).padEnd(4)} ${r.route.padEnd(36)} ${r.price.padEnd(8)} ${r.note}`); }
