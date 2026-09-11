"use client";

/**
 * Client-side fetch wrappers for the Terminal backend routes. All the heavy
 * lifting (connected-account context, capability check, Interac handling,
 * capture + ledger write) is server-side; these just call the routes with the
 * shop's bearer token. Web-safe — no native code here.
 */

type Auth = { shopId: string; accessToken: string };

async function post<T>(path: string, auth: Auth, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
    body: JSON.stringify({ shop_id: auth.shopId, ...(body ?? {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? "Terminal request failed");
  return data as T;
}

/** Readiness gate — call BEFORE showing the reader UI. */
export function getTerminalStatus(shopId: string, accessToken: string) {
  return post<{ ready: boolean; reason?: string; location_id?: string | null }>(
    "/api/stripe/terminal/status", { shopId, accessToken });
}

/** Connection token (+ the shop's Terminal Location id) to init the SDK. */
export function getConnectionToken(shopId: string, accessToken: string) {
  return post<{ secret: string; location_id: string | null }>(
    "/api/stripe/terminal/connection-token", { shopId, accessToken })
    .then((d) => ({ secret: d.secret, locationId: d.location_id }));
}

export type TerminalSale = {
  barber_id?: string | null;
  client_name?: string;
  service_name?: string;
  subtotal?: number; tip?: number; discount?: number; tax?: number; total?: number;
  commission_base?: number | null;
  type?: string;
};

/** Create the card-present PaymentIntent for a sale; returns its client secret. */
export function createTerminalIntent(shopId: string, accessToken: string, sale: TerminalSale) {
  return post<{ payment_intent_id: string; client_secret: string }>(
    "/api/stripe/terminal/create-intent", { shopId, accessToken }, sale);
}

/** Finalize + record the sale after the reader collects the card. */
export function captureTerminalIntent(shopId: string, accessToken: string, paymentIntentId: string) {
  return post<{ ok?: boolean; error?: string }>(
    "/api/stripe/terminal/capture", { shopId, accessToken }, { payment_intent_id: paymentIntentId });
}
