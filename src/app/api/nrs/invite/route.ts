import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNrsSubmission } from "@/lib/nrs/submission";
import { sendNrsInviteEmail } from "@/lib/nrs/nrsInviteEmail";
import { logNrsSend } from "@/lib/nrs/sendLog";
import { getSelectedQuestionIds } from "@/lib/nrs/scenarioSelection";
import type { ClusterKey } from "@/lib/nss/clusters";
import { getPublicOrigin } from "@/lib/publicOrigin";

// Admin-only. One route for both "Individual Send" (a single-element
// rosterIds) and "Send to All" (every not-yet-invited id) — a single code
// path for the duplicate-submission handling, synchronous/awaited so the
// admin sees a real per-recipient success/failure outcome, same pattern
// as /api/nss/team-invite.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const origin = getPublicOrigin(request);
  const { teamSlug, clusterKey, rosterIds } = await request.json();
  if (!teamSlug?.trim() || !clusterKey || !Array.isArray(rosterIds) || rosterIds.length === 0) {
    return NextResponse.json(
      { error: "teamSlug, clusterKey, and a non-empty rosterIds array are required" },
      { status: 400 },
    );
  }

  const adminClient = createAdminClient();
  const { data: team, error: teamError } = await adminClient
    .from("teams")
    .select("id")
    .eq("slug", teamSlug.trim())
    .maybeSingle();
  if (teamError || !team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const questionIds = await getSelectedQuestionIds(team.id, clusterKey as ClusterKey);
  if (!questionIds) {
    return NextResponse.json(
      { error: "Select and save 10 scenarios for this cluster before sending invitations." },
      { status: 400 },
    );
  }

  // Re-confirms every requested id actually belongs to THIS team's
  // roster — a requested id outside it is dropped, not attempted.
  const { data: rosterRows, error: rosterError } = await adminClient
    .from("team_roster")
    .select("id, first_name, email")
    .eq("team_id", team.id)
    .in("id", rosterIds);
  if (rosterError) {
    return NextResponse.json({ error: rosterError.message }, { status: 500 });
  }

  const logoUrl = `${origin}/logo/bgb-line-almond.png`;
  const results: { rosterId: string; outcome: string; error?: string }[] = [];

  for (const roster of rosterRows ?? []) {
    try {
      const { id: submissionId, accessToken } = await createNrsSubmission({
        rosterId: roster.id,
        clusterKey: clusterKey as ClusterKey,
      });
      const assessmentUrl = `${origin}/nrs/${accessToken}`;
      const sendResult = await sendNrsInviteEmail({ to: roster.email, assessmentUrl, logoUrl, submissionId });
      await logNrsSend({ submissionId, emailType: "invitation", outcome: sendResult, sentBy: admin.userId });
      results.push({ rosterId: roster.id, outcome: sendResult.outcome });
    } catch (error) {
      results.push({
        rosterId: roster.id,
        outcome: "failed",
        error: error instanceof Error ? error.message : "Could not send invitation",
      });
    }
  }

  const foundIds = new Set((rosterRows ?? []).map((r) => r.id));
  (rosterIds as string[])
    .filter((id) => !foundIds.has(id))
    .forEach((id) => results.push({ rosterId: id, outcome: "failed", error: "Not found on this team's roster" }));

  return NextResponse.json({ results });
}
