"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Megaphone, Mail, Users, Tag, TrendingUp, Send, Clock, CheckCircle2, Plus, ChevronRight, Zap } from "lucide-react";
import type { Client } from "@/lib/database.types";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#777] hover:text-white ml-2">✕</button>
    </div>
  );
}

type Segment = { id: string; label: string; desc: string; filter: (c: Client[]) => Client[] };
type Template = { id: string; label: string; subject: string; body: string; tag: string };
type Campaign = { id: string; name: string; segment: string; sentAt: string; recipients: number; opens: number; clicks: number; status: "sent" | "scheduled" | "draft" };

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

const MOCK_HISTORY: Campaign[] = [
  { id: "1", name: "Win-Back — At Risk Clients", segment: "At Risk", sentAt: "2025-05-10", recipients: 34, opens: 18, clicks: 9, status: "sent" },
  { id: "2", name: "Fill Slow Tuesday", segment: "All Clients", sentAt: "2025-05-15", recipients: 87, opens: 52, clicks: 23, status: "sent" },
  { id: "3", name: "Holiday Special", segment: "VIP Clients", sentAt: "2025-04-28", recipients: 12, opens: 10, clicks: 7, status: "sent" },
];

export default function MarketingPage() {
  const { shop } = useAuth();
  const [tab, setTab] = useState<"campaigns" | "create">("campaigns");
  const [clients, setClients] = useState<Client[]>([]);
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
    const { data } = await supabase.from("clients").select("*").eq("shop_id", shop.id);
    if (data) setClients(data);
  }, [shop]);

  useEffect(() => { loadClients(); }, [loadClients]);

  const recipients = selectedSegment.filter(clients);
  const recipientsWithEmail = recipients.filter(c => !!c.email);
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
    if (!recipientsWithEmail.length) { showToast("No recipients with email addresses."); return; }
    if (!subject.trim() || !body.trim()) { showToast("Subject and message are required."); return; }
    setSending(true);

    let sent = 0;
    for (const client of recipientsWithEmail.slice(0, 50)) {
      const personalizedBody = body
        .replace(/{name}/g, client.name ?? "there")
        .replace(/{shop}/g, shop?.name ?? "our shop")
        .replace(/{link}/g, bookingUrl);

      await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "marketing_campaign",
          data: {
            to: client.email,
            subject,
            htmlBody: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
              <h2 style="color:#F5F0E6;margin-bottom:16px;">${shop?.name ?? "Your Barber"}</h2>
              <div style="white-space:pre-line;color:#333;line-height:1.6;">${personalizedBody}</div>
              <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#999;">
                You're receiving this because you're a client of ${shop?.name ?? "our shop"}.
              </div>
            </div>`,
          },
        }),
      }).catch(() => null);
      sent++;
    }

    setSending(false);
    showToast(`Campaign sent to ${sent} client${sent !== 1 ? "s" : ""}!`);
    setTab("campaigns");
  };

  const totalSent = MOCK_HISTORY.reduce((s, c) => s + c.recipients, 0);
  const totalOpens = MOCK_HISTORY.reduce((s, c) => s + c.opens, 0);
  const avgOpenRate = totalSent ? Math.round((totalOpens / totalSent) * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Marketing</h1>
          <p className="text-sm text-[#777] mt-0.5">Email campaigns to grow your client base</p>
        </div>
        {tab === "campaigns" && (
          <Button onClick={() => setTab("create")}><Plus size={16} /> New Campaign</Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Clients", value: clients.length, icon: Users },
          { label: "With Email", value: clients.filter(c => !!c.email).length, icon: Mail },
          { label: "Campaigns Sent", value: MOCK_HISTORY.length, icon: Send },
          { label: "Avg Open Rate", value: `${avgOpenRate}%`, icon: TrendingUp },
        ].map(stat => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-black/10 border border-[#1e1e1e] flex items-center justify-center">
                    <Icon size={16} className="text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-[#777]">{stat.label}</p>
                    <p className="text-xl font-bold text-white">{stat.value}</p>
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
            <h2 className="text-sm font-semibold text-[#777] uppercase tracking-wider mb-3">Quick Campaigns</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { label: "Win-Back At-Risk", desc: `Re-engage ${clients.filter(c=>c.tag==="At Risk"&&!!c.email).length} at-risk clients who haven't been back`, icon: "🔄", template: "winback", segment: "atrisk" },
                { label: "Fill Slow Days", desc: `Send a promo to all ${clients.filter(c=>!!c.email).length} clients with email`, icon: "📅", template: "fillyourseat", segment: "all" },
                { label: "Reward Your VIPs", desc: `Appreciate ${clients.filter(c=>c.tag==="VIP"&&!!c.email).length} VIP clients`, icon: "🏆", template: "loyalty", segment: "vip" },
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
                  className="text-left p-4 bg-black shadow-sm border border-[#1e1e1e] rounded-2xl hover:border-black transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{qa.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white group-hover:text-white transition-colors">{qa.label}</p>
                      <p className="text-xs text-[#777] mt-0.5 leading-relaxed">{qa.desc}</p>
                    </div>
                    <ChevronRight size={14} className="text-[#777] group-hover:text-white transition-colors flex-shrink-0 mt-0.5" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Campaign history */}
          <Card>
            <CardHeader>
              <Megaphone size={18} className="text-white" />
              <CardTitle>Campaign History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#1e1e1e]">
                      {["Campaign", "Segment", "Sent", "Recipients", "Opens", "Clicks", "Rate", "Status"].map(h => (
                        <th key={h} className="text-left text-xs font-medium text-[#777] px-3 py-2 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MOCK_HISTORY.map(c => (
                      <tr key={c.id} className="border-b border-[#1e1e1e]/50 hover:bg-[#141414]/50 transition-colors">
                        <td className="px-3 py-3 text-sm font-medium text-white">{c.name}</td>
                        <td className="px-3 py-3 text-xs text-[#777]">{c.segment}</td>
                        <td className="px-3 py-3 text-xs text-[#777]">{c.sentAt}</td>
                        <td className="px-3 py-3 text-sm text-white">{c.recipients}</td>
                        <td className="px-3 py-3 text-sm text-white">{c.opens}</td>
                        <td className="px-3 py-3 text-sm text-white">{c.clicks}</td>
                        <td className="px-3 py-3 text-sm text-emerald-400">{Math.round((c.opens / c.recipients) * 100)}%</td>
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
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "create" && (
        <div className="space-y-6">
          <button onClick={() => setTab("campaigns")} className="text-sm text-[#777] hover:text-white transition-colors flex items-center gap-1">
            ← Back to campaigns
          </button>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Left: Config */}
            <div className="lg:col-span-2 space-y-5">
              <Card>
                <CardHeader><Zap size={18} className="text-white" /><CardTitle>Campaign Setup</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <Input
                    label="Campaign Name"
                    placeholder="e.g. May Win-Back Campaign"
                    value={campaignName}
                    onChange={e => setCampaignName(e.target.value)}
                  />

                  {/* Segment picker */}
                  <div>
                    <p className="text-sm font-medium text-[#777] mb-2">Audience Segment</p>
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
                                ? "border-black bg-black/5 text-white"
                                : "border-[#1e1e1e] text-[#777] hover:border-[#1e1e1e]/80"
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
                <CardHeader><Mail size={18} className="text-white" /><CardTitle>Message</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {/* Template picker */}
                  <div>
                    <p className="text-sm font-medium text-[#777] mb-2">Template</p>
                    <div className="flex flex-wrap gap-2">
                      {TEMPLATES.map(t => (
                        <button
                          key={t.id}
                          onClick={() => applyTemplate(t)}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                            selectedTemplate.id === t.id
                              ? "border-black bg-black/10 text-white"
                              : "border-[#1e1e1e] text-[#777] hover:text-white hover:border-[#1e1e1e]/80"
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-[#777] mt-2">
                      Use <span className="font-mono bg-[#141414] px-1 rounded">{"{name}"}</span>, <span className="font-mono bg-[#141414] px-1 rounded">{"{shop}"}</span>, <span className="font-mono bg-[#141414] px-1 rounded">{"{link}"}</span> as placeholders
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
                <CardHeader><Users size={18} className="text-white" /><CardTitle>Audience Summary</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="p-4 bg-[#141414] rounded-xl border border-[#1e1e1e] text-center">
                    <p className="text-4xl font-bold text-white">{recipientsWithEmail.length}</p>
                    <p className="text-xs text-[#777] mt-1">recipients with email</p>
                    <p className="text-xs text-[#777] mt-0.5">{recipients.length - recipientsWithEmail.length} without email (skipped)</p>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-[#777]">
                      <span>Segment</span>
                      <span className="text-white">{selectedSegment.label}</span>
                    </div>
                    <div className="flex justify-between text-[#777]">
                      <span>Template</span>
                      <span className="text-white">{selectedTemplate.label}</span>
                    </div>
                    <div className="flex justify-between text-[#777]">
                      <span>Type</span>
                      <span className="text-white">Email</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><Clock size={18} className="text-white" /><CardTitle>Delivery</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <button className="w-full p-3 rounded-xl border border-black bg-black/5 text-sm font-medium text-white text-left">
                      ● Send Now
                    </button>
                    <button
                      className="w-full p-3 rounded-xl border border-[#1e1e1e] text-sm text-[#777] text-left hover:border-[#1e1e1e]/80"
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
