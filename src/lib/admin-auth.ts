// Server-only — shared super-admin gate for /api/admin/* routes. Verifies the
// Supabase bearer token and confirms the user's role is super_admin. Returns the
// actor (id + email) for audit logging, or null when unauthorized.
import { NextRequest } from "next/server";
import { supabaseAdmin } from "./supabase-admin";

export interface AdminUser { id: string; email: string | null }

export async function requireSuperAdmin(req: NextRequest): Promise<AdminUser | null> {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabaseAdmin.from("users").select("role").eq("id", user.id).single();
  return profile?.role === "super_admin" ? { id: user.id, email: user.email ?? null } : null;
}
