"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getSubmission, type NssSubmission } from "@/lib/nss/api";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { buildFullName, buildReportFileName } from "@/lib/nss/reportFilename";
import { CALENDAR_URL, FLIGHT_PLAN_EMAIL, FLIGHT_PLAN_MAILTO } from "@/lib/nss/links";
import ReportView from "@/components/reports/ReportView";
import ReportClosingPage from "@/components/reports/ReportClosingPage";

export default function PrintClient({ id }: { id: string }) {
  const searchParams = useSearchParams();
  // Skipped when a server-side headless browser is capturing this page for
  // an actual PDF file — window.print() is a browser-UI concept that
  // page.pdf() doesn't need at all, and triggering it there is just dead
  // weight (or worse, a dialog that never resolves).
  const isPdfCapture = searchParams.get("pdfMode") === "1";
  const [submission, setSubmission] = useState<NssSubmission | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
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
    const loadProfile = async () => {
      const supabase = createClient();
      const profile = await getMyProfile(supabase, submission.user_id).catch(() => null);
      setFullName(buildFullName(profile?.first_name, profile?.last_name, submission.respondent_name));
      document.title = buildReportFileName(
        profile?.first_name,
        profile?.last_name,
        submission.respondent_name,
        submission.updated_at,
      );
    };
    loadProfile();
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
              <span className="text-lg md:text-xl font-semibold text-foreground">{fullName ?? submission.respondent_name}</span>
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
          firstName={submission.respondent_name}
          pronouns={submission.pronouns}
          variant="plain"
          forPdf
        />

        <div className="mt-10 print:mt-0 print:break-before-page">
          <Image
            src="/logo/bgb-line-all-color.png"
            alt="Boldly Go Beyond"
            width={198}
            height={20}
            priority
            className="hidden print:block mx-auto mb-6"
          />
          <ReportClosingPage
            cta={
              <div className="flex flex-col items-center gap-3">
                <a
                  href={CALENDAR_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-12 px-8 text-base rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-colors inline-flex items-center justify-center"
                >
                  Get Your Team&apos;s Customized Flight Plan!
                </a>
                <p className="text-sm text-muted-foreground">
                  Or reach out to{" "}
                  <a href={FLIGHT_PLAN_MAILTO} className="text-primary font-medium hover:underline">
                    {FLIGHT_PLAN_EMAIL}
                  </a>{" "}
                  directly to get the conversation started.
                </p>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
