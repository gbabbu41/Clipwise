"use client";
import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Shield, Check } from "lucide-react";

function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-emerald-900/80 border border-emerald-500/40 rounded-xl px-5 py-3 text-sm text-emerald-300 flex items-center gap-3 shadow-xl">
      <Check size={15} /> {msg}
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

const PLANS = [
  { name: "Starter", price: "$19/mo", features: ["1 Barber", "50 Appts/mo", "Basic Analytics"], color: "border-border" },
  { name: "Pro", price: "$49/mo", features: ["3 Barbers", "Unlimited Appts", "Full Analytics", "POS", "Loyalty"], color: "border-gold/30" },
  { name: "Premium", price: "$99/mo", features: ["10 Barbers", "Multi-location", "Priority Support", "White-label"], color: "border-purple-500/30" },
  { name: "Business", price: "$199/mo", features: ["Unlimited Barbers", "Custom domain", "Dedicated support", "API access"], color: "border-blue-500/30" },
];

export default function AdminSettingsPage() {
  const [toast, setToast] = useState("");
  const [settings, setSettings] = useState({
    platform_name: "ClipWise",
    support_email: "support@clipwise.com",
    admin_email: "gbabbu41@gmail.com",
    booking_base_url: "http://localhost:3001/book",
  });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  return (
    <div className="p-4 lg:p-8 space-y-6">
      {toast && <Toast msg={toast} onClose={() => setToast("")} />}

      <div>
        <h1 className="text-2xl font-bold text-white">Platform Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Global configuration for ClipWise</p>
      </div>

      {/* Admin account */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gold/15 rounded-xl flex items-center justify-center">
              <Shield size={18} className="text-gold" />
            </div>
            <div>
              <CardTitle>Admin Account</CardTitle>
              <p className="text-xs text-gray-500 mt-0.5">Super administrator credentials</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-gray-400 font-medium uppercase tracking-wide">Admin Email</label>
            <div className="flex items-center gap-3 mt-1.5">
              <p className="text-sm text-white font-medium">{settings.admin_email}</p>
              <Badge variant="gold">Super Admin</Badge>
            </div>
            <p className="text-xs text-gray-600 mt-1">Admin access is granted to users with the <code className="text-gold">super_admin</code> role in the users table.</p>
          </div>
        </CardContent>
      </Card>

      {/* Platform info */}
      <Card>
        <CardHeader><CardTitle>Platform Info</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Platform Name"
            value={settings.platform_name}
            onChange={e => setSettings(p => ({ ...p, platform_name: e.target.value }))}
          />
          <Input
            label="Support Email"
            type="email"
            value={settings.support_email}
            onChange={e => setSettings(p => ({ ...p, support_email: e.target.value }))}
          />
          <Input
            label="Booking Base URL"
            value={settings.booking_base_url}
            onChange={e => setSettings(p => ({ ...p, booking_base_url: e.target.value }))}
          />
          <Button onClick={() => showToast("Settings saved!")}>Save Settings</Button>
        </CardContent>
      </Card>

      {/* Subscription plans */}
      <div>
        <h2 className="text-lg font-bold text-white mb-4">Subscription Plans</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map(plan => (
            <div key={plan.name} className={`bg-surface border ${plan.color} rounded-2xl p-5 space-y-3`}>
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white">{plan.name}</h3>
                {plan.name === "Pro" && <Badge variant="gold">Popular</Badge>}
              </div>
              <p className="text-2xl font-bold text-gold">{plan.price}</p>
              <ul className="space-y-1.5">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs text-gray-400">
                    <Check size={12} className="text-emerald-400 flex-shrink-0" />{f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-600 mt-3">Plan pricing is managed in Stripe. Contact dev to update.</p>
      </div>

      {/* Platform health */}
      <Card>
        <CardHeader><CardTitle>Platform Health</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { label: "Supabase Database", status: "Operational" },
              { label: "Authentication", status: "Operational" },
              { label: "Booking System", status: "Operational" },
              { label: "Admin Portal", status: "Operational" },
            ].map(({ label, status }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <span className="text-sm text-gray-300">{label}</span>
                <span className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {status}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
