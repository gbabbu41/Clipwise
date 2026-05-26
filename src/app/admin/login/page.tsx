"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, Shield, AlertCircle } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) { setError(authError.message); setLoading(false); return; }

      if (data.session?.access_token) {
        const res = await fetch("/api/profile", {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        const { profile } = res.ok ? await res.json() : { profile: null };
        if (profile?.role === "super_admin") {
          router.push("/admin");
        } else {
          await supabase.auth.signOut();
          setError("Access denied. Admin accounts only.");
          setLoading(false);
        }
      }
    } catch {
      setError("Something went wrong — please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <Logo size="md" className="justify-center mb-5" />
          <div className="inline-flex items-center gap-2 bg-gold/10 border border-gold/30 rounded-full px-4 py-1.5 mb-4">
            <Shield size={12} className="text-gold" />
            <span className="text-xs font-bold text-gold tracking-widest uppercase">Admin Portal</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Secure Access</h1>
          <p className="text-gray-500 text-sm mt-1">Authorized personnel only</p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-8">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gold/10 border-2 border-gold/20 rounded-2xl flex items-center justify-center">
              <Lock size={28} className="text-gold" />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Admin Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@email.com"
                  required
                  autoComplete="off"
                  className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="off"
                  className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 transition-all"
                />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <Button type="submit" variant="gold" className="w-full" size="lg" loading={loading}>
              {loading ? "Authenticating..." : "Access Admin Panel"}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          ClipWise Admin Portal — Authorized Access Only
        </p>
      </div>
    </div>
  );
}
