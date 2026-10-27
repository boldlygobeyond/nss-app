// Read-only diagnostic: does this submission's stored data look internally
// consistent — never modifies, recalculates, or regenerates anything. See
// NSS_Survey_Integrity_Panel.md for the full design and what each check can
// and can't actually establish.
//
// Admin-only by inheritance, not by anything in this module: this is only
// ever called from src/app/admin/reports/[id]/insights/page.tsx, which
// already requires role === "admin" before calling it. The real
// enforcement is Postgres RLS on nss_submissions/nss_responses
// (nss_submissions_select_own_or_admin, 0001_init_schema.sql) — the client
// passed in is the caller's own authenticated session, never a
// service-role bypass, so an unauthorized caller gets RLS-filtered (empty)
// results here, not someone else's data; this module doesn't need its own
// authorization check on top of that.
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLUSTERS, type ClusterKey } from "./clusters";
import { latestResponsePerQuestion } from "./responseDedup";

// Same cutoff as migration 0021 (nss_responses_submission_question_unique /
// upsert_nss_response). A duplicate group where every row predates this is
// from before the fix existed — known, historical, not something this fix
// could have prevented. One with any row at or after it occurred despite
// the fix being live and is a live anomaly worth real attention.
export const MIGRATION_CUTOFF = "2026-10-20T00:00:00.000Z";
const HARD_STOP = 50;
const CALIBRATION_SIZE = 21;

export type CheckStatus = "pass" | "issue" | "incomplete" | "unable_to_verify";
export type OverallStatus = "passed" | "issues_detected" | "incomplete" | "unable_to_verify";

export interface DuplicateGroup {
  questionId: number;
  rowCount: number;
  answeredAts: string[];
  /** Every row's answered_at predates the migration cutoff. */
  isHistorical: boolean;
}

export interface SurveyIntegrityResult {
  overallStatus: OverallStatus;
  submissionStatus: "in_progress" | "completed" | "report_generated";
  decisiveAnswers: {
    status: CheckStatus;
    count: number;
    /** 50 once the submission is no longer in_progress; null while it still is, since there's no fixed target to compare against yet. */
    expected: number | null;
    storedQuestionsAnswered: number;
    /** The submission's own questions_answered column disagrees with the actual distinct-decisive-answer count computed from raw rows right now. */
    mismatch: boolean;
  };
  duplicates: {
    status: CheckStatus;
    groups: DuplicateGroup[];
    historicalCount: number;
    newCount: number;
  };
  calibration: {
    status: CheckStatus;
    covered: number;
    total: typeof CALIBRATION_SIZE;
    missingPairs: string[];
    note?: string;
  };
  scoring: {
    status: CheckStatus;
    note: string;
  };
}

function allClusterPairKeys(): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < CLUSTERS.length; i++) {
    for (let j = i + 1; j < CLUSTERS.length; j++) {
      pairs.push([CLUSTERS[i], CLUSTERS[j]].sort().join("|"));
    }
  }
  return pairs;
}

