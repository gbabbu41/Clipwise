"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, ChevronLeft, Plus, Trash2, Copy, ExternalLink, AlertCircle, User, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { generate24hSlots, cn } from "@/lib/utils";
import { validateEmail, getPlanLimit } from "@/lib/validation";

const STEPS = ["Shop Details", "Logo", "Barbers", "Hours", "Services", "Done!"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TIME_SLOTS = generate24hSlots();
const SERVICE_CATEGORIES = ["Hair", "Beard", "Packages", "Kids"];

type ServiceRow = { name: string; price: string; duration: string; category: string };
type DayHours = { open: boolean; start: string; end: string };

export default function OnboardingPage() {
  const router = useRouter();
  const { user, profile, accessToken, refreshShop } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");

  // Only shop owners belong in the setup wizard. A barber or customer who lands
  // here (a stale link, or a role-mismatched redirect) is sent to their own home
  // instead of seeing the owner-only shop-creation flow.
  useEffect(() => {
    if (profile && profile.role !== "shop_owner") {
      router.replace(
        profile.role === "barber" ? "/barber-dashboard"
        : profile.role === "super_admin" ? "/admin"
        : "/",
      );
    }
  }, [profile, router]);

  const confetti = Array.from({ length: 40 }, (_, i) => ({
    left: `${(i * 2.5) % 100}%`,
    delay: `${(i * 0.05) % 2}s`,
    color: ["#F5F0E6", "#F9FAFB", "#10B981", "#3B82F6", "#A855F7", "#EF4444"][i % 6],
    size: `${6 + (i % 6)}px`,
    duration: `${1.5 + (i % 10) * 0.1}s`,
  }));

  const [shop, setShop] = useState({ name: "", address: "", city: "", province: "NB", postal_code: "", phone: "", description: "" });
  const [createdShopId, setCreatedShopId] = useState("");
  const [createdShopSlug, setCreatedShopSlug] = useState("");
  const [logoPreview, setLogoPreview] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  // Step 2 — "add barbers" (reuses /api/admin/barber/invite for both self + invites)
  const [createdBarberIds, setCreatedBarberIds] = useState<string[]>([]);
  const [addedBarbers, setAddedBarbers] = useState<{ id: string; name: string; email: string; self: boolean }[]>([]);
  const [showAddOther, setShowAddOther] = useState(false);
  const [otherBarber, setOtherBarber] = useState({ name: "", email: "", commission: "" });
  const [addingBarber, setAddingBarber] = useState(false);
  const [barberError, setBarberError] = useState("");
  const [chosenPlan, setChosenPlan] = useState("starter");
  const [services, setServices] = useState<ServiceRow[]>([
    { name: "Haircut", price: "30", duration: "30", category: "Hair" },
    { name: "Skin Fade", price: "35", duration: "45", category: "Hair" },
    { name: "Beard Trim", price: "20", duration: "20", category: "Beard" },
  ]);
  const [hours, setHours] = useState<DayHours[]>(
    DAYS.map((_, i) => ({
      open: i >= 1 && i <= 6,
      start: "9:00 AM",
      end: i <= 5 ? "7:00 PM" : "5:00 PM",
    }))
  );

  // Remember the chosen plan (for the barber-limit) from the plan step.
  useEffect(() => {
    try {
      const p = JSON.parse(sessionStorage.getItem("clipwise_plan") || "{}");
      if (p.plan) setChosenPlan(p.plan);
    } catch { /* ignore */ }
  }, []);

  // If the user reopens onboarding mid-flow (browser refresh / session blip), restore
  // any state we can from the DB so the rest of the flow doesn't silently drop data.
  useEffect(() => {
    if (!user) return;
    if (createdShopId) return; // already loaded
    (async () => {
      // .limit(1)+[0] (not .maybeSingle) — a returning multi-location owner has
      // 2+ shops, and .maybeSingle() throws on multiple rows.
      const { data: existingShops } = await supabase
        .from("shops").select("id, slug").eq("owner_id", user.id).order("created_at", { ascending: true }).limit(1);
      const existingShop = existingShops?.[0];
      if (!existingShop) return;
      setCreatedShopId(existingShop.id);
      setCreatedShopSlug(existingShop.slug);
      const { data: existingBarbers } = await supabase
        .from("barbers").select("id, name, email").eq("shop_id", existingShop.id)
        .order("created_at", { ascending: true });
      if (existingBarbers && existingBarbers.length > 0) {
        setCreatedBarberIds(existingBarbers.map(b => b.id));
        setAddedBarbers(existingBarbers.map(b => ({
          id: b.id, name: b.name, email: b.email ?? "",
          self: !!user.email && (b.email ?? "").toLowerCase() === user.email.toLowerCase(),
        })));
      }
    })();
  }, [user, createdShopId]);

  const canProceed = () => {
    if (step === 0) return shop.name && shop.address && shop.city;
    // Starter is solo — the owner MUST add themselves as a barber before moving on.
    // Staff is hidden on Starter, so this step is their one chance to get set up;
    // skipping it strands them with a shop but no bookable barber. Paid plans keep
    // the step optional (they can add/manage barbers later from Staff).
    if (step === 2 && planLimit === 1) return selfAdded;
    if (step === 4) return services.length > 0 && services.every((s) => s.name && s.price);
    return true;
  };

  const toDbTime = (display: string): string => {
    const [timePart, period] = display.split(" ");
    const [h, m] = timePart.split(":").map(Number);
    let h24 = h;
    if (period === "AM" && h === 12) h24 = 0;
    if (period === "PM" && h !== 12) h24 = h + 12;
    return `${h24.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:00`;
  };

  const handleNext = async () => {
    setError("");
    setSaving(true);
    try {
      if (step === 0 && !createdShopId) {
        // Skip if a shop already exists for this owner (restored on resume, or a
        // re-click) — the server also guards this, so no duplicate shop is created.
        // Shop creation is server-side now: the API forces status='pending' /
        // plan='starter' and only grants a paid plan + auto-approval after
        // VERIFYING the Stripe subscription belongs to this user. The plan/
        // status can no longer be set from the browser.
        const planData = JSON.parse(sessionStorage.getItem("clipwise_plan") || "{}");
        const res = await fetch("/api/shops/create", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: shop.name, address: shop.address, city: shop.city, province: shop.province,
            postal_code: shop.postal_code, phone: shop.phone, description: shop.description,
            subscription_id: planData.subscriptionId ?? undefined,
            // No-card trial: picking Pro/Premium starts a 21-day trial server-side.
            trial_plan: planData.trial ? planData.plan : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.shop) throw new Error(data.error || "Couldn't create your shop. Please try again.");
        setCreatedShopId(data.shop.id);
        setCreatedShopSlug(data.shop.slug);
      }

      if (step === 3) {
        // Hours → apply the chosen working hours to EVERY barber added so far.
        // These live on each barber (time_slots), NOT the shop — a barber's
        // schedule is what actually opens appointments, so this step follows
        // "add barbers" directly. Self-heal: if the in-memory list is empty
        // (refresh), look the barbers up. If none were added, nothing to do.
        let barberIds = createdBarberIds;
        if (barberIds.length === 0 && createdShopId) {
          const { data: existing } = await supabase
            .from("barbers").select("id").eq("shop_id", createdShopId);
          barberIds = (existing ?? []).map((b) => b.id);
        }
        const slots = hours
          .map((day, idx) => day.open ? { day_of_week: idx, start_time: toDbTime(day.start), end_time: toDbTime(day.end), is_available: true } : null)
          .filter((x): x is NonNullable<typeof x> => x !== null);
        for (const barberId of barberIds) {
          // Clear any pre-existing slots first so re-running this step replaces, not duplicates.
          await supabase.from("time_slots").delete().eq("barber_id", barberId);
          if (slots.length > 0) {
            const { error: err } = await supabase.from("time_slots").insert(slots.map((s) => ({ ...s, barber_id: barberId })));
            if (err) throw err;
          }
        }
      }

      if (step === 4) {
        const { error: err } = await supabase.from("services").insert(
          services.map((s) => ({ shop_id: createdShopId, name: s.name, price: parseFloat(s.price), duration_minutes: parseInt(s.duration), category: s.category, is_active: true }))
        );
        if (err) throw err;

        // Last setup step → submit the shop for approval (fire the emails).
        const emailData = {
          shopName: shop.name,
          ownerName: profile?.name || user?.email || "Shop Owner",
          ownerEmail: user?.email || "",
          ownerPhone: shop.phone,
          city: shop.city,
          province: shop.province,
          services: services.map((s) => s.name).join(", "),
          slug: createdShopSlug,
        };
        Promise.all([
          fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "new_shop_application", data: emailData }) }),
          fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "shop_submitted_confirmation", data: emailData }) }),
        ]).catch(() => {});
      }

      setStep((s) => s + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const handleLogoStep = async () => {
    if (!logoFile) { setStep((s) => s + 1); return; }
    setSaving(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", logoFile);
      form.append("shopId", createdShopId);
      const res = await fetch("/api/upload-logo", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken ?? ""}` },
        body: form,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? "Logo upload failed");
      }
      const { url } = await res.json() as { url: string };
      setLogoPreview(url);
      setStep((s) => s + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Logo upload failed");
    } finally {
      setSaving(false);
    }
  };

  // ── Step 2: add barbers (reuses the invite route; never touches RLS) ────────
  const planLimit = getPlanLimit(chosenPlan);
  const selfAdded = !!user?.email && addedBarbers.some((b) => b.self || b.email.toLowerCase() === user.email!.toLowerCase());
  const atBarberLimit = addedBarbers.length >= planLimit;
  // The public-facing barber name for "add yourself" — the account/signup name
  // (no editable field: a different name here would confuse the two portals). We
  // show it up front so the owner knows exactly how they'll appear to customers.
  const selfBarberName = profile?.name?.trim() || user?.email?.split("@")[0] || "Me";

  const inviteBarber = async (name: string, email: string, commission_percent: number) => {
    if (!createdShopId) { setBarberError("Please finish step 1 first."); return; }
    if (!accessToken) { setBarberError("Session expired — please sign in again."); return; }
    if (addedBarbers.length >= planLimit) {
      setBarberError(`Your plan includes ${planLimit} barber${planLimit === 1 ? "" : "s"}. Upgrade later to add more.`);
      return;
    }
    setAddingBarber(true);
    setBarberError("");
    try {
      const res = await fetch("/api/admin/barber/invite", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, commission_percent, shop_id: createdShopId }),
      });
      const data = await res.json();
      if (!res.ok || !data.barber) { setBarberError(data.error ?? "Could not add barber."); return; }
      setAddedBarbers((prev) => [...prev, { id: data.barber.id, name, email, self: !!data.ownerSelf }]);
      setCreatedBarberIds((prev) => [...prev, data.barber.id]);
      setShowAddOther(false);
      setOtherBarber({ name: "", email: "", commission: "" });
    } catch {
      setBarberError("Connection error — please try again.");
    } finally {
      setAddingBarber(false);
    }
  };

  const addSelfAsBarber = () => {
    if (!user?.email) { setBarberError("Your account email is missing — try signing in again."); return; }
    // Starter is solo → the owner keeps 100% (no split, one person). On paid plans
    // the multi-barber commission system is unchanged; the owner sets his own split
    // afterward in Staff (e.g. to show himself as a working barber for tax).
    inviteBarber(selfBarberName, user.email, chosenPlan === "starter" ? 100 : 50);
  };

  const addOtherBarber = () => {
    const name = otherBarber.name.trim();
    const email = otherBarber.email.trim();
    if (!name) { setBarberError("Barber name is required."); return; }
    const emailErr = validateEmail(email);
    if (emailErr) { setBarberError(emailErr); return; }
    if (user?.email && email.toLowerCase() === user.email.toLowerCase()) {
      setBarberError("You're already set up as a barber — use “Add yourself” above.");
      return;
    }
    const commission = Number(otherBarber.commission);
    if (otherBarber.commission.trim() === "" || Number.isNaN(commission) || commission < 0 || commission > 100) {
      setBarberError("Set this barber's commission % (0–100) — you decide, there's no default.");
      return;
    }
    inviteBarber(name, email, commission);
  };

  const bookingUrl = `${typeof window !== "undefined" ? window.location.origin : "https://app.clipwise.ca"}/book/${createdShopSlug}`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="border-b border-border px-4 py-4 flex items-center justify-between">
        <Logo size="sm" />
        <p className="text-xs text-[#8f8f8f]">Step {Math.min(step + 1, STEPS.length)} of {STEPS.length}</p>
      </div>
      <div className="h-1 bg-border">
        <div className="h-full bg-gold transition-all duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>
      <div className="flex items-center justify-center gap-1 px-4 py-3 overflow-x-auto">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-1">
            <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0",
              i < step ? "bg-gold text-black" : i === step ? "bg-gold/20 text-gold border border-gold" : "bg-surface-raised text-[#8f8f8f]")}>
              {i < step ? <Check size={12} /> : i + 1}
            </div>
            {i < STEPS.length - 1 && <div className={cn("w-5 h-px", i < step ? "bg-gold" : "bg-border")} />}
          </div>
        ))}
      </div>

      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-6 pb-24">
        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
            <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {step === 0 && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-xl font-bold text-white">Tell us about your shop</h2>
            {([
              { key: "name", label: "Shop Name *", placeholder: "Fresh Cutz Barbershop" },
              { key: "address", label: "Street Address *", placeholder: "123 Main Street" },
              { key: "city", label: "City *", placeholder: "Moncton" },
              { key: "phone", label: "Phone Number", placeholder: "(506) 555-0123", note: "Optional — shown publicly on your booking page. Leave blank to keep it private." },
              { key: "postal_code", label: "Postal Code", placeholder: "E1C 1A1" },
            ] as { key: string; label: string; placeholder: string; note?: string }[]).map(({ key, label, placeholder, note }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">{label}</label>
                <input value={shop[key as keyof typeof shop]} onChange={(e) => setShop({ ...shop, [key]: e.target.value })} placeholder={placeholder}
                  className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 focus:ring-gold/50" />
                {note && <p className="text-xs text-[#8f8f8f]">{note}</p>}
              </div>
            ))}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Province</label>
              <select value={shop.province} onChange={(e) => setShop({ ...shop, province: e.target.value })}
                className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50">
                {["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Description (optional)</label>
              <textarea value={shop.description} onChange={(e) => setShop({ ...shop, description: e.target.value })}
                placeholder="Tell clients what makes your shop special..." rows={3}
                className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 focus:ring-gold/50 resize-none" />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6 animate-fade-in">
            <h2 className="text-xl font-bold text-white">Upload your shop logo</h2>
            <div className="flex flex-col items-center gap-4">
              <div className="w-32 h-32 rounded-2xl bg-surface-raised border-2 border-dashed border-border flex items-center justify-center overflow-hidden">
                {logoPreview ? <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" /> :
                  <div className="text-center"><div className="text-4xl mb-1">✂️</div><p className="text-xs text-[#8f8f8f]">No logo yet</p></div>}
              </div>
              <label className="cursor-pointer">
                <div className="px-4 py-2 rounded-xl border border-border text-sm text-white hover:bg-surface-raised transition-colors">Choose Image</div>
                <input type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)); } }} />
              </label>
              <p className="text-xs text-[#8f8f8f] text-center">You can add your logo later from Settings.</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-xl font-bold text-white">{planLimit === 1 ? "You're the barber" : "Add your barbers"}</h2>
            <p className="text-[#8f8f8f] text-sm">{planLimit === 1 ? "On the free plan it's just you — add yourself and you're ready. Upgrade anytime to add your team." : "Add yourself if you cut hair, and invite your team. You can always do this later from Staff."}</p>

            {barberError && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-400">{barberError}</p>
              </div>
            )}

            {addedBarbers.length > 0 && (
              <div className="space-y-2">
                {addedBarbers.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 bg-surface-raised border border-border rounded-xl px-4 py-2.5">
                    <div className="w-8 h-8 rounded-full bg-gold/15 text-gold flex items-center justify-center text-sm font-bold flex-shrink-0">{(b.name[0] || "?").toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{b.name}{b.self && <span className="text-gold"> (you)</span>}</p>
                      {b.email && <p className="text-xs text-[#8f8f8f] truncate">{b.email}</p>}
                    </div>
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full flex-shrink-0", b.self ? "bg-emerald-500/15 text-emerald-400" : "bg-orange-500/15 text-orange-300")}>
                      {b.self ? "You" : "Invited"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {atBarberLimit ? (
              <p className="text-xs text-[#8f8f8f]">Your plan includes {planLimit} barber{planLimit === 1 ? "" : "s"}. Upgrade later from Billing to add more.</p>
            ) : (
              <div className="space-y-3">
                {!selfAdded && (
                  <button type="button" disabled={addingBarber} onClick={addSelfAsBarber}
                    className="w-full flex items-center gap-3 bg-surface border border-gold/40 hover:border-gold rounded-2xl p-4 text-left transition-all disabled:opacity-60">
                    <div className="w-10 h-10 rounded-xl bg-gold/15 flex items-center justify-center flex-shrink-0"><User size={18} className="text-gold" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">Add yourself as a barber</p>
                      <p className="text-xs text-[#8f8f8f] truncate">You&apos;ll appear as <span className="text-gold font-medium">{selfBarberName}</span> on your booking page</p>
                    </div>
                  </button>
                )}

                {/* "Add someone else" is a paid-plan (multi-barber) option — hidden on
                    solo Starter (planLimit 1), shown on Pro/Premium. */}
                {planLimit > 1 && (!showAddOther ? (
                  <button type="button" onClick={() => { setShowAddOther(true); setBarberError(""); }}
                    className="w-full flex items-center gap-3 bg-surface border border-border hover:border-gray-500 rounded-2xl p-4 text-left transition-all">
                    <div className="w-10 h-10 rounded-xl bg-surface-raised flex items-center justify-center flex-shrink-0"><Plus size={18} className="text-[#8f8f8f]" /></div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-white">Add someone else</p>
                      <p className="text-xs text-[#8f8f8f]">Send an email invite to set up their own login</p>
                    </div>
                  </button>
                ) : (
                  <div className="bg-surface border border-border rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-white">Invite a barber</p>
                      <button type="button" onClick={() => { setShowAddOther(false); setOtherBarber({ name: "", email: "", commission: "" }); setBarberError(""); }} className="text-[#8f8f8f] hover:text-white"><X size={16} /></button>
                    </div>
                    <input value={otherBarber.name} onChange={(e) => setOtherBarber((p) => ({ ...p, name: e.target.value }))} placeholder="Barber name *"
                      className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 focus:ring-gold/50" />
                    <input value={otherBarber.email} onChange={(e) => setOtherBarber((p) => ({ ...p, email: e.target.value }))} placeholder="Barber email *" type="email"
                      className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 focus:ring-gold/50" />
                    <input value={otherBarber.commission} onChange={(e) => setOtherBarber((p) => ({ ...p, commission: e.target.value }))} placeholder="Their commission % — you decide (e.g. 50)" type="number" min={0} max={100}
                      className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:ring-2 focus:ring-gold/50" />
                    <Button className="w-full" loading={addingBarber} onClick={addOtherBarber}>Send invite</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-xl font-bold text-white">Add your services</h2>
            <div className="space-y-3">
              {services.map((svc, i) => (
                <div key={i} className="bg-surface-raised border border-border rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gold">Service #{i + 1}</span>
                    {services.length > 1 && (
                      <button onClick={() => setServices(services.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2 space-y-1">
                      <label className="text-xs text-[#8f8f8f]">Name</label>
                      <input value={svc.name} onChange={(e) => setServices(services.map((s, j) => j === i ? { ...s, name: e.target.value } : s))} placeholder="Haircut"
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-[#8f8f8f]">Price ($)</label>
                      <input type="number" value={svc.price} onChange={(e) => setServices(services.map((s, j) => j === i ? { ...s, price: e.target.value } : s))} placeholder="30"
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-[#8f8f8f]">Duration (min)</label>
                      <input type="number" value={svc.duration} onChange={(e) => setServices(services.map((s, j) => j === i ? { ...s, duration: e.target.value } : s))} placeholder="30"
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="text-xs text-[#8f8f8f]">Category</label>
                      <select value={svc.category} onChange={(e) => setServices(services.map((s, j) => j === i ? { ...s, category: e.target.value } : s))}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50">
                        {SERVICE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setServices([...services, { name: "", price: "", duration: "30", category: "Hair" }])}
              className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-border rounded-2xl text-sm text-[#8f8f8f] hover:text-gold hover:border-gold/30 transition-colors">
              <Plus size={16} /> Add Another Service
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-xl font-bold text-white">{planLimit === 1 ? "Set your working hours" : "Set working hours"}</h2>
            <p className="text-[#8f8f8f] text-sm">{planLimit === 1
              ? "When can customers book you? Appointments only open during these hours — you can change them anytime."
              : "These hours apply to everyone you just added, to get you started. You can fine-tune each barber's schedule later from Staff."}</p>
            <div className="space-y-2">
              {DAYS.map((day, i) => (
                <div key={day} className={cn("p-3 rounded-xl border transition-all", hours[i].open ? "border-gold/20 bg-gold/5" : "border-border bg-surface-raised")}>
                  <div className="flex items-center gap-3 mb-2">
                    <Switch
                      checked={!!hours[i].open}
                      onChange={v => setHours(hours.map((h, j) => j === i ? { ...h, open: v } : h))}
                    />
                    <span className="text-sm font-medium text-white w-24">{day}</span>
                    {!hours[i].open && <span className="text-xs text-[#8f8f8f]">Closed</span>}
                  </div>
                  {hours[i].open && (
                    <div className="flex items-center gap-2 ml-13">
                      <select value={hours[i].start} onChange={(e) => setHours(hours.map((h, j) => j === i ? { ...h, start: e.target.value } : h))}
                        className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-gold/50">
                        {TIME_SLOTS.map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <span className="text-[#8f8f8f] text-xs">to</span>
                      <select value={hours[i].end} onChange={(e) => setHours(hours.map((h, j) => j === i ? { ...h, end: e.target.value } : h))}
                        className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-gold/50">
                        {TIME_SLOTS.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="text-center animate-fade-in relative py-8">
            <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
              {confetti.map((c, i) => (
                <div key={i} className="absolute animate-bounce" style={{ left: c.left, top: "-10px", width: c.size, height: c.size, backgroundColor: c.color, borderRadius: "2px", animationDelay: c.delay, animationDuration: c.duration, transform: "rotate(45deg)" }} />
              ))}
            </div>
            <div className="w-20 h-20 bg-gold/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-gold/30">
              <Check size={36} className="text-gold" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Your shop is ready! 🎉</h2>
            <p className="text-[#8f8f8f] mb-1 text-sm">Submitted for approval — usually approved within 24 hours.</p>
            <div className="bg-surface border border-gold/20 rounded-2xl p-5 text-left my-6">
              <p className="text-xs text-[#8f8f8f] mb-2 font-medium uppercase tracking-wider">Your Booking Link</p>
              <div className="flex items-center gap-2 bg-surface-raised rounded-xl px-3 py-2">
                <p className="text-sm text-gold font-mono flex-1 truncate">{bookingUrl}</p>
                <button onClick={() => navigator.clipboard.writeText(bookingUrl)} className="text-[#8f8f8f] hover:text-gold flex-shrink-0"><Copy size={16} /></button>
              </div>
              <p className="text-xs text-[#8f8f8f] mt-2">Goes live once your shop is approved.</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => window.open(bookingUrl, "_blank")}><ExternalLink size={16} /> Preview</Button>
              <Button className="flex-1" loading={finishing} onClick={async () => {
                const planData = JSON.parse(sessionStorage.getItem("clipwise_plan") || "{}");
                sessionStorage.removeItem("clipwise_plan");
                // Sync the freshly-created shop into the auth context BEFORE we
                // navigate — otherwise /dashboard sees shop=null and shows the
                // "No shop found → Set Up My Shop" page until a manual refresh.
                setFinishing(true);
                try { await refreshShop(); } catch { /* dashboard will retry */ }
                // Paid or on a Pro/Premium trial → prompt Stripe Connect next, so
                // they can take online payments right away (and see a payout land
                // during the trial — the strongest reason to add a card).
                if ((planData.autoApprove || planData.trial) && (planData.plan === "pro" || planData.plan === "premium")) {
                  router.push("/onboarding/stripe-connect");
                } else {
                  router.push("/dashboard");
                }
              }}>Continue <ChevronRight size={16} /></Button>
            </div>
          </div>
        )}
      </div>

      {step < 5 && (
        <div className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border px-4 py-3">
          <div className="max-w-lg mx-auto flex gap-3">
            {step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)} className="flex-shrink-0"><ChevronLeft size={16} /></Button>}
            <Button className="flex-1" disabled={!canProceed() || saving} loading={saving} onClick={step === 1 ? handleLogoStep : handleNext}>
              {saving ? (step === 1 ? "Uploading..." : "Saving...") : step === 1 ? (logoFile ? "Continue" : "Skip — Add Later") : step === 4 ? "Finish Setup" : (step === 2 && planLimit > 1 && addedBarbers.length === 0 ? "Skip for now" : "Continue")}
              {!saving && <ChevronRight size={16} />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
