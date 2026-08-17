"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Calendar, Users, UserCheck, Receipt,
  BarChart3, Scissors, Star, Bell, CreditCard, Settings,
  Gift, ChevronRight, LogOut, Package, ClipboardList, CalendarDays, Ticket, Banknote, Share2, Megaphone, UmbrellaOff, Tablet, MessageSquare,
  Menu, BellRing, AlertTriangle, CalendarX2, Info, Clock, CheckCircle2, RefreshCcw, Check, X,
  PanelLeft, PanelLeftClose, Plus, Briefcase, ChevronDown,
} from "lucide-react";
// Logo component no longer used — sidebar wordmark is an inline div now.
import { cn, timeAgo, formatRole } from "@/lib/utils";
import { UnreadBadge } from "@/components/notification-badge";
import { AvatarImage } from "@/components/ui/avatar-image";
import { ProfileMenu, OWNER_MENU_ITEMS } from "@/components/profile-menu";
import { useConfirm } from "@/components/ui/confirm-dialog";

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
  if (n.type === "booking" || n.type === "cancellation" || n.type === "no-show" || /book(ed|ing)|appointment/.test(s)) return "/dashboard/calendar";
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
import { effectivePlan, planHasFeature, isPaidPlan, type PlanFeature } from "@/lib/validation";
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
  paidOnly?: boolean; // hidden on the free Starter plan (reviews, marketing, analytics, waitlist…)
  hidden?: boolean;   // temporarily hidden from the nav on ALL plans (page/logic kept)
}

// Simple sidebar (mirrors the barber portal): the primary items sit flat on top,
// everything else lives under a collapsible "Business" group, and account items
// (Settings/Billing) pin to the bottom. Items that don't pass the ownerOnly +
// feature-gating filter are skipped at render time.
const primaryItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/schedule", label: "Schedule", icon: Clock, ownerOnly: true },
  { href: "/dashboard/pos", label: "Point of Sale", icon: Receipt, feature: "pos" },
  { href: "/dashboard/payments", label: "Payments", icon: CreditCard, ownerOnly: true, feature: "payments" },
  { href: "/dashboard/staff", label: "Staff", icon: UserCheck, ownerOnly: true, paidOnly: true },
  { href: "/dashboard/clients", label: "Clients", icon: Users, ownerOnly: true },
];

const businessItems: NavItem[] = [
  { href: "/dashboard/services", label: "Services", icon: Scissors, ownerOnly: true },
  { href: "/dashboard/time-off", label: "Time Off", icon: UmbrellaOff, ownerOnly: true, paidOnly: true },
  { href: "/dashboard/waitlist", label: "Waitlist", icon: ClipboardList, paidOnly: true },
  { href: "/dashboard/waitlist-requests", label: "Spot Waitlist", icon: BellRing, ownerOnly: true, paidOnly: true },
  { href: "/dashboard/kiosk", label: "Walk-in Kiosk", icon: Tablet, ownerOnly: true, paidOnly: true },
  // Messages: temporarily hidden from the nav on ALL plans — page + send logic
  // are kept intact. Delete `hidden: true` to bring it back for Pro/Premium.
  { href: "/dashboard/messages", label: "Messages", icon: MessageSquare, paidOnly: true, hidden: true },
  { href: "/dashboard/notifications", label: "Notifications", icon: Bell, badge: true },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3, ownerOnly: true, paidOnly: true },
  { href: "/dashboard/marketing", label: "Marketing", icon: Megaphone, ownerOnly: true, paidOnly: true },
  { href: "/dashboard/payroll", label: "Payroll", icon: Banknote, ownerOnly: true, feature: "commission" },
  { href: "/dashboard/inventory", label: "Inventory", icon: Package, ownerOnly: true, feature: "inventory" },
  { href: "/dashboard/loyalty", label: "Loyalty & Promos", icon: Gift, ownerOnly: true, feature: "loyalty" },
  { href: "/dashboard/gift-cards", label: "Gift Cards", icon: Ticket, ownerOnly: true, feature: "loyalty" },
  { href: "/dashboard/reviews", label: "Reviews", icon: Star, ownerOnly: true, paidOnly: true },
  { href: "/dashboard/share", label: "Share Link", icon: Share2, ownerOnly: true },
];

