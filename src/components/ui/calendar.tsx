"use client";
import { useState, useEffect, useRef } from "react";
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
  /** Optional decoration (e.g. an appointment-count pill) rendered under
   *  the day number inside each cell. Receives the cell's Date; return
   *  null/undefined to skip the badge. */
  renderDayBadge?: (date: Date) => React.ReactNode;
  /** Notified with the first-of-month Date whenever the visible month
   *  changes — lets parents fetch month-scoped data (e.g. appointment
   *  counts) without lifting all the month state. */
  onMonthChange?: (firstOfMonth: Date) => void;
  className?: string;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

export function Calendar({ value, onChange, minDate, maxDate, isDateDisabled, renderDayBadge, onMonthChange, className }: CalendarProps) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const lowerBound = (() => {
    if (minDate === null) return null;
    const m = minDate ?? today;
    const c = new Date(m); c.setHours(0, 0, 0, 0); return c;
  })();
  const upperBound = maxDate ? (() => { const c = new Date(maxDate); c.setHours(0, 0, 0, 0); return c; })() : null;

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(value ?? today));
  // Hold onto the latest onMonthChange so this effect fires only when the
  // visible month actually changes — not every time the parent re-renders.
  const onMonthChangeRef = useRef(onMonthChange);
  useEffect(() => { onMonthChangeRef.current = onMonthChange; });
  useEffect(() => { onMonthChangeRef.current?.(viewMonth); }, [viewMonth]);

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
    <div className={cn("bg-card border border-border rounded-2xl p-4 w-full max-w-xs", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-1 mb-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setViewMonth(m => addMonths(m, -1))}
          className="w-9 h-9 rounded-full hover:bg-card-raised text-grey hover:text-foreground flex items-center justify-center transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-semibold text-foreground">{monthLabel}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setViewMonth(m => addMonths(m, 1))}
          className="w-9 h-9 rounded-full hover:bg-card-raised text-grey hover:text-foreground flex items-center justify-center transition-colors"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="text-[10px] uppercase tracking-wider text-grey text-center py-1.5 font-semibold">{w}</span>
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
                "rounded-lg text-sm transition-all flex flex-col items-center justify-center gap-0.5",
                renderDayBadge ? "min-h-[44px] py-1" : "h-11 sm:h-9",
                disabled && "text-grey-muted cursor-not-allowed",
                !disabled && !inMonth && "text-grey",
                !disabled && inMonth && !isSelected && "text-foreground hover:bg-card-raised",
                isSelected && "bg-foreground text-background font-bold border border-foreground",
                // Today indicator: a ring in the current text color so it reads on
                // both dark and light; becomes the filled pill when also selected.
                isToday && !isSelected && !disabled && "ring-1 ring-current text-foreground font-bold",
              )}
            >
              <span className="leading-none">{d.getDate()}</span>
              {renderDayBadge && !disabled && inMonth && renderDayBadge(d)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
