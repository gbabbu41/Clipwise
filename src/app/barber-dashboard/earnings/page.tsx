"use client";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
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
  created_at: string;
}

// Tooltip rides the top strip and never captures touches (see stats carousel).
const tip = {
  contentStyle: { borderRadius: 10, border: "1px solid #eee", fontSize: 11, padding: "4px 8px" },
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

  const [slide, setSlide] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  // ── All-time transactions in one call; periods are derived client-side ──
  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    const shopParam = shop?.id ? `&shop_id=${shop.id}` : "";
    fetch(`/api/barber/earnings?period=all${shopParam}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.json())
      .then(({ transactions, summary }) => {
        setTxs((transactions ?? []) as Tx[]);
        setPct(summary?.commissionPercent ?? 0);
        setIsOwner(summary?.isOwner ?? false);
      })
      .finally(() => setLoading(false));
  }, [accessToken, shop?.id]);

  // His take-home per transaction = commission cut (100% if owner) + all tips.
  const earnedOf = useCallback((t: Tx) => {
    const commission = isOwner ? t.amount : (t.commission_amount ?? (t.amount * pct) / 100);
    return commission + (t.tip ?? 0);
  }, [isOwner, pct]);
  const grossOf = (t: Tx) => t.amount + (t.tip ?? 0);

  const startOf = (kind: "today" | "week" | "biweekly" | "month") => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (kind === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));      // Monday
    else if (kind === "biweekly") d.setDate(d.getDate() - 13);                  // trailing 14 days
    else if (kind === "month") d.setDate(1);
    return d.getTime();
  };

  const summarize = useCallback((from: number, monthly: boolean) => {
    const inP = txs.filter(t => new Date(t.created_at).getTime() >= from);
    const earned = inP.reduce((s, t) => s + earnedOf(t), 0);
    const gross = inP.reduce((s, t) => s + grossOf(t), 0);
    const tips = inP.reduce((s, t) => s + (t.tip ?? 0), 0);
    const cash = inP.filter(t => t.payment_method === "cash").reduce((s, t) => s + earnedOf(t), 0);
    const count = inP.length;
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
    return { earned, gross, tips, cash, count, data, avg: count ? gross / count : 0, shopCut: Math.max(0, gross - earned) };
  }, [txs, earnedOf]);

  const periods = useMemo(() => [
    { key: "week", label: "This week", ...summarize(startOf("week"), false) },
    { key: "biweekly", label: "Bi-weekly", ...summarize(startOf("biweekly"), false) },
    { key: "month", label: "This month", ...summarize(startOf("month"), false) },
    { key: "all", label: "All time", ...summarize(0, true) },
  ], [summarize]);

  const all = summarize(0, true);
  const earnedToday = txs.filter(t => new Date(t.created_at).getTime() >= startOf("today")).reduce((s, t) => s + earnedOf(t), 0);

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

  const patchAppt = useCallback((id: string, p: Partial<AppointmentWithDetails>) => {
    setUnpaid(prev => prev.map(a => (a.id === id ? { ...a, ...p } as AppointmentWithDetails : a)));
    setSelectedAppt(prev => (prev && prev.id === id ? { ...prev, ...p } as AppointmentWithDetails : prev));
  }, []);
  const apptActions = useMemo(
    () => makeApptActions({ shop: shop ?? null, accessToken, patch: patchAppt, setBusy: setDetailBusy, toast: showToast, onDone: () => { setSelectedAppt(null); loadUnpaid(); } }),
    [shop, accessToken, patchAppt, showToast, loadUnpaid],
  );
  const outstandingTotal = unpaid.reduce((s, a) => s + (a.total_amount ?? 0), 0);

  const goTo = (i: number) => { const el = carouselRef.current; if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" }); };

  const recent = [...txs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 30);

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

      {/* ── Earnings carousel (mirrors the owner Payments cards) ────────────── */}
      <div className="mb-4">
        <div ref={carouselRef}
          onScroll={() => { const el = carouselRef.current; if (el) setSlide(Math.round(el.scrollLeft / el.clientWidth)); }}
          className="flex overflow-x-auto snap-x snap-mandatory gap-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">

          {/* Slide 1 — hero: net earned all-time + key indicators */}
          <div className="min-w-full snap-center rounded-2xl bg-white px-4 py-5 shadow-sm flex flex-col">
            <p className="text-[10px] uppercase tracking-wide text-gray-400">You earned · all-time</p>
            <p className="font-extrabold mt-1.5 text-3xl sm:text-4xl text-emerald-600">{loading ? "—" : formatCurrency(all.earned)}</p>
            <p className="text-xs text-gray-500 mt-1.5">
              From {formatCurrency(all.gross)} collected{all.cash > 0 ? ` · ${formatCurrency(all.cash)} in cash` : ""}
            </p>
            <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-gray-400">Earned today</p>
                <p className="font-semibold text-emerald-600">{formatCurrency(earnedToday)}</p>
              </div>
              <div>
                <p className="text-gray-400">Tips</p>
                <p className="font-semibold text-amber-500">{formatCurrency(all.tips)}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-400">{isOwner ? "Your cut" : "Shop kept"}</p>
                <p className="font-semibold text-gray-700">{isOwner ? "100%" : formatCurrency(all.shopCut)}</p>
              </div>
            </div>
          </div>

          {/* Slides 2-5 — earned by period, each with a daily/monthly bar chart */}
          {periods.map(p => (
            <div key={p.key} className="min-w-full snap-center rounded-2xl bg-white px-4 py-5 shadow-sm flex flex-col">
              <div className="flex items-baseline justify-between">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Earned · {p.label}</p>
                {p.tips > 0 && <span className="text-xs font-semibold text-amber-500">{formatCurrency(p.tips)} tips</span>}
              </div>
              <p className="text-3xl sm:text-4xl font-extrabold text-emerald-600 mt-1.5">{formatCurrency(p.earned)}</p>
              <div className="flex-1 min-h-[72px] mt-2 -mx-1">
                {p.data.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={p.data} margin={{ top: 4, right: 6, left: 6, bottom: 0 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#9ca3af" }} interval="preserveStartEnd" minTickGap={20} axisLine={false} tickLine={false} />
                      <Bar dataKey="val" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                      <Tooltip {...tip} formatter={(v) => [formatCurrency(Number(v)), "Earned"]} cursor={{ fill: "#f3f4f6" }} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <div className="h-full flex items-center justify-center text-xs text-gray-300">No earnings yet</div>}
              </div>
              {/* Extra indicators */}
              <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-3 gap-2 text-xs">
                <div><p className="text-gray-400">Services</p><p className="font-semibold text-gray-800">{p.count}</p></div>
                <div><p className="text-gray-400">Avg ticket</p><p className="font-semibold text-gray-800">{formatCurrency(p.avg)}</p></div>
                <div className="text-right"><p className="text-gray-400">{isOwner ? "Collected" : "To shop"}</p><p className="font-semibold text-gray-700">{isOwner ? formatCurrency(p.gross) : formatCurrency(p.shopCut)}</p></div>
              </div>
            </div>
          ))}
        </div>

        {/* Dots */}
        <div className="flex justify-center gap-1.5 mt-2.5">
          {Array.from({ length: 1 + periods.length }).map((_, i) => (
            <button key={i} type="button" aria-label={`Slide ${i + 1}`} onClick={() => goTo(i)}
              className={cn("h-1.5 rounded-full transition-all", i === slide ? "w-5 bg-white" : "w-1.5 bg-[#444]")} />
          ))}
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

      {/* ── Recent transactions ───────────────────────────────────────────── */}
      <h2 className="text-sm font-bold text-white mb-3">Recent Transactions</h2>
      {loading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="bg-[#0c0c0c] border border-[#1e1e1e] rounded-xl h-14 animate-pulse" />)}</div>
      ) : recent.length === 0 ? (
        <div className="bg-[#0c0c0c] border border-[#1e1e1e] rounded-2xl p-10 text-center">
          <DollarSign size={36} className="text-[#777] mx-auto mb-3" />
          <p className="text-[#777] text-sm">No transactions yet</p>
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
                  <p className="text-sm font-semibold text-white">{formatCurrency(grossOf(t))}</p>
                  <p className="text-[11px]"><span className="text-[#00e5a0]">↳ {formatCurrency(earnedOf(t))}</span> <span className={cash ? "text-amber-400" : "text-[#666]"}>{cash ? "cash" : "card"}</span></p>
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
