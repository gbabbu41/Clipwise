"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { validateEmail } from "@/lib/validation";
import type { Shop } from "@/lib/database.types";
import { Gift, Check, Copy } from "lucide-react";

const AMOUNTS = ["25", "50", "75", "100", "150", "200"];

export default function GiftCardPurchasePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.shopslug as string;

  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("50");
  const [form, setForm] = useState({ recipient_name: "", recipient_email: "", purchaser_name: "", purchaser_email: "", note: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<{ code: string; amount: number } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      // Public/anon read — explicit columns only (never select("*"): no Stripe ids / owner_id).
      const { data } = await supabase.from("shops").select("id, name, slug, status, logo").eq("slug", slug).eq("status", "approved").maybeSingle();
      setShop(data as Shop | null);
      setLoading(false);
    })();
  }, [slug]);

  // Finalize on return from Stripe.
  const finalize = useCallback(async (sessionId: string) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/stripe/gift-finalize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, shop_slug: slug }),
      });
      const data = await res.json();
      if (data.paid && data.code) setIssued({ code: data.code, amount: data.amount });
      else setError(data.error || "We couldn't confirm your payment. If you were charged, contact the shop.");
    } catch {
      setError("Something went wrong confirming your purchase.");
    } finally {
      setSubmitting(false);
    }
  }, [slug]);

  useEffect(() => {
    const sid = searchParams.get("session_id");
    if (searchParams.get("paid") === "1" && sid) finalize(sid);
    if (searchParams.get("cancelled") === "1") setError("Payment cancelled.");
  }, [searchParams, finalize]);

  const buy = async () => {
    setError("");
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError("Choose an amount."); return; }
    if (!form.purchaser_email || !validateEmail(form.purchaser_email)) { setError("Enter a valid email for your receipt."); return; }
    if (form.recipient_email && !validateEmail(form.recipient_email)) { setError("The recipient's email looks invalid."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/stripe/gift-checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_slug: slug, origin: window.location.origin, amount: amt, ...form }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) { setError(data.error || "Could not start payment."); setSubmitting(false); return; }
      window.location.href = data.url;
    } catch {
      setError("Could not start payment."); setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-[100dvh] bg-black flex items-center justify-center"><Logo size="md" /></div>;
  if (!shop) return (
    <div className="min-h-[100dvh] bg-black flex flex-col items-center justify-center text-center px-6">
      <Logo size="sm" showText={false} />
      <h1 className="text-xl font-bold text-white mt-4">Shop not found</h1>
      <p className="text-[#8f8f8f] mt-2">This gift card link isn&apos;t valid.</p>
    </div>
  );

  // Success screen with the code.
  if (issued) return (
    <div className="min-h-[100dvh] bg-black flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mx-auto mb-5">
          <Check className="text-emerald-400" size={28} />
        </div>
        <h1 className="text-2xl font-black text-white uppercase tracking-tight">Gift card sent!</h1>
        <p className="text-[#8a8a8a] mt-2">A {formatCurrency(issued.amount)} gift card for {shop.name}{form.recipient_email ? ` was emailed to ${form.recipient_email}` : " is ready"}.</p>
        <div className="mt-6 p-5 rounded-2xl border-2 border-dashed border-[#333] bg-[#0d0d0d]">
          <p className="text-[11px] uppercase tracking-widest text-[#8f8f8f]">Gift Card Code</p>
          <p className="text-2xl font-black font-mono text-white tracking-widest mt-2">{issued.code}</p>
          <button onClick={() => { navigator.clipboard.writeText(issued.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-gold hover:text-gold/80">
            <Copy size={14} /> {copied ? "Copied!" : "Copy code"}
          </button>
        </div>
        <a href={`/book/${shop.slug}`} className="mt-6 inline-block text-sm text-[#8a8a8a] hover:text-white">Book an appointment at {shop.name} →</a>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-black pt-[env(safe-area-inset-top)]">
      <div className="max-w-md mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center text-white"><Gift size={22} /></div>
          <div>
            <h1 className="text-xl font-black text-white uppercase tracking-tight leading-none">{shop.name}</h1>
            <p className="text-sm text-[#8a8a8a] mt-1">Buy a gift card</p>
          </div>
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

        {/* Amount */}
        <label className="text-xs text-[#8f8f8f] block mb-2">Amount</label>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {AMOUNTS.map(v => (
            <button key={v} onClick={() => setAmount(v)}
              className={cn("py-3 rounded-xl border font-bold transition-colors",
                amount === v ? "bg-white text-black border-white" : "bg-[#141414] border-[#2a2a2a] text-white hover:border-[#333]")}>
              ${v}
            </button>
          ))}
        </div>
        <input type="number" min="1" max="1000" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Custom amount"
          className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-[#333]" />

        {/* Recipient + buyer */}
        <div className="space-y-3 mt-5">
          <p className="text-xs text-[#8f8f8f]">Who's it for? (optional — leave blank to get the code yourself)</p>
          <input value={form.recipient_name} onChange={e => setForm(p => ({ ...p, recipient_name: e.target.value }))} placeholder="Recipient name"
            className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-[#333]" />
          <input type="email" value={form.recipient_email} onChange={e => setForm(p => ({ ...p, recipient_email: e.target.value }))} placeholder="Recipient email (we'll send them the card)"
            className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-[#333]" />
          <textarea value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} placeholder="Add a note (optional)" rows={2}
            className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-[#333]" />
          <div className="border-t border-[#2a2a2a] pt-3 space-y-3">
            <p className="text-xs text-[#8f8f8f]">Your details (for the receipt)</p>
            <input value={form.purchaser_name} onChange={e => setForm(p => ({ ...p, purchaser_name: e.target.value }))} placeholder="Your name"
              className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-[#333]" />
            <input type="email" value={form.purchaser_email} onChange={e => setForm(p => ({ ...p, purchaser_email: e.target.value }))} placeholder="Your email *"
              className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-[#333]" />
          </div>
        </div>

        <Button className="w-full mt-6" loading={submitting} onClick={buy}>
          Pay {formatCurrency(Number(amount) || 0)}
        </Button>
        <p className="text-[11px] text-[#8f8f8f] text-center mt-3">Secure payment via Stripe · Redeemable at {shop.name}</p>
      </div>
    </div>
  );
}
