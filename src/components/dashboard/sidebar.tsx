"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Calendar, Users, UserCheck, Receipt,
  BarChart3, Scissors, Star, Bell, CreditCard, Settings,
  Gift, ChevronRight, LogOut, Package, ClipboardList, CalendarDays, Ticket, Banknote, Share2, Megaphone, UmbrellaOff, Tablet, MessageSquare,
  Menu, BellRing, AlertTriangle, CalendarX2, Info, Clock, CheckCircle2, RefreshCcw, Check, X, Fingerprint,
} from "lucide-react";
// Logo component no longer used — sidebar wordmark is an inline div now.
import { cn, timeAgo } from "@/lib/utils";
import { INLINE_HEADER_PAGES } from "@/lib/inline-header-pages";
import { AvatarImage } from "@/components/ui/avatar-image";

// Tap a notification → jump to the page where you act on it, routed by what the
// notification is actually about (NOT "/dashboard/pending" — that's the shop's
// own approval page, which bounces an approved owner back to /dashboard).
const notifHref = (n: { title: string; message: string; type: string }) => {
  const s = `${n.title} ${n.message}`.toLowerCase();
  if (/waitlist|waiting for a spot/.test(s)) return "/dashboard/waitlist-requests";
  if (/payment|charged|collected|refund|card.?hold|authoriz|\bpaid\b|failed/.test(s)) return "/dashboard/payments";
  if (/block|hours|time.?off|vacation|day off/.test(s)) return "/dashboard/calendar";
  if (n.type === "review" || /review/.test(s)) return "/dashboard/reviews";
  if (n.type === "inventory" || /inventory|stock/.test(s)) return "/dashboard/inventory";
  if (n.type === "booking" || n.type === "cancellation" || n.type === "no-show" || /book(ed|ing)|appointment/.test(s)) return "/dashboard/appointments";
  return "/dashboard/notifications";
};
// Strip any leading emoji/symbols the stored title carries (e.g. "✅ Paid") so
// the row shows a single, consistent icon instead of two.
const cleanNotifTitle = (t: string) => t.replace(/^[^A-Za-z0-9]+/, "").trim() || t;

