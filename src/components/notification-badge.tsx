import { cn } from "@/lib/utils";

/**
 * The ONE unread-count badge for every notification bell (owner + barber, header
 * + sidebar). Keeps the count pill visually identical everywhere — same red, same
 * white text/border, same size — so the bell never "changes" between pages. Render
 * it inside a `relative` bell button; it pins to the top-right corner. Nothing
 * shows at 0.
 */
export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 bg-red-500 text-white text-[9px] font-bold",
        "rounded-full flex items-center justify-center border border-white leading-none",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
