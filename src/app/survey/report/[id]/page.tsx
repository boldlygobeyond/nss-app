"use client";

import { use, useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { getSubmission, type NssSubmission } from "@/lib/nss/api";
import { CALENDAR_URL } from "@/lib/nss/links";
import GlobalHeader from "@/components/GlobalHeader";
import MissionControlPitch from "@/components/reports/MissionControlPitch";

export default function SurveyReportGeneratingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [submission, setSubmission] = useState<NssSubmission | null>(null);
  const [isReportReady, setIsReportReady] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const supabase = createClient();
      const row = await getSubmission(supabase, id);
      if (cancelled) return;
      setSubmission(row);

      if (row?.report_data) {
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

  const handleDownloadPdf = useCallback(async () => {
    setDownloadingPdf(true);
    try {
      const res = await fetch(`/api/nss/generate-pdf?id=${id}`);
      if (!res.ok) throw new Error("PDF generation failed");

      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/) ?? disposition.match(/filename="([^"]+)"/);
      const fileName = match ? decodeURIComponent(match[1]) : `${submission?.respondent_name ?? "NSS"}_Report.pdf`;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF generation failed");
    } finally {
      setDownloadingPdf(false);
    }
  }, [id, submission]);

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
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-center">
          <p className="text-center text-sm font-medium">
            {isReportReady ? (
              <>
                Your report is ready! Review your insights below or{" "}
                <button
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="underline underline-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  download your PDF
                </button>
                .
              </>
            ) : (
              "Your personal needs report is generating..."
            )}
          </p>
        </div>
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
