"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Heart, Check, Scissors } from "lucide-react";
import { MKT_CSS } from "@/lib/marketing-theme";
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

// Thin themed wrapper so every state shares the black/white theme + wordmark.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mkt">
      <style dangerouslySetInnerHTML={{ __html: MKT_CSS }} />
      <div className="authwrap" style={{ justifyContent: "flex-start" }}>
        <div className="authbrand" style={{ marginBottom: 20 }}>
          <Link href="/" className="wm">CLIPWISE</Link>
        </div>
        {children}
      </div>
    </div>
  );
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
    <div className="mkt">
      <style dangerouslySetInnerHTML={{ __html: MKT_CSS }} />
      <div className="authwrap"><div style={{ width: 32, height: 32, border: "2px solid rgba(255,255,255,.25)", borderTopColor: "#fff", borderRadius: 999, animation: "mktspin 0.8s linear infinite" }} /></div>
      <style dangerouslySetInnerHTML={{ __html: "@keyframes mktspin{to{transform:rotate(360deg)}}" }} />
    </div>
  );

  if (paid) return (
    <Shell>
      <div className="authcard" style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        <div className="logo-fb" style={{ width: 60, height: 60, borderRadius: 999 }}><Check size={28} style={{ color: "var(--t1)" }} /></div>
        <h1 style={{ fontSize: 21, fontWeight: 700 }}>Thank you! 🎉</h1>
        <p className="lead" style={{ fontSize: 14, textAlign: "center" }}>Your tip went straight to {booking?.shops?.name ?? "the shop"}. They&rsquo;ll appreciate it.</p>
      </div>
    </Shell>
  );

  if (notFound || !booking) return (
    <Shell>
      <div className="authcard" style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        <Scissors size={38} style={{ color: "var(--t3)" }} />
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Link not found</h1>
        <p className="lead" style={{ fontSize: 14, textAlign: "center" }}>This tip link is invalid or has expired.</p>
      </div>
    </Shell>
  );

  return (
    <Shell>
      <div className="center" style={{ marginBottom: 20 }}>
        <div className="logo-fb" style={{ width: 60, height: 60, borderRadius: 16, margin: "0 auto 14px" }}><Heart size={26} style={{ color: "var(--t1)" }} /></div>
        <h1 style={{ fontSize: 21, fontWeight: 700 }}>Leave a tip</h1>
        <p className="lead" style={{ textAlign: "center", fontSize: 14, marginTop: 4 }}>
          for {booking.barbers?.name ? <strong style={{ color: "var(--t1)" }}>{booking.barbers.name}</strong> : booking.shops?.name}
          {booking.services?.name ? ` · ${booking.services.name}` : ""}
        </p>
      </div>

      {cancelled && <p style={{ fontSize: 12.5, color: "var(--warn)", textAlign: "center", marginBottom: 14 }}>Payment cancelled — you can try again below.</p>}

      <div className="authcard">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 16 }}>
          {TIP_PRESET_PERCENTS.map(p => {
            const amt = Math.round(base * p) / 100;
            const active = pct === p;
            return (
              <button key={p} onClick={() => { setPct(p); setCustom(""); setError(""); }}
                style={{ borderRadius: 12, padding: "12px 0", textAlign: "center", cursor: "pointer", background: active ? "#fff" : "#000", border: active ? "1px solid #fff" : "1px solid var(--line2)", color: active ? "#000" : "var(--t1)" }}>
                <span style={{ display: "block", fontSize: 17, fontWeight: 700 }}>{p}%</span>
                <span style={{ display: "block", fontSize: 12, color: active ? "rgba(0,0,0,.6)" : "var(--t3)" }}>{formatCurrency(amt)}</span>
              </button>
            );
          })}
        </div>

        <div className="field">
          <label>Custom amount</label>
          <div className="ip">
            <span className="lic" style={{ left: 14 }}>$</span>
            <input type="number" min={1} step="1" inputMode="decimal" className="pl" value={custom}
              onChange={e => { setCustom(e.target.value); setPct(null); setError(""); }} placeholder="0.00" />
          </div>
        </div>

        {error && <p style={{ fontSize: 13.5, color: "#ff8a8a", marginBottom: 12 }}>{error}</p>}

        <button className="pill w full" disabled={paying || tipAmount < 1} onClick={pay}>
          {paying ? "Starting…" : tipAmount >= 1 ? `Tip ${formatCurrency(tipAmount)}` : "Choose a tip"}
        </button>
        <p className="fine" style={{ textAlign: "center", marginTop: 12 }}>Secure payment — your tip goes directly to the shop.</p>
      </div>

      <p className="authback" style={{ marginTop: 22 }}>Powered by <span style={{ color: "var(--t1)", fontWeight: 700, marginLeft: 4 }}>ClipWise</span></p>
    </Shell>
  );
}
