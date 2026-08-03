"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getSubmission, type NssSubmission } from "@/lib/nss/api";
import ReportView from "@/components/reports/ReportView";

export default function PrintClient({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const type = searchParams.get("type") === "manager" ? "manager" : "employee";

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

  const reportText = submission ? (type === "manager" ? submission.manager_report : submission.employee_report) : null;

  useEffect(() => {
    if (!submission) return;
    document.title = `${submission.respondent_name.replace(/\s+/g, "_")}_NSS_${
      type === "manager" ? "Manager" : "Employee"
    }_Report`;
  }, [submission, type]);

  useEffect(() => {
    if (reportText && !hasPrinted.current) {
      hasPrinted.current = true;
      setTimeout(() => window.print(), 200);
    }
  }, [reportText]);

  if (!submission) return null;

  const title =
    type === "manager"
      ? `Manager Report: Supporting ${submission.respondent_name}`
      : `Needs Signal Survey Report — ${submission.respondent_name}`;

  return (
    <div className="print-light min-h-screen bg-background py-8 px-4 print:p-0 print:bg-white">
      <div className="max-w-3xl mx-auto">
        <div className="print:hidden mb-6 flex justify-end">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 text-sm font-medium border border-border/50 rounded-lg px-4 py-2 hover:bg-secondary transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print / Save as PDF
          </button>
        </div>

        <div className="mb-8 print:break-after-avoid">
          <Image src="/logo/bgb-line-all-color.png" alt="Boldly Go Beyond" width={198} height={20} className="mb-6" />
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-1">{title}</h1>
          <p className="text-muted-foreground text-base">
            {new Date(submission.updated_at).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
          <div className="h-0.5 bg-gradient-to-r from-primary to-accent rounded-full mt-4" />
        </div>

        <ReportView reportText={reportText} type={type} variant="plain" />
      </div>
    </div>
  );
}
