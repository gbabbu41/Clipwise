"use client";
import { useEffect, useState, useMemo, useCallback } from "react";
import { DollarSign, TrendingUp, Scissors, Receipt, CreditCard } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ApptDetail, Portal, makeApptActions } from "@/components/calendar-view";
import type { AppointmentWithDetails } from "@/lib/database.types";

type Period = "week" | "month" | "year";

interface Summary {
  revenue: number;
  commission: number;
  count: number;
  avgTicket: number;
  commissionPercent: number;
}

interface Transaction {
  id: string;
  client_name?: string;
  service_name?: string;
  amount: number;
  tip: number;
  commission_amount?: number;
  created_at: string;
}

export default function BarberPaymentsPage() {
  const { accessToken, profile } = useAuth();
  const { shop, barber } = useBarber();
  const [period, setPeriod] = useState<Period>("month");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Owner-who-cuts gets full rights; staff barber needs manage_appointments to charge.
  const canManage = profile?.role === "shop_owner" || barber?.permissions?.manage_appointments === true;

  // ── Outstanding (unpaid) appointments — what's still owed, chargeable here ──
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

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    const shopParam = shop?.id ? `&shop_id=${shop.id}` : "";
    fetch(`/api/barber/earnings?period=${period}${shopParam}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.json())
      .then(({ summary: s, transactions: t }) => { setSummary(s); setTransactions(t ?? []); })
      .finally(() => setLoading(false));
  }, [accessToken, period, shop?.id]);

  const periodLabel = period === "week" ? "This Week" : period === "month" ? "This Month" : "This Year";
  const pct = summary?.commissionPercent ?? 0;
  const youKeep = summary?.commission ?? 0;
  const shopKeeps = Math.max(0, (summary?.revenue ?? 0) - youKeep);
  const outstandingTotal = unpaid.reduce((s, a) => s + (a.total_amount ?? 0), 0);

  const chartData = (() => {
    const map: Record<string, number> = {};
    for (const tx of transactions) {
      const d = tx.created_at.split("T")[0];
      const commission = tx.commission_amount ?? ((tx.amount * pct) / 100);
      map[d] = (map[d] ?? 0) + commission;
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, yours]) => ({
        day: new Date(date + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" }),
        yours: Math.round(yours),
      }));
  })();

  return (
    <div className="p-6 max-w-4xl mx-auto pb-28">
      {toast && (
        <div className="fixed bottom-24 right-4 z-[200] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl">
          <span className="text-[#00e5a0]">✓</span> {toast}
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Payments</h1>
          <p className="text-[#777] text-sm mt-0.5">{pct ? `${pct}% commission` : "Your pay breakdown"}</p>
        </div>
        <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1">
          {(["week", "month", "year"] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={cn("px-3 py-1.5 text-sm rounded-lg transition-all capitalize",
                period === p ? "bg-gold/15 text-gold border border-gold/20" : "text-[#777] hover:text-white")}>
              {p === "week" ? "Week" : p === "month" ? "Month" : "Year"}
            </button>
          ))}
        </div>
      </div>

      {/* You keep / Shop keeps — the exact split of what was collected */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-2xl border border-[#00e5a0]/25 bg-[#00e5a0]/[0.06] p-4">
          <p className="text-[10px] uppercase tracking-wide text-[#00e5a0]/80">You keep</p>
          <p className="text-2xl font-extrabold text-[#00e5a0] mt-1">{loading ? "—" : formatCurrency(youKeep)}</p>
          <p className="text-[11px] text-[#777] mt-0.5">{pct}% of {formatCurrency(summary?.revenue ?? 0)} collected</p>
        </div>
        <div className="rounded-2xl border border-[#1e1e1e] bg-[#0c0c0c] p-4">
          <p className="text-[10px] uppercase tracking-wide text-[#777]">Shop keeps</p>
          <p className="text-2xl font-extrabold text-white mt-1">{loading ? "—" : formatCurrency(shopKeeps)}</p>
          <p className="text-[11px] text-[#777] mt-0.5">{periodLabel}</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Collected", value: summary ? formatCurrency(summary.revenue) : "—", icon: DollarSign, sub: periodLabel },
          { label: "My Commission", value: summary ? formatCurrency(summary.commission) : "—", icon: TrendingUp, sub: `${pct}%` },
          { label: "Services", value: String(summary?.count ?? "—"), icon: Scissors, sub: "completed" },
          { label: "Avg Ticket", value: summary ? formatCurrency(summary.avgTicket) : "—", icon: Receipt, sub: "per service" },
        ].map(stat => (
          <div key={stat.label} className="bg-surface border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-[#777]">{stat.label}</p>
              <stat.icon size={16} className="text-gold" />
            </div>
            <p className="text-2xl font-bold text-white">{loading ? "—" : stat.value}</p>
            <p className="text-xs text-[#777] mt-1">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Outstanding — unpaid appointments you can still collect on */}
      {unpaid.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[#777] uppercase tracking-wider">Outstanding · {formatCurrency(outstandingTotal)}</h2>
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

      {/* Earnings trend — your commission per day */}
      {!loading && chartData.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-4 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">My Earnings Trend</h2>
            <span className="text-xs text-[#777]">{periodLabel}</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#777" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#777" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ background: "#141414", border: "1px solid #1e1e1e", borderRadius: 12, color: "#fff", fontSize: 12 }}
                cursor={{ fill: "rgba(201,168,76,0.08)" }}
                formatter={(v) => [`$${Number(v)}`, "Your cut"]}
              />
              <Bar dataKey="yours" fill="#C9A84C" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Completed transactions */}
      <div>
        <h2 className="text-sm font-semibold text-[#777] uppercase tracking-wider mb-3">Transactions · {periodLabel}</h2>
        {loading ? (
          <div className="space-y-2">
            {[1,2,3,4].map(i => <div key={i} className="bg-surface border border-border rounded-xl h-14 animate-pulse" />)}
          </div>
        ) : transactions.length === 0 ? (
          <div className="bg-surface border border-border rounded-2xl p-10 text-center">
            <DollarSign size={40} className="text-[#777] mx-auto mb-3" />
            <p className="text-[#777]">No transactions {periodLabel.toLowerCase()}</p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <div className="grid grid-cols-4 px-4 py-2.5 border-b border-border">
              {["Date", "Client", "Service", "Amount / Commission"].map(h => (
                <p key={h} className="text-xs font-semibold text-[#777]">{h}</p>
              ))}
            </div>
            {transactions.map(tx => {
              const commission = tx.commission_amount ?? ((tx.amount * pct) / 100);
              return (
                <div key={tx.id} className="grid grid-cols-4 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-surface-raised transition-colors">
                  <p className="text-sm text-[#777]">{new Date(tx.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</p>
                  <p className="text-sm text-white">{tx.client_name ?? "—"}</p>
                  <p className="text-sm text-[#777]">{tx.service_name ?? "—"}</p>
                  <div>
                    <p className="text-sm font-medium text-white">{formatCurrency(tx.amount + (tx.tip ?? 0))}</p>
                    <p className="text-xs text-gold">↳ {formatCurrency(commission)} yours</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Charge / take-payment modal — shared with the calendar/Appointments */}
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
