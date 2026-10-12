import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSubmission } from "@/lib/nss/api";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { renderReportPdf } from "@/lib/nss/pdfRender";
import { getCachedReportPdf, cacheReportPdf } from "@/lib/nss/pdfStorage";
import { buildReportFileName } from "@/lib/nss/reportFilename";
import { notifyCrmLead } from "@/lib/nss/crm";

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

  const admin = createAdminClient();

  try {
    const [cachedPdf, profile] = await Promise.all([
      getCachedReportPdf(admin, submissionId),
      getMyProfile(supabase, submission.user_id).catch(() => null),
    ]);

    // A cache miss only happens for reports generated before this bucket
    // existed — render once here and backfill the cache for next time.
    let pdfBuffer = cachedPdf;
    if (!pdfBuffer) {
      const cookieStore = await cookies();
      const coverUrl = `${origin}/reports/${submissionId}/print/cover`;
      const bodyUrl = `${origin}/reports/${submissionId}/print?pdfMode=1`;
      pdfBuffer = await renderReportPdf({ coverUrl, bodyUrl, cookies: cookieStore.getAll() });
      await cacheReportPdf(admin, submissionId, pdfBuffer).catch((cacheError) =>
        console.warn("[generate-pdf] PDF cache failed:", cacheError),
      );
    }

    // First-touch only — matches the same pattern as the emailed link's
    // own download tracking, kept as a separate column so the two signals
    // (portal vs. email) don't collide into one timestamp. The CRM push is
    // nested in here too, on purpose — it should only fire once, the same
    // moment the local column is actually set, not on every repeat click.
    if (!submission.pdf_portal_downloaded_at) {
      const downloadedAt = new Date().toISOString();
      await admin
        .from("nss_submissions")
        .update({ pdf_portal_downloaded_at: downloadedAt })
        .eq("id", submissionId)
        .is("pdf_portal_downloaded_at", null);

      if (submission.user_email) {
        const firstName = profile?.first_name || submission.respondent_name.split(" ")[0];
        const lastName = profile?.last_name || "";
        const email = submission.user_email;
        // after() so this survives past the response below instead of
        // risking the function terminating mid-fetch on a bare
        // fire-and-forget call.
        after(() =>
          notifyCrmLead({ firstName, lastName, email, reportPortalDownloadedAt: downloadedAt }).catch(
            (crmError) => console.warn("[generate-pdf] CRM notify failed:", crmError),
          ),
        );
      }
    }

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
