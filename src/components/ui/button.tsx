"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "gold" | "outline" | "ghost" | "danger" | "secondary";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
}

export function Button({
  className,
  variant = "gold",
  size = "md",
  loading,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const variants = {
    gold: "bg-gold hover:bg-gold-light text-black font-semibold shadow-lg shadow-gold/20 active:scale-95",
    outline: "border border-border hover:border-gold hover:text-gold text-white bg-transparent active:scale-95",
    ghost: "text-white hover:bg-surface-raised bg-transparent active:scale-95",
    danger: "bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 active:scale-95",
    secondary: "bg-surface-raised hover:bg-surface-overlay text-white border border-border active:scale-95",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs rounded-lg",
    md: "px-4 py-2 text-sm rounded-xl",
    lg: "px-6 py-3 text-base rounded-xl",
    icon: "p-2 rounded-xl",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
