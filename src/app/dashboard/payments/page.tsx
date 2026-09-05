"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { ExternalLink, RefreshCw, Send, CreditCard, Banknote, Clock, Check, ChevronLeft, ChevronRight, ChevronDown, SlidersHorizontal, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { FeatureLock } from "@/components/dashboard/feature-lock";
import { DashboardHeader } from "@/components/dashboard/page-header";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { supabase } from "@/lib/supabase";
import { formatCurrency, cn, timeToMinutes, timeAgo } from "@/lib/utils";
import { countablePosTxs, isNoShowTx, isPaid, lineNetFee } from "@/lib/revenue";
import { computeBarberEarnings, barberRowCut } from "@/lib/barber-earnings";

// ── Row shapes ────────────────────────────────────────────────────────────────
interface ApptRow {
  id: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  date: string;
  time_slot: string;
  total_amount: number | null;
  tax_amount: number | null;
  payment_status: string | null;
  payment_method: string | null;
  payment_intent_id: string | null;
  paid_at: string | null;
  created_at: string | null;
  status: string | null;
  services: { name: string } | null;
  barbers: { name: string } | null;
}
interface TxRow {
  id: string;
  client_name: string | null;
  client_email: string | null;
  service_name: string | null;
  amount: number;
  tip: number;
  tax: number | null;
  payment_method: string | null;
  type: string;
  // Per-barber earnings (mirror of the barber's own portal): who earned it, their
  // stored cut, and the card fee on the charge. Nullable — older rows may lack them.
  barber_id: string | null;
  commission_amount: number | null;
  stripe_fee: number | null;
  created_at: string;
  stripe_session_id: string | null;
  appointment_id: string | null;
  payment_intent_id: string | null;
  refunded: boolean | null;
  source: string | null;
}

function statusInfo(s: string | null): { label: string; tone: "good" | "warn" | "active" | "muted" } {
  switch (s) {
    case "paid": return { label: "Paid", tone: "good" };
    case "captured": return { label: "Paid · Card", tone: "good" };
    case "held": return { label: "Card on hold", tone: "active" };
    case "saved": return { label: "Card on file", tone: "active" };
    case "refunded": return { label: "Refunded", tone: "muted" };
    case "voided": return { label: "Hold released", tone: "muted" };
    case "failed": return { label: "Payment failed", tone: "warn" };
    case "unpaid": return { label: "Unpaid", tone: "warn" };
    default: return { label: "Unpaid", tone: "warn" };
  }
}
const toneClass: Record<string, string> = {
  good: "bg-[#00e5a0]/15 text-[#00e5a0]",
  warn: "bg-amber-500/15 text-amber-400",
  active: "bg-surface-overlay text-foreground",
  muted: "bg-surface-overlay text-grey",
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
};

// Mini CSS-bar sparkline for an earnings period card (green gradient bars,
// tallest highlighted). Renders only when there's a real trend to show.
function Spark({ data }: { data: { net: number }[] }) {
  // Buckets are per active day. One or two active days would render as a single
  // fat slab (or two lonely bars) that says nothing — so only draw the chart
  // once there are at least 3 active days. Fewer than that → clean card, no graph.
  const bars = data.slice(-14);
  const active = bars.filter(d => d.net > 0);
  if (active.length < 3) return null;
  const max = Math.max(...bars.map(d => d.net), 1);
  let peak = 0;
  bars.forEach((d, i) => { if (d.net > bars[peak].net) peak = i; });
  return (
    <div className="cwp-spark">
      {bars.map((d, i) => <i key={i} className={i === peak ? "cwp-peak" : ""} style={{ height: `${Math.max(8, (d.net / max) * 100)}%` }} />)}
    </div>
  );
}

