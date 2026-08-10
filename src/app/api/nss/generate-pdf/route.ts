import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSubmission } from "@/lib/nss/api";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { renderUrlToPdf } from "@/lib/nss/pdfRender";
import { buildReportFileName } from "@/lib/nss/reportFilename";

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const submissionId = searchParams.get("id");
  if (!submissionId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const submission = await getSubmission(supabase, submissionId);
  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  const cookieStore = await cookies();
  const printUrl = `${origin}/reports/${submissionId}/print?pdfMode=1`;

  try {
    const [pdfBuffer, profile] = await Promise.all([
      renderUrlToPdf(printUrl, cookieStore.getAll()),
      getMyProfile(supabase, submission.user_id).catch(() => null),
    ]);
    const fileName = `${buildReportFileName(
      profile?.first_name,
      profile?.last_name,
      submission.respondent_name,
      submission.updated_at,
    )}.pdf`;
    const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    console.error("[generate-pdf]", error);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  }
}
