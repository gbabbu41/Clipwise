"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, Bluetooth, Loader2, CheckCircle2, AlertTriangle, ArrowDownToLine } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency } from "@/lib/utils";
import { getTerminalStatus, createTerminalIntent, captureTerminalIntent } from "@/lib/terminal-client";
import {
  isNativeReaderAvailable, initTerminal, discoverReaders, connectReader,
  onFirmwareUpdateProgress, collectPayment, rememberReader, lastReaderSerial,
  type DiscoveredReader,
} from "@/lib/terminal-native";

/**
 * Card-reader screen (BBPOS WisePad 3). This is WEB code that only becomes live
 * inside the ClipWise native app — a browser can't do Bluetooth, so on the web it
 * shows an "open the app" message. In the app it drives the reader through the
 * native Terminal plugin (src/lib/terminal-native.ts) and our backend routes.
 *
 * ⚠️ DRAFT / on-device: the flow, states, and backend wiring are complete, but the
 * native plugin calls (in terminal-native.ts) must be confirmed against the
 * installed plugin when you build on the Mac — and the Canadian offline-PIN path
 * must be tested with the simulated + physical Interac test cards. Build it with
 * the SDK's simulated reader first (no hardware needed).
 */

type Stage =
  | "checking" | "web" | "not_ready"
  | "disconnected" | "discovering" | "firmware" | "connected"
  | "collecting" | "done" | "error";

const READER_STORE = "https://stripe.com/terminal/wisepad3"; // where a shop can buy their own

