"use client";
import { useEffect, useState, useMemo, useCallback } from "react";
import { CreditCard, Banknote, DollarSign } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip } from "recharts";
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

// Which window the earnings card + transactions reflect. The shop owner pays
// each barber on their own cycle (weekly / bi-weekly / …) which the app can't
// know, so the barber picks the window — including a Custom from→to range — that
// matches how they're actually paid.
type PeriodKey = "week" | "biweekly" | "month" | "all" | "custom";

// Tooltip rides the top strip and never captures touches (see stats carousel).
const tip = {
  contentStyle: { borderRadius: 10, border: "1px solid #2a2a2a", background: "#0c0c0c", color: "#fff", fontSize: 11, padding: "4px 8px" },
  wrapperStyle: { pointerEvents: "none" as const, zIndex: 30 },
  position: { y: 0 },
  allowEscapeViewBox: { x: true, y: true },
  isAnimationActive: false,
} as const;

export default function BarberPaymentsPage() {
  const { accessToken, profile } = useAuth();
  const { shop, barber } = useBarber();
  const canManage = profile?.role === "shop_owner" || barber?.permissions?.manage_appointments === true;

  const [txs, setTxs] = useState<Tx[]>([]);
  const [pct, setPct] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stripeNet, setStripeNet] = useState<{ byPi: Record<string, { gross: number; fee: number; net: number }> } | null>(null);

  // Selected earnings window
  const [periodKey, setPeriodKey] = useState<PeriodKey>("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

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

  const summarize = useCallback((from: number, to: number, monthly: boolean) => {
    const inP = txs.filter(t => { const ms = new Date(t.created_at).getTime(); return ms >= from && ms <= to; });
    const earned = inP.reduce((s, t) => s + earnedOf(t), 0);
    const gross = inP.reduce((s, t) => s + grossOf(t), 0);
    const tips = inP.reduce((s, t) => s + (t.tip ?? 0), 0);
    const fees = inP.reduce((s, t) => s + feeOf(t), 0);
    // Cash is collected in hand and kept separate from the card/Stripe balance
    // (which is what the green headline shows), mirroring the owner Payments page.
    const cash = inP.filter(t => t.payment_method === "cash").reduce((s, t) => s + earnedOf(t), 0);
    const cardEarned = earned - cash;
    const count = inP.length;
    const m = new Map<string, { order: number; val: number }>();
    inP.forEach(t => {
      if (t.payment_method === "cash") return;   // chart tracks the card/Stripe net only
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

  // Resolve the selected window to a {from, to} range + label + chart bucketing.
  const fmtShort = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  const period = useMemo(() => {
    const now = Date.now();
    if (periodKey === "all") return { from: 0, to: Infinity, label: "All time", monthly: true };
    if (periodKey === "custom") {
      const from = customFrom ? new Date(customFrom + "T00:00:00").getTime() : 0;
      const to = customTo ? new Date(customTo + "T23:59:59.999").getTime() : now;
      const label = (customFrom || customTo)
        ? `${customFrom ? fmtShort(customFrom) : "…"} – ${customTo ? fmtShort(customTo) : "…"}`
        : "Custom range";
      return { from, to, label, monthly: (to - from) > 62 * 86400000 };
    }
    const label = periodKey === "week" ? "This week" : periodKey === "biweekly" ? "Last 14 days" : "This month";
    return { from: startOf(periodKey), to: now, label, monthly: false };
  }, [periodKey, customFrom, customTo]);

  const sel = useMemo(() => summarize(period.from, period.to, period.monthly), [summarize, period]);

  // ── Outstanding (unpaid) appointments — chargeable here if permitted ──
  const [unpaid, setUnpaid] = useState<AppointmentWithDetails[]>([]);
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
  const outstandingTotal = unpaid.reduce((s, a) => s + (a.total_amount ?? 0), 0);

  // Transactions within the selected window (newest first).
  const inWindow = (t: Tx) => { const ms = new Date(t.created_at).getTime(); return ms >= period.from && ms <= period.to; };
  const windowTxs = [...txs].filter(inWindow).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const recent = windowTxs.slice(0, periodKey === "all" ? 50 : 300);

  const presets: [PeriodKey, string][] = [
    ["week", "This week"], ["biweekly", "Last 14 days"], ["month", "This month"], ["all", "All time"], ["custom", "Custom"],
  ];

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto pb-28">
      {toast && (
        <div className="fixed bottom-24 right-4 z-[200] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl">
          <span className="text-[#00e5a0]">✓</span> {toast}
        </div>
      )}

      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white">Payments</h1>
        <p className="text-[#777] text-sm mt-0.5">{isOwner ? "You own this shop · you keep 100%" : `Your take-home · ${pct}% commission + tips`}</p>
      </div>

      {/* ── Period filter — presets + a custom from→to range ─────────────────── */}
      <div className="mb-3">
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {presets.map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => setPeriodKey(k)}
              className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors",
                periodKey === k ? "bg-white text-black border-white" : "bg-[#141414] text-[#aaa] border-[#1e1e1e] hover:text-white")}>
              {lbl}
            </button>
          ))}
        </div>
        {periodKey === "custom" && (
          <div className="flex items-center gap-2 mt-2.5">
            <input type="date" value={customFrom} max={customTo || undefined} onChange={e => setCustomFrom(e.target.value)}
              className="bg-[#141414] border border-[#1e1e1e] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-white [color-scheme:dark]" />
            <span className="text-[#777] text-xs">to</span>
            <input type="date" value={customTo} min={customFrom || undefined} onChange={e => setCustomTo(e.target.value)}
              className="bg-[#141414] border border-[#1e1e1e] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-white [color-scheme:dark]" />
          </div>
        )}
      </div>

      {/* ── Earnings card for the selected window ────────────────────────────── */}
      <div className="mb-6 rounded-2xl bg-[#1c1c1c] border border-[#2a2a2a] px-4 py-5 flex flex-col">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wide text-[#888]">You earned · {period.label}</p>
          <div className="flex items-baseline gap-2">
            {sel.cash > 0 && <span className="text-xs font-semibold text-amber-500">+{formatCurrency(sel.cash)} cash</span>}
            {sel.tips > 0 && <span className="text-xs font-semibold text-amber-500/70">{formatCurrency(sel.tips)} tips</span>}
          </div>
        </div>
        <p className="font-extrabold mt-1.5 text-3xl sm:text-4xl text-[#00e5a0]">{loading ? "—" : formatCurrency(sel.cardEarned)}</p>
        <p className="text-xs text-[#888] mt-1.5">
          From {formatCurrency(sel.gross)} collected{sel.fees > 0 ? ` · ${formatCurrency(sel.fees)} Stripe fees` : ""}
        </p>
        <div className="flex-1 min-h-[80px] mt-3 -mx-1">
          {sel.data.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sel.data} margin={{ top: 4, right: 6, left: 6, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#9ca3af" }} interval="preserveStartEnd" minTickGap={20} axisLine={false} tickLine={false} />
                <Bar dataKey="val" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                <Tooltip {...tip} formatter={(v) => [formatCurrency(Number(v)), "Earned"]} cursor={{ fill: "rgba(255,255,255,0.08)" }} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="h-full flex items-center justify-center text-xs text-[#555]">No earnings in this period</div>}
        </div>
        <div className="mt-2 pt-2 border-t border-[#2a2a2a] grid grid-cols-3 gap-2 text-xs">
          <div><p className="text-[#888]">Services</p><p className="font-semibold text-white">{sel.count}</p></div>
          <div><p className="text-[#888]">Avg ticket</p><p className="font-semibold text-white">{formatCurrency(sel.avg)}</p></div>
          <div className="text-right"><p className="text-[#888]">{isOwner ? "Collected" : "To shop"}</p><p className="font-semibold text-[#ccc]">{isOwner ? formatCurrency(sel.gross) : formatCurrency(sel.shopCut)}</p></div>
        </div>
      </div>

      {/* ── Outstanding — unpaid appointments you can still collect on ──────── */}
      {unpaid.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-white">Outstanding · {formatCurrency(outstandingTotal)}</h2>
            <span className="text-xs text-[#777]">{unpaid.length} unpaid</span>
          </div>
          <div className="space-y-2">
            {unpaid.map(a => (
              <button key={a.id} onClick={() => canManage && setSelectedAppt(a)} disabled={!canManage}
                className={cn("w-full text-left rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] p-3 flex items-center gap-3 transition-colors",
                  canManage ? "hover:border-[#2a2a2a]" : "cursor-default")}>
                <div className="w-9 h-9 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center flex-shrink-0">
                  <CreditCard size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{a.client_name}</p>
                  <p className="text-xs text-[#777] truncate">
                    {(a.services as { name: string } | null)?.name ?? "Service"} · {a.date}{a.time_slot ? ` · ${a.time_slot}` : ""}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-white">{formatCurrency(a.total_amount ?? 0)}</p>
                  <p className="text-[11px] text-amber-400">{canManage ? "Take payment ›" : "Unpaid"}</p>
                </div>
              </button>
            ))}
          </div>
          {!canManage && (
            <p className="text-[11px] text-[#666] mt-2">Ask your shop owner for the &ldquo;manage appointments&rdquo; permission to collect payment here.</p>
          )}
        </div>
      )}

      {/* ── Transactions (selected window) ──────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-white">Transactions</h2>
        <span className="text-xs text-[#777]">{period.label}</span>
      </div>
      {loading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="bg-[#0c0c0c] border border-[#1e1e1e] rounded-xl h-14 animate-pulse" />)}</div>
      ) : recent.length === 0 ? (
        <div className="bg-[#0c0c0c] border border-[#1e1e1e] rounded-2xl p-10 text-center">
          <DollarSign size={36} className="text-[#777] mx-auto mb-3" />
          <p className="text-[#777] text-sm">No transactions in this period</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recent.map(t => {
            const cash = t.payment_method === "cash";
            return (
              <div key={t.id} className="rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] p-3 flex items-center gap-3">
                <div className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0", cash ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400")}>
                  {cash ? <Banknote size={16} /> : <CreditCard size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{t.client_name ?? "Walk-in"}</p>
                  <p className="text-xs text-[#777] truncate">
                    {t.service_name ?? "Service"} · {new Date(t.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-white">{formatCurrency(earnedOf(t))}</p>
                  <p className="text-[11px]">
                    <span className={cash ? "text-amber-400" : "text-[#666]"}>{cash ? "cash" : "card"}</span>
                    {isOwner && !cash && feeOf(t) > 0 && <span className="text-[#666]"> · after {formatCurrency(feeOf(t))} fee</span>}
                  </p>
                </div>
              </div>
            );
          })}
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
    </div>
  );
}
