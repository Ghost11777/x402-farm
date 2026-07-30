// French Data Butler — agent VENDEUR sur Virtuals ACP (SDK v2).
//
// Il écoute les jobs entrants, fixe le prix depuis le registre, appelle notre
// backend x402 pour produire la donnée, livre le résultat et encaisse en USDC
// via l'escrow ACP (vendeur = 95%, protocole = 5%).
//
// Lancement :   node seller.js
// Sandbox :     SANDBOX=true node seller.js   (Base Sepolia, fonds testnet gratuits)
//
// Prérequis (voir README.md) : l'agent doit d'abord être ENREGISTRÉ via l'UI web
// app.virtuals.io (profil + offerings + signer). On récupère alors les 3 secrets :
//   SELLER_WALLET_ADDRESS, SELLER_WALLET_ID, SELLER_SIGNER_PRIVATE_KEY
// à mettre dans .env.

import "dotenv/config";
import { base, baseSepolia } from "@account-kit/infra";
import {
  AcpAgent,
  AssetToken,
  PrivyAlchemyEvmProviderAdapter,
} from "@virtuals-protocol/acp-node-v2";
import { OFFERINGS_BY_NAME } from "./offerings.js";
import { fulfill } from "./fulfill.js";

const SANDBOX = process.env.SANDBOX === "true";
const CHAIN = SANDBOX ? baseSepolia : base;

// Cache des "requirements" reçues, par jobId (on les relit au moment du funding).
const requirements = new Map();

function log(...a) { console.log(new Date().toISOString(), ...a); }

async function main() {
  for (const k of ["SELLER_WALLET_ADDRESS", "SELLER_WALLET_ID", "SELLER_SIGNER_PRIVATE_KEY"]) {
    if (!process.env[k]) { console.error(`❌ env manquant : ${k} (voir README.md § enregistrement)`); process.exit(1); }
  }

  const seller = await AcpAgent.create({
    evmProvider: await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: process.env.SELLER_WALLET_ADDRESS,
      walletId: process.env.SELLER_WALLET_ID,
      signerPrivateKey: process.env.SELLER_SIGNER_PRIVATE_KEY,
      chains: [CHAIN],
    }),
  });

  const me = (await seller.getAddress()).toLowerCase();
  log(`French Data Butler en ligne — ${me} — réseau ${SANDBOX ? "Base Sepolia (sandbox)" : "Base mainnet"}`);

  // Offerings déclarées côté registre web (source de vérité pour les prix).
  const registry = await seller.getAgentByWalletAddress(me);
  const registered = new Map((registry?.offerings ?? []).map((o) => [o.name, o]));
  if (!registered.size) {
    log("⚠️  Aucune offering trouvée dans le registre. Déclare-les d'abord sur app.virtuals.io (cf. README).");
  }
  // Avertit si le code connaît des offerings non déclarées (ou l'inverse).
  for (const name of OFFERINGS_BY_NAME.keys()) {
    if (!registered.has(name)) log(`   · offering codée mais non enregistrée côté web : "${name}"`);
  }

  seller.on("entry", async (session, entry) => {
    try {
      const offeringName = session.job?.description;
      const offering = offeringName ? OFFERINGS_BY_NAME.get(offeringName) : undefined;

      // 1) Requirement de l'acheteur -> on cache + on fixe le budget (prix).
      if (entry.kind === "message" && entry.contentType === "requirement") {
        let req = entry.content;
        if (typeof req === "string") { try { req = JSON.parse(req); } catch { /* garde brut */ } }
        requirements.set(session.jobId, req);

        if (!offering) { log(`reject job ${session.jobId} : offering inconnue "${offeringName}"`); return session.reject("unsupported offering"); }
        // Valide tôt : si la requirement est incomplète, on refuse proprement.
        try { offering.build(req); } catch (e) { log(`reject job ${session.jobId} : ${e.message}`); return session.reject(e.message); }

        const priceRegistered = registered.get(offeringName)?.priceValue;
        const price = priceRegistered ?? offering.suggestedPriceUsdc;
        log(`job ${session.jobId} "${offeringName}" -> budget ${price} USDC`);
        return session.setBudget(AssetToken.usdc(price, session.chainId));
      }

      // 2) Escrow financé par l'acheteur -> on produit et on livre.
      if (entry.kind === "system" && entry.event?.type === "job.funded") {
        if (!offering) return session.reject("unsupported offering");
        const req = requirements.get(session.jobId) || {};
        const call = offering.build(req);
        log(`job ${session.jobId} financé -> fulfill ${call.method} ${call.path}`);
        const out = await fulfill(call);
        if (!out.ok) { log(`fulfill KO (${out.status}) job ${session.jobId}`); return session.reject(`fulfillment failed: ${out.status}`); }

        const deliverable = JSON.stringify({
          offering: offeringName,
          producedAt: new Date().toISOString(),
          source: "x402-farm / api.x-402.online",
          data: out.data,
        });
        log(`job ${session.jobId} livraison (${deliverable.length} o, mode ${out.mode})`);
        return session.submit(deliverable);
      }

      // 3) Job payé & clôturé.
      if (entry.kind === "system" && entry.event?.type === "job.completed") {
        requirements.delete(session.jobId);
        log(`✅ job ${session.jobId} payé & complété`);
      }
    } catch (e) {
      log(`erreur job ${session?.jobId}:`, e.message);
      try { await session.reject("internal error"); } catch { /* ignore */ }
    }
  });

  await seller.start(() => log("écoute des jobs…"));
}

main().catch((e) => { console.error(e); process.exit(1); });
