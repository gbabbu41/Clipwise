"use client";
import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn, titleCase } from "@/lib/utils";
import type { Shop } from "@/lib/database.types";

interface Props {
  shop: Shop | null;
  shops: Shop[];
  setActiveShop: (s: Shop) => void;
}

export function ShopSwitcher({ shop, shops, setActiveShop }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (shops.length < 2) return null;

  // Fallback badge when a shop has no logo: its initials (first letter of the
  // first two words), e.g. "Fade Mechanic" → "FM".
  const initials = (shop?.name ?? "")
    .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";

  return (
    <div ref={ref} className="relative px-3 pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-transparent border border-border hover:border-foreground/30 transition-colors text-left"
      >
        {shop?.logo
          ? <img src={shop.logo} alt="" className="w-5 h-5 rounded object-cover flex-shrink-0" />
          : <span className="w-5 h-5 rounded bg-card-raised border border-border text-foreground text-[9px] font-bold flex items-center justify-center flex-shrink-0">{initials}</span>}
        <span className="flex-1 text-sm text-foreground truncate">{shop?.name ? titleCase(shop.name) : "Select Shop"}</span>
        <ChevronDown size={15} className="text-grey flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-surface border border-border rounded-xl shadow-xl overflow-hidden">
          {shops.map(s => (
            <button
              key={s.id}
              onClick={() => { setActiveShop(s); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-surface-raised transition-colors text-left"
            >
              <Check size={13} className={cn("flex-shrink-0", s.id === shop?.id ? "text-emerald-500" : "text-transparent")} />
              <span className={cn("truncate", s.id === shop?.id ? "text-foreground font-medium" : "text-grey")}>{titleCase(s.name)}</span>
              {s.status === "pending" && <span className="ml-auto text-xs text-orange-400">Pending</span>}
              {s.status === "suspended" && <span className="ml-auto text-xs text-red-400">Suspended</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
