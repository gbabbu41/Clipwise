"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// "Hours" merged into "Schedule" (same working-hours editor). Redirect for any
// old links / bookmarks.
export default function BarberHoursRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/barber-dashboard/schedule"); }, [router]);
  return <div className="min-h-[40vh] flex items-center justify-center text-grey text-sm">Redirecting…</div>;
}
