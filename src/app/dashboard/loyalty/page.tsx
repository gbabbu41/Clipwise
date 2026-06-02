"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Client, PromoCode } from "@/lib/database.types";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-gray-100 border border-gray-200 rounded-xl px-5 py-3 text-sm text-gray-900 shadow-xl flex items-center gap-3">
      <span className="text-black">✓</span>{message}
      <button onClick={onClose} className="text-gray-500 hover:text-gray-900 ml-2">✕</button>
    </div>
  );
}

const BLANK_PROMO = { code: "", discount_type: "percent", discount_value: "", uses_left: "", expires_at: "", is_active: true };

export default function LoyaltyPage() {
  const { shop } = useAuth();
  const [tab, setTab] = useState<"loyalty" | "promos">("loyalty");
  const [toast, setToast] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [editPromo, setEditPromo] = useState<PromoCode | null>(null);
  const [addPointsFor, setAddPointsFor] = useState<Client | null>(null);
  const [pointsToAdd, setPointsToAdd] = useState("10");
  const [saving, setSaving] = useState(false);
  const [reminders, setReminders] = useState({
    appointment_24h: true, rebooking_30d: true, birthday: false, winback_60d: false,
  });
  const [settings, setSettings] = useState({ points_per_visit: 10, points_per_dollar: 1, redemption: 5 });
  const [newPromo, setNewPromo] = useState(BLANK_PROMO);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadData = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const [clientRes, promoRes] = await Promise.all([
      supabase.from("clients").select("*").eq("shop_id", shop.id).order("loyalty_points", { ascending: false }),
      supabase.from("promo_codes").select("*").eq("shop_id", shop.id).order("created_at", { ascending: false }),
    ]);
    if (clientRes.data) setClients(clientRes.data);
    if (promoRes.data) setPromos(promoRes.data);
    setLoading(false);
  }, [shop]);

  useEffect(() => { loadData(); }, [loadData]);

  const addPoints = async () => {
    if (!addPointsFor || !shop) return;
    const pts = Number(pointsToAdd);
    const newTotal = addPointsFor.loyalty_points + pts;
    const { error } = await supabase.from("clients").update({ loyalty_points: newTotal }).eq("id", addPointsFor.id);
    if (!error) {
      setClients(prev => prev.map(c => c.id === addPointsFor.id ? { ...c, loyalty_points: newTotal } : c).sort((a, b) => b.loyalty_points - a.loyalty_points));
      showToast(`${pts} points added to ${addPointsFor.name}!`);
    }
    setAddPointsFor(null);
  };

  const savePromo = async () => {
    if (!shop || !newPromo.code.trim()) return;
    setSaving(true);
    const payload = {
      shop_id: shop.id,
      code: newPromo.code.toUpperCase().trim(),
      discount_type: newPromo.discount_type as "percent" | "fixed",
      discount_value: Number(newPromo.discount_value),
      uses_left: newPromo.uses_left ? Number(newPromo.uses_left) : undefined,
      total_uses: 0,
      expires_at: newPromo.expires_at || undefined,
      is_active: newPromo.is_active,
    };
    if (editPromo) {
      const { error } = await supabase.from("promo_codes").update(payload).eq("id", editPromo.id);
      if (!error) { showToast("Promo updated!"); loadData(); }
      else showToast("Error: " + error.message);
    } else {
      const { error } = await supabase.from("promo_codes").insert(payload);
      if (!error) { showToast("Promo code created!"); loadData(); }
      else showToast("Error: " + error.message);
    }
    setSaving(false);
    setShowPromoModal(false);
    setEditPromo(null);
    setNewPromo(BLANK_PROMO);
  };

  const deletePromo = async (id: string) => {
    const { error } = await supabase.from("promo_codes").delete().eq("id", id);
    if (!error) { setPromos(prev => prev.filter(p => p.id !== id)); showToast("Promo deleted"); }
    else showToast("Error: " + error.message);
  };

  const toggleReminder = (key: keyof typeof reminders) => {
    setReminders(prev => ({ ...prev, [key]: !prev[key] }));
    showToast(`Reminder ${reminders[key] ? "disabled" : "enabled"}`);
  };

  if (!shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-2xl mb-2">🎁</p>
        <h2 className="text-lg font-bold text-gray-900 mb-1">No shop linked</h2>
        <p className="text-sm text-gray-500">Loyalty program will be available once your shop is set up.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Loyalty & Marketing</h1>
          <p className="text-sm text-gray-500 mt-0.5">Retain clients and drive repeat visits</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["loyalty","promos"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t ? "border-black text-black" : "border-transparent text-gray-500 hover:text-gray-900")}>
            {t === "loyalty" ? "Loyalty Program" : "Promo Codes"}
          </button>
        ))}
      </div>

      {tab === "loyalty" ? (
        <div className="space-y-6">
          {/* Settings Card */}
          <Card>
            <CardHeader><CardTitle>Program Settings</CardTitle></CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4 mb-4">
                {[
                  { label: "Points per Visit", key: "points_per_visit" as const },
                  { label: "Points per Dollar", key: "points_per_dollar" as const },
                  { label: "100 pts = $X", key: "redemption" as const },
                ].map(s => (
                  <div key={s.key} className="p-4 bg-gray-100 rounded-xl border border-gray-200">
                    <p className="text-xs text-gray-500 mb-2">{s.label}</p>
                    <input type="number" value={settings[s.key]}
                      onChange={e => setSettings(p => ({ ...p, [s.key]: Number(e.target.value) }))}
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-black/20 text-center text-lg font-bold" />
                  </div>
                ))}
              </div>
              <Button onClick={() => showToast("Settings saved!")}>Save Settings</Button>
            </CardContent>
          </Card>

          {/* Leaderboard */}
          <Card>
            <CardHeader>
              <CardTitle>Points Leaderboard</CardTitle>
              <Badge variant="gold">{clients.length} clients</Badge>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />)}</div>
              ) : clients.length === 0 ? (
                <div className="text-center py-8"><p className="text-gray-500 text-sm">No clients yet</p></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left text-xs text-gray-500 px-3 py-2">Rank</th>
                        <th className="text-left text-xs text-gray-500 px-3 py-2">Client</th>
                        <th className="text-left text-xs text-gray-500 px-3 py-2">Points</th>
                        <th className="text-left text-xs text-gray-500 px-3 py-2">Visits</th>
                        <th className="text-left text-xs text-gray-500 px-3 py-2">Last Visit</th>
                        <th className="text-left text-xs text-gray-500 px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((client, idx) => (
                        <tr key={client.id} className="border-b border-gray-200/50 hover:bg-gray-100/30">
                          <td className="px-3 py-3">
                            <span className={cn("text-sm font-bold", idx === 0 ? "text-black" : idx === 1 ? "text-gray-600" : idx === 2 ? "text-orange-600" : "text-gray-500")}>
                              #{idx + 1}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-black/10 flex items-center justify-center text-xs text-black font-bold">
                                {client.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                              </div>
                              <span className="text-sm text-gray-900">{client.name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-black">{client.loyalty_points}</span>
                              <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                                <div className="h-full bg-gold rounded-full" style={{ width: `${Math.min(100, (client.loyalty_points / 500) * 100)}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-600">{client.total_visits}</td>
                          <td className="px-3 py-3 text-sm text-gray-500">{client.last_visit ?? "—"}</td>
                          <td className="px-3 py-3">
                            <Button variant="outline" size="sm" onClick={() => setAddPointsFor(client)}>+ Points</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Automated Reminders */}
          <Card>
            <CardHeader><CardTitle>Automated Reminders</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { key: "appointment_24h" as const, label: "24hr Appointment Reminder", desc: "SMS sent 24hrs before appointment", icon: "⏰" },
                  { key: "rebooking_30d" as const, label: "Re-booking Reminder", desc: "SMS if client hasn't visited in 30 days", icon: "📅" },
                  { key: "birthday" as const, label: "Birthday Message", desc: "Send a birthday discount message", icon: "🎂" },
                  { key: "winback_60d" as const, label: "Win-Back Campaign", desc: "Reach out to clients after 60 days of no activity", icon: "💌" },
                ].map(r => (
                  <div key={r.key} className="flex items-center justify-between p-4 bg-gray-100 rounded-xl border border-gray-200">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{r.icon}</span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{r.label}</p>
                        <p className="text-xs text-gray-500">{r.desc}</p>
                      </div>
                    </div>
                    <Switch checked={!!reminders[r.key]} onChange={() => toggleReminder(r.key)} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditPromo(null); setNewPromo(BLANK_PROMO); setShowPromoModal(true); }}>
              + Create Promo Code
            </Button>
          </div>

          {loading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-48 rounded-2xl bg-gray-100 animate-pulse" />)}
            </div>
          ) : promos.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">🎟️</p>
              <p className="text-gray-500 text-sm">No promo codes yet. Create your first promo above.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {promos.map(promo => {
                const totalAlloc = promo.total_uses + (promo.uses_left ?? 0);
                const usagePercent = totalAlloc > 0 ? (promo.total_uses / totalAlloc) * 100 : 0;
                return (
                  <Card key={promo.id} className={cn(!promo.is_active && "opacity-60")}>
                    <div className="flex items-start justify-between mb-3">
                      <code className="text-lg font-bold text-black tracking-widest">{promo.code}</code>
                      <Badge variant={promo.is_active ? "success" : "danger"}>{promo.is_active ? "Active" : "Inactive"}</Badge>
                    </div>
                    <div className="space-y-2 mb-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Discount</span>
                        <span className="text-gray-900 font-semibold">
                          {promo.discount_type === "percent" ? `${promo.discount_value}% off` : `$${promo.discount_value} off`}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Uses Left</span>
                        <span className="text-gray-900">{promo.uses_left ?? "∞"} / {totalAlloc > 0 ? totalAlloc : "∞"}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Expires</span>
                        <span className="text-gray-900">{promo.expires_at ?? "Never"}</span>
                      </div>
                    </div>
                    {totalAlloc > 0 && (
                      <div className="mb-4">
                        <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full bg-gold rounded-full transition-all" style={{ width: `${usagePercent}%` }} />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{Math.round(usagePercent)}% used ({promo.total_uses} redemptions)</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => {
                        setEditPromo(promo);
                        setNewPromo({ code: promo.code, discount_type: promo.discount_type, discount_value: String(promo.discount_value), uses_left: String(promo.uses_left ?? ""), expires_at: promo.expires_at ?? "", is_active: promo.is_active });
                        setShowPromoModal(true);
                      }}>Edit</Button>
                      <Button variant="danger" size="sm" className="flex-1" onClick={() => deletePromo(promo.id)}>Delete</Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add Points Modal */}
      {addPointsFor && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setAddPointsFor(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-gray-50 shadow-sm border border-gray-200 rounded-2xl p-6 w-full max-w-xs space-y-4">
              <h3 className="text-gray-900 font-bold">Add Loyalty Points</h3>
              <p className="text-sm text-gray-500">For: {addPointsFor.name}</p>
              <Input label="Points to add" type="number" value={pointsToAdd} onChange={e => setPointsToAdd(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setAddPointsFor(null)}>Cancel</Button>
                <Button size="sm" className="flex-1" onClick={addPoints}>Add Points</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Promo Modal */}
      {showPromoModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowPromoModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-gray-50 shadow-sm border border-gray-200 rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900">{editPromo ? "Edit Promo Code" : "Create Promo Code"}</h2>
                <button onClick={() => setShowPromoModal(false)} className="text-gray-500 hover:text-gray-900">✕</button>
              </div>
              <Input label="Code" value={newPromo.code} onChange={e => setNewPromo(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="SUMMER20" />
              <Select label="Discount Type" value={newPromo.discount_type} onChange={e => setNewPromo(p => ({ ...p, discount_type: e.target.value }))}>
                <option value="percent">Percentage (%)</option>
                <option value="fixed">Fixed ($)</option>
              </Select>
              <Input label={newPromo.discount_type === "percent" ? "Discount %" : "Discount $"} type="number" value={newPromo.discount_value} onChange={e => setNewPromo(p => ({ ...p, discount_value: e.target.value }))} />
              <Input label="Uses Allowed (blank = unlimited)" type="number" value={newPromo.uses_left} onChange={e => setNewPromo(p => ({ ...p, uses_left: e.target.value }))} placeholder="50" />
              <Input label="Expiry Date (optional)" type="date" value={newPromo.expires_at} onChange={e => setNewPromo(p => ({ ...p, expires_at: e.target.value }))} />
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowPromoModal(false)}>Cancel</Button>
                <Button className="flex-1" loading={saving} onClick={savePromo}>{editPromo ? "Update" : "Create"}</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
