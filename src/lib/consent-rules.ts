// Pure CASL consent rules — NO server-only imports, so this is safe to use from
// client components (e.g. the Marketing page's reachable-count) AND the server.
// The DB-writing helpers live in ./consent (server-only, they need supabaseAdmin).

const IMPLIED_CONSENT_DAYS = 730; // 24 months (CASL existing-business-relationship window)

/** Does this string look like a real IP? Used to guard the `inet` columns —
 *  a malformed proxy value would fail the DB cast and silently drop the whole
 *  consent write, so we null it instead. */
export function isValidIp(s: string | null | undefined): boolean {
  if (!s) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return s.split(".").every((o) => Number(o) <= 255);
  return s.includes(":") && /^[0-9a-fA-F:]+$/.test(s); // loose IPv6
}

export type PromoEligibility = {
  promo_consent_status?: string | null;
  last_visit?: string | null;
};

/** Can this client receive PROMOTIONAL messages? Express consent ('granted') OR
 *  implied consent (a visit within 24 months). 'withdrawn' is a permanent hard
 *  block that overrides everything. One gate for every promo path. */
export function canReceivePromos(c: PromoEligibility): boolean {
  if (c.promo_consent_status === "withdrawn") return false; // permanent hard block
  if (c.promo_consent_status === "granted") return true;    // express consent on file
  // Never asked → rely on implied consent (a recent existing-business relationship).
  if (c.last_visit) {
    const last = Date.parse(`${c.last_visit}T00:00:00Z`);
    if (Number.isFinite(last) && last >= Date.now() - IMPLIED_CONSENT_DAYS * 86_400_000) {
      return true;
    }
  }
  return false;
}

/** Best-effort client IP from proxy headers (Vercel/most proxies set
 *  x-forwarded-for). Stored with an express-consent record as proof. */
export function clientIpFrom(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  const raw = xff ? xff.split(",")[0].trim() : req.headers.get("x-real-ip");
  return isValidIp(raw) ? raw : null; // never hand a malformed value to an inet column
}
