"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, formatDateForDb } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, Calendar, Star, TrendingUp, Clock, Award, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { AppointmentWithDetails } from "@/lib/database.types";

interface StaffHour { id: string; date: string; clock_in: string; clock_out: string | null; hours_worked: number | null }
interface ReviewRow { rating: number; comment: string | null; client_name: string; created_at: string }

type Period = "week" | "month" | "all";

export default function MyStatsPage() {
  const { shop, profile } = useAuth();
  const [barberId, setBarberId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("month");
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [hours, setHours] = useState<StaffHour[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [commissionRate, setCommissionRate] = useState(50);

  // Resolve barber ID
  useEffect(() => {
    if (!profile || !shop) return;
    supabase
      .from("barbers")
      .select("id, commission_percent")
      .eq("user_id", profile.id)
      .eq("shop_id", shop.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setBarberId(data.id);
          setCommissionRate(data.commission_percent ?? 50);
        }
      });
  }, [profile, shop]);

  const getRange = (p: Period): [string, string] => {
    const today = new Date();
    if (p === "week") {
      const from = new Date(today); from.setDate(today.getDate() - 7);
      return [formatDateForDb(from), formatDateForDb(today)];
    }
    if (p === "month") {
      const from = new Date(today); from.setDate(1);
      return [formatDateForDb(from), formatDateForDb(today)];
    }
    return ["2020-01-01", formatDateForDb(today)];
  };

  const loadData = useCallback(async () => {
    if (!barberId) return;
    setLoading(true);
    const [from, to] = getRange(period);

    const [apptRes, hoursRes, revRes] = await Promise.all([
      supabase
        .from("appointments")
        .select("*, services(id, name, price, category), barbers(id, name)")
        .eq("barber_id", barberId)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: false })
        .order("time_slot", { ascending: true }),
      supabase
        .from("staff_hours")
        .select("*")
        .eq("barber_id", barberId)
        .gte("date", from)
        .lte("date", to),
      supabase
        .from("reviews")
        .select("rating, comment, client_name, created_at")
        .eq("barber_id", barberId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    setAppointments((apptRes.data ?? []) as AppointmentWithDetails[]);
    setHours(hoursRes.data ?? []);
    setReviews(revRes.data ?? []);
    setLoading(false);
  }, [barberId, period]);

  useEffect(() => { loadData(); }, [loadData]);

  const completed = appointments.filter(a => a.status === "completed");
  // Exclude refunded completed appts from revenue/commission (money handed back);
  // the completion count keeps them (the service was still rendered). Pre-tax
  // (total_amount includes GST/HST) so revenue + commission match the rest of the
  // app — a barber doesn't earn commission on tax.
  const revenue = completed.filter(a => a.payment_status !== "refunded").reduce((s, a) => s + Math.max(0, (a.total_amount ?? 0) - (a.tax_amount ?? 0)), 0);
  const commission = revenue * (commissionRate / 100);
  const noShows = appointments.filter(a => a.status === "no-show").length;
  const totalHours = hours.reduce((s, h) => s + (h.hours_worked ?? 0), 0);
  const avgRating = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : "—";
  const completionRate = appointments.length > 0 ? Math.round((completed.length / appointments.length) * 100) : 0;

  const today = formatDateForDb(new Date());
  const todayAppts = appointments.filter(a => a.date === today);
  const upcoming = appointments.filter(a => ["pending", "confirmed"].includes(a.status) && a.date >= today);

  // Top services
  const serviceCounts: Record<string, { name: string; count: number; revenue: number }> = {};
  completed.forEach(a => {
    const svcName = (a as unknown as { services?: { name?: string } }).services?.name ?? "Unknown";
    if (!serviceCounts[svcName]) serviceCounts[svcName] = { name: svcName, count: 0, revenue: 0 };
    serviceCounts[svcName].count++;
    if (a.payment_status !== "refunded") serviceCounts[svcName].revenue += a.total_amount ?? 0;
  });
  const topServices = Object.values(serviceCounts).sort((a, b) => b.count - a.count).slice(0, 5);

  const periodLabel: Record<Period, string> = { week: "This Week", month: "This Month", all: "All Time" };

  if (!profile || !shop) {
    return (
      <div className="p-8 text-center text-grey">
        <p>No shop linked to your account.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground uppercase tracking-wide">My Stats</h1>
          <p className="text-sm text-grey mt-0.5">{profile.name} · {shop.name}</p>
        </div>
        <div className="flex gap-1 p-1 bg-card-raised border border-border rounded-xl">
          {(["week", "month", "all"] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                period === p ? "bg-gold text-black" : "text-grey hover:text-foreground"
              )}
            >
              {p === "week" ? "Week" : p === "month" ? "Month" : "All"}
            </button>
          ))}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: "Service Revenue", value: formatCurrency(revenue), sub: `${periodLabel[period]}`, icon: DollarSign, color: "gold" },
          { label: "My Commission", value: formatCurrency(commission), sub: `${commissionRate}% rate`, icon: Award, color: "green" },
          { label: "Appointments", value: String(appointments.length), sub: `${completed.length} completed`, icon: Calendar, color: "blue" },
          { label: "Completion Rate", value: `${completionRate}%`, sub: `${noShows} no-shows`, icon: TrendingUp, color: "purple" },
          { label: "Hours Worked", value: `${totalHours.toFixed(1)}h`, sub: "Clock-in records", icon: Clock, color: "orange" },
          { label: "Avg Rating", value: avgRating, sub: `${reviews.length} review${reviews.length !== 1 ? "s" : ""}`, icon: Star, color: "gold" },
        ].map(stat => {
          const Icon = stat.icon;
          const colorMap: Record<string, string> = { gold: "bg-black/10 text-foreground", green: "bg-emerald-500/15 text-emerald-400", blue: "bg-blue-500/15 text-blue-400", purple: "bg-purple-500/15 text-purple-400", orange: "bg-orange-500/15 text-orange-400" };
          return (
            <Card key={stat.label} className="relative overflow-hidden">
              <CardContent>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-grey uppercase tracking-wider font-medium">{stat.label}</p>
                    <p className="text-2xl font-bold text-foreground mt-1">{loading ? "—" : stat.value}</p>
                    <p className="text-xs text-grey mt-0.5">{stat.sub}</p>
                  </div>
                  <div className={cn("p-2.5 rounded-xl", colorMap[stat.color])}>
                    <Icon size={18} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Today's schedule */}
        <Card>
          <CardHeader>
            <Calendar size={18} className="text-foreground" />
            <CardTitle>Today's Schedule</CardTitle>
            <Link href="/dashboard/appointments" className="text-xs text-foreground hover:underline ml-auto">View all</Link>
          </CardHeader>
          <CardContent>
            {todayAppts.length === 0 ? (
              <div className="py-8 text-center text-grey">
                <Calendar size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No appointments today</p>
              </div>
            ) : (
              <div className="space-y-2">
                {todayAppts.map(a => (
                  <div key={a.id} className="flex items-center gap-3 p-3 bg-card-raised rounded-xl border border-border">
                    <div className="text-center w-12 flex-shrink-0">
                      <p className="text-xs text-foreground font-semibold">{a.time_slot.split(" ")[0]}</p>
                      <p className="text-xs text-grey">{a.time_slot.split(" ")[1]}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{a.client_name}</p>
                      <p className="text-xs text-grey">{(a as unknown as { services?: { name?: string } }).services?.name ?? "Service"}</p>
                    </div>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full", a.status === "confirmed" ? "bg-emerald-500/20 text-emerald-400" : "bg-orange-500/20 text-orange-400")}>
                      {a.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top services */}
        <Card>
          <CardHeader>
            <TrendingUp size={18} className="text-foreground" />
            <CardTitle>Top Services</CardTitle>
          </CardHeader>
          <CardContent>
            {topServices.length === 0 ? (
              <div className="py-8 text-center text-grey">
                <p className="text-sm">No completed services yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {topServices.map(svc => (
                  <div key={svc.name} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between mb-1">
                        <p className="text-sm text-foreground truncate">{svc.name}</p>
                        <p className="text-xs text-foreground ml-2 flex-shrink-0">{svc.count}×</p>
                      </div>
                      <div className="h-1.5 bg-card-raised rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gold/60 rounded-full"
                          style={{ width: `${(svc.count / (topServices[0]?.count ?? 1)) * 100}%` }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-grey flex-shrink-0">{formatCurrency(svc.revenue)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent reviews */}
        {reviews.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <Star size={18} className="text-foreground" />
              <CardTitle>My Reviews</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map((rev, i) => (
                  <div key={i} className="p-4 bg-card-raised rounded-xl border border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-foreground">{"★".repeat(rev.rating)}{"☆".repeat(5 - rev.rating)}</span>
                      <span className="text-xs text-grey">{rev.client_name}</span>
                    </div>
                    {rev.comment && (
                      <p className="text-xs text-grey leading-relaxed line-clamp-2">{rev.comment}</p>
                    )}
                    <p className="text-xs text-grey mt-2">{new Date(rev.created_at).toLocaleDateString("en-CA")}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <ChevronRight size={18} className="text-foreground" />
              <CardTitle>Upcoming Appointments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {upcoming.slice(0, 8).map(a => (
                  <div key={a.id} className="flex items-center justify-between p-3 bg-card-raised rounded-xl border border-border">
                    <div className="flex items-center gap-3">
                      <div className="text-center w-16">
                        <p className="text-xs font-semibold text-foreground">{a.date.slice(5)}</p>
                        <p className="text-xs text-grey">{a.time_slot}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{a.client_name}</p>
                        <p className="text-xs text-grey">{(a as unknown as { services?: { name?: string } }).services?.name}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-foreground">{formatCurrency(a.total_amount ?? 0)}</p>
                      <p className="text-xs text-grey capitalize">{a.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
