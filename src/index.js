import app, { CATALOG } from "./app.js";
import { closeBrowser } from "./lib/browser.js";

const PORT = Number(process.env.PORT || 3402);
const server = app.listen(PORT, () => console.log(`x402-farm sur :${PORT} — ${CATALOG.length} APIs`));

process.on("SIGTERM", async () => {
  server.close();
  await closeBrowser();
  process.exit(0);
});
