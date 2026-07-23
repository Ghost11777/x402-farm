// Récolte du cookie DataDome de Leboncoin — À LANCER SUR LE MINI (fenêtre visible).
// Ouvre Leboncoin, TU résous le captcha à la main, puis on sauve le cookie `datadome`
// (lié à l'IP résidentielle du mini). La route /v1/fr/leboncoin le réutilise.
// Usage :  cd <repo> && node worker/leboncoin-harvest.mjs
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

chromium.use(stealth());
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const OUT = join(dirname(fileURLToPath(import.meta.url)), ".leboncoin-cookie.json");

const browser = await chromium.launch({ headless: false, args: ["--disable-blink-features=AutomationControlled"] });
const ctx = await browser.newContext({
  userAgent: UA, locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1366, height: 900 },
  extraHTTPHeaders: { "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" },
});
const page = await ctx.newPage();
await page.goto("https://www.leboncoin.fr/recherche?category=9&locations=Bordeaux_33000", { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("\n==============================================================");
console.log(" RÉSOUS LE CAPTCHA dans la fenêtre du navigateur qui vient de");
console.log(" s'ouvrir. Attends que de VRAIES annonces s'affichent, PUIS");
console.log(" reviens ici et appuie sur ENTRÉE.");
console.log("==============================================================\n");

process.stdin.resume();
await new Promise((r) => process.stdin.once("data", r));

const cookies = await ctx.cookies();
const dd = cookies.find((c) => c.name === "datadome");
writeFileSync(OUT, JSON.stringify({ cookies, ua: UA, savedAt: Date.now() }, null, 0));
console.log(`\nSauvé -> ${OUT}`);
console.log("cookie datadome présent :", !!dd, dd ? `(len ${dd.value.length})` : "");
console.log("Teste maintenant : la route /v1/fr/leboncoin doit renvoyer des annonces.\n");
await browser.close();
process.exit(0);