export default function PaymentsPage() {
  const { shop, accessToken } = useAuth();
  const { confirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [appts, setAppts] = useState<ApptRow[]>([]);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [stripeNet, setStripeNet] = useState<{ connected: boolean; byPi: Record<string, { gross: number; fee: number; net: number }>; available: number; pending: number; inTransit?: number; nextPayoutDate?: number | null; nextPayoutAmount?: number | null; lastPayout?: { amount: number; date: number } | null } | null>(null);
  const [netSlide, setNetSlide] = useState(0);
  const netRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Barber filter
  const [barbers, setBarbers] = useState<{ id: string; name: string; commission_percent?: number }[]>([]);
  const [selectedBarber, setSelectedBarber] = useState("all");
  const [showBarberPicker, setShowBarberPicker] = useState(false);

  // Row expand + tx filter
  const [detailItem, setDetailItem] = useState<FeedItem | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [txFilter, setTxFilter] = useState<"all" | "card" | "cash" | "unpaid" | "refunded">("all");
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // Owner-only safety net: money that hit Stripe but isn't recorded in ClipWise
  // (e.g. a webhook Stripe never delivered). Read-only detection — surfaced in a
  // "Needs review" strip; acknowledged items are hidden per-browser (localStorage)
  // so a reviewed one never nags again. Never counted in any total.
  type UnrecItem = { id: string; flow: string; label: string; amountCents: number; created: number; email: string | null; name: string | null; last4: string | null };
  const [unrecorded, setUnrecorded] = useState<UnrecItem[]>([]);
  const [unrecDismissed, setUnrecDismissed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem("cw_unrec_dismissed") || "[]") as string[]); }
    catch { return new Set(); }
  });
  const dismissUnrec = (id: string) => {
    setUnrecDismissed(prev => {
      const next = new Set(prev); next.add(id);
      try { localStorage.setItem("cw_unrec_dismissed", JSON.stringify(Array.from(next))); } catch { /* private mode */ }
      return next;
    });
  };

  // Per-barber earnings window — mirrors the barber's own earnings page so the
  // owner can see a single barber's collected revenue for any pay cycle.
  // Per-barber view: swipeable carousel (this week → this month → all time) +
  // a dropdown for extra windows (last 14 days / last week / custom) that
  // override the shown card. ownerExtra "" = pure swipe.
  const [ownerExtra, setOwnerExtra] = useState<"" | "biweekly" | "lastweek" | "custom">("");
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showCustomModal, setShowCustomModal] = useState(false); // custom-range date picker popup
  // When a dropdown override is (de)selected, the visible card swaps — snap the
  // earnings carousel back to the first slide so the right card is shown.
  useEffect(() => {
    const ne = netRef.current; if (ne) ne.scrollTo({ left: 0 });
    setNetSlide(0);
  }, [ownerExtra]);

  // Desktop prev/next for the earnings rail — centers the target card (cards are
  // slightly narrower than the rail, so scroll to its offset, not i*width).
  const goToNet = (i: number) => {
    const el = netRef.current; if (!el) return;
    const cards = el.children;
    const j = Math.max(0, Math.min(cards.length - 1, i));
    const card = cards[j] as HTMLElement | undefined;
    if (card) el.scrollTo({ left: card.offsetLeft - (el.clientWidth - card.clientWidth) / 2, behavior: "smooth" });
  };

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    if (!shop) return;
    supabase.from("barbers").select("id, name, commission_percent").eq("shop_id", shop.id).eq("is_active", true).order("name")
      .then(({ data }) => setBarbers((data ?? []) as { id: string; name: string; commission_percent?: number }[]));
  }, [shop]);

  // Live Stripe figures (payout balance, exact net/fees). Pulled separately so we
  // can re-sync it on its own cadence (Stripe state doesn't fire Supabase events).
  const syncStripe = useCallback(async () => {
    if (!shop || !accessToken) return;
    try {
      // payments-summary is gated by authorizeShop (Bearer token). Without this
      // header it 401s, stripeNet stays null, and net/fees/payout silently vanish
      // (net falls back to gross, the Stripe-fee row never renders).
      const r = await fetch("/api/stripe/payments-summary", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shop.id }),
      });
      const d = r.ok ? await r.json() : null;
      if (d && !d.error) setStripeNet(d);
    } catch { /* transient/offline — keep last known figures */ }
  }, [shop, accessToken]);

  const loadData = useCallback(async () => {
    if (!shop) return;
    setLoading(true);
    // `client_email` is a newer transactions column — try it, but fall back to a
    // select without it so a shop that hasn't run the migration yet still loads its
    // transaction feed (the email row just doesn't show for POS until then).
    const TX_COLS = "id, client_name, service_name, amount, tip, tax, payment_method, type, barber_id, commission_amount, stripe_fee, created_at, stripe_session_id, appointment_id, payment_intent_id, refunded, source";
    const fetchTx = async (): Promise<{ data: unknown[] | null }> => {
      const run = (cols: string) => supabase.from("transactions").select(cols).eq("shop_id", shop.id).order("created_at", { ascending: false }).limit(2000);
      const withEmail = await run(`${TX_COLS}, client_email`);
      return withEmail.error ? await run(TX_COLS) : withEmail;
    };
    const [{ data: a }, { data: t }] = await Promise.all([
      supabase.from("appointments")
        .select("*, services(name), barbers(name)")
        .eq("shop_id", shop.id).or("total_amount.gt.0,status.eq.completed").order("date", { ascending: false }).limit(2000),
      fetchTx(),
    ]);
    setAppts((a ?? []) as unknown as ApptRow[]);
    setTxs((t ?? []) as unknown as TxRow[]);
    setLoading(false);
    syncStripe();
  }, [shop, syncStripe]);
  useEffect(() => { loadData(); }, [loadData]);

  // Keep the Stripe payout/balance figures live. A payout landing or the balance
  // moving never fires a Supabase change, so re-sync from Stripe when the tab
  // regains focus and on a light interval while the page is visible.
  useEffect(() => {
    if (!shop) return;
    const onVisible = () => { if (document.visibilityState === "visible") syncStripe(); };
    window.addEventListener("focus", syncStripe);
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(onVisible, 60000);
    return () => {
      window.removeEventListener("focus", syncStripe);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, [shop, syncStripe]);

  useEffect(() => {
    if (!accessToken || !shop?.id) return;
    let active = true;
    fetch("/api/stripe/reconcile-payments", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop.id }), // reconcile the ACTIVE location, not the newest
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (active && d?.updated > 0) loadData(); })
      .catch(() => {});
    return () => { active = false; };
  }, [accessToken, shop?.id, loadData]);

  // Owner-only: scan Stripe for money that isn't recorded in ClipWise. Read-only,
  // best-effort — a failure just shows nothing (never blocks the page).
  useEffect(() => {
    if (!accessToken || !shop?.id) return;
    let active = true;
    fetch("/api/stripe/unrecorded-payments", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop.id }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (active && Array.isArray(d?.items)) setUnrecorded(d.items as UnrecItem[]); })
      .catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, shop?.id]);

  useEffect(() => {
    if (!shop) return;
    // Coalesce bursts: a POS session or several appointments settling can fire
    // many row changes back-to-back, and each loadData is two 250-row queries
    // plus a ~9-call Stripe summary. Debounce to a single trailing reload.
    const debouncedReload = () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => loadData(), 800);
    };
    const ch = supabase
      .channel(`payments:${shop.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `shop_id=eq.${shop.id}` }, debouncedReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `shop_id=eq.${shop.id}` }, debouncedReload)
      .subscribe();
    return () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); supabase.removeChannel(ch); };
  }, [shop, loadData]);

  const apptDateMs = (a: ApptRow) => new Date(a.date + "T00:00:00").getTime() + timeToMinutes(a.time_slot) * 60000;

  type FeedItem = {
    key: string; name: string; sub: string; amount: number; tax: number;
    giftApplied?: number;   // gift-card value on this line — already counted at sale
    tipExtra?: number;      // booking tip NOT already inside `amount` (POS tips already are)
    statusLabel: string; tone: string; settled: boolean;
    ts: number; tsIso: string | null;
    pi: string | null; method: string | null; refunded: boolean;
    appt?: ApptRow;
    client_email?: string | null;   // customer email (appointment or POS) — shown in detail
    barberName?: string | null;     // barber served — shown in detail (POS drops it from `sub`)
    // Barber-earnings row (Payments filtered to one barber): `amount` already IS
    // that barber's take-home cut for the line, so display it directly instead of
    // running it through netOf()/feeOf() (which would re-net a Stripe fee that
    // the barber-earnings math already handles).
    earn?: boolean;
  };

  // Which transactions count as income — the SAME shared rule the Dashboard uses
  // (src/lib/revenue.ts), so the two can never disagree.
  const posTxs = countablePosTxs(appts, txs);

  // Balances collected LATER on an appointment (source "balance" txns — a raised
  // price the held card couldn't cover, paid via link/charge-on-file/cash). Each
  // is shown as its OWN feed row below, so the appointment must count only the
  // money its OWN card charge captured. We subtract this per-appointment sum (on
  // top of any still-owed balance_due) from the appointment line in balanceOf(),
  // so the appt + the balance row together sum to the real total with no double
  // count. Mirrors the dedicated "balance" loop in collectedTotals().
  const collectedBalanceByAppt = new Map<string, number>();
  for (const t of txs) {
    if (t.source !== "balance" || t.refunded) continue;
    if (!t.appointment_id) continue;
    const amt = (t.amount ?? 0) + (t.tax ?? 0) + (t.tip ?? 0);
    if (amt <= 0) continue;
    collectedBalanceByAppt.set(t.appointment_id, (collectedBalanceByAppt.get(t.appointment_id) ?? 0) + amt);
  }

  // PaymentIntents of paid appointments — a booking tip rides the appointment's
  // OWN intent, so its money is already inside that appointment row. Post-visit
  // tips (the tip-link flow) have their own intent and are dropped by
  // countablePosTxs, so they'd otherwise be counted nowhere on the owner side
  // (they only showed in the barber portal). Mirrors collectedTotals() exactly.
  const apptPiSet = new Set(
    appts.filter(a => isPaid(a.payment_status) && a.payment_intent_id).map(a => a.payment_intent_id as string),
  );

  const feedAll: FeedItem[] = [
    ...appts
      .filter(a => !(a.status === "no-show" && isPaid(a.payment_status)))
      .map((a): FeedItem => {
        const info = statusInfo(a.payment_status);
        const paid = isPaid(a.payment_status);
        const noCharge = !paid && (a.total_amount ?? 0) <= 0;
        const tsIso = paid ? (a.paid_at ?? a.created_at) : a.created_at;
        return {
          key: `a${a.id}`, name: a.client_name,
          sub: `${a.services?.name ?? "Service"}${a.barbers?.name ? ` · ${a.barbers.name}` : ""}`,
          amount: a.total_amount ?? 0, tax: a.tax_amount ?? 0,
          giftApplied: (a as { gift_applied?: number }).gift_applied ?? 0,
          tipExtra: (a as { tip_amount?: number }).tip_amount ?? 0,
          statusLabel: noCharge ? "No charge" : info.label,
          tone: noCharge ? "muted" : info.tone,
          settled: paid, tsIso,
          ts: tsIso ? new Date(tsIso).getTime() : apptDateMs(a),
          pi: a.payment_intent_id, method: a.payment_method,
          refunded: a.payment_status === "refunded", appt: a,
          client_email: a.client_email, barberName: a.barbers?.name ?? null,
        };
      }),
    ...posTxs.map((t): FeedItem => {
      const noShow = isNoShowTx(t);
      const refunded = !!t.refunded;
      const barberName = barbers.find(b => b.id === t.barber_id)?.name ?? null;
      return {
        key: `t${t.id}`, name: t.client_name || "Walk-in",
        sub: noShow ? (t.service_name ?? "No-show fee") : `${t.service_name || "Sale"}${barberName ? ` · ${barberName}` : ""} · POS`,
        amount: (t.amount ?? 0) + (t.tip ?? 0), tax: t.tax ?? 0,
        statusLabel: refunded ? "Refunded" : (noShow ? "No-show · Paid" : (t.payment_method === "cash" ? "Paid · Cash" : "Paid · Card")),
        tone: refunded ? "muted" : "good",
        settled: !refunded, tsIso: t.created_at,
        ts: new Date(t.created_at).getTime(),
        pi: t.payment_intent_id ?? null, method: t.payment_method, refunded,
        client_email: t.client_email, barberName,
      };
    }),
    // Post-visit tips (tip-link flow). `completion` txns are dropped by
    // countablePosTxs, but a post-visit tip is real money that hit the shop's
    // Stripe on its OWN intent — surface it as its own line so the owner sees it.
    // Skip booking tips (pi shares a paid appointment's intent → already counted).
    ...txs
      .filter(t => t.source === "completion" && !t.refunded && (t.tip ?? 0) > 0
        && !(t.payment_intent_id && apptPiSet.has(t.payment_intent_id)))
      .map((t): FeedItem => ({
        key: `tip${t.id}`, name: t.client_name || "Client",
        sub: "Tip · post-visit",
        amount: t.tip ?? 0, tax: 0,
        statusLabel: t.payment_method === "cash" ? "Tip · Cash" : "Tip · Card",
        tone: "good",
        settled: true, tsIso: t.created_at,
        ts: new Date(t.created_at).getTime(),
        pi: t.payment_intent_id ?? null, method: t.payment_method, refunded: false,
      })),
    // Collected BALANCES (source "balance") — the leftover on a raised price the
    // held card couldn't cover, paid later by link / card-on-file / cash. Real
    // money on its OWN intent, so it shows as its own line; the appointment row it
    // belongs to counts only its own charge (balanceOf subtracts this), so the two
    // never double-count. Key prefix `b` → refundItem's key.slice(1) yields the tx id.
    ...txs
      .filter(t => t.source === "balance" && !t.refunded && ((t.amount ?? 0) + (t.tax ?? 0) + (t.tip ?? 0)) > 0)
      .map((t): FeedItem => {
        const bName = barbers.find(b => b.id === t.barber_id)?.name ?? null;
        return {
          key: `b${t.id}`, name: t.client_name || "Client",
          sub: `Balance collected${bName ? ` · ${bName}` : ""}`,
          amount: (t.amount ?? 0) + (t.tax ?? 0) + (t.tip ?? 0), tax: t.tax ?? 0,
          statusLabel: t.payment_method === "cash" ? "Balance · Cash" : "Balance · Card",
          tone: "good",
          settled: true, tsIso: t.created_at,
          ts: new Date(t.created_at).getTime(),
          pi: t.payment_intent_id ?? null, method: t.payment_method, refunded: false,
          client_email: t.client_email, barberName: bName,
        };
      }),
  ];

  // Net + fee per charge — the SAME shared helper the Dashboard's revenue math
  // uses, so Stripe fees are applied identically in both places.
  // What the customer actually paid on this line = amount + booking tip − gift
  // already applied. ADD the booking tip (POS tips are already in `amount`) so a
  // tipped booking's line matches the real Stripe charge; SUBTRACT the gift value
  // (counted at sale) and any still-owed balance_due (a partial capture collected
  // less than total). Matches src/lib/revenue.ts so the two never differ.
  // What of this appointment's total is NOT on its own charge line: still-owed
  // balance_due PLUS any balance already collected on a separate "balance" row
  // (shown as its own line above). Subtracting both leaves the appointment
  // counting exactly the money its own intent captured — no double-count.
  const balanceOf = (i: FeedItem) => {
    const a = i.appt as { id?: string; balance_due?: number | null } | undefined;
    if (!a) return 0;
    const due = Math.max(0, a.balance_due ?? 0);
    const collectedElsewhere = a.id ? (collectedBalanceByAppt.get(a.id) ?? 0) : 0;
    return due + collectedElsewhere;
  };
  const counted = (i: FeedItem) => Math.max(0, i.amount + (i.tipExtra ?? 0) - (i.giftApplied ?? 0) - balanceOf(i));
  const netOf = (i: FeedItem) => lineNetFee(i.pi, counted(i), stripeNet?.byPi).net;
  const feeOf = (i: FeedItem) => lineNetFee(i.pi, counted(i), stripeNet?.byPi).fee;

  // Barber name — used to scope the appointment-based bits still shown in barber
  // mode (the Outstanding / On-file tiles). The earnings cards + statement below
  // are sourced from that barber's TRANSACTIONS instead (see barber mode).
  const barberName = selectedBarber !== "all" ? (barbers.find(b => b.id === selectedBarber)?.name ?? null) : null;
  const barberFirst = barberName?.split(" ")[0] ?? "";
  // ── Per-barber EARNINGS mode ────────────────────────────────────────────────
  // When a specific barber is picked, the whole earnings view (cards + statement)
  // becomes an exact mirror of that barber's OWN portal: their cut (commission %)
  // + 100% tips, computed from THEIR transactions with the shared calculator, so
  // the two screens can never disagree. "Shop (all barbers)" is unchanged — it
  // stays the shop's collected-revenue / payout view.
  const barberMode = selectedBarber !== "all";
  const selPct = barberMode ? (barbers.find(b => b.id === selectedBarber)?.commission_percent ?? 0) : 0;
  const barberEarnTx = barberMode
    ? txs.filter(t => t.barber_id === selectedBarber && !t.refunded
        // No-show penalty fees aren't the barber's earnings — exclude them so this
        // per-barber view matches what the barber sees in their own portal.
        && t.source !== "no_show" && !(t.service_name ?? "").startsWith("No-show fee"))
        .map(t => ({ ...t, ts: new Date(t.created_at).getTime() }))
    : [];
  // Earnings for one window = the shared barber-earnings math over that barber's
  // transactions in [from, to], plus a per-bucket take-home series for the spark.
  const earnScope = (from: number, to: number, monthly: boolean) => {
    const inWin = barberEarnTx.filter(t => t.ts >= from && t.ts <= to);
    const e = computeBarberEarnings(inWin, selPct);
    const m = new Map<string, { order: number; net: number }>();
    inWin.forEach(t => {
      const dt = new Date(t.ts);
      const order = monthly ? dt.getFullYear() * 12 + dt.getMonth() : Math.floor(t.ts / 86400000);
      const label = monthly
        ? dt.toLocaleDateString("en-CA", { month: "short" })
        : dt.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
      const cur = m.get(label) ?? { order, net: 0 };
      cur.net += barberRowCut(t, selPct); m.set(label, cur);
    });
    const data = Array.from(m, ([label, v]) => ({ label, net: v.net, order: v.order })).sort((a, b) => a.order - b.order);
    return { take: e.youKeep, commission: e.commission, tips: e.tips, feeShare: e.barberFeeShare, count: e.count, avg: e.avgTicket, data };
  };
  // Statement rows for barber mode — one per transaction, showing that barber's
  // earned cut (commission + tip). `earn:true` tells the row/modal to show
  // `amount` as-is instead of re-netting a Stripe fee.
  const barberFeed: FeedItem[] = barberEarnTx.map((t): FeedItem => ({
    key: `be${t.id}`, name: t.client_name || "Client",
    sub: t.service_name || "Service",
    amount: barberRowCut(t, selPct), tax: 0,
    statusLabel: t.payment_method === "cash" ? "Paid · Cash" : "Paid · Card",
    tone: "good", settled: true, tsIso: t.created_at, ts: t.ts,
    pi: t.payment_intent_id ?? null, method: t.payment_method, refunded: false, earn: true,
  }));
  const scopedSettled = feedAll.filter(i => i.settled && (!barberName || i.appt?.barbers?.name === barberName));
  const cardSettled = scopedSettled.filter(i => i.method !== "cash");
  const cashSettled = scopedSettled.filter(i => i.method === "cash");
  // Payouts settle to the shop's connected account (shop-level, not per barber yet).
  // Hero = Stripe's Total balance: everything not yet in the bank — funds still
  // settling (available + pending) plus payouts already on the way (in-transit).
  const payout = (stripeNet?.available ?? 0) + (stripeNet?.pending ?? 0) + (stripeNet?.inTransit ?? 0);

  const startOf = (kind: "today" | "week" | "biweekly" | "month") => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    // Sunday-start week, to match the Dashboard/Analytics shared getDateRange
    // (was Monday-start here, so "This Week" totals disagreed across screens).
    if (kind === "week") d.setDate(d.getDate() - d.getDay());
    else if (kind === "biweekly") d.setDate(d.getDate() - 13);   // trailing 14 days
    else if (kind === "month") d.setDate(1);
    return d.getTime();
  };
  // Small "Jul 23 – Jul 29" caption so each period card shows its actual dates.
  const fmtDay = (ts: number) => new Date(ts).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  const rangeFor = (key: "week" | "month" | "all" | "biweekly" | "lastweek") => {
    const ws = startOf("week");
    if (key === "week") return `${fmtDay(ws)} – ${fmtDay(ws + 6 * 86400000)}`;
    if (key === "biweekly") return `${fmtDay(startOf("biweekly"))} – ${fmtDay(Date.now())}`;
    if (key === "lastweek") return `${fmtDay(ws - 7 * 86400000)} – ${fmtDay(ws - 86400000)}`;
    if (key === "month") { const d = new Date(); return `${fmtDay(startOf("month"))} – ${fmtDay(new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime())}`; }
    return ""; // all time — no fixed range
  };

  // ── Per-barber window (collected revenue) — same presets + Custom range as the
  // barber's own earnings page, so a single barber's pay-cycle is easy to read.
  const fmtShort = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  // Per-barber scope for an arbitrary window — net collected, breakdown chart, totals.
  const computeScope = (from: number, to: number, monthly: boolean) => {
    const within = (i: FeedItem) => i.ts >= from && i.ts <= to;
    const cardIn = cardSettled.filter(within);
    const cashIn = cashSettled.filter(within);
    const net = cardIn.reduce((s, i) => s + netOf(i), 0);
    const cash = cashIn.reduce((s, i) => s + counted(i), 0);
    const gross = cardIn.reduce((s, i) => s + counted(i), 0);
    const fees = cardIn.reduce((s, i) => s + feeOf(i), 0);
    const tax = [...cardIn, ...cashIn].reduce((s, i) => s + (i.tax ?? 0), 0);
    const count = cardIn.length + cashIn.length;
    const m = new Map<string, { order: number; net: number }>();
    // Chart the NET COLLECTED per bucket — card net (after fees) + cash — so the
    // sparkline matches the card's net headline. netOf() returns gross for cash
    // (no fee), so cash-only periods still draw bars.
    [...cardIn, ...cashIn].forEach(i => {
      const dt = new Date(i.ts);
      const order = monthly ? dt.getFullYear() * 12 + dt.getMonth() : Math.floor(i.ts / 86400000);
      const label = monthly
        ? dt.toLocaleDateString("en-CA", { month: "short" })
        : dt.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
      const cur = m.get(label) ?? { order, net: 0 };
      cur.net += netOf(i); m.set(label, cur);
    });
    const data = Array.from(m, ([label, v]) => ({ label, net: v.net, order: v.order })).sort((a, b) => a.order - b.order);
    return { net, cash, gross, fees, tax, count, data, avg: count ? (gross + cash) / count : 0 };
  };
  // The extra window picked from the dropdown (overrides the shown card). null = pure swipe.
  const nowTs = Date.now();
  const ownerExtraPeriod = (() => {
    if (ownerExtra === "biweekly") return { label: "Last 14 days", range: rangeFor("biweekly"), from: startOf("biweekly"), to: nowTs, monthly: false };
    if (ownerExtra === "lastweek") {
      const thisWeek = startOf("week");
      return { label: "Last week", range: rangeFor("lastweek"), from: thisWeek - 7 * 86400000, to: thisWeek - 1, monthly: false }; // previous calendar week
    }
    if (ownerExtra === "custom") {
      const from = customFrom ? new Date(customFrom + "T00:00:00").getTime() : 0;
      const to = customTo ? new Date(customTo + "T23:59:59.999").getTime() : nowTs;
      const label = (customFrom || customTo)
        ? `${customFrom ? fmtShort(customFrom) : "…"} – ${customTo ? fmtShort(customTo) : "…"}`
        : "Custom range";
      return { from, to, label, range: "", monthly: (to - from) > 62 * 86400000 }; // label already shows the range
    }
    return null;
  })();
  // Default view = swipeable carousel of the three main windows. A dropdown
  // override (last 14 / last week / custom) replaces it with a single static card.
  // ONE card builder for both modes: shop = collected (card net + cash); barber =
  // that barber's take-home (their % + tips), the exact figure from their portal.
  type PeriodCard = {
    mode: "shop" | "barber"; label: string; range: string;
    headline: number;        // the big number (collected, or take-home)
    commission: number; tips: number; feeShare: number; // barber-mode ledger
    fees: number; tax: number; cash: number;            // shop-mode ledger
    count: number; avg: number; data: { label: string; net: number }[];
  };
  const mkCard = (from: number, to: number, monthly: boolean, label: string, range: string): PeriodCard => {
    if (barberMode) {
      const e = earnScope(from, to, monthly);
      return { mode: "barber", label, range, headline: e.take, commission: e.commission, tips: e.tips, feeShare: e.feeShare, fees: 0, tax: 0, cash: 0, count: e.count, avg: e.avg, data: e.data };
    }
    const s = computeScope(from, to, monthly);
    return { mode: "shop", label, range, headline: s.net + s.cash, commission: 0, tips: 0, feeShare: 0, fees: s.fees, tax: s.tax, cash: s.cash, count: s.count, avg: s.avg, data: s.data };
  };
  const carouselWindows = [
    { label: "This week", range: rangeFor("week"), from: startOf("week"), to: nowTs, monthly: false },
    { label: "This month", range: rangeFor("month"), from: startOf("month"), to: nowTs, monthly: false },
    { label: "All time", range: "", from: 0, to: Infinity, monthly: true },
  ];
  const scopedAppts = appts.filter(a => !barberName || a.barbers?.name === barberName);
  const outstandingAppts = scopedAppts.filter(a => a.payment_status === "unpaid" || a.payment_status === "failed" || !a.payment_status);
  const pendingAppts = scopedAppts.filter(a => a.payment_status === "held" || a.payment_status === "saved");
  // Money still owed on SETTLED appointments (a price raised above the held card
  // left an uncollected balance) — count it as outstanding alongside unpaid ones.
  const partialBalances = scopedAppts.filter(a => isPaid(a.payment_status) && ((a as { balance_due?: number | null }).balance_due ?? 0) > 0);
  const partialBalanceTotal = partialBalances.reduce((s, a) => s + Math.max(0, (a as { balance_due?: number | null }).balance_due ?? 0), 0);
  const outstanding = outstandingAppts.reduce((s, a) => s + (a.total_amount ?? 0), 0) + partialBalanceTotal;
  const pending = pendingAppts.reduce((s, a) => s + (a.total_amount ?? 0), 0);
  const outstandingCount = outstandingAppts.length + partialBalances.length;
  const pendingCount = pendingAppts.length;
  // Unrecorded Stripe payments the owner hasn't acknowledged yet (per-browser).
  const visibleUnrecorded = unrecorded.filter(u => !unrecDismissed.has(u.id));

  const openStripeDashboard = async () => {
    if (!shop || !accessToken) return;
    setBusy("stripe");
    const res = await fetch("/api/stripe/dashboard-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop.id }),
    });
    const data = await res.json();
    setBusy(null);
    if (res.ok && data.url) window.open(data.url, "_blank");
    else showToast(data.error ?? "Couldn't open Stripe dashboard.", false);
  };

  const refresh = async (appt: ApptRow) => {
    if (!accessToken) return;
    setBusy(appt.id);
    const res = await fetch("/api/stripe/refresh-payment", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: appt.id }),
    });
    const data = await res.json();
    setBusy(null);
    if (!data.ok) { showToast(data.error ?? "Refresh failed.", false); return; }
    setAppts(prev => prev.map(a => a.id === appt.id ? { ...a, payment_status: data.payment_status } : a));
    showToast(data.changed ? `Updated → ${statusInfo(data.payment_status).label}` : "No change — still " + statusInfo(data.payment_status).label.toLowerCase());
  };

  // ── Refund a settled card payment (appointment or POS) — keeps the booking ──
  const refundItem = async (i: FeedItem) => {
    if (!accessToken) return;
    if (!(await confirm({ title: "Refund payment", message: "Refund this payment to the customer's card? The appointment itself stays.", confirmText: "Refund", tone: "danger" }))) return;
    setRefunding(true);
    const body = i.appt ? { appointment_id: i.appt.id } : { transaction_id: i.key.slice(1) };
    const res = await fetch("/api/stripe/refund-payment", {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setRefunding(false);
    if (!res.ok) { showToast(data.error ?? "Refund failed", false); return; }
    showToast("Refunded · customer emailed");
    setDetailItem(null);
    loadData();
  };

  const [linkModal, setLinkModal] = useState<ApptRow | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkPhone, setLinkPhone] = useState("");
  const [viaEmail, setViaEmail] = useState(true);
  const [viaSms, setViaSms] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");

  const openSendLink = (appt: ApptRow) => {
    setLinkEmail(appt.client_email ?? "");
    setLinkPhone(appt.client_phone ?? "");
    setViaEmail(!!appt.client_email);
    setViaSms(!appt.client_email && !!appt.client_phone);
    setGeneratedLink("");
    setLinkModal(appt);
  };

  const submitSendLink = async () => {
    if (!linkModal) return;
    if (!viaEmail && !viaSms) { showToast("Pick email or text (or both)", false); return; }
    if (viaEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(linkEmail.trim())) { showToast("Enter a valid email", false); return; }
    if (viaSms && linkPhone.replace(/\D/g, "").length < 10) { showToast("Enter a valid phone number", false); return; }
    setBusy(linkModal.id);
    const res = await fetch("/api/stripe/payment-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appointment_id: linkModal.id,
        send_email: viaEmail, send_sms: viaSms,
        email: viaEmail ? linkEmail.trim() : undefined,
        phone: viaSms ? linkPhone.trim() : undefined,
      }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) { showToast(data.error ?? "Couldn't create link.", false); return; }
    const sent = [data.emailed && "email", data.texted && "text"].filter(Boolean).join(" + ");
    if (sent) { setLinkModal(null); showToast(`Payment link sent by ${sent}`); loadData(); }
    else { setGeneratedLink(data.url ?? ""); showToast("Link ready"); }
  };

  // Feed = money-moved rows only, sorted newest first
  const baseFeed = feedAll
    .filter(i => {
      const s = i.appt?.payment_status;
      return !i.appt || s === "paid" || s === "captured" || s === "failed" || s === "refunded";
    })
    .sort((a, b) => b.ts - a.ts);

  // Apply barber + type filters (barberName computed above for the summary scope)
  const feed = baseFeed
    .filter(i => !barberName || i.appt?.barbers?.name === barberName)
    .filter(i => {
      if (txFilter === "card") return i.method !== "cash" && i.settled;
      if (txFilter === "cash") return i.method === "cash" && !i.refunded;
      if (txFilter === "unpaid") return !i.settled && !i.refunded;
      if (txFilter === "refunded") return i.refunded;
      return true;
    });

  const selectedBarberLabel = selectedBarber === "all" ? "Shop" : (barbers.find(b => b.id === selectedBarber)?.name ?? "Shop");
  const filterLabels: Record<string, string> = { all: "All", card: "Card", cash: "Cash", unpaid: "Unpaid", refunded: "Refunded" };

  if (shop && !planHasFeature(effectivePlan(shop.subscription_plan, shop.subscription_status), "payments")) {
    return <FeatureLock title="Payments" description="Online & card payment tracking is available on the Pro and Premium plans." />;
  }

  // ── Earnings carousel = the period selector. The three presets + a Custom card
  // are the swipeable cards; each is built by mkCard (shop or barber mode). ────
  const periodCards = carouselWindows.map(w => mkCard(w.from, w.to, w.monthly, w.label, w.range));
  const customFromTs = customFrom ? new Date(customFrom + "T00:00:00").getTime() : null;
  const customToTs = customTo ? new Date(customTo + "T23:59:59.999").getTime() : null;
  const hasCustom = !!(customFromTs || customToTs);
  const customCard = hasCustom
    ? mkCard(customFromTs ?? 0, customToTs ?? nowTs, ((customToTs ?? nowTs) - (customFromTs ?? 0)) > 62 * 86400000, "Custom", "")
    : null;
  const customLabel = hasCustom ? `${customFrom ? fmtShort(customFrom) : "…"} – ${customTo ? fmtShort(customTo) : "…"}` : "";

  // ── Statement rows: money-moved (default) or unpaid appts (chase filter),
  // grouped by calendar day like a bank statement. ──────────────────────────
  const isUnpaidStatus = (s: string | null) => s === "unpaid" || s === "failed" || !s;
  const unpaidRows: FeedItem[] = feedAll
    .filter(i => i.appt && isUnpaidStatus(i.appt.payment_status) && (i.appt.total_amount ?? 0) > 0)
    .filter(i => !barberName || i.appt?.barbers?.name === barberName)
    .sort((a, b) => b.ts - a.ts);
  // Barber mode: the statement is that barber's own transactions (their cut per
  // row), mirroring their portal. Unpaid/refunded chase-filters don't apply to a
  // settled earnings ledger, so they show nothing there.
  const barberStmt = barberFeed
    .filter(i => {
      if (txFilter === "card") return i.method !== "cash";
      if (txFilter === "cash") return i.method === "cash";
      if (txFilter === "unpaid" || txFilter === "refunded") return false;
      return true;
    })
    .sort((a, b) => b.ts - a.ts);
  const stmtItems = barberMode ? barberStmt : (txFilter === "unpaid" ? unpaidRows : feed);
  const dayStart = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const todayStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const dayLabel = (k: number) => {
    const diff = Math.round((todayStart - k) / 86400000);
    const md = new Date(k).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
    if (diff === 0) return `Today · ${md}`;
    if (diff === 1) return `Yesterday · ${md}`;
    return `${new Date(k).toLocaleDateString("en-CA", { weekday: "short" })} · ${md}`;
  };
  const txGroups = (() => {
    const m = new Map<number, FeedItem[]>();
    stmtItems.forEach(i => { const k = dayStart(i.ts); const arr = m.get(k) ?? []; arr.push(i); m.set(k, arr); });
    return Array.from(m.keys()).sort((a, b) => b - a).map(k => {
      const items = m.get(k)!;
      const total = items.filter(x => x.settled && !x.refunded).reduce((s, x) => s + (x.earn ? x.amount : netOf(x)), 0);
      return { key: k, label: dayLabel(k), total, items };
    });
  })();

  // One receipt-ledger renderer for both modes. Barber: Commission + Tips −
  // fee share = Take-home. Shop: Gross − tax − fees = You keep.
  const renderLedger = (p: PeriodCard) => (
    p.mode === "barber" ? (
      <div className="cwp-ledger">
        <div className="cwp-lrow"><span className="cwp-lk">Commission{selPct ? ` (${selPct}%)` : ""}</span><span className="cwp-lv">{formatCurrency(p.commission)}</span></div>
        {p.tips > 0 && <div className="cwp-lrow"><span className="cwp-lk">Tips</span><span className="cwp-lv">{formatCurrency(p.tips)}</span></div>}
        {p.feeShare > 0 && <div className="cwp-lrow"><span className="cwp-lk">Card fee share</span><span className="cwp-lv">−{formatCurrency(p.feeShare)}</span></div>}
        <div className="cwp-lrow cwp-ltotal"><span className="cwp-lk">Take-home</span><span className="cwp-lv">{formatCurrency(p.headline)}</span></div>
      </div>
    ) : (
      <div className="cwp-ledger">
        <div className="cwp-lrow"><span className="cwp-lk">Gross taken in</span><span className="cwp-lv">{formatCurrency(p.headline + p.fees)}</span></div>
        {p.tax > 0 && <div className="cwp-lrow"><span className="cwp-lk">Sales tax</span><span className="cwp-lv">{formatCurrency(p.tax)}</span></div>}
        {p.fees > 0 && <div className="cwp-lrow"><span className="cwp-lk">Stripe fees</span><span className="cwp-lv">−{formatCurrency(p.fees)}</span></div>}
        <div className="cwp-lrow cwp-ltotal"><span className="cwp-lk">Collected</span><span className="cwp-lv">{formatCurrency(p.headline)}</span></div>
      </div>
    )
  );
  const cardCapLabel = barberMode ? "Take-home" : "Net collected";

  return (
    <div className="min-h-screen bg-background px-4 sm:px-6 max-w-2xl lg:max-w-4xl mx-auto lg:mx-0 pb-28">
      {toast && (
        <div className={cn("fixed bottom-24 right-4 z-[200] flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-medium",
          toast.ok ? "bg-emerald-900/80 border-emerald-500/40 text-emerald-300" : "bg-red-900/80 border-red-500/40 text-red-300")}>
          {toast.ok ? <Check size={15} /> : "✕"} {toast.msg}
        </div>
      )}

      {/* ── Header (unchanged nav) ─────────────────────────────────────────── */}
      <DashboardHeader
        title="Payments"
        subtitle={barberName ? `${barberFirst} · take-home${selPct ? ` · ${selPct}%` : ""}` : `${shop?.name ?? "Your shop"} · ClipWise takes 0%`}
      />

      {/* Barber chip — only when more than one barber (solo shops stay clean) */}
      {barbers.length > 1 && (
        <div className="cwp-barberbar">
          <button className="cwp-bchip" onClick={() => setShowBarberPicker(v => !v)}>
            {selectedBarberLabel} <ChevronDown size={13} />
          </button>
          {showBarberPicker && (
            <>
              <div className="fixed inset-0 z-[50]" onClick={() => setShowBarberPicker(false)} />
              <div className="cwp-bmenu">
                {["all", ...barbers.map(b => b.id)].map(id => (
                  <button key={id} className={cn(selectedBarber === id && "cwp-on")}
                    onClick={() => { setSelectedBarber(id); setShowBarberPicker(false); }}>
                    {id === "all" ? "Shop (all barbers)" : barbers.find(b => b.id === id)?.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Earnings — the period filters live in the carousel ─────────────── */}
      <div className="cwp-earn-head">
        <span className="cwp-lbl">Earnings{barberFirst ? ` · ${barberFirst}` : ""}</span>
        <span className="cwp-hint">‹ swipe periods ›</span>
      </div>
      <div className="cwp-railwrap">
      <div ref={netRef}
        onScroll={() => { const el = netRef.current; if (el) setNetSlide(Math.round(el.scrollLeft / el.clientWidth)); }}
        className="cwp-rail">
        {periodCards.map((p, idx) => (
          <div key={idx} className="cwp-ecard">
            <div className="cwp-period">
              <span className="cwp-pname">{p.label}</span>
              {p.range && <span className="cwp-prange">{p.range}</span>}
            </div>
            <div className="cwp-caplbl">{cardCapLabel}</div>
            <div className="cwp-amt">{formatCurrency(p.headline)}</div>
            <div className={cn("cwp-sub", p.count === 0 && "cwp-flat")}>
              {p.count > 0
                ? <>{p.count} cut{p.count !== 1 ? "s" : ""} · {formatCurrency(p.avg)} avg{p.cash > 0 ? ` · incl. ${formatCurrency(p.cash)} cash` : ""}</>
                : "No cuts in this period"}
            </div>
            <Spark data={p.data} />
            {p.count > 0 && renderLedger(p)}
          </div>
        ))}
        {/* Custom range card — last in the rail */}
        {hasCustom && customCard ? (
          <div className="cwp-ecard">
            <div className="cwp-period">
              <span className="cwp-pname">Custom</span>
              <button className="cwp-editrange" onClick={() => setShowCustomModal(true)}>Edit ›</button>
            </div>
            <div className="cwp-caplbl">{cardCapLabel}</div>
            <div className="cwp-amt">{formatCurrency(customCard.headline)}</div>
            <div className={cn("cwp-sub", customCard.count === 0 && "cwp-flat")}>
              {customCard.count > 0
                ? <>{customLabel} · {customCard.count} cut{customCard.count !== 1 ? "s" : ""}{customCard.cash > 0 ? ` · incl. ${formatCurrency(customCard.cash)} cash` : ""}</>
                : customLabel}
            </div>
            <Spark data={customCard.data} />
            {customCard.count > 0 && renderLedger(customCard)}
          </div>
        ) : (
          <div className="cwp-ecard cwp-ghost">
            <span className="cwp-pname">Custom range</span>
            <p>Pick any two dates to total<br />earnings for a specific window.</p>
            <button className="cwp-pick" onClick={() => setShowCustomModal(true)}>Choose dates <ChevronRight size={13} /></button>
          </div>
        )}
        </div>
        <button type="button" aria-label="Previous period" className="cwp-arrow cwp-arrow--prev" onClick={() => goToNet(netSlide - 1)} disabled={netSlide === 0}><ChevronLeft size={18} /></button>
        <button type="button" aria-label="Next period" className="cwp-arrow cwp-arrow--next" onClick={() => goToNet(netSlide + 1)} disabled={netSlide >= periodCards.length}><ChevronRight size={18} /></button>
      </div>
      <div className="cwp-dots">
        {Array.from({ length: periodCards.length + 1 }).map((_, i) => (
          <i key={i} className={cn(i === netSlide && "cwp-on")} />
        ))}
      </div>
      {/* Payout balance is shop-level (funds settle to the shop's account, not a
          single barber) — hide it under a per-barber filter to avoid implying it's
          the barber's payout. */}
      {!barberMode && (
        <div className="cwp-payout">
          <span className="cwp-next">
            {stripeNet?.connected === false
              ? <>Connect Stripe to see live fees &amp; payouts</>
              : stripeNet?.nextPayoutAmount != null && stripeNet?.nextPayoutDate
                ? <>Next payout <b>{formatCurrency(stripeNet.nextPayoutAmount)}</b> · {new Date(stripeNet.nextPayoutDate * 1000).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })}</>
                : payout > 0
                  ? <>Balance <b>{formatCurrency(payout)}</b> settling to your bank</>
                  : <>Payouts settle straight to your bank</>}
          </span>
          <button className="cwp-stripe" onClick={openStripeDashboard} disabled={busy === "stripe"}>
            {busy === "stripe" ? "Opening…" : "Stripe"} <ExternalLink size={12} />
          </button>
        </div>
      )}

      {/* ── Two summary tiles ──────────────────────────────────────────────── */}
      <div className="cwp-tiles">
        <button className="cwp-tile cwp-warn" onClick={() => setTxFilter(txFilter === "unpaid" ? "all" : "unpaid")}>
          <div className="cwp-lbl">Outstanding</div>
          <div className="cwp-tv">{formatCurrency(outstanding)}</div>
        </button>
        <div className="cwp-tile">
          <div className="cwp-lbl">On file</div>
          <div className="cwp-tv">{formatCurrency(pending)}</div>
        </div>
      </div>

      {/* ── Needs review: money in Stripe not recorded in ClipWise (owner only) ──
          Read-only safety net. Appears ONLY when there's a confirmed unmatched
          Stripe payment — nothing on a normal day. Never counted in any total;
          "Got it" just hides the row on this device. */}
      {!barberMode && visibleUnrecorded.length > 0 && (
        <div className="cwp-review">
          <div className="cwp-review-head">
            <AlertTriangle size={15} />
            <span>Received in Stripe, not recorded here</span>
          </div>
          <p className="cwp-review-sub">
            {visibleUnrecorded.length === 1 ? "1 payment" : `${visibleUnrecorded.length} payments`} landed in your Stripe but ClipWise has no matching record — likely a missed sync. Check it in Stripe, then mark it reviewed.
          </p>
          {visibleUnrecorded.map(u => (
            <div key={u.id} className="cwp-review-row">
              <div className="cwp-review-info">
                <div className="cwp-review-amt">{formatCurrency(u.amountCents / 100)} <span className="cwp-review-tag">{u.label}</span></div>
                <div className="cwp-review-meta">
                  {new Date(u.created * 1000).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                  {u.name ? ` · ${u.name}` : (u.email ? ` · ${u.email}` : "")}
                  {u.last4 ? ` · ····${u.last4}` : ""}
                </div>
              </div>
              <div className="cwp-review-acts">
                <button className="cwp-review-stripe" onClick={openStripeDashboard} disabled={busy === "stripe"}>
                  Stripe <ExternalLink size={11} />
                </button>
                <button className="cwp-review-ok" onClick={() => dismissUnrec(u.id)}>Got it</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tax collected (own page) — shop-level (tax is remitted by the shop,
          not a barber), so hide it under a per-barber filter. ────────────────── */}
      {!barberMode && (
        <a href="/dashboard/payments/tax" className="cwp-payout" style={{ textDecoration: "none", marginTop: 10 }}>
          <span className="cwp-next">🏛️ Tax collected · this year</span>
          <span className="cwp-stripe">View →</span>
        </a>
      )}

      {/* ── Statement ──────────────────────────────────────────────────────── */}
      <div className="cwp-txhead"><h2>Transactions</h2></div>
      <div className="cwp-seg">
        {(["all", "card", "cash", "unpaid", "refunded"] as const).map(f => (
          <button key={f} className={cn(txFilter === f && "cwp-on")} onClick={() => setTxFilter(f)}>{filterLabels[f]}</button>
        ))}
      </div>
      {loading ? (
        <div className="py-16 text-center text-grey-muted text-sm">Loading payments…</div>
      ) : txGroups.length === 0 ? (
        <div className="py-16 text-center text-grey-muted text-sm">{txFilter === "unpaid" ? "Nothing outstanding — you're all caught up." : "No transactions here yet."}</div>
      ) : (
        <div className="cwp-statement">
          {txGroups.map(g => (
            <div key={g.key} className="cwp-daygroup">
              <div className="cwp-day">
                <span className="cwp-dlabel">{g.label}</span>
                {g.total > 0 && <span className="cwp-dtot">+{formatCurrency(g.total)}</span>}
              </div>
              {g.items.map(i => {
                const refunded = i.refunded;
                const isCash = i.method === "cash";
                const unpaid = !i.settled && !refunded;
                const Icon = isCash ? Banknote : unpaid ? Clock : refunded ? RefreshCw : CreditCard;
                const glyphCls = isCash ? "cwp-cash" : unpaid ? "cwp-due" : refunded ? "" : "cwp-card";
                const ago = i.tsIso ? timeAgo(i.tsIso) : null;
                return (
                  <button key={i.key} className={cn("cwp-row", refunded && "cwp-refunded")} onClick={() => setDetailItem(i)}>
                    <span className={cn("cwp-glyph", glyphCls)}><Icon size={18} /></span>
                    <div className="cwp-rmid">
                      <div className="cwp-nm">{i.name}</div>
                      <div className="cwp-svc">{i.sub}</div>
                      {unpaid && i.appt && (i.appt.total_amount ?? 0) > 0 && (
                        <button className="cwp-send" onClick={e => { e.stopPropagation(); openSendLink(i.appt!); }}>Send payment link →</button>
                      )}
                    </div>
                    <div className="cwp-rright">
                      <div className={cn("cwp-a", unpaid ? "cwp-adue" : "cwp-apos")}>{formatCurrency(i.earn ? i.amount : netOf(i))}</div>
                      <div className="cwp-m">
                        {refunded ? <span className="cwp-tag cwp-tref">Refunded</span>
                          : unpaid ? <span className="cwp-tag cwp-tdue">Unpaid</span>
                          : <>
                              <span className="cwp-method">{isCash ? "Cash" : "Card"}</span>
                              {ago ? ` · ${ago}` : ""}
                              {!i.earn && i.method !== "cash" && feeOf(i) > 0 ? ` · ${formatCurrency(feeOf(i))} fee` : ""}
                            </>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Footer hint */}
      <div className="mt-6 flex items-start gap-2 text-xs text-grey-muted">
        <Clock size={14} className="mt-0.5 flex-shrink-0" />
        <p>Cards held or on file are charged automatically when you mark the appointment Complete, or as a no-show fee.</p>
      </div>

      {/* ── Transaction detail modal (method, time, fee + refund) ────────────── */}
      {detailItem && (() => {
        const i = detailItem;
        const a = i.appt;
        const canRefresh = !!a?.payment_intent_id && !isPaid(a.payment_status) && a.payment_status !== "refunded";
        const canSendLink = !!a && (a.payment_status === "unpaid" || a.payment_status === "failed" || !a.payment_status) && (a.total_amount ?? 0) > 0;
        // Never offer refund on a barber-earnings row — it represents that barber's
        // cut, not the underlying charge (and its key isn't a refundable tx id).
        const refundable = !i.earn && i.settled && i.method !== "cash" && !!i.pi && !i.refunded;
        const dt = i.tsIso ? new Date(i.tsIso) : null;
        return (
          <>
            <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => setDetailItem(null)} />
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
              <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-bold text-foreground truncate">{i.name}</h2>
                  <button onClick={() => setDetailItem(null)} className="text-grey hover:text-foreground text-xl leading-none flex-shrink-0">✕</button>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-grey">Service</span><span className="text-foreground text-right truncate">{i.sub}</span></div>
                  {(i.client_email ?? i.appt?.client_email) && (
                    <div className="flex justify-between gap-3">
                      <span className="text-grey flex-shrink-0">Email</span>
                      <a href={`mailto:${i.client_email ?? i.appt?.client_email}`} className="text-foreground text-right break-all min-w-0 hover:underline">{i.client_email ?? i.appt?.client_email}</a>
                    </div>
                  )}
                  <div className="flex justify-between"><span className="text-grey">Method</span><span className="text-foreground">{i.method === "cash" ? "Cash" : "Card"}</span></div>
                  <div className="flex justify-between"><span className="text-grey">Status</span><span className="text-foreground">{i.statusLabel}</span></div>
                  <div className="flex justify-between"><span className="text-grey">{i.earn ? "Earned" : "Amount"}</span><span className="text-foreground font-semibold">{formatCurrency(i.earn ? i.amount : netOf(i))}</span></div>
                  {!i.earn && i.settled && i.method !== "cash" && feeOf(i) > 0 && (
                    <div className="flex justify-between"><span className="text-grey">Stripe fee</span><span className="text-grey">{formatCurrency(feeOf(i))}</span></div>
                  )}
                  {dt && (
                    <div className="flex justify-between gap-3">
                      <span className="text-grey">When</span>
                      <span className="text-foreground text-right">
                        {dt.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        <span className="block text-[11px] text-grey-muted">{timeAgo(i.tsIso)}</span>
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 pt-1">
                  {canSendLink && a && (
                    <button onClick={() => { setDetailItem(null); openSendLink(a); }}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card-raised text-foreground text-sm font-medium py-2.5 hover:bg-surface-overlay">
                      <Send size={14} /> Send payment link
                    </button>
                  )}
                  {canRefresh && a && (
                    <button onClick={() => refresh(a)} disabled={busy === a.id}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card-raised text-foreground text-sm font-medium py-2.5 hover:bg-surface-overlay disabled:opacity-50">
                      <RefreshCw size={14} className={busy === a.id ? "animate-spin" : ""} /> Refresh status
                    </button>
                  )}
                  {refundable && (
                    <button onClick={() => refundItem(i)} disabled={refunding}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-red-500/15 text-red-400 border border-red-500/30 text-sm font-semibold py-2.5 hover:bg-red-500/25 disabled:opacity-50">
                      {refunding ? "Refunding…" : "↩ Refund payment"}
                    </button>
                  )}
                  {i.refunded && <p className="text-center text-xs text-grey">✓ Refunded</p>}
                  {i.method === "cash" && !i.refunded && <p className="text-center text-[11px] text-grey-muted">Cash payment — refund in person.</p>}
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── Custom date-range popup (per-barber earnings) ────────────────────── */}
      {showCustomModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => { if (!customFrom && !customTo) setOwnerExtra(""); setShowCustomModal(false); }} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-xs space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Custom range</h2>
                <button onClick={() => { if (!customFrom && !customTo) setOwnerExtra(""); setShowCustomModal(false); }} className="text-grey hover:text-foreground text-xl leading-none">✕</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-grey mb-1">From</label>
                  <input type="date" value={customFrom} max={customTo || undefined} onChange={e => setCustomFrom(e.target.value)}
                    className="w-full bg-card-raised border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-white [color-scheme:dark]" />
                </div>
                <div>
                  <label className="block text-xs text-grey mb-1">To</label>
                  <input type="date" value={customTo} min={customFrom || undefined} onChange={e => setCustomTo(e.target.value)}
                    className="w-full bg-card-raised border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-white [color-scheme:dark]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-outline-secondary w-full"
                  onClick={() => { if (!customFrom && !customTo) setOwnerExtra(""); setShowCustomModal(false); }}>Cancel</button>
                <button type="button" className="btn btn-primary w-full" onClick={() => setShowCustomModal(false)}>Apply</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Send-link modal ──────────────────────────────────────────────────── */}
      {linkModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => busy === null && setLinkModal(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Send payment link</h2>
                <button onClick={() => busy === null && setLinkModal(null)} className="text-grey hover:text-foreground text-xl leading-none">✕</button>
              </div>
              <div className="bg-card-raised rounded-xl p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-grey">Client</span><span className="text-foreground">{linkModal.client_name}</span></div>
                <div className="flex justify-between"><span className="text-grey">Amount</span><span className="text-foreground font-bold">{formatCurrency(linkModal.total_amount ?? 0)}</span></div>
              </div>

              {generatedLink ? (
                <div className="space-y-3">
                  <p className="text-sm text-foreground font-medium">Link ready</p>
                  <div className="bg-card-raised border border-border rounded-xl p-2 text-xs text-sky-300 break-all">{generatedLink}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className="btn btn-primary w-full"
                      onClick={async () => {
                        if (!navigator.clipboard) { showToast("Couldn't copy — copy it manually"); return; }
                        try { await navigator.clipboard.writeText(generatedLink); showToast("Link copied"); } catch { showToast("Couldn't copy — copy it manually"); }
                      }}>Copy link</button>
                    <a href={generatedLink} target="_blank" rel="noopener noreferrer" className="btn btn-success w-full text-center">Open</a>
                  </div>
                  <button type="button" className="btn btn-outline-secondary w-full" onClick={() => { setLinkModal(null); loadData(); }}>Done</button>
                </div>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" checked={viaEmail} onChange={e => setViaEmail(e.target.checked)} className="form-check-input" />
                    Email
                  </label>
                  <input type="email" value={linkEmail} onChange={e => setLinkEmail(e.target.value)}
                    placeholder="customer@email.com" disabled={!viaEmail}
                    className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-white disabled:opacity-40" />

                  <label className="flex items-center gap-2 text-sm text-foreground pt-1">
                    <input type="checkbox" checked={viaSms} onChange={e => setViaSms(e.target.checked)} className="form-check-input" />
                    Text message
                  </label>
                  <input type="tel" value={linkPhone} onChange={e => setLinkPhone(e.target.value)}
                    placeholder="(416) 555-0123" disabled={!viaSms}
                    className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-white disabled:opacity-40" />

                  <button type="button" className="btn btn-primary w-full mt-1" disabled={busy === linkModal.id} onClick={submitSendLink}>
                    {busy === linkModal.id ? "Sending…" : "Send link"}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
