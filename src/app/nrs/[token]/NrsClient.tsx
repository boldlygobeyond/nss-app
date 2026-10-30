"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import NrsProgressIndicator from "@/components/nrs/NrsProgressIndicator";
import RatingOption from "@/components/nrs/RatingOption";
import { NRS_RATINGS } from "@/lib/nrs/ratingScale";

interface NrsQuestion {
  id: number;
  order: number;
  scenarioText: string;
}

interface NrsData {
  submissionId: string;
  participantFirstName: string;
  clusterKey: string;
  clusterName: string;
  status: "invited" | "in_progress" | "completed";
  resonanceScore: number | null;
  questions: NrsQuestion[];
  savedResponses: { questionId: number; rating: number }[];
}

type Phase = "loading" | "not_found" | "error" | "assessment" | "completed";

// localStorage here is a fast-path UX cache only — the server (via the
// token) is the real source of truth, read fresh on every mount, so
// resuming works even from a different device/browser. This is used only
// to make a same-device return visit feel instant later; it is never
// trusted over what the server says was actually saved.
const STORAGE_PREFIX = "nrs_progress_";

export default function NrsClient({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<NrsData | null>(null);
  const [responses, setResponses] = useState<Record<number, number>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/nrs/${token}`);
        if (cancelled) return;
        if (res.status === 404) {
          setPhase("not_found");
          return;
        }
        if (!res.ok) {
          setPhase("error");
          return;
        }
        const body = (await res.json()) as NrsData;
        const initialResponses: Record<number, number> = {};
        body.savedResponses.forEach((r) => {
          initialResponses[r.questionId] = r.rating;
        });
        setData(body);
        setResponses(initialResponses);

        if (body.status === "completed") {
          setPhase("completed");
          return;
        }

        const firstUnanswered = body.questions.findIndex((q) => initialResponses[q.id] === undefined);
        setCurrentIndex(firstUnanswered === -1 ? Math.max(body.questions.length - 1, 0) : firstUnanswered);
        setPhase("assessment");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const persistLocal = (nextResponses: Record<number, number>, nextIndex: number) => {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${token}`, JSON.stringify({ responses: nextResponses, currentIndex: nextIndex }));
    } catch {
      // best-effort only
    }
  };

  const currentQuestion = data?.questions[currentIndex] ?? null;
  const total = data?.questions.length ?? 10;
  const allAnswered = useMemo(
    () => !!data && data.questions.every((q) => responses[q.id] !== undefined),
    [data, responses],
  );

  const handleSelect = async (rating: number) => {
    if (!currentQuestion || submitting) return;
    const next = { ...responses, [currentQuestion.id]: rating };
    setResponses(next);
    setErrorMessage(null);
    persistLocal(next, currentIndex);

    try {
      const res = await fetch(`/api/nrs/${token}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: currentQuestion.id, rating }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      setErrorMessage("Your last answer may not have saved. Check your connection and try again if this continues.");
    }
  };

  const handleNext = () => {
    if (!data || currentIndex >= data.questions.length - 1) return;
    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    persistLocal(responses, nextIndex);
  };

  const handleBack = () => {
    if (currentIndex === 0) return;
    const prevIndex = currentIndex - 1;
    setCurrentIndex(prevIndex);
    persistLocal(responses, prevIndex);
  };

  const handleSubmit = async () => {
    if (!data || !allAnswered || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/nrs/${token}/submit`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error || "Could not submit your responses.");
      }
      try {
        localStorage.removeItem(`${STORAGE_PREFIX}${token}`);
      } catch {
        // best-effort only
      }
      setPhase("completed");
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Could not submit your responses. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (phase === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-secondary border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (phase === "not_found") {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh] px-6 text-center">
        <div>
          <h2 className="font-heading text-xl font-semibold text-foreground mb-2">This link isn&apos;t valid</h2>
          <p className="text-muted-foreground text-sm">
            Double-check the link from your invitation email, or reach out to whoever sent it.
          </p>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh] px-6 text-center">
        <div>
          <h2 className="font-heading text-xl font-semibold text-foreground mb-2">Something went wrong</h2>
          <p className="text-muted-foreground text-sm">Please refresh the page and try again.</p>
        </div>
      </div>
    );
  }

  if (phase === "completed") {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh] px-6 text-center">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-md">
          <h2 className="font-heading text-2xl font-semibold text-foreground mb-2">
            Thanks{data ? `, ${data.participantFirstName}` : ""}!
          </h2>
          <p className="text-muted-foreground">
            Your response has been recorded. Keep an eye on your inbox for your {data?.clusterName ?? "results"}.
          </p>
        </motion.div>
      </div>
    );
  }

  if (!data || !currentQuestion) return null;

  return (
    <div className="flex-1 max-w-2xl w-full mx-auto px-4 py-6 flex flex-col">
      <NrsProgressIndicator current={currentIndex + 1} total={total} />

      {errorMessage && (
        <div
          role="status"
          className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="shrink-0 text-destructive/70 hover:text-destructive"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={currentQuestion.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="bg-card rounded-2xl border border-border/50 shadow-sm p-6 md:p-8"
        >
          <h2 className="font-heading text-lg md:text-xl font-medium text-foreground mb-6 leading-relaxed">
            {currentQuestion.scenarioText}
          </h2>
          <p className="text-sm text-foreground font-medium mb-1">
            How important is it that this need is met here for you to show up fully?
          </p>
          <p className="text-xs text-muted-foreground mb-5">Hover over a rating to learn more.</p>

          <div className="grid grid-cols-5 gap-1.5 sm:gap-3">
            {NRS_RATINGS.map((r) => (
              <RatingOption
                key={r.value}
                value={r.value}
                label={r.label}
                description={r.description}
                selected={responses[currentQuestion.id] === r.value}
                onSelect={() => handleSelect(r.value)}
              />
            ))}
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={handleBack}
          disabled={currentIndex === 0}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {currentIndex < data.questions.length - 1 ? (
          <button
            onClick={handleNext}
            disabled={responses[currentQuestion.id] === undefined}
            className="px-6 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:pointer-events-none"
          >
            Next
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!allAnswered || submitting}
            className="px-6 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            {submitting ? "Submitting..." : "Submit"}
          </button>
        )}
      </div>
    </div>
  );
}
