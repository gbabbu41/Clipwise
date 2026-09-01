"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, RefreshCw, ChevronDown, Store } from "lucide-react";

interface ErrorRow {
  id: string;
  created_at: string;
  level: string | null;
  source: string | null;
  message: string;
  stack: string | null;
  path: string | null;
  user_agent: string | null;
  shop_id: string | null;
  user_id: string | null;
  shop_name: string | null;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-surface-raised rounded-xl", className)} />;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const SOURCE_TONE: Record<string, string> = {
  "react-boundary": "text-orange-400",
  "react-global": "text-red-400",
  window: "text-red-400",
  unhandledrejection: "text-amber-400",
  server: "text-blue-400",
};

export default function AdminErrorsPage() {
  const { accessToken } = useAuth();
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    const res = await fetch("/api/admin/errors", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) {
      const { entries, unavailable: unv } = await res.json();
      setRows((entries ?? []) as ErrorRow[]);
      setUnavailable(!!unv);
    }
    setLoading(false);
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 lg:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Errors</h1>
          <p className="text-sm text-[#8f8f8f] mt-0.5">Recent app crashes &amp; errors (client + server). Newest first.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-[#8f8f8f] hover:text-white border border-border hover:border-gray-500 transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : unavailable ? (
        <Card><div className="py-16 text-center space-y-2">
          <AlertTriangle size={32} className="text-[#999] mx-auto" />
          <p className="text-white font-semibold">Error log not set up yet</p>
          <p className="text-sm text-[#8f8f8f] max-w-sm mx-auto">Run the <code className="text-gold">phase35_error_logs.sql</code> migration in Supabase to start recording errors.</p>
        </div></Card>
      ) : rows.length === 0 ? (
        <Card><div className="py-16 text-center space-y-2">
          <AlertTriangle size={32} className="text-emerald-400 mx-auto" />
          <p className="text-white font-semibold">No errors recorded 🎉</p>
          <p className="text-sm text-[#8f8f8f]">When something crashes, it&apos;ll show up here with its details.</p>
        </div></Card>
      ) : (
        <Card>
          <CardContent>
            <div className="divide-y divide-border/50">
              {rows.map((e) => {
                const tone = SOURCE_TONE[e.source ?? ""] ?? "text-[#999]";
                const isOpen = open === e.id;
                return (
                  <div key={e.id} className="py-3">
                    <button onClick={() => setOpen(isOpen ? null : e.id)} className="w-full flex items-start gap-3 text-left">
                      <div className="w-8 h-8 rounded-xl bg-surface-raised flex items-center justify-center flex-shrink-0 mt-0.5">
                        <AlertTriangle size={14} className={tone} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <p className="text-sm text-white break-words flex-1">{e.message}</p>
                          {e.shop_name
                            ? <span className="flex items-center gap-1 flex-shrink-0 px-2 py-0.5 rounded-full bg-gold/10 text-gold text-[10px] font-medium"><Store size={9} /> {e.shop_name}</span>
                            : e.user_id
                              ? <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-surface-raised text-[#8f8f8f] text-[10px] font-medium">Signed-in user</span>
                              : <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-surface-raised text-[#8f8f8f] text-[10px] font-medium">Platform / logged-out</span>}
                        </div>
                        <p className="text-xs text-[#8f8f8f] mt-0.5">
                          <span className={tone}>{e.source ?? "error"}</span>
                          {e.path && <span> · {e.path}</span>}
                          <span> · {timeAgo(e.created_at)} · {e.created_at.slice(0, 16).replace("T", " ")}</span>
                        </p>
                      </div>
                      {e.stack && <ChevronDown size={16} className={cn("text-[#8f8f8f] flex-shrink-0 mt-1 transition-transform", isOpen && "rotate-180")} />}
                    </button>
                    {isOpen && e.stack && (
                      <pre className="mt-2 ml-11 text-[11px] leading-snug text-[#b0b0b0] bg-black/40 border border-border rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap break-words">
                        {e.stack}
                        {e.user_agent ? `\n\n— ${e.user_agent}` : ""}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-[#8f8f8f] mt-3 px-1">Showing {rows.length} most recent</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
