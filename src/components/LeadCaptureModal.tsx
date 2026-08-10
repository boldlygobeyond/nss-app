"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Modal from "./Modal";

export default function LeadCaptureModal({
  leadSource,
  onClose,
}: {
  leadSource: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error" | "existing-account-sent">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/nss/lead-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          leadSource,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Something went wrong. Please try again.");

      const supabase = createClient();

      if (body.existingAccount) {
        const { error } = await supabase.auth.signInWithOtp({
          email: body.email,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        setStatus("existing-account-sent");
        return;
      }

      const { error } = await supabase.auth.verifyOtp({
        token_hash: body.tokenHash,
        type: "email",
      });
      if (error) throw error;

      router.push("/survey");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStatus("error");
    }
  };

  if (status === "existing-account-sent") {
    return (
      <Modal onClose={onClose}>
        <div className="text-center">
          <h2 className="font-heading text-xl font-semibold text-foreground mb-2">You already have an account</h2>
          <p className="text-muted-foreground text-sm">
            We sent a sign-in link to <span className="font-medium">{email}</span> — check your inbox to view your
            results or continue where you left off.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <div>
        <h2 className="font-heading text-xl font-semibold text-foreground mb-2 text-center">
          Let&apos;s get started
        </h2>
        <p className="text-muted-foreground text-sm mb-6 text-center">
          Tell us a bit about you before we dive in.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name"
            className="h-11 rounded-lg bg-background border border-border/50 focus:border-primary focus:outline-none px-4"
            autoFocus
          />
          <input
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name"
            className="h-11 rounded-lg bg-background border border-border/50 focus:border-primary focus:outline-none px-4"
          />
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Work email"
            className="h-11 rounded-lg bg-background border border-border/50 focus:border-primary focus:outline-none px-4"
          />
          <button
            type="submit"
            disabled={status === "submitting" || !firstName.trim() || !lastName.trim() || !email.trim()}
            className="h-11 mt-2 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground transition-colors"
          >
            {status === "submitting" ? "Starting..." : "Start Assessment"}
          </button>
          {status === "error" && <p className="text-sm text-destructive text-center">{errorMessage}</p>}
        </form>
      </div>
    </Modal>
  );
}
