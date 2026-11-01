import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ClusterKey } from "@/lib/nss/clusters";
import { getSelectedQuestionIds } from "@/lib/nrs/scenarioSelection";

export interface NrsSubmissionWithRoster {
  id: string;
  rosterId: string;
  clusterKey: ClusterKey;
  accessToken: string;
  status: "invited" | "in_progress" | "completed";
  invitedAt: string;
  lastReminderAt: string | null;
  completedAt: string | null;
  resonanceScore: number | null;
  resultsEmailSentAt: string | null;
  roster: {
    id: string;
    teamId: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

// Creates (or, on a duplicate, reuses) an NRS submission for an existing
// roster member + cluster. The unique (roster_id, cluster_key) constraint
// added in 0022 is the actual duplicate-submission guard — this just
// handles the resulting conflict gracefully instead of throwing, so a
// second "Send" click (or a legitimate resend) never creates a second row.
export async function createNrsSubmission(params: {
  rosterId: string;
  clusterKey: ClusterKey;
}): Promise<{ id: string; accessToken: string }> {
  const admin = createAdminClient();
  const accessToken = randomBytes(24).toString("hex");

  const { data, error } = await admin
    .from("nrs_submissions")
    .insert({ roster_id: params.rosterId, cluster_key: params.clusterKey, access_token: accessToken })
    .select("id, access_token")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing, error: fetchError } = await admin
        .from("nrs_submissions")
        .select("id, access_token")
        .eq("roster_id", params.rosterId)
        .eq("cluster_key", params.clusterKey)
        .single();
      if (fetchError || !existing) throw fetchError ?? error;
      return { id: existing.id, accessToken: existing.access_token };
    }
    throw error;
  }

  return { id: data.id, accessToken: data.access_token };
}

// The only way an unauthenticated participant link resolves to a row —
// always joined with its roster parent so every caller gets current
// participant identity (name/email), never a denormalized copy that
// could drift out of sync with a roster edit.
export async function getSubmissionByToken(token: string): Promise<NrsSubmissionWithRoster | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("nrs_submissions")
    .select(
      "id, roster_id, cluster_key, access_token, status, invited_at, last_reminder_at, completed_at, resonance_score, results_email_sent_at, team_roster(id, team_id, first_name, last_name, email)",
    )
    .eq("access_token", token)
    .maybeSingle();

  if (error || !data) return null;

  const roster = Array.isArray(data.team_roster) ? data.team_roster[0] : data.team_roster;
  if (!roster) return null;

  return {
    id: data.id,
    rosterId: data.roster_id,
    clusterKey: data.cluster_key as ClusterKey,
    accessToken: data.access_token,
    status: data.status,
    invitedAt: data.invited_at,
    lastReminderAt: data.last_reminder_at,
    completedAt: data.completed_at,
    resonanceScore: data.resonance_score,
    resultsEmailSentAt: data.results_email_sent_at,
    roster: {
      id: roster.id,
      teamId: roster.team_id,
      firstName: roster.first_name,
      lastName: roster.last_name,
      email: roster.email,
    },
  };
}

// Verifies all of the cluster's scenarios are answered, computes the
// arithmetic mean rounded to 1 decimal, and writes completion as a single
// conditional UPDATE guarded on status != 'completed'. justCompleted is
// false on a retry/double-submit of an already-completed submission —
// that's what makes this endpoint idempotent against a double-click
// without ever overwriting a completed assessment or re-triggering the
// results email twice.
export async function submitNrsAssessment(
  submissionId: string,
  accessToken: string,
): Promise<{ score: number; justCompleted: boolean } | null> {
  const admin = createAdminClient();

  const { data: submission, error: subError } = await admin
    .from("nrs_submissions")
    .select("id, cluster_key, team_roster(team_id)")
    .eq("id", submissionId)
    .eq("access_token", accessToken)
    .maybeSingle();
  if (subError || !submission) return null;
  const roster = Array.isArray(submission.team_roster) ? submission.team_roster[0] : submission.team_roster;
  if (!roster) return null;

  const questionIds = await getSelectedQuestionIds(roster.team_id, submission.cluster_key as ClusterKey);
  if (!questionIds) throw new Error("No scenario selection saved for this team and cluster");

  const { data: responses, error: rError } = await admin
    .from("nrs_responses")
    .select("question_id, rating")
    .eq("submission_id", submissionId)
    .in("question_id", questionIds);
  if (rError) throw rError;

  const answered = responses ?? [];
  if (answered.length < questionIds.length) {
    throw new Error(`Not all scenarios have been answered yet (${answered.length}/${questionIds.length})`);
  }

  const mean = answered.reduce((sum, r) => sum + (r.rating as number), 0) / answered.length;
  const score = Math.round(mean * 10) / 10;

  const { data: updated, error: updateError } = await admin
    .from("nrs_submissions")
    .update({ status: "completed", completed_at: new Date().toISOString(), resonance_score: score })
    .eq("id", submissionId)
    .neq("status", "completed")
    .select("id")
    .maybeSingle();
  if (updateError) throw updateError;

  return { score, justCompleted: updated !== null };
}

// Belt-and-suspenders on top of submitNrsAssessment's own completion
// guard — claims the right to send the results email only once per
// submission, in case the submit route's after() tail somehow runs twice
// (e.g. a platform-level retry of the original request). Zero rows back
// means another call already claimed it; don't send again.
export async function claimResultsEmailSend(submissionId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("nrs_submissions")
    .update({ results_email_sent_at: new Date().toISOString() })
    .eq("id", submissionId)
    .is("results_email_sent_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[nrs] failed to claim results-email send:", error);
    return false;
  }
  return data !== null;
}
