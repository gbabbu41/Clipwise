"use client";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { CreditCard, Banknote, X, ChevronRight, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { ApptDetail, Portal, makeApptActions } from "@/components/calendar-view";
import type { AppointmentWithDetails } from "@/lib/database.types";

interface Tx {
  id: string;
  client_name?: string;
  service_name?: string;
  amount: number;
  tip: number;
  commission_amount?: number | null;
  payment_method?: string | null;
  payment_intent_id?: string | null;
  created_at: string;
}

const grossOf = (t: Tx) => t.amount + (t.tip ?? 0);

// Mini CSS-bar sparkline for an earnings period card — same look as the owner
// Payments page (blue gradient bars, tallest highlighted). Faint placeholder
// bars when the period has no earnings.
function Spark({ data }: { data: { val: number }[] }) {
  if (!data.length) {
    return (
      <div className="cwp-spark">
        {Array.from({ length: 7 }).map((_, i) => <i key={i} className="cwp-ph" style={{ height: `${28 + (i % 3) * 14}%` }} />)}
      </div>
    );
  }
  const bars = data.slice(-14);
  const max = Math.max(...bars.map(d => d.val), 1);
  let peak = 0;
  bars.forEach((d, i) => { if (d.val > bars[peak].val) peak = i; });
  return (
    <div className="cwp-spark">
      {bars.map((d, i) => <i key={i} className={i === peak ? "cwp-peak" : ""} style={{ height: `${Math.max(8, (d.val / max) * 100)}%` }} />)}
    </div>
  );
}

export default function BarberPaymentsPage() {
  const { accessToken, profile } = useAuth();
  const { shop, barber } = useBarber();
  const canManage = profile?.role === "shop_owner" || barber?.permissions?.manage_appointments === true;

  const [txs, setTxs] = useState<Tx[]>([]);
  const [pct, setPct] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stripeNet, setStripeNet] = useState<{ byPi: Record<string, { gross: number; fee: number; net: number }> } | null>(null);

  // Earnings window: the periods are the swipeable carousel cards (this week →
  // month → all → custom); the last card opens a from→to date picker.
  const [slide, setSlide] = useState(0);
  const railRef = useRef<HTMLDivElement | null>(null);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // Statement filter — All / Card / Cash / Unpaid (Unpaid = collectable appts).
  const [txFilter, setTxFilter] = useState<"all" | "card" | "cash" | "unpaid">("all");

  // ── All-time transactions in one call; the window is applied client-side ──
  const loadEarnings = useCallback(async () => {
    if (!accessToken) return;
    const shopParam = shop?.id ? `&shop_id=${shop.id}` : "";
    const r = await fetch(`/api/barber/earnings?period=all${shopParam}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const d = r.ok ? await r.json() : null;
    if (d) { setTxs((d.transactions ?? []) as Tx[]); setPct(d.summary?.commissionPercent ?? 0); setIsOwner(d.summary?.isOwner ?? false); }
    setLoading(false);
  }, [accessToken, shop?.id]);

  // Exact Stripe net/fees per card payment (fees aren't stored in our DB).
  const syncStripe = useCallback(async () => {
    if (!shop?.id) return;
    try {
      const r = await fetch("/api/stripe/payments-summary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shop.id }),
      });
      const d = r.ok ? await r.json() : null;
      if (d && !d.error) setStripeNet(d);
    } catch { /* transient/offline — keep last known figures */ }
  }, [shop?.id]);

  useEffect(() => { loadEarnings(); syncStripe(); }, [loadEarnings, syncStripe]);

  // Card payments lose a Stripe fee (not stored locally). An owner keeping 100%
  // nets gross − fee; a staff barber keeps their commission on the service
  // amount and the shop bears the processing fee.
  const feeOf = useCallback((t: Tx) =>
    (t.payment_method !== "cash" && t.payment_intent_id && stripeNet?.byPi[t.payment_intent_id])
      ? stripeNet.byPi[t.payment_intent_id].fee : 0, [stripeNet]);
  const earnedOf = useCallback((t: Tx) => {
    const tipAmt = t.tip ?? 0;
    if (isOwner) return grossOf(t) - feeOf(t);
    const commission = t.commission_amount ?? (t.amount * pct) / 100;
    return commission + tipAmt;
  }, [isOwner, pct, feeOf]);

  const startOf = (kind: "today" | "week" | "biweekly" | "month") => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (kind === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));      // Monday
    else if (kind === "biweekly") d.setDate(d.getDate() - 13);                  // trailing 14 days
    else if (kind === "month") d.setDate(1);
    return d.getTime();
  };
  // Small "Jul 23 – Jul 29" caption so each period card shows its actual dates.
  const fmtDay = (ts: number) => new Date(ts).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  const rangeFor = (key: "week" | "month" | "all") => {
    const ws = startOf("week");
    if (key === "week") return `${fmtDay(ws)} – ${fmtDay(ws + 6 * 86400000)}`;
    if (key === "month") { const d = new Date(); return `${fmtDay(startOf("month"))} – ${fmtDay(new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime())}`; }
    return ""; // all time
  };

  const summarize = useCallback((from: number, to: number, monthly: boolean) => {
    const inP = txs.filter(t => { const ms = new Date(t.created_at).getTime(); return ms >= from && ms <= to; });
    const earned = inP.reduce((s, t) => s + earnedOf(t), 0);
    const gross = inP.reduce((s, t) => s + grossOf(t), 0);
    const tips = inP.reduce((s, t) => s + (t.tip ?? 0), 0);
    const fees = inP.reduce((s, t) => s + feeOf(t), 0);
    // Cash is collected in hand; shown separately from the card/Stripe figure.
    const cash = inP.filter(t => t.payment_method === "cash").reduce((s, t) => s + earnedOf(t), 0);
    const cardEarned = earned - cash;
    const count = inP.length;
    // Sparkline buckets = COLLECTED per day (card + cash), so the chart reflects
    // the same take-home the headline shows (a cash-only week still draws bars).
    const m = new Map<string, { order: number; val: number }>();
    inP.forEach(t => {
      const dt = new Date(t.created_at);
      const order = monthly ? dt.getFullYear() * 12 + dt.getMonth() : Math.floor(dt.getTime() / 86400000);
      const label = monthly
        ? dt.toLocaleDateString("en-CA", { month: "short" })
        : dt.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
      const cur = m.get(label) ?? { order, val: 0 };
      cur.val += earnedOf(t); m.set(label, cur);
    });
    const data = Array.from(m, ([label, v]) => ({ label, val: v.val, order: v.order })).sort((a, b) => a.order - b.order);
    return { earned, cardEarned, gross, tips, fees, cash, count, data, avg: count ? gross / count : 0, shopCut: Math.max(0, gross - earned) };
  }, [txs, earnedOf, feeOf]);

  const fmtShort = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  const nowTs = Date.now();
  // Carousel windows: this week → this month → all time (+ a Custom card).
  const basePeriods = [
    { label: "This week", range: rangeFor("week"), from: startOf("week"), to: nowTs, monthly: false },
    { label: "This month", range: rangeFor("month"), from: startOf("month"), to: nowTs, monthly: false },
    { label: "All time", range: "", from: 0, to: Infinity, monthly: true },
  ];
  const baseSummaries = basePeriods.map(p => summarize(p.from, p.to, p.monthly));

  // Custom range (the last carousel card) — set from the date picker.
  const hasCustom = !!(customFrom || customTo);
  const customFromTs = customFrom ? new Date(customFrom + "T00:00:00").getTime() : 0;
  const customToTs = customTo ? new Date(customTo + "T23:59:59.999").getTime() : nowTs;
  const customMonthly = (customToTs - customFromTs) > 62 * 86400000;
  const customLabel = hasCustom ? `${customFrom ? fmtShort(customFrom) : "…"} – ${customTo ? fmtShort(customTo) : "…"}` : "Custom range";
  const customSummary = summarize(customFromTs, customToTs, customMonthly);

  // Window currently shown (last slide = custom) — also drives the statement.
  const activePeriod = slide >= 3
    ? { from: customFromTs, to: customToTs, label: hasCustom ? customLabel : "Custom" }
    : basePeriods[Math.min(slide, 2)];
  const activeSummary = slide >= 3 ? customSummary : baseSummaries[Math.min(slide, 2)];

  // ── Outstanding (unpaid) appointments — chargeable here if permitted ──
  const [unpaid, setUnpaid] = useState<AppointmentWithDetails[]>([]);
  // Dismissed outstanding rows — hidden from the list, remembered per device so
  // they don't reappear (uncollectable no-shows/freebies the barber clears out).
  const [dismissedOut, setDismissedOut] = useState<Set<string>>(new Set());
  useEffect(() => {
    try { const raw = localStorage.getItem("cw_dismissed_outstanding"); if (raw) setDismissedOut(new Set(JSON.parse(raw))); } catch { /* ignore */ }
  }, []);
  const dismissOutstanding = useCallback((id: string) => {
    setDismissedOut(prev => {
      const next = new Set(prev); next.add(id);
      try { localStorage.setItem("cw_dismissed_outstanding", JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const [selectedAppt, setSelectedAppt] = useState<AppointmentWithDetails | null>(null);
  const [detailBusy, setDetailBusy] = useState("");
  const [toast, setToast] = useState("");
  const showToast = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  const loadUnpaid = useCallback(async () => {
    if (!shop?.id || !barber?.id) return;
    const { data } = await supabase
      .from("appointments")
      .select("*, services(name), barbers(name)")
      .eq("shop_id", shop.id).eq("barber_id", barber.id)
      .gt("total_amount", 0)
      .order("date", { ascending: false }).limit(100);
    const rows = ((data ?? []) as AppointmentWithDetails[]).filter(a => {
      const s = a.payment_status;
      return s !== "paid" && s !== "captured" && s !== "refunded" && a.status !== "cancelled";
    });
    setUnpaid(rows);
  }, [shop?.id, barber?.id]);
  useEffect(() => { loadUnpaid(); }, [loadUnpaid]);

  // Realtime + refresh — a charge/no-show fee shows up without a manual reload.
  // (Stripe state never fires a DB event, so also re-sync on focus + interval.)
  useEffect(() => {
    if (!shop?.id) return;
    const reload = () => { loadEarnings(); loadUnpaid(); syncStripe(); };
    const ch = supabase
      .channel(`barber-payments:${shop.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `shop_id=eq.${shop.id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `shop_id=eq.${shop.id}` }, reload)
      .subscribe();
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(onVisible, 60000);
    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, [shop?.id, loadEarnings, loadUnpaid, syncStripe]);

  const patchAppt = useCallback((id: string, p: Partial<AppointmentWithDetails>) => {
    setUnpaid(prev => prev.map(a => (a.id === id ? { ...a, ...p } as AppointmentWithDetails : a)));
    setSelectedAppt(prev => (prev && prev.id === id ? { ...prev, ...p } as AppointmentWithDetails : prev));
  }, []);
  const apptActions = useMemo(
    () => makeApptActions({ shop: shop ?? null, accessToken, patch: patchAppt, setBusy: setDetailBusy, toast: showToast, onDone: () => { setSelectedAppt(null); loadUnpaid(); } }),
    [shop, accessToken, patchAppt, showToast, loadUnpaid],
  );
  const visibleUnpaid = unpaid.filter(a => !dismissedOut.has(a.id));
  const outstandingTotal = visibleUnpaid.reduce((s, a) => s + (a.total_amount ?? 0), 0);

  // ── Statement rows — window transactions (All/Card/Cash) or the collectable
  // unpaid appointments (Unpaid), grouped by calendar day like the owner page. ─
  const inWindow = (t: Tx) => { const ms = new Date(t.created_at).getTime(); return ms >= activePeriod.from && ms <= activePeriod.to; };
  const windowTxs = [...txs].filter(inWindow).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const recent = windowTxs.slice(0, activePeriod.to === Infinity ? 50 : 300);
  const feedTxs = recent.filter(t =>
    txFilter === "all" ? true : txFilter === "card" ? t.payment_method !== "cash" : txFilter === "cash" ? t.payment_method === "cash" : false);

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
    const m = new Map<number, Tx[]>();
    feedTxs.forEach(t => { const k = dayStart(new Date(t.created_at).getTime()); const arr = m.get(k) ?? []; arr.push(t); m.set(k, arr); });
    return Array.from(m.keys()).sort((a, b) => b - a).map(k => {
      const items = m.get(k)!;
      const total = items.reduce((s, t) => s + earnedOf(t), 0);
      return { key: k, label: dayLabel(k), total, items };
    });
  })();
  const unpaidGroups = (() => {
    const m = new Map<number, AppointmentWithDetails[]>();
    visibleUnpaid.forEach(a => { const k = dayStart(new Date(a.date + "T00:00:00").getTime()); const arr = m.get(k) ?? []; arr.push(a); m.set(k, arr); });
    return Array.from(m.keys()).sort((a, b) => b - a).map(k => ({ key: k, label: dayLabel(k), items: m.get(k)! }));
  })();
  const showUnpaid = txFilter === "unpaid";
  const statementEmpty = showUnpaid ? unpaidGroups.length === 0 : txGroups.length === 0;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-28">
      {toast && (
        <div className="fixed bottom-24 right-4 z-[200] bg-[#141414] border border-[#2a2a2a] rounded-xl px-5 py-3 text-sm text-white shadow-xl">
          <span className="text-[#00e5a0]">✓</span> {toast}
        </div>
      )}

      {/* Header (barber portal keeps its own title) */}
      <div className="mb-1">
        <h1 className="hidden lg:block text-2xl font-bold text-white uppercase tracking-wide">Payments</h1>
        <p className="text-[#8f8f8f] text-sm mt-0.5">{isOwner ? "You own this shop · you keep 100%" : `Your take-home · ${pct}% commission + tips`}</p>
      </div>

      {/* ── Earnings — the period filters live in the carousel ─────────────── */}
      <div className="cwp-earn-head">
        <span className="cwp-lbl">You earned</span>
        <span className="cwp-hint">‹ swipe periods ›</span>
      </div>
      <div ref={railRef}
        onScroll={() => { const el = railRef.current; if (el) setSlide(Math.round(el.scrollLeft / el.clientWidth)); }}
        className="cwp-rail">
        {basePeriods.map((p, i) => {
          const s = baseSummaries[i];
          return (
            <div key={p.label} className="cwp-ecard">
              <div className="cwp-period">
                <span className="cwp-pname">{p.label}</span>
                {p.range && <span className="cwp-prange">{p.range}</span>}
              </div>
              <div className="cwp-amt">{loading ? "—" : formatCurrency(s.earned)}</div>
              <div className={cn("cwp-meta", s.count === 0 && "cwp-flat")}>
                {s.count > 0
                  ? <>↑ {s.count} cut{s.count !== 1 ? "s" : ""} <span className="cwp-muted">· {formatCurrency(s.avg)} avg{s.tips > 0 ? ` · ${formatCurrency(s.tips)} tips` : ""}{s.cash > 0 ? ` · ${formatCurrency(s.cash)} cash` : ""}</span></>
                  : "No cuts in this period"}
              </div>
              <Spark data={s.data} />
            </div>
          );
        })}
        {/* Custom range card — last in the rail */}
        {hasCustom ? (
          <div className="cwp-ecard">
            <div className="cwp-period">
              <span className="cwp-pname">Custom</span>
              <button className="cwp-editrange" onClick={() => setShowCustomModal(true)}>Edit ›</button>
            </div>
            <div className="cwp-amt">{formatCurrency(customSummary.earned)}</div>
            <div className={cn("cwp-meta", customSummary.count === 0 && "cwp-flat")}>
              {customLabel}{customSummary.count > 0 ? <span className="cwp-muted"> · {customSummary.count} cut{customSummary.count !== 1 ? "s" : ""}</span> : ""}
            </div>
            <Spark data={customSummary.data} />
          </div>
        ) : (
          <div className="cwp-ecard cwp-ghost">
            <span className="cwp-pname">Custom range</span>
            <p>Pick any two dates to total<br />your earnings for a window.</p>
            <button className="cwp-pick" onClick={() => setShowCustomModal(true)}>Choose dates <ChevronRight size={13} /></button>
          </div>
        )}
      </div>
      <div className="cwp-dots">
        {Array.from({ length: basePeriods.length + 1 }).map((_, i) => (
          <i key={i} className={cn(i === slide && "cwp-on")} />
        ))}
      </div>

      {/* ── Two summary tiles ──────────────────────────────────────────────── */}
      <div className="cwp-tiles">
        <button className="cwp-tile cwp-warn" onClick={() => setTxFilter(txFilter === "unpaid" ? "all" : "unpaid")}>
          <div className="cwp-lbl">Outstanding</div>
          <div className="cwp-tv">{formatCurrency(outstandingTotal)}</div>
          <div className="cwp-tn">{visibleUnpaid.length} unpaid{visibleUnpaid.length > 0 ? (canManage ? " · tap to collect" : " · tap to view") : ""}</div>
        </button>
        <div className="cwp-tile">
          <div className="cwp-lbl">Tips</div>
          <div className="cwp-tv">{formatCurrency(activeSummary.tips)}</div>
          <div className="cwp-tn">{activePeriod.label}</div>
        </div>
      </div>

      {/* ── Statement ──────────────────────────────────────────────────────── */}
      <div className="cwp-txhead"><h2>Transactions</h2></div>
      <div className="cwp-seg">
        {(["all", "card", "cash", "unpaid"] as const).map(f => (
          <button key={f} className={cn(txFilter === f && "cwp-on")} onClick={() => setTxFilter(f)}>
            {f === "all" ? "All" : f === "card" ? "Card" : f === "cash" ? "Cash" : "Unpaid"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-[#66666b] text-sm">Loading payments…</div>
      ) : statementEmpty ? (
        <div className="py-16 text-center text-[#66666b] text-sm">
          {showUnpaid ? "Nothing outstanding — you're all caught up." : "No transactions in this period."}
        </div>
      ) : showUnpaid ? (
        <div className="cwp-statement">
          {unpaidGroups.map(g => (
            <div key={g.key} className="cwp-daygroup">
              <div className="cwp-day"><span className="cwp-dlabel">{g.label}</span></div>
              {g.items.map(a => (
                <button key={a.id} className="cwp-row" onClick={() => canManage && setSelectedAppt(a)} disabled={!canManage} style={!canManage ? { cursor: "default" } : undefined}>
                  <span className="cwp-glyph cwp-due"><Clock size={18} /></span>
                  <div className="cwp-rmid">
                    <div className="cwp-nm">{a.client_name}</div>
                    <div className="cwp-svc">{(a.services as { name: string } | null)?.name ?? "Service"}{a.time_slot ? ` · ${a.time_slot}` : ""}</div>
                    {canManage && <span className="cwp-send">Take payment →</span>}
                  </div>
                  <div className="cwp-rright">
                    <div className="cwp-a cwp-adue">{formatCurrency(a.total_amount ?? 0)}</div>
                    <div className="cwp-m"><span className="cwp-tag cwp-tdue">Unpaid</span></div>
                  </div>
                  {/* Dismiss — clears an uncollectable item from the list */}
                  <span role="button" tabIndex={0} aria-label="Dismiss"
                    onClick={e => { e.stopPropagation(); dismissOutstanding(a.id); showToast("Dismissed"); }}
                    className="p-1.5 -mr-1 rounded-lg text-[#666] hover:text-white hover:bg-white/5 flex-shrink-0 transition-colors self-center cursor-pointer">
                    <X size={16} />
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="cwp-statement">
          {txGroups.map(g => (
            <div key={g.key} className="cwp-daygroup">
              <div className="cwp-day">
                <span className="cwp-dlabel">{g.label}</span>
                {g.total > 0 && <span className="cwp-dtot">+{formatCurrency(g.total)}</span>}
              </div>
              {g.items.map(t => {
                const cash = t.payment_method === "cash";
                return (
                  <div key={t.id} className="cwp-row" style={{ cursor: "default" }}>
                    <span className={cn("cwp-glyph", cash ? "cwp-cash" : "cwp-card")}>{cash ? <Banknote size={18} /> : <CreditCard size={18} />}</span>
                    <div className="cwp-rmid">
                      <div className="cwp-nm">{t.client_name ?? "Walk-in"}</div>
                      <div className="cwp-svc">{t.service_name ?? "Service"}</div>
                    </div>
                    <div className="cwp-rright">
                      <div className="cwp-a cwp-apos">{formatCurrency(earnedOf(t))}</div>
                      <div className="cwp-m">
                        <span className="cwp-method">{cash ? "Cash" : "Card"}</span>
                        {isOwner && !cash && feeOf(t) > 0 ? ` · after ${formatCurrency(feeOf(t))} fee` : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {selectedAppt && (
        <Portal>
          <ApptDetail
            appt={selectedAppt}
            barbers={[]}
            onClose={() => setSelectedAppt(null)}
            actions={apptActions}
            busy={detailBusy}
            readOnly={!canManage}
          />
        </Portal>
      )}

      {/* ── Custom date-range popup ──────────────────────────────────────────── */}
      {showCustomModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => setShowCustomModal(false)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="bg-[#0c0c0c] border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-xs space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Custom range</h2>
                <button onClick={() => setShowCustomModal(false)} className="text-[#8f8f8f] hover:text-white text-xl leading-none">✕</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-[#888] mb-1">From</label>
                  <input type="date" value={customFrom} max={customTo || undefined} onChange={e => setCustomFrom(e.target.value)}
                    className="w-full bg-[#141414] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white [color-scheme:dark]" />
                </div>
                <div>
                  <label className="block text-xs text-[#888] mb-1">To</label>
                  <input type="date" value={customTo} min={customFrom || undefined} onChange={e => setCustomTo(e.target.value)}
                    className="w-full bg-[#141414] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white [color-scheme:dark]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="rounded-xl border border-[#2a2a2a] bg-[#141414] text-white text-sm font-medium py-2.5 hover:bg-[#1a1a1a]"
                  onClick={() => setShowCustomModal(false)}>Cancel</button>
                <button type="button" className="rounded-xl bg-white text-black text-sm font-semibold py-2.5 hover:opacity-90"
                  onClick={() => { setShowCustomModal(false); const el = railRef.current; if (el) el.scrollTo({ left: el.clientWidth * 3, behavior: "smooth" }); }}>Apply</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
