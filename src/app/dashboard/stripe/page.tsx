"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Smartphone, Check, AlertTriangle, ExternalLink, Gift, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { isNativeApp } from "@/lib/native-app";
import { useResetOnReturn } from "@/lib/use-reset-on-return";
import { formatCurrency } from "@/lib/utils";
import { hardwareCreditCents, HARDWARE_CREDIT_MAX_CENTS } from "@/lib/hardware-credit-config";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { DashboardHeader } from "@/components/dashboard/page-header";

// Where a barber buys their own WisePad 3. This links out for now; at go-live it
// becomes Stripe's hardware-shop EMBEDDED COMPONENT (they buy in-page, direct from
// Stripe — they pay, own it, get the tax invoice). See CAPACITOR.md.
const READER_STORE = "https://stripe.com/terminal/wisepad3";

type ConnectStatus = { connected: boolean; status: string; checkError?: boolean };

/**
 * Card Reader & payouts — WEB ONLY (Apple IAP: hardware purchase + the
 * subscription credit are money surfaces, so they never appear in the native app;
 * middleware + this self-guard keep it off the app). The app's own reader screen
 * (/dashboard/pos/reader) only PAIRS/uses a reader; buying + the credit live here.
 */
export default function CardReaderPage() {
  const router = useRouter();
  const { shop, accessToken } = useAuth();
  // Defense-in-depth: this page is money-adjacent, so never render it in the app.
  useEffect(() => { if (isNativeApp()) router.replace("/dashboard"); }, [router]);

  const [connect, setConnect] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  useResetOnReturn(() => setConnecting(false));

  const creditLabel = formatCurrency(hardwareCreditCents() / 100);
  const capLabel = formatCurrency(HARDWARE_CREDIT_MAX_CENTS / 100);
  const creditGranted = !!(shop as { hardware_credit_granted?: boolean } | null)?.hardware_credit_granted;

  const load = useCallback(async () => {
    if (!accessToken || !shop?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/stripe/connect/status?shop_id=${encodeURIComponent(shop.id)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setConnect(res.ok ? await res.json() : null);
    } catch { setConnect(null); }
    setLoading(false);
  }, [accessToken, shop?.id]);
  useEffect(() => { load(); }, [load]);

  const startConnect = async () => {
    if (!accessToken) return;
    setConnecting(true);
    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shop?.id }),
      });
      const data = await res.json();
      if (res.ok && data.url) { window.location.href = data.url; return; }
    } catch { /* fall through */ }
    setConnecting(false);
  };

  const connected = connect?.connected;

  return (
    <div className="min-h-screen bg-background px-4 sm:px-6 pb-28 space-y-5">
      <DashboardHeader title="Card Reader" subtitle="Take in-person payments & get your reader" />

      {/* 1 — Stripe payouts / Connect status */}
      <Card className="border-border max-w-2xl">
        <CardHeader>
          <div>
            <CardTitle>Get paid</CardTitle>
            <p className="text-sm text-grey mt-1">In-person card payments run on your own Stripe account (you&rsquo;re the merchant — 0% platform fee).</p>
          </div>
          <CreditCard size={20} className="text-grey" />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-grey text-sm"><Loader2 size={16} className="animate-spin" /> Checking your Stripe status…</div>
          ) : connected ? (
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
              <Check size={16} /> Your Stripe account is connected and ready to take cards.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-amber-300 text-sm">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <p>Finish your Stripe setup to accept in-person card payments and receive payouts. Takes a couple of minutes.</p>
              </div>
              <Button loading={connecting} onClick={startConnect}>Finish Stripe setup</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2 — How you take cards */}
      <Card className="border-border max-w-2xl">
        <CardHeader><CardTitle>Two ways to take a card</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-card-raised border border-border flex items-center justify-center flex-shrink-0"><Smartphone size={18} className="text-foreground" /></span>
            <div>
              <p className="text-sm font-semibold text-foreground">Tap to Pay on iPhone <span className="text-emerald-400 font-medium">· no hardware</span></p>
              <p className="text-xs text-grey mt-0.5">Take tap payments right on your iPhone — no reader to buy. Set up in the ClipWise app once you&rsquo;re connected.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-card-raised border border-border flex items-center justify-center flex-shrink-0"><CreditCard size={18} className="text-foreground" /></span>
            <div>
              <p className="text-sm font-semibold text-foreground">WisePad 3 reader <span className="text-grey font-medium">· chip + Interac PIN</span></p>
              <p className="text-xs text-grey mt-0.5">A dedicated Bluetooth reader for chip &amp; Interac. You buy it from Stripe below and it&rsquo;s yours to keep.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3 — Buy a reader + the credit offer */}
      <Card className="border-border max-w-2xl">
        <CardHeader>
          <div>
            <CardTitle>Get a WisePad 3</CardTitle>
            <p className="text-sm text-grey mt-1">Bought directly from Stripe — you pay, you own it, and it ships to your shop.</p>
          </div>
          <Gift size={20} className="text-emerald-400" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-4">
            {creditGranted ? (
              <p className="text-sm text-emerald-300 font-medium flex items-center gap-2"><Check size={16} /> Your reader credit has been applied to your plan. Thanks for getting set up!</p>
            ) : (
              <>
                <p className="text-sm font-semibold text-emerald-300">Buy a reader, get {creditLabel} back on your plan</p>
                <p className="text-xs text-emerald-200/80 mt-1">
                  We credit <span className="font-semibold">up to 50%</span> of your WisePad 3 (max {capLabel}) to your ClipWise subscription once you start taking payments on it. The reader is yours to keep.
                </p>
              </>
            )}
          </div>

          {/* Buy link for now. Stripe's in-page hardware-shop embedded component is
              a PREVIEW feature not yet in the stable SDK; when it's available, swap
              this link for it + wire onCheckoutFinished → /api/stripe/terminal/
              hardware-credit (the account-session route + credit engine are ready). */}
          <a href={READER_STORE} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-white text-black text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-white/90 transition-colors">
            Get your WisePad 3 <ExternalLink size={15} />
          </a>
          <p className="text-[11px] text-grey-muted">Prices, taxes, and shipping are handled by Stripe. Don&rsquo;t need a reader? Tap to Pay on iPhone works with no hardware.</p>
        </CardContent>
      </Card>
    </div>
  );
}
