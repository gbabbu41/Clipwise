"use client";
import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

// The floating pill nav drops its section links on phones; this hamburger brings
// them back in a dropdown so mobile visitors can still reach Pricing / Find a
// Barber / Log in. Shown only ≤900px (CSS `.burger` display), so it's inert on
// desktop.
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button
        type="button"
        className="burger"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>
      {open && (
        <div className="mobmenu">
          <Link href="/#app" onClick={close}>Product</Link>
          <Link href="/#book" onClick={close}>Booking</Link>
          <Link href="/#pay" onClick={close}>Payments</Link>
          <Link href="/#price" onClick={close}>Pricing</Link>
          <Link href="/shops" onClick={close}>Find a Barber</Link>
          <Link href="/login" onClick={close}>Log in</Link>
        </div>
      )}
    </>
  );
}
