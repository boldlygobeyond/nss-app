"use client";

import { useCallback, useEffect, useState, use } from "react";
import { Printer, RefreshCw, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getSubmission, type NssSubmission } from "@/lib/nss/api";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { buildFullName } from "@/lib/nss/reportFilename";
import GlobalHeader from "@/components/GlobalHeader";
import ReportView from "@/components/reports/ReportView";

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [submission, setSubmission] = useState<NssSubmission | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownloadPdf = useCallback(async () => {
    setDownloadingPdf(true);
    setError(null);
    try {
      const res = await fetch(`/api/nss/generate-pdf?id=${id}`);
      if (!res.ok) throw new Error("PDF generation failed");

      // The server decides the filename (it has access to the profile data
      // needed to build it) — pull it from the response instead of
      // re-deriving it here, so there's one source of truth.
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF generation failed");
    } finally {
      setDownloadingPdf(false);
    }
  }, [id, submission]);

  const generateReport = useCallback(
    async (row: NssSubmission, force: boolean) => {
      setGenerating(true);
      setError(null);
      try {
        const res = await fetch("/api/nss/generate-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submissionId: id, force }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Report generation failed");
        setSubmission({ ...row, report_data: body.report_data });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Report generation failed");
      } finally {
        setGenerating(false);
      }
    },
    [id],
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const supabase = createClient();
      const [{ data: userData }, row] = await Promise.all([supabase.auth.getUser(), getSubmission(supabase, id)]);
      if (cancelled) return;

      const owner = !!row && row.user_id === userData.user?.id;
      setIsOwner(owner);
      setSubmission(row);

      if (row) {
        const profile = await getMyProfile(supabase, row.user_id).catch(() => null);
        if (!cancelled) setFullName(buildFullName(profile?.first_name, profile?.last_name, row.respondent_name));
      }

      // Only auto-generate on behalf of the report's own owner — a manager
      // viewing a not-yet-generated subordinate report shouldn't trigger
      // (and silently fail to save) a generation run for someone else.
      // Also re-triggers for report_data that's missing or saved under an
      // older schema version (missing rippleChain) so a shape change here
      // self-heals instead of leaving stale rows permanently broken —
      // status can be "report_generated" from the old employee/manager-
      // report era (report_data didn't exist yet), not just "completed".
      if (
        owner &&
        row &&
        (!row.report_data || !row.report_data.rippleChain) &&
        row.status !== "in_progress"
      ) {
        generateReport(row, true);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GlobalHeader />

      {!submission ? null : generating ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
          <h2 className="font-heading text-2xl font-semibold text-foreground mb-2">
            Generating your personalized report...
          </h2>
          <p className="text-muted-foreground mb-1">This could take a few minutes.</p>
          <p className="text-destructive text-sm font-medium mb-6">Don&apos;t leave this page while your report is generating.</p>
          <div className="w-8 h-8 border-4 border-secondary border-t-primary rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <p className="text-destructive">{error}</p>
        </div>
      ) : !isOwner && !submission.report_data ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <p className="text-muted-foreground">This person hasn&apos;t generated their report yet.</p>
        </div>
      ) : (
        <div className="max-w-3xl mx-auto w-full px-6 py-8 relative">
          <div className="flex lg:hidden gap-2 justify-end mb-4">
            <button
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="flex items-center gap-1.5 text-xs font-medium border border-border/50 rounded-lg px-3 py-1.5 hover:bg-secondary transition-colors disabled:opacity-50"
            >
              {downloadingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              {downloadingPdf ? "Preparing..." : "Download PDF"}
            </button>
            {isOwner && (
              <button
                onClick={() => generateReport(submission, true)}
                className="flex items-center gap-1.5 text-xs font-medium border border-border/50 rounded-lg px-3 py-1.5 hover:bg-secondary transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Regenerate
              </button>
            )}
          </div>

          <div className="hidden lg:flex lg:flex-col lg:gap-2 lg:absolute lg:left-full lg:ml-6 lg:top-8 lg:w-36">
            <button
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="flex items-center gap-1.5 text-xs font-medium border border-border/50 rounded-lg px-3 py-1.5 hover:bg-secondary transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {downloadingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              {downloadingPdf ? "Preparing..." : "Download PDF"}
            </button>
            {isOwner && (
              <button
                onClick={() => generateReport(submission, true)}
                className="flex items-center gap-1.5 text-xs font-medium border border-border/50 rounded-lg px-3 py-1.5 hover:bg-secondary transition-colors whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Regenerate
              </button>
            )}
          </div>

          <div className="mb-8">
            <h1 className="font-heading text-2xl md:text-3xl font-bold text-foreground">Needs Signal Report</h1>
            <div className="flex items-baseline justify-between mt-1 mb-4">
              <span className="text-lg md:text-xl font-semibold text-foreground">{fullName ?? submission.respondent_name}</span>
              <span className="text-muted-foreground text-base">
                {new Date(submission.updated_at).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
            <div className="h-0.5 bg-accent rounded-full" />
          </div>

          <ReportView
            reportData={submission.report_data}
            scores={submission.scores}
            firstName={submission.respondent_name}
            pronouns={submission.pronouns}
          />
        </div>
      )}
    </div>
  );
}
