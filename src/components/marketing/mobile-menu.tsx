"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

// The floating pill nav drops its section links on phones; this hamburger brings
// them back in a dropdown so mobile visitors can still reach Pricing / Find a
// Barber / Log in. Shown only ≤900px (CSS `.burger` display), so it's inert on
// desktop.
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        className="burger"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="public-mobile-menu"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>
      {open && (
        <div className="mobmenu" id="public-mobile-menu">
          <Link href="/features" onClick={close}>Product</Link>
          <Link href="/online-booking" onClick={close}>Booking</Link>
          <Link href="/payments" onClick={close}>Payments</Link>
          <Link href="/pricing" onClick={close}>Pricing</Link>
          <Link href="/shops" onClick={close}>Find a Barber</Link>
          <Link href="/login" onClick={close}>Log in</Link>
        </div>
      )}
    </>
  );
}
