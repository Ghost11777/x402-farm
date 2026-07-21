import dns from "node:dns/promises";
import net from "node:net";

// Anti-SSRF : on ne visite que du web public. Sans ça, un agent pourrait nous faire
// requêter localhost, le métadata endpoint du cloud ou le réseau interne du VPS.
const PRIVATE_V4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return low === "::1" || low.startsWith("fe80:") || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("::ffff:127.");
  }
  return PRIVATE_V4.some((re) => re.test(ip));
}

export async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error("invalid_url"), { status: 400 });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw Object.assign(new Error("protocol_not_allowed"), { status: 400 });
  }
  const host = url.hostname;
  if (net.isIP(host) && isPrivateIp(host)) {
    throw Object.assign(new Error("private_address_blocked"), { status: 400 });
  }
  if (!net.isIP(host)) {
    let addrs;
    try {
      addrs = await dns.lookup(host, { all: true });
    } catch {
      throw Object.assign(new Error("dns_resolution_failed"), { status: 400 });
    }
    if (addrs.some((a) => isPrivateIp(a.address))) {
      throw Object.assign(new Error("private_address_blocked"), { status: 400 });
    }
  }
  return url;
}
