"use client";

import { use, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { getSubmission } from "@/lib/nss/api";
import GlobalHeader from "@/components/GlobalHeader";

const CALENDAR_URL = "https://calendar.app.google/d2Pr6FK1aaZ5Mbmy8";

const BENTO_CARDS = [
  {
    title: "System-Level Solutions",
    body: "Instead of managing one-off issues, you implement targeted shortcuts that unlock energy across the entire team.",
  },
  {
    title: "Reclaimed Manager Bandwidth",
    body: "When everyone can see what's driving motivation, they can take real ownership of their success, freeing you from constant hand-holding and mind-reading.",
  },
  {
    title: "Proactive Alignment",
    body: "You spot quiet friction before it stalls momentum, keeping your navigation steady without the drama.",
  },
];

const MISSION_CONTROL_CARDS = [
  {
    title: "Ground Control",
    body: "We lead workshops for your team that help them uncover their needs and empower them to take ownership over individual and team success.",
  },
  {
    title: "Diagnostics",
    body: "The Needs Signal Survey is just the beginning. Our robust suite of diagnostics gathers key self-reported data on what truly matters to your team.",
  },
  {
    title: "Navigation Tools",
    body: "We aggregate your crew's individual profiles into a single system map, showing you exactly how needs interconnect across the team so you can stop guessing and start making precise choices.",
  },
  {
    title: "Systems Checks",
    body: "We embed simple, repeatable practices directly into your regular workflows to create real-time alignment and surface small issues before they ripple into larger team issues.",
  },
];

export default function SurveyReportGeneratingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [isReportReady, setIsReportReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const supabase = createClient();
      const submission = await getSubmission(supabase, id);
      if (cancelled) return;

      if (submission?.report_data) {
        setIsReportReady(true);
        return;
      }

      try {
        const res = await fetch("/api/nss/generate-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submissionId: id, force: false }),
        });
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Report generation failed");
        }
        setIsReportReady(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Report generation failed");
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleViewReport = () => {
    window.open(`/reports/${id}`, "_blank", "noopener,noreferrer");
  };

  const handleScheduleCall = () => {
    window.open(CALENDAR_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />

      <div className="sticky top-14 z-40 bg-primary text-primary-foreground shadow-md">
        <p className="max-w-3xl mx-auto px-6 py-3 text-center text-sm font-medium">
          {isReportReady
            ? "Your report is ready! Scroll to the bottom of the page to access your results."
            : "Your personal needs report is generating..."}
        </p>
        <div className="h-1 bg-primary-foreground/20 overflow-hidden">
          <div
            className={`h-full bg-primary-foreground transition-all duration-700 ${
              isReportReady ? "w-full" : "w-1/3 animate-pulse"
            }`}
          />
        </div>
      </div>

      <div className="flex-1 max-w-3xl w-full mx-auto px-6 py-16">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-foreground mb-4 text-center leading-tight">
            Your personal needs report is generating, but that&apos;s just the beginning.
          </h1>
          <p className="text-muted-foreground text-lg mb-16 text-center leading-relaxed max-w-2xl mx-auto">
            By mapping your entire team&apos;s needs you get a deep understanding of how everyone&apos;s needs are
            interconnected so you can take shortcuts that unlock your team&apos;s true potential.
          </p>

          <div className="grid md:grid-cols-3 gap-4 mb-20">
            {BENTO_CARDS.map((card) => (
              <div key={card.title} className="bg-card border border-border/50 rounded-2xl p-6">
                <h3 className="font-heading text-lg font-semibold text-foreground mb-2">{card.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>

          <div className="mb-20">
            <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-8 text-center leading-snug">
              But the Needs Signal Survey is just one small piece of our Mission Control System.
            </h2>
            <div className="grid md:grid-cols-2 gap-4">
              {MISSION_CONTROL_CARDS.map((card) => (
                <div key={card.title} className="bg-card border border-border/50 rounded-2xl p-6">
                  <h3 className="font-heading text-lg font-semibold text-foreground mb-2">{card.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{card.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border/50 rounded-2xl p-8 md:p-10 text-center shadow-sm">
            <p className="text-foreground text-lg leading-relaxed mb-8 max-w-xl mx-auto">
              Ready to see what&apos;s possible for your crew? Look over your personal insights and schedule a call
              with our co-founders today to get the personalized flight plan for your team.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={handleViewReport}
                disabled={!isReportReady}
                className="h-12 px-8 text-base rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground shadow-md transition-colors"
              >
                {isReportReady ? "View My Report" : "Compiling your profile..."}
              </button>
              <button
                onClick={handleScheduleCall}
                className="h-12 px-8 text-base rounded-lg border border-border/50 hover:bg-secondary text-foreground transition-colors"
              >
                Get Your Customized Flight Plan!
              </button>
            </div>
            {error && (
              <p className="text-destructive text-sm mt-4">
                {error} — your answers are saved; try refreshing this page to retry.
              </p>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
