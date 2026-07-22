"use client";
import { useState, useEffect, useRef } from "react";
import { Building2, ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
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

  return (
    <div ref={ref} className="relative px-3 pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-raised border border-border hover:border-gold/40 transition-colors text-left"
      >
        <Building2 size={14} className="text-gold flex-shrink-0" />
        <span className="flex-1 text-sm text-white truncate">{shop?.name ?? "Select Shop"}</span>
        <ChevronsUpDown size={14} className="text-[#8f8f8f] flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-surface border border-border rounded-xl shadow-xl overflow-hidden">
          {shops.map(s => (
            <button
              key={s.id}
              onClick={() => { setActiveShop(s); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-surface-raised transition-colors text-left"
            >
              <Check size={13} className={cn("flex-shrink-0", s.id === shop?.id ? "text-gold" : "text-transparent")} />
              <span className={cn("truncate", s.id === shop?.id ? "text-white font-medium" : "text-[#8f8f8f]")}>{s.name}</span>
              {s.status === "pending" && <span className="ml-auto text-xs text-orange-400">Pending</span>}
              {s.status === "suspended" && <span className="ml-auto text-xs text-red-400">Suspended</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
