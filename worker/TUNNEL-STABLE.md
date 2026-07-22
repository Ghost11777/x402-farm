# Tunnel stable worker.x-402.online (Mac mini)

Le tunnel nommé `x402-worker` (id `0c4affbb-8edb-42f9-b492-a3ca85b84d58`) est déjà créé
côté Cloudflare, avec l'ingress `worker.x-402.online → http://localhost:4020` et le CNAME DNS.
Il remplace le quick tunnel éphémère trycloudflare (URL qui changeait à chaque reboot).

## Sur le Mac mini — une seule commande

```bash
sudo cloudflared service install $(cat /chemin/vers/.tunnel-connector.token)
```

Le token connecteur est dans `~/x402-farm/.tunnel-connector.token` sur le MacBook Air
(ou copier-coller le token que Claude a fourni dans la conversation).

Cette commande installe le service launchd officiel : le tunnel démarre tout seul à chaque
boot et garde TOUJOURS la même URL `https://worker.x-402.online`.

## Ensuite : couper l'ancien quick tunnel

```bash
launchctl list | grep -i cloudflare        # repérer l'ancien service quick-tunnel
sudo launchctl bootout system/<label-ancien-tunnel>   # ou launchctl unload du plist maison
```

(Le service worker (port 4020) ne bouge pas — seul le tunnel change.)

## Vérifier

```bash
curl https://worker.x-402.online/health
# → {"ok":true,"role":"worker",...}
```

Côté Vercel, `WORKER_URL=https://worker.x-402.online` est déjà en place.
La LED « Worker » du dashboard api.x-402.online/dashboard passe au vert dès que le tunnel est up.
