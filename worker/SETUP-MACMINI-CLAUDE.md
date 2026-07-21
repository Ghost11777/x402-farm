# Mission Claude Code — Installer le worker x402-farm sur ce Mac mini

Tu es sur un **Mac mini** qui doit devenir le "worker lourd" de x402-farm. Ce document contient tout le contexte et les commandes. Exécute étape par étape, vérifie chaque résultat, et demande à l'utilisateur (Laurent) uniquement pour les actions interactives signalées 🔴.

## Contexte (ce que tu construis)

x402-farm est une ferme d'APIs payées par des agents IA via le protocole **x402** (USDC sur Base). Le front tourne déjà sur **Vercel** (`https://x402-farm.vercel.app`) : il encaisse les paiements et sert les APIs rapides.

Ce Mac mini va héberger les routes **navigateur** (extraction web, screenshot, PDF…) parce qu'il apporte deux choses que Vercel n'a pas :
1. une **IP résidentielle** (passe là où les IPs datacenter sont bloquées) ;
2. la capacité de garder des **sessions connectées 24/7** (pour de futures APIs à accès verrouillé type INPI/Infogreffe).

Vercel proxifiera ces routes vers ce Mac mini via un **tunnel Cloudflare chiffré** (aucun port ouvert sur la box). Si le Mac mini tombe, Vercel retombe automatiquement sur son propre Playwright — rien ne casse.

```
Agent → paie (x402) → Vercel [paywall + APIs] → Cloudflare Tunnel → CE MAC MINI [Playwright + IP résidentielle]
```

## Prérequis à vérifier

```bash
sw_vers                       # macOS
uname -m                      # doit être arm64 (Apple Silicon)
command -v brew || echo "Installer Homebrew: https://brew.sh"
```

🔴 **Info à demander à Laurent avant de commencer :**
- A-t-il un **domaine géré chez Cloudflare** ? (ex. `nela97.ai` ou autre). Si oui, note-le → on route un sous-domaine `worker.<domaine>`. Si non → on utilisera un "quick tunnel" éphémère (`*.trycloudflare.com`) pour tester, sans domaine.

## Étape 1 — Récupérer le repo

```bash
cd ~
git clone https://github.com/Ghost11777/x402-farm.git 2>/dev/null || (cd x402-farm && git pull)
cd ~/x402-farm
```

## Étape 2 — Lancer le script d'installation

```bash
bash worker/setup-macmini.sh
```

Ce script :
- installe `node` + `cloudflared` (via brew) ;
- fait `npm install` + `npx playwright install chromium` ;
- génère un `WORKER_SECRET` dans `worker/.env` → **NOTE CE SECRET**, il faudra le mettre sur Vercel ;
- écrit deux services launchd (`com.x402farm.worker` et `com.x402farm.tunnel`).

Récupère le secret généré :
```bash
cat worker/.env    # ligne WORKER_SECRET=...
```

## Étape 3 — Vérifier que le worker tourne en local

```bash
# Démarrer le worker à la main pour tester
set -a; source worker/.env; set +a
node worker/index.js &
sleep 3
curl -s localhost:4020/health                 # attendu: {"ok":true,"role":"worker",...}
# Test extraction réelle (avec le secret)
curl -s -X POST localhost:4020/v1/extract -H 'content-type: application/json' \
  -H "x-worker-secret: $WORKER_SECRET" \
  -d '{"url":"https://example.com"}' | head -c 120
kill %1 2>/dev/null
```
Si tu vois le markdown de example.com → le worker marche.

## Étape 4 — Cloudflare Tunnel

### Cas A — Laurent a un domaine Cloudflare (recommandé)

🔴 **Action interactive** (ouvre un navigateur, Laurent doit se connecter à Cloudflare) :
```bash
cloudflared tunnel login
```

Puis (remplace `worker.tondomaine.com` par le vrai sous-domaine) :
```bash
cloudflared tunnel create x402-farm-worker
cloudflared tunnel route dns x402-farm-worker worker.tondomaine.com
```

Récupère l'UUID du tunnel et le chemin du fichier credentials :
```bash
ls ~/.cloudflared/*.json
cloudflared tunnel list
```

