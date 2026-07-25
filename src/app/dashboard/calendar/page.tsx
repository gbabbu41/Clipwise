"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarView } from "@/components/calendar-view";

// Reads optional deep-link params from the dashboard mini-calendar:
//   ?date=YYYY-MM-DD   → jump the calendar to that day
//   ?appt=<id>         → auto-open that appointment's detail once loaded
function CalendarInner() {
  const sp = useSearchParams();
  return (
    <CalendarView
      canBlock
      pageTitle="Calendar"
      initialDate={sp.get("date") ?? undefined}
      initialApptId={sp.get("appt") ?? undefined}
    />
  );
}

export default function CalendarPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <CalendarInner />
    </Suspense>
  );
}
