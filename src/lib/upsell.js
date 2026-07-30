// Orientation de la demande DANS notre surface : quand un agent se fait bloquer en
// scrapant (résultat vide, 403, captcha), il a PILE le besoin que notre proxy mobile
// résout. On transforme donc chaque blocage en pointeur vers `exit=mobile` et le proxy.
// C'est le seul « mécanisme » réaliste : on ne pousse pas de demande, on capte celle qui
// touche déjà notre surface au moment exact du besoin.

const isMobile = (req) => String(req.query?.exit || req.body?.exit || "").toLowerCase() === "mobile";

// À merger dans une réponse d'ÉCHEC ou de résultat vide d'une route navigateur.
export function blockHint(req) {
  if (isMobile(req)) return { note: "Already on the mobile exit. If still blocked, the target may be down or the query has no match." };
  const sep = (req.originalUrl || req.path).includes("?") ? "&" : "?";
  return {
    likely_blocked: "The target may be blocking datacenter/residential IPs. Mobile-carrier IPs are the hardest class to block.",
    retry_from_mobile_ip: {
      how: "add exit=mobile to this same request",
      example: `${req.path}${sep}exit=mobile`,
      note: "routes through a real 4G/5G carrier IP (Orange, AS16028)",
    },
    or_buy_a_dedicated_proxy: { fact_sheet: "/proxy", metered: "/v1/mobile-proxy/1gb", monthly_port: "/v1/proxy/port/30d" },
  };
}

// À merger dans une réponse RÉUSSIE mais MAIGRE (peu de résultats en mode résidentiel) :
// suggestion discrète, sans crier au blocage.
export function thinResultHint(req, count, expected = 5) {
  if (isMobile(req) || count >= expected) return {};
  return { few_results_hint: `Only ${count} result(s). If a site is rate-limiting this IP, retry with exit=mobile (real carrier IP).` };
}
