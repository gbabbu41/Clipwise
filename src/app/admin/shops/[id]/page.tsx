"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  ArrowLeft, Check, X, Store, DollarSign, Calendar, Users, CreditCard,
  ExternalLink, Save, Mail, Phone, MapPin, ShieldCheck, ShieldAlert,
} from "lucide-react";
import type { Shop } from "@/lib/database.types";

interface ShopDetail extends Shop {
  users?: { id: string; name: string; email: string; phone: string } | null;
}
interface BarberRow { id: string; name: string; is_active: boolean; rating: number; total_reviews: number }
interface TxRow { id: string; amount: number; tip: number; payment_method: string; type: string; client_name: string | null; service_name: string | null; created_at: string }
interface PlanOpt { id: string; name: string; price_cents: number; is_active: boolean }

function Toast({ msg, ok, onClose }: { msg: string; ok: boolean; onClose: () => void }) {
  return (
    <div className={cn("fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-5 py-3 rounded-xl border shadow-xl text-sm font-medium",
      ok ? "bg-emerald-900/80 border-emerald-500/40 text-emerald-300" : "bg-red-900/80 border-red-500/40 text-red-300")}>
      {ok ? <Check size={15} /> : <X size={15} />} {msg}
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}
function StatusBadge({ status }: { status: string }) {
  const v = status === "approved" ? "success" : status === "pending" ? "warning" : status === "suspended" ? "info" : "danger";
  return <Badge variant={v} className="capitalize">{status}</Badge>;
}
function Field({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-xl bg-surface-raised flex items-center justify-center flex-shrink-0"><Icon size={14} className="text-[#999]" /></div>
      <div className="min-w-0">
        <p className="text-xs text-[#8f8f8f]">{label}</p>
        <div className="text-sm text-white break-words">{children}</div>
      </div>
    </div>
  );
}

export default function AdminShopDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const { accessToken } = useAuth();

  const [shop, setShop] = useState<ShopDetail | null>(null);
  const [barbers, setBarbers] = useState<BarberRow[]>([]);
  const [stats, setStats] = useState({ gmv: 0, txCount: 0, apptCount: 0 });
  const [recentTx, setRecentTx] = useState<TxRow[]>([]);
  const [plans, setPlans] = useState<PlanOpt[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [planChoice, setPlanChoice] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [freePlan, setFreePlan] = useState("pro");
  const [givingDays, setGivingDays] = useState(0); // the days-value currently applying (0 = idle)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const auth = () => ({ Authorization: `Bearer ${accessToken ?? ""}`, "Content-Type": "application/json" });

  const load = useCallback(async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    const res = await fetch(`/api/admin/shops/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) { setNotFound(true); setLoading(false); return; }
    const data = await res.json();
    setShop(data.shop); setBarbers(data.barbers ?? []); setStats(data.stats ?? { gmv: 0, txCount: 0, apptCount: 0 });
    setRecentTx(data.recentTransactions ?? []); setPlans(data.plans ?? []); setNote(data.adminNote ?? "");
    setPlanChoice(data.shop?.subscription_plan ?? "");
    setLoading(false);
  }, [accessToken, id]);

  useEffect(() => { load(); }, [load]);

  const patch = async (body: Record<string, unknown>) =>
    fetch(`/api/admin/shops/${id}`, { method: "PATCH", headers: auth(), body: JSON.stringify(body) });

  const setStatus = async (status: string, rejection_reason?: string) => {
    setSavingStatus(true);
    const res = await patch({ status, ...(rejection_reason ? { rejection_reason } : {}) });
    setSavingStatus(false);
    if (!res.ok) { showToast("Failed to update status", false); return; }
    setShop(prev => prev ? { ...prev, status: status as Shop["status"], ...(rejection_reason ? { rejection_reason } : {}) } : prev);
    setRejectOpen(false); setRejectReason("");
    showToast(`Shop ${status}`);
    // Approve/reject fire the same owner emails the list actions do.
    if (shop && (status === "approved" || status === "rejected")) {
      fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: status === "approved" ? "shop_approved" : "shop_rejected",
          data: { shopName: shop.name, ownerName: shop.users?.name ?? "", ownerEmail: shop.users?.email ?? shop.email, slug: shop.slug, reason: rejection_reason ?? "" } }),
      }).catch(() => {});
    }
  };

  const savePlan = async () => {
    if (!shop || planChoice === shop.subscription_plan) return;
    setSavingPlan(true);
    const res = await patch({ subscription_plan: planChoice });
    setSavingPlan(false);
    if (!res.ok) { showToast("Failed to change plan", false); return; }
    setShop(prev => prev ? { ...prev, subscription_plan: planChoice as Shop["subscription_plan"] } : prev);
    showToast(`Plan changed to ${plans.find(p => p.id === planChoice)?.name ?? planChoice}`);
  };

  // Comp free days — extends the shop's no-card trial (bypasses payment).
  const giveFreeDays = async (days: number) => {
    if (!shop) return;
    setGivingDays(days);
    const res = await fetch("/api/admin/coupons/apply", {
      method: "POST", headers: auth(),
      body: JSON.stringify({ shop_id: shop.id, plan: freePlan, days }),
    });
    const d = await res.json().catch(() => ({}));
    setGivingDays(0);
    if (!res.ok) { showToast(d.error ?? "Couldn't apply free days", false); return; }
    showToast(`Gave ${days} free days of ${freePlan}`);
    load();
  };

  const saveNote = async () => {
    setSavingNote(true);
    const res = await patch({ admin_note: note });
    setSavingNote(false);
    showToast(res.ok ? "Note saved" : "Couldn't save note — run the phase27 migration", res.ok);
  };

  if (loading) return <div className="p-8"><div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" /></div>;
  if (notFound || !shop) return (
    <div className="p-8">
      <button onClick={() => router.push("/admin/shops")} className="text-sm text-[#8f8f8f] hover:text-white flex items-center gap-1 mb-6"><ArrowLeft size={15} /> Back to shops</button>
      <Card><div className="py-16 text-center"><Store size={32} className="text-[#999] mx-auto mb-3" /><p className="text-white font-semibold">Shop not found</p></div></Card>
    </div>
  );

  const connectDone = shop.stripe_connected === true || shop.stripe_connect_status === "active";
  const bs = shop.booking_settings ?? {};

  return (
    <div className="p-4 lg:p-8 space-y-6 animate-fade-in">
      {toast && <Toast msg={toast.msg} ok={toast.ok} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button onClick={() => router.push("/admin/shops")} className="text-sm text-[#8f8f8f] hover:text-white flex items-center gap-1 mb-2"><ArrowLeft size={15} /> Back to shops</button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{shop.name}</h1>
            <StatusBadge status={shop.status} />
          </div>
          <p className="text-sm text-[#8f8f8f] mt-0.5">/book/{shop.slug} · joined {formatDate(shop.created_at.slice(0, 10))}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a href={`/book/${shop.slug}`} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm" className="gap-1.5"><ExternalLink size={14} /> View page</Button>
          </a>
          {shop.status === "pending" && <>
            <Button size="sm" loading={savingStatus} onClick={() => setStatus("approved")}><Check size={14} /> Approve</Button>
            <Button size="sm" variant="danger" onClick={() => setRejectOpen(true)}>Reject</Button>
          </>}
          {shop.status === "approved" && <Button size="sm" variant="danger" loading={savingStatus} onClick={() => setStatus("suspended")}>Suspend</Button>}
          {shop.status === "suspended" && <Button size="sm" loading={savingStatus} onClick={() => setStatus("approved")}>Reactivate</Button>}
          {shop.status === "rejected" && <Button size="sm" loading={savingStatus} onClick={() => setStatus("approved")}>Approve</Button>}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "GMV processed", value: formatCurrency(stats.gmv), icon: DollarSign },
          { label: "Appointments", value: String(stats.apptCount), icon: Calendar },
          { label: "Barbers", value: String(barbers.length), icon: Users },
        ].map(k => (
          <Card key={k.label}>
            <div className="flex items-center justify-between">
              <div><p className="text-xs text-[#8f8f8f] uppercase tracking-wider">{k.label}</p><p className="text-xl font-bold text-white mt-1">{k.value}</p></div>
              <div className="p-2 rounded-xl bg-gold/15 text-gold"><k.icon size={18} /></div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Owner & contact */}
        <Card>
          <CardHeader><CardTitle>Owner &amp; Contact</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field icon={Users} label="Owner">{shop.users?.name ?? "—"}</Field>
            <Field icon={Mail} label="Email">{shop.users?.email ?? shop.email ?? "—"}</Field>
            <Field icon={Phone} label="Phone">{shop.users?.phone ?? shop.phone ?? "—"}</Field>
            <Field icon={MapPin} label="Address">
              {[shop.address, shop.city, shop.province, shop.postal_code].filter(Boolean).join(", ") || "—"}
            </Field>
          </CardContent>
        </Card>

        {/* Subscription & health */}
        <Card>
          <CardHeader><CardTitle>Subscription &amp; Health</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-[#8f8f8f] mb-1.5">Plan (manual override)</p>
              <div className="flex gap-2">
                <select value={planChoice} onChange={e => setPlanChoice(e.target.value)}
                  className="flex-1 bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50 capitalize">
                  {plans.length === 0 && <option value={shop.subscription_plan}>{shop.subscription_plan}</option>}
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name} — {formatCurrency(p.price_cents / 100)}/mo{p.is_active ? "" : " (inactive)"}</option>)}
                </select>
                <Button size="sm" loading={savingPlan} disabled={planChoice === shop.subscription_plan} onClick={savePlan}><Save size={14} /> Save</Button>
              </div>
              <p className="text-[10px] text-[#8f8f8f] mt-1">Overrides billing — use to comp or upgrade a shop manually.</p>
            </div>

            {/* Comp free days — extends the shop's no-card trial (bypasses payment).
                Blocked for shops on a real card subscription (server enforces it). */}
            <div className="border-t border-border pt-4">
              <p className="text-xs text-[#8f8f8f] mb-1.5">Give free days (no card)</p>
              <div className="flex items-center gap-2">
                <select value={freePlan} onChange={e => setFreePlan(e.target.value)}
                  className="bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50 capitalize">
                  <option value="pro">Pro</option>
                  <option value="premium">Premium</option>
                </select>
                {[10, 20, 30].map(dd => (
                  <Button key={dd} size="sm" variant="outline" loading={givingDays === dd} disabled={givingDays > 0} onClick={() => giveFreeDays(dd)}>
                    +{dd} days
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-[#8f8f8f] mt-1">Adds onto any days they already have. Trial-based, so it reverts to Starter when it runs out unless they add a card.</p>
            </div>

            <Field icon={CreditCard} label="Subscription status">
              <span className="capitalize">{shop.subscription_status ?? "inactive"}</span>
            </Field>
            <Field icon={connectDone ? ShieldCheck : ShieldAlert} label="Stripe Connect">
              {connectDone
                ? <span className="text-emerald-400">Connected — can take online payments</span>
                : <span className="text-orange-400">Not finished — online pay is blocked</span>}
            </Field>
            <Field icon={Calendar} label="Booking config">
              Pay in person: {shop.allow_pay_in_person === false ? "off" : "on"}
              {bs.no_show_protection ? ` · No-show fee: ${bs.no_show_fee_percent ?? 50}%` : " · No-show protection off"}
            </Field>
          </CardContent>
        </Card>
      </div>

      {/* Barbers */}
      <Card>
        <CardHeader><CardTitle>Barbers ({barbers.length})</CardTitle></CardHeader>
        <CardContent>
          {barbers.length === 0 ? <p className="text-sm text-[#8f8f8f] py-2">No barbers yet.</p> : (
            <div className="divide-y divide-border/50">
              {barbers.map(b => (
                <div key={b.id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm text-white">{b.name}</span>
                  <span className="flex items-center gap-3 text-xs text-[#8f8f8f]">
                    <span>★ {Number(b.rating ?? 0).toFixed(1)} ({b.total_reviews ?? 0})</span>
                    <Badge variant={b.is_active ? "success" : "danger"} className="text-[10px]">{b.is_active ? "Active" : "Inactive"}</Badge>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent transactions */}
      <Card>
        <CardHeader><CardTitle>Recent Transactions</CardTitle><Badge variant="outline">{stats.txCount} total</Badge></CardHeader>
        <CardContent>
          {recentTx.length === 0 ? <p className="text-sm text-[#8f8f8f] py-2">No transactions yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-border">{["Date", "Client", "Service", "Method", "Amount"].map(h => <th key={h} className="text-left text-xs font-medium text-[#8f8f8f] px-3 py-2">{h}</th>)}</tr></thead>
                <tbody>
                  {recentTx.map(t => (
                    <tr key={t.id} className="border-b border-border/50">
                      <td className="px-3 py-2 text-xs text-[#8f8f8f] whitespace-nowrap">{t.created_at?.slice(0, 10)}</td>
                      <td className="px-3 py-2 text-sm text-gray-300">{t.client_name ?? "—"}</td>
                      <td className="px-3 py-2 text-sm text-gray-300">{t.service_name ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-[#8f8f8f] capitalize">{t.payment_method}</td>
                      <td className="px-3 py-2 text-sm text-gold font-medium whitespace-nowrap">{formatCurrency((Number(t.amount) || 0) + (Number(t.tip) || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Private admin note */}
      <Card>
        <CardHeader><CardTitle>Private Admin Note</CardTitle><span className="text-xs text-[#8f8f8f]">Only you can see this</span></CardHeader>
        <CardContent className="space-y-3">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
            placeholder="Internal notes about this shop (never shown to the owner)…"
            className="w-full bg-surface-raised border border-border rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-gold/50 resize-none" />
          <Button size="sm" loading={savingNote} onClick={saveNote}><Save size={14} /> Save note</Button>
        </CardContent>
      </Card>

      <div className="text-center">
        <Link href={`/admin/activity?target=${shop.id}`} className="text-sm text-gold hover:underline">View this shop&apos;s admin history →</Link>
      </div>

      {/* Reject modal */}
      {rejectOpen && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setRejectOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <h2 className="text-lg font-bold text-white">Reject {shop.name}</h2>
              <p className="text-sm text-[#8f8f8f]">Provide a reason (emailed to the owner):</p>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={4}
                placeholder="e.g. Incomplete business information…"
                className="w-full bg-surface-raised border border-border rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-gold/50 resize-none" />
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setRejectOpen(false)}>Cancel</Button>
                <Button variant="danger" className="flex-1" loading={savingStatus} onClick={() => setStatus("rejected", rejectReason)}>Confirm Rejection</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
