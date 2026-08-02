"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Landmark, PiggyBank } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { collectedTotals, type RevAppt, type RevTx } from "@/lib/revenue";
import { shopChargesTax, taxLabelDetailed, type TaxConfig } from "@/lib/pricing";
import { formatCurrency, cn } from "@/lib/utils";

const QUARTERS = [
  { key: "Q1", label: "Jan – Mar", from: 0, to: 2 },
  { key: "Q2", label: "Apr – Jun", from: 3, to: 5 },
  { key: "Q3", label: "Jul – Sep", from: 6, to: 8 },
  { key: "Q4", label: "Oct – Dec", from: 9, to: 11 },
];

export default function TaxCollectedPage() {
  const { shop } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [appts, setAppts] = useState<(RevAppt & { date: string })[]>([]);
  const [txs, setTxs] = useState<(RevTx & { created_at: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const cfg = (shop?.booking_settings ?? null) as TaxConfig | null;
  const charges = shopChargesTax(cfg ?? undefined);
  const taxLabel = taxLabelDetailed(cfg ?? undefined) || "Sales tax";

  const load = useCallback(async () => {
    if (!shop?.id) return;
    setLoading(true);
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const [a, t] = await Promise.all([
      supabase.from("appointments")
        .select("client_name, total_amount, tax_amount, payment_status, payment_method, payment_intent_id, status, date")
        .eq("shop_id", shop.id).gte("date", from).lte("date", to),
      supabase.from("transactions")
        .select("client_name, service_name, amount, tip, tax, payment_method, payment_intent_id, stripe_session_id, source, refunded, created_at")
        .eq("shop_id", shop.id).gte("created_at", from).lte("created_at", `${to}T23:59:59`),
    ]);
    setAppts((a.data ?? []) as (RevAppt & { date: string })[]);
    setTxs((t.data ?? []) as (RevTx & { created_at: string })[]);
    setLoading(false);
  }, [shop?.id, year]);

  useEffect(() => { load(); }, [load]);

  const monthOf = (iso: string) => new Date(iso + (iso.length <= 10 ? "T00:00:00" : "")).getMonth();
  const quarterTax = (q: typeof QUARTERS[number]) => {
    const a = appts.filter(x => { const m = monthOf(x.date); return m >= q.from && m <= q.to; });
    const t = txs.filter(x => { const m = monthOf(x.created_at); return m >= q.from && m <= q.to; });
    return collectedTotals(a, t).tax;
  };
  const perQuarter = QUARTERS.map(q => ({ ...q, tax: quarterTax(q) }));
  const yearTax = collectedTotals(appts, txs).tax;

  const years = [now.getFullYear(), now.getFullYear() - 1];

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Link href="/dashboard/payments" className="inline-flex items-center gap-1 text-xs text-grey hover:text-foreground mb-1">
            <ArrowLeft size={13} /> Payments
          </Link>
          <h1 className="text-xl font-bold text-foreground">{taxLabel.split(" ")[0] || "Tax"} collected</h1>
        </div>
        <div className="flex gap-1">
          {years.map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={cn("text-xs px-3 py-1.5 rounded-full border transition-colors",
                y === year ? "bg-accent text-black border-accent" : "border-border text-grey hover:text-foreground")}>
              {y}
            </button>
          ))}
        </div>
      </div>

      {!charges ? (
        <Card className="border-border"><CardContent className="py-8 text-center">
          <Landmark size={22} className="mx-auto mb-2 text-grey" />
          <p className="text-sm text-grey">You&apos;re not charging sales tax yet. Turn it on and add your GST/HST number in <Link href="/dashboard/settings" className="text-gold hover:underline">Settings</Link> and it&apos;ll be tracked here.</p>
        </CardContent></Card>
      ) : (
        <>
          {/* Hero — collected this year + set-aside framing */}
          <Card className="border-border">
            <CardContent className="py-5">
              <p className="text-[10.5px] uppercase tracking-[0.14em] text-grey-muted">{taxLabel} collected · {year}</p>
              <p className="text-[38px] font-bold text-foreground font-mono tracking-[-0.02em] leading-none mt-2">
                {loading ? "—" : formatCurrency(yearTax)}
              </p>
              <div className="flex items-start gap-2 mt-3 text-[13px] text-grey">
                <PiggyBank size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                <p>Set this aside — it isn&apos;t yours to keep. You remit it to the CRA on your filing schedule, minus the tax you paid on business expenses (input tax credits).</p>
              </div>
            </CardContent>
          </Card>

          {/* Per-quarter */}
          <div className="grid grid-cols-2 gap-3">
            {perQuarter.map(q => (
              <Card key={q.key} className="border-border">
                <CardContent className="py-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-semibold text-foreground">{q.key}</span>
                    <span className="text-[11px] text-grey-muted">{q.label}</span>
                  </div>
                  <p className="text-xl font-bold text-foreground font-mono tabular-nums mt-1">
                    {loading ? "—" : formatCurrency(q.tax)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="text-xs text-grey-muted leading-relaxed">
            Shows {taxLabel} <b className="text-grey">collected</b> on paid appointments, POS and gift-card sales.
            It&apos;s the amount before input tax credits — your actual remittance will be lower once you subtract
            the tax you paid on supplies, rent, and subscriptions. Confirm figures with your bookkeeper before filing.
          </p>
        </>
      )}
    </div>
  );
}
