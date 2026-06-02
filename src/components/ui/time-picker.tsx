"use client";
import { ChangeEvent } from "react";
import { Clock } from "lucide-react";
import { cn, formatFriendlyTime } from "@/lib/utils";

interface TimePickerProps {
  label?: string;
  /** Stored as "HH:MM" (24h) so it matches Postgres TIME columns. */
  value: string;
  onChange: (val: string) => void;
  /** Minutes between options. Defaults to 30. */
  stepMinutes?: number;
  /** Only show times after this 24h "HH:MM" (exclusive). */
  minTime?: string;
  className?: string;
}

function generateTimeOptions(stepMinutes: number) {
  const opts: { value: string; label: string }[] = [];
  for (let total = 0; total < 24 * 60; total += stepMinutes) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    opts.push({ value, label: formatFriendlyTime(value) });
  }
  return opts;
}

export function TimePicker({ label, value, onChange, stepMinutes = 30, minTime, className }: TimePickerProps) {
  const options = generateTimeOptions(stepMinutes).filter(o => (minTime ? o.value > minTime : true));
  const onSelect = (e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value);
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <label className="text-sm font-medium text-gray-300">{label}</label>}
      <div className="relative">
        <Clock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555] pointer-events-none" />
        <select
          value={value}
          onChange={onSelect}
          className={cn(
            "w-full rounded-xl border border-border bg-surface-raised pl-10 pr-4 py-2.5 text-sm text-white",
            "focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50",
            "transition-all duration-200 appearance-none cursor-pointer",
            // 44px on mobile via py — tap-friendly
          )}
        >
          <option value="" disabled>Pick a time</option>
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
