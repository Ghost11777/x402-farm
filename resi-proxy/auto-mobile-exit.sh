#!/bin/bash
# auto-mobile-exit.sh — tourne en root toutes les 60 s (LaunchDaemon com.x402farm.mobileexit).
# Le mini est sans écran : dès qu'une sortie 4G apparaît (clé USB branchée, iPhone en
# partage de connexion USB, Wi-Fi rejoignant un MiFi), ce script configure le policy
# routing, vérifie l'opérateur RÉELLEMENT obtenu et notifie sur ntfy. Rien à taper.
#
# Idempotent : ne fait rien si aucune candidate, ni si la candidate est déjà configurée.
set -uo pipefail
export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/sbin:/usr/bin:/bin

PROXY_USER=evosagency
HOME_PM2="/Users/evosagency/.npm-global/bin"
DIR="/Users/$PROXY_USER/x402-farm/resi-proxy"
STATE="$DIR/.auto-mobile.state"
LOG="$DIR/auto-mobile.log"
TOPIC="$(sed -n 's/^TOPIC=//p' "/Users/$PROXY_USER/x402-farm/.ntfy.topic" 2>/dev/null)"

say() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }
notify() { # notify <titre> <prio> <message>
  [ -n "$TOPIC" ] || return 0
  curl -s -m 10 -H "Title: $1" -H "Priority: $2" -d "$3" "https://ntfy.sh/$TOPIC" >/dev/null 2>&1
}

DEF_IF="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
DEF_IP="$(ipconfig getifaddr "$DEF_IF" 2>/dev/null)"
LAN_PREFIX="$(echo "${DEF_IP:-192.168.1.1}" | awk -F. '{print $1"."$2"."$3"."}')"

# --- auto-réparation Wi-Fi ----------------------------------------------------
# Au redémarrage du modem, le Mac peut raccrocher le réseau de la BOX au lieu du
# modem (constaté le 2026-07-30) : la sortie « mobile » ressortait alors par la fibre.
# On le détecte par la MAC de la passerelle (deux boîtiers = deux MAC) et on rejoint
# de nouveau le SSID du modem. Identifiants dans .wifi-exit (600, hors git).
WIFI_CFG="$DIR/.wifi-exit"
if [ -f "$WIFI_CFG" ]; then
  # shellcheck disable=SC1090
  . "$WIFI_CFG"
  WIF="${WIF:-en1}"
  if [ -n "${SSID:-}" ] && [ "$WIF" != "$DEF_IF" ]; then
    GW_W="$(ipconfig getoption "$WIF" router 2>/dev/null)"
    mac_on() { netstat -rn -f inet | awk -v g="$1" -v i="$2" '$1==g && $NF==i {print $2; exit}'; }
    ping -c1 -W 800 "${GW_W:-0.0.0.0}" >/dev/null 2>&1
    MAC_W="$(mac_on "${GW_W:-x}" "$WIF")"
    MAC_D="$(mac_on "$(ipconfig getoption "$DEF_IF" router 2>/dev/null)" "$DEF_IF")"
    # ⚠️ Ne ré-associer QUE sur une preuve positive de décrochage : soit l'interface n'a
    # plus d'IP, soit la MAC de sa passerelle est celle de la box. Une MAC simplement
    # absente du cache ARP n'est PAS une preuve (constaté le 2026-07-30 : ré-association
    # inutile à 05:02) — et ré-associer coupe le lien quelques secondes, donc un client.
    IP_W="$(ipconfig getifaddr "$WIF" 2>/dev/null)"
    NEED=""
    [ -z "$IP_W" ] && NEED=1
    [ -n "$MAC_W" ] && [ -n "$MAC_D" ] && [ "$MAC_W" = "$MAC_D" ] && NEED=1
    if [ -n "$NEED" ]; then
      COOL="$DIR/.wifi-rejoin.cooldown"
      if [ ! -f "$COOL" ] || [ $(( $(date +%s) - $(stat -f %m "$COOL") )) -gt 300 ]; then
        touch "$COOL"
        say "$WIF n'est pas sur le modem (MAC passerelle $MAC_W = celle de la box) — re-association à $SSID"
        networksetup -setairportnetwork "$WIF" "$SSID" "${PSK:-}" >/dev/null 2>&1
        sleep 12
        say "après re-association : $WIF = $(ipconfig getifaddr "$WIF" 2>/dev/null)"
      fi
    fi
  fi
