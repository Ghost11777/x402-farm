#!/usr/bin/env node
// Serveur MCP x402-farm : expose les 10 APIs comme tools pour Claude/Cursor/etc.
// Les appels payants sont réglés automatiquement en USDC via x402 depuis le wallet
// configuré (env X402_PRIVATE_KEY). Sans clé : seuls les tools free/* fonctionnent.
//
// Config client MCP :
//   { "command": "node", "args": ["<chemin>/mcp/index.js"],
//     "env": { "X402_PRIVATE_KEY": "0x…", "X402_FARM_URL": "https://x402-farm.vercel.app" } }
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.X402_FARM_URL || "https://x402-farm.vercel.app";
const PK = process.env.X402_PRIVATE_KEY;
const NETWORK = process.env.X402_NETWORK || "eip155:8453";

let payFetch = fetch;
if (PK) {
  const [{ wrapFetchWithPaymentFromConfig }, { ExactEvmScheme }, { privateKeyToAccount }] = await Promise.all([
    import("@x402/fetch"),
    import("@x402/evm"),
    import("viem/accounts"),
  ]);
  payFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: NETWORK, client: new ExactEvmScheme(privateKeyToAccount(PK)) }],
  });
}

const server = new McpServer({ name: "x402-farm", version: "1.0.0" });

async function callJson(path, init) {
  const r = await payFetch(`${BASE}${path}`, init);
  const text = await r.text();
  if (!r.ok) {
    const hint = r.status === 402 ? " (payment required — set X402_PRIVATE_KEY with a funded Base USDC wallet)" : "";
    return { content: [{ type: "text", text: `HTTP ${r.status}${hint}: ${text.slice(0, 400)}` }], isError: true };
  }
  return { content: [{ type: "text", text: text.slice(0, 50_000) }] };
}

const post = (path, url, extra = {}) =>
  callJson(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, ...extra }) });

const urlArg = { url: z.string().url().describe("Public http(s) URL") };

server.registerTool("extract", {
  description: "Extract the main content of a web page as clean markdown (JS-rendered, real browser). $0.005/call via x402.",
  inputSchema: urlArg,
}, ({ url }) => post("/v1/extract", url));

server.registerTool("render", {
  description: "Get the full HTML of a page after JavaScript execution. $0.005/call.",
  inputSchema: urlArg,
}, ({ url }) => post("/v1/render", url));

server.registerTool("screenshot", {
  description: "PNG screenshot of a web page. Returns base64 image. $0.01/call.",
  inputSchema: { ...urlArg, fullPage: z.boolean().optional() },
}, async ({ url, fullPage }) => {
  const r = await payFetch(`${BASE}/v1/screenshot`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, fullPage }),
  });
  if (!r.ok) return { content: [{ type: "text", text: `HTTP ${r.status}` }], isError: true };
  const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
  return { content: [{ type: "image", data: b64, mimeType: "image/png" }] };
});

server.registerTool("links", {
  description: "All deduplicated links of a page, classified internal/external with anchor text. $0.005/call.",
  inputSchema: urlArg,
}, ({ url }) => post("/v1/links", url));

server.registerTool("page_meta", {
  description: "SEO meta, OpenGraph, canonical and JSON-LD of a page. $0.005/call.",
  inputSchema: urlArg,
}, ({ url }) => post("/v1/meta", url));

server.registerTool("french_company", {
  description: "Look up French companies by name or SIREN/SIRET: officers, NAF code, HQ address, status. $0.02/call.",
  inputSchema: { q: z.string().describe("Company name or SIREN/SIRET") },
}, ({ q }) => callJson(`/v1/fr/entreprise?q=${encodeURIComponent(q)}`));

server.registerTool("french_geocode", {
  description: "Geocode any French address including overseas territories (lat/lon + score). $0.005/call.",
  inputSchema: { q: z.string().describe("Address or place name in France/DOM") },
}, ({ q }) => callJson(`/v1/fr/geocode?q=${encodeURIComponent(q)}`));

server.registerTool("dns_records", {
  description: "Full DNS records of a domain: A, AAAA, MX, TXT, NS, SPF. $0.005/call.",
  inputSchema: { domain: z.string().describe("Domain name, e.g. example.com") },
}, ({ domain }) => callJson(`/v1/dns?domain=${encodeURIComponent(domain)}`));

server.registerTool("email_validate", {
  description: "Validate an email address: syntax + domain MX check (no email sent). $0.005/call.",
  inputSchema: { email: z.string().describe("Email address to validate") },
}, ({ email }) => callJson(`/v1/email/validate?email=${encodeURIComponent(email)}`));

server.registerTool("free_preview_extract", {
  description: "FREE preview: first 300 chars of a page's text content (static fetch, no payment needed).",
  inputSchema: urlArg,
}, ({ url }) => post("/free/extract", url));

await server.connect(new StdioServerTransport());
