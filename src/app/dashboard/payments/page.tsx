"use client";
import { useEffect, useState, useCallback } from "react";
import { ExternalLink, RefreshCw, Send, CreditCard, Banknote, Clock, Check } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { formatCurrency, cn } from "@/lib/utils";

// ── Row shapes ────────────────────────────────────────────────────────────────
interface ApptRow {
  id: string;
  client_name: string;
  client_email: string | null;
  date: string;
  time_slot: string;
  total_amount: number | null;
  payment_status: string | null;
  payment_method: string | null;
  payment_intent_id: string | null;
  services: { name: string } | null;
  barbers: { name: string } | null;
}
interface TxRow {
  id: string;
  client_name: string | null;
  service_name: string | null;
  amount: number;
  tip: number;
  payment_method: string | null;
  type: string;
  created_at: string;
}

type Filter = "all" | "collected" | "outstanding" | "pending" | "refunded";

// Status → label + tone. Mirrors the appointments page vocabulary so the two
// pages read consistently.
function statusInfo(s: string | null): { label: string; tone: "good" | "warn" | "active" | "muted" } {
  switch (s) {
    case "paid": return { label: "Paid", tone: "good" };
    case "captured": return { label: "Paid · Card", tone: "good" };
    case "held": return { label: "Card on hold", tone: "active" };
    case "saved": return { label: "Card on file", tone: "active" };
    case "refunded": return { label: "Refunded", tone: "muted" };
    case "failed": return { label: "Payment failed", tone: "warn" };
    case "unpaid": return { label: "Unpaid", tone: "warn" };
    default: return { label: "Unpaid", tone: "warn" };
  }
}
const toneClass: Record<string, string> = {
  good: "bg-[#00e5a0]/15 text-[#00e5a0]",
  warn: "bg-amber-500/15 text-amber-400",
  active: "bg-[#1a1a1a] text-white",
  muted: "bg-[#1a1a1a] text-[#888]",
};

