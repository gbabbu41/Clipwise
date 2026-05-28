"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { supabase } from "@/lib/supabase";

type Status = "loading" | "linking" | "done" | "error";

export default function AcceptInvitePage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    async function handle() {
      // Supabase client picks up hash tokens from the URL automatically
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setError("This invite link is invalid or has already been used. Ask your shop owner for a new one.");
        setStatus("error");
        return;
      }

      setStatus("linking");

      const barberId = session.user.user_metadata?.invite_barber_id as string | undefined;

      const res = await fetch("/api/barber/accept-invite", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ barber_id: barberId }),
      });

      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? "Something went wrong. Please contact your shop owner.");
        setStatus("error");
        return;
      }

      setStatus("done");
      // Short pause so user sees the success state, then redirect
      setTimeout(() => router.push("/barber-dashboard"), 1500);
    }

    handle();
  }, [router]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="mb-10">
        <Logo size="md" />
      </div>

      <div className="bg-surface border border-border rounded-2xl p-8 w-full max-w-sm text-center">
        {status === "loading" && (
          <>
            <div className="w-10 h-10 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-4" />
            <p className="font-semibold text-white">Verifying your invite…</p>
            <p className="text-sm text-gray-500 mt-1">Just a moment</p>
          </>
        )}

        {status === "linking" && (
          <>
            <div className="w-10 h-10 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-4" />
            <p className="font-semibold text-white">Setting up your account…</p>
            <p className="text-sm text-gray-500 mt-1">Linking you to your shop</p>
          </>
        )}

        {status === "done" && (
          <>
            <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">✂️</span>
            </div>
            <p className="font-bold text-white text-lg">You're all set!</p>
            <p className="text-sm text-gray-400 mt-1">Taking you to your barber dashboard…</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-14 h-14 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🔗</span>
            </div>
            <p className="font-bold text-white text-lg mb-2">Invite error</p>
            <p className="text-sm text-gray-400">{error}</p>
          </>
        )}
      </div>
    </div>
  );
}
