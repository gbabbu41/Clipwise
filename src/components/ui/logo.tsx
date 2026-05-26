import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export function Logo({ className, size = "md", showText = true }: LogoProps) {
  const sizes = { sm: 20, md: 28, lg: 40 };
  const s = sizes[size];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg width={s} height={s} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="20" cy="20" r="20" fill="#C9A84C" fillOpacity="0.15" />
        <path
          d="M14 8 C14 8, 12 10, 13 13 L22 22 C23 23, 23 25, 22 26 L20 28 C19 29, 19 31, 20 32 C21 33, 23 33, 24 32 L26 30 C27 29, 27 27, 26 26 L17 17 C16 16, 16 14, 17 13 C18 12, 18 10, 17 9 Z"
          fill="#C9A84C"
        />
        <path
          d="M26 8 C26 8, 28 10, 27 13 L18 22 C17 23, 17 25, 18 26 L20 28 C21 29, 21 31, 20 32 C19 33, 17 33, 16 32 L14 30 C13 29, 13 27, 14 26 L23 17 C24 16, 24 14, 23 13 C22 12, 22 10, 23 9 Z"
          fill="#C9A84C"
          fillOpacity="0.5"
        />
        <circle cx="14.5" cy="9.5" r="2.5" fill="#C9A84C" />
        <circle cx="25.5" cy="9.5" r="2.5" fill="#C9A84C" fillOpacity="0.6" />
      </svg>
      {showText && (
        <span
          className={cn(
            "font-bold tracking-tight gold-text",
            size === "sm" && "text-lg",
            size === "md" && "text-2xl",
            size === "lg" && "text-4xl"
          )}
        >
          ClipWise
        </span>
      )}
    </div>
  );
}
