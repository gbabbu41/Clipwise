"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Clock, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

export default function PendingPage() {
  const { shop, refreshShop, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (shop?.status === "approved") router.push("/dashboard");
  }, [shop, router]);

  const statusConfig = {
    pending: {
      icon: Clock,
      color: "text-orange-400",
      bg: "bg-orange-500/10 border-orange-500/20",
      title: "Awaiting Approval",
      desc: "Your shop is being reviewed by the ClipWise team. This usually takes less than 24 hours.",
    },
    rejected: {
      icon: XCircle,
      color: "text-red-400",
      bg: "bg-red-500/10 border-red-500/20",
      title: "Application Not Approved",
      desc: shop?.rejection_reason || "Your application was not approved. Please contact support.",
    },
    suspended: {
      icon: XCircle,
      color: "text-orange-400",
      bg: "bg-orange-500/10 border-orange-500/20",
      title: "Shop Suspended",
      desc: "Your shop has been suspended. Please contact support@clipwise.ca for assistance.",
    },
  };

  const config = statusConfig[(shop?.status as keyof typeof statusConfig) ?? "pending"];
  const Icon = config?.icon ?? Clock;

  return (
    <div className="min-h-screen bg-card flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <Logo size="md" className="justify-center mb-8" />

        <div className={cn("rounded-2xl border p-8 mb-6", config?.bg)}>
          <div className={cn("w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4", config?.bg)}>
            <Icon size={32} className={config?.color} />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">{config?.title}</h1>
          <p className="text-grey text-sm leading-relaxed">{config?.desc}</p>
        </div>

        {shop?.status === "pending" && (
          <div className="bg-card shadow-sm border border-border rounded-2xl p-6 text-left mb-6 space-y-3">
            <p className="text-sm font-semibold text-foreground">What happens next?</p>
            {[
              { step: "1", text: "Our team reviews your shop details", done: true },
              { step: "2", text: "You receive an email confirmation", done: false },
              { step: "3", text: "Your booking page goes live", done: false },
              { step: "4", text: "Start accepting clients!", done: false },
            ].map(({ step, text, done }) => (
              <div key={step} className="flex items-center gap-3">
                <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
                  done ? "bg-gold text-black" : "bg-card-raised text-grey")}>
                  {done ? <CheckCircle size={14} /> : step}
                </div>
                <span className={cn("text-sm", done ? "text-foreground" : "text-grey")}>{text}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => refreshShop()}>
            <RefreshCw size={16} /> Check Status
          </Button>
          <Button variant="ghost" onClick={signOut} className="flex-1">
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
