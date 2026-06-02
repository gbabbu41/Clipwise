"use client";
import { useEffect, useState } from "react";
import { DollarSign, TrendingUp, Scissors, Receipt } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { cn } from "@/lib/utils";

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

export default function BarberEarningsPage() {
  const { accessToken } = useAuth();
  const { shop } = useBarber();
  const [period, setPeriod] = useState<Period>("month");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Earnings</h1>
          <p className="text-[#777] text-sm mt-0.5">
            {summary ? `${summary.commissionPercent}% commission rate` : "Your pay breakdown"}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1">
          {(["week", "month", "year"] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-lg transition-all capitalize",
                period === p ? "bg-gold/15 text-gold border border-gold/20" : "text-[#555] hover:text-white"
              )}
            >
              {p === "week" ? "Week" : p === "month" ? "Month" : "Year"}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total Revenue", value: summary ? `$${summary.revenue.toFixed(0)}` : "—", icon: DollarSign, sub: periodLabel },
          { label: "My Commission", value: summary ? `$${summary.commission.toFixed(0)}` : "—", icon: TrendingUp, sub: `${summary?.commissionPercent ?? 0}%` },
          { label: "Services", value: summary?.count ?? "—", icon: Scissors, sub: "completed" },
          { label: "Avg Ticket", value: summary ? `$${summary.avgTicket.toFixed(0)}` : "—", icon: Receipt, sub: "per service" },
        ].map(stat => (
          <div key={stat.label} className="bg-surface border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-[#777]">{stat.label}</p>
              <stat.icon size={16} className="text-gold" />
            </div>
            <p className="text-2xl font-bold text-white">{loading ? "—" : stat.value}</p>
            <p className="text-xs text-[#999] mt-1">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Transaction list */}
      <div>
        <h2 className="text-sm font-semibold text-[#555] uppercase tracking-wider mb-3">
          Transactions · {periodLabel}
        </h2>

        {loading ? (
          <div className="space-y-2">
            {[1,2,3,4].map(i => <div key={i} className="bg-surface border border-border rounded-xl h-14 animate-pulse" />)}
          </div>
        ) : transactions.length === 0 ? (
          <div className="bg-surface border border-border rounded-2xl p-10 text-center">
            <DollarSign size={40} className="text-[#aaa] mx-auto mb-3" />
            <p className="text-[#555]">No transactions {periodLabel.toLowerCase()}</p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <div className="grid grid-cols-4 px-4 py-2.5 border-b border-border">
              {["Date", "Client", "Service", "Amount / Commission"].map(h => (
                <p key={h} className="text-xs font-semibold text-[#777]">{h}</p>
              ))}
            </div>
            {transactions.map(tx => {
              const commission = tx.commission_amount ?? ((tx.amount * (summary?.commissionPercent ?? 50)) / 100);
              return (
                <div key={tx.id} className="grid grid-cols-4 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-surface-raised transition-colors">
                  <p className="text-sm text-[#555]">{new Date(tx.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</p>
                  <p className="text-sm text-white">{tx.client_name ?? "—"}</p>
                  <p className="text-sm text-[#555]">{tx.service_name ?? "—"}</p>
                  <div>
                    <p className="text-sm font-medium text-white">${(tx.amount + (tx.tip ?? 0)).toFixed(0)}</p>
                    <p className="text-xs text-gold">↳ ${commission.toFixed(0)} yours</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
