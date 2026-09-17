import { supabaseAdmin } from "@/lib/supabase-admin";

export const validId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const validTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(v);
export const validRange = (start: unknown, end: unknown) => validTime(start) && validTime(end) && start.slice(0, 5) < end.slice(0, 5);
export const validDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export function validTimeOff(body: { type?: unknown; start_date?: unknown; end_date?: unknown; start_time?: unknown; end_time?: unknown; reason?: unknown }) {
  return ["day_off", "vacation", "sick", "blocked_hours"].includes(String(body.type ?? "day_off")) &&
    validDate(body.start_date) && validDate(body.end_date) && body.start_date <= body.end_date &&
    (body.type !== "blocked_hours" || validRange(body.start_time, body.end_time)) &&
    (body.reason == null || (typeof body.reason === "string" && body.reason.length <= 2000));
}

export async function authorizeSchedule(token: string | undefined, barberId: string, permission?: "edit_schedule" | "request_time_off" | "block_hours") {
  if (!token) return { error: "Unauthorized", status: 401 };
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return { error: "Unauthorized", status: 401 };
  const { data: barber, error: barberError } = await supabaseAdmin.from("barbers")
    .select("id, shop_id, user_id, name, email, permissions, is_active").eq("id", barberId).maybeSingle();
  if (barberError) return { error: "Unable to verify schedule access", status: 503 };
  if (!barber) return { error: "Barber not found", status: 404 };
  const { data: shop, error: shopError } = await supabaseAdmin.from("shops")
    .select("id, owner_id, name, email").eq("id", barber.shop_id).maybeSingle();
  if (shopError) return { error: "Unable to verify schedule access", status: 503 };
  if (!shop) return { error: "Shop not found", status: 404 };
  const isOwner = shop.owner_id === user.id;
  if (!isOwner && (barber.user_id !== user.id || barber.is_active !== true)) return { error: "Forbidden", status: 403 };
  if (!isOwner && permission && barber.permissions?.[permission] === false) return { error: "Your shop owner has disabled this permission", status: 403 };
  return { barber, shop, isOwner, user };
}

export type ScheduleDay = { day_of_week: number; is_open: boolean; start_time: string; end_time: string };
export type ScheduleBreak = { day_of_week: number; start_time: string; end_time: string; label?: string | null };
export function validSchedule(days: ScheduleDay[], breaks: ScheduleBreak[]) {
  if (!Array.isArray(days) || days.length > 7 || !Array.isArray(breaks) || breaks.length > 70) return false;
  const seen = new Set<number>();
  for (const day of days) {
    if (!day || !Number.isInteger(day.day_of_week) || day.day_of_week < 0 || day.day_of_week > 6 || seen.has(day.day_of_week) || typeof day.is_open !== "boolean" || !validRange(day.start_time, day.end_time)) return false;
    seen.add(day.day_of_week);
  }
  for (const brk of breaks) {
    if (!brk || !validRange(brk.start_time, brk.end_time) || (brk.label != null && (typeof brk.label !== "string" || brk.label.length > 100))) return false;
    const day = days.find(d => d.day_of_week === brk.day_of_week && d.is_open);
    if (!day || brk.start_time.slice(0, 5) < day.start_time.slice(0, 5) || brk.end_time.slice(0, 5) > day.end_time.slice(0, 5)) return false;
  }
  return true;
}
