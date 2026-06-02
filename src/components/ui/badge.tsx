import * as React from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "gold" | "success" | "warning" | "danger" | "info" | "outline";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants = {
    default: "bg-surface-raised text-white border border-border",
    gold: "bg-gold/20 text-gold border border-gold/30",
    success: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    warning: "bg-orange-500/20 text-orange-400 border border-orange-500/30",
    danger: "bg-red-500/20 text-red-400 border border-red-500/30",
    info: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
    outline: "border border-border text-[#555]",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
