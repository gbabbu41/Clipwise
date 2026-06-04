import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  /** Kept for back-compat; the SVG already contains the wordmark. */
  showText?: boolean;
}

// Height per size variant — width auto-scales (SVG aspect ratio ~3.1:1).
// Heights chosen so the wordmark sits as the visual weight the old text
// version did at the same `size`.
const SIZE_HEIGHT: Record<NonNullable<LogoProps["size"]>, string> = {
  sm: "h-7",   // 28px — mobile top bar, dense rows
  md: "h-10",  // 40px — desktop sidebar drawer header
  lg: "h-16",  // 64px — auth / marketing pages
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
