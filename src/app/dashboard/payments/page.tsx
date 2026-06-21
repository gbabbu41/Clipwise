"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { ExternalLink, RefreshCw, Send, CreditCard, Banknote, Clock, Check, ChevronRight, ChevronDown, SlidersHorizontal } from "lucide-react";
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip } from "recharts";
import { useAuth } from "@/lib/auth-context";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { FeatureLock } from "@/components/dashboard/feature-lock";
import { supabase } from "@/lib/supabase";
import { formatCurrency, cn, timeToMinutes } from "@/lib/utils";

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

const fmtDate = (iso: string | null) => {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
};

export default function PaymentsPage() {
  const { shop, accessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [appts, setAppts] = useState<ApptRow[]>([]);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [stripeNet, setStripeNet] = useState<{ connected: boolean; byPi: Record<string, { gross: number; fee: number; net: number }>; available: number; pending: number; inTransit?: number; nextPayoutDate?: number | null; nextPayoutAmount?: number | null; lastPayout?: { amount: number; date: number } | null } | null>(null);
  const [netSlide, setNetSlide] = useState(0);
  const netRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Barber filter
  const [barbers, setBarbers] = useState<{ id: string; name: string }[]>([]);
  const [selectedBarber, setSelectedBarber] = useState("all");
  const [showBarberPicker, setShowBarberPicker] = useState(false);

  // Row expand + tx filter
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [txFilter, setTxFilter] = useState<"all" | "card" | "cash" | "unpaid">("all");
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    if (!shop) return;
    supabase.from("barbers").select("id, name").eq("shop_id", shop.id).eq("is_active", true).order("name")
      .then(({ data }) => setBarbers((data ?? []) as { id: string; name: string }[]));
  }, [shop]);

  // Live Stripe figures (payout balance, exact net/fees). Pulled separately so we
  // can re-sync it on its own cadence (Stripe state doesn't fire Supabase events).
  const syncStripe = useCallback(async () => {
    if (!shop) return;
    try {
      const r = await fetch("/api/stripe/payments-summary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shop.id }),
      });
      const d = r.ok ? await r.json() : null;
      if (d && !d.error) setStripeNet(d);
    } catch { /* transient/offline — keep last known figures */ }
  }, [shop]);

  const loadData = useCallback(async () => {
    if (!shop) return;
    setLoading(true);
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
    if (!accessToken) return;
    let active = true;
    fetch("/api/stripe/reconcile-payments", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (active && d?.updated > 0) loadData(); })
      .catch(() => {});
    return () => { active = false; };
  }, [accessToken, loadData]);

  useEffect(() => {
    if (!shop) return;
    const ch = supabase
      .channel(`payments:${shop.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `shop_id=eq.${shop.id}` }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `shop_id=eq.${shop.id}` }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, loadData]);

  const isPaid = (s: string | null) => s === "paid" || s === "captured";
  const apptDateMs = (a: ApptRow) => new Date(a.date + "T00:00:00").getTime() + timeToMinutes(a.time_slot) * 60000;

  type FeedItem = {
    key: string; name: string; sub: string; amount: number;
    statusLabel: string; tone: string; settled: boolean;
    ts: number; tsIso: string | null;
    pi: string | null; method: string | null; refunded: boolean;
    appt?: ApptRow;
  };

  const paidSig = new Set(appts.filter(a => isPaid(a.payment_status)).map(a => `${a.client_name}|${a.total_amount}`));
  const isNoShowTx = (t: TxRow) => t.source === "no_show" || (t.service_name ?? "").startsWith("No-show fee");
  const posTxs = txs.filter(t => {
    if (isNoShowTx(t)) return true;
    if (t.source === "completion") return false;
    if (!t.source && !t.stripe_session_id && paidSig.has(`${t.client_name}|${t.amount}`)) return false;
    return true;
  });

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
          amount: a.total_amount ?? 0,
          statusLabel: noCharge ? "No charge" : info.label,
          tone: noCharge ? "muted" : info.tone,
          settled: paid, tsIso,
          ts: tsIso ? new Date(tsIso).getTime() : apptDateMs(a),
          pi: a.payment_intent_id, method: a.payment_method,
          refunded: a.payment_status === "refunded", appt: a,
        };
      }),
    ...posTxs.map((t): FeedItem => {
      const noShow = isNoShowTx(t);
      const refunded = !!t.refunded;
      return {
        key: `t${t.id}`, name: t.client_name || "Walk-in",
        sub: noShow ? (t.service_name ?? "No-show fee") : `${t.service_name || "Sale"} · POS`,
        amount: (t.amount ?? 0) + (t.tip ?? 0),
        statusLabel: refunded ? "Refunded" : (noShow ? "No-show · Paid" : (t.payment_method === "cash" ? "Paid · Cash" : "Paid · Card")),
        tone: refunded ? "muted" : "good",
        settled: !refunded, tsIso: t.created_at,
        ts: new Date(t.created_at).getTime(),
        pi: t.payment_intent_id ?? null, method: t.payment_method, refunded,
      };
    }),
  ];

  const netOf = (i: FeedItem) => (i.pi && stripeNet?.byPi[i.pi]) ? stripeNet.byPi[i.pi].net : i.amount;
  const feeOf = (i: FeedItem) => (i.pi && stripeNet?.byPi[i.pi]) ? stripeNet.byPi[i.pi].fee : 0;

  // Barber scope — when a specific barber is picked, every earnings figure
  // (carousel + cards) reflects only their appointments. POS / walk-in sales
  // aren't barber-attributed, so they fall out of a per-barber view.
  const barberName = selectedBarber !== "all" ? (barbers.find(b => b.id === selectedBarber)?.name ?? null) : null;
  const barberFirst = barberName?.split(" ")[0] ?? "";
  const scopedSettled = feedAll.filter(i => i.settled && (!barberName || i.appt?.barbers?.name === barberName));
  const cardSettled = scopedSettled.filter(i => i.method !== "cash");
  const cashSettled = scopedSettled.filter(i => i.method === "cash");
  // Net collected all-time for the current scope (drives the per-barber hero).
  const scopeNetAll = cardSettled.reduce((s, i) => s + netOf(i), 0);
  const scopeCashAll = cashSettled.reduce((s, i) => s + i.amount, 0);
  // Payouts settle to the shop's connected account (shop-level, not per barber yet).
  // "Heading to your bank" = payouts Stripe is actively sending now (in-transit).
  // Matches Stripe's "On the way to your bank" (excludes funds still settling).
  const payout = stripeNet?.inTransit ?? 0;

  const startOf = (kind: "today" | "week" | "month") => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (kind === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    else if (kind === "month") d.setDate(1);
    return d.getTime();
  };
  const sumNet = (from: number) => cardSettled.filter(i => i.ts >= from).reduce((s, i) => s + netOf(i), 0);
  const sumCash = (from: number) => cashSettled.filter(i => i.ts >= from).reduce((s, i) => s + i.amount, 0);
  const todayNet = sumNet(startOf("today"));
  const todayCash = sumCash(startOf("today"));

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

  const scopedAppts = appts.filter(a => !barberName || a.barbers?.name === barberName);
  const outstandingAppts = scopedAppts.filter(a => a.payment_status === "unpaid" || a.payment_status === "failed" || !a.payment_status);
  const pendingAppts = scopedAppts.filter(a => a.payment_status === "held" || a.payment_status === "saved");
  const outstanding = outstandingAppts.reduce((s, a) => s + (a.total_amount ?? 0), 0);
  const pending = pendingAppts.reduce((s, a) => s + (a.total_amount ?? 0), 0);
  const outstandingCount = outstandingAppts.length;
  const pendingCount = pendingAppts.length;

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
      if (txFilter === "cash") return i.method === "cash";
      if (txFilter === "unpaid") return !i.settled && !i.refunded;
      return true;
    });

  const selectedBarberLabel = selectedBarber === "all" ? "All barbers" : (barbers.find(b => b.id === selectedBarber)?.name ?? "All barbers");
  const filterLabels: Record<string, string> = { all: "All", card: "Card", cash: "Cash", unpaid: "Unpaid" };

  if (shop && !planHasFeature(effectivePlan(shop.subscription_plan, shop.subscription_status), "payments")) {
    return <FeatureLock title="Payments" description="Online & card payment tracking is available on the Pro and Premium plans." />;
  }

  return (
    <div className="min-h-screen bg-black px-4 sm:px-6 py-6 max-w-2xl mx-auto pb-28">
      {toast && (
        <div className={cn("fixed bottom-24 right-4 z-[200] flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-medium",
          toast.ok ? "bg-emerald-900/80 border-emerald-500/40 text-emerald-300" : "bg-red-900/80 border-red-500/40 text-red-300")}>
          {toast.ok ? <Check size={15} /> : "✕"} {toast.msg}
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white uppercase tracking-wide">Payments</h1>
        {barbers.length > 0 && (
          <div className="relative mt-1.5">
            <button onClick={() => setShowBarberPicker(v => !v)}
              className="flex items-center gap-1 text-sm font-medium text-[#aaa] hover:text-white transition-colors">
              {selectedBarberLabel}
              <ChevronDown size={14} className="text-[#666]" />
            </button>
            {showBarberPicker && (
              <>
                <div className="fixed inset-0 z-[50]" onClick={() => setShowBarberPicker(false)} />
                <div className="absolute top-full left-0 z-[60] mt-1.5 bg-[#0c0c0c] border border-[#1e1e1e] rounded-xl overflow-hidden shadow-xl min-w-[150px]">
                  {["all", ...barbers.map(b => b.id)].map(id => (
                    <button key={id} onClick={() => { setSelectedBarber(id); setShowBarberPicker(false); }}
                      className={cn("w-full text-left px-4 py-2.5 text-sm hover:bg-[#141414] transition-colors",
                        selectedBarber === id ? "text-white font-medium" : "text-[#aaa]")}>
                      {id === "all" ? "All barbers" : barbers.find(b => b.id === id)?.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Payout card carousel ────────────────────────────────────────────── */}
      <div className="mb-4">
        <div ref={netRef}
          onScroll={() => { const el = netRef.current; if (el) setNetSlide(Math.round(el.scrollLeft / el.clientWidth)); }}
          className="flex overflow-x-auto snap-x snap-mandatory gap-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">

          {/* Slide 1 — shop payout (All barbers) OR a barber's net earned */}
          {barberName ? (
            <div className="min-w-full snap-center rounded-2xl bg-white px-4 py-5 shadow-sm flex flex-col">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">{barberFirst} · Net earned</p>
              <p className="font-extrabold mt-1.5 text-3xl sm:text-4xl text-emerald-600">{formatCurrency(scopeNetAll)}</p>
              <p className="text-xs text-gray-500 mt-1.5">
                Collected all-time{scopeCashAll > 0 ? ` · +${formatCurrency(scopeCashAll)} cash` : ""}
              </p>
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-end justify-between gap-3 text-xs">
                <div>
                  <p className="text-gray-400">Net today</p>
                  <p className="font-semibold text-emerald-600">
                    {formatCurrency(todayNet)}{todayCash > 0 && <span className="text-amber-500"> + {formatCurrency(todayCash)} cash</span>}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-gray-400">Paid out</p>
                  <p className="font-medium text-gray-700">Shop account</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="min-w-full snap-center rounded-2xl bg-white px-4 py-5 shadow-sm flex flex-col">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Heading to your bank</p>
              <p className="font-extrabold mt-1.5 text-3xl sm:text-4xl text-emerald-600">{formatCurrency(payout)}</p>
              {stripeNet?.nextPayoutDate ? (
                <div className="text-xs text-gray-500 mt-1.5 leading-snug">
                  <span>Next payout{stripeNet.nextPayoutAmount != null ? `: ${formatCurrency(stripeNet.nextPayoutAmount)}` : ""}</span>
                  <span className="block text-gray-400">{new Date(stripeNet.nextPayoutDate * 1000).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })}</span>
                </div>
              ) : (
                <p className="text-xs text-gray-500 mt-1.5">No payout scheduled yet</p>
              )}
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-end justify-between gap-3 text-xs">
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
          )}

          {/* Slides 2-4 — Net by period */}
          {netPeriods.map(p => (
            <div key={p.key} className="min-w-full snap-center rounded-2xl bg-white px-4 py-5 shadow-sm flex flex-col">
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
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #eee", fontSize: 12, padding: "5px 9px" }} position={{ y: 0 }} allowEscapeViewBox={{ x: false, y: false }} formatter={(v) => [formatCurrency(Number(v)), "Net"]} cursor={{ fill: "#f3f4f6" }} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <div className="h-full flex items-center justify-center text-xs text-gray-300">No data yet</div>}
              </div>
            </div>
          ))}
        </div>

        {/* Dots (left) + Stripe button (right) */}
        <div className="flex items-center justify-between mt-2.5 px-0.5">
          <div className="flex gap-1.5">
            {Array.from({ length: 1 + netPeriods.length }).map((_, i) => (
              <button key={i} type="button" aria-label={`Slide ${i + 1}`}
                onClick={() => { const el = netRef.current; if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" }); }}
                className={cn("h-1.5 rounded-full transition-all", i === netSlide ? "w-5 bg-white" : "w-1.5 bg-[#444]")} />
            ))}
          </div>
          <button onClick={openStripeDashboard} disabled={busy === "stripe"}
            className="flex items-center gap-1.5 text-[11px] font-medium text-[#888] hover:text-white transition-colors disabled:opacity-50">
            {busy === "stripe" ? "Opening…" : "Stripe"} <ExternalLink size={11} />
          </button>
        </div>

        {barberName && (
          <p className="text-[11px] text-[#666] mt-2 px-0.5 leading-snug">
            Showing {barberFirst}&apos;s collected earnings. Payouts still settle to the shop&apos;s account — per-barber payouts aren&apos;t set up yet.
          </p>
        )}
      </div>

      {/* ── Outstanding + On file ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        <div className="rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] px-3 py-3">
          <p className="text-[10px] uppercase tracking-wide text-[#777]">Outstanding</p>
          <p className="font-bold mt-0.5 text-xl text-amber-400">{formatCurrency(outstanding)}</p>
          <p className="text-[11px] text-[#666] mt-0.5">{outstandingCount} unpaid</p>
        </div>
        <div className="rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] px-3 py-3">
          <p className="text-[10px] uppercase tracking-wide text-[#777]">On file</p>
          <p className="font-bold mt-0.5 text-xl text-white">{formatCurrency(pending)}</p>
          <p className="text-[11px] text-[#666] mt-0.5">{pendingCount} held</p>
        </div>
      </div>

      {/* ── Recent Transactions header ───────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-white">Recent Transactions</h2>
        <div className="relative">
          <button onClick={() => setShowFilterMenu(v => !v)}
            className={cn("flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[#1e1e1e] transition-colors",
              txFilter !== "all" ? "bg-white text-black border-white" : "bg-[#141414] text-[#aaa] hover:text-white")}>
            <SlidersHorizontal size={12} /> {filterLabels[txFilter]}
          </button>
          {showFilterMenu && (
            <>
              <div className="fixed inset-0 z-[50]" onClick={() => setShowFilterMenu(false)} />
              <div className="absolute top-full right-0 z-[60] mt-1.5 bg-[#0c0c0c] border border-[#1e1e1e] rounded-xl overflow-hidden shadow-xl min-w-[120px]">
                {(["all", "card", "cash", "unpaid"] as const).map(f => (
                  <button key={f} onClick={() => { setTxFilter(f); setShowFilterMenu(false); }}
                    className={cn("w-full text-left px-4 py-2.5 text-sm hover:bg-[#141414] transition-colors",
                      txFilter === f ? "text-white font-medium" : "text-[#aaa]")}>
                    {filterLabels[f]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Feed ─────────────────────────────────────────────────────────────── */}
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
            const expanded = expandedRow === i.key;
            const hasActions = canSendLink || canRefresh;

            const isCash = i.method === "cash";
            const IconEl = isCash ? Banknote : CreditCard;
            const iconBg = isCash ? "bg-amber-500/10 text-amber-400" : i.settled ? "bg-emerald-500/10 text-emerald-400" : "bg-[#141414] text-[#666]";

            return (
              <div key={i.key} className={cn("rounded-2xl border border-[#1e1e1e] bg-[#0c0c0c] overflow-hidden", refunded && "opacity-60")}>
                <button
                  className="w-full text-left p-3 flex items-center gap-3"
                  onClick={() => hasActions && setExpandedRow(expanded ? null : i.key)}
                  disabled={!hasActions}>
                  {/* Payment method icon */}
                  <div className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0", iconBg)}>
                    <IconEl size={17} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn("font-semibold text-white text-sm truncate", refunded && "line-through")}>{i.name}</span>
                      <span className={cn("font-bold text-sm flex-shrink-0", refunded ? "text-[#888] line-through" : "text-white")}>
                        {formatCurrency(netOf(i))}
                      </span>
                    </div>
                    <p className="text-xs text-[#777] truncate">{i.sub}</p>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[11px] text-[#666]">
                        {fmtDate(i.tsIso)}{i.tsIso ? " · " : ""}{i.statusLabel}
                        {i.settled && i.method !== "cash" && feeOf(i) > 0 && (
                          <span className="text-[#555]"> · after {formatCurrency(feeOf(i))} fee</span>
                        )}
                      </span>
                      {hasActions && (
                        <ChevronRight size={14} className={cn("text-[#555] transition-transform flex-shrink-0", expanded && "rotate-90")} />
                      )}
                    </div>
                  </div>
                </button>

                {/* Expanded actions */}
                {expanded && hasActions && (
                  <div className="border-t border-[#1a1a1a] px-3 py-2 flex gap-2">
                    {canSendLink && (
                      <button onClick={() => openSendLink(a!)} disabled={busy === a!.id}
                        className="flex items-center gap-1.5 rounded-lg border border-[#1e1e1e] text-[#aaa] hover:text-white text-xs px-3 py-1.5 disabled:opacity-50">
                        <Send size={12} /> {busy === a!.id ? "…" : "Send link"}
                      </button>
                    )}
                    {canRefresh && (
                      <button onClick={() => refresh(a!)} disabled={busy === a!.id}
                        className="flex items-center gap-1.5 rounded-lg border border-[#1e1e1e] text-[#aaa] hover:text-white text-xs px-3 py-1.5 disabled:opacity-50">
                        <RefreshCw size={12} className={busy === a!.id ? "animate-spin" : ""} /> Refresh
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer hint */}
      <div className="mt-6 flex items-start gap-2 text-xs text-[#666]">
        <Clock size={14} className="mt-0.5 flex-shrink-0" />
        <p>Cards held or on file are charged automatically when you mark the appointment Complete, or as a no-show fee.</p>
      </div>

      {/* ── Send-link modal ──────────────────────────────────────────────────── */}
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
                  <label className="flex items-center gap-2 text-sm text-white">
                    <input type="checkbox" checked={viaEmail} onChange={e => setViaEmail(e.target.checked)} className="form-check-input" />
                    Email
                  </label>
                  <input type="email" value={linkEmail} onChange={e => setLinkEmail(e.target.value)}
                    placeholder="customer@email.com" disabled={!viaEmail}
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-white disabled:opacity-40" />

                  <label className="flex items-center gap-2 text-sm text-white pt-1">
                    <input type="checkbox" checked={viaSms} onChange={e => setViaSms(e.target.checked)} className="form-check-input" />
                    Text message
                  </label>
                  <input type="tel" value={linkPhone} onChange={e => setLinkPhone(e.target.value)}
                    placeholder="(416) 555-0123" disabled={!viaSms}
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-white disabled:opacity-40" />

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
