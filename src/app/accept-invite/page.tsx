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
      // 1. First check if Supabase returned an error in the URL hash
      //    (e.g. otp_expired, access_denied). This must run BEFORE getSession
      //    because a stale session from another user can mask the real cause.
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
      const urlError = hashParams.get("error_code") || hashParams.get("error");
      if (urlError) {
        if (urlError.includes("expired") || urlError === "otp_expired") {
          setError("This invite link has expired. Invite links are only valid for a short time — ask your shop owner to resend you a fresh one from their Staff page.");
        } else if (urlError === "access_denied") {
          setError(`The invite link could not be used (${hashParams.get("error_description") ?? "access denied"}). Ask your shop owner to resend the invite.`);
        } else {
          setError(`Invite link error: ${hashParams.get("error_description") ?? urlError}`);
        }
        setStatus("error");
        return;
      }

      // 2. If the URL carries fresh tokens, force them to become the active
      //    session so an owner-already-logged-in browser doesn't take over.
      const access_token = hashParams.get("access_token");
      const refresh_token = hashParams.get("refresh_token");
      if (access_token && refresh_token) {
        await supabase.auth.setSession({ access_token, refresh_token }).catch(() => null);
      }

      // 3. Now read the session — it'll be the invitee if tokens were present
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
      // Hard navigation so the auth context re-fetches the profile (which now
      // has role='barber' after the API update). A soft router.push() keeps
      // the cached profile and the barber dashboard would bounce them.
      setTimeout(() => { window.location.href = "/barber-dashboard"; }, 1500);
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
