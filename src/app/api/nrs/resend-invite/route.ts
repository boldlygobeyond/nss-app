import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNrsInviteEmail } from "@/lib/nrs/nrsInviteEmail";
import { logNrsSend } from "@/lib/nrs/sendLog";
import { getPublicOrigin } from "@/lib/publicOrigin";
import type { ClusterKey } from "@/lib/nss/clusters";
import { getAdminTestEmail } from "@/lib/internalEmail";
import { fakePreviewToken } from "@/lib/previewToken";

// Admin-only. An intentional resend to an already-invited, incomplete
// participant — reuses the submission's existing access_token (never
// regenerates it), and re-resolves the current name/email from the
// roster join at send time, so a corrected email address is picked up
// automatically rather than requiring a separate "edit roster" step
// first. `test: true` previews this participant's real, personalized
// email without re-sending to them or touching any state — the link is a
// fake, never-persisted token (never the participant's real one, even
// though it exists here) so a tester can never act on their behalf.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const origin = getPublicOrigin(request);
  const { submissionId, test } = await request.json();
  if (!submissionId) {
    return NextResponse.json({ error: "submissionId is required" }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data: submission, error } = await adminClient
    .from("nrs_submissions")
    .select(
      "id, access_token, status, cluster_key, team_roster(first_name, last_name, email, attended_see_the_signals_at)",
    )
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

  if (test === true) {
    const sendResult = await sendNrsInviteEmail({
      to: getAdminTestEmail(),
      clusterKey: submission.cluster_key as ClusterKey,
      assessmentUrl: `${origin}/nrs/${fakePreviewToken()}`,
      logoUrl: `${origin}/logo/bgb-line-almond.png`,
      submissionId: submission.id,
      test: true,
      testParticipantLabel: `${roster.first_name} ${roster.last_name}`,
    });
    return NextResponse.json({ outcome: sendResult.outcome });
  }

  if (!roster.attended_see_the_signals_at) {
    return NextResponse.json(
      { error: "Hasn't attended See the Signals yet — check them off on the Roster tab first" },
      { status: 400 },
    );
  }

  const sendResult = await sendNrsInviteEmail({
    to: roster.email,
    clusterKey: submission.cluster_key as ClusterKey,
    assessmentUrl: `${origin}/nrs/${submission.access_token}`,
    logoUrl: `${origin}/logo/bgb-line-almond.png`,
    submissionId: submission.id,
  });
  await logNrsSend({ submissionId: submission.id, emailType: "invitation", outcome: sendResult, sentBy: admin.userId });

  return NextResponse.json({ outcome: sendResult.outcome });
}