export default function PaymentsPage() {
  const { shop, accessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [appts, setAppts] = useState<ApptRow[]>([]);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const loadData = useCallback(async () => {
    if (!shop) return;
    setLoading(true);
    const [{ data: a }, { data: t }] = await Promise.all([
      supabase.from("appointments")
        .select("id, client_name, client_email, date, time_slot, total_amount, payment_status, payment_method, payment_intent_id, services(name), barbers(name)")
        .eq("shop_id", shop.id).gt("total_amount", 0).order("date", { ascending: false }),
      supabase.from("transactions")
        .select("id, client_name, service_name, amount, tip, payment_method, type, created_at")
        .eq("shop_id", shop.id).order("created_at", { ascending: false }),
    ]);
    setAppts((a ?? []) as unknown as ApptRow[]);
    setTxs((t ?? []) as unknown as TxRow[]);
    setLoading(false);
  }, [shop]);
  useEffect(() => { loadData(); }, [loadData]);

  // ── Summary ────────────────────────────────────────────────────────────────
  const collectedFromAppts = appts
    .filter(a => a.payment_status === "paid" || a.payment_status === "captured")
    .reduce((s, a) => s + (a.total_amount ?? 0), 0);
  const collectedFromTx = txs.reduce((s, t) => s + (t.amount ?? 0) + (t.tip ?? 0), 0);
  const collected = collectedFromAppts + collectedFromTx;
  const outstanding = appts
    .filter(a => a.payment_status === "unpaid" || a.payment_status === "failed" || !a.payment_status)
    .reduce((s, a) => s + (a.total_amount ?? 0), 0);
  const pending = appts
    .filter(a => a.payment_status === "held" || a.payment_status === "saved")
    .reduce((s, a) => s + (a.total_amount ?? 0), 0);

  // ── Open the shop's Stripe Express dashboard ────────────────────────────────
  const openStripeDashboard = async () => {
    if (!shop || !accessToken) return;
    setBusy("stripe");
    const res = await fetch("/api/stripe/dashboard-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop.id }),
    });
    const data = await res.json();
    setBusy(null);
    if (res.ok && data.url) window.open(data.url, "_blank");
    else showToast(data.error ?? "Couldn't open Stripe dashboard.", false);
  };

  // ── Re-check a payment against Stripe ───────────────────────────────────────
  const refresh = async (appt: ApptRow) => {
    if (!accessToken) return;
    setBusy(appt.id);
    const res = await fetch("/api/stripe/refresh-payment", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: appt.id }),
    });
    const data = await res.json();
    setBusy(null);
    if (!data.ok) { showToast(data.error ?? "Refresh failed.", false); return; }
    setAppts(prev => prev.map(a => a.id === appt.id ? { ...a, payment_status: data.payment_status } : a));
    showToast(data.changed ? `Updated → ${statusInfo(data.payment_status).label}` : "No change — still " + statusInfo(data.payment_status).label.toLowerCase());
  };

  // ── Re-send a payment link (emails the customer) ────────────────────────────
  const sendLink = async (appt: ApptRow) => {
    setBusy(appt.id);
    const res = await fetch("/api/stripe/payment-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: appt.id, send_email: true }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) { showToast(data.error ?? "Couldn't create link.", false); return; }
    if (data.emailed) {
      showToast("Payment link emailed to the customer");
    } else if (data.url) {
      // No email on file — copy the link so the owner can still send/share it.
      try { await navigator.clipboard?.writeText(data.url); } catch { /* clipboard blocked */ }
      showToast("No email on file — payment link copied to clipboard");
    } else {
      showToast("Payment link created");
    }
  };

  const filteredAppts = appts.filter(a => {
    const s = a.payment_status;
    if (filter === "all") return true;
    if (filter === "collected") return s === "paid" || s === "captured";
    if (filter === "outstanding") return s === "unpaid" || s === "failed" || !s;
    if (filter === "pending") return s === "held" || s === "saved";
    if (filter === "refunded") return s === "refunded";
    return true;
  });
  // POS sales only show under All / Collected (they're always paid).
  const showTx = filter === "all" || filter === "collected";

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "collected", label: "Collected" },
    { key: "outstanding", label: "Outstanding" },
    { key: "pending", label: "Card held/on file" },
    { key: "refunded", label: "Refunded" },
  ];

  return (
    <div className="min-h-screen bg-black px-4 sm:px-6 py-6 max-w-5xl mx-auto pb-28">
      {toast && (
        <div className={cn("fixed bottom-24 right-4 z-[200] flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-medium",
          toast.ok ? "bg-emerald-900/80 border-emerald-500/40 text-emerald-300" : "bg-red-900/80 border-red-500/40 text-red-300")}>
          {toast.ok ? <Check size={15} /> : "✕"} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Payments</h1>
          <p className="text-sm text-[#777] mt-1">Track what you&apos;ve collected, what&apos;s outstanding, and cards on file.</p>
        </div>
        <button onClick={openStripeDashboard} disabled={busy === "stripe"}
          className="flex items-center gap-2 rounded-xl bg-white text-black text-sm font-semibold px-4 py-2.5 hover:opacity-90 disabled:opacity-50 transition-opacity">
          <ExternalLink size={15} /> {busy === "stripe" ? "Opening…" : "Open Stripe Dashboard"}
        </button>
      </div>

      {/* Stripe note */}
      <div className="rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] p-3 text-xs text-[#888] mb-6">
        💡 Stripe is the source of truth for every charge, refund, and payout. This page mirrors it inside ClipWise.
        If a paid link still shows as outstanding, hit <span className="text-white font-medium">Refresh</span> on that row to re-check Stripe.
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {[
          { label: "Collected", value: collected, hint: "Paid appointments + POS sales", cls: "text-[#00e5a0]" },
          { label: "Outstanding", value: outstanding, hint: "Unpaid / failed — send a link", cls: "text-amber-400" },
          { label: "Card held / on file", value: pending, hint: "Charged on completion / no-show", cls: "text-white" },
        ].map(c => (
          <div key={c.label} className="rounded-2xl border border-[#1e1e1e] bg-[#0c0c0c] p-4">
            <p className="text-xs text-[#777]">{c.label}</p>
            <p className={cn("text-2xl font-bold mt-1", c.cls)}>{formatCurrency(c.value)}</p>
            <p className="text-[11px] text-[#666] mt-1">{c.hint}</p>
          </div>
        ))}
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap mb-4">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={cn("px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all",
              filter === f.key ? "bg-white text-black border-white" : "border-[#1e1e1e] text-[#777] hover:text-white")}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-[#777] text-sm">Loading payments…</div>
      ) : (
        <div className="space-y-2">
          {filteredAppts.length === 0 && !(showTx && txs.length > 0) && (
            <div className="py-16 text-center text-[#777] text-sm">No payments here yet.</div>
          )}

          {/* Appointment payments */}
          {filteredAppts.map(a => {
            const info = statusInfo(a.payment_status);
            const canRefresh = !!a.payment_intent_id && a.payment_status !== "paid" && a.payment_status !== "captured" && a.payment_status !== "refunded";
            const canSendLink = (a.payment_status === "unpaid" || a.payment_status === "failed" || !a.payment_status) && (a.total_amount ?? 0) > 0;
            return (
              <div key={a.id} className="rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] p-4 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <p className="text-sm font-semibold text-white">{a.client_name}</p>
                  <p className="text-xs text-[#777]">
                    {a.services?.name ?? "Service"} · {a.date} · {a.time_slot}
                    {a.barbers?.name ? ` · ${a.barbers.name}` : ""}
                  </p>
                </div>
                <span className="text-base font-bold text-white">{formatCurrency(a.total_amount ?? 0)}</span>
                <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full", toneClass[info.tone])}>{info.label}</span>
                {canSendLink && (
                  <button onClick={() => sendLink(a)} disabled={busy === a.id}
                    className="flex items-center gap-1.5 rounded-lg border border-[#1e1e1e] text-[#aaa] hover:text-white text-xs px-3 py-1.5 disabled:opacity-50">
                    <Send size={13} /> {busy === a.id ? "…" : "Send link"}
                  </button>
                )}
                {canRefresh && (
                  <button onClick={() => refresh(a)} disabled={busy === a.id}
                    className="flex items-center gap-1.5 rounded-lg border border-[#1e1e1e] text-[#aaa] hover:text-white text-xs px-3 py-1.5 disabled:opacity-50">
                    <RefreshCw size={13} className={busy === a.id ? "animate-spin" : ""} /> Refresh
                  </button>
                )}
              </div>
            );
          })}

          {/* POS sales */}
          {showTx && txs.map(t => (
            <div key={t.id} className="rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] p-4 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <p className="text-sm font-semibold text-white">{t.client_name || "Walk-in"}</p>
                <p className="text-xs text-[#777]">
                  {t.service_name || "Sale"} · POS · {new Date(t.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                </p>
              </div>
              <span className="text-base font-bold text-white">{formatCurrency((t.amount ?? 0) + (t.tip ?? 0))}</span>
              <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#00e5a0]/15 text-[#00e5a0]">
                {t.payment_method === "cash" ? <Banknote size={12} /> : <CreditCard size={12} />}
                Paid{t.payment_method ? ` · ${t.payment_method === "cash" ? "Cash" : "Card"}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Footer hint about held/saved timing */}
      <div className="mt-6 flex items-start gap-2 text-xs text-[#666]">
        <Clock size={14} className="mt-0.5 flex-shrink-0" />
        <p>Cards held or on file are charged automatically when you mark the appointment Complete, or as a no-show fee. They appear here as &quot;Card held / on file&quot; until then.</p>
      </div>
    </div>
  );
}
