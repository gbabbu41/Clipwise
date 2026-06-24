import { Fragment } from "react";
import { cn, paymentTag } from "@/lib/utils";

/**
 * Small two-toned payment-state pill for the dashboards' Today's Schedule.
 * "Paid" stays green; the method word is coloured by type (Cash → amber,
 * Card → green). Single-state tags (Awaiting payment / Unpaid / …) render as
 * one coloured word. See paymentTag() for the colour rules.
 */
export function PaymentTag({
  appt,
  className,
}: {
  appt: Parameters<typeof paymentTag>[0];
  className?: string;
}) {
  const tag = paymentTag(appt);
  // Nothing to show (a plain upcoming appointment) → render no pill at all.
  if (tag.segments.length === 0) return null;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-0.5 rounded-md font-semibold whitespace-nowrap",
      tag.bg, className,
    )}>
      {tag.segments.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-[#555] font-normal">·</span>}
          <span className={s.className}>{s.text}</span>
        </Fragment>
      ))}
    </span>
  );
}
