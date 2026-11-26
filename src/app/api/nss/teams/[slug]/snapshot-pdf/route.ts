import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderReportPdf } from "@/lib/nss/pdfRender";

export const maxDuration = 60;

// Unlike the individual Needs Signal Report PDF (generate-pdf/route.ts),
// this is never cached — a team's snapshot changes every time someone new
// completes the survey, so each download renders fresh against current
// data rather than risking a stale capture.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { slug } = await params;
  const { origin } = new URL(request.url);

  const adminClient = createAdminClient();
  const { data: team } = await adminClient.from("teams").select("name").eq("slug", slug).maybeSingle();
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  try {
    const cookieStore = await cookies();
    const printUrl = `${origin}/admin/teams/${slug}/snapshot-print`;
    const pdfBuffer = await renderReportPdf({
      url: printUrl,
      cookies: cookieStore.getAll(),
      waitForSelector: '[data-ready="true"]',
      margin: { top: "0.5in", bottom: "0.7in", left: "0.65in", right: "0.65in" },
      landscape: true,
      matchViewportToPage: true,
    });

    const dateStr = new Date()
      .toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
      .replace(/\//g, "-");
    const fileName = `${team.name} - Needs Snapshot ${dateStr}.pdf`;
    const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    console.error("[snapshot-pdf]", error);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  }
}