const accountItems: NavItem[] = [
  { href: "/dashboard/settings", label: "Settings", icon: Settings, ownerOnly: true },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard, ownerOnly: true },
];


// Mobile top-bar titles. Explicit labels for routes whose auto-derived name would
// be wrong/ugly; every other page falls back to a title-cased route segment (see
// barTitleFor) so NO page shows a blank bar. Mirrors the barber portal.
const BAR_TITLE: Record<string, string> = {
  "/dashboard": "Home",
  "/dashboard/pos": "POS",
  "/dashboard/my-stats": "My Stats",
  "/dashboard/waitlist": "Waitlist",
  "/dashboard/waitlist-requests": "Spot Waitlist",
  "/dashboard/stripe-setup": "Get Paid",
};

// The bar title for a route: explicit map first, else title-case the last path
// segment ("/dashboard/gift-cards" → "Gift Cards", "/dashboard/time-off" →
// "Time Off"). Falls back to "Dashboard" for anything unexpected.
function barTitleFor(pathname: string): string {
  if (BAR_TITLE[pathname]) return BAR_TITLE[pathname];
  const seg = pathname.split("/").filter(Boolean).pop() ?? "";
  if (!seg || seg === "dashboard") return "Home";
  return seg.split("-").map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, shop, shops, setActiveShop, signOut, accessToken } = useAuth();
  const { confirm } = useConfirm();
  // Confirm before signing out — the icon sits next to the theme toggle, so a
  // stray tap shouldn't drop the owner straight to the login screen.
  const confirmSignOut = async () => {
    if (await confirm({ title: "Sign out?", message: "You'll need to sign in again to get back in.", confirmText: "Sign out", cancelText: "Stay signed in" })) signOut();
  };
  const [unreadCount, setUnreadCount] = useState(0);
  // Remembers where the owner was before opening Clients so the toggle can return
  // there — never router.back(), which would leave the app entirely if Clients was
  // the first page (deep link / refresh / no in-app history).
  const clientsReturnRef = useRef<string>("/dashboard");
  const isBarber = profile?.role === "barber";
  const toggleClients = () => {
    if (pathname === "/dashboard/clients") {
      router.push(clientsReturnRef.current || "/dashboard");
    } else {
      clientsReturnRef.current = pathname;
      router.push("/dashboard/clients");
    }
  };
  const [isAlsoBarber, setIsAlsoBarber] = useState(false);
  const [ownerPhoto, setOwnerPhoto] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Collapsible "Business" group in the sidebar (primary items stay flat on top).
  const [businessOpen, setBusinessOpen] = useState(false);

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

  // Desktop (lg+): let the owner collapse/expand the docked sidebar. A class on
  // <html> drives the CSS that slides it out and reclaims the content margin;
  // the choice is remembered across reloads. Mobile is unaffected (drawer).
  useEffect(() => {
    try {
      if (localStorage.getItem("cw_sidebar_collapsed") === "1") document.documentElement.classList.add("cw-sidebar-collapsed");
    } catch { /* storage unavailable */ }
  }, []);
  const toggleDesktopSidebar = () => {
    const collapsed = document.documentElement.classList.toggle("cw-sidebar-collapsed");
    try { localStorage.setItem("cw_sidebar_collapsed", collapsed ? "1" : "0"); } catch { /* storage unavailable */ }
  };

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

  // Mobile top bar: hide on scroll-down, come back on scroll-up (matches the
  // barber portal); the hairline border fades in only once content scrolls under
  // the bar.
  const [topBarHidden, setTopBarHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 4);
      const delta = y - lastY;
      if (Math.abs(delta) < 6) return;
      if (delta > 0 && y > 40) setTopBarHidden(true);
      else if (delta < 0) setTopBarHidden(false);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
      .then(({ data, error }) => { if (!error) setRecentNotifs((data ?? []) as unknown as typeof recentNotifs); });
    // Deliberately NOT keyed on unreadCount: mark-seen sets it to 0, which would
    // re-run this fetch and race the (fire-and-forget) DB write — re-reading rows
    // still is_read:false and repainting the "unread" dots the open sheet just
    // cleared. The sheet already loads fresh on every open (notifOpen).
  }, [notifOpen, user, shop?.id]);

  // Opening the bell marks everything SEEN so the red badge clears right away (and
  // stays cleared on refresh). Mirrors the unread-count scope: this user's unread
  // rows for the active shop (or legacy null-shop rows).
  const markNotifsSeen = () => {
    if (!user || unreadCount === 0) return;
    setUnreadCount(0);
    setRecentNotifs(prev => prev.map(n => ({ ...n, is_read: true })));
    let q = supabase.from("notifications").update({ is_read: true })
      .eq("user_id", user.id).eq("is_read", false);
    if (shop?.id) q = q.or(`shop_id.eq.${shop.id},shop_id.is.null`);
    // Read the error (not just swallow a rejection): a Supabase update RESOLVES
    // with { error } on an RLS/DB failure, so without this a silently-failed
    // write leaves the rows unread and the red badge returns on next refresh.
    q.then(({ error }) => { if (error) console.error("mark notifications seen failed:", error.message); }, () => {});
  };
  useEffect(() => {
    if (notifOpen) markNotifsSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifOpen]);

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

  // The Clients top-bar button uses router.push (a toggle), which — unlike a
  // <Link> — doesn't auto-prefetch. Warm the route once on mount so the tap is
  // instant, matching the prefetch the bottom-nav Link tabs get for free. Skip
  // for barbers, who don't see the Clients shortcut.
  useEffect(() => { if (!isBarber) router.prefetch("/dashboard/clients"); }, [router, isBarber]);

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
      {/* Mobile top bar — the shop portal's sticky top nav, identical to the
          barber portal: route title (left) + bell + profile on a solid card bar
          that spans the notch; the hairline border fades in once content scrolls
          under it. Replaces the old floating bell/profile pill. */}
      <div
        className={cn(
          "lg:hidden fixed top-0 left-0 right-0 z-30 h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] flex items-center gap-2 pl-5 pr-3 bg-card transition-all duration-200 border-b",
          scrolled ? "border-border" : "border-transparent",
          topBarHidden ? "-translate-y-full" : "translate-y-0",
        )}
      >
        <h1 className="flex-1 min-w-0 text-[23px] font-extrabold uppercase tracking-[0.02em] text-foreground truncate">{barTitleFor(pathname)}</h1>
        {/* Clients shortcut — toggles like the bell: tap to open Clients, tap
            again (while on it) to return where you were. Owner-only, matching the
            sidebar's ownerOnly Clients item. Highlights while active. */}
        {!isBarber && (() => {
          const onClients = pathname === "/dashboard/clients";
          return (
            <button
              type="button"
              onClick={toggleClients}
              aria-label="Clients"
              aria-pressed={onClients}
              className={cn(
                "w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0",
                onClients ? "bg-white/10 text-foreground" : "text-foreground hover:bg-white/5",
              )}
            >
              <Users size={19} />
            </button>
          );
        })()}
        <button
          type="button"
          onClick={() => setNotifOpen(o => !o)}
          aria-label="Notifications"
          aria-expanded={notifOpen}
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center text-foreground transition-colors relative flex-shrink-0",
            notifOpen ? "bg-white/10" : "hover:bg-white/5",
          )}
        >
          <Bell size={20} strokeWidth={2.5} />
          <UnreadBadge count={unreadCount} />
        </button>
        <ProfileMenu
          name={displayName}
          photo={profile?.avatar || ownerPhoto}
          items={OWNER_MENU_ITEMS}
          triggerClassName="w-9 h-9 rounded-full bg-white text-black font-extrabold text-[11px] flex items-center justify-center hover:opacity-90 transition-opacity flex-shrink-0 overflow-hidden"
        />
      </div>

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
          // Background set inline (not a bg-black/* class) on purpose: it keeps
          // this drawer backdrop from matching ModalChrome's selector, so the
          // drawer uses only its own lightweight overflow-lock. ModalChrome's
          // position:fixed body-lock broke the drawer's full height on iOS, and
          // its nav-hide left a dark void at the bottom when the drawer opened.
          className="lg:hidden fixed inset-0 z-[55] animate-fade-in"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Desktop: floating "show sidebar" button — CSS reveals it only when the
          sidebar is collapsed on lg+ (hidden on mobile / when expanded). */}
      <button
        type="button"
        onClick={toggleDesktopSidebar}
        aria-label="Show sidebar"
        className="cw-sidebar-expand hidden fixed left-3 z-[61] w-9 h-9 rounded-xl bg-card border border-border text-grey hover:text-foreground shadow-sm items-center justify-center"
        style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <PanelLeft size={18} />
      </button>

      <aside
        className={cn(
          // Light sidebar: pure-white surface with a hairline gray right edge.
          // Looks like the rest of the dashboard cards — Apple-style "this is
          // navigation, not chrome" treatment.
          // pt = status-bar inset so the wordmark header doesn't slide UNDER the
          // clock/notch when the app runs as an installed PWA (standalone, where
          // content extends to the top edge). No-op in a browser tab / on desktop
          // (inset resolves to 0).
          "cw-sidebar fixed inset-y-0 left-0 z-[60] w-64 pt-[env(safe-area-inset-top)] flex flex-col bg-card border-r border-border transition-transform duration-200 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
      {/* Sidebar wordmark — plain solid CLIPWISE (theme-aware colour, no gradient),
          same 26px as the barber portal so both sidebars match exactly. */}
      <div
        className="cw-logo-fade relative whitespace-nowrap border-b border-border flex items-center justify-start pl-6"
        style={{
          fontFamily: "'Sora', var(--font-body), system-ui, sans-serif",
          fontWeight: 800,
          fontSize: "23px",
          letterSpacing: "-0.02em",
          color: "var(--foreground)",
          height: "3.5rem",
        }}
      >
        CLIPWISE
        {/* Desktop: collapse the sidebar (mobile uses the drawer + backdrop tap) */}
        <button
          type="button"
          onClick={toggleDesktopSidebar}
          aria-label="Hide sidebar"
          className="hidden lg:flex absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-grey hover:text-foreground hover:bg-surface-raised items-center justify-center"
        >
          <PanelLeftClose size={18} />
        </button>
      </div>

      <ShopSwitcher shop={shop} shops={shops} setActiveShop={setActiveShop} />

      {/* Nav */}
      <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-0.5">
        {(() => {
          const plan = effectivePlan(shop?.subscription_plan, shop?.subscription_status);
          const passes = (item: NavItem) => {
            if (item.hidden) return false;
            if (item.ownerOnly && profile?.role === "barber") return false;
            if (item.paidOnly && !isPaidPlan(plan)) return false;
            if (item.feature) return planHasFeature(plan, item.feature);
            return true;
          };
          const renderItem = (item: NavItem) => {
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
                    : "text-grey hover:text-foreground hover:bg-card-raised",
                )}
              >
                <Icon size={18} className={cn(isActive ? "text-background" : "text-grey group-hover:text-foreground")} />
                <span className="flex-1">{item.label}</span>
                {item.badge && unreadCount > 0 && (
                  <span className={cn(
                    "text-[10px] font-bold rounded-full w-[18px] h-[18px] flex items-center justify-center",
                    isActive ? "bg-card text-foreground" : "bg-foreground text-background",
                  )}>
                    {unreadCount}
                  </span>
                )}
                {isActive && <ChevronRight size={14} className="text-background" />}
              </Link>
            );
          };
          const business = businessItems.filter(passes);
          const account = accountItems.filter(passes);
          const businessActive = business.some(i => i.href === pathname);
          const showBusiness = businessOpen || businessActive;
          return (
            <>
              {/* Primary items — flat on top, no group labels (mirrors the barber portal). */}
              {primaryItems.filter(passes).map(renderItem)}

              {/* Everything else tucked under a collapsible Business group. */}
              {business.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setBusinessOpen(o => !o)}
                    aria-expanded={showBusiness}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-grey hover:text-foreground hover:bg-card-raised transition-all duration-200 group"
                  >
                    <Briefcase size={18} className="text-grey group-hover:text-foreground" />
                    <span className="flex-1 text-left">Business</span>
                    <ChevronDown size={16} className={cn("transition-transform duration-200", showBusiness && "rotate-180")} />
                  </button>
                  {showBusiness && <div className="mt-0.5 space-y-0.5">{business.map(renderItem)}</div>}
                </div>
              )}

              {/* Account (Settings / Billing) pinned at the bottom. */}
              {account.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border space-y-0.5">
                  {account.map(renderItem)}
                </div>
              )}
            </>
          );
        })()}

        {/* Owner-also-barber: prominent switch to barber view. Paid plans only —
            a solo Starter owner has ONE view (the barber portal bounces them back
            anyway), so showing this link would just be a dead-end loop. */}
        {isAlsoBarber && isPaidPlan(effectivePlan(shop?.subscription_plan, shop?.subscription_status)) && (
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
            <p className="text-xs text-grey truncate">{formatRole(profile?.role)}</p>
          </div>
          <PortalThemeToggle className="w-8 h-8 flex-shrink-0" />
          <button onClick={confirmSignOut} className="text-grey hover:text-red-500 transition-colors">
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
  const toggleDrawer = () => window.dispatchEvent(new Event("cw-toggle-sidebar"));

  // Two tabs flank the center + ; the last tab + More sit on the right. Schedule
  // moved into the More drawer and Clients moved to the top bar to make room, so
  // the four tabs stay balanced around the raised quick-add button.
  const navLink = (href: string, label: string, Icon: typeof LayoutDashboard) => {
    const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
    return (
      <Link href={href} className={cn("cw-ni", isActive && "active")}>
        <div className="cw-ni-icon"><Icon size={20} /></div>
        <div className="cw-ni-label">{label}</div>
        {isActive && <div className="cw-ni-line" />}
      </Link>
    );
  };

  // Center + → open the global add-appointment modal INSTANTLY over the current
  // page (mounted in the dashboard layout). No navigation to the calendar, no
  // background swap — the modal posts to the same /api/book/in-person the calendar
  // uses, so it's one shared booking path.
  const newAppointment = () => {
    window.dispatchEvent(new Event("cw-open-newappt"));
  };

  return (
    <nav className="cw-bnav lg:hidden">
      {navLink("/dashboard", "Home", LayoutDashboard)}
      {navLink("/dashboard/calendar", "Calendar", CalendarDays)}
      {/* Center hero — opens the add-appointment banner. */}
      <button type="button" onClick={newAppointment} className="cw-fab" aria-label="New appointment">
        <Plus size={26} strokeWidth={2.6} />
      </button>
      {navLink("/dashboard/payments", "Payments", Banknote)}
      {/* 'More' opens the sidebar drawer (Schedule, Clients, Staff, Settings…). */}
      <button type="button" onClick={toggleDrawer} className="cw-ni" aria-label="Toggle menu">
        <div className="cw-ni-icon"><Menu size={20} /></div>
        <div className="cw-ni-label">More</div>
      </button>
    </nav>
  );
}
