"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, plural } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Megaphone, Mail, Users, Tag, TrendingUp, Send, Clock, CheckCircle2, Plus, ChevronRight, Zap } from "lucide-react";
import type { Client } from "@/lib/database.types";
import { groupClients } from "@/lib/client-identity";
import { effectivePlan, isPaidPlan } from "@/lib/validation";
import { FeatureLock } from "@/components/dashboard/feature-lock";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <span className="text-foreground">✓</span>{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
    </div>
  );
}

type Segment = { id: string; label: string; desc: string; filter: (c: Client[]) => Client[] };
type Template = { id: string; label: string; subject: string; body: string; tag: string; coupon?: { code: string; percent: number } };
// A real, persisted campaign row (public.campaigns).
type Campaign = { id: string; name: string | null; segment: string | null; subject: string | null; recipients: number; status: string; sent_at: string };

const SEGMENTS: Segment[] = [
  { id: "all", label: "All Clients", desc: "Everyone in your client list", filter: c => c },
  { id: "new", label: "New Clients", desc: "Tag: New — first-time visitors", filter: c => c.filter(x => x.tag === "New") },
  { id: "atrisk", label: "At Risk", desc: "Tag: At Risk — haven't been back", filter: c => c.filter(x => x.tag === "At Risk") },
  { id: "vip", label: "VIP Clients", desc: "Tag: VIP — 10+ visits", filter: c => c.filter(x => x.tag === "VIP") },
  { id: "returning", label: "Returning", desc: "Tag: Returning clients", filter: c => c.filter(x => x.tag === "Returning") },
  { id: "noemail", label: "Has Email", desc: "Clients with email on file", filter: c => c.filter(x => !!x.email) },
];

const TEMPLATES: Template[] = [
  {
    id: "winback",
    label: "Win-Back",
    tag: "Re-engage",
    subject: "We miss you — Come back for a fresh cut 💈",
    body: "Hey {name},\n\nIt's been a while! We'd love to see you back at {shop}.\n\nHere's a little welcome-back treat to say thanks — book your next appointment and it's yours.\n\n👇 Book Now: {link}",
    coupon: { code: "COMEBACK10", percent: 10 },
  },
  {
    id: "fillyourseat",
    label: "Fill a Slow Day",
    tag: "Promo",
    subject: "Special offer — limited spots this week 🗓️",
    body: "Hey {name},\n\nWe have a few open spots this week and wanted to give our best clients first access.\n\nBook now and lock in your time: {link}\n\nSpots fill fast — grab yours before they're gone!",
  },
  {
    id: "loyalty",
    label: "Loyalty Reward",
    tag: "Reward",
    subject: "You've earned a reward at {shop} 🏆",
    body: "Hey {name},\n\nThanks for being a loyal client! You've built up some serious points.\n\nNext time you book, mention your loyalty points to redeem a discount.\n\nBook here: {link}",
  },
  {
    id: "holiday",
    label: "Holiday Special",
    tag: "Seasonal",
    subject: "Holiday booking at {shop} — Book before we fill up 🎄",
    body: "Hey {name},\n\nThe holidays are coming up fast and our calendar is filling up!\n\nSecure your spot now so you're looking fresh for the season.\n\nBook online: {link}",
  },
  {
    id: "birthday",
    label: "Birthday Promo",
    tag: "Birthday",
    subject: "Happy Birthday from {shop} 🎂 — A gift for you inside",
    body: "Hey {name},\n\nHappy Birthday! 🎉\n\nAs a birthday treat, enjoy a FREE add-on service on your next visit. Just mention this email when you book.\n\nBook here: {link}",
  },
  {
    id: "custom",
    label: "Custom",
    tag: "Custom",
    subject: "",
    body: "",
  },
];

