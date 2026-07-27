"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { Building2, Plus, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { effectivePlan, planHasFeature, getLocationLimit, MAX_LOCATIONS, NO_SHOW_MAX_PCT, NO_SHOW_DEFAULT_PCT, clampNoShowPct } from "@/lib/validation";
import { CANADA_TIMEZONES, DEFAULT_TZ } from "@/lib/timezone";
import { taxPresetFor, clampTaxRate, isValidGstNumber } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { NotifSoundToggle } from "@/components/notif-sound-toggle";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <span className="text-foreground">✓</span>{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
    </div>
  );
}

type BookingSettings = {
  advance_days: number;
  cancellation_hours: number;
  no_show_protection: boolean;
  no_show_fee_percent: number; // % of the booked total to charge a no-show (0–80)
  auto_confirm: boolean;
  slot_interval_minutes: number; // booking-window granularity: 15 or 30
  tips_enabled: boolean;          // offer a tip picker at online payment
  tax_enabled: boolean;           // add sales tax to charges
  tax_rate: number;               // percent, e.g. 15 for NB HST
  tax_label: string;              // "HST" / "GST" / "GST+QST"
  tax_number: string;             // business tax/GST number for receipts (optional)
};

const DEFAULT_BOOKING: BookingSettings = {
  advance_days: 15, cancellation_hours: 24,
  no_show_protection: true, no_show_fee_percent: NO_SHOW_DEFAULT_PCT, auto_confirm: false,
  slot_interval_minutes: 30,
  tips_enabled: true, tax_enabled: false, tax_rate: 0, tax_label: "HST", tax_number: "",
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
    key: "premium", name: "Premium", priceLabel: "$79", priceSuffix: "/month",
    features: ["Up to 9 barbers", "2 locations included — add more for $30/mo each (up to 5)", "Everything in Pro", "Full POS via Stripe Terminal", "Inventory management", "Staff management", "Full analytics & reports", "Dedicated support"],
  },
];

type NewLocation = { name: string; address: string; city: string; province: string; phone: string };
const BLANK_LOCATION: NewLocation = { name: "", address: "", city: "", province: "", phone: "" };

