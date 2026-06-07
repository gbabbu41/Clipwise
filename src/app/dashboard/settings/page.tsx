"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { Building2, Plus, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { effectivePlan } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { NotifSoundToggle } from "@/components/notif-sound-toggle";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#777] hover:text-white ml-2">✕</button>
    </div>
  );
}

type BookingSettings = {
  advance_days: number;
  cancellation_hours: number;
  deposit: boolean;
  deposit_amount: number;
  no_show_protection: boolean;
  no_show_fee_amount: number; // $ to charge for a no-show; 0 = full service price
  auto_confirm: boolean;
};

const DEFAULT_BOOKING: BookingSettings = {
  advance_days: 30, cancellation_hours: 24, deposit: false,
  deposit_amount: 10, no_show_protection: true, no_show_fee_amount: 0, auto_confirm: false,
};

// Plan info — mirrors the pricing shown on the public homepage (src/app/page.tsx).
// "current" is computed at render time from the shop's real subscription_plan.
type PlanInfo = { key: string; name: string; priceLabel: string; priceSuffix: string; features: string[] };
const PLAN_INFO: PlanInfo[] = [
  {
    key: "starter", name: "Starter", priceLabel: "Free", priceSuffix: "forever",
    features: ["1 barber", "Online booking page", "Appointment management", "Basic analytics", "SMS reminders"],
  },
  {
    key: "pro", name: "Pro", priceLabel: "$23", priceSuffix: "/month",
    features: ["Up to 4 barbers", "Online booking + payments", "Advanced analytics", "SMS reminders", "Stripe Connect payouts"],
  },
  {
    key: "premium", name: "Premium", priceLabel: "$49", priceSuffix: "/month",
    features: ["Up to 9 barbers", "Everything in Pro", "Full POS via Stripe Terminal", "Inventory management", "Staff management", "Full analytics & reports", "Dedicated support"],
  },
];

type NewLocation = { name: string; address: string; city: string; province: string; phone: string; email: string };
const BLANK_LOCATION: NewLocation = { name: "", address: "", city: "", province: "", phone: "", email: "" };

