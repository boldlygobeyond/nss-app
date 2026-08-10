import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildReportPrompt } from "@/lib/nss/reportPrompts";
import { archiveReportToDrive } from "@/lib/nss/googleDrive";
import { renderUrlToPdf } from "@/lib/nss/pdfRender";
import { computePairwiseMatchups, type TopNeed } from "@/lib/nss/surveyEngine";
import type { ReportData } from "@/lib/nss/reportTypes";

export const maxDuration = 90;

const REPORT_SYSTEM_PROMPT =
  "Output only the requested JSON object. " +
  "Do not include markdown code fences, internal/system XML tags, preamble, or any commentary before or after the JSON.";

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  // The model occasionally emits a trailing comma before a closing bracket
  // (valid in JS/TS, not in JSON) — strip it rather than fail the whole
  // generation over one stray character.
  const repaired = candidate.replace(/,(\s*[\]}])/g, "$1");
  return JSON.parse(repaired);
}

export async function POST(request: Request) {
  const { origin } = new URL(request.url);
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

  if (!force && submission.report_data) {
    return NextResponse.json({ report_data: submission.report_data });
  }

  const firstName = (submission.respondent_name as string).split(" ")[0];
  const anthropic = new Anthropic();

  try {
    const { data: responses, error: responsesError } = await supabase
      .from("nss_responses")
      .select("chosen_clusters, rejected_clusters")
      .eq("submission_id", submissionId);
    if (responsesError) throw responsesError;

    const matchups = computePairwiseMatchups(responses ?? []);

    const prompt = buildReportPrompt({
      firstName,
      respondentName: submission.respondent_name as string,
      pronouns: (submission.pronouns as string) || "they/them",
      topNeeds,
      matchups,
    });

    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      thinking: { type: "disabled" },
      output_config: { effort: "high" },
      system: REPORT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "Report generation was declined" }, { status: 502 });
    }

    const rawText = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    let reportData: ReportData;
    try {
      const parsed = extractJson(rawText) as ReportData;
      // Defensive against the model occasionally over/under-shooting an
      // array length despite explicit counts in the prompt — clamp rather
      // than let a stray extra card break the fixed layout.
      reportData = {
        ...parsed,
        choiceInsights: parsed.choiceInsights?.slice(0, 3) ?? [],
        rippleChain: parsed.rippleChain?.slice(0, 3) ?? [],
        signals: parsed.signals?.slice(0, 3) ?? [],
        managerInsights: parsed.managerInsights?.slice(0, 4) ?? [],
      };
    } catch (parseError) {
      console.error("[generate-reports] Failed to parse report JSON:", parseError, rawText);
      return NextResponse.json({ error: "Report generation returned an unexpected format" }, { status: 502 });
    }

    const { error: updateError } = await supabase
      .from("nss_submissions")
      .update({ report_data: reportData, status: "report_generated" })
      .eq("id", submissionId);

    if (updateError) throw updateError;

    if (submission.user_email) {
      try {
        const cookieStore = await cookies();
        const printUrl = `${origin}/reports/${submissionId}/print?pdfMode=1`;
        const pdfBuffer = await renderUrlToPdf(printUrl, cookieStore.getAll());
        const archived = await archiveReportToDrive({
          userEmail: submission.user_email as string,
          pdfBuffer,
        });
        await supabase
          .from("nss_submissions")
          .update({ pdf_url: archived.pdfUrl, pdf_drive_id: archived.pdfDriveId })
          .eq("id", submissionId);
      } catch (driveError) {
        // Best-effort — Drive archival is a backup copy, not required for the
        // in-app report to work, so don't fail the request over it.
        console.warn("[generate-reports] Drive archive failed:", driveError);
      }
    }

    return NextResponse.json({ report_data: reportData });
  } catch (error) {
    console.error("[generate-reports]", error);
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 });
  }
}
