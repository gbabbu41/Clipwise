"use client";
import { useState } from "react";
import { mockClients, mockPromoCodes } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";

type PromoCode = typeof mockPromoCodes[0];

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

const sortedClients = [...mockClients].sort((a, b) => b.loyalty_points - a.loyalty_points);

export default function LoyaltyPage() {
  const [tab, setTab] = useState<"loyalty" | "promos">("loyalty");
  const [toast, setToast] = useState("");
  const [promos, setPromos] = useState(mockPromoCodes);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [editPromo, setEditPromo] = useState<PromoCode | null>(null);
  const [addPointsFor, setAddPointsFor] = useState<string | null>(null);
  const [pointsToAdd, setPointsToAdd] = useState("10");
  const [reminders, setReminders] = useState({
    appointment_24h: true,
    rebooking_30d: true,
    birthday: false,
    winback_60d: false,
  });
  const [settings, setSettings] = useState({ points_per_visit: 10, points_per_dollar: 1, redemption: 5 });
  const [newPromo, setNewPromo] = useState({ code: "", discount_type: "percent", discount_value: "", uses_left: "", expires_at: "", is_active: true });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const savePromo = () => {
    if (editPromo) {
      setPromos(prev => prev.map(p => p.id === editPromo.id ? { ...p, ...newPromo, discount_value: Number(newPromo.discount_value), uses_left: Number(newPromo.uses_left) } : p));
      showToast("Promo updated!");
    } else {
      const id = `promo-${Date.now()}`;
      setPromos(prev => [...prev, { id, code: newPromo.code.toUpperCase(), discount_type: newPromo.discount_type, discount_value: Number(newPromo.discount_value), uses_left: Number(newPromo.uses_left), total_uses: 0, expires_at: newPromo.expires_at, is_active: newPromo.is_active }]);
      showToast("Promo code created!");
    }
    setShowPromoModal(false);
    setEditPromo(null);
    setNewPromo({ code: "", discount_type: "percent", discount_value: "", uses_left: "", expires_at: "", is_active: true });
  };

  const toggleReminder = (key: keyof typeof reminders) => {
    setReminders(prev => ({ ...prev, [key]: !prev[key] }));
    showToast(`Reminder ${reminders[key] ? "disabled" : "enabled"} (Demo mode)`);
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Loyalty & Marketing</h1>
          <p className="text-sm text-gray-400 mt-0.5">Retain clients and drive repeat visits</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["loyalty","promos"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t ? "border-gold text-gold" : "border-transparent text-gray-400 hover:text-white")}>
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
                <div className="p-4 bg-surface-raised rounded-xl border border-border">
                  <p className="text-xs text-gray-400 mb-2">Points per Visit</p>
                  <input type="number" value={settings.points_per_visit}
                    onChange={e => setSettings(p => ({ ...p, points_per_visit: Number(e.target.value) }))}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50 text-center text-lg font-bold" />
                </div>
                <div className="p-4 bg-surface-raised rounded-xl border border-border">
                  <p className="text-xs text-gray-400 mb-2">Points per Dollar</p>
                  <input type="number" value={settings.points_per_dollar}
                    onChange={e => setSettings(p => ({ ...p, points_per_dollar: Number(e.target.value) }))}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50 text-center text-lg font-bold" />
                </div>
                <div className="p-4 bg-surface-raised rounded-xl border border-border">
                  <p className="text-xs text-gray-400 mb-2">100 pts = $X</p>
                  <input type="number" value={settings.redemption}
                    onChange={e => setSettings(p => ({ ...p, redemption: Number(e.target.value) }))}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50 text-center text-lg font-bold" />
                </div>
              </div>
              <Button onClick={() => showToast("Settings saved!")}>Save Settings</Button>
            </CardContent>
          </Card>

          {/* Leaderboard */}
          <Card>
            <CardHeader>
              <CardTitle>Points Leaderboard</CardTitle>
              <Badge variant="gold">{sortedClients.length} clients</Badge>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-xs text-gray-400 px-3 py-2">Rank</th>
                      <th className="text-left text-xs text-gray-400 px-3 py-2">Client</th>
                      <th className="text-left text-xs text-gray-400 px-3 py-2">Points</th>
                      <th className="text-left text-xs text-gray-400 px-3 py-2">Visits</th>
                      <th className="text-left text-xs text-gray-400 px-3 py-2">Last Visit</th>
                      <th className="text-left text-xs text-gray-400 px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedClients.map((client, idx) => (
                      <tr key={client.id} className="border-b border-border/50 hover:bg-surface-raised/30">
                        <td className="px-3 py-3">
                          <span className={cn("text-sm font-bold", idx === 0 ? "text-gold" : idx === 1 ? "text-gray-300" : idx === 2 ? "text-yellow-600" : "text-gray-500")}>
                            #{idx + 1}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-gold/20 flex items-center justify-center text-xs text-gold font-bold">
                              {client.name.split(" ").map(n => n[0]).join("")}
                            </div>
                            <span className="text-sm text-white">{client.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-gold">{client.loyalty_points}</span>
                            <div className="w-16 h-1.5 rounded-full bg-surface-raised overflow-hidden">
                              <div className="h-full bg-gold rounded-full" style={{ width: `${Math.min(100, (client.loyalty_points / 500) * 100)}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-300">{client.total_visits}</td>
                        <td className="px-3 py-3 text-sm text-gray-400">{client.last_visit}</td>
                        <td className="px-3 py-3">
                          <Button variant="outline" size="sm" onClick={() => setAddPointsFor(client.id)}>+ Points</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                  <div key={r.key} className="flex items-center justify-between p-4 bg-surface-raised rounded-xl border border-border">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{r.icon}</span>
                      <div>
                        <p className="text-sm font-medium text-white">{r.label}</p>
                        <p className="text-xs text-gray-400">{r.desc}</p>
                        <p className="text-xs text-gray-600 mt-0.5">Mock — toast only</p>
                      </div>
                    </div>
                    <button onClick={() => toggleReminder(r.key)}
                      className={cn("relative w-11 h-6 rounded-full transition-colors flex-shrink-0", reminders[r.key] ? "bg-gold" : "bg-surface border border-border")}>
                      <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all", reminders[r.key] ? "left-5.5 translate-x-0.5" : "left-0.5")} />
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditPromo(null); setNewPromo({ code: "", discount_type: "percent", discount_value: "", uses_left: "", expires_at: "", is_active: true }); setShowPromoModal(true); }}>
              + Create Promo Code
            </Button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {promos.map(promo => {
              const usagePercent = promo.total_uses > 0 ? (promo.total_uses / (promo.total_uses + promo.uses_left)) * 100 : 0;
              return (
                <Card key={promo.id} className={cn(!promo.is_active && "opacity-60")}>
                  <div className="flex items-start justify-between mb-3">
                    <code className="text-lg font-bold text-gold tracking-widest">{promo.code}</code>
                    <Badge variant={promo.is_active ? "success" : "danger"}>{promo.is_active ? "Active" : "Inactive"}</Badge>
                  </div>
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Discount</span>
                      <span className="text-white font-semibold">
                        {promo.discount_type === "percent" ? `${promo.discount_value}% off` : `$${promo.discount_value} off`}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Uses Left</span>
                      <span className="text-white">{promo.uses_left} / {promo.uses_left + promo.total_uses}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Expires</span>
                      <span className="text-white">{promo.expires_at}</span>
                    </div>
                  </div>
                  <div className="mb-4">
                    <div className="w-full h-2 rounded-full bg-surface-raised overflow-hidden">
                      <div className="h-full bg-gold rounded-full transition-all" style={{ width: `${usagePercent}%` }} />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{Math.round(usagePercent)}% used</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => {
                      setEditPromo(promo);
                      setNewPromo({ code: promo.code, discount_type: promo.discount_type, discount_value: String(promo.discount_value), uses_left: String(promo.uses_left), expires_at: promo.expires_at, is_active: promo.is_active });
                      setShowPromoModal(true);
                    }}>Edit</Button>
                    <Button variant="danger" size="sm" className="flex-1" onClick={() => { setPromos(prev => prev.filter(p => p.id !== promo.id)); showToast("Promo deleted"); }}>Delete</Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Points Modal */}
      {addPointsFor && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setAddPointsFor(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-xs space-y-4">
              <h3 className="text-white font-bold">Add Loyalty Points</h3>
              <p className="text-sm text-gray-400">For: {mockClients.find(c => c.id === addPointsFor)?.name}</p>
              <Input label="Points to add" type="number" value={pointsToAdd} onChange={e => setPointsToAdd(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setAddPointsFor(null)}>Cancel</Button>
                <Button size="sm" className="flex-1" onClick={() => { setAddPointsFor(null); showToast(`${pointsToAdd} points added!`); }}>Add Points</Button>
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
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">{editPromo ? "Edit Promo Code" : "Create Promo Code"}</h2>
                <button onClick={() => setShowPromoModal(false)} className="text-gray-400 hover:text-white">✕</button>
              </div>
              <Input label="Code" value={newPromo.code} onChange={e => setNewPromo(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="SUMMER20" />
              <Select label="Discount Type" value={newPromo.discount_type} onChange={e => setNewPromo(p => ({ ...p, discount_type: e.target.value }))}>
                <option value="percent">Percentage (%)</option>
                <option value="fixed">Fixed ($)</option>
              </Select>
              <Input label={newPromo.discount_type === "percent" ? "Discount %" : "Discount $"} type="number" value={newPromo.discount_value} onChange={e => setNewPromo(p => ({ ...p, discount_value: e.target.value }))} />
              <Input label="Uses Allowed" type="number" value={newPromo.uses_left} onChange={e => setNewPromo(p => ({ ...p, uses_left: e.target.value }))} placeholder="50" />
              <Input label="Expiry Date" type="date" value={newPromo.expires_at} onChange={e => setNewPromo(p => ({ ...p, expires_at: e.target.value }))} />
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowPromoModal(false)}>Cancel</Button>
                <Button className="flex-1" onClick={savePromo}>{editPromo ? "Update" : "Create"}</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
