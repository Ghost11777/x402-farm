import { Router } from "express";
import TurndownService from "turndown";
import { withPage } from "../lib/browser.js";
import { assertPublicUrl } from "../lib/guard.js";
import { cached } from "../lib/cache.js";

const router = Router();
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
turndown.remove(["script", "style", "noscript", "iframe"]);

function getUrlParam(req) {
  const raw = req.method === "GET" ? req.query.url : req.body?.url;
  if (!raw) throw Object.assign(new Error("missing_url"), { status: 400 });
  return raw;
}

async function handle(req, res, fn) {
  try {
    const url = await assertPublicUrl(getUrlParam(req));
    await fn(url);
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || "upstream_error" });
  }
}

// URL -> markdown propre (contenu principal, sans nav/pub)
router.post("/v1/extract", (req, res) =>
  handle(req, res, async (url) => {
    const data = await cached(`extract:${url}`, 10 * 60_000, () =>
      withPage(url.href, async (page) => {
        const result = await page.evaluate(() => {
          const pick =
            document.querySelector("article") ||
            document.querySelector("main") ||
            document.querySelector('[role="main"]') ||
            document.body;
          for (const sel of ["nav", "header", "footer", "aside", ".cookie", "#cookie"]) {
            pick.querySelectorAll(sel).forEach((n) => n.remove());
          }
          return { title: document.title, html: pick.innerHTML, lang: document.documentElement.lang || null };
        });
        return {
          url: url.href,
          title: result.title,
          lang: result.lang,
          markdown: turndown.turndown(result.html).replace(/\n{3,}/g, "\n\n").trim(),
        };
      })
    );
    res.json(data);
  })
);

// URL -> HTML complet après exécution du JS
router.post("/v1/render", (req, res) =>
  handle(req, res, async (url) => {
    const data = await cached(`render:${url}`, 10 * 60_000, () =>
      withPage(url.href, async (page) => ({ url: url.href, html: await page.content() }))
    );
    res.json(data);
  })
);

// URL -> capture PNG (binaire)
router.post("/v1/screenshot", (req, res) =>
  handle(req, res, async (url) => {
    const fullPage = req.body?.fullPage === true;
    const buf = await withPage(url.href, (page) => page.screenshot({ fullPage, type: "png" }), { fullPage });
    res.type("png").send(buf);
  })
);

// URL -> PDF (binaire)
router.post("/v1/pdf", (req, res) =>
  handle(req, res, async (url) => {
    const buf = await withPage(url.href, (page) => page.pdf({ format: "A4", printBackground: true }));
    res.type("application/pdf").send(buf);
  })
);

// URL -> liens classés interne/externe avec ancres
router.post("/v1/links", (req, res) =>
  handle(req, res, async (url) => {
    const data = await cached(`links:${url}`, 10 * 60_000, () =>
      withPage(url.href, async (page) => {
        const links = await page.evaluate(() =>
          [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: a.textContent.trim().slice(0, 200) }))
        );
        const origin = url.origin;
        const seen = new Set();
        const internal = [], external = [];
        for (const l of links) {
          if (!l.href.startsWith("http") || seen.has(l.href)) continue;
          seen.add(l.href);
          (l.href.startsWith(origin) ? internal : external).push(l);
        }
        return { url: url.href, count: seen.size, internal, external };
      })
    );
    res.json(data);
  })
);

// URL -> métadonnées SEO / OpenGraph / JSON-LD
router.post("/v1/meta", (req, res) =>
  handle(req, res, async (url) => {
    const data = await cached(`meta:${url}`, 30 * 60_000, () =>
      withPage(url.href, async (page) =>
        page.evaluate(() => {
          const meta = {};
          document.querySelectorAll("meta[name],meta[property]").forEach((m) => {
            meta[m.getAttribute("name") || m.getAttribute("property")] = m.getAttribute("content");
          });
          const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
            .map((s) => { try { return JSON.parse(s.textContent); } catch { return null; } })
            .filter(Boolean);
          return {
            title: document.title,
            canonical: document.querySelector('link[rel="canonical"]')?.href || null,
            meta, jsonLd,
          };
        })
      )
    );
    res.json({ url: url.href, ...data });
  })
);

export default router;
