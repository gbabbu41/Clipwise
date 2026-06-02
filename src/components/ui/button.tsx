"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  // Legacy variant names — preserved so every existing `<Button variant="…">`
  // callsite keeps working. Each one now maps to a Bootstrap `.btn-*` class
  // defined globally in `globals.css`. New code can also pass any of the
  // Bootstrap-style names directly: primary, secondary, success, danger,
  // warning, info, light, dark, plus their `outline-*` cousins.
  variant?:
    | "gold" | "outline" | "ghost"
    | "primary" | "secondary" | "success" | "danger" | "warning" | "info" | "light" | "dark"
    | "outline-primary" | "outline-secondary" | "outline-success" | "outline-danger"
    | "outline-warning" | "outline-info" | "outline-light" | "outline-dark";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
}

// Legacy → Bootstrap variant mapping. "gold" was the default primary CTA
// (and is referenced in dozens of files), so it now maps to `btn-primary`.
// "ghost" stays as a text-only button — Bootstrap has no direct equivalent.
const variantClass = (v: NonNullable<ButtonProps["variant"]>): string => {
  switch (v) {
    case "gold":     return "btn btn-primary";
    case "outline":  return "btn btn-outline-secondary";
    case "ghost":    return "btn-ghost";          // text-only, see CSS below
    default:         return `btn btn-${v}`;        // primary, danger, outline-*, etc.
  }
};

const sizeClass = (s: NonNullable<ButtonProps["size"]>): string => {
  switch (s) {
    case "sm":   return "btn-sm";
    case "lg":   return "btn-lg";
    case "icon": return "btn-icon";
    default:     return "";
  }
};

export function Button({
  className,
  variant = "gold",
  size = "md",
  loading,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(variantClass(variant), sizeClass(size), className)}
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
