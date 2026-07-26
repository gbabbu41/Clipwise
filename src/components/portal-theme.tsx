"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

// Portal (owner + barber) light/dark theme. Dark is the default. The choice is
// applied by stamping `data-theme` on <html> — the calm token overrides in
// globals.css are scoped to `html[data-theme="light"] .portal`, so ONLY the
// portals change; customer-facing pages never do. Persisted to localStorage.

type Theme = "dark" | "light";
const KEY = "cw_portal_theme";

const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "dark", toggle: () => {} });
export const usePortalTheme = () => useContext(Ctx);

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  // Default (dark) leaves the attribute empty so :root/.portal dark tokens win.
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
}

export function PortalThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  // Read the saved choice on mount and apply it.
  useEffect(() => {
    let saved: Theme = "dark";
    try {
      const s = localStorage.getItem(KEY);
      if (s === "light" || s === "dark") saved = s;
    } catch { /* ignore */ }
    setTheme(saved);
    apply(saved);
    // Leaving the portal (back to a customer page) must not leave the app stamped
    // light — clear the attribute on unmount.
    return () => { if (typeof document !== "undefined") document.documentElement.removeAttribute("data-theme"); };
  }, []);

  const toggle = useCallback(() => {
    setTheme(prev => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
      apply(next);
      return next;
    });
  }, []);

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

// Sun/moon toggle button. Shows the theme you'll switch TO.
export function PortalThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = usePortalTheme();
  const goingLight = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={goingLight ? "Switch to light theme" : "Switch to dark theme"}
      title={goingLight ? "Switch to light theme" : "Switch to dark theme"}
      className={cn(
        "inline-flex items-center justify-center rounded-xl border border-border bg-card text-grey hover:text-foreground hover:border-border-strong transition-colors",
        className,
      )}
    >
      {goingLight ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
