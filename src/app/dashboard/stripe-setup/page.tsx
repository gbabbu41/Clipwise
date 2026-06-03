"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#777] hover:text-white ml-2">✕</button>
    </div>
  );
}

const STEPS = [
  { id: 1, label: "Connect Stripe" },
  { id: 2, label: "Business Details" },
  { id: 3, label: "Identity Verified" },
  { id: 4, label: "Payouts Active" },
];

export default function StripeSetupPage() {
  const [stripeConnected, setStripeConnected] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [toast, setToast] = useState("");
  const [businessForm, setBusinessForm] = useState({
    name: "Fresh Cutz Barbershop",
    address: "123 Main Street",
    type: "individual",
    bank_last4: "4242",
  });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const connectStripe = () => {
    setConnectLoading(true);
    setTimeout(() => { setStripeConnected(true); setConnectLoading(false); showToast("Stripe account connected!"); }, 1500);
  };

  const currentStep = !stripeConnected ? 1 : !detailsSaved ? 2 : 4;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div>
        <h1 className="text-2xl font-bold text-white">Stripe Setup</h1>
        <p className="text-sm text-[#777] mt-0.5">Connect Stripe to accept payments and receive payouts</p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2">
        {STEPS.map((step, idx) => {
          const isCompleted = step.id < currentStep;
          const isActive = step.id === currentStep;
          return (
            <div key={step.id} className="flex items-center gap-2 flex-1">
              <div className={cn("flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all",
                isCompleted ? "bg-emerald-500 text-white" : isActive ? "bg-gold text-black" : "bg-[#141414] text-[#777] border border-[#1e1e1e]")}>
                {isCompleted ? "✓" : step.id}
              </div>
              <span className={cn("text-xs font-medium hidden sm:block", isCompleted ? "text-emerald-400" : isActive ? "text-white" : "text-[#777]")}>
                {step.label}
              </span>
              {idx < STEPS.length - 1 && (
                <div className={cn("flex-1 h-0.5 mx-2", isCompleted ? "bg-emerald-500" : "bg-border")} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step 1: Connect */}
      <Card className={cn(stripeConnected && "border-emerald-500/30 bg-emerald-500/5")}>
        <CardHeader>
          <div>
            <CardTitle>Step 1: Connect Stripe Account</CardTitle>
            <p className="text-sm text-[#777] mt-1">Link your Stripe account to start accepting payments instantly</p>
          </div>
          {stripeConnected && <Badge variant="success">Connected ✓</Badge>}
        </CardHeader>
        <CardContent>
          {stripeConnected ? (
            <div className="flex items-center gap-3 p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
              <span className="text-2xl">✅</span>
              <div>
                <p className="text-sm font-semibold text-emerald-400">Stripe account connected</p>
                <p className="text-xs text-[#777]">Account ID: acct_demo_1234567890</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-[#141414] rounded-xl border border-[#1e1e1e]">
                <p className="text-sm text-[#777]">Stripe processes your payments securely. You&apos;ll receive payouts directly to your bank account.</p>
              </div>
              <Button loading={connectLoading} onClick={connectStripe} className="gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
                </svg>
                Connect with Stripe
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Business Details */}
      <Card className={cn(!stripeConnected && "opacity-50 pointer-events-none", detailsSaved && "border-emerald-500/30 bg-emerald-500/5")}>
        <CardHeader>
          <div>
            <CardTitle>Step 2: Business Details</CardTitle>
            <p className="text-sm text-[#777] mt-1">Provide your business information for verification</p>
          </div>
          {detailsSaved && <Badge variant="success">Saved ✓</Badge>}
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Input label="Business Name" value={businessForm.name} onChange={e => setBusinessForm(p => ({ ...p, name: e.target.value }))} />
            <Input label="Business Address" value={businessForm.address} onChange={e => setBusinessForm(p => ({ ...p, address: e.target.value }))} />
            <Select label="Business Type" value={businessForm.type} onChange={e => setBusinessForm(p => ({ ...p, type: e.target.value }))}>
              <option value="individual">Individual / Sole Proprietor</option>
              <option value="company">Company</option>
              <option value="non_profit">Non-Profit</option>
            </Select>
            <Input label="Bank Account (last 4 digits)" value={businessForm.bank_last4} onChange={e => setBusinessForm(p => ({ ...p, bank_last4: e.target.value }))} maxLength={4} placeholder="4242" />
            <Button onClick={() => { setDetailsSaved(true); showToast("Business details saved!"); }}>Save Details</Button>
          </div>
        </CardContent>
      </Card>

      {/* Step 3: Identity Verification */}
      <Card className={cn(!stripeConnected && "opacity-50")}>
        <CardHeader>
          <div>
            <CardTitle>Step 3: Identity Verification</CardTitle>
            <p className="text-sm text-[#777] mt-1">Required by Stripe for compliance and fraud prevention</p>
          </div>
          <Badge variant="success">Verification Complete ✓</Badge>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-2xl">✅</div>
            <div>
              <p className="text-sm font-semibold text-emerald-400">Identity Verified</p>
              <p className="text-xs text-[#777]">Government ID submitted and confirmed · May 20, 2026</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="p-3 bg-[#141414] rounded-xl border border-[#1e1e1e]">
              <p className="text-xs text-[#777]">ID Type</p>
              <p className="text-sm text-white mt-0.5">Driver&apos;s License</p>
            </div>
            <div className="p-3 bg-[#141414] rounded-xl border border-[#1e1e1e]">
              <p className="text-xs text-[#777]">Verified On</p>
              <p className="text-sm text-white mt-0.5">May 20, 2026</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 4: Payout Stats */}
      <Card className={cn("border-[#1e1e1e]")} gold>
        <CardHeader>
          <div>
            <CardTitle>Step 4: Payouts Active</CardTitle>
            <p className="text-sm text-[#777] mt-1">Your earnings are automatically transferred to your bank</p>
          </div>
          <Badge variant="gold">Active</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Available Balance", value: "$1,240.50", color: "text-emerald-400" },
              { label: "Pending", value: "$485.00", color: "text-orange-400" },
              { label: "Last Payout", value: "$2,890.00", color: "text-white", sub: "May 20, 2026" },
              { label: "Next Payout", value: "May 28", color: "text-white" },
            ].map(item => (
              <div key={item.label} className="p-4 bg-[#141414] rounded-xl border border-[#1e1e1e]">
                <p className="text-xs text-[#777]">{item.label}</p>
                <p className={cn("text-xl font-bold mt-1", item.color)}>{item.value}</p>
                {item.sub && <p className="text-xs text-[#777] mt-0.5">{item.sub}</p>}
              </div>
            ))}
          </div>
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-between p-3 bg-[#141414] rounded-xl border border-[#1e1e1e]">
              <div>
                <p className="text-sm text-white">May 20 Payout</p>
                <p className="text-xs text-[#777]">Transferred to •••• 4242</p>
              </div>
              <span className="text-emerald-400 font-semibold">$2,890.00</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-[#141414] rounded-xl border border-[#1e1e1e]">
              <div>
                <p className="text-sm text-white">May 13 Payout</p>
                <p className="text-xs text-[#777]">Transferred to •••• 4242</p>
              </div>
              <span className="text-emerald-400 font-semibold">$2,340.00</span>
            </div>
          </div>
          <Button variant="outline" onClick={() => showToast("Redirecting to Stripe... (Demo mode)")}>
            View Stripe Dashboard ↗
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
