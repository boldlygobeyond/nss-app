"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import BgbLogo from "@/components/BgbLogo";
import BgbStar from "@/components/BgbStar";

function LoginForm() {
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
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
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: source ? { lead_source: source } : undefined,
      },
    });
    if (error) {
      console.error("[login] signInWithOtp failed:", error);
      setErrorMessage(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="mb-6">
        <BgbLogo height={32} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm bg-card border border-border/50 rounded-2xl shadow-sm p-8 text-center"
      >
        <BgbStar size={48} className="mx-auto mb-4" />
        <h1 className="font-heading text-xl font-semibold text-foreground mb-2">Sign in</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Enter your email and we&apos;ll send you a magic link to sign in.
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
      </motion.div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
