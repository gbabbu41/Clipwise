import { CalendarDays } from "lucide-react";
import type { AppointmentNotificationSummary } from "@/lib/notification-presentation";
import { timeAgo } from "@/lib/utils";

export function AppointmentNotificationContent({
  summary,
  createdAt,
  isRead,
}: {
  summary: AppointmentNotificationSummary;
  createdAt: string;
  isRead: boolean;
}) {
  const hasDetails = summary.service || summary.barber;
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 break-words text-sm font-semibold text-foreground">{summary.clientName}</p>
          <time dateTime={createdAt} className="flex-shrink-0 text-[11px] text-grey">{timeAgo(createdAt)}</time>
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-grey">
          <CalendarDays size={14} className="flex-shrink-0" aria-hidden="true" />
          <span className="break-words">{summary.event}</span>
        </p>
        {summary.current && (
          <div className="mt-1 space-y-0.5 text-xs leading-snug">
            <p className="flex gap-2"><span className="w-7 flex-shrink-0 text-grey">{summary.previous ? "Now" : "When"}</span><span className="min-w-0 break-words tabular-nums text-foreground">{summary.current.date} · {summary.current.time}</span></p>
            {summary.previous && <p className="flex gap-2"><span className="w-7 flex-shrink-0 text-grey">Was</span><span className="min-w-0 break-words tabular-nums text-grey">{summary.previous.date} · {summary.previous.time}</span></p>}
          </div>
        )}
        {hasDetails && <p className="mt-1 break-words text-xs text-grey">{summary.service}{summary.service && summary.barber ? " · " : ""}{summary.barber ? `with ${summary.barber}` : ""}</p>}
      </div>
      {!isRead && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-foreground" aria-label="Unread" />}
    </div>
  );
}
