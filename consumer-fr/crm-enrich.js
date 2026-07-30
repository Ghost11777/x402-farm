// Enrichissement Twenty CRM : pour chaque société, lance la due-diligence FR
// (via la ferme x402) et attache une NOTE-dossier à la fiche société.
//
//   node crm-enrich.js            # enrichit les 30 dernières sociétés
//   node crm-enrich.js --limit 100
//   node crm-enrich.js --dry      # calcule les dossiers SANS écrire dans le CRM
//
// Env requis (.env) : TWENTY_API_KEY, TWENTY_BASE_URL (défaut http://localhost:3000).
// Mode ferme (gratuit/payant) hérité de X402_INTERNAL_KEY — voir README.
import "dotenv/config";
import { runDiligence } from "./diligence.js";
import { toMarkdown } from "./report.js";

const BASE = (process.env.TWENTY_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const KEY = process.env.TWENTY_API_KEY;
if (!KEY) { console.error("TWENTY_API_KEY manquante dans .env"); process.exit(1); }

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 30;

const EMOJI = { GREEN: "🟢", ORANGE: "🟠", RED: "🔴" };

async function tw(path, method = "GET", body) {
  const res = await fetch(`${BASE}/rest${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!res.ok) throw new Error(`Twenty ${method} ${path} -> ${res.status} ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

async function attachNote(companyId, dossier) {
  const md = toMarkdown(dossier);
  const title = `Due-diligence ${EMOJI[dossier.risk] || ""} ${dossier.verdict || dossier.risk || ""} — score ${dossier.score ?? "n/d"}`;
  // 1) créer la note (bodyV2.markdown = rich text Twenty)
  const noteRes = await tw("/notes", "POST", { title, bodyV2: { markdown: md } });
  const noteId = noteRes?.data?.createNote?.id || noteRes?.data?.id || noteRes?.id;
  if (!noteId) throw new Error("note créée mais id introuvable");
  // 2) lier la note à la société (morph-relation Twenty : targetCompanyId)
  await tw("/noteTargets", "POST", { noteId, targetCompanyId: companyId });
  return noteId;
}

async function main() {
  const list = await tw(`/companies?limit=${limit}`);
  const companies = list?.data?.companies || list?.data || [];
  console.log(`${companies.length} sociétés · mode ferme ${process.env.X402_INTERNAL_KEY ? "gratuit" : "PAYANT USDC"}${dry ? " · DRY (pas d'écriture CRM)" : ""}\n`);

  let cost = 0, enriched = 0;
  for (const c of companies) {
    if (!c.name) continue;
    try {
      const d = await runDiligence(c.name);
      cost += d.totalCostUsd || 0;
      const tag = `${EMOJI[d.risk] || "•"} ${d.risk}${d.error ? " (introuvable)" : ""}`;
      if (dry) {
        console.log(`${tag}  ${c.name}  — score ${d.score ?? "n/d"} · $${d.totalCostUsd}`);
      } else if (!d.error) {
        const noteId = await attachNote(c.id, d);
        enriched++;
        console.log(`${tag}  ${c.name}  → note ${String(noteId).slice(0, 8)} · $${d.totalCostUsd}`);
      } else {
        console.log(`${tag}  ${c.name}  (pas de dossier écrit)`);
      }
    } catch (e) {
      console.log(`⚠️  ${c.name}: ${e.message}`);
    }
  }
  console.log(`\n== ${enriched}/${companies.length} enrichies · coût ferme total $${Math.round(cost * 1000) / 1000} ==`);
}

main().catch((e) => { console.error(e); process.exit(1); });
