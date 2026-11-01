import { createAdminClient } from "@/lib/supabase/admin";
import type { ClusterKey } from "@/lib/nss/clusters";

// The 10 question ids a team has selected for a cluster, or null if no
// valid selection has been saved yet. The sole source of truth for "which
// 10 scenarios does this team's cluster actually use" — every
// participant-facing read (the assessment page, submission scoring) and
// every admin read (drill-down, team snapshot) goes through this, never a
// raw "all scenarios in this cluster" query, since a cluster can hold up
// to 30.
export async function getSelectedQuestionIds(teamId: string, clusterKey: ClusterKey): Promise<number[] | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("nrs_team_cluster_scenarios")
    .select("question_ids")
    .eq("team_id", teamId)
    .eq("cluster_key", clusterKey)
    .maybeSingle();
  return data?.question_ids ?? null;
}

// "Locked" is derived, not stored — true the moment any nrs_submissions
// row exists for this team+cluster, since that row can only ever have
// been created by the invite-sending flow. No separate flag to keep in
// sync with that fact.
export async function isTeamClusterLocked(teamId: string, clusterKey: ClusterKey): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("nrs_submissions")
    .select("id, team_roster!inner(team_id)")
    .eq("cluster_key", clusterKey)
    .eq("team_roster.team_id", teamId)
    .limit(1);
  return (data?.length ?? 0) > 0;
}
