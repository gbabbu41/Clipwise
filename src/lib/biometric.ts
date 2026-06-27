"use client";

/**
 * Thin wrapper over the device's Face ID / fingerprint, for the shop-side
 * check-in station. On the web (and anywhere without a sensor) everything
 * reports unavailable, so the check-in page falls back to its plain manual
 * Clock-in / Clock-out buttons. In the Capacitor native app it gates each
 * clock action behind the device biometric.
 *
 * Scope note: device biometrics confirm the authorized person at the shop
 * device (Face ID / fingerprint / device passcode) — they don't recognise an
 * arbitrary barber's face from a camera (that would need a cloud vision
 * service, out of scope). So this is "Face-ID-to-confirm a check-in", which is
 * the real native capability.
 */

import { Capacitor } from "@capacitor/core";
import { BiometricAuth } from "@aparajita/capacitor-biometric-auth";

/** True only in the native app with an enrolled Face ID / fingerprint sensor. */
export async function isBiometricAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const r = await BiometricAuth.checkBiometry();
    return !!r.isAvailable;
  } catch {
    return false;
  }
}

/** Prompt the device biometric; resolves true on success, false on cancel/fail.
 *  `reason` is shown in the OS prompt. Allows device passcode as a fallback. */
export async function verifyBiometric(reason: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: "Cancel",
      allowDeviceCredential: true,
      iosFallbackTitle: "Use passcode",
      androidTitle: "Check-in",
      androidSubtitle: reason,
    });
    return true;
  } catch {
    return false;
  }
}
