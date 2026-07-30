# byol-monitor — Bring-Your-Own-Login monitoring

Watch **gated dashboards you're logged into** — marketplace seller consoles, ad accounts, supplier portals, anything with no export/API — and get alerted when a watched value changes. Runs on a **warm session held on a residential IP**, so it reaches surfaces datacenter scrapers and logged-out change-detectors can't.

## How it works

1. A persistent Chromium runs on the residential node with a durable profile (`~/.x402-browser-profile`) and CDP on `:9222` (`worker/browser-control.mjs`). You log into your accounts **once** in that browser (via screen-share) — the session stays warm.
2. `monitor.mjs` attaches to that browser over CDP, polls each target on its schedule, diffs the watched value against the last, and fires an alert on change.

The customer's own account, their consent, their data — no third-party scraping. The moat is the persistence of a real logged-in session on a residential network.

## Configure — `targets.json`

Each target:

| field | meaning |
|---|---|
| `id` / `label` | identifier + human name |
| `url` | page to open (in the logged-in context) |
| `selector` \| `json` \| `jsExpr` | what to read: a CSS selector's text, a dot-path on a JSON URL, or a JS expression |
| `intervalMin` | how often to check |
| `alertOn` | `change` (default), `increase`, `decrease` |
| `ntfy` \| `webhook` | where to alert (ntfy topic or POST webhook) |

Example — watch a seller dashboard's payout figure (logged in):
```json
{ "id": "amz-payout", "label": "Amazon next payout", "url": "https://sellercentral.amazon.com/payments/dashboard",
  "selector": ".payout-amount", "intervalMin": 60, "alertOn": "change", "ntfy": "my-alerts-xxxx" }
```

## Run

```bash
# 1) start the warm browser (once, on the node — log in via screen-share)
node ../worker/browser-control.mjs
# 2) run the monitor
node monitor.mjs          # loop (pm2: pm2 start monitor.mjs --name byol-monitor)
node monitor.mjs --once   # single pass, for testing
```

State is kept in `state.json`. First sight of a value = baseline (no alert); subsequent changes alert.
