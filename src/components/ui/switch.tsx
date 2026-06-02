"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface SwitchProps {
  /** Current on/off state */
  checked: boolean;
  /** Called with the new state on toggle */
  onChange: (next: boolean) => void;
  /** Optional label rendered to the right of the switch */
  label?: React.ReactNode;
  disabled?: boolean;
  /** Optional explicit id; auto-generated otherwise */
  id?: string;
  /** Extra classes on the outer wrapper */
  className?: string;
}

/**
 * Bootstrap `form-switch` — slide-style toggle.
 *
 * Renders the canonical Bootstrap 5 markup:
 *
 *   <div class="form-check form-switch">
 *     <input class="form-check-input" type="checkbox" role="switch" id="…">
 *     <label class="form-check-label" for="…">…</label>
 *   </div>
 *
 * Single source of truth for every toggle in the app — drop-in replacement
 * for the various inline button/styled-pill toggles that were scattered
 * across settings, staff, services, notifications, loyalty, etc.
 */
export function Switch({ checked, onChange, label, disabled, id, className }: SwitchProps) {
  const reactId = React.useId();
  const inputId = id ?? `switch-${reactId}`;
  return (
    <div className={cn("form-check form-switch", className)}>
      <input
        type="checkbox"
        role="switch"
        id={inputId}
        className="form-check-input"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
      {label != null && (
        <label htmlFor={inputId} className="form-check-label">
          {label}
        </label>
      )}
    </div>
  );
}
