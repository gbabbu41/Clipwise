"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarIcon, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { cn, formatFriendlyDate, formatDateForDb } from "@/lib/utils";

interface DatePickerProps {
  label?: string;
  value: string;                 // "YYYY-MM-DD"
  onChange: (val: string) => void;
  minDate?: Date | null;
  placeholder?: string;
  className?: string;
}

/**
 * A date input that shows a friendly label ("Today, June 3, 2026") and opens
 * a Calendar in a popover. Falls back to a full-screen bottom sheet on phones.
 */
export function DatePicker({ label, value, onChange, minDate, placeholder = "Pick a date", className }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const displayLabel = value ? formatFriendlyDate(value) : placeholder;
  const parsedValue = value ? new Date(value + "T00:00:00") : null;

  return (
    <div className={cn("space-y-1.5", className)} ref={wrapRef}>
      {label && <label className="text-sm font-medium text-gray-300">{label}</label>}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          "w-full flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-sm text-left transition-all",
          "hover:border-gold/40 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50",
          value ? "text-white" : "text-[#777]",
        )}
      >
        <CalendarIcon size={15} className="text-[#555] flex-shrink-0" />
        <span className="flex-1 truncate">{displayLabel}</span>
      </button>

      {open && (
        <>
          {/* Mobile: full-screen bottom sheet — bumped z-index so it sits above
              any parent modal the picker is rendered inside (e.g. time-off form). */}
          <div className="sm:hidden">
            <div className="fixed inset-0 bg-black/60 z-[60]" onClick={() => setOpen(false)} />
            <div className="fixed left-0 right-0 bottom-0 z-[61] bg-surface border-t border-border rounded-t-2xl p-4 animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">Pick a date</span>
                <button type="button" onClick={() => setOpen(false)} className="text-[#555] hover:text-white">
                  <X size={18} />
                </button>
              </div>
              <Calendar
                value={parsedValue}
                minDate={minDate}
                onChange={(d) => { onChange(formatDateForDb(d)); setOpen(false); }}
                className="mx-auto"
              />
            </div>
          </div>

          {/* Desktop: anchored popover */}
          <div ref={popRef} className="hidden sm:block absolute z-50 mt-1">
            <Calendar
              value={parsedValue}
              minDate={minDate}
              onChange={(d) => { onChange(formatDateForDb(d)); setOpen(false); }}
            />
          </div>
        </>
      )}
    </div>
  );
}
