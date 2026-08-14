"use client";
import { NotificationListener } from "@/components/notification-listener";
import { useBarber } from "@/lib/barber-context";

/**
 * Barber-portal wrapper for NotificationListener. A barber can work at multiple
 * shops, so the realtime pop-ups must follow the shop they've switched to in the
 * sidebar (BarberContext) — not the default one from auth-context. Owners render
 * <NotificationListener/> directly; only the barber portal needs this bridge.
 * Must be mounted inside <BarberProvider>.
 */
export function BarberNotificationListener() {
  const { shop } = useBarber();
  return <NotificationListener shopId={shop?.id ?? null} />;
}
