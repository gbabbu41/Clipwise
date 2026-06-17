"use client";
import { useEffect, useState, useCallback } from "react";
import { ExternalLink, RefreshCw, Send, CreditCard, Banknote, Clock, Check } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { FeatureLock } from "@/components/dashboard/feature-lock";
import { supabase } from "@/lib/supabase";
import { formatCurrency, cn, timeAgo, timeToMinutes } from "@/lib/utils";

// ── Row shapes ────────────────────────────────────────────────────────────────
interface ApptRow {
  id: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  date: string;
  time_slot: string;
  total_amount: number | null;
  payment_status: string | null;
  payment_method: string | null;
  payment_intent_id: string | null;
  paid_at: string | null;
  created_at: string | null;
  status: string | null;
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
  stripe_session_id: string | null;
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
        .select("id, client_name, client_email, client_phone, date, time_slot, total_amount, payment_status, payment_method, payment_intent_id, paid_at, created_at, status, services(name), barbers(name)")
        .eq("shop_id", shop.id).or("total_amount.gt.0,status.eq.completed").order("date", { ascending: false }),
      supabase.from("transactions")
        .select("id, client_name, service_name, amount, tip, payment_method, type, created_at, stripe_session_id")
        .eq("shop_id", shop.id).order("created_at", { ascending: false }),
    ]);
    setAppts((a ?? []) as unknown as ApptRow[]);
    setTxs((t ?? []) as unknown as TxRow[]);
    setLoading(false);
  }, [shop]);
  useEffect(() => { loadData(); }, [loadData]);

  // Catch up on any payment-link payments that completed without the customer
  // landing back / the webhook firing — flip them to paid, then refresh.
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    fetch("/api/stripe/reconcile-payments", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (active && d?.updated > 0) loadData(); })
      .catch(() => {});
    return () => { active = false; };
  }, [accessToken, loadData]);

  // ── One de-duped, time-sorted feed (appointments + POS sales) ───────────────
  // Appointment card-charges (no-show / completion) ALSO write a transactions
  // row; we show the appointment for those and drop the duplicate tx so nothing
  // is listed or counted twice. A POS sale always has a stripe_session_id (card)
  // or comes straight from the POS screen — appointment captures never do.
  const isPaid = (s: string | null) => s === "paid" || s === "captured";
  const apptDateMs = (a: ApptRow) => new Date(a.date + "T00:00:00").getTime() + timeToMinutes(a.time_slot) * 60000;

  type FeedItem = {
    key: string; name: string; sub: string; amount: number;
    statusLabel: string; tone: string; settled: boolean;
    ts: number; tsIso: string | null;
    appt?: ApptRow;
  };

  // (client|amount) of collected appointments — used to spot the duplicate
  // completion-capture transaction (full charge) that has no Stripe session id.
  const paidSig = new Set(appts.filter(a => isPaid(a.payment_status)).map(a => `${a.client_name}|${a.total_amount}`));
  const isNoShowTx = (t: TxRow) => (t.service_name ?? "").startsWith("No-show fee");
  const posTxs = txs.filter(t => {
    // A no-show fee charges only the fee (e.g. $20), NOT the appointment total,
    // so we KEEP that transaction — it carries the real amount + "No-show fee"
    // label — and instead drop the appointment's captured row below (which would
    // wrongly show the full service price). A completion charge equals the total,
    // so for those we drop the duplicate tx and keep the appointment row.
    if (isNoShowTx(t)) return true;
    if (!t.stripe_session_id && paidSig.has(`${t.client_name}|${t.amount}`)) return false; // appt completion charge
    return true;
  });

  // One timestamp per row = when the activity happened: a paid row uses the
  // charge time (paid_at); an outstanding row uses when it was booked
  // (created_at); a POS sale uses created_at. Never the appointment date.
  const feedAll: FeedItem[] = [
    // Skip a no-show appointment that was charged — its money shows as the
    // "No-show fee" transaction (real amount), not the full service price.
    ...appts
      .filter(a => !(a.status === "no-show" && isPaid(a.payment_status)))
      .map((a): FeedItem => {
      const info = statusInfo(a.payment_status);
      const paid = isPaid(a.payment_status);
      // A completed appointment with no price never charged anything — read it
      // as "No charge" rather than the alarming "Unpaid".
      const noCharge = !paid && (a.total_amount ?? 0) <= 0;
      const tsIso = paid ? (a.paid_at ?? a.created_at) : a.created_at;
      return {
        key: `a${a.id}`,
        name: a.client_name,
        sub: `${a.services?.name ?? "Service"}${a.barbers?.name ? ` · ${a.barbers.name}` : ""}`,
        amount: a.total_amount ?? 0,
        statusLabel: noCharge ? "No charge" : info.label,
        tone: noCharge ? "muted" : info.tone,
        settled: paid,
        tsIso,
        ts: tsIso ? new Date(tsIso).getTime() : apptDateMs(a),
        appt: a,
      };
    }),
    ...posTxs.map((t): FeedItem => {
      const noShow = isNoShowTx(t);
      return {
        key: `t${t.id}`,
        name: t.client_name || "Walk-in",
        sub: noShow ? (t.service_name ?? "No-show fee") : `${t.service_name || "Sale"} · POS`,
        amount: (t.amount ?? 0) + (t.tip ?? 0),
        statusLabel: noShow ? "No-show · Paid" : (t.payment_method === "cash" ? "Paid · Cash" : "Paid · Card"),
        tone: "good",
        settled: true,
        tsIso: t.created_at,
        ts: new Date(t.created_at).getTime(),
      };
    }),
  ];

  // ── Summary (from the de-duped feed) ────────────────────────────────────────
  const collected = feedAll.filter(i => i.settled).reduce((s, i) => s + i.amount, 0);
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

  // ── Send a payment link — chooser modal (email and/or text) ─────────────────
  const [linkModal, setLinkModal] = useState<ApptRow | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkPhone, setLinkPhone] = useState("");
  const [viaEmail, setViaEmail] = useState(true);
  const [viaSms, setViaSms] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");

  const openSendLink = (appt: ApptRow) => {
    setLinkEmail(appt.client_email ?? "");
    setLinkPhone(appt.client_phone ?? "");
    setViaEmail(!!appt.client_email);          // default to email if we have one
    setViaSms(!appt.client_email && !!appt.client_phone); // else SMS if we have a phone
    setGeneratedLink("");
    setLinkModal(appt);
  };

  const submitSendLink = async () => {
    if (!linkModal) return;
    if (!viaEmail && !viaSms) { showToast("Pick email or text (or both)", false); return; }
    if (viaEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(linkEmail.trim())) { showToast("Enter a valid email", false); return; }
    if (viaSms && linkPhone.replace(/\D/g, "").length < 10) { showToast("Enter a valid phone number", false); return; }
    setBusy(linkModal.id);
    const res = await fetch("/api/stripe/payment-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appointment_id: linkModal.id,
        send_email: viaEmail,
        send_sms: viaSms,
        email: viaEmail ? linkEmail.trim() : undefined,
        phone: viaSms ? linkPhone.trim() : undefined,
      }),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) { showToast(data.error ?? "Couldn't create link.", false); return; }
    const sent = [data.emailed && "email", data.texted && "text"].filter(Boolean).join(" + ");
    if (sent) {
      setLinkModal(null);
      showToast(`Payment link sent by ${sent}`);
      loadData();
    } else {
      // Nothing actually sent — surface the link to copy/open.
      setGeneratedLink(data.url ?? "");
      showToast("Link ready");
    }
  };

  // Filter, then sort newest-first by when the activity actually happened.
  const feed = feedAll
    .filter(i => {
      const s = i.appt?.payment_status;
      if (filter === "all") return true;
      if (filter === "collected") return i.settled;
      if (filter === "outstanding") return !!i.appt && (i.appt.total_amount ?? 0) > 0 && (s === "unpaid" || s === "failed" || !s);
      if (filter === "pending") return s === "held" || s === "saved";
      if (filter === "refunded") return s === "refunded";
      return true;
    })
    .sort((a, b) => b.ts - a.ts);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "collected", label: "Collected" },
    { key: "outstanding", label: "Outstanding" },
    { key: "pending", label: "Card held/on file" },
    { key: "refunded", label: "Refunded" },
  ];

  // Plan gate — the Payments hub is a Pro/Premium feature.
  if (shop && !planHasFeature(effectivePlan(shop.subscription_plan, shop.subscription_status), "payments")) {
    return <FeatureLock title="Payments" description="Online & card payment tracking is available on the Pro and Premium plans." />;
  }

  return (
    <div className="min-h-screen bg-black px-4 sm:px-6 py-6 max-w-5xl mx-auto pb-28">
      {toast && (
        <div className={cn("fixed bottom-24 right-4 z-[200] flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-medium",
          toast.ok ? "bg-emerald-900/80 border-emerald-500/40 text-emerald-300" : "bg-red-900/80 border-red-500/40 text-red-300")}>
          {toast.ok ? <Check size={15} /> : "✕"} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white">Payments</h1>
      </div>

      {/* Stripe note + dashboard link */}
      <div className="flex items-start justify-between gap-3 rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] px-3 py-2.5 mb-4">
        <p className="text-[11px] leading-snug text-[#888]">
          💡 Stripe is the source of truth for every charge &amp; payout. If a paid link still shows outstanding,
          hit <span className="text-white font-medium">Refresh</span> on that row.
        </p>
        <button onClick={openStripeDashboard} disabled={busy === "stripe"}
          className="flex-shrink-0 flex items-center gap-1.5 rounded-lg border border-[#2a2a2a] bg-[#141414] text-white text-[11px] font-medium px-2.5 py-1.5 hover:bg-[#1e1e1e] disabled:opacity-50 transition-colors">
          <ExternalLink size={13} /> {busy === "stripe" ? "Opening…" : "Stripe Dashboard"}
        </button>
      </div>

      {/* Summary cards — Collected is the headline (wider + larger number); the
          other two are equal-size secondary stats. */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {[
          { label: "Collected", value: collected, hint: "Paid + POS", cls: "text-[#00e5a0]", span: "col-span-2", valueCls: "text-xl sm:text-2xl" },
          { label: "Outstanding", value: outstanding, hint: "Unpaid / failed", cls: "text-amber-400", span: "col-span-1", valueCls: "text-base sm:text-lg" },
          { label: "On file", value: pending, hint: "Held for later", cls: "text-white", span: "col-span-1", valueCls: "text-base sm:text-lg" },
        ].map(c => (
          <div key={c.label} className={cn("rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] px-3 py-3", c.span)}>
            <p className="text-[10px] uppercase tracking-wide text-[#777] truncate">{c.label}</p>
            <p className={cn("font-bold mt-0.5", c.valueCls, c.cls)}>{formatCurrency(c.value)}</p>
            <p className="text-[10px] text-[#666] mt-0.5 truncate">{c.hint}</p>
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
      ) : feed.length === 0 ? (
        <div className="py-16 text-center text-[#777] text-sm">No payments here yet.</div>
      ) : (
        <div className="space-y-2">
          {feed.map(i => {
            const a = i.appt;
            const canRefresh = !!a?.payment_intent_id && !isPaid(a.payment_status) && a.payment_status !== "refunded";
            const canSendLink = !!a && (a.payment_status === "unpaid" || a.payment_status === "failed" || !a.payment_status) && (a.total_amount ?? 0) > 0;
            return (
              <div key={i.key} className="rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] p-3 sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white truncate">{i.name}</p>
                    <p className="text-xs text-[#777] truncate">{i.sub}</p>
                    <p className="text-[11px] text-[#666] mt-0.5">{timeAgo(i.tsIso) || "—"}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-base font-bold text-white">{formatCurrency(i.amount)}</p>
                    <span className={cn("inline-flex items-center gap-1 mt-1 text-[11px] font-semibold px-2.5 py-1 rounded-full", toneClass[i.tone])}>
                      {!a && (i.statusLabel.includes("Cash") ? <Banknote size={11} /> : <CreditCard size={11} />)}
                      {i.statusLabel}
                    </span>
                  </div>
                </div>
                {a && (canSendLink || canRefresh) && (
                  <div className="flex gap-2 mt-3">
                    {canSendLink && (
                      <button onClick={() => openSendLink(a)} disabled={busy === a.id}
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
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer hint about held/saved timing */}
      <div className="mt-6 flex items-start gap-2 text-xs text-[#666]">
        <Clock size={14} className="mt-0.5 flex-shrink-0" />
        <p>Cards held or on file are charged automatically when you mark the appointment Complete, or as a no-show fee. They appear here as &quot;Card held / on file&quot; until then.</p>
      </div>

      {/* Send-link chooser modal */}
      {linkModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => busy === null && setLinkModal(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-[#0c0c0c] border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Send payment link</h2>
                <button onClick={() => busy === null && setLinkModal(null)} className="text-[#777] hover:text-white text-xl leading-none">✕</button>
              </div>
              <div className="bg-[#141414] rounded-xl p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-[#777]">Client</span><span className="text-white">{linkModal.client_name}</span></div>
                <div className="flex justify-between"><span className="text-[#777]">Amount</span><span className="text-white font-bold">{formatCurrency(linkModal.total_amount ?? 0)}</span></div>
              </div>

              {generatedLink ? (
                <div className="space-y-3">
                  <p className="text-sm text-white font-medium">Link ready</p>
                  <div className="bg-[#141414] border border-[#1e1e1e] rounded-xl p-2 text-xs text-sky-300 break-all">{generatedLink}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className="btn btn-primary w-full"
                      onClick={() => { navigator.clipboard?.writeText(generatedLink); showToast("Link copied"); }}>Copy link</button>
                    <a href={generatedLink} target="_blank" rel="noopener noreferrer" className="btn btn-success w-full text-center">Open</a>
                  </div>
                  <button type="button" className="btn btn-outline-secondary w-full" onClick={() => { setLinkModal(null); loadData(); }}>Done</button>
                </div>
              ) : (
                <>
                  {/* Email row */}
                  <label className="flex items-center gap-2 text-sm text-white">
                    <input type="checkbox" checked={viaEmail} onChange={e => setViaEmail(e.target.checked)} className="form-check-input" />
                    Email
                  </label>
                  <input
                    type="email" value={linkEmail} onChange={e => setLinkEmail(e.target.value)}
                    placeholder="customer@email.com" disabled={!viaEmail}
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-white disabled:opacity-40"
                  />

                  {/* Text row */}
                  <label className="flex items-center gap-2 text-sm text-white pt-1">
                    <input type="checkbox" checked={viaSms} onChange={e => setViaSms(e.target.checked)} className="form-check-input" />
                    Text message
                  </label>
                  <input
                    type="tel" value={linkPhone} onChange={e => setLinkPhone(e.target.value)}
                    placeholder="(416) 555-0123" disabled={!viaSms}
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-white disabled:opacity-40"
                  />

                  <button type="button" className="btn btn-primary w-full mt-1" disabled={busy === linkModal.id} onClick={submitSendLink}>
                    {busy === linkModal.id ? "Sending…" : "Send link"}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
