// Rend un dossier de due-diligence en markdown lisible.
const EMOJI = { GREEN: "🟢", ORANGE: "🟠", RED: "🔴" };
const LABEL = { GREEN: "FEU VERT", ORANGE: "VIGILANCE", RED: "ALERTE" };

export function toMarkdown(d) {
  if (d.error) return `# Due-diligence — ${d.input}\n\n❌ ${d.error}\n\n_Coût: $${d.totalCostUsd} · ${d.calls.length} appel(s)_`;
  const id = d.identity || {};
  const siege = id.siege || {};
  const dirs = Array.isArray(id.dirigeants) ? id.dirigeants : [];
  const L = [];
  L.push(`# Due-diligence — ${d.denomination || d.input}`);
  L.push("");
  L.push(`## ${EMOJI[d.risk]} Verdict : ${LABEL[d.risk]}`);
  L.push("");
  L.push(`- **Conformité KYB** : ${d.verdict || "n/d"}`);
  if (d.score != null) L.push(`- **Score de solidité** : ${d.score}/100`);
  L.push(`- **Procédures collectives** : ${d.insolvency?.flag ? "⚠️ OUI" : "aucune"}`);
  L.push(`- **Drapeaux rouges** : ${d.flags}`);
  L.push(`- **TVA intracommunautaire (VIES)** : ${d.vatValidatedVies === true ? "valide" : d.vatValidatedVies === false ? "non validée" : "n/d"}`);
  L.push("");
  L.push(`## Identité`);
  L.push(`- **SIREN** : ${id.siren || d.resolvedSiren || "n/d"}`);
  L.push(`- **Dénomination** : ${id.nom || "n/d"}`);
  L.push(`- **NAF/APE** : ${id.naf || "n/d"}`);
  L.push(`- **État** : ${id.etat || "n/d"}`);
  L.push(`- **Création** : ${id.creation || "n/d"} · **Effectif** : ${id.effectif || "n/d"}`);
  if (siege.adresse) L.push(`- **Siège** : ${siege.adresse}`);
  const dirName = (x) => {
    if (typeof x === "string") return x;
    if (x && typeof x === "object") return x.nom || x.name || x.denomination || [x.prenom, x.nom_famille || x.nom].filter(Boolean).join(" ") || null;
    return null;
  };
  const dirNames = dirs.map(dirName).filter(Boolean);
  if (dirNames.length) L.push(`- **Dirigeants** : ${dirNames.slice(0, 5).join(" · ")}`);
  if (d.events?.length) {
    L.push("");
    L.push(`## Événements légaux récents (BODACC)`);
    for (const e of d.events) L.push(`- ${e.date || ""} — ${e.type || e.famille || "annonce"}${e.famille && e.type ? ` (${e.famille})` : ""}`);
  }
  L.push("");
  L.push(`---`);
  L.push(`_Dossier généré le ${d.generatedAt} · ${d.calls.length} appels x402 · **coût total $${d.totalCostUsd}** (${d.mode}) · données : registres publics FR via api.x-402.online_`);
  return L.join("\n");
}
