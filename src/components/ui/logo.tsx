import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  /** Kept for back-compat; the SVG already contains the wordmark. */
  showText?: boolean;
}

// Height per size variant — width auto-scales (SVG aspect ratio ~3.1:1).
// Note: the SVG includes a tagline below the wordmark, so the actual
// readable wordmark is ~27% of the total height. Heights below are
// chosen so the wordmark portion ends up at a comfortable read size.
const SIZE_HEIGHT: Record<NonNullable<LogoProps["size"]>, string> = {
  sm: "h-9",   // 36px total -> ~10px wordmark, mobile top bar
  md: "h-16",  // 64px total -> ~17px wordmark, desktop sidebar (fits w-64)
  lg: "h-24",  // 96px total -> ~26px wordmark, auth / marketing
};

export function Logo({ className, size = "md" }: LogoProps) {
  return (
    // The SVG already contains the "CLIPWISE" wordmark with the barber-pole
    // 'i' and the tagline. `<img>` is used (not next/image) so the SVG ships
    // inline without optimization — keeps animations and gradients intact.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/clipwise-logo.svg"
      alt="ClipWise"
      className={cn(
        "w-auto select-none cw-logo-fade",
        SIZE_HEIGHT[size],
        className,
      )}
      draggable={false}
    />
  );
}
