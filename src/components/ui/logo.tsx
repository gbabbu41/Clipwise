import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  /** Kept for back-compat; the logo is text-only. */
  showText?: boolean;
}

export function Logo({ className, size = "md" }: LogoProps) {
  // The new brand mark (same image the marketing nav uses) — replaces the old
  // gradient "ClipWise" wordmark everywhere <Logo> is shown (onboarding, auth,
  // booking, admin…). Height scales with size; cw-logo-fade keeps the mount fade.
  return (
    <img
      src="/new/logo-watermark.png"
      alt="ClipWise"
      className={cn(
        "w-auto cw-logo-fade",
        size === "sm" && "h-5",
        size === "md" && "h-7",
        size === "lg" && "h-9",
        className,
      )}
    />
  );
}
