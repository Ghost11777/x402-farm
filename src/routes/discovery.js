import { Router } from "express";
import { CATALOG } from "../catalog.js";

const router = Router();
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
    `> ${CATALOG.length} pay-per-call APIs for AI agents — the deepest 🇫🇷 French business & open-data coverage in x402 (company/SIREN-SIRET, KYB, financial score, real-estate AVM, BODACC, cadastre, DVF, INSEE), plus 🇬🇧 UK Companies House, 🇺🇸 SEC EDGAR, and web tooling. x402 (USDC on Base/Polygon/Arbitrum), no account, no API key.`,
    "",
    `Machine-readable catalog: ${base}/ (JSON) and ${base}/openapi.json`,
    `Discovery: ${base}/.well-known/x402 · ${base}/.well-known/mcp · ${base}/.well-known/agent-skills.json`,
    "Free previews (no payment): see /free/* routes below.",
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
      },
    };
  }
  res.json({
    openapi: "3.1.0",
    info: {
      title: "x402-farm",
      version: "1.0.0",
      description: "Pay-per-call APIs for AI agents — x402 protocol, USDC on Base, no account needed.",
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
      "Pay-per-call data & web APIs for AI agents — French/UK/US company data, KYB, real-estate AVM, SEC EDGAR & Companies House, web extraction. USDC on Base/Polygon/Arbitrum, no account, no API key.",
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