export default function ReaderPage() {
  const { shop, accessToken } = useAuth();
  const [stage, setStage] = useState<Stage>("checking");
  const [reason, setReason] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [readers, setReaders] = useState<DiscoveredReader[]>([]);
  const [firmwarePct, setFirmwarePct] = useState(0);
  const [connectedSerial, setConnectedSerial] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const fwUnsub = useRef<() => void>(() => {});

  const shopId = shop?.id ?? "";

  // This screen only renders inside the native app (Apple IAP), so these messages
  // never name a ClipWise plan or point at the (hidden) Billing page. They only
  // describe the barber's own Stripe payout setup, which is real-world commerce.
  const notReadyMsg = (r: string) =>
    r === "plan" ? "In-person card payments aren't part of your current plan."
    : r === "connect_incomplete" ? "Finish your Stripe payout setup (the banner on your dashboard) before using a reader."
    : r === "card_payments_pending" ? "Stripe hasn't finished enabling card payments on your account yet — complete Stripe onboarding, then try again."
    : "Card payments aren't available yet.";

  // ── Boot: web fallback → readiness gate → init SDK → reconnect last reader ──
  const boot = useCallback(async () => {
    setError("");
    if (!isNativeReaderAvailable()) { setStage("web"); return; }
    if (!shopId || !accessToken) return;
    setStage("checking");
    try {
      const status = await getTerminalStatus(shopId, accessToken);
      if (!status.ready) { setReason(status.reason ?? ""); setStage("not_ready"); return; }
      setLocationId(status.location_id ?? null);
      await initTerminal(shopId, accessToken);
      // Firmware progress can fire during a connect at any time.
      fwUnsub.current = onFirmwareUpdateProgress((pct) => { setFirmwarePct(pct); setStage("firmware"); });
      // Try to silently reconnect the reader used last shift.
      const last = lastReaderSerial();
      if (last) {
        try { await connectReader(last, status.location_id ?? null); setConnectedSerial(last); setStage("connected"); return; }
        catch { /* fall through to manual pair */ }
      }
      setStage("disconnected");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the reader."); setStage("error");
    }
  }, [shopId, accessToken]);

  useEffect(() => { boot(); return () => { try { fwUnsub.current(); } catch { /* ignore */ } }; }, [boot]);

  const scan = async () => {
    setError(""); setStage("discovering");
    try {
      const found = await discoverReaders();
      setReaders(found);
      if (found.length === 0) setError("No readers found. Make sure the WisePad 3 is on, charged, and nearby.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed."); setStage("disconnected");
    }
  };

  const pair = async (serial: string) => {
    setError("");
    try {
      await connectReader(serial, locationId);   // may trigger a firmware update (progress → "firmware")
      rememberReader(serial);
      setConnectedSerial(serial);
      setStage("connected");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect to that reader."); setStage("disconnected");
    }
  };

  const charge = async () => {
    const total = Math.round(Number(amount) * 100) / 100;
    if (!(total > 0)) { setError("Enter an amount."); return; }
    setError(""); setStage("collecting");
    try {
      const { payment_intent_id, client_secret } = await createTerminalIntent(shopId, accessToken!, {
        total, subtotal: total, service_name: "In-store sale",
      });
      await collectPayment(client_secret);                     // tap / insert + Canadian PIN on the reader
      await captureTerminalIntent(shopId, accessToken!, payment_intent_id); // finalize + record the sale
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The payment didn't go through."); setStage("error");
    }
  };

  // ── UI ──────────────────────────────────────────────────────────────────────
  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="max-w-md mx-auto mt-6 rounded-2xl border border-border bg-surface p-6 text-center">{children}</div>
  );

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-foreground uppercase tracking-wide">Card reader</h1>
      <p className="text-grey text-sm mt-0.5">Take an in-person tap or Interac payment on a WisePad 3.</p>

      {stage === "checking" && <Card><Loader2 className="animate-spin mx-auto text-grey" /><p className="text-grey text-sm mt-3">Checking your reader…</p></Card>}

      {stage === "web" && (
        <Card>
          <Bluetooth size={28} className="mx-auto text-grey" />
          <h2 className="text-lg font-bold text-foreground mt-3">Open the ClipWise app</h2>
          <p className="text-grey text-sm mt-1.5">A card reader connects over Bluetooth, which only works in the ClipWise phone app — not the website.</p>
          <a href={READER_STORE} target="_blank" rel="noopener noreferrer" className="inline-block mt-4 text-sm text-emerald-400 hover:underline">Don&apos;t have a reader yet? Get a WisePad 3 →</a>
        </Card>
      )}

      {stage === "not_ready" && (
        <Card>
          <AlertTriangle size={28} className="mx-auto text-amber-400" />
          <h2 className="text-lg font-bold text-foreground mt-3">Not ready yet</h2>
          <p className="text-grey text-sm mt-1.5">{notReadyMsg(reason)}</p>
        </Card>
      )}

      {stage === "disconnected" && (
        <Card>
          <Bluetooth size={28} className="mx-auto text-emerald-400" />
          <h2 className="text-lg font-bold text-foreground mt-3">Pair your reader</h2>
          <p className="text-grey text-sm mt-1.5">Turn the WisePad 3 on and keep it nearby.</p>
          <button onClick={scan} className="mt-4 w-full rounded-xl bg-foreground text-background font-semibold py-2.5">Scan for readers</button>
          {readers.length > 0 && (
            <div className="mt-4 space-y-2 text-left">
              {readers.map((r) => (
                <button key={r.serialNumber} onClick={() => pair(r.serialNumber)} className="w-full flex items-center justify-between rounded-xl border border-border bg-card-raised px-4 py-3 hover:bg-surface-overlay">
                  <span className="text-sm text-foreground">{r.label || "WisePad 3"} · {r.serialNumber.slice(-6)}</span>
                  {typeof r.batteryLevel === "number" && <span className="text-xs text-grey">{Math.round(r.batteryLevel * 100)}%</span>}
                </button>
              ))}
            </div>
          )}
          <a href={READER_STORE} target="_blank" rel="noopener noreferrer" className="inline-block mt-4 text-xs text-grey hover:text-foreground">Need a reader? Get a WisePad 3 →</a>
        </Card>
      )}

      {stage === "discovering" && <Card><Loader2 className="animate-spin mx-auto text-grey" /><p className="text-grey text-sm mt-3">Scanning over Bluetooth…</p></Card>}

      {stage === "firmware" && (
        <Card>
          <ArrowDownToLine size={28} className="mx-auto text-emerald-400" />
          <h2 className="text-lg font-bold text-foreground mt-3">Updating the reader</h2>
          <p className="text-grey text-sm mt-1.5">This can take a few minutes — keep the reader on and nearby. Don&apos;t close the app.</p>
          <div className="mt-4 h-2 rounded-full bg-card-raised overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${firmwarePct}%` }} /></div>
          <p className="text-xs text-grey mt-2">{firmwarePct}%</p>
        </Card>
      )}

      {(stage === "connected" || stage === "collecting") && (
        <Card>
          <CreditCard size={28} className="mx-auto text-emerald-400" />
          <p className="text-xs text-grey mt-2">Reader connected{connectedSerial ? ` · ${connectedSerial.slice(-6)}` : ""}</p>
          <label className="block text-left text-xs text-grey mt-4 mb-1">Amount (CAD)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-grey">$</span>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="0.00" disabled={stage === "collecting"}
              className="w-full bg-card-raised border border-border rounded-xl pl-7 pr-4 py-2.5 text-foreground disabled:opacity-60" />
          </div>
          <button onClick={charge} disabled={stage === "collecting"} className="mt-4 w-full rounded-xl bg-emerald-500 text-white font-semibold py-2.5 disabled:opacity-70 flex items-center justify-center gap-2">
            {stage === "collecting" ? <><Loader2 size={16} className="animate-spin" /> Tap or insert on the reader…</> : "Charge on reader"}
          </button>
          {stage === "collecting" && <p className="text-xs text-grey mt-2">Follow the prompts on the reader (a Canadian card may ask for a PIN).</p>}
        </Card>
      )}

      {stage === "done" && (
        <Card>
          <CheckCircle2 size={30} className="mx-auto text-emerald-400" />
          <h2 className="text-lg font-bold text-foreground mt-3">Payment complete</h2>
          <p className="text-grey text-sm mt-1.5">{amount ? formatCurrency(Number(amount)) : ""} charged. It&apos;s recorded in Payments.</p>
          <button onClick={() => { setAmount(""); setStage("connected"); }} className="mt-4 w-full rounded-xl bg-foreground text-background font-semibold py-2.5">New sale</button>
        </Card>
      )}

      {stage === "error" && (
        <Card>
          <AlertTriangle size={28} className="mx-auto text-red-400" />
          <h2 className="text-lg font-bold text-foreground mt-3">Something went wrong</h2>
          <p className="text-grey text-sm mt-1.5">{error || "Please try again."}</p>
          <button onClick={boot} className="mt-4 w-full rounded-xl bg-foreground text-background font-semibold py-2.5">Try again</button>
        </Card>
      )}

      {error && stage !== "error" && <p className="max-w-md mx-auto mt-3 text-center text-sm text-red-400">{error}</p>}
    </div>
  );
}
