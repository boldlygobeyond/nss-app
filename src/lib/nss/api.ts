import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClusterKey } from "./clusters";
import type { Tally, TopNeed, ClusterScore } from "./surveyEngine";
import type { ReportData } from "./reportTypes";

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

export async function insertResponse(
  supabase: SupabaseClient,
  params: {
    submissionId: string;
    questionId: number;
    originalQuestionId?: number | null;
    isSharpened: boolean;
    selection: "A" | "B";
    chosenClusters: ClusterKey[];
    rejectedClusters: ClusterKey[];
  },
): Promise<void> {
  const { error } = await supabase.from("nss_responses").insert({
    submission_id: params.submissionId,
    question_id: params.questionId,
    original_question_id: params.originalQuestionId ?? null,
    is_sharpened: params.isSharpened,
    selection: params.selection,
    chosen_clusters: params.chosenClusters,
    rejected_clusters: params.rejectedClusters,
  });

  if (error) throw error;
}

export async function listResponsesForSubmission(
  supabase: SupabaseClient,
  submissionId: string,
): Promise<{ chosen_clusters: ClusterKey[]; rejected_clusters: ClusterKey[] }[]> {
  const { data, error } = await supabase
    .from("nss_responses")
    .select("chosen_clusters, rejected_clusters")
    .eq("submission_id", submissionId);

  if (error) throw error;
  return data as { chosen_clusters: ClusterKey[]; rejected_clusters: ClusterKey[] }[];
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
