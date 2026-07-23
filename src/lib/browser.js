// Sur Vercel : chromium allégé @sparticuz + playwright-core. Ailleurs : Playwright complet.
const IS_VERCEL = !!process.env.VERCEL;

// Un seul navigateur partagé, un contexte jetable par requête,
// et un sémaphore pour ne pas mettre le VPS à genoux.
const MAX_CONCURRENT = Number(process.env.BROWSER_CONCURRENCY || 4);
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS || 25000);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 x402-farm/0.1";

let browserPromise = null;
let active = 0;
const queue = [];

function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function release() {
  const next = queue.shift();
  if (next) next();
  else active--;
}

async function launch() {
  if (IS_VERCEL) {
    const [{ chromium }, sparticuz] = await Promise.all([
      import("playwright-core"),
      import("@sparticuz/chromium"),
    ]);
    return chromium.launch({
      headless: true,
      executablePath: await sparticuz.default.executablePath(),
      args: [...sparticuz.default.args, "--disable-dev-shm-usage"],
    });
  }
  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = launch();
    browserPromise.then((b) => b.on("disconnected", () => (browserPromise = null)));
  }
  return browserPromise;
}

export async function withPage(url, fn, { fullPage = false } = {}) {
  await acquire();
  let context;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: fullPage ? 720 : 800 },
      locale: "fr-FR",
    });
    // Cookies de consentement Google (évitent l'interstitiel consent.google.com sur Maps/Search).
    // Portée .google.com uniquement -> sans effet sur les autres domaines.
    await context.addCookies([
      { name: "SOCS", value: "CAISNQgQEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwMTA5LjA3X3AxGgJlbiACGgYIgLC_rQY", domain: ".google.com", path: "/" },
      { name: "CONSENT", value: "YES+cb.20210328-17-p0.en+FX+000", domain: ".google.com", path: "/" },
    ]).catch(() => {});
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    return await fn(page);
  } finally {
    if (context) await context.close().catch(() => {});
    release();
  }
}

export async function closeBrowser() {
  if (browserPromise) (await browserPromise).close().catch(() => {});
}

// ---------- Mode furtif (anti-fingerprint) pour les sites à anti-bot (Amazon, immo…) ----------
// playwright-extra + stealth patchent ~20 vecteurs de détection (webdriver, plugins, WebGL…).
// Import DYNAMIQUE : ne charge QUE sur le worker (les routes concernées sont forcées sur le mini),
// jamais sur Vercel (qui n'a pas le playwright complet). UA Chrome récent + contexte FR réaliste.
const STEALTH_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
let stealthChromium = null;
let stealthBrowserPromise = null;
async function getStealthChromium() {
  if (stealthChromium) return stealthChromium;
  const { chromium } = await import("playwright-extra");
  const stealth = (await import("puppeteer-extra-plugin-stealth")).default;
  chromium.use(stealth());
  stealthChromium = chromium;
  return stealthChromium;
}
async function getStealthBrowser() {
  if (!stealthBrowserPromise) {
    const ch = await getStealthChromium();
    stealthBrowserPromise = ch.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"] });
    stealthBrowserPromise.then((b) => b.on("disconnected", () => (stealthBrowserPromise = null)));
  }
  return stealthBrowserPromise;
}
export async function withStealthPage(url, fn, { waitMs = 3500, cookies = [] } = {}) {
  await acquire();
  let context;
  try {
    const browser = await getStealthBrowser();
    context = await browser.newContext({
      userAgent: STEALTH_UA, locale: "fr-FR", timezoneId: "Europe/Paris",
      viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: { "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" },
    });
    if (cookies.length) await context.addCookies(cookies).catch(() => {});
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (waitMs) await page.waitForTimeout(waitMs);
    return await fn(page);
  } finally {
    if (context) await context.close().catch(() => {});
    release();
  }
}
