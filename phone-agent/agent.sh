#!/data/data/com.termux/files/usr/bin/bash
# agent.sh — installe et lance l'agent SMS sur un téléphone Android (Termux).
# Il lit les SMS reçus par la SIM et les POUSSE vers api.x-402.online. Tourne seul, sans PC.
# Tout le travail est fait en Node (une seule dépendance) — pas d'openssl/jq/sed à trouver.
#
#   curl -s https://api.x-402.online/phone-agent.sh | INGEST_SECRET=xxxxx bash
#   (ajoute MY_NUMBER=+590690XXXXXX devant si le numéro n'est pas détecté)
set -uo pipefail

BACKEND="${BACKEND:-https://api.x-402.online}"
SECRET="${INGEST_SECRET:-}"
MY_NUMBER="${MY_NUMBER:-}"
POLL="${POLL:-15}"
[ -z "$SECRET" ] && { echo "❌ INGEST_SECRET manquant. Relance: INGEST_SECRET=... bash"; exit 1; }

echo "→ Installation de Node et Termux:API (patiente, ~1 min)…"
yes | pkg update >/dev/null 2>&1
yes | pkg install nodejs termux-api >/dev/null 2>&1

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node ne s'est pas installé. Vérifie ta connexion et relance la commande."; exit 1
fi
echo "→ Node OK ($(node -v))."
termux-wake-lock 2>/dev/null || true

# --- l'agent, en Node (robuste : crypto + fetch intégrés, appelle les cmd termux-*) ---
DIR="$HOME/x402-sms-agent"; mkdir -p "$DIR"
cat > "$DIR/agent.mjs" <<'NODE'
import crypto from "node:crypto";
import { execSync } from "node:child_process";
const BACKEND = process.env.BACKEND, SECRET = process.env.INGEST_SECRET;
const POLL = Number(process.env.POLL || 15);
const sh = (c) => { try { return execSync(c, { encoding: "utf8", timeout: 15000 }); } catch { return ""; } };

// numéro + opérateur
let info = {}; try { info = JSON.parse(sh("termux-telephony-deviceinfo") || "{}"); } catch {}
let phone = process.env.MY_NUMBER || info.phone_number || "";
const carrier = info.network_operator_name || info.sim_operator_name || "";
const country = (info.network_country_iso || info.sim_country_iso || "").toUpperCase();
if (!phone) { console.log("⚠️  Numéro non détecté. Relance avec MY_NUMBER=+590690XXXXXX INGEST_SECRET=... bash"); process.exit(1); }
console.log(`→ Téléphone : ${phone}  (${carrier} / ${country})`);

async function push() {
  let msgs = [];
  try {
    const raw = JSON.parse(sh("termux-sms-list -l 10 -t inbox") || "[]");
    msgs = raw.map((m) => ({ sender: m.number, body: m.body, received_at: new Date((m.received ? Date.parse(m.received) : Date.now())).toISOString() }));
  } catch {}
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", SECRET).update(`${phone}.${ts}`).digest("hex");
  try {
    const r = await fetch(`${BACKEND}/sms/ingest`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, carrier, country, ts, sig, messages: msgs }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) console.log(`  push ${r.status}: ${j.error || ""}`);
  } catch (e) { /* réseau : on réessaie au prochain tour */ }
}
console.log(`✅ Agent lancé. Pousse les SMS toutes les ${POLL}s. Tu peux fermer Termux (garde le tel allumé).`);
for (;;) { await push(); await new Promise((r) => setTimeout(r, POLL * 1000)); }
NODE

# relance auto au prochain lancement de Termux
if ! grep -q 'x402-sms-agent' "$HOME/.bashrc" 2>/dev/null; then
  echo "[ -f \$HOME/x402-sms-agent/agent.mjs ] && (INGEST_SECRET='$SECRET' MY_NUMBER='$MY_NUMBER' BACKEND='$BACKEND' nohup node \$HOME/x402-sms-agent/agent.mjs >/dev/null 2>&1 &)  # x402-sms-agent" >> "$HOME/.bashrc"
fi

echo "→ Lecture des SMS autorisée ? (Android a dû le demander.)"
INGEST_SECRET="$SECRET" MY_NUMBER="$MY_NUMBER" BACKEND="$BACKEND" POLL="$POLL" node "$DIR/agent.mjs"
