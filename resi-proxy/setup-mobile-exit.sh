#!/bin/bash
# setup-mobile-exit.sh — à lancer SUR LE MAC MINI, modem 4G branché :
#
#   sudo bash ~/x402-farm/resi-proxy/setup-mobile-exit.sh          # auto-détection
#   IFACE=en4 sudo bash ~/x402-farm/resi-proxy/setup-mobile-exit.sh # forcer une interface
#
# Pourquoi un script : sous macOS, binder une socket sur l'IP d'une interface
# secondaire NE SUFFIT PAS — le noyau route par destination, donc les paquets
# repartiraient par la fibre avec une IP source 4G (jetés en route). Il faut du
# policy routing (pf « route-to »).
#
# MULTI-MODEM : chaque sortie est nommée d'après son INTERFACE (en1 → mobile1,
# en4 → mobile2…), parce que l'IP DHCP du modem change à chaque redémarrage alors que
# l'interface, non. L'ancre pf est RECONSTRUITE depuis toutes les sorties déclarées :
# ajouter un modem n'efface pas les précédents. Relancer ce script est sans risque.
#
# Si la vérification finale échoue, la sortie reste marquée KO et la ferme continue de
# REFUSER de vendre le tier mobile (503) — on ne vend jamais ce qu'on ne livre pas.
set -uo pipefail

[ "$(id -u)" = "0" ] || { echo "❌ Lance-moi avec sudo : sudo bash $0"; exit 1; }

PROXY_USER="${SUDO_USER:-$(stat -f %Su /dev/console)}"
HOME_DIR="$(eval echo "~$PROXY_USER")"
DIR="$HOME_DIR/x402-farm/resi-proxy"
ANCHOR=/etc/pf.anchors/x402-resi-proxy
PLIST=/Library/LaunchDaemons/com.x402farm.pf.plist
EXITS="$DIR/exits.json"
[ -f "$DIR/proxy.mjs" ] || { echo "❌ $DIR/proxy.mjs introuvable"; exit 1; }

DEF_IF="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
DEF_IP="$(ipconfig getifaddr "$DEF_IF" 2>/dev/null)"
echo "→ Interface par défaut (résidentiel) : ${DEF_IF:-?} ${DEF_IP:-?}"

# --- 1. détection du modem ----------------------------------------------------
LAN_PREFIX="$(echo "${DEF_IP:-192.168.1.1}" | awk -F. '{print $1"."$2"."$3"."}')"
LAN_NET="${LAN_PREFIX}0/24"
CAND_IF=""; CAND_IP=""; CAND_GW=""; OTHERS=""
for IF in $(ifconfig -l); do
  case "$IF" in lo0|gif0|stf0|utun*|awdl*|llw*|bridge*|ap1|anpi*) continue;; esac
  [ "$IF" = "$DEF_IF" ] && continue
  IP="$(ipconfig getifaddr "$IF" 2>/dev/null)"; [ -n "$IP" ] || continue
  GW="$(ipconfig getoption "$IF" router 2>/dev/null)"
  [ -n "$GW" ] || GW="$(netstat -rn -f inet | awk -v i="$IF" '$1=="default" && $NF==i {print $2; exit}')"
  SAME_LAN=""; case "$IP" in "$LAN_PREFIX"*) SAME_LAN=" (même sous-réseau que la box)";; esac
  echo "   candidat : $IF  ip=$IP  gw=${GW:-aucune}$SAME_LAN"
  [ -n "$GW" ] || continue
  # Même /24 que la box : ignoré en auto-détection, MAIS forçable via IFACE= — pf sait
  # router par interface (passerelle résolue en ARP dessus), donc un modem qui sert le
  # même plan d'adressage marche quand même : c'est la sonde qui tranche.
  [ -n "$SAME_LAN" ] && [ "${IFACE:-}" != "$IF" ] && continue
  if [ -n "${IFACE:-}" ]; then
    [ "$IF" = "$IFACE" ] && { CAND_IF="$IF"; CAND_IP="$IP"; CAND_GW="$GW"; }
  elif [ -z "$CAND_IF" ]; then CAND_IF="$IF"; CAND_IP="$IP"; CAND_GW="$GW"
  else OTHERS="$OTHERS $IF"
  fi
done
[ -n "$OTHERS" ] && echo "   ℹ️  autres sorties possibles :$OTHERS  (les déclarer avec IFACE=<nom> sudo bash $0)"

if [ -z "$CAND_IF" ]; then
  cat <<EOF

❌ Aucune sortie 4G détectée (aucune interface avec passerelle hors du réseau de la box).
   NE DÉBRANCHE PAS la box : il faut une interface EN PLUS de $DEF_IF. Selon le matériel :
     • clé USB 4G : la brancher en USB, mode "RNDIS/HiLink" (pas "modem série"),
       voyant data allumé → doit apparaître en 192.168.8.x ;
     • box/MiFi 4G avec Wi-Fi : connecter le Wi-Fi DU MINI à son SSID (l'Ethernet reste
       sur la box), puis System Settings → Network → ⋯ → Set Service Order :
       Ethernet AU-DESSUS du Wi-Fi (sinon la sortie résidentielle bascule sur la 4G) ;
     • box 4G RJ45 seulement : passer par un adaptateur USB→Ethernet — ne JAMAIS relier
       le modem à la box/au switch, il serait sur le même sous-réseau (rien à sélectionner) ;
     • test gratuit sans rien acheter : téléphone en partage de connexion USB, Wi-Fi du
       téléphone COUPÉ (données mobiles actives) → interface 172.20.10.x.
   Vérifie l'IP dans System Settings → Network, puis relance ce script.
