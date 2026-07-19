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
        // ClipWise v2: extra-bold, slight negative tracking, all-caps. cw-grad
        // paints the brand gradient (blue accent tail) app-wide; text-white is
        // the fallback where background-clip:text isn't supported. cw-logo-fade
        // plays a single 0.6s fade-in when the component mounts.
        "font-extrabold tracking-tight leading-none text-white uppercase cw-grad cw-logo-fade",
        size === "sm" && "text-[19px]",
        size === "md" && "text-3xl",
        size === "lg" && "text-4xl",
        className,
      )}
    >
      ClipWise
    </span>
  );
}
