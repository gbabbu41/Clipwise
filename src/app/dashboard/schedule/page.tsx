"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { ScheduleEditor } from "@/components/schedule-editor";
import { cn } from "@/lib/utils";

type Barber = { id: string; name: string };

export default function SchedulePage() {
  const { shop, accessToken } = useAuth();
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!shop) return;
    supabase.from("barbers").select("id, name").eq("shop_id", shop.id).eq("is_active", true).order("name")
      .then(({ data }) => {
        const list = (data ?? []) as Barber[];
        setBarbers(list);
        setSelected(prev => prev ?? list[0]?.id ?? null);
      });
  }, [shop]);

  const current = barbers.find(b => b.id === selected);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-28">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white uppercase tracking-wide">Schedule</h1>
        <p className="text-sm text-[#777] mt-0.5">Set working hours, breaks &amp; lunch — each barber gets emailed their schedule.</p>
      </div>

      {barbers.length === 0 ? (
        <p className="text-sm text-[#777] py-12 text-center">No barbers yet. Add staff first.</p>
      ) : (
        <>
          {/* Barber picker */}
          <div className="flex gap-2 overflow-x-auto pb-1 mb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {barbers.map(b => (
              <button key={b.id} onClick={() => setSelected(b.id)}
                className={cn("flex-shrink-0 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors",
                  selected === b.id ? "bg-white text-black border-white" : "border-[#1e1e1e] bg-[#0c0c0c] text-[#aaa] hover:text-white")}>
                {b.name}
              </button>
            ))}
          </div>

          {current && <ScheduleEditor key={current.id} barberId={current.id} barberName={current.name} accessToken={accessToken} />}
        </>
      )}
    </div>
  );
}
