"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import BgbStar from "@/components/BgbStar";

const PRONOUN_OPTIONS = ["he/him", "she/her", "they/them", "prefer not to say"];

export default function NovaGreeting({
  onComplete,
  step,
  setStep,
  onBack,
}: {
  onComplete: (name: string, pronouns: string) => void;
  step: number;
  setStep: (updater: number | ((s: number) => number)) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [pronouns, setPronouns] = useState("");

  useEffect(() => {
    const prefill = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("first_name")
          .eq("id", user.id)
          .maybeSingle();
        if (profile?.first_name) setName(profile.first_name);
      } catch {
        // ignore — prefill is best-effort
      }
    };
    prefill();
  }, []);

  const handleBack = () => {
    if (step === 0) onBack();
    else setStep((s) => s - 1);
  };

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) setStep(1);
  };

  const handlePronounSelect = (p: string) => {
    setPronouns(p);
    setTimeout(() => setStep(2), 300);
  };

  const handleCustomPronoun = (e: React.FormEvent) => {
    e.preventDefault();
    if (pronouns.trim()) setStep(2);
  };

  const handleBegin = () => {
    onComplete(name.trim(), pronouns);
  };

  return (
    <div className="flex flex-col items-center px-4 pt-10 pb-12">
      <div className="w-full max-w-lg mb-4">
        {step !== 0 && (
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        )}
      </div>

      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mb-10"
      >
        <BgbStar size={72} />
      </motion.div>

      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div
            key="name"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
            className="text-center max-w-lg w-full"
          >
            <p className="text-muted-foreground text-sm uppercase tracking-widest mb-4 font-medium">Boldly Go Beyond</p>
            <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-4 text-foreground leading-snug">
              Hey there, I&apos;m Nova, Boldly Go Beyond&apos;s virtual intelligence.
            </h1>
            <p className="text-muted-foreground text-lg mb-10">What shall I call you?</p>
            <form onSubmit={handleNameSubmit} className="flex gap-3 max-w-sm mx-auto">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your first name"
                className="flex-1 text-center text-lg h-12 rounded-lg bg-card border border-border/50 focus:border-primary focus:outline-none px-4"
                autoFocus
              />
              <button
                type="submit"
                disabled={!name.trim()}
                className="h-12 px-6 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground transition-colors"
              >
                →
              </button>
            </form>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div
            key="pronouns"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
            className="text-center max-w-lg w-full"
          >
            <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-4 text-foreground">
              Nice to meet you, {name}.
            </h1>
            <p className="text-muted-foreground text-lg mb-10 leading-relaxed">
              Would you be open to sharing your preferred pronouns so I can reflect that accurately in your needs
              assessment report?
            </p>
            <div className="flex flex-wrap justify-center gap-3 mb-6">
              {PRONOUN_OPTIONS.map((p) => (
                <button
                  key={p}
                  onClick={() => handlePronounSelect(p)}
                  className="h-11 px-6 text-base rounded-lg border border-border/50 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all"
                >
                  {p}
                </button>
              ))}
            </div>
            <form onSubmit={handleCustomPronoun} className="flex gap-3 max-w-xs mx-auto">
              <input
                value={PRONOUN_OPTIONS.includes(pronouns) ? "" : pronouns}
                onChange={(e) => setPronouns(e.target.value)}
                placeholder="Or type your own..."
                className="flex-1 text-center h-10 rounded-lg bg-card border border-border/50 focus:border-primary focus:outline-none px-4"
              />
              <button
                type="submit"
                disabled={!pronouns.trim() || PRONOUN_OPTIONS.includes(pronouns)}
                className="h-10 px-3 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                →
              </button>
            </form>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            key="intro"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
            className="text-center max-w-xl w-full"
          >
            <h2 className="font-heading text-2xl md:text-3xl font-semibold mb-6 text-foreground">
              Great, thank you, {name}.
            </h2>
            <div className="bg-card border border-border/50 rounded-2xl p-6 md:p-8 text-left shadow-sm mb-8">
              <p className="text-foreground text-base md:text-lg leading-relaxed mb-4">
                Today, I&apos;m going to take you through 50 &quot;would you rather&quot; style questions to
                learn a bit about you. Don&apos;t worry about tying your answers to work—just go with whatever comes
                to mind.
              </p>
              <p className="text-foreground text-base md:text-lg leading-relaxed mb-4">
                While the questions are multiple choice, feel free to select{" "}
                <span className="font-semibold text-primary">&quot;It Depends&quot;</span> and I&apos;ll see if I can
                clarify things for you. If you still aren&apos;t sure, you can skip the question.
              </p>
              <p className="text-foreground text-base md:text-lg leading-relaxed">Let&apos;s get started.</p>
            </div>
            <button
              onClick={handleBegin}
              className="h-12 px-10 text-base rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
            >
              I&apos;m ready →
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
