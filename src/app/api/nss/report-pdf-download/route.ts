import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { getCachedReportPdf } from "@/lib/nss/pdfStorage";
import { buildReportFileName } from "@/lib/nss/reportFilename";
import { notifyCrmLead } from "@/lib/nss/crm";

// Unauthenticated on purpose — this is the link the respondent clicks from
// their inbox, which can't assume an active app session. pdf_download_token
// (a random value distinct from the submission id, which already appears
// in other URLs) is the only thing standing in for auth here, so a wrong or
// missing token is a flat 404 rather than anything that distinguishes
// "no such submission" from "wrong token."
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const submissionId = searchParams.get("id");
  const token = searchParams.get("token");
  if (!submissionId || !token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: submission, error } = await admin
    .from("nss_submissions")
    .select("id, user_id, user_email, respondent_name, updated_at, pdf_download_token, pdf_email_downloaded_at")
    .eq("id", submissionId)
    .maybeSingle();

  if (error || !submission || !submission.pdf_download_token || submission.pdf_download_token !== token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const pdfBuffer = await getCachedReportPdf(admin, submissionId);
  if (!pdfBuffer) {
    return NextResponse.json({ error: "Report not ready yet" }, { status: 404 });
  }

  const profile = await getMyProfile(admin, submission.user_id).catch(() => null);

  // nss_submissions keeps first-touch only (when they first got it,
  // unchanged below) — but the CRM gets notified on every download, not
  // just the first, since a lead going back for the report again is the
  // "still engaged" signal worth surfacing there.
  const downloadedAt = new Date().toISOString();
  if (!submission.pdf_email_downloaded_at) {
    await admin
      .from("nss_submissions")
      .update({ pdf_email_downloaded_at: downloadedAt })
      .eq("id", submissionId)
      .is("pdf_email_downloaded_at", null);
  }

  if (submission.user_email) {
    const firstName = profile?.first_name || (submission.respondent_name as string).split(" ")[0];
    const lastName = profile?.last_name || "";
    const email = submission.user_email as string;
    after(() =>
      notifyCrmLead({ firstName, lastName, email, reportEmailDownloadedAt: downloadedAt }).catch(
        (crmError) => console.warn("[report-pdf-download] CRM notify failed:", crmError),
      ),
    );
  }

  const fileName = `${buildReportFileName(
    profile?.first_name,
    profile?.last_name,
    submission.respondent_name as string,
    submission.updated_at as string,
  )}.pdf`;
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