fi

# --- une candidate 4G est-elle apparue ? -------------------------------------
CAND_IF=""; CAND_IP=""; COLLIDE=""
for IF in $(ifconfig -l); do
  case "$IF" in lo0|gif0|stf0|utun*|awdl*|llw*|bridge*|ap1|anpi*) continue;; esac
  [ "$IF" = "$DEF_IF" ] && continue
  IP="$(ipconfig getifaddr "$IF" 2>/dev/null)"; [ -n "$IP" ] || continue
  GW="$(ipconfig getoption "$IF" router 2>/dev/null)"
  [ -n "$GW" ] || continue
  # Un modem qui sert le MÊME /24 que la box (cas de l'Airbox Orange en 192.168.1.x)
  # reste tentable : pf force l'interface et résout la passerelle en ARP dessus. On le
  # garde en second choix et c'est la sonde qui tranche.
  case "$IP" in "$LAN_PREFIX"*) [ -n "$COLLIDE" ] || COLLIDE="$IF=$IP"; continue;; esac
  CAND_IF="$IF"; CAND_IP="$IP"; break
done
if [ -z "$CAND_IF" ] && [ -n "$COLLIDE" ]; then               # repli : candidate en conflit
  CAND_IF="${COLLIDE%%=*}"; CAND_IP="${COLLIDE##*=}"
  # (pas de journal ici : cette branche est empruntée à chaque passage, elle inonderait le log)
fi
[ -n "$CAND_IF" ] || exit 0                                   # rien branché : silence

# déjà traité pour cette IP ? on ne reconfigure pas en boucle — mais on surveille le
# moment où la sortie devient réellement vendable (ex. recharge du forfait data), pour
# prévenir sans écran : c'est la sonde du proxy qui fait foi.
if [ -f "$STATE" ] && [ "$(cat "$STATE" 2>/dev/null)" = "$CAND_IF=$CAND_IP" ]; then
  OPENED="$DIR/.auto-mobile.opened"
  STATE_JSON="$DIR/exits-state.json"
  if [ -f "$STATE_JSON" ] && node -e '
      const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
      const m=Object.entries(s.exits||{}).find(([n,e])=>n!=="residential"&&e.ok&&e.mobile);
      process.exit(m?0:1);' "$STATE_JSON" 2>/dev/null; then
    if [ ! -f "$OPENED" ]; then
      touch "$OPENED"
      INFO="$(sudo -u "$PROXY_USER" node "$DIR/proxy.mjs" --probe 2>&1 | grep "MOBILE" | head -1)"
      say "tier mobile devenu vendable : $INFO"
      notify "x402 · tier MOBILE OUVERT 💰" "high" "$INFO

/v1/proxy/mobile/1gb (5 \$) et /mobile/5gb (22 \$) sont vendables : la ferme voit un vrai opérateur mobile. Vérif : api.x-402.online/free/proxy/status"
    fi
  elif [ -f "$OPENED" ]; then
    # Le tier ÉTAIT vendable et ne l'est plus : le plus souvent la SIM est à sec (le
    # portail opérateur réapparaît). C'est l'alerte utile — recharger avant qu'un client
    # se fasse couper. Pas de plafond de Go côté ferme : c'est l'opérateur qui fait foi.
    rm -f "$OPENED"
    WHY="$(node -e '
        const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
        const m=Object.entries(s.exits||{}).find(([n])=>n!=="residential");
        console.log(m?(m[1].error||"sortie KO"):"sortie absente");' "$STATE_JSON" 2>/dev/null)"
    say "tier mobile refermé : $WHY"
    if echo "$WHY" | grep -qi "nocredit\|recharge\|DATA PLAN EMPTY"; then
      notify "x402 · SIM 4G À RECHARGER" "urgent" "Le forfait data de la SIM est épuisé : l'opérateur renvoie sa page de recharge. Le tier mobile vient de se refermer tout seul (aucune vente trompeuse, le résidentiel continue). Recharge et il se rouvre dans les 10 min.

