import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNrsInviteEmail } from "@/lib/nrs/nrsInviteEmail";
import { logNrsSend } from "@/lib/nrs/sendLog";

// Admin-only. An intentional resend to an already-invited, incomplete
// participant — reuses the submission's existing access_token (never
// regenerates it), and re-resolves the current name/email from the
// roster join at send time, so a corrected email address is picked up
// automatically rather than requiring a separate "edit roster" step
// first.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { origin } = new URL(request.url);
  const { submissionId } = await request.json();
  if (!submissionId) {
    return NextResponse.json({ error: "submissionId is required" }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: submission, error } = await adminClient
    .from("nrs_submissions")
    .select("id, access_token, status, team_roster(first_name, email)")
    .eq("id", submissionId)
    .maybeSingle();
  if (error || !submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (submission.status === "completed") {
    return NextResponse.json({ error: "This participant has already completed this scan" }, { status: 400 });
  }

  const roster = Array.isArray(submission.team_roster) ? submission.team_roster[0] : submission.team_roster;
  if (!roster) {
    return NextResponse.json({ error: "Roster member not found" }, { status: 404 });
  }

  const sendResult = await sendNrsInviteEmail({
    to: roster.email,
    assessmentUrl: `${origin}/nrs/${submission.access_token}`,
    logoUrl: `${origin}/logo/bgb-line-almond.png`,
    submissionId: submission.id,
  });
  await logNrsSend({ submissionId: submission.id, emailType: "invitation", outcome: sendResult });

  return NextResponse.json({ outcome: sendResult.outcome });
}
