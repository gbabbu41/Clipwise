// Pure, client-safe config for the card-reader purchase incentive. No server
// imports, so both the server engine (hardware-credit.ts) and the web page can
// share these numbers with zero drift.

// Business rule (owner): credit = min(50% of the reader price, $50).
// READER_PRICE_CENTS is the WisePad 3 list price — CONFIRM against Stripe CA at
// go-live; the credit is derived from it since we can't read the barber's order.
export const READER_PRICE_CENTS = 7900;        // WisePad 3 ≈ CA$79 (confirm)
export const HARDWARE_CREDIT_PCT = 0.5;        // cover up to 50%
export const HARDWARE_CREDIT_MAX_CENTS = 5000; // …capped at $50

/** The credit we grant, in cents: min(50% of the reader, $50). */
export function hardwareCreditCents(readerPriceCents: number = READER_PRICE_CENTS): number {
  return Math.min(Math.round(readerPriceCents * HARDWARE_CREDIT_PCT), HARDWARE_CREDIT_MAX_CENTS);
}
