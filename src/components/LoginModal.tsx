"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Modal from "./Modal";
import BgbStar from "./BgbStar";

export default function LoginModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setErrorMessage(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  };

  return (
    <Modal onClose={onClose}>
      <div className="text-center">
        <BgbStar size={40} className="mx-auto mb-4" />
        <h2 className="font-heading text-xl font-semibold text-foreground mb-2">Log in</h2>
        <p className="text-muted-foreground text-sm mb-6">
          Enter your email and we&apos;ll send you a magic link to view your results.
        </p>

        {status === "sent" ? (
          <p className="text-sm text-foreground">
            Check <span className="font-medium">{email}</span> for a sign-in link.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="h-11 rounded-lg bg-background border border-border/50 focus:border-primary focus:outline-none px-4 text-center"
              autoFocus
            />
            <button
              type="submit"
              disabled={status === "sending" || !email.trim()}
              className="h-11 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground transition-colors"
            >
              {status === "sending" ? "Sending..." : "Send magic link"}
            </button>
            {status === "error" && (
              <p className="text-sm text-destructive">{errorMessage ?? "Something went wrong. Please try again."}</p>
            )}
          </form>
        )}
      </div>
    </Modal>
  );
}
