import { Fragment } from "react";
import { cn, paymentTag } from "@/lib/utils";

/**
 * Small payment-state pill. The default style is used across financial surfaces;
 * the schedule variant is neutral to keep payment status distinct from appointment status.
 * "Paid" stays green; the method word is coloured by type (Cash → amber,
 * Card → green). Single-state tags (Awaiting payment / Unpaid / …) render as
 * one coloured word. See paymentTag() for the colour rules.
 */
export function PaymentTag({
  appt,
  className,
  variant = "default",
}: {
  appt: Parameters<typeof paymentTag>[0];
  className?: string;
  variant?: "default" | "schedule";
}) {
  const tag = paymentTag(appt);
  // Nothing to show (a plain upcoming appointment) → render no pill at all.
  if (tag.segments.length === 0) return null;
  // The schedule row states cancelled/no-show status beside the client name;
  // avoid repeating that same status in the separate payment slot.
  if (variant === "schedule" && tag.segments.length === 1 &&
    (tag.segments[0].text === "Cancelled" || tag.segments[0].text === "No-show")) return null;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-semibold",
      variant === "schedule"
        ? "max-w-[120px] flex-wrap justify-end whitespace-normal leading-tight border border-border bg-surface-overlay text-grey"
        : "whitespace-nowrap leading-none",
      variant === "default" && tag.bg, className,
    )}>
      {variant === "schedule"
        ? <span className="text-grey">{tag.segments.map((s) => s.text).join(" · ")}</span>
        : tag.segments.map((s, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="text-grey-muted font-normal">·</span>}
            <span className={s.className}>{s.text}</span>
          </Fragment>
        ))}
    </span>
  );
}
