// Shared client search — the ONE matcher used everywhere clients are searched
// (add-appointment sheet, calendar quick-add, POS, the owner + barber clients
// pages, messages). Matches a query against the client's NAME, EMAIL, and PHONE.
//
// Phone matching is digits-only on BOTH sides, so a stored "(416) 555-1234" is
// found by "4165551234", "416 555", "555-1234", or "+1 416". Name/email are
// case-insensitive substring matches. An empty query matches everything (the
// caller decides whether to show all or nothing when the box is empty).

type ClientLike = {
  name?: string | null; client_name?: string | null;
  email?: string | null; client_email?: string | null;
  phone?: string | null; client_phone?: string | null;
};

/** True when `query` matches the client's name, email, or phone. */
export function clientMatchesQuery(c: ClientLike, query: string): boolean {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return true;
  const name = (c.name ?? c.client_name ?? "").toLowerCase();
  const email = (c.email ?? c.client_email ?? "").toLowerCase();
  const phone = (c.phone ?? c.client_phone ?? "").toLowerCase();
  if (name.includes(q) || email.includes(q) || phone.includes(q)) return true;
  // Digits-only phone match — ignores spaces, dashes, parens, and a +1 prefix.
  const qDigits = q.replace(/\D/g, "");
  if (qDigits.length >= 3) {
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits && phoneDigits.includes(qDigits)) return true;
  }
  return false;
}
