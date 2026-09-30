import type { ReactNode } from "react";
import type { AppointmentNotificationSummary } from "@/lib/notification-presentation";

export function NotificationContent({
  summary,
  title,
  message,
  icon,
  createdAt,
  ageLabel,
  isRead,
  children,
}: {
  summary?: AppointmentNotificationSummary | null;
  title: string;
  message: string;
  icon: ReactNode;
  createdAt: string;
  ageLabel: string;
  isRead: boolean;
  children?: ReactNode;
}) {
  if (!summary) {
    return (
      <div className="flex min-w-0 flex-1">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <p className="min-w-0 break-words text-sm font-semibold text-foreground">{title}</p>
            <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()} className="flex-shrink-0 text-[11px] text-grey">{ageLabel}</time>
          </div>
          <p className="mt-0.5 flex items-start gap-1.5 whitespace-pre-wrap break-words text-xs leading-snug text-grey">
            <span className="mt-0.5 flex-shrink-0" aria-hidden="true">{icon}</span><span className="min-w-0">{message}</span>
          </p>
          {children}
        </div>
        {!isRead && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-foreground" aria-label="Unread" />}
      </div>
    );
  }
  const eventText = summary.event.replace(/^Appointment\s+/i, "");
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 break-words text-sm font-semibold text-foreground">{summary.clientName}</p>
          <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()} className="flex-shrink-0 text-[11px] text-grey">{ageLabel}</time>
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-grey">
          <span className="flex-shrink-0" aria-hidden="true">{icon}</span>
          <span className="break-words">{eventText}{summary.amount ? ` · ${summary.amount}` : ""}{summary.barber ? ` · with ${summary.barber}` : ""}</span>
        </p>
        {summary.current && (
          <div className="mt-1 space-y-0.5 text-xs leading-snug">
            <p className="flex gap-2"><span className="w-7 flex-shrink-0 text-grey">{summary.previous ? "Now" : "When"}</span><span className="min-w-0 break-words tabular-nums text-foreground">{summary.current.date}{summary.current.time ? ` · ${summary.current.time}` : ""}</span></p>
            {summary.previous && <p className="flex gap-2"><span className="w-7 flex-shrink-0 text-grey">Was</span><span className="min-w-0 break-words tabular-nums text-grey">{summary.previous.date} · {summary.previous.time}</span></p>}
          </div>
        )}
        {(summary.service || summary.payment) && <p className="mt-1 break-words text-xs text-grey">{[summary.service, summary.payment].filter(Boolean).join(" · ")}</p>}
        {children}
      </div>
      {!isRead && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-foreground" aria-label="Unread" />}
    </div>
  );
}
