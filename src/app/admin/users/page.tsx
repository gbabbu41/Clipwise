"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Search, X, Users } from "lucide-react";
import type { UserRole } from "@/lib/database.types";

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  created_at: string;
  shops?: { name: string }[];
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-surface-raised rounded-xl", className)} />;
}

function RoleBadge({ role }: { role: UserRole }) {
  const map: Record<UserRole, string> = {
    super_admin: "text-gold bg-gold/15 border-gold/30",
    shop_owner: "text-blue-400 bg-blue-500/15 border-blue-500/30",
    barber: "text-purple-400 bg-purple-500/15 border-purple-500/30",
    customer: "text-[#777] bg-gray-500/15 border-gray-500/30",
  };
  const labels: Record<UserRole, string> = {
    super_admin: "Super Admin",
    shop_owner: "Shop Owner",
    barber: "Barber",
    customer: "Customer",
  };
  return (
    <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", map[role] ?? map.customer)}>
      {labels[role] ?? role}
    </span>
  );
}

type RoleFilter = "all" | UserRole;

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("users")
      .select("*, shops(name)")
      .order("created_at", { ascending: false });
    setUsers((data ?? []) as UserRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const filtered = users.filter(u => {
    const matchSearch = search === "" ||
      (u.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (u.email ?? "").toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const ROLES: RoleFilter[] = ["all", "shop_owner", "barber", "customer", "super_admin"];
  const roleLabels: Record<RoleFilter, string> = {
    all: "All",
    super_admin: "Admin",
    shop_owner: "Owners",
    barber: "Barbers",
    customer: "Customers",
  };

  return (
    <div className="p-4 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <p className="text-sm text-[#777] mt-0.5">All registered users on the platform</p>
      </div>

      {/* Stats row */}
      {!loading && (
        <div className="flex flex-wrap gap-3">
          {(["all", "shop_owner", "barber", "customer"] as RoleFilter[]).map(r => {
            const count = r === "all" ? users.length : users.filter(u => u.role === r).length;
            return (
              <div key={r} className="bg-surface border border-border rounded-xl px-4 py-3 text-center min-w-[80px]">
                <p className="text-xl font-bold text-white">{count}</p>
                <p className="text-xs text-[#777] capitalize">{roleLabels[r]}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full bg-surface-raised border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-gold/50"
          />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777] hover:text-white"><X size={14} /></button>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {ROLES.map(r => (
            <button key={r} onClick={() => setRoleFilter(r)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all border",
                roleFilter === r ? "bg-gold text-black border-gold" : "border-border text-[#777] hover:text-white hover:border-gray-500")}>
              {roleLabels[r]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="py-20 text-center space-y-3">
            <div className="w-16 h-16 bg-surface-raised rounded-2xl flex items-center justify-center mx-auto">
              <Users size={28} className="text-[#777]" />
            </div>
            <p className="font-semibold text-white">No users found</p>
            <p className="text-sm text-[#777]">
              {search || roleFilter !== "all" ? "Try a different search or filter." : "No users have signed up yet."}
            </p>
            {(search || roleFilter !== "all") && (
              <button onClick={() => { setSearch(""); setRoleFilter("all"); }} className="text-gold text-sm hover:underline">Clear filters</button>
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {["Name", "Email", "Role", "Shop", "Phone", "Joined"].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-[#777] px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(u => (
                    <tr key={u.id} className="border-b border-border/50 hover:bg-surface-raised/30 transition-colors">
                      <td className="px-3 py-3 text-sm font-medium text-white">{u.name || "—"}</td>
                      <td className="px-3 py-3 text-sm text-gray-300">{u.email}</td>
                      <td className="px-3 py-3"><RoleBadge role={u.role} /></td>
                      <td className="px-3 py-3 text-sm text-[#777]">
                        {Array.isArray(u.shops) && u.shops.length > 0 ? u.shops[0].name : "—"}
                      </td>
                      <td className="px-3 py-3 text-sm text-[#777]">{u.phone || "—"}</td>
                      <td className="px-3 py-3 text-xs text-[#777] whitespace-nowrap">{u.created_at?.slice(0, 10) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[#777] mt-3 px-3">Showing {filtered.length} of {users.length} users</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