Crée `~/.cloudflared/config.yml` (remplace `<UUID>` et le hostname) :
```yaml
tunnel: x402-farm-worker
credentials-file: /Users/<utilisateur>/.cloudflared/<UUID>.json
ingress:
  - hostname: worker.tondomaine.com
    service: http://127.0.0.1:4020
  - service: http_status:404
```

### Cas B — Pas de domaine (test rapide)

```bash
# Démarre le worker en service d'abord (étape 5), puis :
cloudflared tunnel --url http://127.0.0.1:4020
# → donne une URL https://xxxx.trycloudflare.com (éphémère). À utiliser comme WORKER_URL.
# Ne pas utiliser les services launchd du tunnel dans ce cas (l'URL change à chaque run).
```

## Étape 5 — Services persistants (Cas A) + anti-veille

```bash
# Worker
launchctl unload ~/Library/LaunchAgents/com.x402farm.worker.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.x402farm.worker.plist

# Tunnel (Cas A uniquement)
launchctl unload ~/Library/LaunchAgents/com.x402farm.tunnel.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.x402farm.tunnel.plist

# Empêcher la mise en veille (le mini doit rester joignable)
sudo pmset -a sleep 0 disksleep 0 womp 1
```

Vérifier :
```bash
curl -s https://worker.tondomaine.com/health   # ou l'URL trycloudflare
# attendu: {"ok":true,"role":"worker"}
tail -5 /tmp/x402farm-worker.log
tail -5 /tmp/x402farm-tunnel.log
```

## Étape 6 — Brancher Vercel sur le worker

🔴 **Action Laurent** (ou toi si `vercel` CLI est connecté ici) — ajouter 2 variables d'env production sur le projet Vercel `x402-farm` :
```
WORKER_URL=https://worker.tondomaine.com      (ou l'URL trycloudflare)
WORKER_SECRET=<le secret de worker/.env>
```
Puis redéployer :
```bash
# si vercel CLI dispo et lié au projet
printf '%s' "https://worker.tondomaine.com" | vercel env add WORKER_URL production
printf '%s' "<secret>" | vercel env add WORKER_SECRET production
vercel deploy --prod --yes
```
(Sinon, le faire dans le dashboard Vercel → Settings → Environment Variables, puis Redeploy.)

## Étape 7 — Vérifier le bout-en-bout

```bash
# Depuis n'importe où : cet appel est maintenant servi par le Mac mini (IP résidentielle)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://x402-farm.vercel.app/v1/extract \
  -H 'content-type: application/json' -d '{"url":"https://example.com"}'
# → 402 (normal : route payante). La preuve du routage : regarde /tmp/x402farm-worker.log
#   sur le mini, tu dois y voir passer la requête quand un paiement réel arrive.
```

Pour tester le chemin réel worker sans paiement, on peut temporairement pointer une route gratuite dessus, ou faire un paiement x402 de test. À ce stade, l'essentiel : `worker/health` répond via le tunnel et Vercel a `WORKER_URL`.

## Rapport final attendu

À la fin, donne à Laurent :
- ✅/❌ worker en service (launchctl list | grep x402farm)
- l'URL publique du tunnel (`https://worker...` ou trycloudflare)
- le `WORKER_SECRET` à mettre sur Vercel (s'il ne l'a pas déjà fait)
- confirmation que `curl .../health` répond via le tunnel

## Dépannage

- **`cloudflared: command not found`** → `brew install cloudflared`
- **worker 401** → le `x-worker-secret` envoyé ≠ `WORKER_SECRET` du worker. Vérifier que Vercel a le même secret que `worker/.env`.
- **tunnel ne démarre pas** → vérifier `~/.cloudflared/config.yml` (chemin credentials, hostname) et `cloudflared tunnel list`.
- **le worker meurt** → `tail /tmp/x402farm-worker.err` ; souvent Chromium manquant → `cd ~/x402-farm && npx playwright install chromium`.
- **fallback** : si le tunnel est down, Vercel utilise son Playwright serverless — les routes marchent, sans IP résidentielle. Pas d'urgence à réparer.

## Sécurité

- Ne commite JAMAIS `worker/.env` (déjà dans `.gitignore`).
- Le worker n'accepte que les requêtes avec le bon `x-worker-secret` (seul Vercel le connaît).
- Tunnel sortant chiffré : aucun port entrant ouvert sur la box.
