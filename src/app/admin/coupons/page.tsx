"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Copy, Check, Ticket } from "lucide-react";

interface Coupon {
  id: string;
  code: string;
  plan: string;
  days: number;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  note: string | null;
  created_at: string;
}

export default function AdminCouponsPage() {
  const { accessToken } = useAuth();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState("");

  // New-coupon form
  const [plan, setPlan] = useState("pro");
  const [days, setDays] = useState("10");
  const [maxUses, setMaxUses] = useState("1");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    const res = await fetch("/api/admin/coupons", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) { const d = await res.json(); setCoupons(d.coupons ?? []); }
    setLoading(false);
  }, [accessToken]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!accessToken) return;
    setSaving(true);
    const res = await fetch("/api/admin/coupons", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        plan, days: Number(days), max_uses: Number(maxUses),
        expires_at: expires ? new Date(expires).toISOString() : undefined,
        note: note.trim() || undefined,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { showToast(d.error ?? "Couldn't create coupon."); return; }
    setNote(""); setExpires("");
    showToast(`Created ${d.coupon.code}`);
    load();
  };

  const toggle = async (c: Coupon) => {
    if (!accessToken) return;
    const res = await fetch("/api/admin/coupons", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, is_active: !c.is_active }),
    });
    if (res.ok) load(); else showToast("Couldn't update coupon.");
  };

  const copy = (code: string) => {
    navigator.clipboard?.writeText(code).then(() => { setCopied(code); setTimeout(() => setCopied(""), 1500); }).catch(() => {});
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl">{toast}</div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Ticket size={22} /> Comp Coupons</h1>
        <p className="text-sm text-grey mt-0.5">Generate codes that grant free Pro/Premium days (no card). Give a code to a shop owner to redeem in Billing, or apply days directly from a shop&apos;s page.</p>
      </div>

      {/* Create */}
      <Card>
        <CardHeader><CardTitle>New coupon</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Plan" value={plan} onChange={e => setPlan(e.target.value)}>
              <option value="pro">Pro</option>
              <option value="premium">Premium</option>
            </Select>
            <Input label="Free days" type="number" min={1} max={365} value={days} onChange={e => setDays(e.target.value)} />
            <Input label="Max uses (how many shops)" type="number" min={1} value={maxUses} onChange={e => setMaxUses(e.target.value)} />
            <Input label="Expires (optional)" type="date" value={expires} onChange={e => setExpires(e.target.value)} />
          </div>
          <Input label="Note (optional — who / why)" value={note} onChange={e => setNote(e.target.value.slice(0, 200))} placeholder="e.g. extra 10 days for Balli — not ready yet" />
          <Button loading={saving} onClick={create}>Generate coupon</Button>
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader><CardTitle>Coupons</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-grey py-6 text-center">Loading…</p>
          ) : coupons.length === 0 ? (
            <p className="text-sm text-grey py-6 text-center">No coupons yet — create one above.</p>
          ) : (
            <div className="space-y-2">
              {coupons.map(c => {
                const exhausted = c.used_count >= c.max_uses;
                const expired = !!c.expires_at && new Date(c.expires_at).getTime() < Date.now();
                const live = c.is_active && !exhausted && !expired;
                return (
                  <div key={c.id} className="flex items-center gap-3 p-3 bg-card-raised rounded-xl border border-border">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <button onClick={() => copy(c.code)} className="font-mono font-semibold text-foreground text-sm inline-flex items-center gap-1 hover:text-gold">
                          {c.code} {copied === c.code ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} className="opacity-50" />}
                        </button>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${live ? "bg-emerald-500/15 text-emerald-400" : "bg-gray-500/15 text-grey"}`}>
                          {live ? "Active" : expired ? "Expired" : exhausted ? "Used up" : "Off"}
                        </span>
                      </div>
                      <p className="text-xs text-grey mt-0.5">
                        {c.days} free days of <span className="capitalize text-foreground">{c.plan}</span> · used {c.used_count}/{c.max_uses}
                        {c.expires_at ? ` · expires ${new Date(c.expires_at).toLocaleDateString("en-CA")}` : ""}
                      </p>
                      {c.note && <p className="text-[11px] text-grey-muted mt-0.5 truncate">{c.note}</p>}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => toggle(c)}>{c.is_active ? "Disable" : "Enable"}</Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