export async function computeSurveyIntegrity(
  supabase: SupabaseClient,
  submissionId: string,
): Promise<SurveyIntegrityResult | null> {
  const { data: submission, error: subErr } = await supabase
    .from("nss_submissions")
    .select("status, questions_answered, question_sequence, top_needs")
    .eq("id", submissionId)
    .maybeSingle();
  if (subErr || !submission) return null;

  const { data: rawResponses, error: respErr } = await supabase
    .from("nss_responses")
    .select("question_id, answered_at")
    .eq("submission_id", submissionId)
    .order("answered_at", { ascending: true });
  if (respErr) return null;
  const rows = (rawResponses ?? []) as { question_id: number; answered_at: string }[];

  const status = submission.status as "in_progress" | "completed" | "report_generated";
  const isComplete = status !== "in_progress";
  const sequence = (submission.question_sequence as number[] | null) ?? [];

  // ── Decisive answers ─────────────────────────────────────────────────
  // latestResponsePerQuestion is the exact same rule scoring itself uses
  // (responseDedup.ts) — a distinct question_id count here IS "one
  // authoritative decisive answer per question," not a separate notion of
  // one this check invented.
  const decisive = latestResponsePerQuestion(rows);
  const decisiveCount = decisive.length;
  const storedQuestionsAnswered = (submission.questions_answered as number | null) ?? 0;
  const mismatch = decisiveCount !== storedQuestionsAnswered;
  const decisiveAnswers: SurveyIntegrityResult["decisiveAnswers"] = {
    // A mismatch is worth surfacing regardless of completion state — it's
    // a real accounting disagreement, not something that resolves itself
    // just because the survey isn't finished yet.
    status: mismatch ? "issue" : !isComplete ? "incomplete" : decisiveCount !== HARD_STOP ? "issue" : "pass",
    count: decisiveCount,
    expected: isComplete ? HARD_STOP : null,
    storedQuestionsAnswered,
    mismatch,
  };

  // ── Duplicate question records ───────────────────────────────────────
  // Raw rows, before any dedup — never conceal a duplicate just because
  // scoring already knows how to pick one of them.
  const byQuestion = new Map<number, string[]>();
  rows.forEach((r) => {
    const arr = byQuestion.get(r.question_id) ?? [];
    arr.push(r.answered_at);
    byQuestion.set(r.question_id, arr);
  });
  const groups: DuplicateGroup[] = [...byQuestion.entries()]
    .filter(([, timestamps]) => timestamps.length > 1)
    .map(([questionId, answeredAts]) => ({
      questionId,
      rowCount: answeredAts.length,
      answeredAts,
      isHistorical: answeredAts.every((t) => t < MIGRATION_CUTOFF),
    }))
    .sort((a, b) => a.questionId - b.questionId);
  const historicalCount = groups.filter((g) => g.isHistorical).length;
  const newCount = groups.length - historicalCount;
  const duplicates: SurveyIntegrityResult["duplicates"] = {
    // Any duplicate at all is an "issue" worth a human's attention —
    // historical ones are distinguished in the detail, not hidden or
    // downgraded to a non-issue. This never deletes or merges anything.
    status: groups.length === 0 ? "pass" : "issue",
    groups,
    historicalCount,
    newCount,
  };

  // ── Calibration coverage ─────────────────────────────────────────────
  // Walks question_sequence (what was actually PRESENTED, including a
  // question the respondent then skipped), never the responses table
  // (what was answered) — conflating the two would make a legitimately
  // skipped calibration question look like a coverage gap.
  let calibration: SurveyIntegrityResult["calibration"];
  if (sequence.length < CALIBRATION_SIZE) {
    calibration = {
      // Fewer than 21 delivered is expected and fine while the survey is
      // still running; the same shortfall on a submission already marked
      // complete is a real inconsistency, not merely "not done yet."
      status: isComplete ? "issue" : "incomplete",
      covered: 0,
      total: CALIBRATION_SIZE,
      missingPairs: [],
      note: isComplete
        ? "This submission is marked complete but fewer than 21 calibration questions are recorded as delivered."
        : "Calibration isn't finished yet for this submission.",
    };
  } else {
    const calibrationIds = sequence.slice(0, CALIBRATION_SIZE);
    const { data: questionRows, error: qErr } = await supabase
      .from("nss_questions")
      .select("id, cluster_a, cluster_b")
      .in("id", calibrationIds);
    if (qErr || !questionRows) {
      calibration = {
        status: "unable_to_verify",
        covered: 0,
        total: CALIBRATION_SIZE,
        missingPairs: [],
        note: "Could not load the question bank to map delivered questions to cluster pairs.",
      };
    } else {
      const qMap = new Map(
        (questionRows as { id: number; cluster_a: ClusterKey; cluster_b: ClusterKey }[]).map((r) => [r.id, r]),
      );
      const unmapped = calibrationIds.filter((id) => !qMap.has(id));
      if (unmapped.length > 0) {
        calibration = {
          status: "unable_to_verify",
          covered: 0,
          total: CALIBRATION_SIZE,
          missingPairs: [],
          note: `${unmapped.length} delivered calibration question id(s) no longer exist in the question bank.`,
        };
      } else {
        const coveredSet = new Set(
          calibrationIds.map((id) => {
            const q = qMap.get(id)!;
            return [q.cluster_a, q.cluster_b].sort().join("|");
          }),
        );
        const missingPairs = allClusterPairKeys().filter((p) => !coveredSet.has(p));
        calibration = {
          status: missingPairs.length === 0 ? "pass" : "issue",
          covered: CALIBRATION_SIZE - missingPairs.length,
          total: CALIBRATION_SIZE,
          missingPairs,
        };
      }
    }
  }

  // ── Scoring consistency ──────────────────────────────────────────────
  // Deliberately does NOT re-run Bradley-Terry fitting or compare
  // rankings — top_needs/scores are a one-time snapshot taken at
  // completion (see NSS_Survey_Integrity_Panel.md), not something
  // recomputed on every page view, so there's no live "second scoring
  // method" to agree or disagree with. What this CAN establish: whether a
  // scoring result exists at all for a submission that claims to be
  // complete, and whether the decisive-answer accounting it would have
  // been built from looks consistent right now.
  const topNeeds = submission.top_needs as unknown[] | null;
  let scoring: SurveyIntegrityResult["scoring"];
  if (!isComplete) {
    scoring = { status: "incomplete", note: "Scoring hasn't run yet — the survey is still in progress." };
  } else if (!topNeeds || topNeeds.length === 0) {
    scoring = { status: "issue", note: "This submission is marked complete but has no stored scoring result." };
  } else if (decisiveAnswers.status === "issue") {
    scoring = {
      status: "unable_to_verify",
      note: "The decisive-answer count for this submission doesn't look right, so the stored scoring snapshot can't be vouched for against it.",
    };
  } else {
    scoring = {
      status: "pass",
      note: "A complete, consistent decisive-answer set and a stored scoring result both exist. This does not re-run or re-verify the Bradley-Terry ranking itself.",
    };
  }

  // ── Overall ───────────────────────────────────────────────────────────
  const allStatuses = [decisiveAnswers.status, duplicates.status, calibration.status, scoring.status];
  let overallStatus: OverallStatus;
  if (allStatuses.includes("issue")) overallStatus = "issues_detected";
  else if (!isComplete) overallStatus = "incomplete";
  else if (allStatuses.includes("unable_to_verify")) overallStatus = "unable_to_verify";
  else overallStatus = "passed";

  return { overallStatus, submissionStatus: status, decisiveAnswers, duplicates, calibration, scoring };
}
