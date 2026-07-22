"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { X, Check, Calendar, CalendarX2, AlertTriangle, Star, Info, Bell, CreditCard, Banknote, Clock, CheckCircle2, RefreshCcw, BellRing, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, friendlyDate } from "@/lib/utils";

// Rich classification (mirrors the notification sheet): coloured badge + icon
// chip + left accent inferred from the type and a few title/message keywords.
const classify = (n: { title: string; message: string; type: string }) => {
  const s = `${n.title} ${n.message}`.toLowerCase();
  const k = (Icon: typeof Bell, chip: string, badge: string, badgeCls: string, accent: string, actionable = false) =>
    ({ Icon, chip, badge, badgeCls, accent, actionable });
  if (/waitlist|waiting for a spot/.test(s)) return k(BellRing, "bg-amber-500/15 text-amber-300", "Waitlist", "bg-amber-500/15 text-amber-300", "#f59e0b", true);
  if (n.type === "cancellation" || /cancel(led|lation)?/.test(s)) return k(CalendarX2, "bg-rose-500/15 text-rose-300", "Cancelled", "bg-rose-500/15 text-rose-300", "#f43f5e");
  if (/payment failed|\bfailed\b|declined/.test(s)) return k(AlertTriangle, "bg-rose-500/15 text-rose-300", "Failed", "bg-rose-500/15 text-rose-300", "#f43f5e");
  if (n.type === "no-show" || /no.?show/.test(s)) return k(AlertTriangle, "bg-rose-500/15 text-rose-300", "No-show", "bg-rose-500/15 text-rose-300", "#f43f5e");
  if (/refund/.test(s)) return k(RefreshCcw, "bg-amber-500/15 text-amber-300", "Refund", "bg-amber-500/15 text-amber-300", "#f59e0b");
  if (/authoriz|card.?hold|on hold/.test(s)) return k(CreditCard, "bg-sky-500/15 text-sky-300", "Card hold", "bg-sky-500/15 text-sky-300", "#38bdf8");
  if (/payment|charged|collected|received|\bpaid\b/.test(s)) return k(Banknote, "bg-emerald-500/15 text-emerald-300", "Payment", "bg-emerald-500/15 text-emerald-300", "#10b981");
  if (/block|hours|time.?off|vacation|day off/.test(s)) { const act = /request/.test(s); return k(Clock, act ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300", act ? "Request" : "Schedule", act ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300", act ? "#f59e0b" : "#38bdf8", act); }
  if (n.type === "review" || /review|\bstar\b/.test(s)) return k(Star, "bg-yellow-500/15 text-yellow-300", "Review", "bg-yellow-500/15 text-yellow-300", "#eab308");
  if (/approved|confirmed/.test(s)) return k(CheckCircle2, "bg-emerald-500/15 text-emerald-300", "Confirmed", "bg-emerald-500/15 text-emerald-300", "#10b981");
  if (n.type === "booking" || /book(ed|ing)|appointment/.test(s)) { const p = /pending|approval|request|awaiting/.test(s) || n.type === "booking"; return k(Calendar, p ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-[#e5e5e5]", p ? "Pending" : "Booking", p ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-[#bbb]", p ? "#f59e0b" : "#3a3a3a", p); }
  return k(Info, "bg-white/10 text-[#cfcfcf]", "Update", "bg-white/10 text-[#bbb]", "#3a3a3a");
};
const isToday = (iso: string) => { const d = new Date(iso); const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); };
// Drop any leading emoji/symbol the stored title carries (e.g. "✅ Paid" → "Paid").
const cleanNotifTitle = (t: string) => t.replace(/^[^A-Za-z0-9]+/, "").trim() || t;
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { Notification } from "@/lib/database.types";

type NotificationType = "booking" | "cancellation" | "no-show" | "review" | "inventory";

const TYPE_ICONS: Record<string, string> = {
  // 🎉 for bookings — celebrates the new paid booking instead of the
  // generic calendar. Wiggles when unread (.cw-notif-wiggle in globals).
  booking: "🎉", cancellation: "❌", "no-show": "⚠️", review: "⭐", inventory: "📦", system: "🔔",
};

// Notification messages stored before we started formatting dates
// server-side still contain raw 'YYYY-MM-DD'. Detect that pattern at
// render time and swap it for the friendly form ('July 4' / 'Today' /
// 'Tomorrow' / 'Monday'). Cheap to run, idempotent, no DB writes.
function humanizeMessage(msg: string): string {
  return msg.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => friendlyDate(iso));
}

// Hybrid timestamp: relative for the last hour ("Just now", "12m ago",
// "3h ago"), context-aware date for anything older ("Today, 2:30 PM",
// "Yesterday, 9:15 AM", "Monday, 4:00 PM", "June 27").
function notifTime(dateStr: string) {
  const date = new Date(dateStr);
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)   return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const t = date.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
  return `${friendlyDate(date)}, ${t}`;
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#2a2a2a] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#8f8f8f] hover:text-white ml-2">✕</button>
    </div>
  );
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [toast, setToast] = useState("");
  const [notifSettings, setNotifSettings] = useState({
    new_booking: true, cancellation: true, no_show: true, low_inventory: true, new_review: true,
  });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadNotifications = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setNotifications(data);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  const markRead = async (id: string) => {
    const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    if (!error) setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const markAllRead = async () => {
    if (!user) return;
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;
    const { error } = await supabase.from("notifications").update({ is_read: true }).in("id", unreadIds);
    if (!error) { setNotifications(prev => prev.map(n => ({ ...n, is_read: true }))); showToast("All marked as read"); }
  };

  const dismiss = async (id: string) => {
    // Optimistic remove — drop the row from local state immediately, then
    // delete from the DB. If the delete fails we'd lose the row visually
    // until the next reload; acceptable trade-off for snappy feel.
    setNotifications(prev => prev.filter(n => n.id !== id));
    await supabase.from("notifications").delete().eq("id", id);
  };

  const clearAll = async () => {
    if (!user || notifications.length === 0) return;
    const ids = notifications.map(n => n.id);
    setNotifications([]);
    await supabase.from("notifications").delete().in("id", ids);
    showToast("All cleared");
  };

  const filtered = useMemo(() => {
    const typeMap: Record<string, string[]> = {
      bookings: ["booking"], "no-shows": ["no-show"], reviews: ["review"],
      inventory: ["inventory"], cancellations: ["cancellation"],
    };
    if (typeFilter === "all") return notifications;
    return notifications.filter(n => (typeMap[typeFilter] || []).includes(n.type));
  }, [notifications, typeFilter]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const toggleSetting = (key: keyof typeof notifSettings) => {
    setNotifSettings(prev => ({ ...prev, [key]: !prev[key] }));
    showToast(`Notification ${notifSettings[key] ? "disabled" : "enabled"}`);
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white uppercase tracking-wide">Notifications</h1>
          <p className="text-sm text-[#8f8f8f] mt-0.5">
            {unreadCount > 0
              ? `${unreadCount} unread`
              : notifications.length > 0
                ? "All caught up"
                : "Nothing here yet"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
            <Check size={14} /> Mark all read
          </Button>
          <Button variant="outline" size="sm" onClick={clearAll} disabled={notifications.length === 0}>
            <X size={14} /> Clear all
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main notifications */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex gap-1 flex-wrap">
            {[["all","All"],["bookings","Bookings"],["no-shows","No-Shows"],["reviews","Reviews"],["inventory","Inventory"]].map(([v,l]) => (
              <button key={v} onClick={() => setTypeFilter(v)}
                className={cn("px-3 py-1.5 rounded-xl text-sm font-medium transition-colors border",
                  typeFilter === v ? "bg-gold text-black border-black" : "border-[#2a2a2a] text-[#8f8f8f] hover:text-white bg-[#141414]")}>
                {l}
                {v === "all" && unreadCount > 0 && (
                  <span className="ml-1.5 text-xs bg-red-500 text-white rounded-full px-1.5">{unreadCount}</span>
                )}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-[#141414] animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <Card>
              <div className="text-center py-12">
                <p className="text-4xl mb-3">🔔</p>
                <p className="text-[#8f8f8f]">{notifications.length === 0 ? "No notifications yet" : "No notifications in this category"}</p>
              </div>
            </Card>
          ) : (
            (() => {
              // Group like the mobile sheet: unread actionable → Action required,
              // then by day.
              const action = filtered.filter(n => !n.is_read && classify(n).actionable);
              const ids = new Set(action.map(n => n.id));
              const rest = filtered.filter(n => !ids.has(n.id));
              const today = rest.filter(n => isToday(n.created_at));
              const earlier = rest.filter(n => !isToday(n.created_at));
              const card = (notif: Notification) => {
                const c = classify(notif);
                return (
                  <div key={notif.id} onClick={() => !notif.is_read && markRead(notif.id)}
                    style={{ borderLeftColor: c.accent }}
                    className={cn("group relative flex items-start gap-3 p-4 rounded-2xl border border-l-[3px] transition-all cursor-pointer",
                      notif.is_read ? "bg-[#0c0c0c] border-[#2a2a2a] hover:bg-[#141414]" : "bg-white/[0.04] border-[#2a2a2a] hover:border-white/30")}>
                    <div className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0", c.chip)}>
                      <c.Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0 pr-6">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("text-sm leading-tight truncate", notif.is_read ? "font-semibold text-[#dcdcdc]" : "font-bold text-white")}>{cleanNotifTitle(notif.title)}</p>
                        <span className={cn("flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full", c.badgeCls)}>{c.badge}</span>
                      </div>
                      <p className="text-sm text-[#aaa] mt-1 leading-relaxed line-clamp-2">{humanizeMessage(notif.message)}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-xs text-[#8f8f8f]">{notifTime(notif.created_at)}</span>
                        {c.actionable && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-300">Review <ChevronRight size={12} /></span>}
                      </div>
                    </div>
                    {!notif.is_read && <span className="absolute top-3.5 right-9 w-2 h-2 rounded-full bg-accent" />}
                    <button type="button" aria-label="Dismiss notification"
                      onClick={(e) => { e.stopPropagation(); dismiss(notif.id); }}
                      className="absolute top-3 right-3 w-7 h-7 rounded-full bg-[#0c0c0c] border border-[#2a2a2a] flex items-center justify-center text-[#8f8f8f] hover:text-white hover:border-white opacity-0 group-hover:opacity-100 transition-opacity">
                      <X size={13} />
                    </button>
                  </div>
                );
              };
              const section = (label: string, items: Notification[], labelCls = "text-[#8f8f8f]") =>
                items.length > 0 ? (
                  <div key={label} className="space-y-2">
                    <p className={cn("text-[11px] font-bold uppercase tracking-wider px-1", labelCls)}>{label}</p>
                    {items.map(card)}
                  </div>
                ) : null;
              return (
                <div className="space-y-4">
                  {section("Action required", action, "text-amber-400")}
                  {section("Today", today)}
                  {section("Earlier", earlier)}
                </div>
              );
            })()
          )}
        </div>

        {/* Settings Panel */}
        <div>
          <Card>
            <CardHeader><CardTitle>Notification Settings</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { key: "new_booking" as const, label: "New Booking", icon: "📅", desc: "When a client books" },
                  { key: "cancellation" as const, label: "Cancellation", icon: "❌", desc: "When a booking is cancelled" },
                  { key: "no_show" as const, label: "No-Show", icon: "⚠️", desc: "When a client doesn't show" },
                  { key: "low_inventory" as const, label: "Low Inventory", icon: "📦", desc: "Stock below threshold" },
                  { key: "new_review" as const, label: "New Review", icon: "⭐", desc: "When a review is left" },
                ].map(s => (
                  <div key={s.key} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{s.icon}</span>
                      <div>
                        <p className="text-sm text-white">{s.label}</p>
                        <p className="text-xs text-[#8f8f8f]">{s.desc}</p>
                      </div>
                    </div>
                    <Switch checked={!!notifSettings[s.key]} onChange={() => toggleSetting(s.key)} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(["booking","cancellation","no-show","review","inventory"] as NotificationType[]).map(type => {
                  const count = notifications.filter(n => n.type === type).length;
                  const unread = notifications.filter(n => n.type === type && !n.is_read).length;
                  return (
                    <div key={type} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{TYPE_ICONS[type]}</span>
                        <span className="text-sm text-[#8f8f8f] capitalize">{type}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-[#8f8f8f]">{count}</span>
                        {unread > 0 && <Badge variant="warning">{unread}</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
