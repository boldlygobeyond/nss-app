import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/nss/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTeamClusterLocked } from "@/lib/nrs/scenarioSelection";
import type { ClusterKey } from "@/lib/nss/clusters";

// Admin-only. Saves (or replaces) a team's 10-scenario selection for one
// cluster. The DB (0025's trigger + check constraint) re-validates
// everything here independently — this route's own checks exist purely
// to give the admin a clear, specific error instead of a raw constraint
// violation.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const { teamId, clusterKey, questionIds } = await request.json();
  if (!teamId || !clusterKey || !Array.isArray(questionIds)) {
    return NextResponse.json({ error: "teamId, clusterKey, and a questionIds array are required" }, { status: 400 });
  }

  const distinctIds = [...new Set(questionIds)];
  if (distinctIds.length !== 10 || distinctIds.some((id) => typeof id !== "number")) {
    return NextResponse.json({ error: "Select exactly 10 distinct scenarios before saving." }, { status: 400 });
  }

  const locked = await isTeamClusterLocked(teamId, clusterKey as ClusterKey);
  if (locked) {
    return NextResponse.json(
      { error: "This selection is locked because invitations have already been sent for this team and cluster." },
      { status: 409 },
    );
  }

  const adminClient = createAdminClient();
  const { data: validQuestions, error: qError } = await adminClient
    .from("nrs_questions")
    .select("id")
    .eq("cluster_key", clusterKey)
    .in("id", distinctIds);
  if (qError) {
    return NextResponse.json({ error: qError.message }, { status: 500 });
  }
  if ((validQuestions ?? []).length !== 10) {
    return NextResponse.json(
      { error: "One or more selected scenarios don't belong to this cluster." },
      { status: 400 },
    );
  }

  const { data, error } = await adminClient
    .from("nrs_team_cluster_scenarios")
    .upsert({ team_id: teamId, cluster_key: clusterKey, question_ids: distinctIds }, { onConflict: "team_id,cluster_key" })
    .select("question_ids")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ questionIds: data.question_ids });
}
