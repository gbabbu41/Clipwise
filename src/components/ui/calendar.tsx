"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CalendarProps {
  value?: Date | null;
  onChange: (date: Date) => void;
  /** Disable any date strictly before `minDate` (defaults to today). */
  minDate?: Date | null;
  /** Optional max date — past this everything is disabled. */
  maxDate?: Date | null;
  /** Custom predicate, returns true if the date should be disabled. */
  isDateDisabled?: (date: Date) => boolean;
  className?: string;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

export function Calendar({ value, onChange, minDate, maxDate, isDateDisabled, className }: CalendarProps) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const lowerBound = (() => {
    if (minDate === null) return null;
    const m = minDate ?? today;
    const c = new Date(m); c.setHours(0, 0, 0, 0); return c;
  })();
  const upperBound = maxDate ? (() => { const c = new Date(maxDate); c.setHours(0, 0, 0, 0); return c; })() : null;

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(value ?? today));

  // Build 6-week grid starting on Sunday of the week containing the 1st
  const firstOfMonth = startOfMonth(viewMonth);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); d.setHours(0, 0, 0, 0);
    days.push(d);
  }

  const monthLabel = viewMonth.toLocaleDateString("en-CA", { month: "long", year: "numeric" });

  const isDisabled = (d: Date) => {
    if (lowerBound && d < lowerBound) return true;
    if (upperBound && d > upperBound) return true;
    if (isDateDisabled && isDateDisabled(d)) return true;
    return false;
  };

  return (
    <div className={cn("bg-surface border border-border rounded-2xl p-3 w-full max-w-xs", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-1 mb-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setViewMonth(m => addMonths(m, -1))}
          className="w-9 h-9 rounded-full hover:bg-surface-raised text-gray-300 hover:text-white flex items-center justify-center transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-semibold text-white">{monthLabel}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setViewMonth(m => addMonths(m, 1))}
          className="w-9 h-9 rounded-full hover:bg-surface-raised text-gray-300 hover:text-white flex items-center justify-center transition-colors"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="text-[10px] uppercase tracking-wider text-gray-500 text-center py-1">{w}</span>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === viewMonth.getMonth();
          const isToday = isSameDay(d, today);
          const isSelected = value ? isSameDay(d, value) : false;
          const disabled = isDisabled(d);
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onChange(d)}
              className={cn(
                // 44px min height on mobile = tap-friendly
                "h-11 sm:h-9 rounded-lg text-sm transition-all flex items-center justify-center",
                disabled && "text-gray-700 cursor-not-allowed",
                !disabled && !inMonth && "text-gray-600",
                !disabled && inMonth && !isSelected && "text-white hover:bg-surface-raised",
                isSelected && "bg-gold text-black font-bold",
                isToday && !isSelected && !disabled && "ring-1 ring-gold/40 text-gold font-semibold",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
