"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Search, X, History, Store, CreditCard, Settings, User } from "lucide-react";

interface AuditEntry {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-surface-raised rounded-xl", className)} />;
}

// Pretty label + icon per action type.
const ACTION_META: Record<string, { label: string; tone: string }> = {
  "shop.approved": { label: "Approved shop", tone: "text-emerald-400" },
  "shop.rejected": { label: "Rejected shop", tone: "text-red-400" },
  "shop.suspended": { label: "Suspended shop", tone: "text-orange-400" },
  "shop.pending": { label: "Set shop pending", tone: "text-[#999]" },
  "shop.plan_change": { label: "Changed shop plan", tone: "text-blue-400" },
  "shop.note": { label: "Edited shop note", tone: "text-[#999]" },
  "plan.update": { label: "Updated plan", tone: "text-blue-400" },
  "plan.delete": { label: "Deleted plan", tone: "text-red-400" },
  "settings.update": { label: "Updated settings", tone: "text-gold" },
};
function iconFor(type: string | null) {
  if (type === "shop") return Store;
  if (type === "plan") return CreditCard;
  if (type === "settings") return Settings;
  return User;
}
function metaSummary(e: AuditEntry): string {
  const m = e.meta || {};
  if (e.action === "shop.plan_change" && m.from && m.to) return `${m.from} → ${m.to}`;
  if (e.action.startsWith("shop.") && m.from && m.to && m.from !== m.to) return `${m.from} → ${m.to}`;
  if (m.reason) return `“${String(m.reason)}”`;
  if (e.action === "plan.update" && typeof m.price_cents === "number") return `$${(m.price_cents / 100).toFixed(0)}/mo`;
  return "";
}
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function AdminActivityPage() {
  const { accessToken } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "shop" | "plan" | "settings">("all");
  const [scopedTarget, setScopedTarget] = useState<string | null>(null);

  // Read ?target= without useSearchParams (keeps the page out of a Suspense
  // boundary requirement at build time).
  useEffect(() => {
    if (typeof window !== "undefined") setScopedTarget(new URLSearchParams(window.location.search).get("target"));
  }, []);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    const qs = scopedTarget ? `?target_type=shop&target_id=${encodeURIComponent(scopedTarget)}` : "";
    const res = await fetch(`/api/admin/audit${qs}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) {
      const { entries: rows, unavailable: unv } = await res.json();
      setEntries((rows ?? []) as AuditEntry[]);
      setUnavailable(!!unv);
    }
    setLoading(false);
  }, [accessToken, scopedTarget]);

  useEffect(() => { load(); }, [load]);

  const filtered = entries.filter(e => {
    const matchType = typeFilter === "all" || e.target_type === typeFilter;
    const hay = `${e.actor_email ?? ""} ${e.action} ${e.target_label ?? ""}`.toLowerCase();
    return matchType && (search === "" || hay.includes(search.toLowerCase()));
  });

  return (
    <div className="p-4 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Activity Log</h1>
        <p className="text-sm text-[#777] mt-0.5">
          {scopedTarget ? "Admin actions on this shop" : "Every admin action across the platform"}
        </p>
      </div>

      {scopedTarget && (
        <a href="/admin/activity" className="inline-flex items-center gap-1.5 text-xs text-gold hover:underline">
          <X size={12} /> Clear shop filter — show all activity
        </a>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by admin, action, or target…"
            className="w-full bg-surface-raised border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-gold/50" />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777] hover:text-white"><X size={14} /></button>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["all", "shop", "plan", "settings"] as const).map(f => (
            <button key={f} onClick={() => setTypeFilter(f)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all border",
                typeFilter === f ? "bg-gold text-black border-gold" : "border-border text-[#777] hover:text-white hover:border-gray-500")}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : unavailable ? (
        <Card><div className="py-16 text-center space-y-2">
          <History size={32} className="text-[#999] mx-auto" />
          <p className="text-white font-semibold">Activity log not set up yet</p>
          <p className="text-sm text-[#777] max-w-sm mx-auto">Run the <code className="text-gold">phase27_admin_platform.sql</code> migration to start recording admin actions.</p>
        </div></Card>
      ) : filtered.length === 0 ? (
        <Card><div className="py-16 text-center space-y-2">
          <History size={32} className="text-[#999] mx-auto" />
          <p className="text-white font-semibold">No activity {search || typeFilter !== "all" ? "matches" : "yet"}</p>
          <p className="text-sm text-[#777]">Admin actions (approvals, plan changes, settings) will appear here.</p>
        </div></Card>
      ) : (
        <Card>
          <CardContent>
            <div className="divide-y divide-border/50">
              {filtered.map(e => {
                const Icon = iconFor(e.target_type);
                const am = ACTION_META[e.action] ?? { label: e.action, tone: "text-[#999]" };
                const summary = metaSummary(e);
                return (
                  <div key={e.id} className="flex items-start gap-3 py-3">
                    <div className="w-8 h-8 rounded-xl bg-surface-raised flex items-center justify-center flex-shrink-0 mt-0.5"><Icon size={14} className="text-[#999]" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white">
                        <span className={cn("font-medium", am.tone)}>{am.label}</span>
                        {e.target_label && <span className="text-gray-300"> · {e.target_label}</span>}
                        {summary && <span className="text-[#777]"> · {summary}</span>}
                      </p>
                      <p className="text-xs text-[#777] mt-0.5">{e.actor_email ?? "admin"} · {timeAgo(e.created_at)} · {e.created_at.slice(0, 16).replace("T", " ")}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-[#777] mt-3 px-1">Showing {filtered.length} of {entries.length} recent actions</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
