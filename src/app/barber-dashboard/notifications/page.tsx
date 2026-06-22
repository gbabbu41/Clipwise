"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { X, Check, Calendar, CalendarX2, AlertTriangle, Info, Bell } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, friendlyDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Notification } from "@/lib/database.types";

// One clean type-icon per notification, tinted chip (mirrors owner/sidebar).
const NOTIF_ICON: Record<string, { Icon: typeof Bell; cls: string }> = {
  booking:      { Icon: Calendar,      cls: "bg-emerald-500/15 text-emerald-400" },
  cancellation: { Icon: CalendarX2,    cls: "bg-rose-500/15 text-rose-400" },
  "no-show":    { Icon: AlertTriangle, cls: "bg-amber-500/15 text-amber-400" },
  system:       { Icon: Info,          cls: "bg-white/10 text-[#aaa]" },
};
const notifIcon = (t: string) => NOTIF_ICON[t] ?? NOTIF_ICON.system;
const cleanNotifTitle = (t: string) => t.replace(/^[^A-Za-z0-9]+/, "").trim() || t;
// Older messages stored a raw YYYY-MM-DD — humanize at render time.
const humanizeMessage = (msg: string) => msg.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => friendlyDate(iso));
function notifTime(dateStr: string) {
  const date = new Date(dateStr);
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const t = date.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
  return `${friendlyDate(date)}, ${t}`;
}

export default function BarberNotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("notifications").select("*")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
    if (data) setNotifications(data as Notification[]);
    setLoading(false);
  }, [user]);
  useEffect(() => { load(); }, [load]);

  // Live updates so a charge/no-show notification lands without a reload.
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`barber-notifs-page:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, load]);

  const markRead = async (id: string) => {
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };
  const markAllRead = async () => {
    const ids = notifications.filter(n => !n.is_read).map(n => n.id);
    if (ids.length === 0) return;
    await supabase.from("notifications").update({ is_read: true }).in("id", ids);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    showToast("All marked as read");
  };
  const dismiss = async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    await supabase.from("notifications").delete().eq("id", id);
  };
  const clearAll = async () => {
    if (notifications.length === 0) return;
    const ids = notifications.map(n => n.id);
    setNotifications([]);
    await supabase.from("notifications").delete().in("id", ids);
    showToast("All cleared");
  };

  const filtered = useMemo(() => {
    const map: Record<string, string[]> = {
      bookings: ["booking"], "no-shows": ["no-show"], system: ["system", "cancellation"],
    };
    if (typeFilter === "all") return notifications;
    return notifications.filter(n => (map[typeFilter] || []).includes(n.type));
  }, [notifications, typeFilter]);
  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      {toast && (
        <div className="fixed bottom-24 lg:bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl">
          <span className="text-[#00e5a0]">✓</span> {toast}
        </div>
      )}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <p className="text-sm text-[#777] mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread` : notifications.length > 0 ? "All caught up" : "Nothing here yet"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
            <Check size={14} /> Mark all read
          </Button>
          <Button variant="outline" size="sm" onClick={clearAll} disabled={notifications.length === 0}>
            <X size={14} /> Clear
          </Button>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap">
        {[["all", "All"], ["bookings", "Bookings"], ["no-shows", "No-Shows"], ["system", "System"]].map(([v, l]) => (
          <button key={v} onClick={() => setTypeFilter(v)}
            className={cn("px-3 py-1.5 rounded-xl text-sm font-medium transition-colors border",
              typeFilter === v ? "bg-white text-black border-white" : "border-[#1e1e1e] text-[#777] hover:text-white bg-[#141414]")}>
            {l}
            {v === "all" && unreadCount > 0 && (
              <span className="ml-1.5 text-xs bg-red-500 text-white rounded-full px-1.5">{unreadCount}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-[#141414] animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#0c0c0c] border border-[#1e1e1e] rounded-2xl text-center py-12">
          <p className="text-4xl mb-3">🔔</p>
          <p className="text-[#777]">{notifications.length === 0 ? "No notifications yet" : "Nothing in this category"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(notif => {
            const { Icon, cls } = notifIcon(notif.type);
            return (
              <div key={notif.id} onClick={() => !notif.is_read && markRead(notif.id)}
                className={cn("group relative flex items-start gap-3 p-4 rounded-2xl border transition-all cursor-pointer",
                  notif.is_read ? "bg-[#0c0c0c] border-[#1e1e1e] hover:bg-[#141414]" : "bg-[#141414] border-[#2a2a2a] hover:border-white/30")}>
                <div className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0", cls)}>
                  <Icon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <p className="text-sm font-semibold leading-tight flex-1 min-w-0 truncate text-white">{cleanNotifTitle(notif.title)}</p>
                    {!notif.is_read && <span className="w-2 h-2 rounded-full bg-white flex-shrink-0 mt-1.5" />}
                  </div>
                  <p className="text-sm text-[#777] mt-1 leading-relaxed">{humanizeMessage(notif.message)}</p>
                  <span className="text-xs text-[#777] mt-2 block">{notifTime(notif.created_at)}</span>
                </div>
                <button type="button" aria-label="Dismiss notification"
                  onClick={(e) => { e.stopPropagation(); dismiss(notif.id); }}
                  className="absolute top-3 right-3 w-7 h-7 rounded-full bg-[#0c0c0c] border border-[#1e1e1e] flex items-center justify-center text-[#777] hover:text-white hover:border-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