// Rich classification for the notification sheet. Notifications only store
// title/message/type (no entity link), so we infer a coloured badge + icon +
// left accent from the type and a few title/message keywords. `actionable`
// surfaces the item in the "Action required" group with a Review affordance.
type NotifKind = {
  Icon: typeof Bell;
  chip: string;     // icon-chip bg/text
  badge: string;    // short pill label
  badgeCls: string; // pill bg/text
  accent: string;   // left-border colour
  actionable: boolean;
};
const classifyNotif = (n: { title: string; message: string; type: string }): NotifKind => {
  const s = `${n.title} ${n.message}`.toLowerCase();
  const k = (Icon: typeof Bell, chip: string, badge: string, badgeCls: string, accent: string, actionable = false): NotifKind =>
    ({ Icon, chip, badge, badgeCls, accent, actionable });
  // Urgent — cancellations / failures / no-shows (red)
  if (n.type === "cancellation" || /cancel(led|lation)?/.test(s))
    return k(CalendarX2, "bg-rose-500/15 text-rose-300", "Cancelled", "bg-rose-500/15 text-rose-300", "#f43f5e");
  if (/payment failed|\bfailed\b|declined/.test(s))
    return k(AlertTriangle, "bg-rose-500/15 text-rose-300", "Failed", "bg-rose-500/15 text-rose-300", "#f43f5e");
  if (n.type === "no-show" || /no.?show/.test(s))
    return k(AlertTriangle, "bg-rose-500/15 text-rose-300", "No-show", "bg-rose-500/15 text-rose-300", "#f43f5e");
  if (/refund/.test(s))
    return k(RefreshCcw, "bg-amber-500/15 text-amber-300", "Refund", "bg-amber-500/15 text-amber-300", "#f59e0b");
  // Payments — card hold (blue) vs money collected (green)
  if (/authoriz|card.?hold|hold placed|on hold/.test(s))
    return k(CreditCard, "bg-sky-500/15 text-sky-300", "Card hold", "bg-sky-500/15 text-sky-300", "#38bdf8");
  if (/payment|charged|collected|received|\bpaid\b/.test(s))
    return k(Banknote, "bg-emerald-500/15 text-emerald-300", "Payment", "bg-emerald-500/15 text-emerald-300", "#10b981");
  // Schedule — blocked hours / time-off ("request" variants need a decision)
  if (/block|hours|time.?off|vacation|day off/.test(s)) {
    const act = /request/.test(s);
    return k(Clock, act ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300",
      act ? "Request" : "Schedule", act ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300",
      act ? "#f59e0b" : "#38bdf8", act);
  }
  // Reviews
  if (n.type === "review" || /review|\bstar\b/.test(s))
    return k(Star, "bg-yellow-500/15 text-yellow-300", "Review", "bg-yellow-500/15 text-yellow-300", "#eab308");
  // Bookings — confirmed (green) vs needs approval (amber, actionable)
  if (/approved|confirmed/.test(s))
    return k(CheckCircle2, "bg-emerald-500/15 text-emerald-300", "Confirmed", "bg-emerald-500/15 text-emerald-300", "#10b981");
  if (n.type === "booking" || /book(ed|ing)|appointment/.test(s)) {
    // Only bookings that genuinely need a decision are actionable (Approve/
    // Decline). Keying off `type === "booking"` alone wrongly flagged confirmed,
    // card-paid online bookings (type "booking", no approval wording) as pending
    // — showing a bogus Approve/Decline. Pay-in-person approvals carry
    // "needs approval" in their title, so the keyword test still catches them.
    const pending = /pending|approval|request|awaiting/.test(s);
    return k(Calendar, pending ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-[#e5e5e5]",
      pending ? "Pending" : "Booking", pending ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-[#bbb]",
      pending ? "#f59e0b" : "var(--border-strong)", pending);
  }
  return k(Info, "bg-white/10 text-[#cfcfcf]", "Update", "bg-white/10 text-[#bbb]", "var(--border-strong)");
};
// Is the timestamp from the current calendar day?
const isToday = (iso: string) => {
  const d = new Date(iso); const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { fetchShopNotifications, fetchShopUnreadCount } from "@/lib/notify";
import { effectivePlan, planHasFeature, type PlanFeature } from "@/lib/validation";
import { ShopSwitcher } from "@/components/dashboard/shop-switcher";
import { PortalThemeToggle } from "@/components/portal-theme";
import { sendApprovalNotifications, sendRejectionEmail, notifyFreedSlot } from "@/lib/appointment-actions";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import type { AppointmentWithDetails } from "@/lib/database.types";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: boolean;
  ownerOnly?: boolean;
  feature?: PlanFeature;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

// Grouped sidebar nav. Items that don't pass the ownerOnly + feature-gating
// filter are skipped at render time; a section whose items are all filtered
// out is hidden entirely (along with its label + divider) so barbers and
// gated shops don't see empty group headers.
const navSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/dashboard/schedule", label: "Schedule", icon: Clock, ownerOnly: true },
      { href: "/dashboard/pos", label: "Point of Sale", icon: Receipt, feature: "pos" },
      { href: "/dashboard/payments", label: "Payments", icon: CreditCard, ownerOnly: true, feature: "payments" },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/dashboard/clients", label: "Clients", icon: Users, ownerOnly: true },
      { href: "/dashboard/staff", label: "Staff", icon: UserCheck, ownerOnly: true },
      { href: "/dashboard/check-in", label: "Check-in", icon: Fingerprint, ownerOnly: true },
      { href: "/dashboard/time-off", label: "Time Off", icon: UmbrellaOff, ownerOnly: true },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/dashboard/services", label: "Services", icon: Scissors, ownerOnly: true },
      { href: "/dashboard/waitlist", label: "Waitlist", icon: ClipboardList },
      { href: "/dashboard/waitlist-requests", label: "Spot Waitlist", icon: BellRing, ownerOnly: true },
      { href: "/dashboard/kiosk", label: "Walk-in Kiosk", icon: Tablet, ownerOnly: true },
      { href: "/dashboard/messages", label: "Messages", icon: MessageSquare },
      { href: "/dashboard/notifications", label: "Notifications", icon: Bell, badge: true },
      { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3, ownerOnly: true },
      { href: "/dashboard/marketing", label: "Marketing", icon: Megaphone, ownerOnly: true },
      { href: "/dashboard/payroll", label: "Payroll", icon: Banknote, ownerOnly: true, feature: "commission" },
      { href: "/dashboard/inventory", label: "Inventory", icon: Package, ownerOnly: true, feature: "inventory" },
      { href: "/dashboard/loyalty", label: "Loyalty & Promos", icon: Gift, ownerOnly: true, feature: "loyalty" },
      { href: "/dashboard/gift-cards", label: "Gift Cards", icon: Ticket, ownerOnly: true, feature: "loyalty" },
      { href: "/dashboard/reviews", label: "Reviews", icon: Star, ownerOnly: true },
      { href: "/dashboard/share", label: "Share Link", icon: Share2, ownerOnly: true },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/dashboard/settings", label: "Settings", icon: Settings, ownerOnly: true },
      { href: "/dashboard/billing", label: "Billing", icon: CreditCard, ownerOnly: true },
    ],
  },
];


