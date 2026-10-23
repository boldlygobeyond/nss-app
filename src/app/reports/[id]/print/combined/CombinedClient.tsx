"use client";

// PDF capture target — cover immediately followed by the report body in
// one page load, so renderReportPdf() (pdfRender.ts) can do a single
// page.pdf() call: one physical margin, one footerTemplate, naturally
// sequential page numbers from page 1 on. Replaces the old two-capture
// (cover + body) + pdf-lib-merge approach, which existed only to give the
// cover zero footer — now that the cover has a real footer too, splitting
// the capture serves no purpose and was the direct cause of both halves
// independently starting their page count at 1.
//
// Not meant to be visited by a person — /reports/[id] (on-screen) and
// /reports/[id]/print (the print-button-driven browser-print view) are
// the human-facing routes; this one exists purely for Puppeteer.

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { getSubmission, type NssSubmission } from "@/lib/nss/api";
import { CALENDAR_URL, FLIGHT_PLAN_EMAIL, FLIGHT_PLAN_MAILTO } from "@/lib/nss/links";
import CoverClient from "../cover/CoverClient";
import ReportView from "@/components/reports/ReportView";
import ReportClosingPage from "@/components/reports/ReportClosingPage";

export default function CombinedClient({ id }: { id: string }) {
  const [submission, setSubmission] = useState<NssSubmission | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const row = await getSubmission(supabase, id);
      setSubmission(row);
    };
    load();
  }, [id]);

  if (!submission) return null;

  return (
    <div className="print-light bg-white">
      <CoverClient id={id} />

      <div className="max-w-3xl mx-auto px-4 print:p-0">
        <ReportView
          reportData={submission.report_data}
          scores={submission.scores}
          firstName={submission.respondent_name}
          pronouns={submission.pronouns}
          variant="plain"
          forPdf
        />

        {/* Leads get the sales-pitch closing page; team/pilot members
            don't — same condition PrintClient.tsx (the human-facing print
            view) already uses, kept identical here. */}
        {!submission.team && (
          <div className="mt-10 print:mt-0 print:break-before-page">
            <Image
              src="/logo/bgb-line-all-color.png"
              alt="Boldly Go Beyond"
              width={198}
              height={20}
              priority
              className="mx-auto mb-6"
            />
            <ReportClosingPage
              cta={
                <div className="flex flex-col items-center gap-3">
                  <a
                    href={CALENDAR_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-12 px-8 text-base rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground shadow-md print:shadow-none transition-colors inline-flex items-center justify-center"
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
        )}
      </div>
    </div>
  );
}
