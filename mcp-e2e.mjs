import { readFileSync } from "node:fs";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const BASE = "https://api.x-402.online", NETWORK = "eip155:8453";
const pk = readFileSync(".buyer.secret","utf8").match(/BUYER_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)[1];
const account = privateKeyToAccount(pk);
const client = x402Client.fromConfig({ schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }] });
const httpClient = new x402HTTPClient(client);

// 1) 402 réel de l'endpoint sous-jacent
const r = await fetch(`${BASE}/v1/dns?domain=cloudflare.com`);
let body; const t = await r.text(); try { body = t ? JSON.parse(t) : undefined; } catch {}
const paymentRequired = httpClient.getPaymentRequiredResponse((n)=>r.headers.get(n), body);
console.log("1) endpoint 402:", r.status);
// 2) signer X-PAYMENT
const payload = await client.createPaymentPayload(paymentRequired);
const headers = httpClient.encodePaymentSignatureHeader(payload);
console.log("2) X-PAYMENT signé:", Object.keys(headers).join(","));
// 3) tools/call via /mcp AVEC X-PAYMENT
const res = await fetch(`${BASE}/mcp`, { method:"POST",
  headers:{ "content-type":"application/json", ...headers },
  body: JSON.stringify({ jsonrpc:"2.0", id:1, method:"tools/call", params:{ name:"dns", arguments:{ domain:"cloudflare.com" } } }) });
const j = await res.json();
console.log("3) MCP isError:", j.result?.isError ?? false);
console.log("   data:", (j.result?.content?.[0]?.text||JSON.stringify(j)).slice(0,140));
const pr = j.result?._meta?.["x402/paymentResponse"];
if (pr) { try { const d = JSON.parse(Buffer.from(pr,"base64").toString()); console.log("   ✅ RÉGLÉ ON-CHAIN via MCP — tx:", d.transaction); } catch { console.log("   paymentResponse:", pr.slice(0,60)); } }
else console.log("   (pas d'en-tête settlement remonté, mais data reçue = paiement passé)");
