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
type Template = { id: string; label: string; subject: string; body: string; tag: string };
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
    body: "Hey {name},\n\nIt's been a while! We'd love to see you back at {shop}.\n\nBook your next appointment today and get 10% off with code COMEBACK10.\n\n👇 Book Now: {link}",
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
  };

  const sendCampaign = async () => {
    if (!shop) return;
    if (!recipientsWithEmail.length) { showToast("No recipients with email addresses."); return; }
    if (!subject.trim() || !body.trim()) { showToast("Subject and message are required."); return; }
    setSending(true);

    const origin = typeof window !== "undefined" ? window.location.origin : "https://clipwise.ca";
    let sent = 0;
    for (const client of recipientsWithEmail.slice(0, 50)) {
      // Everyone we email needs a working unsubscribe, which resolves by a real
      // clients.id. Past/walk-in recipients surfaced from history are synthetic
      // (no saved row) — save them to the client book first so the link works AND
      // they permanently become a client (the counts converge). If that fails,
      // skip them rather than email someone who can't opt out.
      let clientId = client.id;
      if (!clientId || clientId.startsWith("synthetic:")) {
        try {
          const up = await fetch("/api/clients/upsert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shop_id: shop.id, name: client.name, email: client.email, phone: client.phone }),
          });
          const upData = await up.json();
          if (!up.ok || !upData?.id) continue;
          clientId = upData.id;
        } catch { continue; }
      }
      const personalizedBody = body
        .replace(/{name}/g, client.name ?? "there")
        .replace(/{shop}/g, shop?.name ?? "our shop")
        .replace(/{link}/g, bookingUrl);
      const unsubscribeUrl = `${origin}/api/unsubscribe?c=${clientId}`;

      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken ?? ""}` },
        body: JSON.stringify({
          type: "marketing_campaign",
          data: {
            to: client.email,
            subject,
            shopEmail: shop?.email,
            htmlBody: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
              <h2 style="color:#F5F0E6;margin-bottom:16px;">${shop?.name ?? "Your Barber"}</h2>
              <div style="white-space:pre-line;color:#333;line-height:1.6;">${personalizedBody}</div>
              <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#999;">
                You're receiving this because you're a client of ${shop?.name ?? "our shop"}.
                <br><a href="${unsubscribeUrl}" style="color:#999;text-decoration:underline;">Unsubscribe</a> from marketing emails.
              </div>
            </div>`,
          },
        }),
      }).catch(() => null);
      sent++;
    }

    // Persist the campaign so it shows in history (and the stats are real).
    if (sent > 0 && shop) {
      await supabase.from("campaigns").insert({
        shop_id: shop.id,
        name: campaignName.trim() || subject.trim(),
        segment: selectedSegment.label,
        subject: subject.trim(),
        recipients: sent,
        status: "sent",
      }).then(null, () => null);
      await loadClients();
    }

    setSending(false);
    showToast(`Campaign sent to ${sent} client${sent !== 1 ? "s" : ""}!`);
    setTab("campaigns");
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
                  <div className="w-9 h-9 rounded-xl bg-black/10 border border-border flex items-center justify-center">
                    <Icon size={16} className="text-foreground" />
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
                  className="text-left p-4 bg-card shadow-sm border border-border rounded-2xl hover:border-black transition-all group"
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
                        <tr key={c.id} className="border-b border-[#2a2a2a]/50 hover:bg-card-raised/50 transition-colors">
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
                                ? "border-black bg-black/5 text-foreground"
                                : "border-border text-grey hover:border-[#2a2a2a]/80"
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
                              ? "border-black bg-black/10 text-foreground"
                              : "border-border text-grey hover:text-foreground hover:border-[#2a2a2a]/80"
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
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><Clock size={18} className="text-foreground" /><CardTitle>Delivery</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <button className="w-full p-3 rounded-xl border border-black bg-black/5 text-sm font-medium text-foreground text-left">
                      ● Send Now
                    </button>
                    <button
                      className="w-full p-3 rounded-xl border border-border text-sm text-grey text-left hover:border-[#2a2a2a]/80"
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
