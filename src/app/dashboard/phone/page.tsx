"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Phone, PhoneMissed, PhoneOff, CheckCircle2, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { cn, timeAgo } from "@/lib/utils";

type Period = "week" | "month" | "all";
type CallLog = {
  id: string;
  caller_number: string | null;
  call_time: string | null;
  outcome: string | null;        // booked | missed | abandoned
  duration_seconds: number | null;
};

const PERIODS: { key: Period; label: string }[] = [
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];

export default function PhoneActivityPage() {
  const { shop } = useAuth();
  const [period, setPeriod] = useState<Period>("week");
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasNumber, setHasNumber] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    if (!shop?.id) return;
    setLoading(true);
    const now = new Date();
    let from = "1970-01-01";
    if (period === "week") { const d = new Date(now); d.setDate(d.getDate() - 7); from = d.toISOString(); }
    else if (period === "month") { const d = new Date(now); d.setMonth(d.getMonth() - 1); from = d.toISOString(); }

    // Errors (e.g. pre-phase39 schema / no number) leave an empty state.
    const shopRes = await supabase.from("shops").select("twilio_phone_number").eq("id", shop.id).maybeSingle();
    setHasNumber(!!shopRes.data?.twilio_phone_number);

    const { data } = await supabase
      .from("call_logs")
      .select("id, caller_number, call_time, outcome, duration_seconds")
      .eq("shop_id", shop.id)
      .gte("call_time", from)
      .order("call_time", { ascending: false })
      .limit(100);
    setLogs((data ?? []) as CallLog[]);
    setLoading(false);
  }, [shop?.id, period]);

  useEffect(() => { load(); }, [load]);

  const total = logs.length;
  const booked = logs.filter(l => l.outcome === "booked").length;
  const missed = logs.filter(l => l.outcome === "missed").length;
  const abandoned = logs.filter(l => l.outcome === "abandoned").length;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const stat = (icon: React.ReactNode, label: string, value: string, tone: string) => (
    <Card className="border-border">
      <CardContent className="py-4">
        <div className={cn("flex items-center gap-2 mb-1", tone)}>{icon}<span className="text-xs text-grey">{label}</span></div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Link href="/dashboard/settings" className="inline-flex items-center gap-1 text-xs text-grey hover:text-foreground mb-1">
            <ArrowLeft size={13} /> Settings
          </Link>
          <h1 className="text-xl font-bold text-foreground">Phone Activity</h1>
        </div>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={cn("text-xs px-3 py-1.5 rounded-full border transition-colors",
                period === p.key ? "bg-accent text-black border-accent" : "border-border text-grey hover:text-foreground")}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {hasNumber === false ? (
        <Card className="border-border"><CardContent className="py-8 text-center">
          <Phone size={24} className="mx-auto mb-2 text-grey" />
          <p className="text-sm text-grey">No business number yet. Get one from <Link href="/dashboard/settings" className="text-gold hover:underline">Settings → Business Phone</Link> to start taking booking calls.</p>
        </CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {stat(<Phone size={15} />, "Total calls", String(total), "text-foreground")}
            {stat(<CheckCircle2 size={15} />, "Booked", `${booked} · ${pct(booked)}%`, "text-emerald-400")}
            {stat(<PhoneMissed size={15} />, "Missed → SMS", `${missed} · ${pct(missed)}%`, "text-amber-400")}
            {stat(<PhoneOff size={15} />, "Abandoned", `${abandoned} · ${pct(abandoned)}%`, "text-grey")}
          </div>

          <Card className="border-border">
            <CardContent className="py-2 divide-y divide-border">
              {loading ? (
                <p className="text-sm text-grey py-6 text-center">Loading…</p>
              ) : logs.length === 0 ? (
                <p className="text-sm text-grey py-6 text-center">No calls in this period yet.</p>
              ) : logs.map(l => {
                const isBooked = l.outcome === "booked";
                const Icon = isBooked ? CheckCircle2 : l.outcome === "abandoned" ? PhoneOff : PhoneMissed;
                const tone = isBooked ? "text-emerald-400" : l.outcome === "abandoned" ? "text-grey" : "text-amber-400";
                return (
                  <div key={l.id} className="flex items-center gap-3 py-2.5">
                    <Icon size={16} className={cn("flex-shrink-0", tone)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{l.caller_number || "Unknown caller"}</p>
                      <p className="text-xs text-grey capitalize">{isBooked ? "Booked via AI" : l.outcome === "abandoned" ? "Abandoned" : "Missed → text sent"}</p>
                    </div>
                    <span className="text-xs text-grey-muted flex-shrink-0">{timeAgo(l.call_time)}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
