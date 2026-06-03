"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { X, Check } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, friendlyDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { Notification } from "@/lib/database.types";

// Type → accent color used for the avatar tile + left border on unread rows.
const TYPE_ACCENT: Record<string, { bg: string; border: string; text: string }> = {
  booking:      { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-400" },
  cancellation: { bg: "bg-red-500/10",     border: "border-red-500/40",     text: "text-red-400" },
  "no-show":    { bg: "bg-amber-500/10",   border: "border-amber-500/40",   text: "text-amber-400" },
  review:       { bg: "bg-white/10",       border: "border-white/40",       text: "text-white" },
  inventory:    { bg: "bg-blue-500/10",    border: "border-blue-500/40",    text: "text-blue-400" },
  system:       { bg: "bg-[#141414]",      border: "border-[#1e1e1e]",      text: "text-[#777]" },
};

type NotificationType = "booking" | "cancellation" | "no-show" | "review" | "inventory";

const TYPE_ICONS: Record<string, string> = {
  // 🎉 for bookings — celebrates the new paid booking instead of the
  // generic calendar. Wiggles when unread (.cw-notif-wiggle in globals).
  booking: "🎉", cancellation: "❌", "no-show": "⚠️", review: "⭐", inventory: "📦", system: "🔔",
};

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
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#777] hover:text-white ml-2">✕</button>
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
          <h1 className="text-2xl font-bold text-white tracking-tight">Notifications</h1>
          <p className="text-sm text-[#777] mt-0.5">
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
                  typeFilter === v ? "bg-gold text-black border-black" : "border-[#1e1e1e] text-[#777] hover:text-white bg-[#141414]")}>
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
                <p className="text-[#777]">{notifications.length === 0 ? "No notifications yet" : "No notifications in this category"}</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map(notif => {
                const accent = TYPE_ACCENT[notif.type] ?? TYPE_ACCENT.system;
                return (
                  <div
                    key={notif.id}
                    onClick={() => !notif.is_read && markRead(notif.id)}
                    className={cn(
                      "group relative flex items-start gap-3 p-4 rounded-2xl border transition-all cursor-pointer",
                      notif.is_read
                        ? "bg-[#0c0c0c] border-[#1e1e1e] hover:bg-[#141414]"
                        : "bg-[#141414] border-[#2a2a2a] hover:border-white/30"
                    )}
                  >
                    {/* Type avatar — colored circle with the emoji. Unread
                        rows get a playful wiggle so the eye is drawn to them. */}
                    <div className={cn(
                      "w-10 h-10 rounded-full border flex items-center justify-center text-lg flex-shrink-0",
                      accent.bg, accent.border,
                    )}>
                      <span className={cn(!notif.is_read && "cw-notif-wiggle")}>
                        {TYPE_ICONS[notif.type] ?? "🔔"}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <p className={cn(
                          "text-sm font-semibold leading-tight flex-1 min-w-0 truncate",
                          notif.is_read ? "text-[#999]" : "text-white"
                        )}>
                          {notif.title}
                        </p>
                        {!notif.is_read && (
                          <span className="w-2 h-2 rounded-full bg-white flex-shrink-0 mt-1.5" />
                        )}
                      </div>
                      <p className="text-sm text-[#777] mt-1 leading-relaxed">{notif.message}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={cn(
                          "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border",
                          accent.bg, accent.border, accent.text,
                        )}>
                          {notif.type}
                        </span>
                        <span className="text-xs text-[#777]">{notifTime(notif.created_at)}</span>
                      </div>
                    </div>

                    {/* Dismiss — appears on hover, click-stop so it doesn't
                        also mark the row as read on the way out. */}
                    <button
                      type="button"
                      aria-label="Dismiss notification"
                      onClick={(e) => { e.stopPropagation(); dismiss(notif.id); }}
                      className="absolute top-3 right-3 w-7 h-7 rounded-full bg-[#0c0c0c] border border-[#1e1e1e] flex items-center justify-center text-[#777] hover:text-white hover:border-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
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
                        <p className="text-xs text-[#777]">{s.desc}</p>
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
                        <span className="text-sm text-[#777] capitalize">{type}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-[#777]">{count}</span>
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
