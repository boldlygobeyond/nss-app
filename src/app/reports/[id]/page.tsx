"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { User, Users, Printer, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getSubmission, type NssSubmission } from "@/lib/nss/api";
import GlobalHeader from "@/components/GlobalHeader";
import ReportView from "@/components/reports/ReportView";

export default function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const [submission, setSubmission] = useState<NssSubmission | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"employee" | "manager">(
    searchParams.get("tab") === "manager" ? "manager" : "employee",
  );

  // A manager viewing a subordinate's report only ever sees the manager
  // version — never the subordinate's personal, first-person report.
  const effectiveTab = isOwner ? tab : "manager";

  const generateReports = useCallback(
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
        setSubmission({ ...row, employee_report: body.employee_report, manager_report: body.manager_report });
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

      // Only auto-generate on behalf of the report's own owner — a manager
      // viewing a not-yet-generated subordinate report shouldn't trigger
      // (and silently fail to save) a generation run for someone else.
      if (owner && row && !row.employee_report && row.status === "completed") {
        generateReports(row, false);
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
      ) : !isOwner && !submission.manager_report ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <p className="text-muted-foreground">This person hasn&apos;t generated their report yet.</p>
        </div>
      ) : (
        <div className="max-w-3xl mx-auto w-full px-6 py-8">
          <div className="flex items-center justify-between border-b border-border/50 mb-8">
            <div className="flex items-center gap-1">
              {isOwner && (
                <button
                  onClick={() => setTab("employee")}
                  className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    effectiveTab === "employee"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <User className="w-4 h-4" />
                  Your Report
                </button>
              )}
              <button
                onClick={() => setTab("manager")}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  effectiveTab === "manager"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Users className="w-4 h-4" />
                Share with Your Manager
              </button>
            </div>
            <div className="flex gap-2 mb-2 shrink-0">
              {isOwner && (
                <button
                  onClick={() => generateReports(submission, true)}
                  className="flex items-center gap-1.5 text-xs font-medium border border-border/50 rounded-lg px-3 py-1.5 hover:bg-secondary transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Regenerate
                </button>
              )}
              <Link
                href={`/reports/${id}/print?type=${effectiveTab}`}
                target="_blank"
                className="flex items-center gap-1.5 text-xs font-medium border border-border/50 rounded-lg px-3 py-1.5 hover:bg-secondary transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                Download PDF
              </Link>
            </div>
          </div>

          <ReportView
            reportText={effectiveTab === "employee" ? submission.employee_report : submission.manager_report}
            type={effectiveTab}
          />
        </div>
      )}
    </div>
  );
}
