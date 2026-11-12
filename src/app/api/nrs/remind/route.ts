import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimAndSendReminder } from "@/lib/nrs/reminder";
import { sendNrsReminderEmail } from "@/lib/nrs/nrsReminderEmail";
import { getPublicOrigin } from "@/lib/publicOrigin";
import type { ClusterKey } from "@/lib/nss/clusters";
import { getAdminTestEmail } from "@/lib/internalEmail";
import { fakePreviewToken } from "@/lib/previewToken";

// Admin-only. Sends the reminder to one invited-but-incomplete
// participant. See claimAndSendReminder for the repeated-click guard —
// this route itself is a thin wrapper around it. `test: true` previews
// this participant's real, personalized reminder without touching
// last_reminder_at or any other state — it deliberately bypasses
// claimAndSendReminder (whose whole job is to claim-and-mutate that
// cooldown) and reads the submission read-only instead. The link is a
// fake, never-persisted token, never the participant's real one, so a
// tester can never act on their behalf.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const origin = getPublicOrigin(request);
  const { submissionId, test } = await request.json();
  if (!submissionId) {
    return NextResponse.json({ error: "submissionId is required" }, { status: 400 });
  }

  if (test === true) {
    const adminClient = createAdminClient();
    const { data: submission, error } = await adminClient
      .from("nrs_submissions")
      .select("id, cluster_key, team_roster(first_name, last_name)")
      .eq("id", submissionId)
      .maybeSingle();
    if (error || !submission) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const roster = Array.isArray(submission.team_roster) ? submission.team_roster[0] : submission.team_roster;
    if (!roster) return NextResponse.json({ error: "Roster member not found" }, { status: 404 });

    const sendResult = await sendNrsReminderEmail({
      to: getAdminTestEmail(),
      firstName: roster.first_name,
      clusterKey: submission.cluster_key as ClusterKey,
      assessmentUrl: `${origin}/nrs/${fakePreviewToken()}`,
      logoUrl: `${origin}/logo/bgb-line-almond.png`,
      submissionId: submission.id,
      test: true,
      testParticipantLabel: `${roster.first_name} ${roster.last_name}`,
    });
    return NextResponse.json({ skipped: false, outcome: sendResult.outcome });
  }

  const result = await claimAndSendReminder(submissionId, origin, admin.userId);
  return NextResponse.json(result);
}
