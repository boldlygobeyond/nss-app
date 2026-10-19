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
function TeamInviteClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"verifying" | "error">("verifying");

  useEffect(() => {
    const tokenHash = searchParams.get("token");
    if (!tokenHash) {
      setStatus("error");
      return;
    }

    const supabase = createClient();
    supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" }).then(({ error }) => {
      if (error) {
        setStatus("error");
        return;
      }
      router.push("/survey");
    });
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />
      <div className="flex-1 flex items-center justify-center px-6">
        {status === "verifying" ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Signing you in...</p>
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
