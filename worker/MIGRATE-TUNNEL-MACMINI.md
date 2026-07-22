# Migration tunnel stable — à exécuter SUR LE MAC MINI avec Claude Code

> Donne ce fichier à Claude Code sur le Mac mini avec :
> « exécute les étapes de ce fichier » (ou copie-colle les blocs dans un terminal).

**Objectif** : remplacer le quick tunnel éphémère trycloudflare (URL qui change à chaque
reboot) par le tunnel Cloudflare nommé **`worker.x-402.online`** (URL fixe, déjà configurée
côté Cloudflare et Vercel — rien d'autre à faire ailleurs).

**Ne PAS toucher** au service worker `com.x402farm.worker` (port 4020) : il reste tel quel.

---

## Étape 1 — Vérifier l'état actuel

```bash
# Le worker doit tourner (sinon rien à tunneler)
curl -s http://localhost:4020/health
# attendu : {"ok":true,"role":"worker",...}

# cloudflared doit être installé
which cloudflared && cloudflared --version
```

Si le worker ne répond pas : `launchctl load ~/Library/LaunchAgents/com.x402farm.worker.plist` puis re-tester.

## Étape 2 — Installer le tunnel stable (LA commande)

```bash
sudo cloudflared service install <TOKEN_CONNECTEUR — voir ~/x402-farm/.tunnel-connector.token sur le MacBook Air>
```

- Le token identifie le tunnel `x402-worker` (id `0c4affbb-8edb-42f9-b492-a3ca85b84d58`).
- La config (ingress `worker.x-402.online → http://localhost:4020`) vit chez Cloudflare :
  aucun fichier config.yml à écrire.
- Le service (`com.cloudflare.cloudflared`, LaunchDaemon système) redémarre seul à chaque boot.

Si `sudo cloudflared service install` dit qu'un service existe déjà :
`sudo cloudflared service uninstall` puis relancer l'install.

## Étape 3 — Couper l'ANCIEN quick tunnel (et seulement lui)

```bash
launchctl unload ~/Library/LaunchAgents/com.x402farm.tunnel.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/com.x402farm.tunnel.plist
# tuer un éventuel process quick-tunnel restant (PAS le service système fraîchement installé)
pkill -f "trycloudflare|tunnel --url" 2>/dev/null || true
```

Vérifier que le worker n'a pas été touché :

```bash
launchctl list | grep x402farm
# attendu : com.x402farm.worker présent, com.x402farm.tunnel absent
curl -s http://localhost:4020/health
```

## Étape 4 — Vérification finale (bout en bout)

```bash
sleep 5
curl -s https://worker.x-402.online/health
# attendu : {"ok":true,"role":"worker",...}
```

- ✅ Si ça répond : terminé. La LED « Worker » du dashboard
  `https://api.x-402.online/dashboard?token=…` passe au vert sous ~60 s.
- ❌ Si 530 persiste après ~1 min : `sudo launchctl print system/com.cloudflare.cloudflared | head -30`
  et regarder les logs `/Library/Logs/com.cloudflare.cloudflared.err.log`.

## Étape 5 — Test reboot (optionnel mais recommandé)

Redémarrer le Mac mini, attendre 2 min, puis :

```bash
curl -s https://worker.x-402.online/health && curl -s http://localhost:4020/health
```

Les deux doivent répondre sans aucune intervention. C'est tout l'intérêt : plus jamais
d'URL à mettre à jour sur Vercel.
