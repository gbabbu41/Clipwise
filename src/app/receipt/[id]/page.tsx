"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Check, Scissors, Share2, Printer } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import type { Transaction } from "@/lib/database.types";

interface ReceiptRow extends Transaction {
  shops?: { name: string; address: string; city: string; province: string; phone: string; booking_settings?: { tax_number?: string; pst_number?: string; tax_label?: string } | null } | null;
  barbers?: { name: string } | null;
}

export default function ReceiptPage() {
  const params = useParams();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [tx, setTx] = useState<ReceiptRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) { setNotFound(true); setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from("transactions")
        .select("*, shops(name, address, city, province, phone, booking_settings), barbers(name)")
        .eq("id", id)
        .single();
      if (!data) { setNotFound(true); setLoading(false); return; }
      setTx(data as unknown as ReceiptRow);
      setLoading(false);
    })();
  }, [id]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !tx) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <Logo size="md" className="justify-center mb-8" />
        <div className="bg-surface border border-border rounded-2xl p-8 max-w-sm">
          <Scissors size={40} className="text-[#999] mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Receipt Not Found</h1>
          <p className="text-[#6e6e6e] text-sm">This receipt link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  const taxAmt = tx.tax ?? 0;
  const total = tx.amount + taxAmt + tx.tip;
  const taxLabel = (tx.shops?.booking_settings?.tax_label || "Tax").trim() || "Tax";
  const taxRatePct = tx.amount > 0 && taxAmt > 0 ? Math.round((taxAmt / tx.amount) * 1000) / 10 : 0;
  const txDate = new Date(tx.created_at);
  const formattedDate = txDate.toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const formattedTime = txDate.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-sm mx-auto px-4 py-8">
        <Logo size="md" className="justify-center mb-8" />

        {/* Receipt card */}
        <div className={cn(
          "bg-surface border border-border rounded-3xl overflow-hidden",
          "print:border-0 print:shadow-none"
        )}>
          {/* Header */}
          <div className="bg-gold/10 border-b border-gold/20 px-6 py-5 text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
              <Check size={22} className="text-emerald-400" />
            </div>
            <h1 className="text-lg font-bold text-white">{tx.shops?.name ?? "ClipWise Shop"}</h1>
            {tx.shops?.address && (
              <p className="text-xs text-[#6e6e6e] mt-1">{tx.shops.address}, {tx.shops.city}, {tx.shops.province}</p>
            )}
            {tx.shops?.phone && (
              <p className="text-xs text-[#6e6e6e]">{tx.shops.phone}</p>
            )}
            {tx.shops?.booking_settings?.tax_number && (
              <p className="text-xs text-[#6e6e6e] mt-1">GST/HST No. {tx.shops.booking_settings.tax_number}</p>
            )}
            {tx.shops?.booking_settings?.pst_number && (
              <p className="text-xs text-[#6e6e6e]">PST/QST No. {tx.shops.booking_settings.pst_number}</p>
            )}
          </div>

          {/* Details */}
          <div className="px-6 py-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-[#6e6e6e]">Date</span>
              <span className="text-white text-right">{formattedDate}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#6e6e6e]">Time</span>
              <span className="text-white">{formattedTime}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#6e6e6e]">Client</span>
              <span className="text-white">{tx.client_name}</span>
            </div>
            {tx.barbers?.name && (
              <div className="flex justify-between text-sm">
                <span className="text-[#6e6e6e]">Barber</span>
                <span className="text-white">{tx.barbers.name}</span>
              </div>
            )}
            {tx.service_name && (
              <div className="flex justify-between text-sm">
                <span className="text-[#6e6e6e]">Service</span>
                <span className="text-white">{tx.service_name}</span>
              </div>
            )}
          </div>

          {/* Dashed divider */}
          <div className="px-6">
            <div className="border-t-2 border-dashed border-border" />
          </div>

          {/* Pricing */}
          <div className="px-6 py-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[#6e6e6e]">Subtotal</span>
              <span className="text-white">{formatCurrency(tx.amount)}</span>
            </div>
            {taxAmt > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[#6e6e6e]">{taxLabel}{taxRatePct > 0 ? ` (${taxRatePct}%)` : ""}</span>
                <span className="text-white">{formatCurrency(taxAmt)}</span>
              </div>
            )}
            {tx.tip > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[#6e6e6e]">Tip</span>
                <span className="text-emerald-400">{formatCurrency(tx.tip)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg border-t border-border pt-2 mt-1">
              <span className="text-white">Total</span>
              <span className="text-gold">{formatCurrency(total)}</span>
            </div>
            <div className="flex justify-between text-sm pt-1">
              <span className="text-[#6e6e6e]">Payment</span>
              <span className="text-white capitalize">{tx.payment_method ?? "card"}</span>
            </div>
          </div>

          {/* Dashed divider */}
          <div className="px-6">
            <div className="border-t-2 border-dashed border-border" />
          </div>

          {/* Footer */}
          <div className="px-6 py-4 text-center">
            <p className="text-xs text-[#8f8f8f]">Transaction ID</p>
            <p className="text-xs font-mono text-gold mt-0.5">{tx.id.slice(0, 16).toUpperCase()}</p>
            <p className="text-xs text-[#999] mt-3">Thank you for your visit!</p>
            <p className="text-xs text-[#aaa] mt-1">Powered by <span className="text-gold font-semibold">ClipWise</span></p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-4 print:hidden">
          <Button variant="outline" className="flex-1" onClick={() => window.print()}>
            <Printer size={15} /> Print
          </Button>
          <Button variant="outline" className="flex-1" onClick={copyLink}>
            {copied ? <Check size={15} /> : <Share2 size={15} />}
            {copied ? "Copied!" : "Share"}
          </Button>
        </div>
      </div>
    </div>
  );
}
