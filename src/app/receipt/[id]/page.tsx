"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check, Scissors, Share2, Printer, ArrowLeft } from "lucide-react";
import { MKT_CSS } from "@/lib/marketing-theme";
import { formatCurrency } from "@/lib/utils";
import type { Transaction } from "@/lib/database.types";

interface ReceiptRow extends Transaction {
  shops?: { name: string; address: string; city: string; province: string; phone: string; booking_settings?: { tax_number?: string; pst_number?: string; tax_label?: string } | null } | null;
  barbers?: { name: string } | null;
}

export default function ReceiptPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  // Get out of the receipt — critical in a standalone PWA, where this can open
  // as a chrome-less window with no browser back button (a dead end). Prefer
  // in-app history (returns the owner to Checkout); else home.
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/");
  };

  const [loading, setLoading] = useState(true);
  const [tx, setTx] = useState<ReceiptRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setNotFound(true); setLoading(false); return; }
    setLoading(true); setNotFound(false); setLoadError(false);
    // Load via the service-role API — transactions RLS is owner-only, so a
    // direct anon query made a SHARED receipt link dead-end ("Not Found") for
    // the customer it was sent to. The API returns only receipt-safe fields and
    // splits a real miss (404) from a transient error (retry).
    try {
      const res = await fetch(`/api/receipt/${id}`);
      if (res.status === 404) { setNotFound(true); setLoading(false); return; }
      if (!res.ok) { setLoadError(true); setLoading(false); return; }
      const { receipt } = await res.json();
      if (!receipt) { setNotFound(true); setLoading(false); return; }
      // Reshape into the row shape the receipt renders (keeps the JSX unchanged).
      setTx({
        ...receipt,
        shops: receipt.shop ? {
          name: receipt.shop.name, address: receipt.shop.address, city: receipt.shop.city,
          province: receipt.shop.province, phone: receipt.shop.phone,
          booking_settings: {
            tax_number: receipt.shop.tax_number, pst_number: receipt.shop.pst_number, tax_label: receipt.shop.tax_label,
          },
        } : null,
        barbers: receipt.barber ? { name: receipt.barber.name } : null,
      } as unknown as ReceiptRow);
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const copyLink = async () => {
    try {
      await navigator.clipboard?.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable (insecure context / older browser) */ }
  };

  const Wrap = ({ children }: { children: React.ReactNode }) => (
    <div className="mkt"><style dangerouslySetInnerHTML={{ __html: MKT_CSS }} />{children}</div>
  );

  if (loading) {
    return <Wrap><div className="authwrap"><span className="wm">CLIPWISE</span></div></Wrap>;
  }

  if (loadError || notFound || !tx) {
    return (
      <Wrap>
        <div className="authwrap" style={{ textAlign: "center" }}>
          <span className="wm" style={{ marginBottom: 14 }}>CLIPWISE</span>
          <Scissors size={38} style={{ color: "var(--t3)", margin: "0 auto 12px" }} />
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>{loadError ? "Couldn’t load this receipt" : "Receipt not found"}</h1>
          <p className="lead" style={{ textAlign: "center", marginTop: 6 }}>{loadError ? "Check your connection and try again." : "This receipt link is invalid or has expired."}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
            {loadError && <button onClick={() => load()} className="pill w">Try again</button>}
            <button onClick={goBack} className="pill g">Back</button>
          </div>
        </div>
      </Wrap>
    );
  }

  const taxAmt = tx.tax ?? 0;
  const total = tx.amount + taxAmt + tx.tip;
  const taxLabel = (tx.shops?.booking_settings?.tax_label || "Tax").trim() || "Tax";
  const taxRatePct = tx.amount > 0 && taxAmt > 0 ? Math.round((taxAmt / tx.amount) * 1000) / 10 : 0;
  const txDate = new Date(tx.created_at);
  const formattedDate = txDate.toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const formattedTime = txDate.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });

  const row = (l: string, v: React.ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
      <span style={{ color: "var(--t3)" }}>{l}</span>
      <span style={{ color: "var(--t1)", textAlign: "right" }}>{v}</span>
    </div>
  );

  return (
    <Wrap>
      <div className="authwrap" style={{ justifyContent: "flex-start", paddingTop: "clamp(32px,6vw,56px)" }}>
        <div style={{ width: "100%", maxWidth: 380 }}>
          <button type="button" onClick={goBack} className="print:hidden" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--t3)", fontSize: 14, marginBottom: 14, background: "none", border: "none", cursor: "pointer" }}>
            <ArrowLeft size={16} /> Back
          </button>
          <div className="authbrand" style={{ marginBottom: 20 }}><Link href="/" className="wm">CLIPWISE</Link></div>

          {/* Receipt card */}
          <div style={{ background: "var(--s1)", border: "1px solid var(--line)", borderRadius: 24, overflow: "hidden" }}>
            {/* Header */}
            <div style={{ background: "rgba(255,255,255,.04)", borderBottom: "1px solid var(--line)", padding: "20px 24px", textAlign: "center" }}>
              <div className="logo-fb" style={{ width: 48, height: 48, borderRadius: 14, margin: "0 auto 12px" }}><Check size={22} style={{ color: "var(--t1)" }} /></div>
              <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{tx.shops?.name ?? "ClipWise Shop"}</h1>
              {tx.shops?.address && <p style={{ fontSize: 12, color: "var(--t3)", marginTop: 4 }}>{tx.shops.address}, {tx.shops.city}, {tx.shops.province}</p>}
              {tx.shops?.phone && <p style={{ fontSize: 12, color: "var(--t3)" }}>{tx.shops.phone}</p>}
              {tx.shops?.booking_settings?.tax_number && <p style={{ fontSize: 12, color: "var(--t3)", marginTop: 4 }}>GST/HST No. {tx.shops.booking_settings.tax_number}</p>}
              {tx.shops?.booking_settings?.pst_number && <p style={{ fontSize: 12, color: "var(--t3)" }}>PST/QST No. {tx.shops.booking_settings.pst_number}</p>}
            </div>

            {/* Details */}
            <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
              {row("Date", formattedDate)}
              {row("Time", formattedTime)}
              {row("Client", tx.client_name)}
              {tx.barbers?.name && row("Barber", tx.barbers.name)}
              {tx.service_name && row("Service", tx.service_name)}
            </div>

            <div style={{ padding: "0 24px" }}><div style={{ borderTop: "2px dashed var(--line2)" }} /></div>

            {/* Pricing */}
            <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
              {row("Subtotal", formatCurrency(tx.amount))}
              {taxAmt > 0 && row(`${taxLabel}${taxRatePct > 0 ? ` (${taxRatePct}%)` : ""}`, formatCurrency(taxAmt))}
              {tx.tip > 0 && row("Tip", formatCurrency(tx.tip))}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 18, borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 4 }}>
                <span style={{ color: "var(--t1)" }}>Total</span>
                <span style={{ color: "var(--t1)" }}>{formatCurrency(total)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, paddingTop: 4 }}>
                <span style={{ color: "var(--t3)" }}>Payment</span>
                <span style={{ color: "var(--t1)", textTransform: "capitalize" }}>{tx.payment_method ?? "card"}</span>
              </div>
            </div>

            <div style={{ padding: "0 24px" }}><div style={{ borderTop: "2px dashed var(--line2)" }} /></div>

            {/* Footer */}
            <div style={{ padding: "16px 24px", textAlign: "center" }}>
              <p style={{ fontSize: 12, color: "var(--t3)" }}>Transaction ID</p>
              <p style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: "var(--t2)", marginTop: 2 }}>{tx.id.slice(0, 16).toUpperCase()}</p>
              <p style={{ fontSize: 12, color: "var(--t3)", marginTop: 12 }}>Thank you for your visit!</p>
              <p style={{ fontSize: 12, color: "var(--t3)", marginTop: 4 }}>Powered by <span style={{ color: "var(--t1)", fontWeight: 600 }}>ClipWise</span></p>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 12, marginTop: 16 }} className="print:hidden">
            <button className="pill g" style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={() => window.print()}><Printer size={15} /> Print</button>
            <button className="pill g" style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={copyLink}>{copied ? <Check size={15} /> : <Share2 size={15} />}{copied ? "Copied!" : "Share"}</button>
          </div>
        </div>
      </div>
    </Wrap>
  );
}
