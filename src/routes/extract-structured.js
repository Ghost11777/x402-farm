// /v1/extract-structured — the flagship agent product: URL + wanted fields -> clean JSON.
// Combines our two moats: residential scraping (mini) + cheap LLM (DeepSeek).
// The agent says "get {price, stock, rating} from this page" and gets structured data back.
// Query/body: url (required), fields (comma list or array) OR schema (free-text description).
import { Router } from "express";
import { extractViaWorker } from "../lib/worker-proxy.js";

const router = Router();
const LLM_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
const LLM_BASE = process.env.LLM_BASE_URL || (process.env.LLM_API_KEY ? "https://api.deepseek.com" : "https://api.openai.com");
const LLM_MODEL = process.env.LLM_MODEL || (process.env.LLM_API_KEY ? "deepseek-chat" : "gpt-5-mini");

// Récupère le markdown : mini résidentiel d'abord, repli fetch+strip si worker absent.
async function pageMarkdown(url) {
  try {
    const { markdown, servedBy } = await extractViaWorker(url);
    if (markdown) return { text: markdown, servedBy };
  } catch { /* repli */ }
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 x402-farm" }, signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return { text, servedBy: null };
}

function parseJson(s) {
  if (!s) return null;
  let t = s.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/[{[][\s\S]*[}\]]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

router.all("/v1/extract-structured", async (req, res) => {
  if (!LLM_KEY) return res.status(503).json({ error: "llm_unconfigured" });
  const p = { ...req.query, ...(req.body || {}) };
  const url = p.url;
  if (!url || !/^https?:\/\//.test(String(url))) return res.status(400).json({ error: "missing_url", hint: "provide ?url=https://..." });

  // Champs voulus : liste ("price,stock,rating") ou schéma libre ("un objet avec price(number), inStock(bool)").
  let fields = p.fields;
  if (Array.isArray(fields)) fields = fields.join(", ");
  const schema = p.schema || "";
  const instruction = schema
    ? `Return JSON matching this shape/description: ${String(schema).slice(0, 1000)}`
    : fields
      ? `Return a JSON object with exactly these fields: ${String(fields).slice(0, 500)}. Use null when a field is absent.`
      : `Return the most useful structured JSON object describing the main entity on the page.`;

  try {
    const { text, servedBy } = await pageMarkdown(String(url));
    if (!text) return res.status(502).json({ error: "empty_page" });
    const content = text.slice(0, 9000);
    const prompt = `You are a precise web data extractor. From the page content below, extract data as STRICT JSON only (no prose, no markdown fences). ${instruction}\n\n--- PAGE CONTENT ---\n${content}`;
    const r = await fetch(`${LLM_BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${LLM_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: "You output only valid JSON. No explanations." },
          { role: "user", content: prompt },
        ],
        max_tokens: 1200,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(90000),
    });
    const d = await r.json();
    const raw = d.choices?.[0]?.message?.content ?? null;
    const data = parseJson(raw);
    if (data == null) return res.status(502).json({ error: "extraction_failed", raw: raw ? String(raw).slice(0, 300) : null });
    res.set("x-served-by", servedBy || "vercel");
    res.json({ url, data, servedBy: servedBy || "vercel-fallback" });
  } catch (e) {
    res.status(502).json({ error: "extract_structured_failed", detail: String(e).slice(0, 160) });
  }
});

export default router;
