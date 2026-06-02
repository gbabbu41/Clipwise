import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  /** Kept for back-compat; the logo is text-only. */
  showText?: boolean;
}

export function Logo({ className, size = "md" }: LogoProps) {
  return (
    <span
      className={cn(
        // ClipWise v2: extra-bold, slight negative tracking, white by default.
        // Body type is Sora, no special heading face — same family as
        // surrounding UI for visual consistency.
        "font-extrabold tracking-tight leading-none text-white",
        size === "sm" && "text-[19px]",
        size === "md" && "text-2xl",
        size === "lg" && "text-4xl",
        className,
      )}
    >
      ClipWise
    </span>
  );
}
