"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Heart, Check, Scissors } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { useResetOnReturn } from "@/lib/use-reset-on-return";
import { TIP_PRESET_PERCENTS } from "@/lib/pricing";

interface TipBooking {
  id: string;
  client_name: string;
  total_amount: number;
  barbers?: { name: string } | null;
  services?: { name: string } | null;
  shops?: { name: string } | null;
}

export default function TipPage() {
  const id = (useParams()?.id as string) ?? "";
  const [booking, setBooking] = useState<TipBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [paid, setPaid] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  const [pct, setPct] = useState<number | null>(20);
  const [custom, setCustom] = useState("");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  // Back from Stripe restores this page from bfcache with `paying` frozen —
  // clear it so the pay button doesn't spin forever.
  useResetOnReturn(() => setPaying(false));

  useEffect(() => {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search);
      if (q.get("cancelled")) setCancelled(true);
      if (q.get("paid")) {
        setPaid(true);
        // Record the tip on return — the safety net for the Stripe webhook, so
        // the barber + owner see it even if the connected-account event never
        // fires. Idempotent server-side, so it's harmless if the webhook won.
        const sessionId = q.get("session_id");
        if (sessionId && id) {
          fetch("/api/stripe/tip-finalize", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId, appointment_id: id }),
          }).catch(() => null);
        }
      }
    }
  }, [id]);

  useEffect(() => {
    if (!id) { setNotFound(true); setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`/api/my-booking/${id}`);
        if (!res.ok) { setNotFound(true); setLoading(false); return; }
        const { booking: b } = await res.json();
        if (!b) { setNotFound(true); setLoading(false); return; }
        setBooking(b as TipBooking);
      } catch { setNotFound(true); }
      setLoading(false);
    })();
  }, [id]);

  const base = Number(booking?.total_amount ?? 0);
  const tipAmount = pct !== null ? Math.round(base * pct) / 100 : Number(custom) || 0;

  const pay = async () => {
    if (tipAmount < 1) { setError("Please choose a tip of at least $1."); return; }
    setPaying(true); setError("");
    try {
      const res = await fetch("/api/stripe/tip-checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: id, tip_amount: tipAmount }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) { setError(data.error || "Couldn't start payment."); setPaying(false); return; }
      window.location.href = data.url;
    } catch { setError("Connection error — please try again."); setPaying(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
    </div>
  );

  if (paid) return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
      <Logo size="md" className="justify-center mb-8" />
      <div className="bg-surface border border-border rounded-2xl p-8 max-w-sm space-y-3">
        <div className="w-16 h-16 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto">
          <Check size={30} className="text-emerald-400" />
        </div>
        <h1 className="text-xl font-bold text-white">Thank you! 🎉</h1>
        <p className="text-[#8f8f8f] text-sm">Your tip went straight to {booking?.shops?.name ?? "the shop"}. They&rsquo;ll appreciate it.</p>
      </div>
    </div>
  );

  if (notFound || !booking) return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
      <Logo size="md" className="justify-center mb-8" />
      <div className="bg-surface border border-border rounded-2xl p-8 max-w-sm">
        <Scissors size={40} className="text-[#999] mx-auto mb-4" />
        <h1 className="text-xl font-bold text-white mb-2">Link not found</h1>
        <p className="text-[#6e6e6e] text-sm">This tip link is invalid or has expired.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-md mx-auto px-4 py-10">
        <Logo size="md" className="justify-center mb-8" />
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gold/15 border border-gold/30 flex items-center justify-center mx-auto mb-4">
            <Heart size={26} className="text-gold" />
          </div>
          <h1 className="text-xl font-bold text-white">Leave a tip</h1>
          <p className="text-[#8f8f8f] text-sm mt-1">
            for {booking.barbers?.name ? <span className="text-white">{booking.barbers.name}</span> : booking.shops?.name}
            {booking.services?.name ? ` · ${booking.services.name}` : ""}
          </p>
        </div>

        {cancelled && <p className="text-xs text-amber-300 text-center mb-4">Payment cancelled — you can try again below.</p>}

        <div className="bg-surface border border-border rounded-2xl p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {TIP_PRESET_PERCENTS.map(p => {
              const amt = Math.round(base * p) / 100;
              const active = pct === p;
              return (
                <button key={p} onClick={() => { setPct(p); setCustom(""); setError(""); }}
                  className={`rounded-xl border py-3 text-center transition-all ${active ? "border-gold bg-gold/15" : "border-border hover:border-gold/40"}`}>
                  <p className={`text-lg font-bold ${active ? "text-gold" : "text-white"}`}>{p}%</p>
                  <p className="text-xs text-[#8f8f8f]">{formatCurrency(amt)}</p>
                </button>
              );
            })}
          </div>

          <div>
            <label className="text-xs text-[#8f8f8f]">Custom amount</label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8f8f]">$</span>
              <input
                type="number" min={1} step="1" inputMode="decimal"
                value={custom}
                onChange={e => { setCustom(e.target.value); setPct(null); setError(""); }}
                placeholder="0.00"
                className="w-full bg-surface-raised border border-border rounded-xl pl-7 pr-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-gold/50"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Button className="w-full" size="lg" loading={paying} disabled={tipAmount < 1} onClick={pay}>
            {tipAmount >= 1 ? `Tip ${formatCurrency(tipAmount)}` : "Choose a tip"}
          </Button>
          <p className="text-[11px] text-[#8f8f8f] text-center">Secure payment — your tip goes directly to the shop.</p>
        </div>

        <p className="mt-8 text-center text-xs text-[#999]">Powered by <span className="text-gold font-semibold">ClipWise</span></p>
      </div>
    </div>
  );
}
