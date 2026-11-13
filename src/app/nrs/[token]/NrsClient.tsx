"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
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

        setPhase("assessment");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const persistLocal = (nextResponses: Record<number, number>) => {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${token}`, JSON.stringify({ responses: nextResponses }));
    } catch {
      // best-effort only
    }
  };

  const total = data?.questions.length ?? 10;
  const answeredCount = useMemo(
    () => (data ? data.questions.filter((q) => responses[q.id] !== undefined).length : 0),
    [data, responses],
  );
  const allAnswered = !!data && answeredCount === data.questions.length;

  const handleSelect = async (questionId: number, rating: number) => {
    if (submitting) return;
    const next = { ...responses, [questionId]: rating };
    setResponses(next);
    setErrorMessage(null);
    persistLocal(next);

    try {
      const res = await fetch(`/api/nrs/${token}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, rating }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      setErrorMessage("Your last answer may not have saved. Check your connection and try again if this continues.");
    }
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
            Your response has been recorded. Keep an eye on your inbox for your {data?.clusterName ?? ""} results.
          </p>
        </motion.div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex-1 max-w-2xl w-full mx-auto px-4 py-6 flex flex-col">
      <h1 className="font-heading text-2xl md:text-3xl font-semibold text-foreground mb-1">{data.clusterName}</h1>
      <p className="font-heading text-lg md:text-xl font-medium text-foreground mb-3">Needs Resonance Scan</p>

      <p className="text-base text-foreground mb-4">
        For each scenario below, rate how important this would be for you to show up fully on your team.
      </p>

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

      <div className="bg-card rounded-2xl border border-border/50 shadow-sm p-6 md:p-8 flex flex-col gap-8">
        {data.questions.map((question, i) => (
          <motion.div
            key={question.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            // Capped stagger delay — a gentle entrance for the first few
            // scenarios without making the participant wait through 10
            // sequential delays to see the bottom of a 10-question page.
            transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.3) }}
            className={i > 0 ? "pt-8 border-t border-border/50" : ""}
          >
            <p className="text-xs font-medium text-muted-foreground mb-2">Scenario {question.order}</p>
            <h2 className="font-heading text-lg md:text-xl font-medium text-foreground mb-6 leading-relaxed">
              {question.scenarioText}
            </h2>

            <div className="grid grid-cols-5 gap-1.5 sm:gap-3">
              {NRS_RATINGS.map((r) => (
                <RatingOption
                  key={r.value}
                  idPrefix={question.id}
                  value={r.value}
                  label={r.label}
                  description={r.description}
                  selected={responses[question.id] === r.value}
                  onSelect={() => handleSelect(question.id, r.value)}
                />
              ))}
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-8 flex flex-col items-end gap-2">
        {!allAnswered && (
          <p className="text-xs text-muted-foreground">{total - answeredCount} more to answer before you can submit</p>
        )}
        <button
          onClick={handleSubmit}
          disabled={!allAnswered || submitting}
          className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </div>
    </div>
  );
}
