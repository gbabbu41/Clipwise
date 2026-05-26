"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, ChevronLeft, Plus, Trash2, Copy, ExternalLink, AlertCircle } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { generate24hSlots, cn } from "@/lib/utils";

const STEPS = ["Shop Details", "Logo", "First Barber", "Services", "Hours", "Done!"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TIME_SLOTS = generate24hSlots();
const SERVICE_CATEGORIES = ["Hair", "Beard", "Packages", "Kids"];

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

type ServiceRow = { name: string; price: string; duration: string; category: string };
type DayHours = { open: boolean; start: string; end: string };

export default function OnboardingPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const confetti = Array.from({ length: 40 }, (_, i) => ({
    left: `${(i * 2.5) % 100}%`,
    delay: `${(i * 0.05) % 2}s`,
    color: ["#C9A84C", "#E4C97A", "#10B981", "#3B82F6", "#A855F7", "#EF4444"][i % 6],
    size: `${6 + (i % 6)}px`,
    duration: `${1.5 + (i % 10) * 0.1}s`,
  }));

  const [shop, setShop] = useState({ name: "", address: "", city: "", province: "NB", postal_code: "", phone: "", description: "" });
  const [createdShopId, setCreatedShopId] = useState("");
  const [createdShopSlug, setCreatedShopSlug] = useState("");
  const [logoPreview, setLogoPreview] = useState("");
  const [barber, setBarber] = useState({ name: "", email: "", commission: "50" });
  const [createdBarberId, setCreatedBarberId] = useState("");
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

  const canProceed = () => {
    if (step === 0) return shop.name && shop.address && shop.city && shop.phone;
    if (step === 2) return !!barber.name;
    if (step === 3) return services.length > 0 && services.every((s) => s.name && s.price);
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
      if (step === 0) {
        const baseSlug = slugify(shop.name);
        const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
        const { data, error: err } = await supabase
          .from("shops")
          .insert({ ...shop, owner_id: user!.id, slug, status: "pending", subscription_plan: "starter" })
          .select()
          .single();
        if (err) throw err;
        setCreatedShopId(data.id);
        setCreatedShopSlug(data.slug);
      }

      if (step === 2 && barber.name) {
        const { data, error: err } = await supabase
          .from("barbers")
          .insert({ shop_id: createdShopId, name: barber.name, email: barber.email, commission_percent: parseInt(barber.commission), is_active: true })
          .select().single();
        if (err) throw err;
        setCreatedBarberId(data.id);
      }

      if (step === 3) {
        const { error: err } = await supabase.from("services").insert(
          services.map((s) => ({ shop_id: createdShopId, name: s.name, price: parseFloat(s.price), duration_minutes: parseInt(s.duration), category: s.category, is_active: true }))
        );
        if (err) throw err;
      }

      if (step === 4 && createdBarberId) {
        const slots = hours
          .map((day, idx) => day.open ? { barber_id: createdBarberId, day_of_week: idx, start_time: toDbTime(day.start), end_time: toDbTime(day.end), is_available: true } : null)
          .filter((x): x is NonNullable<typeof x> => x !== null);
        if (slots.length > 0) {
          const { error: err } = await supabase.from("time_slots").insert(slots);
          if (err) throw err;
        }
      }

      if (step === 4) {
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

  const bookingUrl = `${typeof window !== "undefined" ? window.location.origin : "https://app.clipwise.ca"}/book/${createdShopSlug}`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="border-b border-border px-4 py-4 flex items-center justify-between">
        <Logo size="sm" />
        <p className="text-xs text-gray-500">Step {Math.min(step + 1, STEPS.length)} of {STEPS.length}</p>
      </div>
      <div className="h-1 bg-border">
        <div className="h-full bg-gold transition-all duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>
      <div className="flex items-center justify-center gap-1 px-4 py-3 overflow-x-auto">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-1">
            <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0",
              i < step ? "bg-gold text-black" : i === step ? "bg-gold/20 text-gold border border-gold" : "bg-surface-raised text-gray-600")}>
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
            {[
              { key: "name", label: "Shop Name *", placeholder: "Fresh Cutz Barbershop" },
              { key: "address", label: "Street Address *", placeholder: "123 Main Street" },
              { key: "city", label: "City *", placeholder: "Moncton" },
              { key: "phone", label: "Phone Number *", placeholder: "(506) 555-0123" },
              { key: "postal_code", label: "Postal Code", placeholder: "E1C 1A1" },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">{label}</label>
                <input value={shop[key as keyof typeof shop]} onChange={(e) => setShop({ ...shop, [key]: e.target.value })} placeholder={placeholder}
                  className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50" />
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
                className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 resize-none" />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6 animate-fade-in">
            <h2 className="text-xl font-bold text-white">Upload your shop logo</h2>
            <div className="flex flex-col items-center gap-4">
              <div className="w-32 h-32 rounded-2xl bg-surface-raised border-2 border-dashed border-border flex items-center justify-center overflow-hidden">
                {logoPreview ? <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" /> :
                  <div className="text-center"><div className="text-4xl mb-1">✂️</div><p className="text-xs text-gray-500">No logo yet</p></div>}
              </div>
              <label className="cursor-pointer">
                <div className="px-4 py-2 rounded-xl border border-border text-sm text-white hover:bg-surface-raised transition-colors">Choose Image</div>
                <input type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setLogoPreview(URL.createObjectURL(f)); }} />
              </label>
              <p className="text-xs text-gray-600 text-center">You can add your logo later from Settings.</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-xl font-bold text-white">Add your first barber</h2>
            {[{ key: "name", label: "Barber Name *", placeholder: "Marcus Johnson" }, { key: "email", label: "Email", placeholder: "marcus@shop.ca" }].map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">{label}</label>
                <input value={barber[key as keyof typeof barber]} onChange={(e) => setBarber({ ...barber, [key]: e.target.value })} placeholder={placeholder}
                  className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50" />
              </div>
            ))}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Barber Commission: <span className="text-gold">{barber.commission}%</span></label>
              <input type="range" min="30" max="70" step="5" value={barber.commission}
                onChange={(e) => setBarber({ ...barber, commission: e.target.value })} className="w-full accent-gold" />
              <p className="text-xs text-gray-500">Barber earns {barber.commission}%, shop keeps {100 - parseInt(barber.commission)}%</p>
            </div>
          </div>
        )}

        {step === 3 && (
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
                      <label className="text-xs text-gray-400">Name</label>
                      <input value={svc.name} onChange={(e) => setServices(services.map((s, j) => j === i ? { ...s, name: e.target.value } : s))} placeholder="Haircut"
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">Price ($)</label>
                      <input type="number" value={svc.price} onChange={(e) => setServices(services.map((s, j) => j === i ? { ...s, price: e.target.value } : s))} placeholder="30"
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">Duration (min)</label>
                      <input type="number" value={svc.duration} onChange={(e) => setServices(services.map((s, j) => j === i ? { ...s, duration: e.target.value } : s))} placeholder="30"
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="text-xs text-gray-400">Category</label>
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
              className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-border rounded-2xl text-sm text-gray-400 hover:text-gold hover:border-gold/30 transition-colors">
              <Plus size={16} /> Add Another Service
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-xl font-bold text-white">Set your business hours</h2>
            <p className="text-gray-500 text-sm">Full 24-hour scheduling — customers can only book within these hours.</p>
            <div className="space-y-2">
              {DAYS.map((day, i) => (
                <div key={day} className={cn("p-3 rounded-xl border transition-all", hours[i].open ? "border-gold/20 bg-gold/5" : "border-border bg-surface-raised")}>
                  <div className="flex items-center gap-3 mb-2">
                    <button onClick={() => setHours(hours.map((h, j) => j === i ? { ...h, open: !h.open } : h))}
                      className={cn("relative w-10 h-5 rounded-full transition-colors flex-shrink-0", hours[i].open ? "bg-gold" : "bg-surface border border-border")}>
                      <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", hours[i].open ? "left-5" : "left-0.5")} />
                    </button>
                    <span className="text-sm font-medium text-white w-24">{day}</span>
                    {!hours[i].open && <span className="text-xs text-gray-500">Closed</span>}
                  </div>
                  {hours[i].open && (
                    <div className="flex items-center gap-2 ml-13">
                      <select value={hours[i].start} onChange={(e) => setHours(hours.map((h, j) => j === i ? { ...h, start: e.target.value } : h))}
                        className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-gold/50">
                        {TIME_SLOTS.map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <span className="text-gray-500 text-xs">to</span>
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
            <p className="text-gray-400 mb-1 text-sm">Submitted for approval — usually approved within 24 hours.</p>
            <div className="bg-surface border border-gold/20 rounded-2xl p-5 text-left my-6">
              <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">Your Booking Link</p>
              <div className="flex items-center gap-2 bg-surface-raised rounded-xl px-3 py-2">
                <p className="text-sm text-gold font-mono flex-1 truncate">{bookingUrl}</p>
                <button onClick={() => navigator.clipboard.writeText(bookingUrl)} className="text-gray-400 hover:text-gold flex-shrink-0"><Copy size={16} /></button>
              </div>
              <p className="text-xs text-gray-600 mt-2">Goes live once your shop is approved.</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => window.open(bookingUrl, "_blank")}><ExternalLink size={16} /> Preview</Button>
              <Button className="flex-1" onClick={() => router.push("/dashboard")}>Go to Dashboard <ChevronRight size={16} /></Button>
            </div>
          </div>
        )}
      </div>

      {step < 5 && (
        <div className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border px-4 py-3">
          <div className="max-w-lg mx-auto flex gap-3">
            {step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)} className="flex-shrink-0"><ChevronLeft size={16} /></Button>}
            <Button className="flex-1" disabled={!canProceed() || saving} loading={saving} onClick={step === 1 ? () => setStep(step + 1) : handleNext}>
              {saving ? "Saving..." : step === 1 ? "Skip — Add Later" : step === 4 ? "Finish Setup" : "Continue"}
              {!saving && <ChevronRight size={16} />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
