"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { X, Check, Calendar, CalendarX2, AlertTriangle, Info, Bell, Star, CreditCard, Banknote, Clock, CheckCircle2, RefreshCcw, BellRing, ChevronRight, ChevronDown } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { fetchShopNotifications } from "@/lib/notify";
import { cn, friendlyDate } from "@/lib/utils";
import { NotifSoundToggle } from "@/components/notif-sound-toggle";
import { Switch } from "@/components/ui/switch";
import { getNotifPrefs, setNotifPref, NOTIF_PREF_DEFAULTS, type NotifPrefKey } from "@/lib/notif-prefs";
import type { Notification } from "@/lib/database.types";

// Rich classification (mirrors the notification sheet): coloured badge + icon
// chip + left accent inferred from the type and a few title/message keywords.
const classify = (n: { title: string; message: string; type: string }) => {
  const s = `${n.title} ${n.message}`.toLowerCase();
  const k = (Icon: typeof Bell, chip: string, badge: string, badgeCls: string, accent: string, actionable = false) =>
    ({ Icon, chip, badge, badgeCls, accent, actionable });
  if (/waitlist|waiting for a spot/.test(s)) return k(BellRing, "bg-amber-500/15 text-amber-300", "Waitlist", "bg-amber-500/15 text-amber-300", "#d19a2e", true);
  if (n.type === "cancellation" || /cancel(led|lation)?/.test(s)) return k(CalendarX2, "bg-rose-500/15 text-rose-300", "Cancelled", "bg-rose-500/15 text-rose-300", "#d9534f");
  if (/payment failed|\bfailed\b|declined/.test(s)) return k(AlertTriangle, "bg-rose-500/15 text-rose-300", "Failed", "bg-rose-500/15 text-rose-300", "#d9534f");
  if (n.type === "no-show" || /no.?show/.test(s)) return k(AlertTriangle, "bg-rose-500/15 text-rose-300", "No-show", "bg-rose-500/15 text-rose-300", "#d9534f");
  if (/refund/.test(s)) return k(RefreshCcw, "bg-amber-500/15 text-amber-300", "Refund", "bg-amber-500/15 text-amber-300", "#d19a2e");
  if (/authoriz|card.?hold|on hold/.test(s)) return k(CreditCard, "bg-sky-500/15 text-sky-300", "Card hold", "bg-sky-500/15 text-sky-300", "#3f7fc4");
  if (/payment|charged|collected|received|earned|\bpaid\b/.test(s)) return k(Banknote, "bg-emerald-500/15 text-emerald-300", "Payment", "bg-emerald-500/15 text-emerald-300", "#2f9e6b");
  if (/block|hours|time.?off|vacation|day off/.test(s)) { const act = /request/.test(s); return k(Clock, act ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300", act ? "Request" : "Schedule", act ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300", act ? "#d19a2e" : "#3f7fc4", act); }
  if (n.type === "review" || /review|\bstar\b/.test(s)) return k(Star, "bg-yellow-500/15 text-yellow-300", "Review", "bg-yellow-500/15 text-yellow-300", "#c99a2e");
  if (/approved|confirmed/.test(s)) return k(CheckCircle2, "bg-emerald-500/15 text-emerald-300", "Confirmed", "bg-emerald-500/15 text-emerald-300", "#2f9e6b");
  if (n.type === "booking" || /book(ed|ing)|appointment/.test(s)) { const p = /needs approval|tap to approve|pending|approval|approve|awaiting|requested/.test(s); return k(Calendar, p ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-[#e5e5e5]", p ? "Pending" : "Booking", p ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-[#bbb]", p ? "#d19a2e" : "var(--border-strong)", p); }
  return k(Info, "bg-white/10 text-[#cfcfcf]", "Update", "bg-white/10 text-[#bbb]", "var(--border-strong)");
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

// Where an actionable notification should take the barber so "Review ›" actually
// does something (it used to only mark the row read). Keyed off the classify badge.
const destForBadge = (badge: string): string | null => {
  if (badge === "Waitlist") return "/barber-dashboard/waitlist";
  if (badge === "Pending" || badge === "Booking" || badge === "Confirmed") return "/barber-dashboard/calendar";
  if (badge === "Request" || badge === "Schedule") return "/barber-dashboard/time-off";
  return null;
};

// Filter chips — value + label + which notification types they include.
const FILTERS: { v: string; l: string; types: string[] }[] = [
  { v: "all", l: "All", types: [] },
  { v: "bookings", l: "Bookings", types: ["booking"] },
  { v: "no-shows", l: "No-shows", types: ["no-show"] },
  { v: "system", l: "System", types: ["system", "cancellation"] },
];

// Per-device pop-up toggles relevant to a barber (bookings + the two disruptions).
const PREF_ROWS: { key: NotifPrefKey; label: string; desc: string; Icon: typeof Bell; tint: string }[] = [
  { key: "new_booking", label: "New bookings", desc: "A client books with you", Icon: Calendar, tint: "bg-emerald-500/15 text-emerald-300" },
  { key: "cancellation", label: "Cancellations", desc: "A booking is cancelled", Icon: CalendarX2, tint: "bg-rose-500/15 text-rose-300" },
  { key: "no_show", label: "No-shows", desc: "A client doesn’t show up", Icon: AlertTriangle, tint: "bg-rose-500/15 text-rose-300" },
];

export default function BarberNotificationsPage() {
  const { user } = useAuth();
  const { shop } = useBarber();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [toast, setToast] = useState("");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefs, setPrefs] = useState<Record<NotifPrefKey, boolean>>(NOTIF_PREF_DEFAULTS);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  // Alert prefs live in localStorage (per device), so read them after mount.
  useEffect(() => { setPrefs(getNotifPrefs()); }, []);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    // Scoped to the barber's active shop (multi-shop barbers don't see other shops').
    const { data } = await fetchShopNotifications(supabase, { userId: user.id, shopId: shop?.id, limit: 50 });
    if (data) setNotifications(data as unknown as Notification[]);
    setLoading(false);
  }, [user, shop?.id]);
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

  const togglePref = (key: NotifPrefKey) => {
    const next = !prefs[key];
    setPrefs(p => ({ ...p, [key]: next }));
    setNotifPref(key, next);
    showToast(next ? "Pop-ups on for this" : "Pop-ups silenced for this");
  };

  const filtered = useMemo(() => {
    if (typeFilter === "all") return notifications;
    const types = FILTERS.find(f => f.v === typeFilter)?.types ?? [];
    return notifications.filter(n => types.includes(n.type));
  }, [notifications, typeFilter]);
  const unreadCount = notifications.filter(n => !n.is_read).length;
  const chipCount = (f: { v: string; types: string[] }) =>
    f.v === "all" ? unreadCount : notifications.filter(n => f.types.includes(n.type)).length;

  const card = (notif: Notification) => {
    const c = classify(notif);
    return (
      <div key={notif.id} onClick={() => {
          if (!notif.is_read) markRead(notif.id);
          // Actionable rows now actually go somewhere the barber can act,
          // instead of only marking themselves read.
          const dest = c.actionable ? destForBadge(c.badge) : null;
          if (dest) router.push(dest);
        }}
        style={{ borderLeftColor: c.accent }}
        className={cn("relative flex items-start gap-3 p-3.5 rounded-2xl border border-l-[3px] transition-colors cursor-pointer active:bg-white/[0.06]",
          notif.is_read ? "bg-card border-border" : "bg-card-raised border-border")}>
        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0", c.chip)}>
          <c.Icon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {!notif.is_read && <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />}
            <p className={cn("text-sm leading-tight truncate flex-1", notif.is_read ? "font-semibold text-[#dcdcdc]" : "font-bold text-foreground")}>{cleanNotifTitle(notif.title)}</p>
            <span className={cn("flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full", c.badgeCls)}>{c.badge}</span>
          </div>
          <p className="text-[13px] text-grey mt-1 leading-relaxed line-clamp-2">{humanizeMessage(notif.message)}</p>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-xs text-grey-muted">{notifTime(notif.created_at)}</span>
            {c.actionable && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-300">Review <ChevronRight size={12} /></span>}
          </div>
        </div>
        {/* Always-visible dismiss — a hover-only X is invisible on touch. */}
        <button type="button" aria-label="Dismiss notification"
          onClick={(e) => { e.stopPropagation(); dismiss(notif.id); }}
          className="flex-shrink-0 -mr-1 -mt-0.5 w-8 h-8 rounded-full flex items-center justify-center text-grey-muted hover:text-foreground hover:bg-white/5 active:bg-white/10 transition-colors">
          <X size={16} />
        </button>
      </div>
    );
  };

  const section = (label: string, items: Notification[], labelCls = "text-grey") =>
    items.length > 0 ? (
      <div key={label} className="space-y-2">
        <p className={cn("text-[11px] font-bold uppercase tracking-wider px-1", labelCls)}>{label}</p>
        {items.map(card)}
      </div>
    ) : null;

  return (
    <div className="px-4 sm:px-6 pt-6 pb-28 max-w-2xl mx-auto space-y-5">
      {toast && (
        <div className="fixed bottom-24 lg:bottom-6 right-4 lg:right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-2">
          <Check size={15} className="text-emerald-400" /> {toast}
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="hidden lg:block text-2xl font-bold text-foreground uppercase tracking-wide">Notifications</h1>
          <p className="text-sm text-grey lg:mt-0.5">
            {unreadCount > 0 ? `${unreadCount} unread` : notifications.length > 0 ? "All caught up" : "Nothing here yet"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={markAllRead} disabled={unreadCount === 0}
            className="text-xs font-semibold px-3 py-2 rounded-full border border-border text-grey enabled:hover:text-foreground enabled:active:bg-white/5 disabled:opacity-40 transition-colors whitespace-nowrap">
            Mark all read
          </button>
          <button onClick={clearAll} disabled={notifications.length === 0}
            className="text-xs font-semibold px-3 py-2 rounded-full border border-border text-grey enabled:hover:text-foreground enabled:active:bg-white/5 disabled:opacity-40 transition-colors whitespace-nowrap">
            Clear
          </button>
        </div>
      </div>

      {/* Filter chips — horizontally scrollable so they never wrap to two rows. */}
      <div className="flex gap-2 overflow-x-auto cw-noscroll -mx-4 px-4 sm:-mx-6 sm:px-6 pb-0.5">
        {FILTERS.map(f => {
          const active = typeFilter === f.v;
          const count = chipCount(f);
          return (
            <button key={f.v} onClick={() => setTypeFilter(f.v)}
              className={cn("flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium border transition-colors",
                active ? "bg-foreground text-background border-foreground" : "bg-card border-border text-grey hover:text-foreground")}>
              {f.l}
              {count > 0 && (
                <span className={cn("text-[10px] font-bold rounded-full px-1.5 min-w-[18px] text-center",
                  f.v === "all" ? "bg-emerald-500 text-black" : active ? "bg-background/15 text-background" : "bg-white/10 text-grey")}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-[76px] rounded-2xl bg-card-raised animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl text-center py-16">
          <p className="text-4xl mb-3">🔔</p>
          <p className="text-sm font-semibold text-foreground">{notifications.length === 0 ? "You’re all caught up" : "Nothing in this filter"}</p>
          <p className="text-xs text-grey mt-1">{notifications.length === 0 ? "New bookings and alerts land here." : "Try a different category above."}</p>
        </div>
      ) : (() => {
        const action = filtered.filter(n => !n.is_read && classify(n).actionable);
        const ids = new Set(action.map(n => n.id));
        const rest = filtered.filter(n => !ids.has(n.id));
        const today = rest.filter(n => isToday(n.created_at));
        const earlier = rest.filter(n => !isToday(n.created_at));
        return (
          <div className="space-y-5">
            {section("Action required", action, "text-amber-400")}
            {section("Today", today)}
            {section("Earlier", earlier)}
          </div>
        );
      })()}

      {/* Alerts — collapsible per-device preferences (sound + which pop-ups show). */}
      <section className="mt-3 border-t border-border pt-4">
        <button type="button" onClick={() => setPrefsOpen(o => !o)} aria-expanded={prefsOpen}
          className="w-full flex items-center justify-between gap-3 py-1.5 text-left">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">Alerts</p>
            <p className="text-xs text-grey mt-0.5">Sound + which pop-ups show on this device</p>
          </div>
          <ChevronDown size={18} className={cn("text-grey flex-shrink-0 transition-transform", prefsOpen && "rotate-180")} />
        </button>

        {prefsOpen && (
          <div className="mt-3 space-y-2">
            <NotifSoundToggle />
            {PREF_ROWS.map(row => (
              <div key={row.key} className="flex items-center justify-between gap-4 p-3.5 rounded-2xl border border-border bg-card">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", row.tint)}>
                    <row.Icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{row.label}</p>
                    <p className="text-xs text-grey">{row.desc}</p>
                  </div>
                </div>
                <Switch checked={!!prefs[row.key]} onChange={() => togglePref(row.key)} />
              </div>
            ))}
            <p className="text-[11px] text-grey-muted px-1 pt-1 leading-relaxed">
              Turning one off only silences its pop-up + chime on this device — it still appears in the list above.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