$WHY"
    else
      notify "x402 · tier mobile refermé" "high" "La sortie mobile n'est plus vérifiée : $WHY

Le tier est retiré de la vente le temps que ça revienne. Résidentiel non affecté."
    fi
  fi
  exit 0
fi

say "sortie candidate détectée : $CAND_IF ($CAND_IP) — configuration"
notify "x402 · sortie 4G détectée" "default" "Interface $CAND_IF ($CAND_IP) détectée sur le mini. Configuration du routage en cours…"

OUT="$(IFACE="$CAND_IF" SUDO_USER="$PROXY_USER" bash "$DIR/setup-mobile-exit.sh" 2>&1)"
say "$OUT"

# squid (chemin rapide de NOTRE scraping) porte l'IP du modem en dur : elle change à
# chaque bail DHCP, donc on la réécrit et on recharge. Sans ça, squid se lie à une IP
# morte et le mode mobile des actors tombe en silence au prochain redémarrage du modem.
SQ_CONF="$DIR/squid-mobile.conf"
SQUID_BIN=/opt/homebrew/opt/squid/sbin/squid
if [ -f "$SQ_CONF" ]; then
  ACTUEL="$(sed -n 's/^tcp_outgoing_address //p' "$SQ_CONF" | tr -d ' ')"
  if [ "$ACTUEL" != "$CAND_IP" ]; then
    sed -i '' "s/^tcp_outgoing_address .*/tcp_outgoing_address $CAND_IP/" "$SQ_CONF"
    say "squid : sortie $ACTUEL -> $CAND_IP"
    sudo -u "$PROXY_USER" "$SQUID_BIN" -k reconfigure -f "$SQ_CONF" 2>/dev/null       || sudo -u "$PROXY_USER" "$HOME_PM2/pm2" restart squid-mobile 2>/dev/null       || say "squid : rechargement à faire à la main"
  fi
fi
echo "$CAND_IF=$CAND_IP" > "$STATE"

# --- verdict : ce que la sonde a réellement observé --------------------------
sleep 5
VERDICT="$(sudo -u "$PROXY_USER" node "$DIR/proxy.mjs" --probe 2>&1)"
say "verdict: $VERDICT"

if echo "$VERDICT" | grep -q "MOBILE ✅"; then
  CARRIER="$(echo "$VERDICT" | grep "MOBILE ✅" | head -1)"
  notify "x402 · tier MOBILE OUVERT 💰" "high" "$CARRIER

/v1/proxy/mobile/1gb (5 \$) et /mobile/5gb (22 \$) sont désormais vendables : la ferme a vu un vrai opérateur mobile. Vérif publique : api.x-402.online/free/proxy/status"
elif echo "$VERDICT" | grep -q "same public IP as residential"; then
  notify "x402 · routage 4G inopérant" "high" "L'interface est là mais pf ne route pas : la sortie ressort sur l'IP de la fibre. Le tier mobile reste fermé (aucune vente trompeuse). Repli : brancher le modem sur un 2e appareil dont la 4G est la seule connexion.

$VERDICT"
else
  notify "x402 · sortie 4G à vérifier" "high" "Configuration faite mais l'opérateur n'est pas identifié comme mobile (souvent : box 4G derrière un réseau fixe). Tier mobile fermé.

$VERDICT"
fi