export function Sidebar() {
  const pathname = usePathname();
  const { user, profile, shop, shops, setActiveShop, signOut, accessToken } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isAlsoBarber, setIsAlsoBarber] = useState(false);
  const [ownerPhoto, setOwnerPhoto] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close the mobile drawer whenever the route changes (i.e. the user
  // tapped a nav item) so they're not staring at the drawer on the new page.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Escape closes the drawer
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Lock body scroll while the drawer is open
  useEffect(() => {
    if (mobileOpen) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = original; };
    }
  }, [mobileOpen]);

  // Allow the mobile bottom-nav 'More' button to control the drawer via
  // custom window events. `cw-toggle-sidebar` flips it; `cw-open-sidebar`
  // forces it open (kept for back-compat). Decouples MobileNav from this
  // component's state.
  useEffect(() => {
    const open = () => setMobileOpen(true);
    const toggle = () => setMobileOpen(prev => !prev);
    // The dashboard header's inline bell opens the SAME notification popover as
    // the floating bell (which is hidden there), so the bell behaves the same
    // everywhere instead of navigating.
    const openNotifs = () => setNotifOpen(true);
    window.addEventListener("cw-open-sidebar", open);
    window.addEventListener("cw-toggle-sidebar", toggle);
    window.addEventListener("cw-open-notifs", openNotifs);
    return () => {
      window.removeEventListener("cw-open-sidebar", open);
      window.removeEventListener("cw-toggle-sidebar", toggle);
      window.removeEventListener("cw-open-notifs", openNotifs);
    };
  }, []);

  // Notification quick-view popover (mobile top-bar bell). State + a
  // refresh effect to grab the last 5 notifications when opened.
  const [notifOpen, setNotifOpen] = useState(false);
  // Manual drag-to-dismiss for the notification sheet. We intentionally avoid
  // framer's drag="y" forced a touch-action that blocked the list from
  // scrolling, so we drive the drag ourselves. useSheetDrag lets you pull the
  // sheet down from anywhere — but only once the list is scrolled to the top,
  // so scrolling still works (scroll-aware overscroll-to-dismiss).
  const notifSheetRef = useRef<HTMLDivElement | null>(null);
  const { dragY: notifDragY, dragging: notifDragging } = useSheetDrag(
    notifSheetRef, () => setNotifOpen(false), { enabled: notifOpen },
  );
  const [recentNotifs, setRecentNotifs] = useState<{ id: string; title: string; message: string; type: string; is_read: boolean; created_at: string; entity_type?: string | null; entity_id?: string | null }[]>([]);
  useEffect(() => {
    if (!notifOpen || !user) return;
    // select("*") so entity_type/entity_id come through once phase16 is run, and
    // the query doesn't error on shops that haven't run it yet.
    // Scoped to the active shop (multi-shop owners don't see other shops' alerts).
    fetchShopNotifications(supabase, { userId: user.id, shopId: shop?.id, limit: 15 })
      .then(({ data }) => setRecentNotifs((data ?? []) as unknown as typeof recentNotifs));
  }, [notifOpen, user, unreadCount, shop?.id]);

  // ── Inline Approve / Decline for booking notifications ────────────────────
  // Reuses the same client-side flow the calendar uses (status update + the
  // shared side-effect helpers). `shop` comes from useAuth above.
  const [notifActing, setNotifActing] = useState<string | null>(null);
  const [notifToast, setNotifToast] = useState("");
  const showNotifToast = (m: string) => { setNotifToast(m); setTimeout(() => setNotifToast(""), 2800); };
  const dismissNotif = (id: string) => {
    setRecentNotifs(prev => prev.filter(x => x.id !== id));
    // DELETE (not just mark read): the recent-notifs query re-fetches whenever
    // unreadCount changes and pulls read rows too, so a marked-read notification
    // would reappear right after Approve/Decline. Removing it makes it stick.
    supabase.from("notifications").delete().eq("id", id).then(null, () => null);
    setUnreadCount(c => Math.max(0, c - 1));
  };
  const actOnBooking = async (
    n: (typeof recentNotifs)[number],
    decision: "approve" | "decline",
  ) => {
    if (!shop || !n.entity_id || notifActing) return;
    setNotifActing(n.id);
    const { data: appt } = await supabase
      .from("appointments").select("*, services(name), barbers(name)")
      .eq("id", n.entity_id).maybeSingle();
    if (!appt) { setNotifActing(null); dismissNotif(n.id); showNotifToast("That booking is no longer available"); return; } // booking gone
    if (appt.status !== "pending") { setNotifActing(null); dismissNotif(n.id); showNotifToast("Already handled"); return; } // already handled
    const a = appt as unknown as AppointmentWithDetails;
    const who = a.client_name ? ` for ${a.client_name}` : "";
    if (decision === "approve") {
      const { error } = await supabase.from("appointments").update({ status: "confirmed" }).eq("id", a.id);
      if (error) { setNotifActing(null); showNotifToast("Couldn't approve — please try again"); return; }
      sendApprovalNotifications(a, shop, accessToken);
      showNotifToast(`Booking approved${who} ✓`);
    } else {
      const { error } = await supabase.from("appointments").update({ status: "cancelled" }).eq("id", a.id);
      if (error) { setNotifActing(null); showNotifToast("Couldn't decline — please try again"); return; }
      sendRejectionEmail(a, shop, "");
      notifyFreedSlot(a, shop, "Cancelled");
      showNotifToast(`Booking declined${who}`);
    }
    setNotifActing(null);
    dismissNotif(n.id);
  };

  // Detect whether this owner is also linked as a barber → show role-switch link,
  // and grab their barber photo so the owner-portal avatar shows their picture.
  useEffect(() => {
    if (!user || !shop || profile?.role !== "shop_owner") { setIsAlsoBarber(false); setOwnerPhoto(null); return; }
    supabase.from("barbers").select("id, photo").eq("user_id", user.id).eq("shop_id", shop.id).maybeSingle()
      .then(({ data }) => { setIsAlsoBarber(!!data); setOwnerPhoto((data as { photo?: string | null } | null)?.photo ?? null); });
  }, [user, shop, profile]);

  useEffect(() => {
    if (!user) return;

    // Initial load — scoped to the active shop.
    fetchShopUnreadCount(supabase, user.id, shop?.id).then(setUnreadCount);

    // Real-time updates. postgres_changes can only filter by user_id, so we
    // subscribe by user and recompute the shop-scoped count on any change.
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => {
        fetchShopUnreadCount(supabase, user.id, shop?.id).then(setUnreadCount);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, shop?.id]);

  const displayName = profile?.name ?? user?.email ?? "User";
  const initial = displayName.charAt(0).toUpperCase();
  const shopName = shop?.name ?? "Your Shop";

  return (
    <>
      {/* Floating glass control (mobile) — just the bell + avatar, pinned to the
          top-right and always visible. The old full-width bar + "ClipWise"
          wordmark are gone; page content scrolls under the blur. */}
      {/* Hidden on pages that carry the bell + profile inline in their own
          header (dashboard home, schedule, …) — see INLINE_HEADER_PAGES. */}
      {!INLINE_HEADER_PAGES.includes(pathname) && (
      <div className="lg:hidden fixed z-30 top-[calc(env(safe-area-inset-top)+0.625rem)] sm:top-[calc(env(safe-area-inset-top)+0.875rem)] right-4 sm:right-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setNotifOpen(o => !o)}
          aria-label="Notifications"
          aria-expanded={notifOpen}
          className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center text-foreground [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.35))] transition-colors relative",
            notifOpen ? "bg-black/20" : "hover:bg-black/10",
          )}
        >
          <Bell size={20} strokeWidth={2.5} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 bg-red-500 text-foreground text-[9px] font-bold rounded-full flex items-center justify-center border border-white leading-none">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        <Link
          href="/dashboard/settings"
          aria-label="Account"
          className="w-7 h-7 rounded-full bg-white text-black font-extrabold text-[10px] flex items-center justify-center shadow-md hover:opacity-90 transition-opacity overflow-hidden"
        >
          <AvatarImage src={profile?.avatar || ownerPhoto} alt={displayName} className="w-full h-full object-cover" fallback={<>{initial}</>} />
        </Link>
      </div>
      )}

      {/* Notification sheet — slides up from the bottom (matches the app's other
          sheets). Drag the handle down or tap outside to close. */}
      <AnimatePresence>
        {notifOpen && (
          <>
            <motion.div
              className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[70]"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
              onClick={() => setNotifOpen(false)}
            />
            {/* Outer: positioning + slide only (NO framer drag → no touch-action
                lock, so the list scrolls natively). */}
            <motion.div
              className="lg:hidden fixed inset-x-0 bottom-0 sm:inset-0 z-[80] sm:flex sm:items-center sm:justify-center sm:p-4"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "tween", duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            >
              {/* Inner: the sheet card. On phones it's a bottom sheet (useSheetDrag
                  lets you pull it down to dismiss); on tablets it centres as a modal. */}
              <div
                ref={notifSheetRef}
                className="bg-card border-t sm:border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col w-full sm:max-w-md max-h-[82vh] sm:max-h-[80vh] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-2"
                style={{
                  transform: notifDragY ? `translateY(${notifDragY}px)` : undefined,
                  transition: notifDragging ? "none" : "transform 0.28s cubic-bezier(.32,.72,0,1)",
                }}
              >
                {/* Drag handle — pull down anywhere to dismiss, or tap the handle */}
                <div onClick={() => setNotifOpen(false)}
                  className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing flex-shrink-0">
                  <div className="w-10 h-1.5 rounded-full bg-[#3a3a3a]" />
                </div>
                <div className="px-4 pb-3 flex items-center justify-between flex-shrink-0">
                  <p className="text-base font-bold text-foreground">Notifications</p>
                  <Link href="/dashboard/notifications" onClick={() => setNotifOpen(false)} className="text-xs font-semibold text-accent-soft hover:underline">See all</Link>
                </div>
                {recentNotifs.length === 0 ? (
                  <div className="px-4 py-10 text-center text-grey text-sm">Nothing here yet</div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-2">
                    {(() => {
                      // Group: unread actionable → "Action required", then by day.
                      const action = recentNotifs.filter(n => !n.is_read && classifyNotif(n).actionable);
                      const actionIds = new Set(action.map(n => n.id));
                      const rest = recentNotifs.filter(n => !actionIds.has(n.id));
                      const today = rest.filter(n => isToday(n.created_at));
                      const earlier = rest.filter(n => !isToday(n.created_at));
                      const card = (n: (typeof recentNotifs)[number]) => {
                        const c = classifyNotif(n);
                        // Inline actions only when we have a linked appointment (phase16).
                        const inlineAppt = c.actionable && n.entity_type === "appointment" && !!n.entity_id;
                        const acting = notifActing === n.id;
                        const cls = cn("block rounded-xl border border-border border-l-[3px] mb-2 px-3 py-3 transition-colors",
                          n.is_read ? "bg-card" : "bg-white/[0.04]");
                        const body = (
                          <div className="flex gap-3">
                            <span className={cn("w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0", c.chip)}>
                              <c.Icon size={16} />
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className={cn("text-sm truncate", n.is_read ? "font-semibold text-[#dcdcdc]" : "font-bold text-foreground")}>{cleanNotifTitle(n.title)}</p>
                                <span className={cn("flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full", c.badgeCls)}>{c.badge}</span>
                              </div>
                              <p className="text-xs text-grey line-clamp-2 mt-0.5">{n.message}</p>
                              {inlineAppt ? (
                                <>
                                  <div className="flex items-center gap-2 mt-2.5">
                                    <button type="button" disabled={acting}
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); actOnBooking(n, "approve"); }}
                                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-semibold py-1.5 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors">
                                      <Check size={13} /> {acting ? "Working…" : "Approve"}
                                    </button>
                                    <button type="button" disabled={acting}
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); actOnBooking(n, "decline"); }}
                                      className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/30 text-xs font-semibold py-1.5 hover:bg-rose-500/25 disabled:opacity-50 transition-colors">
                                      <X size={13} /> Decline
                                    </button>
                                  </div>
                                  <span className="block text-[11px] text-grey mt-1.5">{timeAgo(n.created_at)}</span>
                                </>
                              ) : (
                                <div className="flex items-center justify-between mt-1.5">
                                  <span className="text-[11px] text-grey">{timeAgo(n.created_at)}</span>
                                  {c.actionable && (
                                    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-300">
                                      Review <ChevronRight size={12} />
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            {!n.is_read && <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0 mt-1" />}
                          </div>
                        );
                        return inlineAppt ? (
                          <div key={n.id} style={{ borderLeftColor: c.accent }} className={cls}>{body}</div>
                        ) : (
                          <Link key={n.id} href={notifHref(n)} onClick={() => setNotifOpen(false)}
                            style={{ borderLeftColor: c.accent }}
                            className={cn(cls, "active:bg-white/[0.06]", n.is_read ? "hover:bg-card-raised" : "hover:bg-white/[0.07]")}>
                            {body}
                          </Link>
                        );
                      };
                      const section = (label: string, items: typeof recentNotifs, labelCls = "text-grey") =>
                        items.length > 0 ? (
                          <div className="mb-1" key={label}>
                            <p className={cn("text-[11px] font-bold uppercase tracking-wider px-1 pt-2 pb-1.5", labelCls)}>{label}</p>
                            {items.map(card)}
                          </div>
                        ) : null;
                      return (
                        <>
                          {section("Action required", action, "text-amber-400")}
                          {section("Today", today)}
                          {section("Earlier", earlier)}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Confirmation toast for inline Approve/Decline (sits above the sheet). */}
      {notifToast && (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 lg:left-auto lg:right-6 lg:translate-x-0 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl whitespace-nowrap">
          {notifToast}
        </div>
      )}

      {/* Backdrop — only renders on mobile when drawer is open */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-[55] animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          // Light sidebar: pure-white surface with a hairline gray right edge.
          // Looks like the rest of the dashboard cards — Apple-style "this is
          // navigation, not chrome" treatment.
          "cw-sidebar fixed left-0 top-0 z-[60] w-64 h-[100dvh] flex flex-col bg-card border-r border-border transition-transform duration-200 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
      {/* Sidebar wordmark + shop plan badge — a compact centred row so the
          wordmark doesn't float with dead space on both sides. cw-grad is on the
          wordmark span only (not the div) so it never bleeds onto the badge. */}
      <div
        className="cw-logo-fade whitespace-nowrap border-b border-border flex flex-col justify-center items-start gap-1.5 pl-6"
        style={{
          fontFamily: "'Sora', sans-serif",
          fontWeight: 800,
          letterSpacing: "-0.02em",
          color: "#ffffff",
          height: "64px",
        }}
      >
        {/* Stacked lockup: signature gradient wordmark over the plan as a spaced
            small-caps kicker (no pill) — tidier than the old inline badge. */}
        <span className="cw-grad" style={{ fontSize: "23px", lineHeight: 1 }}>CLIPWISE</span>
        {shop?.subscription_plan && shop.subscription_plan !== "starter" && (
          <span className="uppercase font-semibold text-accent text-[9px] tracking-[0.34em] ml-[2px] leading-none">
            {shop.subscription_plan}
          </span>
        )}
      </div>

      <ShopSwitcher shop={shop} shops={shops} setActiveShop={setActiveShop} />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {(() => {
          const plan = effectivePlan(shop?.subscription_plan, shop?.subscription_status);
          const visibleSections = navSections
            .map(section => ({
              ...section,
              items: section.items.filter(item => {
                if (item.ownerOnly && profile?.role === "barber") return false;
                if (item.feature) return planHasFeature(plan, item.feature);
                return true;
              }),
            }))
            .filter(section => section.items.length > 0);

          return visibleSections.map((section, sectionIdx) => (
            <div
              key={section.label}
              className={cn(sectionIdx > 0 && "mt-4 pt-4 border-t border-border")}
            >
              <p className="text-[10px] uppercase tracking-wider text-grey font-semibold px-3 mb-1.5">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group",
                        isActive
                          ? "bg-foreground text-background border border-foreground"
                          : "text-grey hover:text-foreground hover:bg-card-raised"
                      )}
                    >
                      <Icon size={18} className={cn(isActive ? "text-background" : "text-grey group-hover:text-foreground")} />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && unreadCount > 0 && (
                        <span className={cn(
                          "text-[10px] font-bold rounded-full w-[18px] h-[18px] flex items-center justify-center",
                          isActive ? "bg-card text-foreground" : "bg-foreground text-background"
                        )}>
                          {unreadCount}
                        </span>
                      )}
                      {isActive && <ChevronRight size={14} className="text-background" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ));
        })()}

        {/* Owner-also-barber: prominent switch to barber view */}
        {isAlsoBarber && (
          <Link href="/barber-dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group text-grey hover:text-foreground hover:bg-card-raised mt-4 pt-4 border-t border-border">
            <Scissors size={18} className="text-grey group-hover:text-foreground" />
            <span className="flex-1">My Barber View</span>
            <ChevronRight size={14} className="opacity-50" />
          </Link>
        )}
      </nav>

      {/* User */}
      <div className="px-3 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-black font-semibold text-sm overflow-hidden">
            <AvatarImage src={profile?.avatar || ownerPhoto} alt={displayName} className="w-full h-full object-cover" fallback={<>{initial}</>} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
            <p className="text-xs text-grey truncate capitalize">{profile?.role ?? "owner"}</p>
          </div>
          <PortalThemeToggle className="w-8 h-8 flex-shrink-0" />
          <button onClick={signOut} className="text-grey hover:text-red-500 transition-colors">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  // 4 page-links + 1 'More' drawer-opener. The drawer is the canonical
  // way to reach everything else (Staff, Services, Settings, etc.).
  const linkItems = [
    { href: "/dashboard",              label: "Home",         icon: LayoutDashboard },
    { href: "/dashboard/schedule",     label: "Schedule",     icon: Clock },
    { href: "/dashboard/calendar",     label: "Calendar",     icon: CalendarDays },
    { href: "/dashboard/pos",          label: "POS",          icon: CreditCard },
    { href: "/dashboard/payments",     label: "Payments",     icon: Banknote },
  ];
  const toggleDrawer = () => window.dispatchEvent(new Event("cw-toggle-sidebar"));

  return (
    <nav className="cw-bnav lg:hidden">
      {linkItems.map((item) => {
        const isActive = pathname === item.href
          || (item.href !== "/dashboard" && pathname.startsWith(item.href));
        return (
          <Link key={item.href} href={item.href} className={cn("cw-ni", isActive && "active")}>
            <div className="cw-ni-icon"><item.icon size={20} /></div>
            <div className="cw-ni-label">{item.label}</div>
            {isActive && <div className="cw-ni-line" />}
          </Link>
        );
      })}
      {/* 'More' opens the sidebar drawer instead of navigating somewhere.
          Replaces the old top-bar hamburger so all chrome lives in one
          predictable spot at the bottom of the screen. */}
      <button type="button" onClick={toggleDrawer} className="cw-ni" aria-label="Toggle menu">
        <div className="cw-ni-icon"><Menu size={20} /></div>
        <div className="cw-ni-label">More</div>
      </button>
    </nav>
  );
}
