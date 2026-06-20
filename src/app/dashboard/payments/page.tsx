"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { ExternalLink, RefreshCw, Send, CreditCard, Banknote, Clock, Check } from "lucide-react";
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip } from "recharts";
import { useAuth } from "@/lib/auth-context";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { FeatureLock } from "@/components/dashboard/feature-lock";
import { supabase } from "@/lib/supabase";
import { formatCurrency, cn, timeAgo, timeToMinutes } from "@/lib/utils";

// ── Row shapes ────────────────────────────────────────────────────────────────
interface ApptRow {
  id: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  date: string;
  time_slot: string;
  total_amount: number | null;
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
  service_name: string | null;
  amount: number;
  tip: number;
  payment_method: string | null;
  type: string;
  created_at: string;
  stripe_session_id: string | null;
  appointment_id: string | null;
  payment_intent_id: string | null;
  refunded: boolean | null;
  source: string | null;
}

type Filter = "all" | "collected" | "outstanding" | "pending" | "refunded";

// Status → label + tone. Mirrors the appointments page vocabulary so the two
// pages read consistently.
function statusInfo(s: string | null): { label: string; tone: "good" | "warn" | "active" | "muted" } {
  switch (s) {
    case "paid": return { label: "Paid", tone: "good" };
    case "captured": return { label: "Paid · Card", tone: "good" };
    case "held": return { label: "Card on hold", tone: "active" };
    case "saved": return { label: "Card on file", tone: "active" };
    case "refunded": return { label: "Refunded", tone: "muted" };
    case "failed": return { label: "Payment failed", tone: "warn" };
    case "unpaid": return { label: "Unpaid", tone: "warn" };
    default: return { label: "Unpaid", tone: "warn" };
  }
}
const toneClass: Record<string, string> = {
  good: "bg-[#00e5a0]/15 text-[#00e5a0]",
  warn: "bg-amber-500/15 text-amber-400",
  active: "bg-[#1a1a1a] text-white",
  muted: "bg-[#1a1a1a] text-[#888]",
};

