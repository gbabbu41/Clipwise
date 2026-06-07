// Per-device preference for the in-portal notification chime. Stored in
// localStorage (no DB needed — it's a per-browser UX choice). Honored by
// NotificationListener; toggled from owner Settings + barber Profile.

const KEY = "cw_notif_sound";

/** Default ON. Returns false only when the user explicitly muted it. */
export function isNotifSoundOn(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(KEY) !== "off";
}

export function setNotifSound(on: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, on ? "on" : "off");
  // Let any mounted listener/toggle react immediately.
  window.dispatchEvent(new CustomEvent("cw-notif-sound", { detail: on }));
}
