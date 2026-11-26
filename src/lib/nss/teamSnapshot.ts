import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";
import { latestResponsePerQuestion } from "@/lib/nss/responseDedup";
import { listAllProfiles } from "@/lib/nss/userProfiles";
import { buildFullName } from "@/lib/nss/reportFilename";
import { computeTeamMemberScores, type TeamMemberScore } from "@/lib/nss/teamScores";
import type { ClusterKey } from "@/lib/nss/clusters";
import type { BtResponse } from "@/lib/nss/bradleyTerry";

// Shared by the admin Team Snapshot tab and the Snapshot PDF print page so
// "which submissions count as a finished report, whose retake wins, how
// scores get refit" can't drift between the two call sites — mirrors
// admin/teams/[slug]/page.tsx's own deriveReports + loadSnapshot exactly.
export async function loadTeamSnapshotScores(supabase: SupabaseClient, teamSlug: string): Promise<TeamMemberScore[]> {
  const { data: allSubmissions } = await supabase
    .from("nss_submissions")
    .select("id, respondent_name, user_email, user_id, status, completed_at")
    .eq("team", teamSlug);

  const completed = (allSubmissions ?? [])
    .filter((s) => s.status === "completed" || s.status === "report_generated")
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
    // One entry per person — a retake replaces their earlier submission.
    // Already sorted most-recent first, so keeping each user_id's first
    // occurrence keeps their latest completed submission.
    .filter((r, i, arr) => arr.findIndex((x) => x.user_id === r.user_id) === i);

  if (completed.length === 0) return [];

  const [allProfiles, allResponses] = await Promise.all([
    listAllProfiles(supabase),
    fetchAllRows<{
      submission_id: string;
      question_id: number;
      chosen_clusters: ClusterKey[];
      rejected_clusters: ClusterKey[];
      answered_at: string;
    }>((from, to) =>
      supabase
        .from("nss_responses")
        .select("submission_id, question_id, chosen_clusters, rejected_clusters, answered_at")
        .in(
          "submission_id",
          completed.map((r) => r.id),
        )
        .order("id")
        .range(from, to),
    ),
  ]);
  const profiles = Object.fromEntries(allProfiles.map((p) => [p.id, p]));

  const rawBySubmission = new Map<string, typeof allResponses>();
  allResponses.forEach((r) => {
    const list = rawBySubmission.get(r.submission_id) ?? [];
    list.push(r);
    rawBySubmission.set(r.submission_id, list);
  });
  // Deduplicated per submission (a question can have more than one stored
  // row for the same submission) before anyone's responses feed into team
  // scoring, same rule every other scoring consumer uses.
  const bySubmission = new Map<string, BtResponse[]>();
  rawBySubmission.forEach((rows, submissionId) => {
    bySubmission.set(
      submissionId,
      latestResponsePerQuestion(rows).map((r) => ({
        chosen_clusters: r.chosen_clusters,
        rejected_clusters: r.rejected_clusters,
      })),
    );
  });

  const members = completed
    .map((r) => {
      const responses = bySubmission.get(r.id) ?? [];
      if (responses.length === 0) return null;
      const profile = profiles[r.user_id];
      const fullName = buildFullName(profile?.first_name, profile?.last_name, r.respondent_name);
      const [firstName, ...rest] = fullName.split(" ");
      return {
        userId: r.user_id,
        submissionId: r.id,
        firstName: firstName || fullName,
        lastName: rest.join(" "),
        responses,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  return computeTeamMemberScores(members);
}
