"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Search, X, Check, Store } from "lucide-react";
import type { Shop } from "@/lib/database.types";

interface ShopWithOwner extends Shop {
  users?: { name: string; email: string };
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-surface-raised rounded-xl", className)} />;
}

function StatusBadge({ status }: { status: string }) {
  const v = status === "approved" ? "success" : status === "pending" ? "warning" : status === "suspended" ? "info" : "danger";
  return <Badge variant={v} className="capitalize">{status}</Badge>;
}

function Toast({ msg, ok, onClose }: { msg: string; ok: boolean; onClose: () => void }) {
  return (
    <div className={cn(
      "fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-5 py-3 rounded-xl border shadow-xl text-sm font-medium",
      ok ? "bg-emerald-900/80 border-emerald-500/40 text-emerald-300" : "bg-red-900/80 border-red-500/40 text-red-300"
    )}>
      {ok ? <Check size={15} /> : <X size={15} />} {msg}
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

type StatusFilter = "all" | "pending" | "approved" | "suspended" | "rejected";

export default function AdminShopsPage() {
  const { user, loading: authLoading } = useAuth();
  const [shops, setShops] = useState<ShopWithOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<ShopWithOwner | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const loadShops = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/shops", {
      headers: { "Authorization": `Bearer ${session?.access_token ?? ""}` },
    });
    if (res.ok) {
      const json = await res.json();
      setShops((json.shops ?? []) as ShopWithOwner[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authLoading && user) loadShops();
  }, [authLoading, user, loadShops]);

  const updateStatus = async (shopId: string, status: string, rejection_reason?: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/shops", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ id: shopId, status, rejection_reason }),
    });
    return res.ok;
  };

  const approveShop = async (shop: ShopWithOwner) => {
    setSavingId(shop.id);
    const ok = await updateStatus(shop.id, "approved");
    setSavingId(null);
    if (!ok) { showToast("Failed to approve", false); return; }
    setShops(prev => prev.map(s => s.id === shop.id ? { ...s, status: "approved" } : s));
    showToast(`${shop.name} approved!`);
    fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "shop_approved", data: { shopName: shop.name, ownerName: shop.users?.name || "Shop Owner", ownerEmail: shop.users?.email || shop.email, slug: shop.slug } }),
    }).catch(() => {});
  };

  const rejectShop = async () => {
    if (!rejectModal) return;
    const modal = rejectModal;
    const reason = rejectReason;
    setSavingId(modal.id);
    const ok = await updateStatus(modal.id, "rejected", reason);
    setSavingId(null);
    if (!ok) { showToast("Failed to reject", false); return; }
    setShops(prev => prev.map(s => s.id === modal.id ? { ...s, status: "rejected", rejection_reason: reason } : s));
    setRejectModal(null);
    setRejectReason("");
    showToast(`${modal.name} rejected`);
    fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "shop_rejected", data: { shopName: modal.name, ownerName: modal.users?.name || "Shop Owner", ownerEmail: modal.users?.email || modal.email, reason } }),
    }).catch(() => {});
  };

  const toggleSuspend = async (shop: ShopWithOwner) => {
    const newStatus = shop.status === "suspended" ? "approved" : "suspended";
    setSavingId(shop.id);
    const ok = await updateStatus(shop.id, newStatus);
    setSavingId(null);
    if (!ok) { showToast("Failed to update", false); return; }
    setShops(prev => prev.map(s => s.id === shop.id ? { ...s, status: newStatus } : s));
    showToast(`${shop.name} ${newStatus === "suspended" ? "suspended" : "reactivated"}`);
  };

  const filtered = shops.filter(s => {
    const matchSearch = search === "" || s.name.toLowerCase().includes(search.toLowerCase()) || (s.users?.name ?? "").toLowerCase().includes(search.toLowerCase()) || (s.users?.email ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || s.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const STATUS_FILTERS: StatusFilter[] = ["all", "pending", "approved", "suspended", "rejected"];

  return (
    <div className="p-4 lg:p-8 space-y-6">
      {toast && <Toast msg={toast.msg} ok={toast.ok} onClose={() => setToast(null)} />}

      <div>
        <h1 className="text-2xl font-bold text-white">Shops</h1>
        <p className="text-sm text-gray-500 mt-0.5">All registered shops on the platform</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search shops or owners..."
            className="w-full bg-surface-raised border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50"
          />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"><X size={14} /></button>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all border",
                statusFilter === f ? "bg-gold text-black border-gold" : "border-border text-gray-400 hover:text-white hover:border-gray-500")}>
              {f === "all" ? `All (${shops.length})` : `${f} (${shops.filter(s => s.status === f).length})`}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="py-20 text-center space-y-3">
            <div className="w-16 h-16 bg-surface-raised rounded-2xl flex items-center justify-center mx-auto">
              <Store size={28} className="text-gray-600" />
            </div>
            <p className="font-semibold text-white">No shops {statusFilter !== "all" ? `with status "${statusFilter}"` : "registered yet"}</p>
            <p className="text-sm text-gray-500 max-w-xs mx-auto">
              {statusFilter !== "all" ? "Try a different filter." : "Share the signup link so barbershops can register."}
            </p>
            {statusFilter !== "all" && (
              <button onClick={() => setStatusFilter("all")} className="text-gold text-sm hover:underline">Clear filter</button>
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {["Shop Name", "Owner", "City", "Plan", "Status", "Joined", "Actions"].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-gray-400 px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(s => (
                    <tr key={s.id} className="border-b border-border/50 hover:bg-surface-raised/30 transition-colors">
                      <td className="px-3 py-3">
                        <p className="text-sm font-medium text-white">{s.name}</p>
                        <p className="text-xs text-gray-500">/book/{s.slug}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-sm text-gray-300">{s.users?.name ?? "—"}</p>
                        <p className="text-xs text-gray-500">{s.users?.email ?? s.email}</p>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-300 whitespace-nowrap">{s.city}{s.province ? `, ${s.province}` : ""}</td>
                      <td className="px-3 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-surface-raised text-gray-300 capitalize">{s.subscription_plan}</span>
                      </td>
                      <td className="px-3 py-3"><StatusBadge status={s.status} /></td>
                      <td className="px-3 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(s.created_at.slice(0, 10))}</td>
                      <td className="px-3 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {s.status === "pending" && <>
                            <Button size="sm" loading={savingId === s.id} onClick={() => approveShop(s)}>Approve</Button>
                            <Button size="sm" variant="danger" onClick={() => { setRejectModal(s); setRejectReason(""); }}>Reject</Button>
                          </>}
                          {s.status === "approved" && (
                            <Button size="sm" variant="danger" loading={savingId === s.id} onClick={() => toggleSuspend(s)}>Suspend</Button>
                          )}
                          {s.status === "suspended" && (
                            <Button size="sm" variant="outline" loading={savingId === s.id} onClick={() => toggleSuspend(s)}>Reactivate</Button>
                          )}
                          {s.status === "rejected" && (
                            <Button size="sm" variant="outline" loading={savingId === s.id} onClick={() => approveShop(s)}>Approve</Button>
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
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setRejectModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Reject Shop</h2>
                <button onClick={() => setRejectModal(null)} className="text-gray-400 hover:text-white text-xl">✕</button>
              </div>
              <p className="text-sm text-gray-400">Rejecting <span className="text-white font-medium">{rejectModal.name}</span>. Provide a reason:</p>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={4}
                placeholder="e.g. Incomplete business information..."
                className="w-full bg-surface-raised border border-border rounded-xl px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50 resize-none"
              />
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setRejectModal(null)}>Cancel</Button>
                <Button variant="danger" className="flex-1" loading={savingId === rejectModal.id} onClick={rejectShop}>Confirm Rejection</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
