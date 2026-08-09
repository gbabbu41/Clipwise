"use client";
import Link from "next/link";
import { useState, useRef, useEffect, type ElementType } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LogOut, Settings, CreditCard, Bell, User, DollarSign, Share2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { AvatarImage } from "@/components/ui/avatar-image";
import { cn } from "@/lib/utils";

/** A menu row is either a link (href) or an action (onClick), never both. */
export type ProfileMenuItem = {
  label: string;
  icon: ElementType;
  href?: string;
  onClick?: () => void;
};

/**
 * Universal account dropdown — tapping the profile avatar reveals a menu with
 * the name/email, quick links (settings / billing / profile …) and a Log out
 * button, instead of the avatar being a bare link straight to Settings. Used in
 * BOTH portals (owner + barber) at every profile-avatar spot — the mobile
 * floating pill, the desktop page headers, and the home headers — so the whole
 * app has one consistent account menu. Closes on outside-click or Escape.
 */
export function ProfileMenu({
  name, photo, roleLabel, items, triggerClassName, className, align = "right",
}: {
  name: string;
  photo?: string | null;
  roleLabel?: string;
  items: ProfileMenuItem[];
  triggerClassName?: string;
  className?: string;
  align?: "left" | "right";
}) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = (name || "U").charAt(0).toUpperCase();
  const email = user?.email ?? "";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className={triggerClassName}
      >
        <AvatarImage src={photo} alt={name} className="w-full h-full object-cover" fallback={<>{initial}</>} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.32, 0.72, 0, 1] }}
            className={cn(
              "absolute top-full mt-2 w-60 rounded-2xl border border-border bg-card-raised shadow-xl shadow-black/30 overflow-hidden z-[90]",
              align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            )}
          >
            {/* Identity */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
              <div className="w-10 h-10 rounded-full bg-white text-black font-extrabold text-sm flex items-center justify-center overflow-hidden flex-shrink-0">
                <AvatarImage src={photo} alt={name} className="w-full h-full object-cover" fallback={<>{initial}</>} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{name}</p>
                {email ? <p className="text-xs text-grey truncate">{email}</p>
                  : roleLabel ? <p className="text-xs text-grey truncate">{roleLabel}</p> : null}
              </div>
            </div>

            {/* Quick links / actions */}
            <div className="py-1.5">
              {items.map(({ label, href, icon: Icon, onClick }) => {
                const cls = "w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-foreground/5 transition-colors text-left";
                const inner = (<><Icon size={16} className="text-grey flex-shrink-0" /><span className="truncate">{label}</span></>);
                return href ? (
                  <Link key={label} href={href} onClick={() => setOpen(false)} role="menuitem" className={cls}>{inner}</Link>
                ) : (
                  <button key={label} type="button" role="menuitem" className={cls}
                    onClick={() => { setOpen(false); onClick?.(); }}>{inner}</button>
                );
              })}
            </div>

            {/* Log out */}
            <div className="py-1.5 border-t border-border">
              <button
                type="button"
                onClick={() => { setOpen(false); void signOut(); }}
                role="menuitem"
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <LogOut size={16} className="flex-shrink-0" />
                <span>Log out</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Owner-portal account menu — same links everywhere it appears. The Share page
 *  shows the shop's booking link (which, for a solo/Starter shop, auto-locks to
 *  the one barber — so it's effectively that barber's personal link). */
export const OWNER_MENU_ITEMS: ProfileMenuItem[] = [
  { label: "Share booking link", href: "/dashboard/share", icon: Share2 },
  { label: "Account & settings", href: "/dashboard/settings", icon: Settings },
  { label: "Billing & plan", href: "/dashboard/billing", icon: CreditCard },
  { label: "Notifications", href: "/dashboard/notifications", icon: Bell },
];

/** Barber-portal account menu. `onShare`, when given, adds a "Share my link"
 *  action (the barber's personal ?barber= link). Payments shows only when the
 *  barber may see earnings. */
export function barberMenuItems(canSeeEarnings: boolean, onShare?: () => void): ProfileMenuItem[] {
  return [
    ...(onShare ? [{ label: "Share my link", icon: Share2, onClick: onShare }] : []),
    { label: "Profile", href: "/barber-dashboard/profile", icon: User },
    ...(canSeeEarnings ? [{ label: "Payments", href: "/barber-dashboard/earnings", icon: DollarSign }] : []),
    { label: "Notifications", href: "/barber-dashboard/notifications", icon: Bell },
  ];
}
