"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Shield, Check, X, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { ALL_PLAN_FEATURES, type PlanFeature } from "@/lib/validation";
import type { PlanRow } from "@/lib/plans";

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

const FEATURE_LABELS: Record<PlanFeature, string> = {
  payments: "Customer payments",
  loyalty: "Loyalty program",
  pos: "POS / card terminal",
  inventory: "Inventory",
  staff_portal: "Staff portal",
  commission: "Commission & payroll",
};

type EditablePlan = PlanRow & { __isNew?: boolean };

const blankPlan = (sort: number): EditablePlan => ({
  id: "", name: "", price_cents: 0, barber_limit: null, features: [], highlights: [],
  badge: null, description: null, is_active: true, sort_order: sort, __isNew: true,
});

export default function AdminSettingsPage() {
  const { accessToken } = useAuth();
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [settings, setSettings] = useState({
    platform_name: "ClipWise",
    support_email: "support@clipwise.com",
    admin_email: "gbabbu41@gmail.com",
    booking_base_url: typeof window !== "undefined" ? `${window.location.origin}/book` : "/book",
  });

  const [plans, setPlans] = useState<EditablePlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const loadPlans = useCallback(async () => {
    if (!accessToken) return;
    setLoadingPlans(true);
    const res = await fetch("/api/admin/plans", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) { const { plans: rows } = await res.json(); setPlans((rows ?? []) as EditablePlan[]); }
    setLoadingPlans(false);
  }, [accessToken]);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  // Mutate a single plan row in local state.
  const patch = (idx: number, p: Partial<EditablePlan>) =>
    setPlans(prev => prev.map((row, i) => i === idx ? { ...row, ...p } : row));

  const toggleFeature = (idx: number, f: PlanFeature) =>
    setPlans(prev => prev.map((row, i) => {
      if (i !== idx) return row;
      const has = row.features.includes(f);
      return { ...row, features: has ? row.features.filter(x => x !== f) : [...row.features, f] };
    }));

  const savePlan = async (idx: number) => {
    const plan = plans[idx];
    if (!plan.id.trim()) { showToast("Plan id is required (e.g. 'premium').", false); return; }
    if (!plan.name.trim()) { showToast("Plan name is required.", false); return; }
    setSavingId(plan.id || `__new_${idx}`);
    const res = await fetch("/api/admin/plans", {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...plan, __isNew: undefined }),
    });
    setSavingId(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error ?? "Failed to save plan", false); return; }
    showToast(`${plan.name} saved`);
    loadPlans();
  };

  const deletePlan = async (idx: number) => {
    const plan = plans[idx];
    if (plan.__isNew) { setPlans(prev => prev.filter((_, i) => i !== idx)); return; }
    if (!confirm(`Delete the "${plan.name}" plan? This can't be undone.`)) return;
    setSavingId(plan.id);
    const res = await fetch(`/api/admin/plans?id=${encodeURIComponent(plan.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken ?? ""}` },
    });
    setSavingId(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error ?? "Failed to delete plan", false); return; }
    showToast(`${plan.name} deleted`);
    loadPlans();
  };

  return (
    <div className="p-4 lg:p-8 space-y-6">
      {toast && <Toast msg={toast.msg} ok={toast.ok} onClose={() => setToast(null)} />}

      <div>
        <h1 className="text-2xl font-bold text-white">Platform Settings</h1>
        <p className="text-sm text-[#777] mt-0.5">Global configuration for ClipWise</p>
      </div>

      {/* Admin account */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gold/15 rounded-xl flex items-center justify-center">
              <Shield size={18} className="text-gold" />
            </div>
            <div>
              <CardTitle>Admin Account</CardTitle>
              <p className="text-xs text-[#777] mt-0.5">Super administrator credentials</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-[#777] font-medium uppercase tracking-wide">Admin Email</label>
            <div className="flex items-center gap-3 mt-1.5">
              <p className="text-sm text-white font-medium">{settings.admin_email}</p>
              <Badge variant="gold">Super Admin</Badge>
            </div>
            <p className="text-xs text-[#777] mt-1">Admin access is granted to users with the <code className="text-gold">super_admin</code> role in the users table.</p>
          </div>
        </CardContent>
      </Card>

      {/* Platform info */}
      <Card>
        <CardHeader><CardTitle>Platform Info</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Input label="Platform Name" value={settings.platform_name} onChange={e => setSettings(p => ({ ...p, platform_name: e.target.value }))} />
          <Input label="Support Email" type="email" value={settings.support_email} onChange={e => setSettings(p => ({ ...p, support_email: e.target.value }))} />
          <Input label="Booking Base URL" value={settings.booking_base_url} onChange={e => setSettings(p => ({ ...p, booking_base_url: e.target.value }))} />
          <Button onClick={() => showToast("Settings saved!")}>Save Settings</Button>
        </CardContent>
      </Card>

      {/* Subscription plans — live editor */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-white">Subscription Plans</h2>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setPlans(prev => [...prev, blankPlan(prev.length)])}>
            <Plus size={14} /> Add Plan
          </Button>
        </div>
        <p className="text-xs text-[#777] mb-4">
          Edits here are the single source of truth — prices flow into Stripe Checkout and the feature
          toggles control what each plan can actually do. Changes take effect within a minute.
        </p>

        {loadingPlans ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {[0, 1].map(i => <div key={i} className="h-72 bg-surface-raised rounded-2xl animate-pulse" />)}
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4">
            {plans.map((plan, idx) => (
              <div key={plan.__isNew ? `new-${idx}` : plan.id}
                className={cn("bg-surface border rounded-2xl p-5 space-y-4", plan.is_active ? "border-border" : "border-border/40 opacity-70")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-2">
                    <Input label="Display name" value={plan.name} onChange={e => patch(idx, { name: e.target.value })} placeholder="Premium" />
                    <div>
                      <label className="text-xs text-[#777] font-medium uppercase tracking-wide">Plan id (slug)</label>
                      <input
                        value={plan.id}
                        disabled={!plan.__isNew}
                        onChange={e => patch(idx, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                        placeholder="premium"
                        className="mt-1.5 w-full bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-gold/50 disabled:opacity-60"
                      />
                      {!plan.__isNew && <p className="text-[10px] text-[#777] mt-1">Slug is fixed once created (shops reference it).</p>}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[#777] shrink-0 cursor-pointer">
                    <input type="checkbox" checked={plan.is_active} onChange={e => patch(idx, { is_active: e.target.checked })} className="accent-gold w-4 h-4" />
                    Active
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[#777] font-medium uppercase tracking-wide">Price ($/mo, CAD)</label>
                    <input type="number" min={0} step="0.01" value={plan.price_cents / 100}
                      onChange={e => patch(idx, { price_cents: Math.max(0, Math.round(Number(e.target.value) * 100)) })}
                      className="mt-1.5 w-full bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50" />
                    <p className="text-[10px] text-[#777] mt-1">0 = free (no checkout)</p>
                  </div>
                  <div>
                    <label className="text-xs text-[#777] font-medium uppercase tracking-wide">Barber limit</label>
                    <input type="number" min={1} value={plan.barber_limit ?? ""} placeholder="Unlimited"
                      onChange={e => patch(idx, { barber_limit: e.target.value === "" ? null : Math.max(1, Math.round(Number(e.target.value))) })}
                      className="mt-1.5 w-full bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-gold/50" />
                    <p className="text-[10px] text-[#777] mt-1">Empty = unlimited</p>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-[#777] font-medium uppercase tracking-wide">Features unlocked</label>
                  <div className="grid grid-cols-2 gap-1.5 mt-2">
                    {ALL_PLAN_FEATURES.map(f => (
                      <label key={f} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                        <input type="checkbox" checked={plan.features.includes(f)} onChange={() => toggleFeature(idx, f)} className="accent-gold w-4 h-4" />
                        {FEATURE_LABELS[f]}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input label="Badge (optional)" value={plan.badge ?? ""} onChange={e => patch(idx, { badge: e.target.value || null })} placeholder="Most Popular" />
                  <div>
                    <label className="text-xs text-[#777] font-medium uppercase tracking-wide">Sort order</label>
                    <input type="number" value={plan.sort_order}
                      onChange={e => patch(idx, { sort_order: Math.round(Number(e.target.value)) || 0 })}
                      className="mt-1.5 w-full bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50" />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-[#777] font-medium uppercase tracking-wide">Marketing bullets (one per line)</label>
                  <textarea rows={4} value={(plan.highlights ?? []).join("\n")}
                    onChange={e => patch(idx, { highlights: e.target.value.split("\n") })}
                    placeholder={"Up to 4 barbers\nOnline booking + payments\nLoyalty program"}
                    className="mt-1.5 w-full bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-gold/50 resize-none" />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" loading={savingId === (plan.id || `__new_${idx}`)} onClick={() => savePlan(idx)}>Save</Button>
                  <Button size="sm" variant="ghost" className="text-red-400 hover:bg-red-500/10 gap-1.5" onClick={() => deletePlan(idx)}>
                    <Trash2 size={14} /> {plan.__isNew ? "Discard" : "Delete"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Platform health */}
      <Card>
        <CardHeader><CardTitle>Platform Health</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { label: "Supabase Database", status: "Operational" },
              { label: "Authentication", status: "Operational" },
              { label: "Booking System", status: "Operational" },
              { label: "Admin Portal", status: "Operational" },
            ].map(({ label, status }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <span className="text-sm text-gray-300">{label}</span>
                <span className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {status}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
