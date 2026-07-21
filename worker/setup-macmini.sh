#!/bin/bash
# Installe le worker x402-farm sur le Mac mini + Cloudflare Tunnel, en services
# persistants (launchd) qui redémarrent tout seuls. À lancer SUR LE MAC MINI.
#
#   bash worker/setup-macmini.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "== x402-farm worker setup — repo: $ROOT =="

# 1. Prérequis : Homebrew, Node, cloudflared
if ! command -v brew >/dev/null; then echo "!! Installe Homebrew d'abord: https://brew.sh"; exit 1; fi
command -v node >/dev/null || brew install node
command -v cloudflared >/dev/null || brew install cloudflared

# 2. Dépendances + navigateur
echo "== npm install + playwright chromium =="
npm install --omit=dev --no-audit --no-fund
npx playwright install chromium

# 3. Secret worker (partagé avec Vercel)
if [ ! -f worker/.env ]; then
  SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
  cat > worker/.env <<EOF
WORKER_PORT=4020
WORKER_SECRET=$SECRET
EOF
  echo "== secret worker généré dans worker/.env =="
  echo ">>> AJOUTE CE SECRET SUR VERCEL :  WORKER_SECRET=$SECRET"
fi
source worker/.env

# 4. Cloudflare Tunnel (interactif la 1re fois)
echo ""
echo "== Cloudflare Tunnel =="
echo "Si ce n'est pas déjà fait, connecte-toi à Cloudflare (ouvre un navigateur) :"
echo "   cloudflared tunnel login"
echo "Puis crée le tunnel + route un sous-domaine (ex. worker.tondomaine.com) :"
echo "   cloudflared tunnel create x402-farm-worker"
echo "   cloudflared tunnel route dns x402-farm-worker worker.tondomaine.com"
echo ""
echo "Config tunnel attendue dans ~/.cloudflared/config.yml :"
cat <<'YML'
  tunnel: x402-farm-worker
  credentials-file: /Users/<toi>/.cloudflared/<UUID>.json
  ingress:
    - hostname: worker.tondomaine.com
      service: http://127.0.0.1:4020
    - service: http_status:404
YML
echo ""

# 5. Services launchd persistants (worker + tunnel), redémarrage auto
PLIST_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$PLIST_DIR"
NODE_BIN="$(command -v node)"
CFD_BIN="$(command -v cloudflared)"

cat > "$PLIST_DIR/com.x402farm.worker.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.x402farm.worker</string>
  <key>ProgramArguments</key><array>
    <string>$NODE_BIN</string><string>$ROOT/worker/index.js</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>WORKER_PORT</key><string>${WORKER_PORT:-4020}</string>
    <key>WORKER_SECRET</key><string>$WORKER_SECRET</string>
  </dict>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/x402farm-worker.log</string>
  <key>StandardErrorPath</key><string>/tmp/x402farm-worker.err</string>
</dict></plist>
EOF

cat > "$PLIST_DIR/com.x402farm.tunnel.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.x402farm.tunnel</string>
  <key>ProgramArguments</key><array>
    <string>$CFD_BIN</string><string>tunnel</string><string>run</string><string>x402-farm-worker</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/x402farm-tunnel.log</string>
  <key>StandardErrorPath</key><string>/tmp/x402farm-tunnel.err</string>
</dict></plist>
EOF

echo "== services launchd écrits. Charge-les (après avoir créé le tunnel) : =="
echo "   launchctl unload $PLIST_DIR/com.x402farm.worker.plist 2>/dev/null; launchctl load $PLIST_DIR/com.x402farm.worker.plist"
echo "   launchctl unload $PLIST_DIR/com.x402farm.tunnel.plist 2>/dev/null; launchctl load $PLIST_DIR/com.x402farm.tunnel.plist"
echo ""
echo "== Empêche la mise en veille (le mini doit rester joignable) : =="
echo "   sudo pmset -a sleep 0 disksleep 0 womp 1"
echo ""
echo "== Ensuite sur Vercel, ajoute :  WORKER_URL=https://worker.tondomaine.com  +  WORKER_SECRET (ci-dessus) =="
