"use client";
import { useEffect, useState } from "react";
import { Save, User, Camera } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { NotifSoundToggle } from "@/components/notif-sound-toggle";
import { AvatarImage } from "@/components/ui/avatar-image";
import { uploadBarberPhoto } from "@/lib/upload-barber-photo";

export default function BarberProfilePage() {
  const { user, accessToken } = useAuth();
  const { barber, shop } = useBarber();
  const [form, setForm] = useState({ name: "", email: "", bio: "" });
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (barber) {
      setForm({ name: barber.name ?? "", email: barber.email ?? "", bio: barber.bio ?? "" });
      setPhoto(barber.photo ?? null);
    }
  }, [barber]);

  async function handlePhoto(file: File) {
    if (!barber) return;
    setUploadingPhoto(true);
    setError("");
    try {
      const url = await uploadBarberPhoto(file, barber.id, accessToken);
      setPhoto(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setUploadingPhoto(false);
    }
  }

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
        <p className="text-[#777] text-sm mt-0.5">Update your info shown to clients</p>
      </div>

      <div className="bg-surface border border-border rounded-2xl p-6">
        {/* Avatar — tap to upload your photo (shown to clients on booking). */}
        <div className="flex items-center gap-5 mb-8 pb-8 border-b border-border">
          <label className={cn("relative w-20 h-20 rounded-full cursor-pointer group flex-shrink-0", uploadingPhoto && "pointer-events-none opacity-70")}>
            <AvatarImage src={photo} alt={form.name} className="w-20 h-20 rounded-full object-cover border-2 border-gold/30"
              fallback={
                <div className="w-20 h-20 rounded-full bg-gold/20 border-2 border-gold/30 flex items-center justify-center text-gold font-bold text-3xl">
                  {initial}
                </div>
              } />
            <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Camera size={20} className="text-white" />
            </span>
            {uploadingPhoto && <span className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center text-[10px] text-white font-medium">Uploading…</span>}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhoto(f); }} />
          </label>
          <div>
            <p className="font-semibold text-white text-lg">{form.name || "Your Name"}</p>
            <p className="text-sm text-[#777]">{shop?.name ?? "Barber"}</p>
            {barber?.rating ? (
              <p className="text-sm text-amber-400 mt-0.5">★ {barber.rating.toFixed(1)} · {barber.total_reviews} reviews</p>
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
              className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-2 focus:ring-gold/50"
              placeholder="e.g. Marcus Johnson"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-2 focus:ring-gold/50"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-300">Bio</label>
            <textarea
              value={form.bio}
              onChange={e => setForm({ ...form, bio: e.target.value })}
              rows={4}
              className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-2 focus:ring-gold/50 resize-none"
              placeholder="Tell clients a bit about yourself — specialties, years of experience, style..."
            />
          </div>

          {/* Account info (read-only) */}
          <div className="bg-surface-raised rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-[#777] uppercase tracking-wider">Account Info</p>
            <div className="flex items-center gap-2 text-sm text-[#777]">
              <User size={13} />
              <span>{user?.email}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[#777]">Commission:</span>
              <span className="text-gold font-semibold">{barber?.commission_percent ?? 50}%</span>
              <span className="text-[#777] text-xs">(set by shop owner)</span>
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

      {/* Notification preferences */}
      <div className="mt-6">
        <p className="text-xs font-semibold text-[#777] uppercase tracking-wider mb-2">Notifications</p>
        <NotifSoundToggle />
      </div>
    </div>
  );
}