export default function SettingsPage() {
  const { user, shop, shops, setActiveShop, profile: authProfile, refreshShop, accessToken } = useAuth();
  const [tab, setTab] = useState("profile");

  // Free (Starter) shops can't charge online, so pay-in-person is their ONLY
  // possible payment method — the toggle is locked ON for them (turning it off
  // would leave customers with no way to pay, bricking the booking page).
  const isFreePlan = effectivePlan(shop?.subscription_plan, shop?.subscription_status) === "starter";
  // Multiple locations are a Premium+ feature — Pro/Starter can't add them.
  const canMultiLocation = planHasFeature(effectivePlan(shop?.subscription_plan, shop?.subscription_status), "multi_location");
  // Locations INCLUDED in the plan (Premium = 2); beyond that each is a $30/mo
  // add-on, up to the hard MAX_LOCATIONS ceiling.
  const locationLimit = getLocationLimit(effectivePlan(shop?.subscription_plan, shop?.subscription_status));
  const atLocationLimit = canMultiLocation && shops.length >= MAX_LOCATIONS;
  const willCostAddon = canMultiLocation && shops.length >= locationLimit;

  // Account/password state
  const [currentPassword, setCurrentPassword] = useState("");
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
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deleteAccountInput, setDeleteAccountInput] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocation, setNewLocation] = useState<NewLocation>(BLANK_LOCATION);
  const [addingLocation, setAddingLocation] = useState(false);
  const [confirmingAddon, setConfirmingAddon] = useState(false);

  const [profile, setProfile] = useState({
    name: "", address: "", city: "", province: "", postal_code: "",
    phone: "", email: "", description: "",
    instagram: "", tiktok: "", facebook: "", youtube: "", website: "",
    google_place_id: "",
    allow_pay_in_person: true,
    timezone: DEFAULT_TZ,
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

  // Account photo (users.avatar) — the owner's personal avatar shown in the
  // portal corner on EVERY shop they own, independent of any barber record.
  const uploadAvatar = async (file: File) => {
    setAvatarUploading(true);
    setAvatarPreview(URL.createObjectURL(file));
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload-avatar", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken ?? ""}` },
        body: form,
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? "Upload failed"); }
      const { url } = await res.json() as { url: string };
      setAvatarPreview(url);
      await refreshShop(); // refreshes profile too → corner avatar updates everywhere
      showToast("Photo updated!");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Upload failed");
      setAvatarPreview(authProfile?.avatar ?? null);
    } finally {
      setAvatarUploading(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarUploading(true);
    try {
      const res = await fetch("/api/upload-avatar", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken ?? ""}` },
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? "Remove failed"); }
      setAvatarPreview(null);
      await refreshShop();
      showToast("Photo removed");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setAvatarUploading(false);
    }
  };

  const removeLogo = async () => {
    if (!shop) return;
    setLogoUploading(true);
    try {
      const res = await fetch(`/api/upload-logo?shopId=${encodeURIComponent(shop.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken ?? ""}` },
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? "Remove failed"); }
      setLogoPreview(null);
      await refreshShop();
      showToast("Logo removed");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setLogoUploading(false);
    }
  };

  useEffect(() => {
    if (shop?.logo) setLogoPreview(shop.logo);
  }, [shop?.logo]);

  useEffect(() => { if (authProfile?.avatar) setAvatarPreview(authProfile.avatar); }, [authProfile?.avatar]);

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
      timezone: shop.timezone ?? DEFAULT_TZ,
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
            // Merge over defaults so newly-added fields (e.g. slot_interval_minutes)
            // always have a value even for shops saved before they existed.
            setBooking({ ...DEFAULT_BOOKING, ...(row.booking_settings as Partial<BookingSettings>) });
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
      allow_pay_in_person: isFreePlan ? true : profile.allow_pay_in_person,
      timezone: profile.timezone || DEFAULT_TZ,
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
      allow_pay_in_person: isFreePlan ? true : profile.allow_pay_in_person,
    }).eq("id", shop.id);
    if (error) {
      // Surface the real failure — silently "saving locally" hid settings (like
      // Auto-Confirm) never reaching the DB, so the booking page never saw them.
      showToast(`Couldn't save settings: ${error.message}`);
      setSaving(false);
      return;
    }
    // The GST/HST number is ONE number for all the owner's shops, so propagate it
    // to every location (not just the active shop). The route validates the format.
    const gst = (booking.tax_number ?? "").trim();
    if (gst && !isValidGstNumber(gst)) {
      showToast("Settings saved, but the GST/HST number looks invalid — tax won't be charged until it's fixed.");
      setSaving(false);
      return;
    }
    const res = await fetch("/api/tax/registration", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken ?? ""}` },
      body: JSON.stringify({ gst_number: gst }),
    }).catch(() => null);
    showToast(res?.ok ? "Booking settings saved!" : "Settings saved (couldn't sync the GST number across locations).");
    setSaving(false);
  };

  const addLocation = async () => {
    if (!newLocation.name.trim() || !accessToken) return;
    if (!canMultiLocation) { showToast("Multiple locations are available on the Premium plan."); setShowAddLocation(false); return; }
    // A paid add-on (beyond the included 2) needs explicit agreement to the
    // $30/mo charge — pop a confirmation before we bill anything.
    if (willCostAddon && !confirmingAddon) { setConfirmingAddon(true); return; }
    setAddingLocation(true);
    // Trusted server route: auto-approves for a paying owner, reuses the owner's
    // email, shares the one subscription (no second charge), and leaves Stripe
    // Connect empty so the new location gets its own account.
    const res = await fetch("/api/shops/add-location", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        name: newLocation.name.trim(),
        address: newLocation.address,
        city: newLocation.city,
        province: newLocation.province,
        phone: newLocation.phone,
        agree_addon: confirmingAddon, // true only after the $30/mo popup was agreed
      }),
    });
    const data = await res.json().catch(() => ({}));
    setAddingLocation(false);
    if (!res.ok) {
      // Server says this is a paid add-on that wasn't agreed to → show the popup.
      if (data.needsConfirm) { setConfirmingAddon(true); return; }
      showToast(data.error ?? "Failed to add location."); return;
    }
    showToast(willCostAddon ? "Location added — $30/mo added to your subscription." : "Location added! Connect its Stripe next to take payments.");
    setConfirmingAddon(false);
    setShowAddLocation(false);
    setNewLocation(BLANK_LOCATION);
    await refreshShop();
    if (data.shop) setActiveShop(data.shop); // jump straight into the new location
  };

  const TABS = ["profile","account","booking","notifications","subscription","locations","danger"];

  const changePassword = async () => {
    if (!currentPassword) { setToast("Enter your current password."); return; }
    if (newPassword.length < 8) { setToast("Password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setToast("Passwords do not match."); return; }
    if (!user?.email) { setToast("Couldn't verify your account. Please sign in again."); return; }
    setSavingPassword(true);
    // Re-authenticate first — Supabase updateUser() doesn't require the current
    // password, so verifying it stops a borrowed/hijacked session from silently
    // changing the password and locking the owner out.
    const { error: reauthErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (reauthErr) { setSavingPassword(false); setToast("Current password is incorrect."); return; }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) { setToast("Couldn't update password. Please try again."); return; }
    setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    setToast("Password updated.");
  };

  // The shared Bootstrap form-switch wraps all of these; this local alias
  // keeps the existing call signature (`<Toggle value={..} onChange={..} />`).
  const Toggle = ({ value, onChange, disabled }: { value: boolean; onChange: () => void; disabled?: boolean }) => (
    <Switch checked={value} onChange={onChange} disabled={disabled} />
  );

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div>
        <h1 className="text-2xl font-bold text-foreground uppercase tracking-wide">Settings</h1>
        <p className="text-sm text-grey mt-0.5">Manage your shop preferences</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border flex-wrap">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors",
              tab === t ? "border-black text-foreground" : "border-transparent text-grey hover:text-foreground",
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
              <p className="text-sm font-medium text-grey mb-2">Shop Logo</p>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-2xl bg-card-raised border-2 border-dashed border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                  {logoPreview
                    ? <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
                    : <span className="text-3xl">💈</span>}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <label className={cn("cursor-pointer", logoUploading && "pointer-events-none opacity-60")}>
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border text-sm text-foreground hover:bg-card-raised transition-colors">
                        {logoUploading ? "Uploading…" : logoPreview ? "Change Logo" : "Upload Logo"}
                      </div>
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
                    </label>
                    {logoPreview && !logoUploading && (
                      <button type="button" onClick={removeLogo}
                        className="inline-flex items-center px-3 py-1.5 rounded-xl border border-red-500/30 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                        Remove
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-grey mt-1">PNG, JPG, WebP up to 5MB</p>
                </div>
              </div>
            </div>
            <Input label="Shop Name" value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />
            <Input label="Address" value={profile.address} onChange={e => setProfile(p => ({ ...p, address: e.target.value }))} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="col-span-2"><Input label="City" value={profile.city} onChange={e => setProfile(p => ({ ...p, city: e.target.value }))} /></div>
              <Input label="Province" value={profile.province} onChange={e => setProfile(p => ({ ...p, province: e.target.value }))} />
            </div>
            <Input label="Postal Code" value={profile.postal_code} onChange={e => setProfile(p => ({ ...p, postal_code: e.target.value }))} />
            <div>
              <label className="text-sm font-medium text-gray-300">Timezone</label>
              <select
                value={profile.timezone}
                onChange={e => setProfile(p => ({ ...p, timezone: e.target.value }))}
                className="mt-1.5 w-full bg-surface-raised border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-gold/50"
              >
                {CANADA_TIMEZONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <p className="text-[11px] text-grey mt-1">Used for booking times, reminders, and same-day availability.</p>
            </div>
            <Input label="Phone" value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} />
            <Input label="Email" value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} />
            <Textarea label="Description" value={profile.description} onChange={e => setProfile(p => ({ ...p, description: e.target.value }))} rows={3} />

            {/* Social Media */}
            <div>
              <p className="text-sm font-medium text-grey mb-3">Social Media & Website</p>
              <div className="space-y-3">
                <Input label="Instagram" placeholder="yourshop  (handle or profile link)" value={profile.instagram} onChange={e => setProfile(p => ({ ...p, instagram: e.target.value }))} />
                <Input label="TikTok URL" placeholder="https://tiktok.com/@yourshop" value={profile.tiktok} onChange={e => setProfile(p => ({ ...p, tiktok: e.target.value }))} />
                <Input label="Website URL" placeholder="https://yourshop.com" value={profile.website} onChange={e => setProfile(p => ({ ...p, website: e.target.value }))} />
              </div>
            </div>

            {/* Google Reviews */}
            <div>
              <p className="text-sm font-medium text-grey mb-1">Google Reviews</p>
              <p className="text-xs text-grey mb-3">Paste your Google Place ID to send clients a direct Google review link after their appointment. <a href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder" target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">Find your Place ID →</a></p>
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
            {/* Your account photo — the avatar shown in the portal corner on EVERY
                shop you own, separate from any barber record. */}
            <div>
              <p className="text-sm font-medium text-grey mb-2">Your Photo</p>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-card-raised border-2 border-dashed border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                  {avatarPreview
                    ? <img src={avatarPreview} alt="Your photo" className="w-full h-full object-cover" />
                    : <span className="text-2xl text-grey">{(authProfile?.name ?? "?").charAt(0).toUpperCase()}</span>}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <label className={cn("cursor-pointer", avatarUploading && "pointer-events-none opacity-60")}>
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border text-sm text-foreground hover:bg-card-raised transition-colors">
                        {avatarUploading ? "Uploading…" : avatarPreview ? "Change Photo" : "Upload Photo"}
                      </div>
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); }} />
                    </label>
                    {avatarPreview && !avatarUploading && (
                      <button type="button" onClick={removeAvatar}
                        className="inline-flex items-center px-3 py-1.5 rounded-xl border border-red-500/30 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                        Remove
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-grey mt-1">Shows as your avatar on every shop you own. PNG, JPG, WebP up to 5MB.</p>
                </div>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-grey mb-2">Account email</p>
              <p className="text-xs text-grey mb-2">This is the email you use to sign in. It cannot be changed here — contact support if you need to update it.</p>
              <div className="bg-card-raised border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono">
                {user?.email ?? "—"}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-grey mb-2">Display name</p>
              <div className="bg-card-raised border border-border rounded-xl px-4 py-3 text-sm text-foreground">
                {authProfile?.name ?? "—"}
              </div>
            </div>

            <div className="pt-2 border-t border-border space-y-3">
              <div>
                <p className="text-sm font-medium text-grey">Change password</p>
                <p className="text-xs text-grey mt-0.5">Choose a new password (at least 8 characters).</p>
              </div>
              <Input
                label="Current password"
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
              />
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
              <Button onClick={changePassword} disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}>
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
              <Input label="Advance Booking Limit (days)" type="number" min={1} max={60} value={String(booking.advance_days)}
                onChange={e => setBooking(p => ({ ...p, advance_days: Math.min(60, Math.max(1, Number(e.target.value) || 1)) }))} />
              <p className="text-xs text-grey mt-1">How far in advance clients can book (max 60 days)</p>
            </div>
            <div>
              <Input label="Cancellation Notice Required (hours)" type="number" value={String(booking.cancellation_hours)}
                onChange={e => setBooking(p => ({ ...p, cancellation_hours: Number(e.target.value) }))} />
            </div>
            <div className="flex items-center justify-between p-4 bg-card-raised rounded-xl border border-border">
              <div>
                <p className="text-sm font-medium text-foreground">No-Show Protection</p>
                <p className="text-xs text-grey">Hold (or save, for bookings 7+ days out) the client&apos;s card at booking. If they don&apos;t show, you or the barber charge the no-show fee — it&apos;s never charged automatically.</p>
              </div>
              <Toggle value={booking.no_show_protection} onChange={() => setBooking(p => ({ ...p, no_show_protection: !p.no_show_protection }))} />
            </div>
            {booking.no_show_protection && (
              <div>
                <Input label={`No-Show Fee (% of the booking · max ${NO_SHOW_MAX_PCT}%)`} type="number" min={0} max={NO_SHOW_MAX_PCT}
                  value={String(booking.no_show_fee_percent ?? NO_SHOW_DEFAULT_PCT)}
                  onChange={e => setBooking(p => ({ ...p, no_show_fee_percent: clampNoShowPct(Number(e.target.value)) }))} />
                <p className="text-xs text-grey mt-1">Charged from the card held (or saved) at booking. Capped at {NO_SHOW_MAX_PCT}% — to collect the full price, complete the appointment instead.</p>
              </div>
            )}
            <div className={cn(
              "flex items-center justify-between p-4 bg-card-raised rounded-xl border border-border",
              !(isFreePlan || profile.allow_pay_in_person) && "opacity-50"
            )}>
              <div className="pr-4">
                <p className="text-sm font-medium text-foreground">Auto-Confirm In-Person Bookings</p>
                <p className="text-xs text-grey">
                  {(isFreePlan || profile.allow_pay_in_person)
                    ? "When on, pay-in-person bookings are confirmed automatically — no manual approval needed. Online (prepaid) bookings always confirm on payment."
                    : "Only applies when “Allow pay-in-person” is on. Online bookings already confirm automatically when paid."}
                </p>
              </div>
              <Toggle
                value={(isFreePlan || profile.allow_pay_in_person) && booking.auto_confirm}
                disabled={!(isFreePlan || profile.allow_pay_in_person)}
                onChange={() => setBooking(p => ({ ...p, auto_confirm: !p.auto_confirm }))} />
            </div>

            {/* Pay-in-person — controls whether the customer booking page
                offers "Pay in person at the shop" alongside online payment.
                Lives in the Profile-level `allow_pay_in_person` column on
                shops (separate from booking_settings JSON), but rendered
                here so the owner finds it among the other payment-flow
                toggles. Saving still goes through `saveProfile`. */}
            <div className="flex items-center justify-between p-4 bg-card-raised rounded-xl border border-border">
              <div className="pr-4">
                <p className="text-sm font-medium text-foreground">Allow pay-in-person</p>
                <p className="text-xs text-grey">Customers can choose to pay at the shop instead of online. Bookings made this way are marked Cash · Unpaid until you collect.</p>
                {isFreePlan && (
                  <p className="text-xs text-gold mt-1">
                    On the free plan this is your only payment method, so it stays on. Upgrade to Pro to accept online payments and require prepayment.
                  </p>
                )}
              </div>
              <Toggle
                value={isFreePlan ? true : profile.allow_pay_in_person}
                disabled={isFreePlan}
                onChange={() => setProfile(p => ({ ...p, allow_pay_in_person: !p.allow_pay_in_person }))}
              />
            </div>

            {/* ── Tips ─────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between p-4 bg-card-raised rounded-xl border border-border">
              <div className="pr-4">
                <p className="text-sm font-medium text-foreground">Accept tips online</p>
                <p className="text-xs text-grey">Show a tip picker when a customer pays online, and let you send a tip link after a visit. Tips go straight to your Stripe account.</p>
              </div>
              <Toggle value={booking.tips_enabled} onChange={() => setBooking(p => ({ ...p, tips_enabled: !p.tips_enabled }))} />
            </div>

            {/* ── Sales tax ────────────────────────────────────────────── */}
            <div className="p-4 bg-card-raised rounded-xl border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div className="pr-4">
                  <p className="text-sm font-medium text-foreground">Charge GST/HST</p>
                  <p className="text-xs text-grey">Turn on only if you&rsquo;re registered to collect GST/HST. Add your number below — tax won&rsquo;t be charged without it.</p>
                </div>
                <Toggle value={booking.tax_enabled} onChange={() => setBooking(p => ({ ...p, tax_enabled: !p.tax_enabled }))} />
              </div>

              {booking.tax_enabled && (
                <div className="space-y-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      const preset = taxPresetFor(profile.province);
                      if (preset) setBooking(p => ({ ...p, tax_rate: preset.rate, tax_label: preset.label }));
                      else showToast("Set your province in the Profile tab first, then tap this again.");
                    }}
                    className="text-xs text-gold hover:underline"
                  >
                    Use my province&rsquo;s rate{profile.province ? ` (${profile.province})` : ""} →
                  </button>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-grey font-medium uppercase tracking-wide">Tax rate (%)</label>
                      <input type="number" min={0} max={30} step="0.001" value={String(booking.tax_rate)}
                        onChange={e => setBooking(p => ({ ...p, tax_rate: clampTaxRate(Number(e.target.value)) }))}
                        className="mt-1.5 w-full bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold/50" />
                    </div>
                    <div>
                      <label className="text-xs text-grey font-medium uppercase tracking-wide">Label</label>
                      <input value={booking.tax_label}
                        onChange={e => setBooking(p => ({ ...p, tax_label: e.target.value.slice(0, 12) }))}
                        placeholder="HST"
                        className="mt-1.5 w-full bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-gold/50" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-grey font-medium uppercase tracking-wide">GST/HST number</label>
                    <input value={booking.tax_number}
                      onChange={e => setBooking(p => ({ ...p, tax_number: e.target.value.slice(0, 40) }))}
                      placeholder="123456789RT0001"
                      className="mt-1.5 w-full bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-gold/50" />
                    {(booking.tax_number ?? "").trim() && !isValidGstNumber(booking.tax_number) ? (
                      <p className="text-[11px] text-red-400 mt-1">That doesn&rsquo;t look like a valid GST/HST number (e.g. 123456789RT0001).</p>
                    ) : (
                      <p className="text-[11px] text-grey mt-1">
                        Required to charge tax — you can only collect GST/HST if you&rsquo;re registered.
                        This number is <span className="text-foreground">shared across all your locations</span> and printed on receipts.
                      </p>
                    )}
                  </div>
                  <p className="text-[11px] text-grey">Tax applies to the service amount (after any discount). Tips are never taxed. You&rsquo;re responsible for your own tax registration &amp; remittance — verify PST/QST applicability for your province &amp; services.</p>
                </div>
              )}
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
            <Card className="border-border">
              <CardHeader>
                <div>
                  <CardTitle>Current Plan</CardTitle>
                  <p className="text-sm text-grey mt-1">You are on the {activePlan.name} plan</p>
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
                  <span className="text-4xl font-bold text-foreground">{activePlan.priceLabel}</span>
                  <span className="text-grey">{activePlan.priceSuffix}</span>
                </div>
                <div className="space-y-2 mb-4">
                  {activePlan.features.map(f => (
                    <div key={f} className="flex items-center gap-2 text-sm text-grey">
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
            <p className="text-sm text-grey">Customize the emails sent to your clients. Use <span className="text-foreground font-mono">{"{variable}"}</span> placeholders — they get replaced automatically.</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {["{clientName}","{shopName}","{barberName}","{serviceName}","{date}","{time}"].map(v => (
                <span key={v} className="text-xs bg-black/5 border border-border text-foreground rounded-full px-2.5 py-1 font-mono">{v}</span>
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
                  <label className="text-xs font-medium text-grey">Subject Line</label>
                  <input
                    value={templates[key].subject}
                    onChange={e => setTemplates(prev => ({ ...prev, [key]: { ...prev[key], subject: e.target.value } }))}
                    className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:ring-2 focus:ring-black/20"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-grey">Message Body</label>
                  <textarea
                    rows={5}
                    value={templates[key].body}
                    onChange={e => setTemplates(prev => ({ ...prev, [key]: { ...prev[key], body: e.target.value } }))}
                    className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:ring-2 focus:ring-black/20 resize-none font-mono"
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
              <p className="text-sm text-grey">
                {shops.length}{canMultiLocation ? ` of ${MAX_LOCATIONS}` : ""} location{shops.length !== 1 ? "s" : ""}
              </p>
            </div>
            {!canMultiLocation ? (
              <Button size="sm" variant="outline" onClick={() => setTab("subscription")}>
                <Plus size={14} /> Add Location · Premium
              </Button>
            ) : atLocationLimit ? (
              <Button size="sm" variant="outline" onClick={() => showToast(`You've reached the maximum of ${MAX_LOCATIONS} locations.`)}>
                <Plus size={14} /> {MAX_LOCATIONS} of {MAX_LOCATIONS} used
              </Button>
            ) : (
              <Button size="sm" onClick={() => setShowAddLocation(true)}>
                <Plus size={14} /> Add Location
              </Button>
            )}
          </div>
          <div className="space-y-3">
            {shops.map(s => (
              <Card key={s.id} className={cn("border", s.id === shop?.id && "border-gray-400")}>
                <CardContent>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-black/5 flex items-center justify-center flex-shrink-0">
                        <Building2 size={18} className="text-foreground" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{s.name}</p>
                          {s.id === shop?.id && <span className="text-xs text-foreground border border-black rounded-full px-2 py-0.5">Active</span>}
                        </div>
                        <p className="text-xs text-grey">{s.city}{s.province ? `, ${s.province}` : ""}</p>
                        <p className="text-xs text-grey mt-0.5">/book/{s.slug}</p>
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
                        className="p-1.5 rounded-lg text-grey hover:text-foreground hover:bg-card-raised transition-colors">
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
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
                <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-foreground">Add New Location</h2>
                    <button onClick={() => setShowAddLocation(false)} className="text-grey hover:text-foreground">✕</button>
                  </div>
                  <p className="text-sm text-grey">
                    {willCostAddon
                      ? "This location is a $30/mo add-on on your subscription (prorated on your next invoice). "
                      : "This location is included on your current plan — no extra charge. "}
                    It uses your account email, and you&apos;ll connect its own Stripe (same bank is fine) so its payments stay separate.
                  </p>
                  <Input label="Shop Name" placeholder="Fresh Cutz — Downtown" value={newLocation.name} onChange={e => setNewLocation(p => ({ ...p, name: e.target.value }))} />
                  <Input label="Address" placeholder="123 Main St" value={newLocation.address} onChange={e => setNewLocation(p => ({ ...p, address: e.target.value }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="City" value={newLocation.city} onChange={e => setNewLocation(p => ({ ...p, city: e.target.value }))} />
                    <Input label="Province" placeholder="NB" value={newLocation.province} onChange={e => setNewLocation(p => ({ ...p, province: e.target.value }))} />
                  </div>
                  <Input label="Phone" value={newLocation.phone} onChange={e => setNewLocation(p => ({ ...p, phone: e.target.value }))} />
                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" className="flex-1" onClick={() => setShowAddLocation(false)}>Cancel</Button>
                    <Button className="flex-1" loading={addingLocation} onClick={addLocation}>{willCostAddon ? "Continue" : "Add Location"}</Button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Paid add-on: explicit agreement to the $30/mo charge before billing */}
          {confirmingAddon && (
            <>
              <div className="fixed inset-0 bg-black/75 z-[60]" onClick={() => setConfirmingAddon(false)} />
              <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
                <div className="bg-card border border-amber-500/40 rounded-2xl p-6 w-full max-w-sm space-y-4">
                  <h2 className="text-lg font-bold text-foreground">Add a paid location?</h2>
                  <p className="text-sm text-grey">
                    Adding <span className="text-foreground font-medium">{newLocation.name.trim() || "this location"}</span> will add{" "}
                    <span className="text-foreground font-semibold">$30/month</span> to your subscription, prorated on your next invoice.
                    This will be location {shops.length + 1} of {MAX_LOCATIONS}. You can remove it anytime to stop the charge.
                  </p>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => setConfirmingAddon(false)}>Cancel</Button>
                    <Button className="flex-1" loading={addingLocation} onClick={addLocation}>Agree &amp; add · $30/mo</Button>
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
                <p className="text-xs text-grey mt-1">This will disable your booking page and pause all services. You can reactivate anytime.</p>
              </div>
              {!showDeactivateConfirm ? (
                <Button variant="danger" onClick={() => setShowDeactivateConfirm(true)}>Deactivate Shop</Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-grey">Type <span className="text-foreground font-mono bg-card-raised px-1 rounded">{profile.name}</span> to confirm:</p>
                  <input value={deactivateInput} onChange={e => setDeactivateInput(e.target.value)}
                    placeholder="Shop name..."
                    className="w-full rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:ring-2 focus:ring-red-500/30" />
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
                <p className="text-xs text-grey mt-1">
                  Erases your shop and all its data — barbers, services, appointments, time-off, everything. This <span className="text-red-300 font-semibold">cannot be undone</span>. After deletion your email is freed up to be added as a barber on a different shop.
                </p>
              </div>
              {!showDeleteConfirm ? (
                <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>Delete Shop Forever</Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-grey">Type <span className="text-foreground font-mono bg-card-raised px-1 rounded">DELETE</span> to confirm:</p>
                  <input value={deleteInput} onChange={e => setDeleteInput(e.target.value)}
                    placeholder="DELETE"
                    className="w-full rounded-xl border border-red-500/60 bg-red-500/10 px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:ring-2 focus:ring-red-500/40" />
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

            {/* Delete the entire account + all data (privacy / right-to-erasure) */}
            <div className="p-4 bg-red-500/15 rounded-xl border border-red-500/40 space-y-4">
              <div>
                <p className="text-sm font-semibold text-red-400">Delete My Account &amp; All Data</p>
                <p className="text-xs text-grey mt-1">
                  Permanently erases your account and <span className="text-red-300 font-semibold">every</span> shop you own — all barbers, services, appointments, clients, and payment history — and cancels your subscription. This <span className="text-red-300 font-semibold">cannot be undone</span>.
                </p>
              </div>
              {!showDeleteAccountConfirm ? (
                <Button variant="danger" onClick={() => setShowDeleteAccountConfirm(true)}>Delete My Account</Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-grey">Type <span className="text-foreground font-mono bg-card-raised px-1 rounded">DELETE</span> to confirm:</p>
                  <input value={deleteAccountInput} onChange={e => setDeleteAccountInput(e.target.value)}
                    placeholder="DELETE"
                    className="w-full rounded-xl border border-red-500/60 bg-red-500/10 px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:ring-2 focus:ring-red-500/40" />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setShowDeleteAccountConfirm(false); setDeleteAccountInput(""); }}>Cancel</Button>
                    <Button variant="danger" size="sm" disabled={deleteAccountInput !== "DELETE" || deletingAccount} loading={deletingAccount}
                      onClick={async () => {
                        if (!accessToken) return;
                        setDeletingAccount(true);
                        const res = await fetch("/api/account/delete", {
                          method: "POST",
                          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                          body: JSON.stringify({ confirm: "DELETE" }),
                        });
                        setDeletingAccount(false);
                        if (!res.ok) {
                          const j = await res.json().catch(() => ({}));
                          showToast(`Delete failed: ${j.error ?? res.statusText}`);
                          return;
                        }
                        // Account gone — sign out and bounce home.
                        await supabase.auth.signOut();
                        window.location.href = "/";
                      }}>
                      Permanently Delete Account
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Choose a Plan</h2>
                <button onClick={() => setShowUpgradeModal(false)} className="text-grey hover:text-foreground">✕</button>
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                {(() => {
                  const activePlanKey = effectivePlan(shop?.subscription_plan, shop?.subscription_status);
                  return PLAN_INFO.map(plan => {
                    const isCurrent = plan.key === activePlanKey;
                    return (
                      <div key={plan.key} className={cn("p-4 rounded-xl border", isCurrent ? "border-black bg-black/5" : "border-border")}>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-bold text-foreground">{plan.name}</h3>
                          {isCurrent && <Badge variant="gold">Current</Badge>}
                        </div>
                        <p className="mb-3">
                          <span className="text-xl font-bold text-foreground">{plan.priceLabel}</span>
                          <span className="text-xs text-grey ml-1">{plan.priceSuffix}</span>
                        </p>
                        <div className="space-y-1 mb-4">
                          {plan.features.map(f => (
                            <p key={f} className="text-xs text-grey flex items-center gap-1"><span className="text-emerald-400">✓</span>{f}</p>
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
