import { Router } from "express";
import { sweep, storeSweep } from "../lib/radar.js";

// GET /radar/run : lance un sweep du marché x402 et le persiste.
// Auth : ?token=ADMIN_TOKEN (manuel) ou Bearer CRON_SECRET (cron Vercel quotidien).
const router = Router();

router.get("/radar/run", async (req, res) => {
  const byToken = process.env.ADMIN_TOKEN && req.query.token === process.env.ADMIN_TOKEN;
  const byCron = process.env.CRON_SECRET && req.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!byToken && !byCron) return res.status(401).json({ error: "unauthorized" });
  try {
    const result = await sweep({ windowHours: 24 });
    const snapshotId = await storeSweep(result);
    res.json({
      ok: true, snapshotId,
      resume: {
        services_actifs: result.servicesActifs, txs: result.txs,
        payers: result.payers, volume_usd: result.volume,
      },
      top5: result.services.slice(0, 5).map((s) => ({ service: s.service, payers: s.payers, txs: s.txs, vol: s.volume_usd })),
      nous: result.services.find((s) => s.is_ours) || { payers: 0, txs: 0, note: "aucun paiement sur 24 h" },
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e).slice(0, 200) });
  }
});

export default router;
