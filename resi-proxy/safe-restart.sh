#!/bin/bash
# safe-restart.sh — le SEUL moyen autorisé de redémarrer resi-proxy.
#
#   bash resi-proxy/safe-restart.sh            # refuse s'il y a du trafic client
#   bash resi-proxy/safe-restart.sh --force    # passe outre (à n'utiliser qu'avec l'accord de Laurent)
#
# POURQUOI : un redémarrage coupe TOUS les tunnels en cours. Le 2026-07-30, un client qui
# avait payé 5 $ consommait son forfait quand le proxy a été redémarré pour un déploiement :
# sa session est tombée et sa consommation s'est arrêtée net à 82 MB. Le trafic payé ne se
# rejoue pas.
#
# RAPPEL : la CONFIG est relue à chaque requête (exits.json, keys.json, inventory.json) —
# aucun redémarrage n'est nécessaire pour ajouter une sortie, une clé ou un plafond. Seul un
# changement de CODE l'exige.
set -uo pipefail
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PROXY_PORT:-8899}"
FORCE=""; [ "${1:-}" = "--force" ] && FORCE=1
CHECK=""; [ "${1:-}" = "--check" ] && CHECK=1   # constat seul : ne redémarre rien

# 1) connexions établies sur le port du proxy
CONNS=$(netstat -an 2>/dev/null | grep -c "\.${PORT} .*ESTABLISHED")
# 2) trafic récent : keys.json est réécrit à chaque flush de compteur (~2 Mo)
KF="$DIR/keys.json"
AGE=999999
[ -f "$KF" ] && AGE=$(( $(date +%s) - $(stat -f %m "$KF") ))

echo "resi-proxy : $CONNS connexion(s) établie(s) · dernier octet compté il y a ${AGE}s"

BUSY=""; { [ "$CONNS" -gt 0 ] || [ "$AGE" -lt 300 ]; } && BUSY=1

if [ -n "$CHECK" ]; then
  if [ -n "$BUSY" ]; then
    echo "⛔ En l'état, un redémarrage serait REFUSÉ (trafic en cours ou très récent)."
  else
    echo "✅ Aucun trafic : un redémarrage serait sans dégât."
  fi
  echo "   (mode --check : rien n'a été redémarré)"
  exit 0
fi

if [ -z "$FORCE" ] && [ -n "$BUSY" ]; then
  cat <<EOF

⛔ REDÉMARRAGE REFUSÉ$([ "$CONNS" -gt 0 ] && echo " — $CONNS session(s) OUVERTE(S) sur le proxy" || echo " — octet compté il y a ${AGE}s (session récente, ou un test à nous)")
   Couper une session en cours interrompt du trafic déjà payé : il ne se rejoue pas.
   Note : les Mo listés ci-dessous sont des CUMULS, pas une activité instantanée —
   seul le nombre de connexions établies dit s'il y a quelqu'un maintenant.

   Clés actives :
$(python3 - <<'PY' 2>/dev/null
import json, time
try: k = json.load(open('keys.json'))
except Exception: k = {}
for key, v in k.items():
    used = v.get('usedBytes', 0)
    if used > 1_000_000:
        print(f"     {key[:26]}… {used/1e6:.1f} MB / {v.get('quotaBytes',0)/1e9:.0f} GB")
PY
)

   Options : attendre la fin de la session, ou demander l'accord de Laurent puis
   relancer avec --force.
EOF
  exit 1
fi

[ -n "$FORCE" ] && echo "⚠️  --force : redémarrage malgré le trafic (accord donné)"
PM2="$(ls "$HOME/.npm-global/bin/pm2" 2>/dev/null || command -v pm2)"
[ -n "$PM2" ] || { echo "❌ pm2 introuvable"; exit 1; }
"$PM2" restart resi-proxy >/dev/null 2>&1 && echo "✅ resi-proxy redémarré"
sleep 4
node "$DIR/proxy.mjs" --probe
