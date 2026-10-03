import type { Client } from "@/lib/database.types";

// Persisted client IDs are identity anchors. Historical contacts are aliases,
// never instructions to merge two saved people or move their points.

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

/** Match current contact records without merging shared-family-phone identities. */
export function identityCandidates<T extends { id: string; email?: string | null; phone?: string | null; name?: string | null }>(rows: T[], r: IdRecord): T[] {
  const email = normEmail(r.email), phone = normPhone(r.phone), name = normName(r.name);
  if (email) {
    const exact = rows.filter(c => normEmail(c.email) === email);
    if (exact.length) return exact;
  }
  if (phone) return rows.filter(c => normPhone(c.phone) === phone && (!email || !normEmail(c.email) || normEmail(c.email) === email));
  if (!email && name) return rows.filter(c => !normEmail(c.email) && !normPhone(c.phone) && normName(c.name) === name);
  return [];
}

/** Do two records belong to the same person? A shared client_id (the permanent
 *  link) is definitive; else shared email/phone. When NEITHER side has any
 *  strong id, fall back to an exact normalized-name match (best we can do for two
 *  anonymous walk-ins). A name-only record never merges into an id'd person. */
export function sameIdentity(a: IdRecord, b: IdRecord): boolean {
  const ac = (a.clientId ?? "").trim(), bc = (b.clientId ?? "").trim();
  if (ac && bc && !ac.startsWith("synthetic:") && !bc.startsWith("synthetic:")) return ac === bc;
  const ae = normEmail(a.email), be = normEmail(b.email);
  if (ae && be) return ae === be;
  const ap = normPhone(a.phone), bp = normPhone(b.phone);
  if (ap && bp && ap === bp) return true;
  const aStrong = !!(ac || ae || ap), bStrong = !!(bc || be || bp);
  if (!aStrong && !bStrong) { const an = normName(a.name), bn = normName(b.name); return !!an && an === bn; }
  return false;
}

type ApptRow = { shop_id?: string | null; client_id?: string | null; client_name?: string | null; client_email?: string | null; client_phone?: string | null; date?: string | null; status?: string | null; total_amount?: number | null; payment_status?: string | null };
// Lifetime spend counts money actually kept: a refunded visit nets to $0 (sale −
// refund), and an unpaid / failed / released one was never collected. The VISIT
// still counts (the service happened). Rows without a payment_status keep counting.
const NOT_SPENT = new Set(["refunded", "unpaid", "failed", "voided", "pending"]);
export const apptSpend = (a: ApptRow): number => NOT_SPENT.has(a.payment_status ?? "") ? 0 : (a.total_amount ?? 0);

/** Appointments store contact info as client_* fields — map to the common shape. */
export const apptToId = (a: ApptRow): IdRecord => ({ clientId: a.client_id, email: a.client_email, phone: a.client_phone, name: a.client_name });

// POS / walk-in sales live in `transactions` (no client_id, no phone) — attribute
// them to a person by email → name so a client's visits/spend include walk-in and
// product sales, not just booked appointments. Rows tied to an appointment
// (completion / no-show / anything with an appointment_id) are SKIPPED here: the
// appointment already counts them, so folding them again would double-count.
type TxRow = { shop_id?: string | null; client_name?: string | null; client_email?: string | null; created_at?: string | null; amount?: number | null; source?: string | null; refunded?: boolean | null; appointment_id?: string | null };
export const txToId = (t: TxRow): IdRecord => ({ email: t.client_email, name: t.client_name });
// A POS sale is only folded into a client when it carries an EMAIL — a strong id.
// Attributing by name alone is unreliable (two different same-named walk-ins would
// merge and over-count), so name-only POS sales are left unattributed rather than
// inflate someone's visits/spend.
// A refunded POS sale nets to $0 lifetime spend (sale − refund), and a refund row
// is money handed back, never a visit — both are left out.
const countableTx = (t: TxRow): boolean =>
  !t.refunded && t.source !== "refund" && !t.appointment_id && t.source !== "completion" && t.source !== "no_show"
  && !!normEmail(t.client_email);
const txDate = (t: TxRow): string => (t.created_at ?? "").slice(0, 10);

/** A client row's own id is its identity anchor. */
export const clientToId = (c: Client): IdRecord => ({ clientId: c.id, email: c.email, phone: c.phone, name: c.name });

/**
 * Build the de-duplicated client list with activity (visits/spend/last-visit)
 * attributed to the correct person by identity — not by name. Real client rows
 * carry loyalty/notes/etc.; customers who only exist in `appointments` become
 * synthetic rows (id `synthetic:…`). Saved rows remain separate; unlinked activity attaches only to a unique
 * current-contact match. Linked historical contacts remain searchable aliases. Pure function → easy to reason about and unit-test.
 */
export function groupClients(opts: { shopId: string; clientRows: Client[]; apptRows: ApptRow[]; txRows?: TxRow[] }): Client[] {
  const { shopId } = opts;
  const clientRows = opts.clientRows.filter(c => c.shop_id === shopId);
  const apptRows = opts.apptRows.filter(a => !a.shop_id || a.shop_id === shopId);
  const txRows = (opts.txRows ?? []).filter(t => (!t.shop_id || t.shop_id === shopId) && countableTx(t));
  const compOf = (r: IdRecord): string | null => {
    const cid = r.clientId?.trim();
    if (cid && !cid.startsWith("synthetic:")) return clientRows.some(c => c.id === cid) ? `c:${cid}` : null;
    const matches = identityCandidates(clientRows, r);
    if (matches.length === 1) return `c:${matches[0].id}`;
    // Ambiguous/unlinked history stays separate, rather than choosing a balance.
    const email = normEmail(r.email), phone = normPhone(r.phone), name = normName(r.name);
    return email ? `e:${email}` : phone ? `p:${phone}` : name ? `n:${name}` : null;
  };
  const aliases = new Map<string, IdRecord[]>();
  for (const r of [...apptRows.map(apptToId), ...txRows.map(txToId)]) {
    const key = compOf(r);
    if (key) aliases.set(key, [...(aliases.get(key) ?? []), r]);
  }

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
      g.visits++; g.spent += apptSpend(a);
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

  // Keep every saved identity, its own VIP tag, notes and balance visible.
  const rep = new Map(clientRows.map(row => [`c:${row.id}`, row]));

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

  return Array.from(out.entries()).map(([key, row]) => ({ ...row, client_aliases: aliases.get(key) ?? [] })).sort((a, b) => (b.total_visits ?? 0) - (a.total_visits ?? 0));
}
