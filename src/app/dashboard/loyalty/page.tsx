"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Info, X } from "lucide-react";
import type { Client, PromoCode } from "@/lib/database.types";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <span className="text-foreground">✓</span>{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
    </div>
  );
}

const BLANK_PROMO = { code: "", discount_type: "percent", discount_value: "", uses_left: "", expires_at: "", is_active: true };

export default function LoyaltyPage() {
  const { shop, accessToken } = useAuth();
  const [tab, setTab] = useState<"loyalty" | "promos">("loyalty");
  const [toast, setToast] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [editPromo, setEditPromo] = useState<PromoCode | null>(null);
  const [addPointsFor, setAddPointsFor] = useState<Client | null>(null);
  const [pointsToAdd, setPointsToAdd] = useState("10");
  const [redeemFor, setRedeemFor] = useState<Client | null>(null);
  const [pointsToRedeem, setPointsToRedeem] = useState("100");
  const [saving, setSaving] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [reminders, setReminders] = useState({
    appointment_24h: true, rebooking_30d: true, birthday: false, winback_60d: false,
  });
  const [settings, setSettings] = useState({ points_per_visit: 10, points_per_dollar: 1, redemption: 5 });
  const [showHelp, setShowHelp] = useState(false);
  // Program Settings UX: per-dollar earning is tucked behind an "Advanced"
  // disclosure (most shops only use per-visit), and the worked example below
  // recalculates off an editable sample visit price so the owner sees exactly
  // what the next customer earns at their own prices.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [examplePrice, setExamplePrice] = useState(30);
  const [newPromo, setNewPromo] = useState(BLANK_PROMO);

  // Live numbers for the help/example text, straight from the current settings so
  // the owner sees exactly what their program does.
  const exReward = Math.round(settings.points_per_visit + settings.points_per_dollar * 30); // a $30 visit
  const centsPerPoint = settings.redemption; // 100 pts = $redemption ⇒ 1 pt ≈ redemption¢
  const dollarsOf = (pts: number) => (pts / 100) * settings.redemption;

  // Live worked-example numbers, driven by the editable sample visit price.
  const inlineNum = "w-16 rounded-lg border border-border bg-card px-2 py-1.5 text-center text-base font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-black/20";
  const exVisitPts = Math.round(settings.points_per_visit + settings.points_per_dollar * (examplePrice || 0));
  const exVisitValue = dollarsOf(exVisitPts);
  const visitsToReward = exVisitPts > 0 ? Math.ceil(100 / exVisitPts) : 0;

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // Load persisted loyalty settings + reminder prefs from booking_settings.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bs = (shop as any)?.booking_settings;
    const ls = bs?.loyalty;
    if (ls) {
      setSettings({
        points_per_visit: ls.points_per_visit ?? 10,
        points_per_dollar: ls.points_per_dollar ?? 1,
        redemption: ls.redemption_rate ?? 5,
      });
    }
    if (bs?.reminders) {
      setReminders(r => ({ ...r, ...bs.reminders }));
    }
  }, [shop]);

  const saveSettings = async () => {
    if (!shop) return;
    setSavingSettings(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current = ((shop as any).booking_settings ?? {}) as Record<string, unknown>;
    const next = {
      ...current,
      loyalty: {
        enabled: true,
        points_per_visit: settings.points_per_visit,
        points_per_dollar: settings.points_per_dollar,
        redemption_rate: settings.redemption,
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from("shops").update({ booking_settings: next as any }).eq("id", shop.id);
    setSavingSettings(false);
    showToast(error ? "Failed to save settings" : "Settings saved!");
  };

  const redeemPoints = async () => {
    if (!redeemFor || !shop || !accessToken) return;
    const pts = Number(pointsToRedeem);
    const res = await fetch("/api/loyalty/points", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: redeemFor.id, points: -Math.abs(pts), shop_id: shop?.id }),
    });
    const data = await res.json();
    if (res.ok) {
      setClients(prev => prev.map(c => c.id === redeemFor.id ? { ...c, loyalty_points: data.loyalty_points } : c).sort((a, b) => b.loyalty_points - a.loyalty_points));
      const dollarValue = settings.redemption ? (pts / 100) * settings.redemption : 0;
      showToast(`${pts} pts redeemed${dollarValue ? ` ($${dollarValue.toFixed(2)} value)` : ""} for ${redeemFor.name}`);
    } else {
      showToast(data.error ?? "Failed to redeem");
    }
    setRedeemFor(null);
  };

  const loadData = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const [clientRes, promoRes] = await Promise.all([
      supabase.from("clients").select("*").eq("shop_id", shop.id).order("loyalty_points", { ascending: false }),
      // promo_codes has no created_at column — order by active-first then code.
      // Ordering by the missing column returned a 400 and broke promo loading.
      supabase.from("promo_codes").select("*").eq("shop_id", shop.id).order("is_active", { ascending: false }).order("code", { ascending: true }),
    ]);
    if (clientRes.data) setClients(clientRes.data);
    if (promoRes.data) setPromos(promoRes.data);
    setLoading(false);
  }, [shop]);

  useEffect(() => { loadData(); }, [loadData]);

  const addPoints = async () => {
    if (!addPointsFor || !shop || !accessToken) return;
    const pts = Number(pointsToAdd);
    const res = await fetch("/api/loyalty/points", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: addPointsFor.id, points: pts, shop_id: shop?.id }),
    });
    const data = await res.json();
    if (res.ok) {
      setClients(prev => prev.map(c => c.id === addPointsFor.id ? { ...c, loyalty_points: data.loyalty_points } : c).sort((a, b) => b.loyalty_points - a.loyalty_points));
      showToast(`${pts} points added to ${addPointsFor.name}!`);
    } else {
      showToast(data.error ?? "Failed to add points");
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

  // Persist reminder preferences to booking_settings so the choice sticks (and
  // is ready for the scheduler). NOTE: automated sending isn't wired yet, so we
  // save the preference honestly rather than claiming a reminder was "enabled".
  const toggleReminder = async (key: keyof typeof reminders) => {
    const next = { ...reminders, [key]: !reminders[key] };
    setReminders(next);
    if (!shop) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current = ((shop as any).booking_settings ?? {}) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from("shops").update({ booking_settings: { ...current, reminders: next } as any }).eq("id", shop.id);
    showToast("Preference saved");
  };

  if (!shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-2xl mb-2">🎁</p>
        <h2 className="text-lg font-bold text-foreground mb-1">No shop linked</h2>
        <p className="text-sm text-grey">Loyalty program will be available once your shop is set up.</p>
      </div>
    );
  }

  const activePlan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  if (!planHasFeature(activePlan, "loyalty")) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-4xl mb-4">🔒</p>
        <h2 className="text-xl font-bold text-foreground mb-2">Loyalty Program</h2>
        <p className="text-sm text-grey mb-6 max-w-sm">Loyalty points, promo codes, and automated reminders are available on the Pro and Premium plans.</p>
        <a href="/dashboard/billing" className="inline-flex items-center gap-2 bg-white text-black text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-white/90 transition-colors">
          Upgrade to unlock
        </a>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground uppercase tracking-wide">Loyalty & Marketing</h1>
            <button type="button" onClick={() => setShowHelp(true)} aria-label="How loyalty points work"
              className="w-6 h-6 rounded-full flex items-center justify-center text-grey hover:text-foreground hover:bg-card-raised transition-colors">
              <Info size={16} />
            </button>
          </div>
          <p className="text-sm text-grey mt-0.5">Retain clients and drive repeat visits</p>
        </div>
      </div>

      {/* How-it-works guide — reads live off the owner's own settings so the
          numbers always match what their program actually does. */}
      {showHelp && (
        <>
          <div className="fixed inset-0 bg-black/60 z-[60]" onClick={() => setShowHelp(false)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-foreground font-bold text-lg">How loyalty points work</h3>
                <button onClick={() => setShowHelp(false)} className="text-grey hover:text-foreground" aria-label="Close"><X size={18} /></button>
              </div>

              <div className="space-y-3 text-sm text-grey leading-relaxed">
                <div>
                  <p className="text-foreground font-semibold mb-0.5">1. Clients earn automatically</p>
                  <p>Every time you mark an appointment <span className="text-foreground">Completed</span>, the client earns
                  {" "}<span className="text-foreground font-medium">{settings.points_per_visit} pts per visit + {settings.points_per_dollar} pt per $1</span> spent.
                  A <span className="text-foreground">$30</span> visit = <span className="text-foreground font-medium">{exReward} pts</span>.</p>
                </div>
                <div>
                  <p className="text-foreground font-semibold mb-0.5">2. What points are worth</p>
                  <p><span className="text-foreground font-medium">100 pts = ${settings.redemption.toFixed(2)}</span> off (about {centsPerPoint}¢ per point). You set all three numbers in <span className="text-foreground">Program Settings</span> below.</p>
                </div>
                <div>
                  <p className="text-foreground font-semibold mb-0.5">3. Redeeming</p>
                  <p>Find the client in the leaderboard → tap <span className="text-foreground">Redeem</span>. It subtracts the points and shows the dollar value — then you take that amount off their bill at checkout.</p>
                </div>
                <div className="rounded-xl bg-card-raised border border-border p-3 space-y-1.5">
                  <p className="text-foreground font-semibold">💡 Tips to get the most out of it</p>
                  <p>• Lean on <span className="text-foreground">points per visit</span> — it rewards coming back, which is what grows a barbershop.</p>
                  <p>• Aim so ~5–6 visits earns a meaningful reward — close enough to chase, valuable enough to matter.</p>
                  <p>• Say it out loud at checkout: <span className="text-foreground">“you’ve got ${dollarsOf(200).toFixed(2)} in points saved up.”</span> That’s what brings them back.</p>
                  <p>• Points only apply on <span className="text-foreground">Pro/Premium</span> plans, and only for clients in your list (online bookings add them for you).</p>
                </div>
              </div>

              <Button className="w-full" onClick={() => setShowHelp(false)}>Got it</Button>
            </div>
          </div>
        </>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["loyalty","promos"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t ? "border-black text-foreground" : "border-transparent text-grey hover:text-foreground")}>
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
              {/* Plain-English earning rules — same three saved settings, just
                  written as fill-in-the-blank sentences instead of raw boxes. */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-foreground">
                  <span>Clients earn</span>
                  <input type="number" min={0} value={settings.points_per_visit}
                    onChange={e => setSettings(p => ({ ...p, points_per_visit: Number(e.target.value) }))}
                    className={inlineNum} />
                  <span>points every visit.</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-foreground">
                  <span>Every 100 points =</span>
                  <span className="text-grey">$</span>
                  <input type="number" min={0} value={settings.redemption}
                    onChange={e => setSettings(p => ({ ...p, redemption: Number(e.target.value) }))}
                    className={inlineNum} />
                  <span>off their bill.</span>
                </div>

                {/* Advanced: points-per-dollar. It stays applied even when
                    collapsed, so the toggle line states the active rate to keep
                    the example honest. */}
                {showAdvanced ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-foreground">
                    <span>Plus</span>
                    <input type="number" min={0} value={settings.points_per_dollar}
                      onChange={e => setSettings(p => ({ ...p, points_per_dollar: Number(e.target.value) }))}
                      className={inlineNum} />
                    <span>point per $1 spent.</span>
                    <button type="button" onClick={() => setShowAdvanced(false)}
                      className="text-xs text-grey hover:text-foreground underline ml-1">hide</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setShowAdvanced(true)}
                    className="text-xs text-grey hover:text-foreground underline">
                    Advanced · {settings.points_per_dollar > 0
                      ? `also earning ${settings.points_per_dollar} pt per $1 spent`
                      : "also earn points per dollar spent"}
                  </button>
                )}
              </div>

              {/* Worked example — recalculates live off an editable sample visit
                  price so the owner sees exactly what the next customer earns. */}
              <div className="mt-5 rounded-xl bg-card-raised border border-border p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className="text-sm font-semibold text-foreground">What the next customer earns</p>
                  <label className="flex items-center gap-1.5 text-xs text-grey whitespace-nowrap">
                    Visit price <span>$</span>
                    <input type="number" min={0} value={examplePrice}
                      onChange={e => setExamplePrice(Number(e.target.value))}
                      className="w-14 rounded-lg border border-border bg-card px-2 py-1 text-center font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-black/20" />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-card p-3">
                    <p className="text-lg font-bold text-foreground">{exVisitPts}</p>
                    <p className="text-[11px] text-grey mt-0.5">pts earned</p>
                  </div>
                  <div className="rounded-lg bg-card p-3">
                    <p className="text-lg font-bold text-foreground">${exVisitValue.toFixed(2)}</p>
                    <p className="text-[11px] text-grey mt-0.5">value earned</p>
                  </div>
                  <div className="rounded-lg bg-card p-3">
                    <p className="text-lg font-bold text-foreground">{visitsToReward || "—"}</p>
                    <p className="text-[11px] text-grey mt-0.5">visits to ${settings.redemption.toFixed(2)} off</p>
                  </div>
                </div>
                <p className="text-xs text-grey mt-3 leading-relaxed">
                  💡 A <span className="text-foreground">${examplePrice}</span> visit earns{" "}
                  <span className="text-foreground font-medium">{exVisitPts} pts</span>
                  {settings.points_per_dollar > 0 ? ` (${settings.points_per_visit} per visit + ${examplePrice} × ${settings.points_per_dollar} per $1)` : ""}.
                  {" "}After about <span className="text-foreground font-medium">{visitsToReward || "—"} visit{visitsToReward === 1 ? "" : "s"}</span> they’ll have <span className="text-foreground font-medium">${settings.redemption.toFixed(2)}</span> off (≈ {centsPerPoint}¢ a point).
                </p>
              </div>

              <Button className="mt-4" loading={savingSettings} onClick={saveSettings}>Save Settings</Button>
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
                <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 rounded-xl bg-card-raised animate-pulse" />)}</div>
              ) : clients.length === 0 ? (
                <div className="text-center py-8"><p className="text-grey text-sm">No clients yet</p></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left text-xs text-grey px-3 py-2">Rank</th>
                        <th className="text-left text-xs text-grey px-3 py-2">Client</th>
                        <th className="text-left text-xs text-grey px-3 py-2">Points</th>
                        <th className="text-left text-xs text-grey px-3 py-2">Visits</th>
                        <th className="text-left text-xs text-grey px-3 py-2">Last Visit</th>
                        <th className="text-left text-xs text-grey px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((client, idx) => (
                        <tr key={client.id} className="border-b border-[#2a2a2a]/50 hover:bg-card-raised/30">
                          <td className="px-3 py-3">
                            <span className={cn("text-sm font-bold", idx === 0 ? "text-foreground" : idx === 1 ? "text-grey" : idx === 2 ? "text-orange-600" : "text-grey")}>
                              #{idx + 1}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-black/10 flex items-center justify-center text-xs text-foreground font-bold">
                                {client.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                              </div>
                              <span className="text-sm text-foreground">{client.name}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-foreground">{client.loyalty_points}</span>
                              <div className="w-16 h-1.5 rounded-full bg-card-raised overflow-hidden">
                                <div className="h-full bg-gold rounded-full" style={{ width: `${Math.min(100, (client.loyalty_points / 500) * 100)}%` }} />
                              </div>
                            </div>
                            {client.loyalty_points > 0 && (
                              <p className="text-[11px] text-grey mt-1">≈ ${dollarsOf(client.loyalty_points).toFixed(2)} value</p>
                            )}
                          </td>
                          <td className="px-3 py-3 text-sm text-grey">{client.total_visits}</td>
                          <td className="px-3 py-3 text-sm text-grey">{client.last_visit ?? "—"}</td>
                          <td className="px-3 py-3">
                            <div className="flex gap-2">
                              <Button variant="outline" size="sm" onClick={() => setAddPointsFor(client)}>+ Points</Button>
                              <Button variant="outline" size="sm" disabled={client.loyalty_points <= 0} onClick={() => { setPointsToRedeem("100"); setRedeemFor(client); }}>Redeem</Button>
                            </div>
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
            <CardHeader>
              <CardTitle>Automated Reminders</CardTitle>
              <Badge variant="success">Active</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-grey mb-4">Sent automatically once a day. Toggle what you want on — 24h reminders text &amp; email the client, the rest email.</p>
              <div className="space-y-4">
                {[
                  { key: "appointment_24h" as const, label: "24hr Appointment Reminder", desc: "SMS sent 24hrs before appointment", icon: "⏰" },
                  { key: "rebooking_30d" as const, label: "Re-booking Reminder", desc: "SMS if client hasn't visited in 30 days", icon: "📅" },
                  { key: "birthday" as const, label: "Birthday Message", desc: "Send a birthday discount message", icon: "🎂" },
                  { key: "winback_60d" as const, label: "Win-Back Campaign", desc: "Reach out to clients after 60 days of no activity", icon: "💌" },
                ].map(r => (
                  <div key={r.key} className="flex items-center justify-between p-4 bg-card-raised rounded-xl border border-border">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{r.icon}</span>
                      <div>
                        <p className="text-sm font-medium text-foreground">{r.label}</p>
                        <p className="text-xs text-grey">{r.desc}</p>
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
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-48 rounded-2xl bg-card-raised animate-pulse" />)}
            </div>
          ) : promos.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">🎟️</p>
              <p className="text-grey text-sm">No promo codes yet. Create your first promo above.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {promos.map(promo => {
                const totalAlloc = promo.total_uses + (promo.uses_left ?? 0);
                const usagePercent = totalAlloc > 0 ? (promo.total_uses / totalAlloc) * 100 : 0;
                return (
                  <Card key={promo.id} className={cn(!promo.is_active && "opacity-60")}>
                    <div className="flex items-start justify-between mb-3">
                      <code className="text-lg font-bold text-foreground tracking-widest">{promo.code}</code>
                      <Badge variant={promo.is_active ? "success" : "danger"}>{promo.is_active ? "Active" : "Inactive"}</Badge>
                    </div>
                    <div className="space-y-2 mb-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-grey">Discount</span>
                        <span className="text-foreground font-semibold">
                          {promo.discount_type === "percent" ? `${promo.discount_value}% off` : `$${promo.discount_value} off`}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-grey">Uses Left</span>
                        <span className="text-foreground">{promo.uses_left ?? "∞"} / {totalAlloc > 0 ? totalAlloc : "∞"}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-grey">Expires</span>
                        <span className="text-foreground">{promo.expires_at ?? "Never"}</span>
                      </div>
                    </div>
                    {totalAlloc > 0 && (
                      <div className="mb-4">
                        <div className="w-full h-2 rounded-full bg-card-raised overflow-hidden">
                          <div className="h-full bg-gold rounded-full transition-all" style={{ width: `${usagePercent}%` }} />
                        </div>
                        <p className="text-xs text-grey mt-1">{Math.round(usagePercent)}% used ({promo.total_uses} redemptions)</p>
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-xs space-y-4">
              <h3 className="text-foreground font-bold">Add Loyalty Points</h3>
              <p className="text-sm text-grey">For: {addPointsFor.name}</p>
              <Input label="Points to add" type="number" value={pointsToAdd} onChange={e => setPointsToAdd(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setAddPointsFor(null)}>Cancel</Button>
                <Button size="sm" className="flex-1" onClick={addPoints}>Add Points</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Redeem Points Modal */}
      {redeemFor && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setRedeemFor(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-xs space-y-4">
              <h3 className="text-foreground font-bold">Redeem Loyalty Points</h3>
              <p className="text-sm text-grey">For: {redeemFor.name} · Balance: {redeemFor.loyalty_points} pts</p>
              <Input label="Points to redeem" type="number" value={pointsToRedeem} onChange={e => setPointsToRedeem(e.target.value)} />
              {settings.redemption > 0 && (
                <p className="text-xs text-grey">≈ ${((Number(pointsToRedeem) / 100) * settings.redemption).toFixed(2)} discount value</p>
              )}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setRedeemFor(null)}>Cancel</Button>
                <Button size="sm" className="flex-1" onClick={redeemPoints}>Redeem</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Promo Modal */}
      {showPromoModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowPromoModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">{editPromo ? "Edit Promo Code" : "Create Promo Code"}</h2>
                <button onClick={() => setShowPromoModal(false)} className="text-grey hover:text-foreground">✕</button>
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
