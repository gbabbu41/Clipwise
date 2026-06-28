"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { X, Check, Calendar, CalendarX2, AlertTriangle, Info, Bell, Star, CreditCard, Banknote, Clock, CheckCircle2, RefreshCcw, BellRing, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, friendlyDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Notification } from "@/lib/database.types";

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
  if (/payment|charged|collected|received|earned|\bpaid\b/.test(s)) return k(Banknote, "bg-emerald-500/15 text-emerald-300", "Payment", "bg-emerald-500/15 text-emerald-300", "#10b981");
  if (/block|hours|time.?off|vacation|day off/.test(s)) { const act = /request/.test(s); return k(Clock, act ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300", act ? "Request" : "Schedule", act ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300", act ? "#f59e0b" : "#38bdf8", act); }
  if (n.type === "review" || /review|\bstar\b/.test(s)) return k(Star, "bg-yellow-500/15 text-yellow-300", "Review", "bg-yellow-500/15 text-yellow-300", "#eab308");
  if (/approved|confirmed/.test(s)) return k(CheckCircle2, "bg-emerald-500/15 text-emerald-300", "Confirmed", "bg-emerald-500/15 text-emerald-300", "#10b981");
  if (n.type === "booking" || /book(ed|ing)|appointment/.test(s)) { const p = /pending|approval|request|awaiting/.test(s) || n.type === "booking"; return k(Calendar, p ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-[#e5e5e5]", p ? "Pending" : "Booking", p ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-[#bbb]", p ? "#f59e0b" : "#3a3a3a", p); }
  return k(Info, "bg-white/10 text-[#cfcfcf]", "Update", "bg-white/10 text-[#bbb]", "#3a3a3a");
};
const isToday = (iso: string) => { const d = new Date(iso); const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); };
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
        (() => {
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
                  notif.is_read ? "bg-[#0c0c0c] border-[#1e1e1e] hover:bg-[#141414]" : "bg-white/[0.04] border-[#2a2a2a] hover:border-white/30")}>
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
                    <span className="text-xs text-[#777]">{notifTime(notif.created_at)}</span>
                    {c.actionable && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-300">Review <ChevronRight size={12} /></span>}
                  </div>
                </div>
                {!notif.is_read && <span className="absolute top-3.5 right-9 w-2 h-2 rounded-full bg-amber-400" />}
                <button type="button" aria-label="Dismiss notification"
                  onClick={(e) => { e.stopPropagation(); dismiss(notif.id); }}
                  className="absolute top-3 right-3 w-7 h-7 rounded-full bg-[#0c0c0c] border border-[#1e1e1e] flex items-center justify-center text-[#777] hover:text-white hover:border-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <X size={13} />
                </button>
              </div>
            );
          };
          const section = (label: string, items: Notification[], labelCls = "text-[#777]") =>
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
  );
}
