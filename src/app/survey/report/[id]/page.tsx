"use client";

import { use, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { getSubmission } from "@/lib/nss/api";
import { CALENDAR_URL } from "@/lib/nss/links";
import GlobalHeader from "@/components/GlobalHeader";
import MissionControlPitch from "@/components/reports/MissionControlPitch";

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
          <MissionControlPitch
            headline="Your personal needs report is generating, but that's just the beginning."
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
                  <button
                    onClick={handleScheduleCall}
                    className="h-12 px-8 text-base rounded-lg border border-border/50 hover:bg-secondary text-foreground transition-colors"
                  >
                    Get Your Team&apos;s Customized Flight Plan!
                  </button>
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
