// Serveur MCP (Model Context Protocol) — transport Streamable HTTP, JSON-RPC 2.0.
// Chaque outil = un endpoint payant de la ferme. Le paiement x402 est RELAYÉ :
//   1. tools/call sans paiement -> on renvoie les exigences x402 dans _meta (le client signe)
//   2. tools/call avec l'en-tête X-PAYMENT sur la requête /mcp -> on le transfère à l'endpoint,
//      qui règle via le facilitateur, et on renvoie la donnée.
// Ainsi on réutilise les routes existantes (aucune logique dupliquée).
import { Router } from "express";
import { CATALOG } from "../catalog.js";

const router = Router();
const PROTOCOL_VERSION = "2024-11-05";

// name (fr_entreprise) -> { method, path, e }
const TOOLS = new Map();
for (const e of CATALOG) {
  const [method, path] = e.route.split(" ");
  TOOLS.set(path.replace(/^\/v1\//, "").replace(/\//g, "_"), { method, path, e });
}

const inputSchema = (e, method) => {
  const keys = Object.keys(e.bazaar?.input || {});
  return {
    type: "object",
    properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
    ...(method === "GET" && keys.length ? { required: keys } : {}),
  };
};
const toolList = () =>
  [...TOOLS].map(([name, { method, e }]) => ({
    name,
    description: `${e.desc} — ${e.price}/call, paid per request via x402 (USDC).`,
    inputSchema: inputSchema(e, method),
  }));

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function callEndpoint(base, tool, args, pay, clientIp) {
  const { method, path } = tool;
  let url = `${base}${path}`;
  const init = { method, headers: clientIp ? { "x-forwarded-for": clientIp } : {}, signal: AbortSignal.timeout(40000) };
  if (pay?.value) init.headers[pay.name] = pay.value; // x402 v2 = PAYMENT-SIGNATURE, v1 = X-PAYMENT
  if (method === "GET") {
    const qs = Object.entries(args || {})
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    if (qs) url += `?${qs}`;
  } else {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(args || {});
  }
  const r = await fetch(url, init);
  return {
    status: r.status,
    body: await r.text(),
    paymentRequired: r.headers.get("payment-required"),
    paymentResponse: r.headers.get("payment-response") || r.headers.get("x-payment-response"),
  };
}

async function handle(msg, base, pay, clientIp) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;
  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "x402-farm", version: "1.0.0" },
        instructions:
          "Pay-per-call tools via x402 (USDC on Base/Polygon/Arbitrum). Call a tool without payment to get the x402 requirements in _meta.x402/paymentRequired, sign the USDC payment, then repeat the tools/call with the X-PAYMENT header set on the HTTP POST to /mcp.",
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notification: pas de réponse
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: toolList() });
    case "tools/call": {
      const tool = TOOLS.get(params?.name);
      if (!tool) return err(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const r = await callEndpoint(base, tool, params?.arguments || {}, pay, clientIp);
        if (r.status === 402) {
          let reqs = null;
          try {
            reqs = r.paymentRequired ? JSON.parse(Buffer.from(r.paymentRequired, "base64").toString("utf8")) : null;
          } catch {}
          return ok(id, {
            content: [
              {
                type: "text",
                text: `Payment required: ${tool.e.price} for ${params.name}. Sign the USDC x402 payment for the requirements in _meta["x402/paymentRequired"], then retry this tools/call with the X-PAYMENT header on your POST /mcp.`,
              },
            ],
            isError: true,
            _meta: { "x402/paymentRequired": reqs, "x402/paymentRequiredHeader": r.paymentRequired },
          });
        }
        if (r.status >= 200 && r.status < 300) {
          return ok(id, {
            content: [{ type: "text", text: r.body }],
            ...(r.paymentResponse ? { _meta: { "x402/paymentResponse": r.paymentResponse } } : {}),
          });
        }
        return ok(id, {
          content: [{ type: "text", text: `Upstream error ${r.status}: ${r.body.slice(0, 300)}` }],
          isError: true,
        });
      } catch (e) {
        return err(id, -32603, `Tool execution failed: ${String(e).slice(0, 200)}`);
      }
    }
    default:
      return isNotification ? null : err(id, -32601, `Method not found: ${method}`);
  }
}

// Transport Streamable HTTP : POST porte les messages JSON-RPC (uniques ou en lot).
router.post("/mcp", async (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  // x402 v2 envoie PAYMENT-SIGNATURE ; v1 envoie X-PAYMENT. On lit et re-forwarde le bon nom.
  const pay = req.get("payment-signature")
    ? { name: "PAYMENT-SIGNATURE", value: req.get("payment-signature") }
    : req.get("x-payment")
      ? { name: "X-PAYMENT", value: req.get("x-payment") }
      : null;
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip;
  const body = req.body;
  try {
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handle(m, base, pay, clientIp)))).filter((r) => r !== null);
      return out.length ? res.json(out) : res.status(202).end();
    }
    const result = await handle(body, base, pay, clientIp);
    return result === null ? res.status(202).end() : res.json(result);
  } catch {
    return res.json(err(body?.id ?? null, -32700, "Parse error"));
  }
});

// Pas de flux server-initiated : GET -> 405 (compatible spec).
router.get("/mcp", (_req, res) =>
  res.set("Allow", "POST").status(405).json({ error: "MCP over HTTP: use POST with JSON-RPC 2.0. Server-initiated SSE not supported." })
);

export default router;
