"use client";
import { useEffect, useState } from "react";
import { Save, User } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export default function BarberProfilePage() {
  const { user } = useAuth();
  const { barber, shop } = useBarber();
  const [form, setForm] = useState({ name: "", email: "", bio: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (barber) {
      setForm({ name: barber.name ?? "", email: barber.email ?? "", bio: barber.bio ?? "" });
    }
  }, [barber]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!barber) return;
    setSaving(true);
    setError("");

    const { error: err } = await supabase
      .from("barbers")
      .update({ name: form.name, email: form.email, bio: form.bio })
      .eq("id", barber.id);

    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const initial = form.name ? form.name.charAt(0).toUpperCase() : "?";

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">My Profile</h1>
        <p className="text-gray-500 text-sm mt-0.5">Update your info shown to clients</p>
      </div>

      <div className="bg-surface border border-border rounded-2xl p-6">
        {/* Avatar */}
        <div className="flex items-center gap-5 mb-8 pb-8 border-b border-border">
          <div className="w-20 h-20 rounded-full bg-gold/20 border-2 border-gold/30 flex items-center justify-center text-gold font-bold text-3xl">
            {initial}
          </div>
          <div>
            <p className="font-semibold text-white text-lg">{form.name || "Your Name"}</p>
            <p className="text-sm text-gray-500">{shop?.name ?? "Barber"}</p>
            {barber?.rating ? (
              <p className="text-sm text-gold mt-0.5">★ {barber.rating.toFixed(1)} · {barber.total_reviews} reviews</p>
            ) : null}
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Full Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              required
              className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50"
              placeholder="e.g. Marcus Johnson"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Bio</label>
            <textarea
              value={form.bio}
              onChange={e => setForm({ ...form, bio: e.target.value })}
              rows={4}
              className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 resize-none"
              placeholder="Tell clients a bit about yourself — specialties, years of experience, style..."
            />
          </div>

          {/* Account info (read-only) */}
          <div className="bg-surface-raised rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Account Info</p>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <User size={13} />
              <span>{user?.email}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Commission:</span>
              <span className="text-gold font-semibold">{barber?.commission_percent ?? 50}%</span>
              <span className="text-gray-600 text-xs">(set by shop owner)</span>
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all",
              saved
                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                : "bg-gold text-black hover:bg-gold/90"
            )}
          >
            <Save size={15} />
            {saving ? "Saving..." : saved ? "Saved!" : "Save Changes"}
          </button>
        </form>
      </div>
    </div>
  );
}
