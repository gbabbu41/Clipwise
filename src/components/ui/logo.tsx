import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  /** Kept for back-compat with callers; the logo is text-only now so this
   *  prop is ignored. */
  showText?: boolean;
}

export function Logo({ className, size = "md" }: LogoProps) {
  return (
    <span
      className={cn(
        // Squire/Apple-style wordmark: same UI font as the rest of the app,
        // extra-bold, uppercase, slightly negative tracking, pure black for
        // light-mode surfaces (the dashboard chrome).
        "font-extrabold uppercase text-black tracking-tight leading-none",
        size === "sm" && "text-lg",
        size === "md" && "text-2xl",
        size === "lg" && "text-4xl",
        className,
      )}
    >
      CLIPWISE
    </span>
  );
}
