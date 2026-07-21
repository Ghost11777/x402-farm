# x402-farm — Worker Mac mini + Cloudflare Tunnel

Le Mac mini exécute les routes « lourdes » (navigateur réel, **IP résidentielle**, sessions connectées persistantes) que Vercel ne peut pas assurer. Vercel garde le paywall x402 et **proxifie** ces routes vers le Mac mini via un tunnel Cloudflare chiffré (aucun port ouvert sur la box).

```
Agent → paie (x402) → Vercel [paywall + APIs rapides + découverte]
                          │ routes navigateur → proxy →
                          ▼
                Cloudflare Tunnel (chiffré)
                          ▼
                Mac mini worker [Playwright réel, IP résidentielle, comptes loggés]
```

## Pourquoi

- **IP résidentielle** : passe là où les IPs datacenter de Vercel sont bloquées (Cloudflare/DataDome…).
- **Sessions persistantes** : se connecter UNE fois à un portail (INPI, Infogreffe…) et garder la session ouverte 24/7 → APIs à accès verrouillé que l'agent ne peut pas atteindre seul.
- **Compute long** : pas de timeout serverless de 60 s.

## Installation (sur le Mac mini)

1. Cloner le repo et lancer le script :
   ```bash
   git clone https://github.com/Ghost11777/x402-farm.git && cd x402-farm
   bash worker/setup-macmini.sh
   ```
   Le script installe node + cloudflared, les dépendances, Chromium, génère le `WORKER_SECRET`, et écrit les services launchd.

2. Créer le tunnel Cloudflare (nécessite un domaine géré chez Cloudflare) :
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create x402-farm-worker
   cloudflared tunnel route dns x402-farm-worker worker.tondomaine.com
   ```
   Puis créer `~/.cloudflared/config.yml` (voir le modèle affiché par le script).

3. Charger les services persistants :
   ```bash
   launchctl load ~/Library/LaunchAgents/com.x402farm.worker.plist
   launchctl load ~/Library/LaunchAgents/com.x402farm.tunnel.plist
   ```

4. Empêcher la veille :
   ```bash
   sudo pmset -a sleep 0 disksleep 0 womp 1
   ```

5. Sur **Vercel**, ajouter deux variables puis redéployer :
   ```
   WORKER_URL=https://worker.tondomaine.com
   WORKER_SECRET=<le secret généré à l'étape 1>
   ```

## Vérifier

```bash
curl https://worker.tondomaine.com/health          # {"ok":true,"role":"worker"}
# Depuis Vercel, /v1/extract est maintenant servi par le Mac mini (IP résidentielle).
```

## Sécurité & fiabilité

- Le worker n'accepte que les requêtes portant `x-worker-secret` (seul Vercel le connaît). `/health` reste ouvert.
- Si le Mac mini est injoignable (box coupée…), Vercel **retombe automatiquement** sur son Playwright serverless — les routes ne tombent pas, elles perdent juste l'IP résidentielle.
- Tunnel sortant chiffré : aucun port entrant ouvert sur la box.
- Ethernet recommandé + `pmset` anti-veille.

## Sans domaine Cloudflare ?

Un « quick tunnel » gratuit sans domaine est possible pour tester :
```bash
cloudflared tunnel --url http://127.0.0.1:4020
```
Il donne une URL `*.trycloudflare.com` éphémère (change à chaque redémarrage) — à mettre dans `WORKER_URL` pour un essai, mais pas pour la prod (préfère un sous-domaine stable).
