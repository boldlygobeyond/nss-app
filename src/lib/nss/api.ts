import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClusterKey } from "./clusters";
import type { Tally, TopNeed, ClusterScore } from "./surveyEngine";
import type { ReportData } from "./reportTypes";
import { latestResponsePerQuestion } from "./responseDedup";

export interface NssSubmission {
  id: string;
  user_id: string;
  user_email: string | null;
  respondent_name: string;
  pronouns: string | null;
  status: "in_progress" | "completed" | "report_generated";
  win_loss_tally: Tally;
  question_sequence: number[];
  questions_answered: number;
  top_needs: TopNeed[] | null;
  scores: Record<ClusterKey, ClusterScore> | null;
  report_data: ReportData | null;
  pdf_url: string | null;
  pdf_drive_id: string | null;
  pdf_download_token: string | null;
  pdf_email_downloaded_at: string | null;
  pdf_portal_downloaded_at: string | null;
  email_opened_at: string | null;
  email_clicked_at: string | null;
  team: string | null;
  updated_at: string;
}

export async function getSubmission(
  supabase: SupabaseClient,
  id: string,
): Promise<NssSubmission | null> {
  const { data, error } = await supabase
    .from("nss_submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as NssSubmission | null;
}

export async function listSubmissionsForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<NssSubmission[]> {
  const { data, error } = await supabase
    .from("nss_submissions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["completed", "report_generated"])
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data as NssSubmission[];
}

export async function createSubmission(
  supabase: SupabaseClient,
  params: {
    userId: string;
    userEmail: string | null;
    respondentName: string;
    pronouns: string;
    initialTally: Tally;
    questionSequence: number[];
    team?: string | null;
  },
): Promise<NssSubmission> {
  const { data, error } = await supabase
    .from("nss_submissions")
    .insert({
      user_id: params.userId,
      user_email: params.userEmail,
      respondent_name: params.respondentName,
      pronouns: params.pronouns,
      win_loss_tally: params.initialTally,
      question_sequence: params.questionSequence,
      questions_answered: 0,
      status: "in_progress",
      team: params.team ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as NssSubmission;
}

export async function updateSubmissionProgress(
  supabase: SupabaseClient,
  submissionId: string,
  params: { tally: Tally; questionSequence: number[]; questionsAnswered: number },
): Promise<void> {
  const { error } = await supabase
    .from("nss_submissions")
    .update({
      win_loss_tally: params.tally,
      question_sequence: params.questionSequence,
      questions_answered: params.questionsAnswered,
    })
    .eq("id", submissionId);

  if (error) throw error;
}

export async function finishSubmission(
  supabase: SupabaseClient,
  submissionId: string,
  params: {
    tally: Tally;
    questionSequence: number[];
    questionsAnswered: number;
    topNeeds: TopNeed[];
    scores: Record<ClusterKey, ClusterScore>;
  },
): Promise<void> {
  const { error } = await supabase
    .from("nss_submissions")
    .update({
      win_loss_tally: params.tally,
      question_sequence: params.questionSequence,
      questions_answered: params.questionsAnswered,
      top_needs: params.topNeeds,
      scores: params.scores,
      status: "completed",
    })
    .eq("id", submissionId);

  if (error) throw error;
}

/**
 * Thrown when upsert_nss_response rejects a write because a *more recent*
 * answer (by the respondent's own click-time, not request-arrival-time)
 * already exists for the same question — e.g. a delayed/retried request
 * racing a fresher one. This is not a failure to surface as an error to
 * the respondent: their latest intended answer is already stored
 * correctly by the write that won: callers should treat it as a benign
 * no-op, not retry it, and not log it as a real failure.
 */
export class StaleWriteError extends Error {
  constructor() {
    super("A more recent answer already exists for this question.");
    this.name = "StaleWriteError";
  }
}

/**
 * Writes a submission's answer to one question, replacing any prior answer
 * to the *same* question atomically (delete-then-insert inside one
 * database transaction, not two separate client requests — see
 * migration 0021 and NSS_Back_Navigation_And_Duplicate_Fix.md). This
 * correctly handles correcting a pre-migration row too: the function's
 * DELETE matches on submission_id+question_id directly, independent of
 * the partial unique index's own cutoff, so an old row is still found and
 * replaced rather than left alongside a new one.
 *
 * `answeredAt` must be the respondent's own click time (captured
 * client-side, synchronously, at the moment they chose an answer) — not
 * whenever this call happens to reach the server — so the function can
 * tell a genuinely newer answer apart from an older, delayed request.
 */
export async function upsertResponse(
  supabase: SupabaseClient,
  params: {
    submissionId: string;
    questionId: number;
    originalQuestionId?: number | null;
    isSharpened: boolean;
    selection: "A" | "B";
    chosenClusters: ClusterKey[];
    rejectedClusters: ClusterKey[];
    answeredAt: string;
  },
): Promise<void> {
  const { error } = await supabase.rpc("upsert_nss_response", {
    p_submission_id: params.submissionId,
    p_question_id: params.questionId,
    p_original_question_id: params.originalQuestionId ?? null,
    p_is_sharpened: params.isSharpened,
    p_selection: params.selection,
    p_chosen_clusters: params.chosenClusters,
    p_rejected_clusters: params.rejectedClusters,
    p_answered_at: params.answeredAt,
  });

  if (error) {
    if (error.message?.includes("stale_write")) throw new StaleWriteError();
    throw error;
  }
}

/**
 * Removes a submission's stored response to one question, with no
 * replacement — for converting an already-decisive answer into a skip
 * (reviewing a committed sharpened answer, or reconsidering a standard one
 * via "It Depends," can both end in Skip instead of a new decisive pick).
 * Skips themselves are never written here; this only clears whatever
 * decisive row skipping is replacing. Uses the plain table delete (not the
 * upsert_nss_response RPC, which only ever deletes as part of inserting a
 * replacement) — nss_responses_delete_via_submission
 * (0013_nss_responses_delete_policy.sql) already scopes this to the
 * caller's own submission, same ownership rule the RPC enforces.
 */
export async function deleteResponse(
  supabase: SupabaseClient,
  params: { submissionId: string; questionId: number },
): Promise<void> {
  const { error } = await supabase
    .from("nss_responses")
    .delete()
    .eq("submission_id", params.submissionId)
    .eq("question_id", params.questionId);
  if (error) throw error;
}

export interface StoredResponseRow {
  question_id: number;
  original_question_id: number | null;
  is_sharpened: boolean;
  selection: "A" | "B";
  chosen_clusters: ClusterKey[];
  rejected_clusters: ClusterKey[];
  answered_at: string;
}

/**
 * All of a submission's stored responses, deduplicated to the most recent
 * row per question (see responseDedup.ts) — the same accounting used for
 * scoring, so a client rebuilding its in-session state from the server
 * (cross-device resume) can't reintroduce a duplicate the DB-level fix
 * wasn't in place to prevent originally.
 */
export async function listResponsesForSubmission(
  supabase: SupabaseClient,
  submissionId: string,
): Promise<StoredResponseRow[]> {
  const { data, error } = await supabase
    .from("nss_responses")
    .select("question_id, original_question_id, is_sharpened, selection, chosen_clusters, rejected_clusters, answered_at")
    .eq("submission_id", submissionId)
    .order("answered_at", { ascending: true });

  if (error) throw error;
  return latestResponsePerQuestion((data ?? []) as StoredResponseRow[]);
}

export async function listTeamSubmissions(
  supabase: SupabaseClient,
  currentUserEmail: string,
): Promise<NssSubmission[]> {
  // Explicitly scoped to the caller's recursive downline via the same RPC
  // the RLS policy (nss_submissions_select_via_manager_chain) uses
  // internally, rather than relying on RLS alone to filter the plain
  // select — an admin's separate "see everything" RLS policy would
  // otherwise leak the whole company into this manager-only view.
  const { data: subordinates, error: subError } = await supabase.rpc("get_subordinate_emails", {
    root_email: currentUserEmail,
  });
  if (subError) throw subError;

  const emails = ((subordinates ?? []) as { email: string }[]).map((r) => r.email);
  if (emails.length === 0) return [];

  const { data, error } = await supabase
    .from("nss_submissions")
    .select("*")
    .in("user_email", emails)
    .not("report_data", "is", null)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data as NssSubmission[];
}

export async function listAllSubmissions(supabase: SupabaseClient): Promise<NssSubmission[]> {
  // Relies on the admin branch of nss_submissions_select_own_or_admin —
  // only meant to be called from an admin-gated page.
  const { data, error } = await supabase
    .from("nss_submissions")
    .select("*")
    .not("report_data", "is", null)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data as NssSubmission[];
}

export async function findInProgressSubmission(
  supabase: SupabaseClient,
  userId: string,
): Promise<NssSubmission | null> {
  const { data, error } = await supabase
    .from("nss_submissions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as NssSubmission | null;
}

export async function deleteSubmission(supabase: SupabaseClient, submissionId: string): Promise<void> {
  const { error } = await supabase.from("nss_submissions").delete().eq("id", submissionId);
  if (error) throw error;
}
