"use client";
import { useState } from "react";
import Link from "next/link";
import { Mail, AlertCircle, Check } from "lucide-react";
import { AuthShell } from "@/components/marketing/auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    // Branded reset via our own Resend email (from clipwise.ca), not Supabase's
    // built-in mail. Always show the same "check your inbox" confirmation — never
    // reveal whether the email exists (only surface rate-limit / network errors).
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        setError("Too many attempts — please wait a moment and try again.");
      } else {
        setSent(true);
      }
    } catch {
      setError("Couldn't send right now — check your connection and try again.");
    }
    setLoading(false);
  };

  return (
    <AuthShell title="Reset your password" subtitle="We&rsquo;ll send you a link to reset it">
      {sent ? (
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <div className="logo-fb" style={{ borderRadius: 999, background: "rgba(255,255,255,.08)", borderColor: "rgba(255,255,255,.16)" }}><Check size={22} style={{ color: "var(--ok)" }} /></div>
          <p style={{ fontWeight: 600, color: "var(--t1)" }}>Check your inbox</p>
          <p className="lead" style={{ fontSize: 14, textAlign: "center" }}>We sent a password reset link to <strong style={{ color: "var(--t1)" }}>{email}</strong></p>
          <p className="authfoot" style={{ marginTop: 6 }}><Link href="/login">Back to sign in</Link></p>
        </div>
      ) : (
        <>
          {error && <div className="err"><AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error}</span></div>}
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="fp-email">Email</label>
              <div className="ip">
                <Mail size={16} className="lic" />
                <input id="fp-email" className="pl" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@freshcutz.ca" required />
              </div>
            </div>
            <button type="submit" className="pill w full" disabled={loading} style={{ marginTop: 4 }}>
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
          <p className="authfoot">Remember your password? <Link href="/login">Sign in</Link></p>
        </>
      )}
    </AuthShell>
  );
}
