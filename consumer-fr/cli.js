#!/usr/bin/env node
// Agent de due-diligence B2B France.
//   node cli.js "Decathlon"            -> dossier markdown
//   node cli.js 552100554 --json       -> JSON structuré
//   node cli.js "Some SARL" --batch a.txt   (une entreprise par ligne)
//
// Mode gratuit (dev)  : X402_INTERNAL_KEY=... node cli.js "…"
// Mode payant (demande réelle) : sans clé interne -> paie en USDC (wallet ../.buyer.secret)
import "dotenv/config";
import { runDiligence } from "./diligence.js";
import { toMarkdown } from "./report.js";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const batchIdx = args.indexOf("--batch");
const targets = batchIdx >= 0
  ? readFileSync(args[batchIdx + 1], "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  : args.filter((a) => !a.startsWith("--"));

if (!targets.length) {
  console.error('Usage: node cli.js "<nom ou SIREN>" [--json] [--batch fichier.txt]');
  process.exit(1);
}

let totalCost = 0;
for (const target of targets) {
  try {
    const d = await runDiligence(target);
    totalCost += d.totalCostUsd || 0;
    if (json) console.log(JSON.stringify(d, null, 2));
    else console.log(toMarkdown(d) + "\n");
  } catch (e) {
    console.error(`[${target}] erreur: ${e.message}`);
  }
}
if (targets.length > 1) console.error(`\n== ${targets.length} dossiers · coût total $${Math.round(totalCost * 1000) / 1000} ==`);
