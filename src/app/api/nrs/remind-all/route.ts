import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimAndSendReminder } from "@/lib/nrs/reminder";
import { getPublicOrigin } from "@/lib/publicOrigin";

// Admin-only. Sends the reminder to every invited-but-incomplete
// participant on this team, for this cluster. The server resolves the
// eligible set itself rather than trusting a client-supplied list, then
// reuses the exact same per-submission guard the single-recipient remind
// route uses, so a participant who was already reminded in the last
// minute (e.g. by an admin double-clicking "Remind All") is skipped, not
// re-sent.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const origin = getPublicOrigin(request);
  const { teamSlug, clusterKey } = await request.json();
  if (!teamSlug?.trim() || !clusterKey) {
    return NextResponse.json({ error: "teamSlug and clusterKey are required" }, { status: 400 });
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

  const { data: eligible, error: eligibleError } = await adminClient
    .from("nrs_submissions")
    .select("id, team_roster!inner(team_id)")
    .eq("cluster_key", clusterKey)
    .in("status", ["invited", "in_progress"])
    .eq("team_roster.team_id", team.id);
  if (eligibleError) {
    return NextResponse.json({ error: eligibleError.message }, { status: 500 });
  }

  const results: { submissionId: string; skipped: boolean; outcome?: string; reason?: string }[] = [];
  for (const submission of eligible ?? []) {
    const result = await claimAndSendReminder(submission.id, origin);
    results.push(
      result.skipped
        ? { submissionId: submission.id, skipped: true, reason: result.reason }
        : { submissionId: submission.id, skipped: false, outcome: result.outcome },
    );
  }

  return NextResponse.json({ results });
}
