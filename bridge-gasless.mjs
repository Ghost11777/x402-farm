// Bridge gasless Ethereum -> Base via relay.link (EIP-3009 ReceiveWithAuthorization).
// Le wallet acheteur n'a pas d'ETH : on signe une autorisation off-chain, le relayeur
// avance le gas et livre l'USDC sur Base. Aucun gas payé par nous.
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

const pk = readFileSync(".buyer.secret", "utf8").match(/BUYER_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)[1];
const account = privateKeyToAccount(pk);

const AMOUNT = process.argv[2] || "15000000"; // 6 décimales -> 15 USDC par défaut
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

console.log(`Wallet ${account.address} — bridge ${Number(AMOUNT)/1e6} USDC  Ethereum -> Base (gasless)\n`);

// 1) Devis frais en mode gasless (usePermit)
const quoteRes = await fetch("https://api.relay.link/quote", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    user: account.address, recipient: account.address,
    originChainId: 1, destinationChainId: 8453,
    originCurrency: USDC_ETH, destinationCurrency: USDC_BASE,
    amount: AMOUNT, tradeType: "EXACT_INPUT",
    usePermit: true, explicitDeposit: true,
  }),
});
const quote = await quoteRes.json();
if (!quote.steps) { console.error("Pas de devis:", JSON.stringify(quote).slice(0, 400)); process.exit(1); }

const sigStep = quote.steps.find((s) => s.kind === "signature");
if (!sigStep) { console.error("Pas d'étape signature — mode gasless indisponible."); process.exit(1); }
const item = sigStep.items[0].data;
const out = quote.details?.currencyOut?.amountFormatted;
console.log(`Reçu estimé sur Base : ${out} USDC (frais relayeur ~${quote.fees?.relayer?.amountFormatted} USDC)\n`);

// 2) Signer l'EIP-712 fourni par relay
const sign = item.sign;
const types = { ...sign.types }; // ReceiveWithAuthorization
delete types.EIP712Domain; // viem ajoute le domain lui-même
const signature = await account.signTypedData({
  domain: sign.domain,
  types,
  primaryType: sign.primaryType,
  message: sign.value || sign.message,
});
console.log("Autorisation signée (aucun gas).");

// 3) Soumettre la signature au relayeur
const post = item.post;
const submitUrl = `https://api.relay.link${post.endpoint}${post.endpoint.includes("?") ? "&" : "?"}signature=${signature}`;
const submitRes = await fetch(submitUrl, {
  method: post.method || "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(post.body),
});
const submitTxt = await submitRes.text();
console.log(`Soumission relayeur: HTTP ${submitRes.status} ${submitTxt.slice(0, 300)}\n`);
if (!submitRes.ok) process.exit(1);

// 4) Suivre le statut de l'intent
const requestId = post.body.requestId;
const statusUrl = `https://api.relay.link/intents/status?requestId=${requestId}`;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const st = await (await fetch(statusUrl)).json();
  const s = st.status || st.state || "?";
  process.stdout.write(`  [${i}] statut=${s}${st.txHashes ? " tx=" + JSON.stringify(st.txHashes) : ""}\n`);
  if (["success", "complete", "refund"].includes(s)) {
    console.log(s === "refund" ? "\n⚠️ remboursé" : "\n✅ Bridge terminé — USDC sur Base.");
    break;
  }
}
