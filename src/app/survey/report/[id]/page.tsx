"use client";

import { use, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { getSubmission } from "@/lib/nss/api";
import { CALENDAR_URL } from "@/lib/nss/links";
import GlobalHeader from "@/components/GlobalHeader";
import MissionControlPitch from "@/components/reports/MissionControlPitch";

// Cycled while the report generates so the wait reads as active stages
// rather than one long, unexplained pause — the Claude call alone can
// take a while, and there's no real sub-progress to report honestly, so
// this communicates "still working" without claiming a fake percentage.
const STATUS_MESSAGES = [
  "Your personal needs report is generating...",
  "Scoring your responses...",
  "Finding your strongest patterns...",
  "Writing your personal insights...",
  "Almost there...",
];

export default function SurveyReportGeneratingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [isReportReady, setIsReportReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusIndex, setStatusIndex] = useState(0);
  const [isTeam, setIsTeam] = useState(false);

  useEffect(() => {
    if (isReportReady) return;
    const interval = setInterval(() => {
      setStatusIndex((i) => Math.min(i + 1, STATUS_MESSAGES.length - 1));
    }, 4000);
    return () => clearInterval(interval);
  }, [isReportReady]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const supabase = createClient();
      const submission = await getSubmission(supabase, id);
      if (cancelled) return;
      setIsTeam(!!submission?.team);

      if (submission?.report_data) {
        setIsReportReady(true);
        return;
      }

      try {
        const res = await fetch("/api/nss/generate-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            submissionId: id,
            force: false,
            ...(process.env.NEXT_PUBLIC_NSS_ENGINE === "bt" ? { scoringModel: "bradley-terry" } : {}),
          }),
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
            : STATUS_MESSAGES[statusIndex]}
        </p>
        <div className="h-1 bg-primary-foreground/20 overflow-hidden relative">
          {isReportReady ? (
            <div className="h-full w-full bg-primary-foreground transition-all duration-700" />
          ) : (
            <motion.div
              className="h-full w-1/3 bg-primary-foreground rounded-full"
              animate={{ x: ["-100%", "400%"] }}
              transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
            />
          )}
        </div>
      </div>

      <div className="flex-1 max-w-3xl w-full mx-auto px-6 py-16">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <MissionControlPitch
            simple={isTeam}
            headline={
              isTeam
                ? "Your Needs Signal Report is generating, but it's just one small piece of our Mission Control System."
                : "Your personal needs report is generating, but that's just the beginning."
            }
            cta={
              <>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    onClick={handleViewReport}
                    disabled={!isReportReady}
                    className="h-12 px-8 text-base rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground shadow-md transition-colors"
                  >
                    {isReportReady ? "View My Report" : "Compiling your profile..."}
                  </button>
                  {!isTeam && (
                    <button
                      onClick={handleScheduleCall}
                      className="h-12 px-8 text-base rounded-lg border-2 border-primary text-primary hover:bg-primary/10 transition-colors"
                    >
                      Get Your Team&apos;s Customized Flight Plan!
                    </button>
                  )}
                </div>
                {error && (
                  <p className="text-destructive text-sm mt-4">
                    {error} — your answers are saved; try refreshing this page to retry.
                  </p>
                )}
              </>
            }
          />
        </motion.div>
      </div>
    </div>
  );
}
