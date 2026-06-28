"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Scissors, User, CheckCircle2, ArrowLeft, Monitor } from "lucide-react";
import type { Barber, Service } from "@/lib/database.types";

type KioskStep = "welcome" | "service" | "barber" | "info" | "confirm" | "done";

interface WalkInData {
  service: Service | null;
  barber: Barber | null;
  name: string;
  phone: string;
}

function KioskButton({ children, onClick, className, disabled }: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full p-5 rounded-2xl border-2 text-left transition-all active:scale-[0.98] touch-manipulation select-none",
        "bg-black shadow-sm border-[#1e1e1e] hover:border-gray-400 hover:bg-[#141414]",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
}

export default function KioskPage() {
  const { shop } = useAuth();
  const [step, setStep] = useState<KioskStep>("welcome");
  const [services, setServices] = useState<Service[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [data, setData] = useState<WalkInData>({ service: null, barber: null, name: "", phone: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [queuePosition, setQueuePosition] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const load = useCallback(async () => {
    if (!shop) return;
    const [{ data: svcs }, { data: brbrs }] = await Promise.all([
      supabase.from("services").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
    ]);
    if (svcs) setServices(svcs);
    if (brbrs) setBarbers(brbrs);
  }, [shop]);

  useEffect(() => { load(); }, [load]);

  // Auto-reset after done
  useEffect(() => {
    if (step === "done") {
      const t = setTimeout(() => {
        setStep("welcome");
        setData({ service: null, barber: null, name: "", phone: "" });
        setSubmitError("");
      }, 8000);
      return () => clearTimeout(t);
    }
  }, [step]);

  const enterFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => null);
    setIsFullscreen(true);
  };

  const addToWaitlist = async () => {
    if (!data.name.trim()) return;
    setSubmitting(true);
    setSubmitError("");

    const { data: countData } = await supabase
      .from("waitlist")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shop!.id)
      .in("status", ["waiting", "called"]);

    const position = (countData as unknown as { count?: number })?.count ?? 0;

    // NOTE: the column is `service_id` (uuid FK), not `service_name`. Inserting
    // the wrong column previously made PostgREST reject the whole row — so kiosk
    // walk-ins silently never reached the queue. Surface real errors now instead
    // of swallowing them, so a failure shows up rather than a false "You're in!".
    const { error } = await supabase.from("waitlist").insert({
      shop_id: shop!.id,
      client_name: data.name.trim(),
      client_phone: data.phone.trim() || null,
      barber_id: data.barber?.id ?? null,
      service_id: data.service?.id ?? null,
      status: "waiting",
      added_at: new Date().toISOString(),
    });

    setSubmitting(false);
    if (error) {
      setSubmitError("Couldn't join the waitlist. Please tell the front desk.");
      return;
    }
    setQueuePosition(position + 1);
    setStep("done");
  };

  const estimatedWait = Math.max(5, queuePosition * 20);

  if (!shop) {
    return (
      <div className="p-8 text-center text-[#777]">
        <p>No shop configured.</p>
      </div>
    );
  }

  return (
    <div className={cn(
      "min-h-screen bg-black flex flex-col",
      isFullscreen && "fixed inset-0 z-[200]"
    )}>
      {/* Fullscreen toggle bar */}
      {!isFullscreen && (
        <div className="flex items-center justify-between px-6 py-3 bg-black shadow-sm border-b border-[#1e1e1e]">
          <div className="flex items-center gap-2 text-sm text-[#777]">
            <Monitor size={16} />
            <span>Kiosk Mode — Walk-in Self Check-in</span>
          </div>
          <Button variant="outline" size="sm" onClick={enterFullscreen}>
            Enter Fullscreen Kiosk
          </Button>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-lg">

          {/* Welcome */}
          {step === "welcome" && (
            <div className="text-center space-y-8">
              <div className="flex justify-center">
                <div className="w-24 h-24 rounded-3xl bg-black/10 border-2 border-black flex items-center justify-center">
                  <Scissors size={40} className="text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-4xl font-black text-white">{shop.name}</h1>
                <p className="text-xl text-[#777] mt-2">Walk-in Check-In</p>
              </div>
              <div className="space-y-3">
                <Button
                  className="w-full py-5 text-lg font-bold"
                  onClick={() => setStep("service")}
                >
                  ✂️ Check In for Walk-in
                </Button>
                <p className="text-sm text-[#777]">Tap to join the waitlist</p>
              </div>
            </div>
          )}

          {/* Service selection */}
          {step === "service" && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button onClick={() => setStep("welcome")} className="w-10 h-10 rounded-xl bg-[#141414] flex items-center justify-center text-[#777] hover:text-white transition-colors">
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h2 className="text-2xl font-bold text-white">What service?</h2>
                  <p className="text-sm text-[#777]">Pick the service you want</p>
                </div>
              </div>

              <div className="space-y-3">
                {services.map(svc => (
                  <KioskButton
                    key={svc.id}
                    onClick={() => { setData(d => ({ ...d, service: svc })); setStep("barber"); }}
                    className={data.service?.id === svc.id ? "border-black bg-black/5" : ""}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white font-semibold text-lg">{svc.name}</p>
                        <p className="text-[#777] text-sm mt-0.5">{svc.duration_minutes} min</p>
                      </div>
                      <p className="text-white font-bold text-xl">${svc.price}</p>
                    </div>
                  </KioskButton>
                ))}
                {services.length === 0 && (
                  <KioskButton onClick={() => { setData(d => ({ ...d, service: null })); setStep("barber"); }}>
                    <p className="text-white font-semibold text-lg">Haircut / General Service</p>
                  </KioskButton>
                )}
              </div>

              <button
                onClick={() => { setData(d => ({ ...d, service: null })); setStep("barber"); }}
                className="w-full text-sm text-[#777] hover:text-[#777] py-2 transition-colors"
              >
                Skip — I'll decide with my barber
              </button>
            </div>
          )}

          {/* Barber selection */}
          {step === "barber" && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button onClick={() => setStep("service")} className="w-10 h-10 rounded-xl bg-[#141414] flex items-center justify-center text-[#777] hover:text-white transition-colors">
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h2 className="text-2xl font-bold text-white">Any preference?</h2>
                  <p className="text-sm text-[#777]">Choose a barber or go with the next available</p>
                </div>
              </div>

              <div className="space-y-3">
                <KioskButton
                  onClick={() => { setData(d => ({ ...d, barber: null })); setStep("info"); }}
                  className={!data.barber ? "border-black bg-black/5" : ""}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-black/10 border border-[#1e1e1e] flex items-center justify-center">
                      <Scissors size={20} className="text-white" />
                    </div>
                    <div>
                      <p className="text-white font-semibold text-lg">Next Available</p>
                      <p className="text-[#777] text-sm">Fastest wait time</p>
                    </div>
                  </div>
                </KioskButton>

                {barbers.map(barber => (
                  <KioskButton
                    key={barber.id}
                    onClick={() => { setData(d => ({ ...d, barber })); setStep("info"); }}
                    className={data.barber?.id === barber.id ? "border-black bg-black/5" : ""}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-black shadow-sm border border-[#1e1e1e] flex items-center justify-center text-xl font-bold text-white">
                        {barber.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-white font-semibold text-lg">{barber.name}</p>
                        {barber.rating > 0 && (
                          <p className="text-[#777] text-sm">★ {barber.rating.toFixed(1)} rating</p>
                        )}
                      </div>
                    </div>
                  </KioskButton>
                ))}
              </div>
            </div>
          )}

          {/* Info */}
          {step === "info" && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button onClick={() => setStep("barber")} className="w-10 h-10 rounded-xl bg-[#141414] flex items-center justify-center text-[#777] hover:text-white transition-colors">
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h2 className="text-2xl font-bold text-white">Your info</h2>
                  <p className="text-sm text-[#777]">So we can call you when it's your turn</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-[#777] block mb-2">Your Name *</label>
                  <input
                    type="text"
                    value={data.name}
                    onChange={e => setData(d => ({ ...d, name: e.target.value }))}
                    placeholder="First name is fine"
                    className="w-full rounded-2xl border-2 border-[#1e1e1e] bg-[#141414] px-5 py-4 text-lg text-white placeholder:text-[#777] focus:outline-none focus:border-black"
                    autoComplete="off"
                    autoCorrect="off"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-[#777] block mb-2">Phone (optional — for text when ready)</label>
                  <input
                    type="tel"
                    value={data.phone}
                    onChange={e => setData(d => ({ ...d, phone: e.target.value }))}
                    placeholder="e.g. 416-555-0100"
                    className="w-full rounded-2xl border-2 border-[#1e1e1e] bg-[#141414] px-5 py-4 text-lg text-white placeholder:text-[#777] focus:outline-none focus:border-black"
                    autoComplete="off"
                  />
                </div>
              </div>

              <Button
                className="w-full py-5 text-lg font-bold"
                disabled={!data.name.trim()}
                onClick={() => setStep("confirm")}
              >
                Continue →
              </Button>
            </div>
          )}

          {/* Confirm */}
          {step === "confirm" && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button onClick={() => setStep("info")} className="w-10 h-10 rounded-xl bg-[#141414] flex items-center justify-center text-[#777] hover:text-white transition-colors">
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h2 className="text-2xl font-bold text-white">Confirm Check-In</h2>
                  <p className="text-sm text-[#777]">Review and join the waitlist</p>
                </div>
              </div>

              <div className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-6 space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-[#1e1e1e]">
                  <span className="text-[#777]">Name</span>
                  <span className="text-white font-semibold">{data.name}</span>
                </div>
                {data.phone && (
                  <div className="flex justify-between items-center py-2 border-b border-[#1e1e1e]">
                    <span className="text-[#777]">Phone</span>
                    <span className="text-white">{data.phone}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2 border-b border-[#1e1e1e]">
                  <span className="text-[#777]">Service</span>
                  <span className="text-white">{data.service?.name ?? "To be decided"}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-[#777]">Barber</span>
                  <span className="text-white">{data.barber?.name ?? "Next Available"}</span>
                </div>
              </div>

              <Button
                className="w-full py-5 text-lg font-bold"
                disabled={submitting}
                onClick={addToWaitlist}
              >
                {submitting ? "Adding to waitlist…" : "✓ Join Waitlist"}
              </Button>
              {submitError && (
                <p className="text-center text-sm text-rose-400">{submitError}</p>
              )}
            </div>
          )}

          {/* Done */}
          {step === "done" && (
            <div className="text-center space-y-8">
              <div className="flex justify-center">
                <div className="w-24 h-24 rounded-3xl bg-emerald-500/20 border-2 border-emerald-500/30 flex items-center justify-center">
                  <CheckCircle2 size={48} className="text-emerald-400" />
                </div>
              </div>
              <div>
                <h2 className="text-3xl font-black text-white">You're checked in!</h2>
                <p className="text-xl text-[#777] mt-2">Welcome, {data.name}</p>
              </div>
              <div className="bg-[#141414] border border-[#1e1e1e] rounded-2xl p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[#777]">Your position</span>
                  <span className="text-3xl font-black text-white">#{queuePosition}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#777]">Est. wait time</span>
                  <span className="text-white font-semibold">~{estimatedWait} min</span>
                </div>
                {data.barber && (
                  <div className="flex justify-between items-center">
                    <span className="text-[#777]">Barber</span>
                    <span className="text-white">{data.barber.name}</span>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-[#777]">Have a seat — we'll call your name when it's your turn.</p>
                {data.phone && <p className="text-sm text-[#777]">We'll also text you at {data.phone}.</p>}
              </div>
              <p className="text-xs text-[#777]">This screen resets in 8 seconds…</p>
            </div>
          )}

        </div>
      </div>

      {/* Footer branding */}
      <div className="py-4 text-center">
        <p className="text-xs text-[#777]">Powered by <span className="text-white font-semibold">ClipWise</span></p>
      </div>
    </div>
  );
}
