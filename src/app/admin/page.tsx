"use client";
import { useState, useEffect, useCallback } from "react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Store, DollarSign, Calendar, Clock, TrendingUp, Search, X, Check, Copy, ExternalLink, Users, Shield, Bell } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import type { Shop } from "@/lib/database.types";

// ─── Extended types ───────────────────────────────────────────────────────────
interface ShopWithOwner extends Shop {
  users?: { name: string; email: string };
  revenue?: number;
  apptCount?: number;
}

type AdminTab = "overview" | "pending" | "all-shops" | "subscriptions";

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-surface-raised rounded-xl", className)} />;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, ok, onClose }: { msg: string; ok: boolean; onClose: () => void }) {
  const message = msg;
  return (
    <div className={cn(
      "fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-5 py-3 rounded-xl border shadow-xl text-sm font-medium",
      ok ? "bg-emerald-900/80 border-emerald-500/40 text-emerald-300" : "bg-red-900/80 border-red-500/40 text-red-300"
    )}>
      {ok ? <Check size={15} /> : <X size={15} />} {message}
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color = "gold" }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color?: string;
}) {
  const colorMap: Record<string, [string, string]> = {
    gold: ["bg-gold/15 text-gold", "bg-gold"],
    green: ["bg-emerald-500/15 text-emerald-400", "bg-emerald-500"],
    blue: ["bg-blue-500/15 text-blue-400", "bg-blue-500"],
    purple: ["bg-purple-500/15 text-purple-400", "bg-purple-500"],
    orange: ["bg-orange-500/15 text-orange-400", "bg-orange-500"],
  };
  const [iconClass, bgClass] = colorMap[color] ?? colorMap.gold;
  return (
    <Card className="relative overflow-hidden">
      <div className={cn("absolute inset-0 opacity-5", bgClass)} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs text-[#777] font-medium uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
          {sub && <p className="text-xs text-[#777] mt-1">{sub}</p>}
        </div>
        <div className={cn("p-2.5 rounded-xl", iconClass)}><Icon size={20} /></div>
      </div>
    </Card>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const v = status === "approved" ? "success" : status === "pending" ? "warning" : status === "suspended" ? "info" : "danger";
  return <Badge variant={v} className="capitalize">{status}</Badge>;
}

// ─── Chart Tooltip ────────────────────────────────────────────────────────────
function ChartTip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (active && payload?.length) {
    return (
      <div className="bg-surface-raised border border-border rounded-xl px-3 py-2 text-xs">
        <p className="text-[#555]">{label}</p>
        <p className="text-gold font-semibold">{payload[0].value} shops</p>
      </div>
    );
  }
  return null;
}

export default function AdminPage() {
  const { accessToken } = useAuth();
  const [tab, setTab] = useState<AdminTab>("overview");
  const [shops, setShops] = useState<ShopWithOwner[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [platformRevenue, setPlatformRevenue] = useState(0);
  const [totalAppts, setTotalAppts] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [rejectModal, setRejectModal] = useState<ShopWithOwner | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  // ── Load all platform data ──────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/shops", {
      headers: { "Authorization": `Bearer ${accessToken ?? ""}` },
    });
    if (!res.ok) { setLoading(false); return; }
    const { shops: shopData, transactions: txData, appointments: apptData, userCount } = await res.json();
    setShops((shopData ?? []) as ShopWithOwner[]);
    setPlatformRevenue((txData ?? []).reduce((s: number, t: { amount: number }) => s + (t.amount ?? 0), 0));
    setTotalAppts((apptData ?? []).length);
    setTotalUsers(userCount ?? 0);
    setLoading(false);
  }, [accessToken]);

  useEffect(() => { if (accessToken) loadData(); }, [accessToken, loadData]);

  // ── Approve shop ────────────────────────────────────────────────────────────
  const patchShop = (id: string, body: Record<string, string>) =>
    fetch("/api/admin/shops", { method: "PATCH", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken ?? ""}` }, body: JSON.stringify({ id, ...body }) });

  const approveShop = async (shop: ShopWithOwner) => {
    setSavingId(shop.id);
    const res = await patchShop(shop.id, { status: "approved" });
    setSavingId(null);
    if (!res.ok) { showToast("Failed to approve shop", false); return; }
    setShops((prev) => prev.map((s) => s.id === shop.id ? { ...s, status: "approved" } : s));
    fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "shop_approved", data: { shopName: shop.name, ownerName: shop.users?.name ?? "", ownerEmail: shop.users?.email ?? shop.email, slug: shop.slug } }),
    }).catch(() => {});
    showToast(`${shop.name} approved!`);
  };

  // ── Reject shop ─────────────────────────────────────────────────────────────
  const rejectShop = async () => {
    if (!rejectModal) return;
    const shop = rejectModal;
    setSavingId(shop.id);
    const res = await patchShop(shop.id, { status: "rejected", rejection_reason: rejectReason });
    setSavingId(null);
    if (!res.ok) { showToast("Failed to reject shop", false); return; }
    setShops((prev) => prev.map((s) => s.id === shop.id ? { ...s, status: "rejected", rejection_reason: rejectReason } : s));
    fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "shop_rejected", data: { shopName: shop.name, ownerName: shop.users?.name ?? "", ownerEmail: shop.users?.email ?? shop.email, reason: rejectReason } }),
    }).catch(() => {});
    setRejectModal(null);
    setRejectReason("");
    showToast(`${shop.name} rejected`);
  };

  // ── Suspend / Reactivate ────────────────────────────────────────────────────
  const toggleSuspend = async (shop: ShopWithOwner) => {
    const newStatus = shop.status === "suspended" ? "approved" : "suspended";
    setSavingId(shop.id);
    await patchShop(shop.id, { status: newStatus });
    setSavingId(null);
    setShops((prev) => prev.map((s) => s.id === shop.id ? { ...s, status: newStatus } : s));
    showToast(`${shop.name} ${newStatus === "suspended" ? "suspended" : "reactivated"}`);
  };

  // ── Computed values ─────────────────────────────────────────────────────────
  const totalShops = shops.length;
  const activeShops = shops.filter((s) => s.status === "approved").length;
  const pendingShops = shops.filter((s) => s.status === "pending");
  const mrr = activeShops * 49; // Approximate avg plan price

  // New shops per month (last 6)
  const monthLabels: string[] = [];
  const monthCounts: Record<string, number> = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-CA", { month: "short" });
    monthLabels.push(label);
    monthCounts[key] = 0;
  }
  shops.forEach((s) => {
    const key = s.created_at.slice(0, 7);
    if (key in monthCounts) monthCounts[key]++;
  });
  const shopChartData = monthLabels.map((label, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { month: label, shops: monthCounts[key] ?? 0 };
  });

  // Plans
  const planCounts: Record<string, number> = { starter: 0, pro: 0, premium: 0, business: 0 };
  shops.filter((s) => s.status === "approved").forEach((s) => { planCounts[s.subscription_plan] = (planCounts[s.subscription_plan] ?? 0) + 1; });
  const planPrices: Record<string, number> = { starter: 29, pro: 49, premium: 99, business: 199 };

  // Filtered shops for All Shops tab
  const filteredShops = shops.filter((s) =>
    searchQuery === "" || s.name.toLowerCase().includes(searchQuery.toLowerCase()) || (s.users?.name ?? "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const TABS: { key: AdminTab; label: string }[] = [
    { key: "overview", label: "Platform Overview" },
    { key: "pending", label: `Pending (${pendingShops.length})` },
    { key: "all-shops", label: "All Shops" },
    { key: "subscriptions", label: "Subscriptions" },
  ];

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 animate-fade-in">
      {toast && <Toast msg={toast.msg} ok={toast.ok} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
        <p className="text-[#777] text-sm mt-0.5">ClipWise platform management — all data</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap mb-6 bg-surface-raised p-1 rounded-xl w-fit">
        {TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all", tab === key ? "bg-gold text-black" : "text-[#555] hover:text-white")}
          >{label}</button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ─────────────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard label="Total Shops" value={String(totalShops)} sub="All time" icon={Store} color="gold" />
            <KpiCard label="Active Shops" value={String(activeShops)} sub="Approved" icon={Check as React.ElementType} color="green" />
            <KpiCard label="Pending Approval" value={String(pendingShops.length)} sub="Awaiting review" icon={Clock} color="orange" />
            <KpiCard label="Total Appointments" value={String(totalAppts)} sub="All shops" icon={Calendar} color="blue" />
            <KpiCard label="Platform Revenue" value={formatCurrency(platformRevenue)} sub="All transactions" icon={DollarSign} color="gold" />
            <KpiCard label="Total Users" value={String(totalUsers)} sub="All roles" icon={Users} color="purple" />
          </div>

          {/* Quick Actions */}
          <Card>
            <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2 bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-gray-300 flex-1 min-w-0 max-w-sm">
                  <span className="truncate text-[#777]">Signup link:</span>
                  <span className="text-white truncate">{typeof window !== "undefined" ? window.location.origin : "http://localhost:3001"}/signup</span>
                  <button onClick={() => { navigator.clipboard.writeText((typeof window !== "undefined" ? window.location.origin : "") + "/signup"); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    className="ml-auto text-[#777] hover:text-gold flex-shrink-0">
                    {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
                  </button>
                </div>
                <a href="/signup" target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-2"><ExternalLink size={14} /> Open Signup</Button>
                </a>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => setTab("pending")}>
                  <Clock size={14} /> Review Pending ({pendingShops.length})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  loading={sendingReminders}
                  onClick={async () => {
                    setSendingReminders(true);
                    const res = await fetch("/api/reminders", { method: "POST" });
                    const json = await res.json();
                    setSendingReminders(false);
                    showToast(res.ok ? `Reminders sent: ${json.sent} emails` : "Failed to send reminders", res.ok);
                  }}
                >
                  <Bell size={14} /> Send Tomorrow&apos;s Reminders
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Empty state if no shops */}
          {totalShops === 0 && (
            <Card>
              <div className="py-16 text-center space-y-4">
                <div className="w-16 h-16 bg-gold/10 border border-gold/20 rounded-2xl flex items-center justify-center mx-auto">
                  <Store size={28} className="text-gold" />
                </div>
                <div>
                  <p className="font-semibold text-white text-lg">No shops registered yet</p>
                  <p className="text-sm text-[#777] mt-1 max-w-sm mx-auto">Share your signup link to get started. Once barbershops register, they&apos;ll appear here for approval.</p>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <Shield size={14} className="text-gold" />
                  <span className="text-xs text-[#999]">Platform is live and ready to accept registrations</span>
                </div>
              </div>
            </Card>
          )}

          {/* New shops chart */}
          <Card>
            <CardHeader>
              <CardTitle>New Shops (Last 6 Months)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={shopChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="shops" fill="#F5F0E6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Top shops by appts */}
          <Card>
            <CardHeader>
              <CardTitle>All Shops Overview</CardTitle>
              <Badge variant="outline">{totalShops} total</Badge>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      {["Shop", "Owner", "City", "Plan", "Status", "Joined"].map((h) => (
                        <th key={h} className="text-left text-xs font-medium text-[#555] px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shops.slice(0, 10).map((s) => (
                      <tr key={s.id} className="border-b border-border/50 hover:bg-surface-raised/30">
                        <td className="px-3 py-3 text-sm font-medium text-white">{s.name}</td>
                        <td className="px-3 py-3 text-sm text-gray-300">{s.users?.name ?? "—"}</td>
                        <td className="px-3 py-3 text-sm text-gray-300">{s.city}, {s.province}</td>
                        <td className="px-3 py-3 text-sm">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-surface-raised text-gray-300 capitalize">{s.subscription_plan}</span>
                        </td>
                        <td className="px-3 py-3"><StatusBadge status={s.status} /></td>
                        <td className="px-3 py-3 text-xs text-[#777]">{s.created_at.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shops.length > 10 && <p className="text-xs text-[#777] text-center mt-3">Showing 10 of {shops.length} shops. Switch to &quot;All Shops&quot; for the full list.</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── PENDING TAB ──────────────────────────────────────────────────────── */}
      {tab === "pending" && (
        <div className="space-y-4">
          {pendingShops.length === 0 ? (
            <Card>
              <div className="py-16 text-center">
                <p className="text-4xl mb-3">✓</p>
                <p className="font-medium text-white">All caught up!</p>
                <p className="text-sm text-[#777] mt-1">No shops pending approval</p>
              </div>
            </Card>
          ) : pendingShops.map((s) => (
            <Card key={s.id}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-white font-semibold text-lg">{s.name}</h3>
                    <StatusBadge status={s.status} />
                  </div>
                  <div className="flex flex-wrap gap-4 mt-2 text-sm text-[#555]">
                    <span>Owner: <span className="text-white">{s.users?.name ?? "Unknown"}</span></span>
                    <span>Email: <span className="text-white">{s.users?.email ?? s.email}</span></span>
                    <span>City: <span className="text-white">{s.city}, {s.province}</span></span>
                    <span>Applied: <span className="text-white">{formatDate(s.created_at.slice(0, 10))}</span></span>
                  </div>
                  {s.description && <p className="text-xs text-[#777] mt-2 line-clamp-2">{s.description}</p>}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <a href={`/book/${s.slug}`} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="sm">View Page</Button>
                  </a>
                  <Button variant="danger" size="sm" onClick={() => { setRejectModal(s); setRejectReason(""); }} loading={savingId === s.id}>
                    Reject
                  </Button>
                  <Button size="sm" loading={savingId === s.id} onClick={() => approveShop(s)}>
                    <Check size={14} /> Approve
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── ALL SHOPS TAB ─────────────────────────────────────────────────────── */}
      {tab === "all-shops" && (
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search shops or owners..."
              className="w-full bg-surface-raised border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-gold/50 max-w-md"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777] hover:text-white"><X size={14} /></button>
            )}
          </div>

          <Card>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      {["Shop", "Owner", "City", "Plan", "Status", "Joined", "Actions"].map((h) => (
                        <th key={h} className="text-left text-xs font-medium text-[#555] px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredShops.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-[#777] text-sm">No shops found</td></tr>
                    )}
                    {filteredShops.map((s) => (
                      <tr key={s.id} className="border-b border-border/50 hover:bg-surface-raised/30">
                        <td className="px-3 py-3 text-sm font-medium text-white">{s.name}</td>
                        <td className="px-3 py-3 text-sm text-gray-300">{s.users?.name ?? "—"}</td>
                        <td className="px-3 py-3 text-sm text-gray-300">{s.city}, {s.province}</td>
                        <td className="px-3 py-3">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-surface-raised text-gray-300 capitalize">{s.subscription_plan}</span>
                        </td>
                        <td className="px-3 py-3"><StatusBadge status={s.status} /></td>
                        <td className="px-3 py-3 text-xs text-[#777]">{s.created_at.slice(0, 10)}</td>
                        <td className="px-3 py-3">
                          <div className="flex gap-1">
                            {s.status === "pending" && (
                              <Button size="sm" loading={savingId === s.id} onClick={() => approveShop(s)}>Approve</Button>
                            )}
                            {s.status === "approved" && (
                              <Button size="sm" variant="danger" loading={savingId === s.id} onClick={() => toggleSuspend(s)}>Suspend</Button>
                            )}
                            {s.status === "suspended" && (
                              <Button size="sm" variant="outline" loading={savingId === s.id} onClick={() => toggleSuspend(s)}>Reactivate</Button>
                            )}
                            {s.status === "pending" && (
                              <Button size="sm" variant="ghost" onClick={() => { setRejectModal(s); setRejectReason(""); }}>Reject</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── SUBSCRIPTIONS TAB ─────────────────────────────────────────────────── */}
      {tab === "subscriptions" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(planCounts).map(([plan, count]) => (
              <Card key={plan} gold={plan === "premium" || plan === "business"}>
                <div className="text-center">
                  <p className="text-xs text-[#777] uppercase tracking-wider mb-2 capitalize">{plan}</p>
                  <p className="text-3xl font-bold text-white">{count}</p>
                  <p className="text-xs text-[#777] mt-1">shops</p>
                  <div className="border-t border-border mt-3 pt-3">
                    <p className="text-gold font-bold">{formatCurrency(planPrices[plan] * count)}</p>
                    <p className="text-xs text-[#777]">MRR ({formatCurrency(planPrices[plan])}/mo each)</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Plan Distribution</CardTitle>
              <p className="text-xs text-[#777]">Active shops only ({activeShops} total)</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(planCounts).map(([plan, count]) => {
                  const pct = activeShops > 0 ? (count / activeShops) * 100 : 0;
                  return (
                    <div key={plan}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-white capitalize font-medium">{plan}</span>
                        <span className="text-[#555]">{count} shops · {formatCurrency(planPrices[plan] * count)}/mo</span>
                      </div>
                      <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
                        <div className="h-full bg-gold rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-border mt-4 pt-4 flex justify-between items-center">
                <span className="text-sm text-[#555] font-medium">Total Estimated MRR</span>
                <span className="text-gold font-bold text-xl">{formatCurrency(mrr)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setRejectModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Reject Shop</h2>
                <button onClick={() => setRejectModal(null)} className="text-[#555] hover:text-white text-xl leading-none">✕</button>
              </div>
              <p className="text-sm text-[#555]">Rejecting <span className="text-white font-medium">{rejectModal.name}</span>. Please provide a reason:</p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={4}
                placeholder="e.g. Missing business information, incomplete profile..."
                className="w-full bg-surface-raised border border-border rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-gold/50 resize-none"
              />
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setRejectModal(null)}>Cancel</Button>
                <Button variant="danger" className="flex-1" loading={savingId === rejectModal.id} onClick={rejectShop}>
                  Confirm Rejection
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
