"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { Notification } from "@/lib/database.types";

type NotificationType = "booking" | "cancellation" | "no-show" | "review" | "inventory";

const TYPE_ICONS: Record<string, string> = {
  booking: "📅", cancellation: "❌", "no-show": "⚠️", review: "⭐", inventory: "📦", system: "🔔",
};
const TYPE_COLORS: Record<string, string> = {
  booking: "text-emerald-400", cancellation: "text-red-400", "no-show": "text-orange-400",
  review: "text-gold", inventory: "text-blue-400",
};

function timeAgo(dateStr: string) {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
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

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <p className="text-sm text-gray-400 mt-0.5">{unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}</p>
        </div>
        <Button variant="outline" onClick={markAllRead} disabled={unreadCount === 0}>Mark All Read</Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main notifications */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex gap-1 flex-wrap">
            {[["all","All"],["bookings","Bookings"],["no-shows","No-Shows"],["reviews","Reviews"],["inventory","Inventory"]].map(([v,l]) => (
              <button key={v} onClick={() => setTypeFilter(v)}
                className={cn("px-3 py-1.5 rounded-xl text-sm font-medium transition-colors border",
                  typeFilter === v ? "bg-gold text-black border-gold" : "border-border text-gray-400 hover:text-white bg-surface-raised")}>
                {l}
                {v === "all" && unreadCount > 0 && (
                  <span className="ml-1.5 text-xs bg-red-500 text-white rounded-full px-1.5">{unreadCount}</span>
                )}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-surface-raised animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <Card>
              <div className="text-center py-12">
                <p className="text-4xl mb-3">🔔</p>
                <p className="text-gray-400">{notifications.length === 0 ? "No notifications yet" : "No notifications in this category"}</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map(notif => (
                <div key={notif.id}
                  onClick={() => markRead(notif.id)}
                  className={cn(
                    "relative flex items-start gap-4 p-4 rounded-xl border cursor-pointer transition-all",
                    notif.is_read
                      ? "bg-surface border-border hover:border-border/80"
                      : "bg-surface border-l-2 border-l-gold border-t-border border-r-border border-b-border hover:bg-surface-raised"
                  )}>
                  <div className="text-2xl flex-shrink-0">{TYPE_ICONS[notif.type] ?? "🔔"}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={cn("text-sm font-semibold", notif.is_read ? "text-gray-300" : "text-white")}>{notif.title}</p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!notif.is_read && <span className="w-2 h-2 rounded-full bg-gold" />}
                        <span className="text-xs text-gray-500">{timeAgo(notif.created_at)}</span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-400 mt-0.5 leading-relaxed">{notif.message}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={cn("text-xs font-medium capitalize", TYPE_COLORS[notif.type] ?? "text-gray-400")}>
                        {notif.type}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
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
                        <p className="text-xs text-gray-500">{s.desc}</p>
                      </div>
                    </div>
                    <button onClick={() => toggleSetting(s.key)}
                      className={cn("relative w-11 h-6 rounded-full transition-colors flex-shrink-0",
                        notifSettings[s.key] ? "bg-gold" : "bg-surface-raised border border-border")}>
                      <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all",
                        notifSettings[s.key] ? "left-[22px]" : "left-0.5")} />
                    </button>
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
                        <span className="text-sm text-gray-300 capitalize">{type}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500">{count}</span>
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
