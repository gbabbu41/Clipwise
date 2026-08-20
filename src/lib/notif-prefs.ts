// Per-device preferences for which notification types trigger an in-app pop-up
// + chime. Stored in localStorage (a per-browser UX choice — no DB needed),
// mirroring notif-sound.ts. Honored by NotificationListener; edited from the
// Notifications page. IMPORTANT: the feed still RECORDS every notification —
// these only silence the disruptive live alert for a type, so nothing is lost.

export type NotifPrefKey =
  | "new_booking" | "cancellation" | "no_show" | "low_inventory" | "new_review";

const KEY = "cw_notif_prefs";

export const NOTIF_PREF_DEFAULTS: Record<NotifPrefKey, boolean> = {
  new_booking: true, cancellation: true, no_show: true, low_inventory: true, new_review: true,
};

/** Read the stored prefs merged over the defaults (all-on). SSR-safe. */
export function getNotifPrefs(): Record<NotifPrefKey, boolean> {
  if (typeof window === "undefined") return { ...NOTIF_PREF_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...NOTIF_PREF_DEFAULTS };
    const stored = JSON.parse(raw) as Partial<Record<NotifPrefKey, boolean>>;
    return { ...NOTIF_PREF_DEFAULTS, ...stored };
  } catch {
    return { ...NOTIF_PREF_DEFAULTS };
  }
}

export function setNotifPref(key: NotifPrefKey, value: boolean): void {
  if (typeof window === "undefined") return;
  const next = { ...getNotifPrefs(), [key]: value };
  window.localStorage.setItem(KEY, JSON.stringify(next));
  // Let any mounted listener react immediately (same pattern as the sound flag).
  window.dispatchEvent(new CustomEvent("cw-notif-prefs", { detail: next }));
}

// Map a stored notification.type → its pref key. Returns null for types with no
// toggle ("system" and anything unknown) so those are NEVER silently suppressed.
export function prefKeyForType(type: string): NotifPrefKey | null {
  switch (type) {
    case "booking": return "new_booking";
    case "cancellation": return "cancellation";
    case "no-show": return "no_show";
    case "inventory": return "low_inventory";
    case "review": return "new_review";
    default: return null;
  }
}

/** Whether a live pop-up/chime should fire for this notification type. */
export function shouldAlertForType(type: string): boolean {
  const k = prefKeyForType(type);
  return k ? getNotifPrefs()[k] : true;
}
