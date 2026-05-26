import * as React from "react";
import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export function Input({ className, label, error, icon, id, ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-gray-300">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
            {icon}
          </div>
        )}
        <input
          id={inputId}
          className={cn(
            "w-full rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-sm text-white placeholder:text-gray-500",
            "focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50",
            "transition-all duration-200",
            icon && "pl-10",
            error && "border-red-500/50 focus:ring-red-500/30",
            className
          )}
          {...props}
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function Select({
  className,
  label,
  children,
  id,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-gray-300">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={cn(
          "w-full rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-sm text-white",
          "focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50",
          "transition-all duration-200 appearance-none cursor-pointer",
          className
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

export function Textarea({
  className,
  label,
  id,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  const textareaId = id || label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={textareaId} className="text-sm font-medium text-gray-300">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        className={cn(
          "w-full rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-sm text-white placeholder:text-gray-500",
          "focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50",
          "transition-all duration-200 resize-none",
          className
        )}
        {...props}
      />
    </div>
  );
}
