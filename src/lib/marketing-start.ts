import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { NextRequest } from "next/server";

export const DRAFT_COOKIE = "cw_signup_draft";
export const DRAFT_SECONDS = 30 * 60;
export const draftHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const privateIpHash = (ip: string) => createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!).update("marketing-ip-v1:" + ip).digest("hex");
export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin || req.headers.get("sec-fetch-site") === "cross-site") return false;
  try { return new URL(origin).origin === new URL(req.url).origin; } catch { return false; }
}
export const draftCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: DRAFT_SECONDS };
