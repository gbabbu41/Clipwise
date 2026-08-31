import type { Client } from "@/lib/database.types";

// ── Client identity & de-duplication ────────────────────────────────────────
// The rule: a person's identity is their EMAIL or PHONE. The name is only a
// label. Two records are the same person if they share a strong identifier
// (email or phone); name alone never merges (two people can share a name).
//
// This is solved as connected components (union-find) over the email/phone
// tokens: a record that carries BOTH an email and a phone links them, so even a
// record that only has the phone still joins the same person. That's what lets
// an online booking (email+phone) and a phone-only walk-in for the same customer
// group together — and keeps two different "ABC"s with different numbers apart.

/** Lowercase + trim — so `ABC@x.com` and `abc@x.com ` are the same key. */
export const normEmail = (e?: string | null): string => (e ?? "").trim().toLowerCase();

/** Digits only, last 10 (drops a leading country "1") — so `506-555-0000`,
 *  `(506) 555 0000` and `15065550000` all match. */
export const normPhone = (p?: string | null): string => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
};

/** Trim + collapse spaces + lowercase — for comparison only (display keeps the
 *  original spelling). */
export const normName = (n?: string | null): string => (n ?? "").trim().replace(/\s+/g, " ").toLowerCase();

type IdRecord = { clientId?: string | null; email?: string | null; phone?: string | null; name?: string | null };

/** The strong identity tokens a record carries (email/phone). Empty for a
 *  name-only walk-in. */
function strongTokens(r: IdRecord): string[] {
  const t: string[] = [];
  const cid = (r.clientId ?? "").trim();
  if (cid && !cid.startsWith("synthetic:")) t.push(`c:${cid}`); // the permanent link (phase 36)
  const e = normEmail(r.email); if (e) t.push(`e:${e}`);
  const p = normPhone(r.phone); if (p) t.push(`p:${p}`);
  return t;
}

/** Do two records belong to the same person? A shared client_id (the permanent
 *  link) is definitive; else shared email/phone. When NEITHER side has any
 *  strong id, fall back to an exact normalized-name match (best we can do for two
 *  anonymous walk-ins). A name-only record never merges into an id'd person. */
export function sameIdentity(a: IdRecord, b: IdRecord): boolean {
  const ac = (a.clientId ?? "").trim(), bc = (b.clientId ?? "").trim();
  if (ac && bc && !ac.startsWith("synthetic:") && ac === bc) return true;
  const ae = normEmail(a.email), be = normEmail(b.email);
  if (ae && be && ae === be) return true;
  const ap = normPhone(a.phone), bp = normPhone(b.phone);
  if (ap && bp && ap === bp) return true;
  const aStrong = !!(ac || ae || ap), bStrong = !!(bc || be || bp);
  if (!aStrong && !bStrong) { const an = normName(a.name), bn = normName(b.name); return !!an && an === bn; }
  return false;
}

type ApptRow = { client_id?: string | null; client_name?: string | null; client_email?: string | null; client_phone?: string | null; date?: string | null; status?: string | null; total_amount?: number | null };

/** Appointments store contact info as client_* fields — map to the common shape. */
export const apptToId = (a: ApptRow): IdRecord => ({ clientId: a.client_id, email: a.client_email, phone: a.client_phone, name: a.client_name });

// POS / walk-in sales live in `transactions` (no client_id, no phone) — attribute
// them to a person by email → name so a client's visits/spend include walk-in and
// product sales, not just booked appointments. Rows tied to an appointment
// (completion / no-show / anything with an appointment_id) are SKIPPED here: the
// appointment already counts them, so folding them again would double-count.
type TxRow = { client_name?: string | null; client_email?: string | null; created_at?: string | null; amount?: number | null; source?: string | null; refunded?: boolean | null; appointment_id?: string | null };
export const txToId = (t: TxRow): IdRecord => ({ email: t.client_email, name: t.client_name });
// A POS sale is only folded into a client when it carries an EMAIL — a strong id.
// Attributing by name alone is unreliable (two different same-named walk-ins would
// merge and over-count), so name-only POS sales are left unattributed rather than
// inflate someone's visits/spend.
const countableTx = (t: TxRow): boolean =>
  !t.refunded && !t.appointment_id && t.source !== "completion" && t.source !== "no_show"
  && !!normEmail(t.client_email);
const txDate = (t: TxRow): string => (t.created_at ?? "").slice(0, 10);

/** A client row's own id is its identity anchor. */
export const clientToId = (c: Client): IdRecord => ({ clientId: c.id, email: c.email, phone: c.phone, name: c.name });

/**
 * Build the de-duplicated client list with activity (visits/spend/last-visit)
 * attributed to the correct person by identity — not by name. Real client rows
 * carry loyalty/notes/etc.; customers who only exist in `appointments` become
 * synthetic rows (id `synthetic:…`). Within a person, the real row with the most
 * points is the representative (hidden duplicates get cleaned up by a merge tool
 * later). Pure function → easy to reason about and unit-test.
 */
