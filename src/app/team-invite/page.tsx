"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import GlobalHeader from "@/components/GlobalHeader";

// Consumes a pilot/team invite token — the counterpart to
// src/lib/nss/teamInvite.ts. Deliberately does not touch anything the
// public lead-capture flow uses (LeadCaptureModal, /api/nss/lead-signup);
// this is a separate entry point for people who were invited directly by
// an admin, not someone who filled out the landing page's own form.
//
// The token is only consumed on an explicit click, not the instant this
// page loads. Supabase's magic-link tokens are one-time-use by design (same
// security property as a password-reset link) — auto-verifying on load
// means a corporate email security scanner "previewing" the link (Microsoft
// Defender SafeLinks, Gmail's own link-checking, antivirus) silently burns
// it before the real person ever clicks, which is the most common way
// these links show up "already expired." A scanner fetches the page; it
// doesn't click a button on it.
function TeamInviteClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"checking" | "ready" | "verifying" | "error">("checking");

  useEffect(() => {
    // Already signed in this browser (e.g. they already used this link
    // once and are clicking it again) — no need to re-consume the token,
    // which would fail anyway since it's already spent.
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        router.push("/survey");
        return;
      }
      setStatus(searchParams.get("token") ? "ready" : "error");
    });
  }, [searchParams, router]);

  const handleContinue = () => {
    const tokenHash = searchParams.get("token");
    if (!tokenHash) {
      setStatus("error");
      return;
    }
    setStatus("verifying");
    const supabase = createClient();
    supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" }).then(({ error }) => {
      if (error) {
        setStatus("error");
        return;
      }
      router.push("/survey");
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />
      <div className="flex-1 flex items-center justify-center px-6">
        {status === "checking" ? (
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        ) : status === "verifying" ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Signing you in...</p>
          </div>
        ) : status === "ready" ? (
          <div className="max-w-sm text-center">
            <h1 className="font-heading text-xl font-semibold text-foreground mb-2">You&apos;re invited</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Click below to sign in and start the Needs Signal Survey.
            </p>
            <button
              onClick={handleContinue}
              className="h-11 px-6 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Continue to survey
            </button>
          </div>
        ) : (
          <div className="max-w-sm text-center">
            <h1 className="font-heading text-xl font-semibold text-foreground mb-2">This link isn&apos;t working</h1>
            <p className="text-sm text-muted-foreground">
              It may have already been used or expired. Ask whoever invited you to send a fresh link.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TeamInvitePage() {
  return (
    <Suspense fallback={null}>
      <TeamInviteClient />
    </Suspense>
  );
}
