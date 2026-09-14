"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { MKT_CSS } from "@/lib/marketing-theme";
import { formatCurrency } from "@/lib/utils";
import { validateEmail } from "@/lib/validation";
import { useResetOnReturn } from "@/lib/use-reset-on-return";
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
  // Back from Stripe restores this page from bfcache with `submitting` frozen —
  // clear it so the pay button doesn't spin forever.
  useResetOnReturn(() => setSubmitting(false));
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

  const inputCls = "w-full bg-black border border-[#24242A] rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#66666F] focus:outline-none focus:border-white/40";

  if (loading) return (
    <div className="mkt"><style dangerouslySetInnerHTML={{ __html: MKT_CSS }} />
      <div className="authwrap"><span className="wm">CLIPWISE</span></div>
    </div>
  );
  if (!shop) return (
    <div className="mkt"><style dangerouslySetInnerHTML={{ __html: MKT_CSS }} />
      <div className="authwrap" style={{ textAlign: "center" }}>
        <span className="wm" style={{ marginBottom: 14 }}>CLIPWISE</span>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Shop not found</h1>
        <p className="lead" style={{ textAlign: "center", marginTop: 6 }}>This gift card link isn&rsquo;t valid.</p>
      </div>
    </div>
  );

  // Success screen with the code.
  if (issued) return (
    <div className="mkt"><style dangerouslySetInnerHTML={{ __html: MKT_CSS }} />
      <div className="authwrap">
        <div className="center" style={{ maxWidth: 420 }}>
          <div className="logo-fb" style={{ width: 60, height: 60, borderRadius: 999, margin: "0 auto 18px" }}><Check size={28} style={{ color: "var(--t1)" }} /></div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>Gift card sent!</h1>
          <p className="lead" style={{ textAlign: "center", marginTop: 8 }}>A {formatCurrency(issued.amount)} gift card for {shop.name}{form.recipient_email ? ` was emailed to ${form.recipient_email}` : " is ready"}.</p>
          <div style={{ marginTop: 24, padding: 20, borderRadius: 16, border: "2px dashed var(--line2)", background: "var(--s1)" }}>
            <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".2em", color: "var(--t3)" }}>Gift card code</p>
            <p style={{ fontSize: 24, fontWeight: 800, fontFamily: "ui-monospace, monospace", letterSpacing: ".15em", marginTop: 8, color: "var(--t1)" }}>{issued.code}</p>
            <button onClick={() => { navigator.clipboard?.writeText(issued.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
              className="authlink" style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--t1)" }}>
              <Copy size={14} /> {copied ? "Copied!" : "Copy code"}
            </button>
          </div>
          <p className="authback" style={{ marginTop: 24 }}><Link href={`/book/${shop.slug}`}>Book an appointment at {shop.name} →</Link></p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="mkt"><style dangerouslySetInnerHTML={{ __html: MKT_CSS }} />
      <div className="authwrap" style={{ justifyContent: "flex-start", paddingTop: "clamp(40px,7vw,72px)" }}>
        <div style={{ width: "100%", maxWidth: 440 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
            <div className="logo-fb" style={{ width: 48, height: 48 }}><Gift size={22} style={{ color: "var(--t1)" }} /></div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1, margin: 0 }}>{shop.name}</h1>
              <p style={{ fontSize: 14, color: "var(--t3)", marginTop: 4 }}>Buy a gift card</p>
            </div>
          </div>

          {error && <div className="err">{error}</div>}

          <label style={{ fontSize: 12.5, color: "var(--t3)", display: "block", marginBottom: 8 }}>Amount</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 12 }}>
            {AMOUNTS.map(v => (
              <button key={v} onClick={() => setAmount(v)}
                style={{ padding: "12px 0", borderRadius: 12, fontWeight: 700, cursor: "pointer", background: amount === v ? "#fff" : "var(--s1)", border: amount === v ? "1px solid #fff" : "1px solid var(--line2)", color: amount === v ? "#000" : "var(--t1)" }}>
                ${v}
              </button>
            ))}
          </div>
          <input type="number" min="1" max="1000" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Custom amount" className={inputCls} />

          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
            <p style={{ fontSize: 12.5, color: "var(--t3)", margin: 0 }}>Who&rsquo;s it for? (optional — leave blank to get the code yourself)</p>
            <input value={form.recipient_name} onChange={e => setForm(p => ({ ...p, recipient_name: e.target.value }))} placeholder="Recipient name" className={inputCls} />
            <input type="email" value={form.recipient_email} onChange={e => setForm(p => ({ ...p, recipient_email: e.target.value }))} placeholder="Recipient email (we'll send them the card)" className={inputCls} />
            <textarea value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} placeholder="Add a note (optional)" rows={2} className={inputCls} style={{ resize: "none" }} />
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 12.5, color: "var(--t3)", margin: 0 }}>Your details (for the receipt)</p>
              <input value={form.purchaser_name} onChange={e => setForm(p => ({ ...p, purchaser_name: e.target.value }))} placeholder="Your name" className={inputCls} />
              <input type="email" value={form.purchaser_email} onChange={e => setForm(p => ({ ...p, purchaser_email: e.target.value }))} placeholder="Your email *" className={inputCls} />
            </div>
          </div>

          <button className="pill w full" style={{ marginTop: 22 }} disabled={submitting} onClick={buy}>
            {submitting ? "Starting…" : `Pay ${formatCurrency(Number(amount) || 0)}`}
          </button>
          <p className="fine" style={{ textAlign: "center", marginTop: 12 }}>Secure payment via Stripe · Redeemable at {shop.name}</p>
        </div>
      </div>
    </div>
  );
}