export default function PaymentsPage() {
  const { shop, accessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [appts, setAppts] = useState<ApptRow[]>([]);
  const [txs, setTxs] = useState<TxRow[]>([]);
  // Exact card net/fee per PaymentIntent + payout balance, pulled from Stripe.
  const [stripeNet, setStripeNet] = useState<{ connected: boolean; byPi: Record<string, { gross: number; fee: number; net: number }>; available: number; pending: number; nextPayoutDate?: number | null; lastPayout?: { amount: number; date: number } | null } | null>(null);
  const [netSlide, setNetSlide] = useState(0);
  const netRef = useRef<HTMLDivElement>(null);
  const [showTip, setShowTip] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  // One-time tip popup (shows once ever per browser).
  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("cw_payments_tip_v1")) setShowTip(true);
  }, []);
  const dismissTip = () => {
    setShowTip(false);
    try { localStorage.setItem("cw_payments_tip_v1", "1"); } catch { /* ignore */ }
  };

  const loadData = useCallback(async () => {
    if (!shop) return;
    setLoading(true);
    // Cap at the 250 most-recent rows each so the feed stays fast as history
    // grows. (Summary cards reflect this recent window; swap to a server-side
    // aggregate if you ever need true all-time totals.)
    const [{ data: a }, { data: t }] = await Promise.all([
      supabase.from("appointments")
        .select("id, client_name, client_email, client_phone, date, time_slot, total_amount, payment_status, payment_method, payment_intent_id, paid_at, created_at, status, services(name), barbers(name)")
        .eq("shop_id", shop.id).or("total_amount.gt.0,status.eq.completed").order("date", { ascending: false }).limit(250),
      supabase.from("transactions")
        .select("id, client_name, service_name, amount, tip, payment_method, type, created_at, stripe_session_id, appointment_id, payment_intent_id, refunded, source")
        .eq("shop_id", shop.id).order("created_at", { ascending: false }).limit(250),
    ]);
    setAppts((a ?? []) as unknown as ApptRow[]);
    setTxs((t ?? []) as unknown as TxRow[]);
    setLoading(false);
    // Cross-check card money against Stripe (exact net after fees + payout balance).
    fetch("/api/stripe/payments-summary", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop.id }),
    }).then(r => (r.ok ? r.json() : null)).then(d => { if (d && !d.error) setStripeNet(d); }).catch(() => {});
  }, [shop]);
  useEffect(() => { loadData(); }, [loadData]);

  // Catch up on any payment-link payments that completed without the customer
  // landing back / the webhook firing — flip them to paid, then refresh.
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    fetch("/api/stripe/reconcile-payments", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (active && d?.updated > 0) loadData(); })
      .catch(() => {});
    return () => { active = false; };
  }, [accessToken, loadData]);

  // Live updates — reload the feed the moment money moves, no manual refresh.
  // Every card charge (completion / no-show / online pay) flips an appointment's
  // payment_status, and POS sales insert a transactions row; we listen to both.
  useEffect(() => {
    if (!shop) return;
    const ch = supabase
      .channel(`payments:${shop.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `shop_id=eq.${shop.id}` }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `shop_id=eq.${shop.id}` }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, loadData]);

  // ── One de-duped, time-sorted feed (appointments + POS sales) ───────────────
  // Appointment card-charges (no-show / completion) ALSO write a transactions
  // row; we show the appointment for those and drop the duplicate tx so nothing
  // is listed or counted twice. A POS sale always has a stripe_session_id (card)
  // or comes straight from the POS screen — appointment captures never do.
  const isPaid = (s: string | null) => s === "paid" || s === "captured";
  const apptDateMs = (a: ApptRow) => new Date(a.date + "T00:00:00").getTime() + timeToMinutes(a.time_slot) * 60000;

  type FeedItem = {
    key: string; name: string; sub: string; amount: number;
    statusLabel: string; tone: string; settled: boolean;
    ts: number; tsIso: string | null;
    pi: string | null; method: string | null; refunded: boolean;
    appt?: ApptRow;
  };

  // Provenance-based de-dup (phase15: transactions.source + appointment_id).
  // A no-show fee charges only the fee (e.g. $20), NOT the appointment total, so
  // we KEEP that transaction (it carries the real amount + "No-show fee" label)
  // and drop the appointment's captured row below. A completion charge equals
  // the total, so we drop the duplicate tx and keep the appointment row.
  // Pre-phase15 rows have no `source` → fall back to the old name|amount
  // heuristic so historical data still de-dups correctly.
  const paidSig = new Set(appts.filter(a => isPaid(a.payment_status)).map(a => `${a.client_name}|${a.total_amount}`));
  const isNoShowTx = (t: TxRow) => t.source === "no_show" || (t.service_name ?? "").startsWith("No-show fee");
  const posTxs = txs.filter(t => {
    if (isNoShowTx(t)) return true;                                                       // keep — real fee + label
    if (t.source === "completion") return false;                                          // shown as the appt row
    if (!t.source && !t.stripe_session_id && paidSig.has(`${t.client_name}|${t.amount}`)) return false; // legacy completion
    return true;                                                                          // POS sale / anything else
  });

  // One timestamp per row = when the activity happened: a paid row uses the
  // charge time (paid_at); an outstanding row uses when it was booked
  // (created_at); a POS sale uses created_at. Never the appointment date.
  const feedAll: FeedItem[] = [
    // Skip a no-show appointment that was charged — its money shows as the
    // "No-show fee" transaction (real amount), not the full service price.
    ...appts
      .filter(a => !(a.status === "no-show" && isPaid(a.payment_status)))
      .map((a): FeedItem => {
      const info = statusInfo(a.payment_status);
      const paid = isPaid(a.payment_status);
      // A completed appointment with no price never charged anything — read it
      // as "No charge" rather than the alarming "Unpaid".
      const noCharge = !paid && (a.total_amount ?? 0) <= 0;
      const tsIso = paid ? (a.paid_at ?? a.created_at) : a.created_at;
      return {
        key: `a${a.id}`,
        name: a.client_name,
        sub: `${a.services?.name ?? "Service"}${a.barbers?.name ? ` · ${a.barbers.name}` : ""}`,
        amount: a.total_amount ?? 0,
        statusLabel: noCharge ? "No charge" : info.label,
        tone: noCharge ? "muted" : info.tone,
        settled: paid,
        tsIso,
        ts: tsIso ? new Date(tsIso).getTime() : apptDateMs(a),
        pi: a.payment_intent_id, method: a.payment_method,
        refunded: a.payment_status === "refunded",
        appt: a,
      };
    }),
    ...posTxs.map((t): FeedItem => {
      const noShow = isNoShowTx(t);
      const refunded = !!t.refunded;
      return {
        key: `t${t.id}`,
        name: t.client_name || "Walk-in",
        sub: noShow ? (t.service_name ?? "No-show fee") : `${t.service_name || "Sale"} · POS`,
        amount: (t.amount ?? 0) + (t.tip ?? 0),
        statusLabel: refunded ? "Refunded" : (noShow ? "No-show · Paid" : (t.payment_method === "cash" ? "Paid · Cash" : "Paid · Card")),
        tone: refunded ? "muted" : "good",
        settled: !refunded,
        tsIso: t.created_at,
        ts: new Date(t.created_at).getTime(),
        pi: t.payment_intent_id ?? null, method: t.payment_method,
        refunded,
      };
    }),
  ];

  // Exact net (after Stripe fee) per item; cash + unmatched fall back to amount.
  const netOf = (i: FeedItem) => (i.pi && stripeNet?.byPi[i.pi]) ? stripeNet.byPi[i.pi].net : i.amount;
  const feeOf = (i: FeedItem) => (i.pi && stripeNet?.byPi[i.pi]) ? stripeNet.byPi[i.pi].fee : 0;

  // ── Summary ─────────────────────────────────────────────────────────────────
  // Hero = net heading to the bank this payout (live Stripe balance). The Net /
  // cash / fees indicators below are scoped to the chosen period; the list itself
  // is never hidden by this filter.
  const settledItems = feedAll.filter(i => i.settled);
  const cardSettled = settledItems.filter(i => i.method !== "cash");
  const cashSettled = settledItems.filter(i => i.method === "cash");
  const payout = (stripeNet?.available ?? 0) + (stripeNet?.pending ?? 0);

  const startOf = (kind: "today" | "week" | "month") => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (kind === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    else if (kind === "month") d.setDate(1);
    return d.getTime();
  };
  const sumNet = (from: number) => cardSettled.filter(i => i.ts >= from).reduce((s, i) => s + netOf(i), 0);
  const sumCash = (from: number) => cashSettled.filter(i => i.ts >= from).reduce((s, i) => s + i.amount, 0);
  const todayNet = sumNet(startOf("today"));
  const todayCash = sumCash(startOf("today"));

  // Net buckets for the period carousel (by day; by month for All).
  const bucketsFor = (from: number, monthly: boolean) => {
    const m = new Map<string, { order: number; net: number }>();
    cardSettled.filter(i => i.ts >= from).forEach(i => {
      const dt = new Date(i.ts);
      const order = monthly ? dt.getFullYear() * 12 + dt.getMonth() : Math.floor(i.ts / 86400000);
      const label = monthly
        ? dt.toLocaleDateString("en-CA", { month: "short" })
        : dt.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
      const cur = m.get(label) ?? { order, net: 0 };
      cur.net += netOf(i); m.set(label, cur);
    });
    return Array.from(m, ([label, v]) => ({ label, net: v.net, order: v.order })).sort((a, b) => a.order - b.order);
  };
  const netPeriods = [
    { key: "week", label: "This week", from: startOf("week"), monthly: false },
    { key: "month", label: "This month", from: startOf("month"), monthly: false },
    { key: "all", label: "All time", from: 0, monthly: true },
  ].map(p => ({ ...p, net: sumNet(p.from), cash: sumCash(p.from), data: bucketsFor(p.from, p.monthly) }));
  const outstanding = appts
    .filter(a => a.payment_status === "unpaid" || a.payment_status === "failed" || !a.payment_status)
    .reduce((s, a) => s + (a.total_amount ?? 0), 0);
  const pending = appts
    .filter(a => a.payment_status === "held" || a.payment_status === "saved")
    .reduce((s, a) => s + (a.total_amount ?? 0), 0);

  // ── Open the shop's Stripe Express dashboard ────────────────────────────────
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

  // ── Re-check a payment against Stripe ───────────────────────────────────────
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

  // ── Send a payment link — chooser modal (email and/or text) ─────────────────
  const [linkModal, setLinkModal] = useState<ApptRow | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkPhone, setLinkPhone] = useState("");
  const [viaEmail, setViaEmail] = useState(true);
  const [viaSms, setViaSms] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");

  const openSendLink = (appt: ApptRow) => {
    setLinkEmail(appt.client_email ?? "");
    setLinkPhone(appt.client_phone ?? "");
    setViaEmail(!!appt.client_email);          // default to email if we have one
    setViaSms(!appt.client_email && !!appt.client_phone); // else SMS if we have a phone
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
        send_email: viaEmail,
        send_sms: viaSms,
        email: viaEmail ? linkEmail.trim() : undefined,
        phone: viaSms ? linkPhone.trim() : undefined,
      }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) { showToast(data.error ?? "Couldn't create link.", false); return; }
    const sent = [data.emailed && "email", data.texted && "text"].filter(Boolean).join(" + ");
    if (sent) {
      setLinkModal(null);
      showToast(`Payment link sent by ${sent}`);
      loadData();
    } else {
      // Nothing actually sent — surface the link to copy/open.
      setGeneratedLink(data.url ?? "");
      showToast("Link ready");
    }
  };

  // Recent transactions = rows where money actually moved: a POS sale (no appt),
  // or an appointment that was paid / failed a charge / refunded. Newest first.
  const feed = feedAll
    .filter(i => {
      const s = i.appt?.payment_status;
      return !i.appt || s === "paid" || s === "captured" || s === "failed" || s === "refunded";
    })
    .sort((a, b) => b.ts - a.ts);

  // Plan gate — the Payments hub is a Pro/Premium feature.
  if (shop && !planHasFeature(effectivePlan(shop.subscription_plan, shop.subscription_status), "payments")) {
    return <FeatureLock title="Payments" description="Online & card payment tracking is available on the Pro and Premium plans." />;
  }

  return (
    <div className="min-h-screen bg-black px-4 sm:px-6 py-6 max-w-5xl mx-auto pb-28">
      {toast && (
        <div className={cn("fixed bottom-24 right-4 z-[200] flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-medium",
          toast.ok ? "bg-emerald-900/80 border-emerald-500/40 text-emerald-300" : "bg-red-900/80 border-red-500/40 text-red-300")}>
          {toast.ok ? <Check size={15} /> : "✕"} {toast.msg}
        </div>
      )}

      {/* One-time tip popup */}
      {showTip && (
        <>
          <div className="fixed inset-0 bg-black/60 z-[70]" onClick={dismissTip} />
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-sm text-center space-y-3">
              <div className="text-3xl">💡</div>
              <h3 className="text-lg font-bold text-white">Quick tip</h3>
              <p className="text-sm text-[#aaa] leading-snug">
                Stripe is the source of truth for every charge &amp; payout. If a paid link still shows
                outstanding, hit <span className="text-white font-medium">Refresh</span> on that row.
              </p>
              <button onClick={dismissTip}
                className="w-full rounded-xl bg-white text-black font-semibold text-sm py-2.5 hover:bg-[#eaeaea] transition-colors">
                Got it
              </button>
            </div>
          </div>
        </>
      )}

      {/* Header — title + Stripe link on one row (no awkward gap) */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <h1 className="text-2xl font-bold text-white uppercase tracking-wide">Payments</h1>
        <button onClick={openStripeDashboard} disabled={busy === "stripe"}
          className="flex-shrink-0 flex items-center gap-1.5 rounded-lg border border-[#2a2a2a] bg-[#141414] text-white text-[11px] font-medium px-2.5 py-1.5 hover:bg-[#1e1e1e] disabled:opacity-50 transition-colors">
          <ExternalLink size={13} /> {busy === "stripe" ? "Opening…" : "Stripe Dashboard"}
        </button>
      </div>

      {/* Summary carousel — slide 1: Next payout, then Net by period */}
      <div className="mb-4">
        <div ref={netRef}
          onScroll={() => { const el = netRef.current; if (el) setNetSlide(Math.round(el.scrollLeft / el.clientWidth)); }}
          className="flex overflow-x-auto snap-x snap-mandatory gap-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {/* Slide 1 — Next payout */}
          <div className="min-w-full snap-center min-h-[184px] rounded-2xl bg-white px-4 py-5 shadow-sm flex flex-col">
            <p className="text-[10px] uppercase tracking-wide text-gray-400">Next payout</p>
            <p className="font-extrabold mt-1.5 text-3xl sm:text-4xl text-emerald-600">{formatCurrency(payout)}</p>
            <p className="text-xs text-gray-500 mt-1.5">
              {stripeNet?.nextPayoutDate
                ? `Expected ${new Date(stripeNet.nextPayoutDate * 1000).toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" })}`
                : "No payout scheduled yet"}
            </p>
            <div className="mt-auto pt-3 border-t border-gray-100 flex items-end justify-between gap-3 text-xs">
              <div>
                <p className="text-gray-400">Net today</p>
                <p className="font-semibold text-emerald-600">
                  {formatCurrency(todayNet)}{todayCash > 0 && <span className="text-amber-500"> + {formatCurrency(todayCash)} cash</span>}
                </p>
              </div>
              <div className="text-right">
                <p className="text-gray-400">Last payout</p>
                <p className="font-medium text-gray-700">
                  {stripeNet?.lastPayout
                    ? `${formatCurrency(stripeNet.lastPayout.amount)} · ${new Date(stripeNet.lastPayout.date * 1000).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
                    : "—"}
                </p>
              </div>
            </div>
          </div>
          {/* Slides 2-4 — Net by period with charts */}
          {netPeriods.map(p => (
            <div key={p.key} className="min-w-full snap-center min-h-[184px] rounded-2xl bg-white px-4 py-5 shadow-sm flex flex-col">
              <div className="flex items-baseline justify-between">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Net · {p.label}</p>
                {p.cash > 0 && <span className="text-xs font-semibold text-amber-500">+ {formatCurrency(p.cash)} cash</span>}
              </div>
              <p className="text-3xl sm:text-4xl font-extrabold text-emerald-600 mt-1.5">{formatCurrency(p.net)}</p>
              <div className="flex-1 min-h-[72px] mt-3 -mx-1">
                {p.data.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={p.data} margin={{ top: 4, right: 6, left: 6, bottom: 0 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#9ca3af" }} interval="preserveStartEnd" minTickGap={20} axisLine={false} tickLine={false} />
                      <Bar dataKey="net" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={22} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #eee", fontSize: 12, padding: "6px 10px" }} formatter={(v) => [formatCurrency(Number(v)), "Net"]} cursor={{ fill: "#f3f4f6" }} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <div className="h-full flex items-center justify-center text-xs text-gray-300">No data yet</div>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-1.5 mt-2">
          {Array.from({ length: 1 + netPeriods.length }).map((_, i) => (
            <button key={i} type="button" aria-label={`Slide ${i + 1}`}
              onClick={() => { const el = netRef.current; if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" }); }}
              className={cn("h-1.5 rounded-full transition-all", i === netSlide ? "w-5 bg-white" : "w-1.5 bg-[#444]")} />
          ))}
        </div>
      </div>
      {/* Outstanding + On file — two equal cards side by side */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] px-3 py-3">
          <p className="text-[10px] uppercase tracking-wide text-[#777]">Outstanding</p>
          <p className="font-bold mt-0.5 text-lg text-amber-400">{formatCurrency(outstanding)}</p>
          <p className="text-[10px] text-[#666] mt-0.5">Unpaid</p>
        </div>
        <div className="rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] px-3 py-3">
          <p className="text-[10px] uppercase tracking-wide text-[#777]">On file</p>
          <p className="font-bold mt-0.5 text-lg text-white">{formatCurrency(pending)}</p>
          <p className="text-[10px] text-[#666] mt-0.5">Held</p>
        </div>
      </div>

      {/* Transactions */}
      <h2 className="text-sm font-bold text-white mb-3">Recent Transactions</h2>

      {loading ? (
        <div className="py-16 text-center text-[#777] text-sm">Loading payments…</div>
      ) : feed.length === 0 ? (
        <div className="py-16 text-center text-[#777] text-sm">No payments here yet.</div>
      ) : (
        <div className="space-y-2">
          {feed.map(i => {
            const a = i.appt;
            const refunded = i.refunded;
            const canRefresh = !!a?.payment_intent_id && !isPaid(a.payment_status) && a.payment_status !== "refunded";
            const canSendLink = !!a && (a.payment_status === "unpaid" || a.payment_status === "failed" || !a.payment_status) && (a.total_amount ?? 0) > 0;
            return (
              <div key={i.key} className={cn("rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] p-3 sm:p-4", refunded && "opacity-60")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-semibold text-white truncate", refunded && "line-through")}>{i.name}</p>
                    <p className="text-xs text-[#777] truncate">{i.sub}</p>
                    <p className="text-[11px] text-[#666] mt-0.5">{timeAgo(i.tsIso) || "—"}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className={cn("text-base font-bold", refunded ? "text-[#888] line-through" : "text-white")}>{formatCurrency(netOf(i))}</p>
                    {i.settled && i.method !== "cash" && feeOf(i) > 0 && (
                      <p className="text-[10px] text-[#666]">net · after {formatCurrency(feeOf(i))} fee</p>
                    )}
                    <span className={cn("inline-flex items-center gap-1 mt-1 text-[11px] font-semibold px-2.5 py-1 rounded-full", toneClass[i.tone])}>
                      {i.method === "cash" ? <Banknote size={11} /> : (i.settled ? <CreditCard size={11} /> : null)}
                      {i.statusLabel}
                    </span>
                  </div>
                </div>
                {a && (canSendLink || canRefresh) && (
                  <div className="flex gap-2 mt-3">
                    {canSendLink && (
                      <button onClick={() => openSendLink(a)} disabled={busy === a.id}
                        className="flex items-center gap-1.5 rounded-lg border border-[#1e1e1e] text-[#aaa] hover:text-white text-xs px-3 py-1.5 disabled:opacity-50">
                        <Send size={13} /> {busy === a.id ? "…" : "Send link"}
                      </button>
                    )}
                    {canRefresh && (
                      <button onClick={() => refresh(a)} disabled={busy === a.id}
                        className="flex items-center gap-1.5 rounded-lg border border-[#1e1e1e] text-[#aaa] hover:text-white text-xs px-3 py-1.5 disabled:opacity-50">
                        <RefreshCw size={13} className={busy === a.id ? "animate-spin" : ""} /> Refresh
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer hint about held/saved timing */}
      <div className="mt-6 flex items-start gap-2 text-xs text-[#666]">
        <Clock size={14} className="mt-0.5 flex-shrink-0" />
        <p>Cards held or on file are charged automatically when you mark the appointment Complete, or as a no-show fee. They appear here as &quot;Card held / on file&quot; until then.</p>
      </div>

      {/* Send-link chooser modal */}
      {linkModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => busy === null && setLinkModal(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-[#0c0c0c] border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Send payment link</h2>
                <button onClick={() => busy === null && setLinkModal(null)} className="text-[#777] hover:text-white text-xl leading-none">✕</button>
              </div>
              <div className="bg-[#141414] rounded-xl p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-[#777]">Client</span><span className="text-white">{linkModal.client_name}</span></div>
                <div className="flex justify-between"><span className="text-[#777]">Amount</span><span className="text-white font-bold">{formatCurrency(linkModal.total_amount ?? 0)}</span></div>
              </div>

              {generatedLink ? (
                <div className="space-y-3">
                  <p className="text-sm text-white font-medium">Link ready</p>
                  <div className="bg-[#141414] border border-[#1e1e1e] rounded-xl p-2 text-xs text-sky-300 break-all">{generatedLink}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className="btn btn-primary w-full"
                      onClick={() => { navigator.clipboard?.writeText(generatedLink); showToast("Link copied"); }}>Copy link</button>
                    <a href={generatedLink} target="_blank" rel="noopener noreferrer" className="btn btn-success w-full text-center">Open</a>
                  </div>
                  <button type="button" className="btn btn-outline-secondary w-full" onClick={() => { setLinkModal(null); loadData(); }}>Done</button>
                </div>
              ) : (
                <>
                  {/* Email row */}
                  <label className="flex items-center gap-2 text-sm text-white">
                    <input type="checkbox" checked={viaEmail} onChange={e => setViaEmail(e.target.checked)} className="form-check-input" />
                    Email
                  </label>
                  <input
                    type="email" value={linkEmail} onChange={e => setLinkEmail(e.target.value)}
                    placeholder="customer@email.com" disabled={!viaEmail}
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-white disabled:opacity-40"
                  />

                  {/* Text row */}
                  <label className="flex items-center gap-2 text-sm text-white pt-1">
                    <input type="checkbox" checked={viaSms} onChange={e => setViaSms(e.target.checked)} className="form-check-input" />
                    Text message
                  </label>
                  <input
                    type="tel" value={linkPhone} onChange={e => setLinkPhone(e.target.value)}
                    placeholder="(416) 555-0123" disabled={!viaSms}
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-white disabled:opacity-40"
                  />

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
