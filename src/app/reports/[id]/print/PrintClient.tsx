"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getSubmission, type NssSubmission } from "@/lib/nss/api";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { buildReportFileName } from "@/lib/nss/reportFilename";
import ReportView from "@/components/reports/ReportView";

export default function PrintClient({ id }: { id: string }) {
  const searchParams = useSearchParams();
  // Skipped when a server-side headless browser is capturing this page for
  // an actual PDF file — window.print() is a browser-UI concept that
  // page.pdf() doesn't need at all, and triggering it there is just dead
  // weight (or worse, a dialog that never resolves).
  const isPdfCapture = searchParams.get("pdfMode") === "1";
  const [submission, setSubmission] = useState<NssSubmission | null>(null);
  const hasPrinted = useRef(false);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const row = await getSubmission(supabase, id);
      setSubmission(row);
    };
    load();
  }, [id]);

  useEffect(() => {
    if (!submission) return;
    const setTitle = async () => {
      const supabase = createClient();
      const profile = await getMyProfile(supabase, submission.user_id).catch(() => null);
      document.title = buildReportFileName(
        profile?.first_name,
        profile?.last_name,
        submission.respondent_name,
        submission.updated_at,
      );
    };
    setTitle();
  }, [submission]);

  useEffect(() => {
    if (isPdfCapture) return;
    if (submission?.report_data && !hasPrinted.current) {
      hasPrinted.current = true;
      setTimeout(() => window.print(), 200);
    }
  }, [submission, isPdfCapture]);

  if (!submission) return null;

  return (
    <div className="print-light min-h-screen bg-background py-8 px-4 print:p-0 print:bg-white">
      <div className="max-w-3xl mx-auto">
        {!isPdfCapture && (
          <div className="print:hidden mb-6 flex justify-end">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 text-sm font-medium border border-border/50 rounded-lg px-4 py-2 hover:bg-secondary transition-colors"
            >
              <Printer className="w-4 h-4" />
              Print / Save as PDF
            </button>
          </div>
        )}

        {!isPdfCapture && (
          <div className="mb-8 print:break-after-avoid">
            <Image src="/logo/bgb-line-all-color.png" alt="Boldly Go Beyond" width={198} height={20} className="mb-6" />
            <h1 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-1">Needs Signal Report</h1>
            <div className="flex items-baseline justify-between">
              <span className="text-lg md:text-xl font-semibold text-foreground">{submission.respondent_name}</span>
              <span className="text-muted-foreground text-base">
                {new Date(submission.updated_at).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
            <div className="h-0.5 bg-accent rounded-full mt-4" />
          </div>
        )}

        <ReportView
          reportData={submission.report_data}
          scores={submission.scores}
          respondentName={submission.respondent_name}
          pronouns={submission.pronouns}
          variant="plain"
        />
      </div>
    </div>
  );
}
