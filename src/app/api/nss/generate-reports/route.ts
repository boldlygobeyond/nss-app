import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildEmployeePrompt, buildManagerPrompt } from "@/lib/nss/reportPrompts";
import { archiveReportsToDrive } from "@/lib/nss/googleDrive";
import type { TopNeed } from "@/lib/nss/surveyEngine";

const REPORT_SYSTEM_PROMPT =
  "Output only the requested report content in the exact structure specified. " +
  "Do not include internal or system XML tags in your response. " +
  "Do not add any preamble, meta-commentary, or explanation of what you are doing.";

export async function POST(request: Request) {
  const { submissionId, force } = await request.json();
  if (!submissionId) {
    return NextResponse.json({ error: "submissionId required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: submission, error: fetchError } = await supabase
    .from("nss_submissions")
    .select("*")
    .eq("id", submissionId)
    .single();

  if (fetchError || !submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  const topNeeds = submission.top_needs as TopNeed[] | null;
  if (!topNeeds || topNeeds.length < 3) {
    return NextResponse.json({ error: "Submission has no scored results yet" }, { status: 400 });
  }

  if (!force && submission.employee_report && submission.manager_report) {
    return NextResponse.json({
      employee_report: submission.employee_report,
      manager_report: submission.manager_report,
    });
  }

  const firstName = (submission.respondent_name as string).split(" ")[0];
  const anthropic = new Anthropic();

  try {
    const [employeeResponse, managerResponse] = await Promise.all([
      anthropic.messages.create({
        model: "claude-opus-5",
        max_tokens: 4096,
        thinking: { type: "disabled" },
        output_config: { effort: "high" },
        system: REPORT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildEmployeePrompt(firstName, topNeeds) }],
      }),
      anthropic.messages.create({
        model: "claude-opus-5",
        max_tokens: 4096,
        thinking: { type: "disabled" },
        output_config: { effort: "high" },
        system: REPORT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildManagerPrompt(
              firstName,
              submission.respondent_name as string,
              (submission.pronouns as string) || "they/them",
              topNeeds,
            ),
          },
        ],
      }),
    ]);

    if (employeeResponse.stop_reason === "refusal" || managerResponse.stop_reason === "refusal") {
      return NextResponse.json({ error: "Report generation was declined" }, { status: 502 });
    }

    const employeeText = employeeResponse.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const managerText = managerResponse.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const { error: updateError } = await supabase
      .from("nss_submissions")
      .update({
        employee_report: employeeText,
        manager_report: managerText,
        status: "report_generated",
      })
      .eq("id", submissionId);

    if (updateError) throw updateError;

    if (submission.user_email) {
      try {
        const archived = await archiveReportsToDrive({
          userEmail: submission.user_email as string,
          respondentName: submission.respondent_name as string,
          employeeText,
          managerText,
        });
        await supabase
          .from("nss_submissions")
          .update({
            employee_pdf_url: archived.employeePdfUrl,
            employee_pdf_drive_id: archived.employeePdfDriveId,
            manager_pdf_url: archived.managerPdfUrl,
            manager_pdf_drive_id: archived.managerPdfDriveId,
          })
          .eq("id", submissionId);
      } catch (driveError) {
        // Best-effort — Drive archival is a backup copy, not required for the
        // in-app report to work, so don't fail the request over it.
        console.warn("[generate-reports] Drive archive failed:", driveError);
      }
    }

    return NextResponse.json({ employee_report: employeeText, manager_report: managerText });
  } catch (error) {
    console.error("[generate-reports]", error);
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 });
  }
}