export default function SettingsPage() {
  const { user, shop, shops, setActiveShop, profile: authProfile, refreshShop, accessToken } = useAuth();
  const [tab, setTab] = useState("profile");

  // Account/password state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [toast, setToast] = useState("");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [deactivateInput, setDeactivateInput] = useState("");
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deletingShop, setDeletingShop] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocation, setNewLocation] = useState<NewLocation>(BLANK_LOCATION);
  const [addingLocation, setAddingLocation] = useState(false);

  const [profile, setProfile] = useState({
    name: "", address: "", city: "", province: "", postal_code: "",
    phone: "", email: "", description: "",
    instagram: "", tiktok: "", facebook: "", youtube: "", website: "",
    google_place_id: "",
    allow_pay_in_person: true,
  });

  const [booking, setBooking] = useState<BookingSettings>(DEFAULT_BOOKING);

  const DEFAULT_TEMPLATES = {
    booking_confirmation: { subject: "Booking Confirmed — {shopName}", body: "Hi {clientName},\n\nYour appointment at {shopName} is confirmed!\n\nService: {serviceName}\nBarber: {barberName}\nDate: {date}\nTime: {time}\n\nSee you soon!" },
    appointment_reminder: { subject: "Reminder: Your appointment tomorrow at {shopName}", body: "Hi {clientName},\n\nJust a reminder — you have an appointment at {shopName} tomorrow.\n\nBarber: {barberName}\nService: {serviceName}\nTime: {time}\n\nSee you then!" },
    appointment_rejected: { subject: "Your appointment at {shopName} has been cancelled", body: "Hi {clientName},\n\nUnfortunately your appointment at {shopName} has been cancelled.\n\nWe hope to see you again soon!" },
  };
  type TemplateKey = keyof typeof DEFAULT_TEMPLATES;
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [savingTemplates, setSavingTemplates] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const uploadLogo = async (file: File) => {
    if (!shop) return;
    setLogoUploading(true);
    setLogoPreview(URL.createObjectURL(file));
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("shopId", shop.id);
      const res = await fetch("/api/upload-logo", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken ?? ""}` },
        body: form,
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? "Upload failed"); }
      const { url } = await res.json() as { url: string };
      setLogoPreview(url);
      await refreshShop();
      showToast("Logo updated!");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Upload failed");
      setLogoPreview(shop.logo ?? null);
    } finally {
      setLogoUploading(false);
    }
  };

  useEffect(() => {
    if (shop?.logo) setLogoPreview(shop.logo);
  }, [shop?.logo]);

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
      instagram: shop.instagram ?? "",
      tiktok: shop.tiktok ?? "",
      facebook: shop.facebook ?? "",
      youtube: shop.youtube ?? "",
      website: shop.website ?? "",
      google_place_id: shop.google_place_id ?? "",
      allow_pay_in_person: shop.allow_pay_in_person ?? true,
    });

    // Load booking settings + notification templates — try Supabase first, fall back to localStorage
    (async () => {
      try {
        const { data, error } = await supabase
          .from("shops")
          .select("*")
          .eq("id", shop.id)
          .single();
        const row = data as Record<string, unknown> | null;

        if (!error && row) {
          if (row.booking_settings && typeof row.booking_settings === "object") {
            setBooking(row.booking_settings as BookingSettings);
          } else {
            const cached = localStorage.getItem(`booking_${shop.id}`);
            if (cached) setBooking(JSON.parse(cached) as BookingSettings);
          }
          if (row.notification_templates) {
            setTemplates(prev => ({ ...prev, ...(row.notification_templates as typeof DEFAULT_TEMPLATES) }));
          }
        } else {
          const cachedB = localStorage.getItem(`booking_${shop.id}`);
          if (cachedB) setBooking(JSON.parse(cachedB) as BookingSettings);
        }
      } catch {
        const cachedB = localStorage.getItem(`booking_${shop.id}`);
        if (cachedB) setBooking(JSON.parse(cachedB) as BookingSettings);
      }
    })();
  }, [shop]);

  const saveTemplates = async () => {
    if (!shop) return;
    setSavingTemplates(true);
    await supabase.from("shops").update({ notification_templates: templates }).eq("id", shop.id);
    setSavingTemplates(false);
    showToast("Templates saved!");
  };

  const saveProfile = async () => {
    if (!shop) return;
    setSaving(true);
    const { error } = await supabase.from("shops").update({
      name: profile.name, address: profile.address, city: profile.city,
      province: profile.province, postal_code: profile.postal_code,
      phone: profile.phone, email: profile.email, description: profile.description,
      instagram: profile.instagram || null,
      tiktok: profile.tiktok || null,
      facebook: profile.facebook || null,
      youtube: profile.youtube || null,
      website: profile.website || null,
      google_place_id: profile.google_place_id || null,
      allow_pay_in_person: profile.allow_pay_in_person,
    }).eq("id", shop.id);
    setSaving(false);
    showToast(error ? "Failed to save profile." : "Profile saved!");
  };

  const saveBooking = async () => {
    if (!shop) return;
    setSaving(true);
    // Save both the JSON `booking_settings` blob and the top-level
    // `allow_pay_in_person` column in one update — they're both shown in
    // this tab, so it would be confusing to have separate save buttons.
    const { error } = await supabase.from("shops").update({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      booking_settings: booking as any,
      allow_pay_in_person: profile.allow_pay_in_person,
    }).eq("id", shop.id);
    if (error) {
      localStorage.setItem(`booking_${shop.id}`, JSON.stringify(booking));
      showToast("Booking settings saved locally!");
    } else {
      showToast("Booking settings saved!");
    }
    setSaving(false);
  };

  const addLocation = async () => {
    if (!newLocation.name.trim() || !authProfile) return;
    setAddingLocation(true);
    const slug = newLocation.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Math.random().toString(36).slice(2, 6);
    const { error } = await supabase.from("shops").insert({
      owner_id: authProfile.id,
      name: newLocation.name.trim(),
      address: newLocation.address,
      city: newLocation.city,
      province: newLocation.province,
      phone: newLocation.phone,
      email: newLocation.email,
      slug,
      subscription_plan: shop?.subscription_plan ?? "starter",
      is_active: true,
      status: "pending",
      postal_code: "",
    });
    setAddingLocation(false);
    if (error) { showToast("Failed to add location: " + error.message); return; }
    showToast("New location added! Awaiting approval.");
    setShowAddLocation(false);
    setNewLocation(BLANK_LOCATION);
    await refreshShop();
  };

  const TABS = ["profile","account","booking","notifications","subscription","locations","danger"];

  const changePassword = async () => {
    if (newPassword.length < 8) { setToast("Password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setToast("Passwords do not match."); return; }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) { setToast(`Failed: ${error.message}`); return; }
    setNewPassword(""); setConfirmPassword("");
    setToast("Password updated.");
  };

  // The shared Bootstrap form-switch wraps all of these; this local alias
  // keeps the existing call signature (`<Toggle value={..} onChange={..} />`).
  const Toggle = ({ value, onChange }: { value: boolean; onChange: () => void }) => (
    <Switch checked={value} onChange={onChange} />
  );

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-[#777] mt-0.5">Manage your shop preferences</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#1e1e1e] flex-wrap">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors",
              tab === t ? "border-black text-white" : "border-transparent text-[#777] hover:text-white",
              t === "danger" && tab !== "danger" && "text-red-400/60 hover:text-red-400")}>
            {t === "subscription" ? "Subscription" : t === "locations" ? "Locations" : t === "notifications" ? "Notifications" : t}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <Card className="max-w-2xl">
          <CardHeader><CardTitle>Shop Profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-[#777] mb-2">Shop Logo</p>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-2xl bg-[#141414] border-2 border-dashed border-[#1e1e1e] flex items-center justify-center overflow-hidden flex-shrink-0">
                  {logoPreview
                    ? <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
                    : <span className="text-3xl">💈</span>}
                </div>
                <div>
                  <label className={cn("cursor-pointer", logoUploading && "pointer-events-none opacity-60")}>
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#1e1e1e] text-sm text-white hover:bg-[#141414] transition-colors">
                      {logoUploading ? "Uploading…" : logoPreview ? "Change Logo" : "Upload Logo"}
                    </div>
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
                  </label>
                  <p className="text-xs text-[#777] mt-1">PNG, JPG, WebP up to 5MB</p>
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

            {/* Social Media */}
            <div>
              <p className="text-sm font-medium text-[#777] mb-3">Social Media & Website</p>
              <div className="space-y-3">
                <Input label="Instagram URL" placeholder="https://instagram.com/yourshop" value={profile.instagram} onChange={e => setProfile(p => ({ ...p, instagram: e.target.value }))} />
                <Input label="TikTok URL" placeholder="https://tiktok.com/@yourshop" value={profile.tiktok} onChange={e => setProfile(p => ({ ...p, tiktok: e.target.value }))} />
                <Input label="Facebook URL" placeholder="https://facebook.com/yourshop" value={profile.facebook} onChange={e => setProfile(p => ({ ...p, facebook: e.target.value }))} />
                <Input label="YouTube URL" placeholder="https://youtube.com/@yourshop" value={profile.youtube} onChange={e => setProfile(p => ({ ...p, youtube: e.target.value }))} />
                <Input label="Website URL" placeholder="https://yourshop.com" value={profile.website} onChange={e => setProfile(p => ({ ...p, website: e.target.value }))} />
              </div>
            </div>

            {/* Google Reviews */}
            <div>
              <p className="text-sm font-medium text-[#777] mb-1">Google Reviews</p>
              <p className="text-xs text-[#777] mb-3">Paste your Google Place ID to send clients a direct Google review link after their appointment. <a href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder" target="_blank" rel="noopener noreferrer" className="text-white hover:underline">Find your Place ID →</a></p>
              <Input label="Google Place ID" placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4" value={profile.google_place_id} onChange={e => setProfile(p => ({ ...p, google_place_id: e.target.value }))} />
            </div>

            <Button onClick={saveProfile} disabled={saving}>{saving ? "Saving…" : "Save Profile"}</Button>
          </CardContent>
        </Card>
      )}

      {tab === "account" && (
        <Card className="max-w-2xl">
          <CardHeader><CardTitle>My Account</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="text-sm font-medium text-[#777] mb-2">Account email</p>
              <p className="text-xs text-[#777] mb-2">This is the email you use to sign in. It cannot be changed here — contact support if you need to update it.</p>
              <div className="bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-3 text-sm text-white font-mono">
                {user?.email ?? "—"}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-[#777] mb-2">Display name</p>
              <div className="bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-3 text-sm text-white">
                {authProfile?.name ?? "—"}
              </div>
            </div>

            <div className="pt-2 border-t border-[#1e1e1e] space-y-3">
              <div>
                <p className="text-sm font-medium text-[#777]">Change password</p>
                <p className="text-xs text-[#777] mt-0.5">Choose a new password (at least 8 characters).</p>
              </div>
              <Input
                label="New password"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="••••••••"
              />
              <Input
                label="Confirm new password"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
              />
              <Button onClick={changePassword} disabled={savingPassword || !newPassword || !confirmPassword}>
                {savingPassword ? "Updating…" : "Update password"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "booking" && (
        <div className="space-y-4 max-w-2xl">
        <Card>
          <CardHeader><CardTitle>Booking Settings</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Input label="Advance Booking Limit (days)" type="number" value={String(booking.advance_days)}
                onChange={e => setBooking(p => ({ ...p, advance_days: Number(e.target.value) }))} />
              <p className="text-xs text-[#777] mt-1">How far in advance clients can book</p>
            </div>
            <div>
              <Input label="Cancellation Notice Required (hours)" type="number" value={String(booking.cancellation_hours)}
                onChange={e => setBooking(p => ({ ...p, cancellation_hours: Number(e.target.value) }))} />
            </div>
            <div className="flex items-center justify-between p-4 bg-[#141414] rounded-xl border border-[#1e1e1e]">
              <div>
                <p className="text-sm font-medium text-white">Deposit Requirement</p>
                <p className="text-xs text-[#777]">Require deposit at booking</p>
              </div>
              <Toggle value={booking.deposit} onChange={() => setBooking(p => ({ ...p, deposit: !p.deposit }))} />
            </div>
            {booking.deposit && (
              <Input label="Deposit Amount ($)" type="number" value={String(booking.deposit_amount)}
                onChange={e => setBooking(p => ({ ...p, deposit_amount: Number(e.target.value) }))} />
            )}
            <div className="flex items-center justify-between p-4 bg-[#141414] rounded-xl border border-[#1e1e1e]">
              <div>
                <p className="text-sm font-medium text-white">No-Show Protection</p>
                <p className="text-xs text-[#777]">Auto-charge the card if a client doesn&apos;t show (≈2h after their time). Bookings within 7 days hold the card; further out, the card is saved on file and charged then.</p>
              </div>
              <Toggle value={booking.no_show_protection} onChange={() => setBooking(p => ({ ...p, no_show_protection: !p.no_show_protection }))} />
            </div>
            {booking.no_show_protection && (
              <div>
                <Input label="No-Show Fee ($) — 0 = full service price" type="number" value={String(booking.no_show_fee_amount ?? 0)}
                  onChange={e => setBooking(p => ({ ...p, no_show_fee_amount: Number(e.target.value) }))} />
                <p className="text-xs text-[#777] mt-1">Charged from the card held (or saved) at booking. Leave 0 to charge the full amount.</p>
              </div>
            )}
            <div className="flex items-center justify-between p-4 bg-[#141414] rounded-xl border border-[#1e1e1e]">
              <div>
                <p className="text-sm font-medium text-white">Auto-Confirm Bookings</p>
                <p className="text-xs text-[#777]">Automatically confirm new bookings</p>
              </div>
              <Toggle value={booking.auto_confirm} onChange={() => setBooking(p => ({ ...p, auto_confirm: !p.auto_confirm }))} />
            </div>

            {/* Pay-in-person — controls whether the customer booking page
                offers "Pay in person at the shop" alongside online payment.
                Lives in the Profile-level `allow_pay_in_person` column on
                shops (separate from booking_settings JSON), but rendered
                here so the owner finds it among the other payment-flow
                toggles. Saving still goes through `saveProfile`. */}
            <div className="flex items-center justify-between p-4 bg-[#141414] rounded-xl border border-[#1e1e1e]">
              <div className="pr-4">
                <p className="text-sm font-medium text-white">Allow pay-in-person</p>
                <p className="text-xs text-[#777]">Customers can choose to pay at the shop instead of online. Bookings made this way are marked Cash · Unpaid until you collect.</p>
              </div>
              <Toggle
                value={profile.allow_pay_in_person}
                onChange={() => setProfile(p => ({ ...p, allow_pay_in_person: !p.allow_pay_in_person }))}
              />
            </div>

            <Button disabled={saving} onClick={saveBooking}>
              {saving ? "Saving…" : "Save Settings"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
          <CardContent>
            <NotifSoundToggle />
          </CardContent>
        </Card>
        </div>
      )}

      {tab === "subscription" && (() => {
        const activePlanKey = effectivePlan(shop?.subscription_plan, shop?.subscription_status);
        const activePlan = PLAN_INFO.find(p => p.key === activePlanKey) ?? PLAN_INFO[0];
        const downgraded = shop?.subscription_plan && shop.subscription_plan !== "starter" && activePlanKey === "starter";
        return (
          <div className="space-y-4 max-w-3xl">
            <Card className="border-[#1e1e1e]">
              <CardHeader>
                <div>
                  <CardTitle>Current Plan</CardTitle>
                  <p className="text-sm text-[#777] mt-1">You are on the {activePlan.name} plan</p>
                  {downgraded && (
                    <p className="text-xs text-orange-400 mt-1">
                      Your {shop?.subscription_plan} subscription is {shop?.subscription_status ?? "inactive"} — features are temporarily limited to Starter.
                    </p>
                  )}
                </div>
                <Badge variant="gold">{activePlan.name}</Badge>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-4xl font-bold text-white">{activePlan.priceLabel}</span>
                  <span className="text-[#777]">{activePlan.priceSuffix}</span>
                </div>
                <div className="space-y-2 mb-4">
                  {activePlan.features.map(f => (
                    <div key={f} className="flex items-center gap-2 text-sm text-[#777]">
                      <span className="text-emerald-400">✓</span>{f}
                    </div>
                  ))}
                </div>
                <Button variant="outline" onClick={() => setShowUpgradeModal(true)}>
                  {activePlanKey === "premium" ? "View Plans" : "Upgrade Plan"}
                </Button>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {tab === "notifications" && (
        <div className="space-y-6 max-w-2xl">
          <div>
            <p className="text-sm text-[#777]">Customize the emails sent to your clients. Use <span className="text-white font-mono">{"{variable}"}</span> placeholders — they get replaced automatically.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {["{clientName}","{shopName}","{barberName}","{serviceName}","{date}","{time}"].map(v => (
                <span key={v} className="text-xs bg-black/5 border border-[#1e1e1e] text-white rounded-full px-2.5 py-1 font-mono">{v}</span>
              ))}
            </div>
          </div>
          {(Object.keys(DEFAULT_TEMPLATES) as TemplateKey[]).map(key => (
            <Card key={key}>
              <CardHeader>
                <CardTitle className="capitalize text-sm">
                  {key === "booking_confirmation" ? "Booking Confirmation" : key === "appointment_reminder" ? "Appointment Reminder" : "Appointment Cancelled"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#777]">Subject Line</label>
                  <input
                    value={templates[key].subject}
                    onChange={e => setTemplates(prev => ({ ...prev, [key]: { ...prev[key], subject: e.target.value } }))}
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-2 focus:ring-black/20"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#777]">Message Body</label>
                  <textarea
                    rows={5}
                    value={templates[key].body}
                    onChange={e => setTemplates(prev => ({ ...prev, [key]: { ...prev[key], body: e.target.value } }))}
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-2 focus:ring-black/20 resize-none font-mono"
                  />
                </div>
              </CardContent>
            </Card>
          ))}
          <Button loading={savingTemplates} onClick={saveTemplates}>Save Templates</Button>
        </div>
      )}

      {tab === "locations" && (
        <div className="space-y-4 max-w-2xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[#777]">{shops.length} location{shops.length !== 1 ? "s" : ""}</p>
            </div>
            <Button size="sm" onClick={() => setShowAddLocation(true)}>
              <Plus size={14} /> Add Location
            </Button>
          </div>
          <div className="space-y-3">
            {shops.map(s => (
              <Card key={s.id} className={cn("border", s.id === shop?.id && "border-gray-400")}>
                <CardContent>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-black/5 flex items-center justify-center flex-shrink-0">
                        <Building2 size={18} className="text-white" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-white">{s.name}</p>
                          {s.id === shop?.id && <span className="text-xs text-white border border-black rounded-full px-2 py-0.5">Active</span>}
                        </div>
                        <p className="text-xs text-[#777]">{s.city}{s.province ? `, ${s.province}` : ""}</p>
                        <p className="text-xs text-[#777] mt-0.5">/book/{s.slug}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={cn("text-xs px-2 py-0.5 rounded-full border capitalize",
                        s.status === "approved" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" :
                        s.status === "pending" ? "text-orange-400 border-orange-500/30 bg-orange-500/10" :
                        "text-red-400 border-red-500/30 bg-red-500/10"
                      )}>{s.status}</span>
                      {s.id !== shop?.id && s.status === "approved" && (
                        <Button size="sm" variant="outline" onClick={() => setActiveShop(s)}>Switch</Button>
                      )}
                      <a href={`/book/${s.slug}`} target="_blank" rel="noreferrer"
                        className="p-1.5 rounded-lg text-[#777] hover:text-white hover:bg-[#141414] transition-colors">
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {showAddLocation && (
            <>
              <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowAddLocation(false)} />
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-md space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-white">Add New Location</h2>
                    <button onClick={() => setShowAddLocation(false)} className="text-[#777] hover:text-white">✕</button>
                  </div>
                  <p className="text-sm text-[#777]">New locations go through our approval process (usually under 24 hours).</p>
                  <Input label="Shop Name" placeholder="Fresh Cutz — Downtown" value={newLocation.name} onChange={e => setNewLocation(p => ({ ...p, name: e.target.value }))} />
                  <Input label="Address" placeholder="123 Main St" value={newLocation.address} onChange={e => setNewLocation(p => ({ ...p, address: e.target.value }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="City" value={newLocation.city} onChange={e => setNewLocation(p => ({ ...p, city: e.target.value }))} />
                    <Input label="Province" placeholder="NB" value={newLocation.province} onChange={e => setNewLocation(p => ({ ...p, province: e.target.value }))} />
                  </div>
                  <Input label="Phone" value={newLocation.phone} onChange={e => setNewLocation(p => ({ ...p, phone: e.target.value }))} />
                  <Input label="Email" value={newLocation.email} onChange={e => setNewLocation(p => ({ ...p, email: e.target.value }))} />
                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" className="flex-1" onClick={() => setShowAddLocation(false)}>Cancel</Button>
                    <Button className="flex-1" loading={addingLocation} onClick={addLocation}>Add Location</Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "danger" && (
        <Card className="max-w-2xl border-red-500/30">
          <CardHeader><CardTitle className="text-red-400">Danger Zone</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {/* Deactivate (reversible) */}
            <div className="p-4 bg-red-500/10 rounded-xl border border-red-500/30 space-y-4">
              <div>
                <p className="text-sm font-semibold text-red-400">Deactivate Shop</p>
                <p className="text-xs text-[#777] mt-1">This will disable your booking page and pause all services. You can reactivate anytime.</p>
              </div>
              {!showDeactivateConfirm ? (
                <Button variant="danger" onClick={() => setShowDeactivateConfirm(true)}>Deactivate Shop</Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-[#777]">Type <span className="text-white font-mono bg-[#141414] px-1 rounded">{profile.name}</span> to confirm:</p>
                  <input value={deactivateInput} onChange={e => setDeactivateInput(e.target.value)}
                    placeholder="Shop name..."
                    className="w-full rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-2 focus:ring-red-500/30" />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setShowDeactivateConfirm(false); setDeactivateInput(""); }}>Cancel</Button>
                    <Button variant="danger" size="sm" disabled={deactivateInput !== profile.name}
                      onClick={async () => {
                        if (!shop) return;
                        const { error } = await supabase.from("shops").update({ is_active: false }).eq("id", shop.id);
                        setShowDeactivateConfirm(false);
                        setDeactivateInput("");
                        showToast(error ? "Failed to deactivate." : "Shop deactivated.");
                      }}>
                      Confirm Deactivate
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Permanent delete (irreversible) */}
            <div className="p-4 bg-red-500/15 rounded-xl border border-red-500/40 space-y-4">
              <div>
                <p className="text-sm font-semibold text-red-400">Delete Shop Permanently</p>
                <p className="text-xs text-[#777] mt-1">
                  Erases your shop and all its data — barbers, services, appointments, time-off, everything. This <span className="text-red-300 font-semibold">cannot be undone</span>. After deletion your email is freed up to be added as a barber on a different shop.
                </p>
              </div>
              {!showDeleteConfirm ? (
                <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>Delete Shop Forever</Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-[#777]">Type <span className="text-white font-mono bg-[#141414] px-1 rounded">DELETE</span> to confirm:</p>
                  <input value={deleteInput} onChange={e => setDeleteInput(e.target.value)}
                    placeholder="DELETE"
                    className="w-full rounded-xl border border-red-500/60 bg-red-500/10 px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-2 focus:ring-red-500/40" />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setShowDeleteConfirm(false); setDeleteInput(""); }}>Cancel</Button>
                    <Button variant="danger" size="sm" disabled={deleteInput !== "DELETE" || deletingShop} loading={deletingShop}
                      onClick={async () => {
                        if (!shop || !accessToken) return;
                        setDeletingShop(true);
                        const res = await fetch("/api/owner/delete-shop", {
                          method: "POST",
                          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                          body: JSON.stringify({ shop_id: shop.id, confirm: "DELETE" }),
                        });
                        setDeletingShop(false);
                        if (!res.ok) {
                          const j = await res.json().catch(() => ({}));
                          showToast(`Delete failed: ${j.error ?? res.statusText}`);
                          return;
                        }
                        // Sign out and bounce to home — the user no longer has a shop.
                        await supabase.auth.signOut();
                        window.location.href = "/";
                      }}>
                      Permanently Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {showUpgradeModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowUpgradeModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Choose a Plan</h2>
                <button onClick={() => setShowUpgradeModal(false)} className="text-[#777] hover:text-white">✕</button>
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                {(() => {
                  const activePlanKey = effectivePlan(shop?.subscription_plan, shop?.subscription_status);
                  return PLAN_INFO.map(plan => {
                    const isCurrent = plan.key === activePlanKey;
                    return (
                      <div key={plan.key} className={cn("p-4 rounded-xl border", isCurrent ? "border-black bg-black/5" : "border-[#1e1e1e]")}>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-bold text-white">{plan.name}</h3>
                          {isCurrent && <Badge variant="gold">Current</Badge>}
                        </div>
                        <p className="mb-3">
                          <span className="text-xl font-bold text-white">{plan.priceLabel}</span>
                          <span className="text-xs text-[#777] ml-1">{plan.priceSuffix}</span>
                        </p>
                        <div className="space-y-1 mb-4">
                          {plan.features.map(f => (
                            <p key={f} className="text-xs text-[#777] flex items-center gap-1"><span className="text-emerald-400">✓</span>{f}</p>
                          ))}
                        </div>
                        <Button variant={isCurrent ? "secondary" : "gold"} size="sm" className="w-full"
                          disabled={isCurrent}
                          onClick={async () => {
                            setShowUpgradeModal(false);
                            if (!accessToken) { showToast("Please sign in again"); return; }
                            if (plan.key === "starter") { showToast("To move to Starter, cancel your plan from Billing."); return; }
                            showToast("Opening secure checkout…");
                            try {
                              const res = await fetch("/api/stripe/checkout", {
                                method: "POST",
                                headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                                body: JSON.stringify({ plan: plan.key, upgrade: true }),
                              });
                              const data = await res.json();
                              if (data.url) window.location.href = data.url;
                              else showToast(data.error || "Could not start checkout");
                            } catch { showToast("Connection error. Please try again."); }
                          }}>
                          {isCurrent ? "Current Plan" : `Switch to ${plan.name}`}
                        </Button>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
