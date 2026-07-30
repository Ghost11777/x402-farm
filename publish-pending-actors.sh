#!/bin/bash
# Publie automatiquement les Actors Apify en attente dès qu'un créneau se libère
# (limite Apify = 5 publications / 24h glissantes). Idempotent : ne republie pas ceux
# déjà publics ; les échecs "daily-limit" sont simplement retentés au prochain passage.
# Lancé périodiquement par launchd (com.x402farm.publish). Log -> publish-pending.log
set -u
cd "$(dirname "$0")" || exit 1
LOG="publish-pending.log"
T=$(grep APIFY_TOKEN .apify.secret | cut -d= -f2)
[ -z "$T" ] && { echo "$(date) no token" >>"$LOG"; exit 1; }

# id:categories (séparées par des virgules)
ACTORS=(
  "t07z0ngO4rNZCV8Oc:REAL_ESTATE,BUSINESS,AI"       # french-realestate-scraper
  "Aw2mrV5g05azqt5oi:BUSINESS,LEAD_GENERATION,AI"    # french-qualified-leads
  "w9zc9nFWdPcgf9n7d:ECOMMERCE,BUSINESS,AI"          # leboncoin-scraper
  "h5EVjaYseXelWADwr:REAL_ESTATE,BUSINESS,AI"        # seloger-scraper
)

remaining=0
for entry in "${ACTORS[@]}"; do
  id="${entry%%:*}"; cats="${entry##*:}"
  pub=$(curl -s "https://api.apify.com/v2/acts/$id?token=$T" | python3 -c "import sys,json;print(json.load(sys.stdin)['data'].get('isPublic'))" 2>/dev/null)
  if [ "$pub" = "True" ]; then continue; fi
  remaining=$((remaining+1))
  catjson=$(python3 -c "import sys,json;print(json.dumps(sys.argv[1].split(',')))" "$cats")
  res=$(curl -s -X PUT "https://api.apify.com/v2/acts/$id?token=$T" -H "Content-Type: application/json" \
    -d "{\"isPublic\":true,\"categories\":$catjson}" | python3 -c "import sys,json
d=json.load(sys.stdin)
print('OK' if d.get('data',{}).get('isPublic') else 'ERR:'+d.get('error',{}).get('type','?'))" 2>/dev/null)
  echo "$(date) $id -> $res" >>"$LOG"
done

# Tout est publié : se désactiver pour ne plus tourner inutilement.
if [ "$remaining" = "0" ]; then
  echo "$(date) all published — unloading launchd job" >>"$LOG"
  launchctl unload "$HOME/Library/LaunchAgents/com.x402farm.publish.plist" 2>/dev/null
fi
