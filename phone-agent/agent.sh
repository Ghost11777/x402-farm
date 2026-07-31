#!/data/data/com.termux/files/usr/bin/bash
# agent.sh — agent SMS autonome pour un téléphone Android, via Termux.
# Il lit les SMS reçus par la SIM du téléphone et les POUSSE vers api.x-402.online, qui les
# vend aux agents x402. Tourne seul, sans câble ni PC. Source = un numéro physique = le moat.
#
# INSTALLATION (une fois) :
#   1) Installe Termux + Termux:API depuis F-Droid (pas le Play Store, versions à jour).
#   2) Ouvre Termux et colle :
#        curl -s https://api.x-402.online/phone-agent.sh | INGEST_SECRET=xxxxx bash
#   3) Accorde la permission SMS quand Android la demande.
# L'agent se relance au démarrage de Termux (ligne ajoutée à ~/.bashrc).
set -uo pipefail

BACKEND="${BACKEND:-https://api.x-402.online}"
SECRET="${INGEST_SECRET:-}"
POLL="${POLL:-15}"                 # secondes entre deux relevés
[ -z "$SECRET" ] && { echo "❌ INGEST_SECRET manquant. Relance avec: INGEST_SECRET=... bash"; exit 1; }

echo "→ Installation des dépendances (nodejs, termux-api, jq)…"
pkg update -y >/dev/null 2>&1
pkg install -y nodejs termux-api jq coreutils >/dev/null 2>&1

# permissions + réveil permanent
termux-wake-lock 2>/dev/null || true
echo "→ Autorise l'accès aux SMS si Android le demande…"
termux-sms-list -l 1 >/dev/null 2>&1 || true

# numéro + opérateur du téléphone
INFO="$(termux-telephony-deviceinfo 2>/dev/null || echo '{}')"
PHONE="$(echo "$INFO" | jq -r '.phone_number // empty')"
CARRIER="$(echo "$INFO" | jq -r '.network_operator_name // .sim_operator_name // empty')"
COUNTRY="$(echo "$INFO" | jq -r '.network_country_iso // .sim_country_iso // empty' | tr 'a-z' 'A-Z')"
[ -z "$PHONE" ] && PHONE="${MY_NUMBER:-}"     # certains opérateurs ne l'exposent pas → MY_NUMBER=+590...
[ -z "$PHONE" ] && { echo "⚠️  Numéro non détecté. Relance avec MY_NUMBER=+590690XXXXXX INGEST_SECRET=... bash"; exit 1; }
echo "→ Téléphone : $PHONE  ($CARRIER / $COUNTRY)"

# HMAC(sha256, SECRET, "phone.ts") — même schéma que le backend
sign() { printf '%s' "$1.$2" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.*= //'; }

push() {
  local ts; ts="$(date +%s)"
  local sig; sig="$(sign "$PHONE" "$ts")"
  # 10 derniers SMS reçus, remis au format {sender, body, received_at}
  local msgs
  msgs="$(termux-sms-list -l 10 -t inbox 2>/dev/null | jq -c '[.[] | {sender: .number, body: .body, received_at: (.received // now|todate)}]' 2>/dev/null || echo '[]')"
  curl -s -m 12 -X POST "$BACKEND/sms/ingest" -H 'content-type: application/json' \
    -d "$(jq -n --arg p "$PHONE" --arg c "$CARRIER" --arg co "$COUNTRY" --arg ts "$ts" --arg sig "$sig" --argjson m "$msgs" \
          '{phone:$p, carrier:$c, country:$co, ts:($ts|tonumber), sig:$sig, messages:$m}')" >/dev/null 2>&1
}

# auto-relance au prochain lancement de Termux
grep -q 'x402-sms-agent' ~/.bashrc 2>/dev/null || \
  echo '[ -f ~/x402-sms-agent/agent.sh ] && (INGEST_SECRET='"$SECRET"' MY_NUMBER='"$PHONE"' nohup bash ~/x402-sms-agent/agent.sh >/dev/null 2>&1 &)  # x402-sms-agent' >> ~/.bashrc
mkdir -p ~/x402-sms-agent && cp "$0" ~/x402-sms-agent/agent.sh 2>/dev/null || true

echo "✅ Agent lancé. Le téléphone pousse ses SMS toutes les ${POLL}s. Tu peux fermer Termux (garde le tel allumé)."
while true; do push; sleep "$POLL"; done