export default function MarketingPage() {
  const { shop, accessToken } = useAuth();
  const [tab, setTab] = useState<"campaigns" | "create">("campaigns");
  const [clients, setClients] = useState<Client[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [toast, setToast] = useState("");
  const [sending, setSending] = useState(false);

  const [selectedSegment, setSelectedSegment] = useState(SEGMENTS[0]);
  const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0]);
  const [subject, setSubject] = useState(TEMPLATES[0].subject);
  const [body, setBody] = useState(TEMPLATES[0].body);
  const [campaignName, setCampaignName] = useState("");
  // Optional coupon attached to the campaign — the server creates it as a real
  // promo code (works at checkout) and shows it as a banner in the email.
  const [couponEnabled, setCouponEnabled] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponPercent, setCouponPercent] = useState(10);
  const [couponExpiryDays, setCouponExpiryDays] = useState(30);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadClients = useCallback(async () => {
    if (!shop) return;
    const [clientRes, apptRes, txRes, campaignRes] = await Promise.all([
      supabase.from("clients").select("*").eq("shop_id", shop.id),
      supabase.from("appointments").select("client_id, client_name, client_email, client_phone, date, status, total_amount").eq("shop_id", shop.id),
      supabase.from("transactions").select("client_name, client_email, created_at, amount, source, refunded, appointment_id").eq("shop_id", shop.id),
      supabase.from("campaigns").select("*").eq("shop_id", shop.id).order("sent_at", { ascending: false }),
    ]);
    // Same de-duped list the Clients page shows — by IDENTITY (email/phone), incl.
    // past/walk-in customers surfaced from appointments + POS — so the client count
    // and every segment match across pages instead of contradicting each other.
    const baseRows = (clientRes.data ?? []) as Client[];
    const apptRows = (apptRes.error ? [] : apptRes.data ?? []) as unknown as Parameters<typeof groupClients>[0]["apptRows"];
    const txRows = (txRes.error ? [] : txRes.data ?? []) as unknown as Parameters<typeof groupClients>[0]["txRows"];
    setClients(groupClients({ shopId: shop.id, clientRows: baseRows, apptRows, txRows }));
    if (campaignRes.data) setCampaigns(campaignRes.data as Campaign[]);
  }, [shop]);

  useEffect(() => { loadClients(); }, [loadClients]);

  const recipients = selectedSegment.filter(clients);
  // Only clients with an email who haven't unsubscribed are reachable.
  const recipientsWithEmail = recipients.filter(c => !!c.email && !c.marketing_opt_out);
  const bookingUrl = `${typeof window !== "undefined" ? window.location.origin : "https://clipwise.ca"}/book/${shop?.slug ?? ""}`;

  const applyTemplate = (t: Template) => {
    setSelectedTemplate(t);
    if (t.id !== "custom") {
      setSubject(t.subject.replace("{shop}", shop?.name ?? "our shop"));
      setBody(t.body.replace(/{shop}/g, shop?.name ?? "our shop").replace(/{link}/g, bookingUrl));
    } else {
      setSubject("");
      setBody("");
    }
    // Each template defines its own offer — pre-fill (or clear) the coupon.
    if (t.coupon) { setCouponEnabled(true); setCouponCode(t.coupon.code); setCouponPercent(t.coupon.percent); }
    else { setCouponEnabled(false); }
  };

  const sendCampaign = async () => {
    if (!shop) return;
    if (!recipientsWithEmail.length) { showToast("No recipients with email addresses."); return; }
    if (!subject.trim() || !body.trim()) { showToast("Subject and message are required."); return; }
    setSending(true);
    // One server call sends the whole batch reliably (not tab-dependent), resolves
    // each recipient to a real client row, re-enforces marketing opt-out, counts
    // only genuine successes, and records the campaign once. See /api/marketing/send.
    try {
      const res = await fetch("/api/marketing/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken ?? ""}` },
        body: JSON.stringify({
          shop_id: shop.id,
          campaignName: campaignName.trim(),
          segmentLabel: selectedSegment.label,
          subject: subject.trim(),
          body: body.trim(),
          recipients: recipientsWithEmail.map(c => ({
            name: c.name,
            email: c.email,
            phone: c.phone,
            clientId: c.id && !c.id.startsWith("synthetic:") ? c.id : undefined,
          })),
          coupon: couponEnabled && couponCode.trim()
            ? { code: couponCode.trim(), percent: couponPercent, expiryDays: couponExpiryDays }
            : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setSending(false);
      if (!res.ok || !data.ok) { showToast(data.error || "Couldn't send the campaign. Please try again."); return; }
      await loadClients();
      const parts = [`Sent to ${data.sent} client${data.sent !== 1 ? "s" : ""}`];
      if (data.skipped) parts.push(`${data.skipped} skipped`);
      if (data.overflow) parts.push(`${data.overflow} over the limit (not sent)`);
      showToast(parts.join(" · "));
      setTab("campaigns");
    } catch {
      setSending(false);
      showToast("Connection error. Please try again.");
    }
  };

  const totalEmailsSent = campaigns.reduce((s, c) => s + (c.recipients ?? 0), 0);

  if (shop && !isPaidPlan(effectivePlan(shop.subscription_plan, shop.subscription_status))) {
    return <FeatureLock title="Marketing" description="Email marketing & campaigns are available on the Pro plan and up." />;
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground uppercase tracking-wide">Marketing</h1>
          <p className="text-sm text-grey mt-0.5">Email campaigns to grow your client base</p>
        </div>
        {tab === "campaigns" && (
          <Button onClick={() => setTab("create")}><Plus size={16} /> New Campaign</Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Clients", value: clients.length, icon: Users },
          { label: "Reachable (email)", value: clients.filter(c => !!c.email && !c.marketing_opt_out).length, icon: Mail },
          { label: "Campaigns Sent", value: campaigns.length, icon: Send },
          { label: "Emails Delivered", value: totalEmailsSent, icon: TrendingUp },
        ].map(stat => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Icon size={16} className="text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-xs text-grey">{stat.label}</p>
                    <p className="text-xl font-bold text-foreground">{stat.value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {tab === "campaigns" && (
        <div className="space-y-6">
          {/* Quick actions */}
          <div>
            <h2 className="text-sm font-semibold text-grey uppercase tracking-wider mb-3">Quick Campaigns</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { label: "Win-Back At-Risk", desc: `Re-engage ${plural(clients.filter(c=>c.tag==="At Risk"&&!!c.email).length, "at-risk client")} who haven't been back`, icon: "🔄", template: "winback", segment: "atrisk" },
                { label: "Fill Slow Days", desc: `Send a promo to all ${plural(clients.filter(c=>!!c.email).length, "client")} with email`, icon: "📅", template: "fillyourseat", segment: "all" },
                { label: "Reward Your VIPs", desc: `Appreciate ${plural(clients.filter(c=>c.tag==="VIP"&&!!c.email).length, "VIP client")}`, icon: "🏆", template: "loyalty", segment: "vip" },
              ].map(qa => (
                <button
                  key={qa.label}
                  onClick={() => {
                    const seg = SEGMENTS.find(s => s.id === qa.segment) ?? SEGMENTS[0];
                    const tmpl = TEMPLATES.find(t => t.id === qa.template) ?? TEMPLATES[0];
                    setSelectedSegment(seg);
                    applyTemplate(tmpl);
                    setCampaignName(qa.label);
                    setTab("create");
                  }}
                  className="text-left p-4 bg-card shadow-sm border border-border rounded-2xl hover:border-emerald-500/50 transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{qa.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground group-hover:text-foreground transition-colors">{qa.label}</p>
                      <p className="text-xs text-grey mt-0.5 leading-relaxed">{qa.desc}</p>
                    </div>
                    <ChevronRight size={14} className="text-grey group-hover:text-foreground transition-colors flex-shrink-0 mt-0.5" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Campaign history */}
          <Card>
            <CardHeader>
              <Megaphone size={18} className="text-foreground" />
              <CardTitle>Campaign History</CardTitle>
            </CardHeader>
            <CardContent>
              {campaigns.length === 0 ? (
                <div className="py-10 text-center">
                  <Megaphone size={32} className="mx-auto mb-3 text-grey opacity-40" />
                  <p className="text-sm text-foreground font-medium">No campaigns sent yet</p>
                  <p className="text-xs text-grey mt-1">Your sent campaigns will show up here.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        {["Campaign", "Segment", "Sent", "Recipients", "Status"].map(h => (
                          <th key={h} className="text-left text-xs font-medium text-grey px-3 py-2 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.map(c => (
                        <tr key={c.id} className="border-b border-border hover:bg-card-raised/50 transition-colors">
                          <td className="px-3 py-3 text-sm font-medium text-foreground">{c.name || c.subject || "Campaign"}</td>
                          <td className="px-3 py-3 text-xs text-grey">{c.segment ?? "—"}</td>
                          <td className="px-3 py-3 text-xs text-grey">{new Date(c.sent_at).toLocaleDateString("en-CA")}</td>
                          <td className="px-3 py-3 text-sm text-foreground">{c.recipients}</td>
                          <td className="px-3 py-3">
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                              <CheckCircle2 size={10} /> Sent
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "create" && (
        <div className="space-y-6">
          <button onClick={() => setTab("campaigns")} className="text-sm text-grey hover:text-foreground transition-colors flex items-center gap-1">
            ← Back to campaigns
          </button>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Left: Config */}
            <div className="lg:col-span-2 space-y-5">
              <Card>
                <CardHeader><Zap size={18} className="text-foreground" /><CardTitle>Campaign Setup</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <Input
                    label="Campaign Name"
                    placeholder="e.g. May Win-Back Campaign"
                    value={campaignName}
                    onChange={e => setCampaignName(e.target.value)}
                  />

                  {/* Segment picker */}
                  <div>
                    <p className="text-sm font-medium text-grey mb-2">Audience Segment</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {SEGMENTS.map(seg => {
                        const count = seg.filter(clients).filter(c => !!c.email).length;
                        return (
                          <button
                            key={seg.id}
                            onClick={() => setSelectedSegment(seg)}
                            className={cn(
                              "text-left p-3 rounded-xl border transition-all",
                              selectedSegment.id === seg.id
                                ? "border-emerald-500 bg-emerald-500/10 text-foreground"
                                : "border-border text-grey hover:border-foreground/30"
                            )}
                          >
                            <p className="text-sm font-medium">{seg.label}</p>
                            <p className="text-xs opacity-70">{seg.desc} · {count} with email</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><Mail size={18} className="text-foreground" /><CardTitle>Message</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {/* Template picker */}
                  <div>
                    <p className="text-sm font-medium text-grey mb-2">Template</p>
                    <div className="flex flex-wrap gap-2">
                      {TEMPLATES.map(t => (
                        <button
                          key={t.id}
                          onClick={() => applyTemplate(t)}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                            selectedTemplate.id === t.id
                              ? "border-emerald-500 bg-emerald-500/10 text-foreground"
                              : "border-border text-grey hover:text-foreground hover:border-foreground/30"
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-grey mt-2">
                      Use <span className="font-mono bg-card-raised px-1 rounded">{"{name}"}</span>, <span className="font-mono bg-card-raised px-1 rounded">{"{shop}"}</span>, <span className="font-mono bg-card-raised px-1 rounded">{"{link}"}</span> as placeholders
                    </p>
                  </div>

                  <Input
                    label="Subject Line"
                    placeholder="Email subject..."
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                  />
                  <Textarea
                    label="Message Body"
                    placeholder="Write your message here..."
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    rows={8}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader><Tag size={18} className="text-foreground" /><CardTitle>Coupon</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">Attach a discount code</p>
                      <p className="text-xs text-grey">Creates a real code that works at checkout and shows in the email.</p>
                    </div>
                    <button
                      type="button"
                      aria-pressed={couponEnabled}
                      onClick={() => setCouponEnabled(v => !v)}
                      className={cn("w-11 h-6 rounded-full relative transition-colors flex-shrink-0", couponEnabled ? "bg-emerald-500" : "bg-card-raised border border-border")}
                    >
                      <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all", couponEnabled ? "left-[22px]" : "left-0.5")} />
                    </button>
                  </div>
                  {couponEnabled && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <Input
                          label="Code"
                          value={couponCode}
                          placeholder="COMEBACK10"
                          onChange={e => setCouponCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20))}
                        />
                        <Input
                          label="% off"
                          type="number"
                          value={String(couponPercent)}
                          onChange={e => setCouponPercent(Math.max(1, Math.min(100, Number(e.target.value) || 0)))}
                        />
                      </div>
                      <Input
                        label="Expires in (days · 0 = never)"
                        type="number"
                        value={String(couponExpiryDays)}
                        onChange={e => setCouponExpiryDays(Math.max(0, Number(e.target.value) || 0))}
                      />
                      <p className="text-xs text-grey">
                        Clients get <span className="text-foreground font-medium">{couponPercent}% off</span> with code{" "}
                        <span className="font-mono text-foreground">{couponCode || "—"}</span>
                        {couponExpiryDays > 0 ? `, valid ${couponExpiryDays} days.` : "."}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right: Summary */}
            <div className="space-y-4">
              <Card>
                <CardHeader><Users size={18} className="text-foreground" /><CardTitle>Audience Summary</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="p-4 bg-card-raised rounded-xl border border-border text-center">
                    <p className="text-4xl font-bold text-foreground">{recipientsWithEmail.length}</p>
                    <p className="text-xs text-grey mt-1">recipients with email</p>
                    <p className="text-xs text-grey mt-0.5">{recipients.length - recipientsWithEmail.length} without email (skipped)</p>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-grey">
                      <span>Segment</span>
                      <span className="text-foreground">{selectedSegment.label}</span>
                    </div>
                    <div className="flex justify-between text-grey">
                      <span>Template</span>
                      <span className="text-foreground">{selectedTemplate.label}</span>
                    </div>
                    <div className="flex justify-between text-grey">
                      <span>Type</span>
                      <span className="text-foreground">Email</span>
                    </div>
                    <div className="flex justify-between text-grey">
                      <span>Coupon</span>
                      <span className="text-foreground">{couponEnabled && couponCode.trim() ? `${couponCode.trim()} · ${couponPercent}% off` : "None"}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><Clock size={18} className="text-foreground" /><CardTitle>Delivery</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <button className="w-full p-3 rounded-xl border border-emerald-500 bg-emerald-500/10 text-sm font-medium text-foreground text-left">
                      ● Send Now
                    </button>
                    <button
                      className="w-full p-3 rounded-xl border border-border text-sm text-grey text-left hover:border-foreground/30"
                      onClick={() => showToast("Scheduling coming soon!")}
                    >
                      ○ Schedule for Later
                    </button>
                  </div>
                </CardContent>
              </Card>

              <Button
                className="w-full"
                disabled={sending || !recipientsWithEmail.length || !subject.trim() || !body.trim()}
                onClick={sendCampaign}
              >
                {sending ? (
                  <span className="flex items-center gap-2"><span className="animate-spin">⟳</span>Sending…</span>
                ) : (
                  <span className="flex items-center gap-2"><Send size={16} />Send to {recipientsWithEmail.length} client{recipientsWithEmail.length !== 1 ? "s" : ""}</span>
                )}
              </Button>

              {(!subject.trim() || !body.trim()) && (
                <p className="text-xs text-orange-400 text-center">Fill in subject and message to send</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