export function groupClients(opts: { shopId: string; clientRows: Client[]; apptRows: ApptRow[]; txRows?: TxRow[] }): Client[] {
  const { shopId, clientRows, apptRows } = opts;
  const txRows = (opts.txRows ?? []).filter(countableTx);

  // ── Union-find over strong tokens ──
  const parent = new Map<string, string>();
  const add = (x: string) => { if (!parent.has(x)) parent.set(x, x); };
  const find = (x: string): string => {
    add(x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  for (const rec of [...clientRows.map(clientToId), ...apptRows.map(apptToId), ...txRows.map(txToId)]) {
    const t = strongTokens(rec);
    t.forEach(add);
    for (let i = 1; i < t.length; i++) union(t[0], t[i]);
  }

  // A record's component key: its (rooted) strong token, else a name bucket, so
  // two name-only "ABC"s group but a name-only never joins a strong-id person.
  const compOf = (r: IdRecord): string | null => {
    const t = strongTokens(r);
    if (t.length) return find(t[0]);
    const nm = normName(r.name);
    return nm ? `n:${nm}` : null;
  };

  // ── Activity per component (completed = a visit) ──
  const today = new Date().toISOString().slice(0, 10);
  type Agg = { visits: number; spent: number; last: string };
  const stats = new Map<string, Agg>();
  for (const a of apptRows) {
    const key = compOf(apptToId(a)); if (!key) continue;
    const g = stats.get(key) ?? { visits: 0, spent: 0, last: "" };
    // A visit — and "last visit" — is a COMPLETED appointment that has already
    // happened. A future/confirmed booking is NOT a past visit (it was showing up
    // as a "last visit" date in the future).
    if (a.status === "completed") {
      g.visits++; g.spent += a.total_amount ?? 0;
      if ((a.date ?? "") <= today && (a.date ?? "") > g.last) g.last = a.date ?? "";
    }
    stats.set(key, g);
  }
  // Fold in POS / walk-in sales (each countable sale = a visit + its amount),
  // attributed to the same person by identity — so total_spent reflects walk-ins
  // and product sales, not only booked appointments.
  for (const t of txRows) {
    const key = compOf(txToId(t)); if (!key) continue;
    const g = stats.get(key) ?? { visits: 0, spent: 0, last: "" };
    g.visits++; g.spent += t.amount ?? 0;
    const d = txDate(t); if (d > g.last) g.last = d;
    stats.set(key, g);
  }

  // ── Representative real row per component (most points wins on dupes) ──
  const rep = new Map<string, Client>();
  for (const row of clientRows) {
    const key = compOf(clientToId(row)); if (!key) continue;
    const cur = rep.get(key);
    if (!cur || (row.loyalty_points ?? 0) > (cur.loyalty_points ?? 0)) rep.set(key, row);
  }

  const out = new Map<string, Client>();
  for (const [key, row] of Array.from(rep)) {
    const g = stats.get(key) ?? { visits: 0, spent: 0, last: "" };
    out.set(key, { ...row, total_visits: g.visits, total_spent: g.spent, last_visit: g.last || row.last_visit });
  }

  // Synthetic rows for people who only exist in appointments.
  for (const a of apptRows) {
    if (!a.client_name) continue;
    const key = compOf(apptToId(a)); if (!key || out.has(key)) continue;
    const g = stats.get(key) ?? { visits: 0, spent: 0, last: "" };
    out.set(key, {
      id: `synthetic:${key}`,
      shop_id: shopId,
      name: a.client_name,
      email: a.client_email ?? undefined,
      phone: a.client_phone ?? undefined,
      total_visits: g.visits,
      total_spent: g.spent,
      last_visit: g.last || undefined,
      loyalty_points: 0,
      tag: g.visits >= 3 ? "Returning" : "New",
    } as unknown as Client);
  }

  // Synthetic rows for people who ONLY exist in POS transactions — a walk-in who
  // never booked and isn't in the clients table. Named only (anonymous walk-ins
  // with no name are skipped). Their stats already include the tx fold above.
  for (const t of txRows) {
    if (!t.client_name) continue;
    const key = compOf(txToId(t)); if (!key || out.has(key)) continue;
    const g = stats.get(key) ?? { visits: 0, spent: 0, last: "" };
    out.set(key, {
      id: `synthetic:${key}`,
      shop_id: shopId,
      name: t.client_name,
      email: t.client_email ?? undefined,
      total_visits: g.visits,
      total_spent: g.spent,
      last_visit: g.last || undefined,
      loyalty_points: 0,
      tag: g.visits >= 3 ? "Returning" : "New",
    } as unknown as Client);
  }

  return Array.from(out.values()).sort((a, b) => (b.total_visits ?? 0) - (a.total_visits ?? 0));
}
