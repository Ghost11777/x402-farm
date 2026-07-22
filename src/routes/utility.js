import { Router } from "express";
import { cached } from "../lib/cache.js";

// Utilitaires "besoin quotidien des agents" (catégorie prouvée par le radar :
// c'est ce que les bots consomment en volume). Upstreams gratuits ou à clé.
const router = Router();
const q = (req, n) => (req.query[n] || "").toString().trim();

async function getJson(url, opts = {}, t = 10_000) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(t) });
  if (!r.ok) throw Object.assign(new Error(`upstream_${r.status}`), { status: 502 });
  return r.json();
}

// ===== /v1/weather : météo mondiale (open-meteo, sans clé) =====
router.all("/v1/weather", async (req, res) => {
  let lat = Number(q(req, "lat")), lon = Number(q(req, "lon"));
  const city = q(req, "city");
  try {
    if ((!lat || !lon) && city) {
      const g = await cached(`geo:${city.toLowerCase()}`, 7 * 24 * 3600_000, () =>
        getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`));
      const hit = g.results?.[0];
      if (!hit) return res.status(404).json({ error: "city_not_found", city });
      lat = hit.latitude; lon = hit.longitude;
    }
    if (!lat || !lon) return res.status(400).json({ error: "missing_lat_lon_or_city" });
    const w = await cached(`wx:${lat.toFixed(2)}:${lon.toFixed(2)}`, 15 * 60_000, () =>
      getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m,weather_code` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&forecast_days=3&timezone=auto`));
    res.json({ lat, lon, ...(city ? { city } : {}), current: w.current, daily: w.daily,
      units: { temperature: "°C", wind: "km/h", precipitation: "mm" }, source: "open-meteo" });
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "weather_failed" }); }
});

// ===== /v1/crypto/price : prix spot multi-tokens (CoinGecko, sans clé, cache 60 s) =====
router.all("/v1/crypto/price", async (req, res) => {
  const ids = (q(req, "ids") || "bitcoin,ethereum").toLowerCase().replace(/[^a-z0-9,-]/g, "").slice(0, 200);
  const vs = (q(req, "vs") || "usd").toLowerCase().replace(/[^a-z,]/g, "").slice(0, 40);
  try {
    const data = await cached(`cg:${ids}:${vs}`, 60_000, () =>
      getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vs}&include_24hr_change=true`));
    if (!Object.keys(data).length) return res.status(404).json({ error: "unknown_ids", hint: "use CoinGecko ids: bitcoin, ethereum, solana, usd-coin…" });
    res.json({ prices: data, source: "coingecko", cached_seconds: 60 });
  } catch (e) { res.status(e.status || 502).json({ error: e.message || "price_failed" }); }
});

// ===== /v1/search : recherche web (Serper.dev, activée par SERPER_API_KEY) =====
if (process.env.SERPER_API_KEY) {
  router.all("/v1/search", async (req, res) => {
    const query = q(req, "q");
    if (!query) return res.status(400).json({ error: "missing_q" });
    try {
      const d = await cached(`serp:${query.toLowerCase()}:${q(req, "gl") || "us"}`, 3600_000, () =>
        getJson("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": process.env.SERPER_API_KEY, "content-type": "application/json" },
          body: JSON.stringify({ q: query, gl: q(req, "gl") || undefined, hl: q(req, "hl") || undefined, num: 10 }),
        }));
      res.json({
        query,
        results: (d.organic || []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet, position: r.position })),
        answer_box: d.answerBox || null, knowledge_graph: d.knowledgeGraph ? { title: d.knowledgeGraph.title, type: d.knowledgeGraph.type, description: d.knowledgeGraph.description } : null,
        related: (d.relatedSearches || []).map((r) => r.query).slice(0, 5),
      });
    } catch (e) { res.status(e.status || 502).json({ error: e.message || "search_failed" }); }
  });
}

// ===== /v1/llm : inférence LLM pay-per-call (activée par OPENAI_API_KEY) =====
if (process.env.OPENAI_API_KEY) {
  router.all("/v1/llm", async (req, res) => {
    const prompt = (req.body?.prompt || q(req, "prompt") || "").toString().slice(0, 8000);
    if (!prompt) return res.status(400).json({ error: "missing_prompt" });
    const system = (req.body?.system || q(req, "system") || "").toString().slice(0, 2000);
    const maxTokens = Math.min(Number(req.body?.max_tokens || q(req, "max_tokens")) || 1000, 2000);
    try {
      const d = await getJson("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || "gpt-5-mini",
          messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
          max_completion_tokens: maxTokens,
        }),
      }, 60_000);
      res.json({ output: d.choices?.[0]?.message?.content ?? null, model: d.model,
        usage: d.usage ? { input_tokens: d.usage.prompt_tokens, output_tokens: d.usage.completion_tokens } : null });
    } catch (e) { res.status(e.status || 502).json({ error: e.message || "llm_failed" }); }
  });
}

export default router;
