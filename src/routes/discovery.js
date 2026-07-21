import { Router } from "express";
import { CATALOG } from "../catalog.js";

const router = Router();

function baseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

// Format standard lu par les LLM/agents pour découvrir un site
router.get("/llms.txt", (req, res) => {
  const base = baseUrl(req);
  const lines = [
    "# x402-farm",
    "",
    "> 10 pay-per-call APIs for AI agents. Payment: x402 protocol (USDC on Base, eip155:8453). No account, no API key — pay per request.",
    "",
    `Machine-readable catalog: ${base}/ (JSON) and ${base}/openapi.json`,
    "Free previews (no payment): see /free/* routes below.",
    "",
    "## Paid endpoints",
    ...CATALOG.map((e) => `- ${e.route} (${e.price}): ${e.desc}`),
    "",
    "## Free previews",
    `- POST /free/extract {url}: first 300 chars of the markdown extraction (full: POST /v1/extract)`,
    `- GET /free/entreprise?q=: first French company result, reduced fields (full: GET /v1/fr/entreprise)`,
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

export default router;
