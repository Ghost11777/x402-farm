import { Router } from "express";
import { CATALOG } from "../catalog.js";

const router = Router();

// Sert l'agent SMS du téléphone (installation Termux en une ligne). Public.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
router.get("/phone-agent.sh", (_req, res) => {
  try {
    const f = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "phone-agent", "agent.sh");
    res.type("text/x-shellscript").send(readFileSync(f, "utf8"));
  } catch { res.status(404).send("# agent not found"); }
});
const PAY_TO = process.env.PAY_TO || "";
const NETWORKS = (process.env.NETWORKS || "eip155:8453,eip155:137,eip155:42161").split(",").map((s) => s.trim());

function baseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

// Nom d'outil/skill stable dérivé de la route (ex: /v1/fr/entreprise -> fr_entreprise)
const toolName = (path) => path.replace(/^\/v1\//, "").replace(/\//g, "_");
const inputKeys = (e) => Object.keys(e.bazaar?.input || {});

// Format standard lu par les LLM/agents pour découvrir un site
router.get("/llms.txt", (req, res) => {
  const base = baseUrl(req);
  const lines = [
    "# x402-farm",
    "",
    `> ${CATALOG.length} pay-per-call APIs for AI agents. **The rare capability you can't get elsewhere: a real MOBILE 4G proxy on a France/Guadeloupe carrier IP (Orange, AS16028)** — the hardest class of IP to block, and a France/DOM geo almost no provider offers. Dedicated port from $75/mo (up to 100 GB) or metered from $5/GB — /v1/proxy/port/30d · /v1/mobile-proxy/1gb. Also a **residential proxy by the GB** (from $3/GB, cheaper than Browserbase/Bright Data) and **residential-IP scraping** that reaches sites blocking datacenter/cloud IPs (Firecrawl/ScrapingBee territory, a fraction of the price). Plus token honeypot/rug-pull security checks, an **agent input-firewall** (prompt-injection/scam guard), cheap LLM inference, and deep global company data (US SEC EDGAR, UK Companies House, FR SIREN/KYB). x402 (USDC on **Base or Solana**), no account, no API key.`,
    "",
    `Machine-readable catalog: ${base}/ (JSON) and ${base}/openapi.json`,
    `Discovery: ${base}/.well-known/x402 · ${base}/.well-known/mcp · ${base}/.well-known/agent-skills.json`,
    "Free previews (no payment): see /free/* routes below.",
    "",
    "## Quickstart — first paid call in 60 seconds",
    "Any x402 client works. With @x402/fetch (Node, a funded USDC wallet on Base):",
    "```js",
    'import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";',
    'import { ExactEvmScheme } from "@x402/evm";',
    'import { privateKeyToAccount } from "viem/accounts";',
    'const f = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(privateKeyToAccount(PRIVATE_KEY)) }] });',
    `const r = await f("${base}/v1/weather?city=Paris"); // $0.003, settled on-chain`,
    "console.log(await r.json());",
    "```",
    "Cheapest probes: GET /v1/weather ($0.003) · /v1/crypto/price ($0.003) · /v1/dns ($0.005).",
    "All /v1 routes accept BOTH GET (query params) and POST (JSON body).",
    "Every 402 response includes `alternatives` (cheaper /partial version, free trial) when available.",
    "",
    "## Residential-IP scraping (rare on x402)",
    "extract / render / screenshot / pdf / links / meta run on a real Chromium behind a FRENCH",
    "RESIDENTIAL IP — not a datacenter. They reach pages that block AWS/GCP/cloud ranges and",
    "geo-restricted FR content, the same job Firecrawl/ScrapingBee charge much more for.",
    "Example: POST /v1/extract {\"url\":\"https://…\"} ($0.005) -> clean markdown. Works via GET too.",
    "",
    "## Cheapest LLM + search on x402",
    "POST /v1/llm {\"prompt\":\"…\"} ($0.002, DeepSeek v4) — among the lowest $/call anywhere.",
    "POST /v1/llm/pro ($0.006) for hard reasoning. GET /v1/search?q= ($0.003) real Google results.",
    "GET /v1/search/news?q= ($0.003) fresh headlines. First daily call is free on all of these.",
    "",
    "## Agent workflow — FR company due diligence in 3 calls (~$0.16)",
    "1. GET /v1/fr/kyb/partial?q=<name> ($0.03) -> verdict + red-flag count. Stop if CONFORME and 0 flags.",
    "2. GET /v1/fr/procedures-collectives?siren= ($0.03) -> insolvency history if flags > 0.",
    "3. GET /v1/fr/kyb?siren= ($0.10) -> full dossier (officers, financials, VIES VAT) for the final report.",
    "",
    "## Paid endpoints",
    ...CATALOG.map((e) => `- ${e.route} (${e.price}): ${e.desc}`),
    "",
    "## Free previews",
    `- POST /free/extract {url}: first 300 chars of the markdown extraction (full: POST /v1/extract)`,
    `- GET /free/entreprise?q=: first French company result, reduced fields (full: GET /v1/fr/entreprise)`,
    `- GET /free/entreprise-360?q=: company identity only (full 360 report: GET /v1/fr/entreprise-360)`,
    `- GET /free/estimation-immo?adresse=: commune median €/m² only (full AVM: GET /v1/fr/estimation-immo)`,
    "",
    "## How to pay",
    "Any x402-compatible client works (@x402/fetch, x402-requests…). Call the endpoint, receive HTTP 402 with the PAYMENT-REQUIRED header, sign the USDC payment, retry. Median cost: $0.005-0.02 per call.",
  ];
  res.type("text/plain").send(lines.join("\n"));
});

// OpenAPI 3.1 minimal généré depuis le catalogue
router.get("/openapi.json", (req, res) => {
  const base = baseUrl(req);
  const paths = {};
  for (const e of CATALOG) {
    const [method, path] = e.route.split(" ");
    const isPost = method === "POST";
    const priceUsd = parseFloat(String(e.price).replace(/[^0-9.]/g, "")) || 0;
    paths[path] = {
      [method.toLowerCase()]: {
        summary: e.desc,
        description: `${e.desc} — Price: ${e.price} per call via x402 (USDC on Base). Unpaid requests get HTTP 402 with payment instructions in the PAYMENT-REQUIRED header.`,
        ...(isPost
          ? {
              requestBody: {
                content: {
                  "application/json": {
                    schema: { type: "object", properties: { url: { type: "string", format: "uri" } }, required: ["url"] },
                    example: e.bazaar?.input || { url: "https://example.com" },
                  },
                },
              },
            }
          : {
              parameters: Object.keys(e.bazaar?.input || {}).map((name) => ({
                name, in: "query", required: true, schema: { type: "string" }, example: e.bazaar.input[name],
              })),
            }),
        responses: {
          200: { description: "Success", ...(e.bazaar?.output?.example ? { content: { "application/json": { example: e.bazaar.output.example } } } : {}) },
          402: { description: "Payment required (x402 — see PAYMENT-REQUIRED response header)" },
        },
        "x-payment-info": {
          protocols: [{ x402: {} }],
          price: { mode: "fixed", currency: "USDC", amount: priceUsd },
        },
      },
    };
  }
  res.json({
    openapi: "3.1.0",
    info: {
      title: "x402-farm — pay-per-call data & security tools for AI agents",
      version: "1.0.0",
      description: "Pay-per-call APIs for AI agents — x402 protocol, USDC on Base, no account needed.",
      "x-guidance":
        "Each route is a named job at a fixed USDC price (see per-operation x-payment-info). Unpaid requests return HTTP 402 with x402 payment instructions. Highest-value jobs: GET /v1/crypto/security (honeypot / rug-pull verdict OK/CAUTION/HIGH_RISK/AVOID before trading, 8 chains), POST /v1/extract (residential-IP web scraping — reaches sites blocking datacenter/cloud IPs, returns clean markdown), GET /v1/fr/kyb (company KYB / SIREN), GET /v1/crypto/token (live token price & liquidity), and GET /v1/proxy/1gb|5gb|20gb (buy a RESIDENTIAL PROXY by the GB — route your HTTP/HTTPS traffic through a real residential IP that datacenter proxies can't match; returns a ready-to-use proxy key, from $2/GB, cheaper than Browserbase/Bright Data). Pay per call, no subscription, no API key.",
      contact: { email: "laurenthalbrun@gmail.com" },
    },
    servers: [{ url: base }],
    paths,
  });
});

// ===== /.well-known/x402 : manifeste de service x402 (lu par crawlers/agents) =====
router.get("/.well-known/x402", (req, res) => {
  const base = baseUrl(req);
  res.json({
    x402Version: 2,
    name: "x402-farm",
    description:
      "Pay-per-call APIs for AI agents. Rare capability: a real MOBILE 4G proxy on a France/Guadeloupe carrier IP (Orange, AS16028) — hardest IP class to block, dedicated port from $75/mo or metered from $5/GB. Plus residential proxy & residential-IP scraping (bypasses datacenter blocks), token security/honeypot checks, an agent input-firewall, cheap LLM inference, and global company data (US/UK/FR). USDC on Base or Solana, no account, no API key.",
    payment: { protocol: "x402", networks: NETWORKS, asset: "USDC", payTo: PAY_TO },
    discovery: {
      catalog: `${base}/`,
      openapi: `${base}/openapi.json`,
      llms: `${base}/llms.txt`,
      mcp: `${base}/.well-known/mcp`,
      agentSkills: `${base}/.well-known/agent-skills.json`,
    },
    resources: CATALOG.map((e) => {
      const [method, path] = e.route.split(" ");
      return { name: toolName(path), method, url: `${base}${path}`, price: e.price, description: e.desc };
    }),
  });
});

// ===== /.well-known/agent-skills.json : manifeste "agent skills" =====
router.get("/.well-known/agent-skills.json", (req, res) => {
  const base = baseUrl(req);
  res.json({
    schemaVersion: 1,
    name: "x402-farm",
    description: "Skills backed by pay-per-call x402 endpoints (USDC on Base). Each skill = one HTTP call, priced per request.",
    skills: CATALOG.map((e) => {
      const [method, path] = e.route.split(" ");
      return {
        name: toolName(path),
        description: e.desc,
        invocation: { type: "http", method, url: `${base}${path}` },
        input: e.bazaar?.input || {},
        pricing: { amount: e.price, currency: "USDC", protocol: "x402", networks: NETWORKS },
      };
    }),
  });
});

// ===== /.well-known/mcp : server-card MCP (chaque outil = un endpoint payant x402) =====
router.get("/.well-known/mcp", (req, res) => {
  const base = baseUrl(req);
  res.json({
    name: "x402-farm",
    registryName: "online.x-402/mcp",
    registry: "https://registry.modelcontextprotocol.io/v0/servers?search=x-402",
    version: "1.0.0",
    description:
      "MCP server-card. Live JSON-RPC 2.0 endpoint (Streamable HTTP) at /mcp exposing all tools. Tools are pay-per-call via x402 (USDC): call a tool, receive the x402 requirements in _meta, sign, retry with the X-PAYMENT header on POST /mcp.",
    endpoint: `${base}/mcp`,
    transport: { type: "streamable-http", protocol: "jsonrpc-2.0", payment: "x402", networks: NETWORKS },
    tools: CATALOG.map((e) => {
      const [method, path] = e.route.split(" ");
      return {
        name: toolName(path),
        description: `${e.desc} (${e.price}/call via x402)`,
        inputSchema: {
          type: "object",
          properties: Object.fromEntries(inputKeys(e).map((k) => [k, { type: "string" }])),
          required: method === "GET" ? inputKeys(e) : undefined,
        },
        endpoint: { method, url: `${base}${path}`, price: e.price },
      };
    }),
  });
});

export default router;
