"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { generate24hSlots, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const ALL_TIMES = generate24hSlots(); // 12:00 AM → 11:30 PM, 30-min increments

const PLANS = [
  { name: "Starter", price: "$19/mo", features: ["1 Barber","50 Appointments/mo","Basic Analytics"], current: false },
  { name: "Pro", price: "$49/mo", features: ["3 Barbers","Unlimited Appointments","Full Analytics","Loyalty System","POS"], current: true },
  { name: "Enterprise", price: "$99/mo", features: ["Unlimited Barbers","Multi-location","Priority Support","White-label"], current: false },
];

const PERMISSIONS: { feature: string; barber: boolean; admin: boolean }[] = [
  { feature: "View Appointments", barber: true, admin: true },
  { feature: "Add/Edit Appointments", barber: true, admin: true },
  { feature: "View Analytics", barber: false, admin: true },
  { feature: "Manage Clients", barber: false, admin: true },
  { feature: "Access POS", barber: true, admin: true },
  { feature: "Manage Services", barber: false, admin: true },
  { feature: "Manage Staff", barber: false, admin: true },
  { feature: "View Revenue", barber: false, admin: true },
  { feature: "Settings", barber: false, admin: true },
];

export default function SettingsPage() {
  const { shop } = useAuth();
  const [tab, setTab] = useState("profile");
  const [toast, setToast] = useState("");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [deactivateInput, setDeactivateInput] = useState("");
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState({
    name: "", address: "", city: "", province: "", postal_code: "",
    phone: "", email: "", description: "",
  });

  const [hours, setHours] = useState(Object.fromEntries(
    DAYS.map(d => [d, { open: "9:00 AM", close: "7:00 PM", closed: false }])
  ));

  const [booking, setBooking] = useState({
    advance_days: 30, cancellation_hours: 24, deposit: false, deposit_amount: 10,
    no_show_protection: true, auto_confirm: false,
  });

  const [permissions, setPermissions] = useState(PERMISSIONS.map(p => ({ ...p })));

  useEffect(() => {
    if (!shop) return;
    setProfile({
      name: shop.name ?? "",
      address: shop.address ?? "",
      city: shop.city ?? "",
      province: shop.province ?? "",
      postal_code: shop.postal_code ?? "",
      phone: shop.phone ?? "",
      email: shop.email ?? "",
      description: shop.description ?? "",
    });
  }, [shop]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const saveProfile = async () => {
    if (!shop) return;
    setSaving(true);
    const { error } = await supabase.from("shops").update({
      name: profile.name, address: profile.address, city: profile.city,
      province: profile.province, postal_code: profile.postal_code,
      phone: profile.phone, email: profile.email, description: profile.description,
    }).eq("id", shop.id);
    setSaving(false);
    showToast(error ? "Failed to save profile." : "Profile saved!");
  };

  const TABS = ["profile","hours","booking","subscription","permissions","danger"];

  const Toggle = ({ value, onChange }: { value: boolean; onChange: () => void }) => (
    <button onClick={onChange}
      className={cn("relative w-11 h-6 rounded-full transition-colors", value ? "bg-gold" : "bg-surface-raised border border-border")}>
      <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all", value ? "left-5.5 translate-x-0.5" : "left-0.5")} />
    </button>
  );

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage your shop preferences</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border flex-wrap">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors",
              tab === t ? "border-gold text-gold" : "border-transparent text-gray-400 hover:text-white",
              t === "danger" && tab !== "danger" && "text-red-400/60 hover:text-red-400")}>
            {t === "hours" ? "Business Hours" : t === "subscription" ? "Subscription" : t}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <Card className="max-w-2xl">
          <CardHeader><CardTitle>Shop Profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {/* Logo Upload */}
            <div>
              <p className="text-sm font-medium text-gray-300 mb-2">Shop Logo</p>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-2xl bg-surface-raised border-2 border-dashed border-border flex items-center justify-center">
                  <span className="text-3xl">💈</span>
                </div>
                <div>
                  <Button variant="outline" size="sm" onClick={() => showToast("Logo upload coming soon!")}>Upload Logo</Button>
                  <p className="text-xs text-gray-500 mt-1">PNG, JPG up to 2MB</p>
                </div>
              </div>
            </div>
            <Input label="Shop Name" value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />
            <Input label="Address" value={profile.address} onChange={e => setProfile(p => ({ ...p, address: e.target.value }))} />
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><Input label="City" value={profile.city} onChange={e => setProfile(p => ({ ...p, city: e.target.value }))} /></div>
              <Input label="Province" value={profile.province} onChange={e => setProfile(p => ({ ...p, province: e.target.value }))} />
            </div>
            <Input label="Postal Code" value={profile.postal_code} onChange={e => setProfile(p => ({ ...p, postal_code: e.target.value }))} />
            <Input label="Phone" value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} />
            <Input label="Email" value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} />
            <Textarea label="Description" value={profile.description} onChange={e => setProfile(p => ({ ...p, description: e.target.value }))} rows={3} />
            <Button onClick={saveProfile} disabled={saving}>{saving ? "Saving…" : "Save Profile"}</Button>
          </CardContent>
        </Card>
      )}

      {tab === "hours" && (
        <Card className="max-w-2xl">
          <CardHeader><CardTitle>Business Hours</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {DAYS.map(day => {
                const h = hours[day];
                return (
                  <div key={day} className="flex items-center gap-4 p-3 bg-surface-raised rounded-xl border border-border">
                    <Toggle value={!h.closed} onChange={() => setHours(prev => ({ ...prev, [day]: { ...h, closed: !h.closed } }))} />
                    <span className="text-sm text-white w-24">{day}</span>
                    {!h.closed ? (
                      <>
                        <select value={h.open} onChange={e => setHours(prev => ({ ...prev, [day]: { ...h, open: e.target.value } }))}
                          className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-white focus:outline-none">
                          {ALL_TIMES.map(t => <option key={t}>{t}</option>)}
                        </select>
                        <span className="text-gray-500 text-xs">to</span>
                        <select value={h.close} onChange={e => setHours(prev => ({ ...prev, [day]: { ...h, close: e.target.value } }))}
                          className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-white focus:outline-none">
                          {ALL_TIMES.map(t => <option key={t}>{t}</option>)}
                        </select>
                      </>
                    ) : (
                      <span className="text-sm text-gray-500">Closed</span>
                    )}
                  </div>
                );
              })}
            </div>
            <Button className="mt-4" onClick={() => showToast("Hours saved!")}>Save Hours</Button>
          </CardContent>
        </Card>
      )}

      {tab === "booking" && (
        <Card className="max-w-2xl">
          <CardHeader><CardTitle>Booking Settings</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Input label="Advance Booking Limit (days)" type="number" value={String(booking.advance_days)}
                onChange={e => setBooking(p => ({ ...p, advance_days: Number(e.target.value) }))} />
              <p className="text-xs text-gray-500 mt-1">How far in advance clients can book</p>
            </div>
            <div>
              <Input label="Cancellation Notice Required (hours)" type="number" value={String(booking.cancellation_hours)}
                onChange={e => setBooking(p => ({ ...p, cancellation_hours: Number(e.target.value) }))} />
            </div>
            <div className="flex items-center justify-between p-4 bg-surface-raised rounded-xl border border-border">
              <div>
                <p className="text-sm font-medium text-white">Deposit Requirement</p>
                <p className="text-xs text-gray-400">Require deposit at booking</p>
              </div>
              <Toggle value={booking.deposit} onChange={() => setBooking(p => ({ ...p, deposit: !p.deposit }))} />
            </div>
            {booking.deposit && (
              <Input label="Deposit Amount ($)" type="number" value={String(booking.deposit_amount)}
                onChange={e => setBooking(p => ({ ...p, deposit_amount: Number(e.target.value) }))} />
            )}
            <div className="flex items-center justify-between p-4 bg-surface-raised rounded-xl border border-border">
              <div>
                <p className="text-sm font-medium text-white">No-Show Protection</p>
                <p className="text-xs text-gray-400">Charge card on file for no-shows</p>
              </div>
              <Toggle value={booking.no_show_protection} onChange={() => setBooking(p => ({ ...p, no_show_protection: !p.no_show_protection }))} />
            </div>
            <div className="flex items-center justify-between p-4 bg-surface-raised rounded-xl border border-border">
              <div>
                <p className="text-sm font-medium text-white">Auto-Confirm Bookings</p>
                <p className="text-xs text-gray-400">Automatically confirm new bookings</p>
              </div>
              <Toggle value={booking.auto_confirm} onChange={() => setBooking(p => ({ ...p, auto_confirm: !p.auto_confirm }))} />
            </div>
            <Button onClick={() => showToast("Booking settings saved!")}>Save Settings</Button>
          </CardContent>
        </Card>
      )}

      {tab === "subscription" && (
        <div className="space-y-4 max-w-3xl">
          <Card className="border-gold/20">
            <CardHeader>
              <div>
                <CardTitle>Current Plan</CardTitle>
                <p className="text-sm text-gray-400 mt-1">You are on the Pro plan</p>
              </div>
              <Badge variant="gold">Pro</Badge>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-4xl font-bold text-gold">$49</span>
                <span className="text-gray-400">/month</span>
              </div>
              <div className="space-y-2 mb-4">
                {["3 Barbers","Unlimited Appointments","Full Analytics Dashboard","Loyalty & Points System","Point of Sale (POS)","Promo Codes","Client Management"].map(f => (
                  <div key={f} className="flex items-center gap-2 text-sm text-gray-300">
                    <span className="text-emerald-400">✓</span>{f}
                  </div>
                ))}
              </div>
              <Button variant="outline" onClick={() => setShowUpgradeModal(true)}>Upgrade Plan</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "permissions" && (
        <Card className="max-w-2xl">
          <CardHeader><CardTitle>Role Permissions</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-gray-400 px-3 py-2">Feature</th>
                    <th className="text-center text-xs font-medium text-gray-400 px-3 py-2">Barber</th>
                    <th className="text-center text-xs font-medium text-gray-400 px-3 py-2">Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((perm, idx) => (
                    <tr key={perm.feature} className="border-b border-border/50">
                      <td className="px-3 py-3 text-sm text-white">{perm.feature}</td>
                      <td className="px-3 py-3 text-center">
                        <button onClick={() => setPermissions(prev => prev.map((p, i) => i === idx ? { ...p, barber: !p.barber } : p))}
                          className={cn("w-5 h-5 rounded border-2 flex items-center justify-center mx-auto transition-colors",
                            perm.barber ? "bg-gold border-gold text-black" : "border-border")}>
                          {perm.barber && <span className="text-xs font-bold">✓</span>}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="w-5 h-5 rounded bg-emerald-500 border-2 border-emerald-500 flex items-center justify-center mx-auto">
                          <span className="text-xs font-bold text-white">✓</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button className="mt-4" onClick={() => showToast("Permissions saved!")}>Save Permissions</Button>
          </CardContent>
        </Card>
      )}

      {tab === "danger" && (
        <Card className="max-w-2xl border-red-500/30">
          <CardHeader><CardTitle className="text-red-400">Danger Zone</CardTitle></CardHeader>
          <CardContent>
            <div className="p-4 bg-red-500/10 rounded-xl border border-red-500/30 space-y-4">
              <div>
                <p className="text-sm font-semibold text-red-400">Deactivate Shop</p>
                <p className="text-xs text-gray-400 mt-1">This will disable your booking page and pause all services. You can reactivate anytime.</p>
              </div>
              {!showDeactivateConfirm ? (
                <Button variant="danger" onClick={() => setShowDeactivateConfirm(true)}>Deactivate Shop</Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-300">Type <span className="text-white font-mono bg-surface-raised px-1 rounded">{profile.name}</span> to confirm:</p>
                  <input value={deactivateInput} onChange={e => setDeactivateInput(e.target.value)}
                    placeholder="Shop name..."
                    className="w-full rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/30" />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setShowDeactivateConfirm(false); setDeactivateInput(""); }}>Cancel</Button>
                    <Button variant="danger" size="sm" disabled={deactivateInput !== profile.name}
                      onClick={() => { setShowDeactivateConfirm(false); setDeactivateInput(""); showToast("Shop deactivated (Demo mode)"); }}>
                      Confirm Deactivate
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowUpgradeModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Choose a Plan</h2>
                <button onClick={() => setShowUpgradeModal(false)} className="text-gray-400 hover:text-white">✕</button>
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                {PLANS.map(plan => (
                  <div key={plan.name} className={cn("p-4 rounded-xl border", plan.current ? "border-gold bg-gold/5" : "border-border")}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-white">{plan.name}</h3>
                      {plan.current && <Badge variant="gold">Current</Badge>}
                    </div>
                    <p className="text-xl font-bold text-gold mb-3">{plan.price}</p>
                    <div className="space-y-1 mb-4">
                      {plan.features.map(f => (
                        <p key={f} className="text-xs text-gray-400 flex items-center gap-1"><span className="text-emerald-400">✓</span>{f}</p>
                      ))}
                    </div>
                    <Button variant={plan.current ? "secondary" : "gold"} size="sm" className="w-full"
                      disabled={plan.current}
                      onClick={() => { setShowUpgradeModal(false); showToast(`Switching to ${plan.name}... (Demo mode)`); }}>
                      {plan.current ? "Current Plan" : `Switch to ${plan.name}`}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