EOF
  exit 2
fi
echo "→ Modem retenu : $CAND_IF ($CAND_IP via $CAND_GW)"

# --- 2. nom stable de la sortie ------------------------------------------------
EXIT_NAME="$(python3 - "$EXITS" "$CAND_IF" "$CAND_IP" <<'PYNAME'
import json, sys
path, iface, ip = sys.argv[1], sys.argv[2], sys.argv[3]
try: cfg = json.load(open(path))
except Exception: cfg = {}
name = None
# 1) déjà déclarée pour cette interface -> on garde le nom, on rafraîchit l'IP
for k, v in cfg.items():
    if isinstance(v, dict) and v.get("iface") == iface: name = k; break
# 2) ancien format (nom -> "ip" en texte) : on récupère le nom et on le migre
if not name:
    for k, v in cfg.items():
        if isinstance(v, str) and v == ip: name = k; break
# 3) sinon, prochain nom libre
if not name:
    n = 1
    while f"mobile{n}" in cfg: n += 1
    name = f"mobile{n}"
cfg[name] = {"ip": ip, "iface": iface}
json.dump(cfg, open(path, "w"), indent=2)
print(name)
PYNAME
)"
echo "→ Sortie déclarée : $EXIT_NAME = $CAND_IP ($CAND_IF)"
chown "$PROXY_USER" "$EXITS" 2>/dev/null

# --- 3. règle pf, reconstruite depuis TOUTES les sorties ----------------------
{
  echo "# x402-farm resi-proxy — force le trafic émis depuis l'IP de chaque modem 4G à"
  echo "# sortir PAR ce modem (macOS route par destination : sinon retour par la fibre)."
  echo "# Généré par setup-mobile-exit.sh — ne pas éditer à la main."
  python3 - "$EXITS" "$LAN_NET" <<'PYRULES'
import json, subprocess, sys
path, lan = sys.argv[1], sys.argv[2]
try: cfg = json.load(open(path))
except Exception: cfg = {}
for name, v in cfg.items():
    if not isinstance(v, dict): continue
    iface, ip = v.get("iface"), v.get("ip")
    if not iface or not ip: continue
    gw = subprocess.run(["ipconfig", "getoption", iface, "router"], capture_output=True, text=True).stdout.strip()
    if not gw: continue
    print(f"pass out quick route-to ({iface} {gw}) inet from {ip} to ! {lan} keep state  # {name}")
PYRULES
} > "$ANCHOR"
echo "→ Ancre pf ($(grep -c route-to "$ANCHOR") sortie(s)) : $ANCHOR"
grep route-to "$ANCHOR" | sed 's/^/   /'

if ! grep -q 'x402-resi-proxy' /etc/pf.conf; then
  cp /etc/pf.conf "/etc/pf.conf.bak.x402" 2>/dev/null
  printf '\nanchor "x402-resi-proxy"\nload anchor "x402-resi-proxy" from "%s"\n' "$ANCHOR" >> /etc/pf.conf
  echo "→ /etc/pf.conf : ancre déclarée (sauvegarde /etc/pf.conf.bak.x402)"
fi
pfctl -f /etc/pf.conf -E 2>&1 | grep -iE "enabled|error|syntax" | sed 's/^/   pf: /'

# persistance au redémarrage (pf n'est pas activé au boot par défaut)
cat > "$PLIST" <<'PLEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.x402farm.pf</string>
  <key>ProgramArguments</key><array>
    <string>/sbin/pfctl</string><string>-f</string><string>/etc/pf.conf</string><string>-E</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLEOF
launchctl bootstrap system "$PLIST" 2>/dev/null || launchctl load -w "$PLIST" 2>/dev/null
echo "→ pf réactivé au boot (com.x402farm.pf)"

# --- 4. vérification réelle (SANS redémarrer le proxy) ------------------------
# ⚠️ RÈGLE : on ne redémarre JAMAIS resi-proxy ici. Le processus relit exits.json et
# keys.json à CHAQUE requête : la nouvelle sortie est prise en compte à chaud. Un
# redémarrage couperait les tunnels des clients en cours (arrivé le 2026-07-30 : un
# client payant à 82 MB s'est fait tomber). Pour un changement de CODE, passer par
# resi-proxy/safe-restart.sh, qui refuse si du trafic est en cours.
export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH
echo "→ Config prise à chaud (exits.json relu à chaque requête) — aucun redémarrage"
sleep 3
echo
echo "=== Vérification des sorties (IP publique réellement obtenue) ==="
sudo -u "$PROXY_USER" node "$DIR/proxy.mjs" --probe
cat <<EOF

Lecture :
  • "MOBILE ✅"  → sortie livrable ; la ferme l'ouvre à la vente (relit l'état /60 s).
  • "fixe"      → autre IP mais opérateur non identifié comme mobile (box 4G sur
                  réseau fixe, par ex.).
  • "KO — same public IP as residential" → pf n'a pas pris la main : tier fermé.
                  Repli : modem sur un 2e appareil dont la 4G est la SEULE connexion,
                  puis { "mobileN": { "upstream": "http://<ip-lan>:8899" } } dans exits.json.
  • "KO — carrier captive portal … Nocredit" → forfait data épuisé, recharger la SIM.

Ajouter un autre modem : le brancher, puis relancer ce script (IFACE=<interface> si
plusieurs candidates). Les sorties déjà déclarées sont conservées.
EOF
