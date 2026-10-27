// Builds the "under the hood" view for one respondent's real survey path:
// every question they saw (answered / "it depends" / skipped), which tier
// of the adaptive delivery logic picked each adaptive-phase question
// (replayed against the current code, same approach as
// scripts/audit-survey-path.ts), the cluster head-to-head matrix, and the
// Bradley-Terry confidence trajectory. Ported from the one-off script used
// to prototype this view — same computation, now reusable from the app.
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLUSTERS, CLUSTER_LABELS, type ClusterKey } from "./clusters";
import type { SurveyQuestion, NssQuestionRow } from "./questions";
import { questionFromRow } from "./questions";
import {
  selectNextBtQuestion,
  seedDeliveryStateFromHistory,
  applyAnswerOutcome,
  type DeliveryState,
  type SelectionTier,
} from "./adaptiveDelivery";
import { rankByBradleyTerry, top3Stability, type BtResponse } from "./bradleyTerry";
import type { TopNeed } from "./surveyEngine";
import { latestResponsePerQuestion } from "./responseDedup";

export interface JourneyEntry {
  position: number;
  phase: "calibration" | "adaptive";
  questionId: number;
  pair: string;
  mappedClusters: [ClusterKey, ClusterKey];
  status: "answered" | "it_depends_then_answered" | "skipped";
  selection: "A" | "B" | null;
  chosenCluster: ClusterKey | null;
  rejectedCluster: ClusterKey | null;
  tier?: SelectionTier;
  text?: { question: string; optionA: string; optionB: string };
}

export interface TrajectoryPoint {
  n: number;
  top3: ClusterKey[];
  stability: number;
}

export interface InsightsData {
  respondentName: string;
  userEmail: string | null;
  // Whether this submission used the current 86-question Bradley-Terry
  // bank (true) or the original 50-question win-rate bank (false) — the
  // UI uses this to decide whether tier labels are meaningful to show.
  usesNewBank: boolean;
  totalQuestions: number;
  // Rows removed by latestResponsePerQuestion — a non-zero count means this
  // submission had more than one stored response for the same question at
  // some point (see NSS_Back_Navigation_And_Duplicate_Fix.md). Not shown as a
  // methodological disclaimer on anything a respondent sees; surfaced here
  // only so this diagnostic page doesn't silently hide the anomaly.
  duplicateResponsesRemoved: number;
  skippedCount: number;
  itDependsCount: number;
  journey: JourneyEntry[];
  matrix: Record<ClusterKey, Record<ClusterKey, number>>;
  matrixPositions: Record<ClusterKey, Record<ClusterKey, number[]>>;
  trajectory: TrajectoryPoint[];
  topNeeds: TopNeed[] | null;
  clusterLabels: Record<ClusterKey, string>;
}

function textFor(q: SurveyQuestion, useSharpened: boolean) {
  const v = useSharpened ? q.sharpened : q.standard;
  return { question: v.question, optionA: v.options.A, optionB: v.options.B };
}

export async function computeInsightsData(
  supabase: SupabaseClient,
  submissionId: string,
): Promise<InsightsData | null> {
  const { data: submission } = await supabase
    .from("nss_submissions")
    .select("respondent_name, user_email, question_sequence, top_needs")
    .eq("id", submissionId)
    .maybeSingle();
  if (!submission || !submission.question_sequence) return null;

  const { data: rawResponses } = await supabase
    .from("nss_responses")
    .select("question_id, chosen_clusters, rejected_clusters, is_sharpened, selection, answered_at")
    .eq("submission_id", submissionId)
    .order("answered_at", { ascending: true });
  // Deduplicated once, here, to the most recent row per question — the
  // same rule every other scoring consumer uses (responseDedup.ts) — so
  // this diagnostic page can't disagree with the actual scores about which
  // answer counted. Previously calibration and the adaptive phase handled
  // a duplicate row differently: a Map keyed by question_id silently kept
  // only the last answer in calibration, while the adaptive phase iterated
  // the raw (undeduplicated) array directly, producing two separate
  // journey entries — inflating the apparent question count and shifting
  // every later position by one (NSS_Back_Navigation_And_Duplicate_Fix.md, Finding
  // 5.2). Deduplicating once up front, before either phase reads
  // `responses`, makes that discrepancy structurally impossible rather
  // than something to keep in sync by hand.
  const rawCount = rawResponses?.length ?? 0;
  const responses = latestResponsePerQuestion(rawResponses ?? []);
  const duplicateResponsesRemoved = rawCount - responses.length;

  const { data: questionRows } = await supabase.from("nss_questions").select("*");
  const allQuestions: SurveyQuestion[] = ((questionRows ?? []) as NssQuestionRow[]).map(questionFromRow);
  const qMap = Object.fromEntries(allQuestions.map((q) => [q.id, q]));
  const questions = allQuestions.filter((q) => q.id >= 51);

  const fullSequence = submission.question_sequence as number[];
  const responseByQid = new Map(responses.map((r) => [r.question_id, r]));
  const calibrationIds = fullSequence.slice(0, 21);
  const adaptiveIds = fullSequence.slice(21);
  // v1 (the original 50-question bank) used a completely different
  // selection mechanism (surveyEngine.ts's selectAdaptiveBlock — win-rate
  // blocks of 7, not one-at-a-time Bradley-Terry tiers). Replaying
  // selectNextBtQuestion against v1 history would produce a tier label
  // that looks plausible but never actually happened — so v1 submissions
  // skip the replay entirely and their adaptive-phase questions carry no
  // tier at all, rather than a fabricated one.
  const usesNewBank = fullSequence.some((id) => id >= 51);

  const journey: JourneyEntry[] = [];

  // Both phases walk the submission's own authoritative question_sequence
  // (the real delivery order), not the responses array — a response-row
  // filter would silently drop a skipped question from the journey
  // entirely instead of showing it as skipped, which is exactly what the
  // adaptive phase used to do (calibration already walked its own slice of
  // the sequence this way; the adaptive phase previously iterated answered
  // responses only — a second, independent inconsistency from Finding 5.2,
  // fixed the same way here).
  calibrationIds.forEach((qid, i) => {
    const q = qMap[qid];
    if (!q) return;
    const r = responseByQid.get(qid);
    const status: JourneyEntry["status"] = r ? (r.is_sharpened ? "it_depends_then_answered" : "answered") : "skipped";
    journey.push({
      position: i + 1,
      phase: "calibration",
      questionId: qid,
      pair: `${q.mappedClusters[0]} vs ${q.mappedClusters[1]}`,
      mappedClusters: q.mappedClusters,
      status,
      selection: (r?.selection as "A" | "B" | null) ?? null,
      chosenCluster: r ? (r.selection === "A" ? q.mappedClusters[0] : q.mappedClusters[1]) : null,
      rejectedCluster: r ? (r.selection === "A" ? q.mappedClusters[1] : q.mappedClusters[0]) : null,
      text: textFor(q, status === "it_depends_then_answered"),
    });
  });

  if (usesNewBank) {
    const calibrationAnswered = calibrationIds
      .map((qid) => responseByQid.get(qid))
      .filter((r): r is NonNullable<typeof r> => !!r);
    let state: DeliveryState = seedDeliveryStateFromHistory(
      calibrationAnswered.map((r) => ({
        mappedClusters: qMap[r.question_id].mappedClusters,
        isSharpened: r.is_sharpened as boolean,
      })),
    );
    let btResponsesSoFar: BtResponse[] = calibrationAnswered.map((r) => ({
      chosen_clusters: r.chosen_clusters,
      rejected_clusters: r.rejected_clusters,
    }));
    let answeredCount = btResponsesSoFar.length;

    adaptiveIds.forEach((qid, j) => {
      const q = qMap[qid];
      if (!q) return;
      const usedIds = new Set(fullSequence.slice(0, 21 + j));
      const replay = selectNextBtQuestion(questions, btResponsesSoFar, usedIds, state, answeredCount);
      const r = responseByQid.get(qid);
      const status: JourneyEntry["status"] = r ? (r.is_sharpened ? "it_depends_then_answered" : "answered") : "skipped";
      journey.push({
        position: 21 + j + 1,
        phase: "adaptive",
        questionId: qid,
        pair: `${q.mappedClusters[0]} vs ${q.mappedClusters[1]}`,
        mappedClusters: q.mappedClusters,
        status,
        selection: (r?.selection as "A" | "B" | null) ?? null,
        chosenCluster: r ? (r.selection === "A" ? q.mappedClusters[0] : q.mappedClusters[1]) : null,
        rejectedCluster: r ? (r.selection === "A" ? q.mappedClusters[1] : q.mappedClusters[0]) : null,
        tier: replay?.tier,
        text: textFor(q, status === "it_depends_then_answered"),
      });
      // Matches the live selector's own behavior (SurveyClient.tsx's
      // handleSkip): a skipped question never calls applyAnswerOutcome and
      // never joins btResponsesSoFar — it only occupies a usedIds slot, via
      // fullSequence above, so the replay never re-offers it.
      if (r) {
        answeredCount++;
        btResponsesSoFar = [...btResponsesSoFar, { chosen_clusters: r.chosen_clusters, rejected_clusters: r.rejected_clusters }];
        const [a, b] = q.mappedClusters;
        state = applyAnswerOutcome(
          {
            ...state,
            recentPairKeys: [...state.recentPairKeys, [a, b].sort().join("|")].slice(-10),
            recentQuestionClusters: [...state.recentQuestionClusters, [a, b] as [ClusterKey, ClusterKey]].slice(-10),
            lastSeenAt: { ...state.lastSeenAt, [a]: 21 + j, [b]: 21 + j },
          },
          q.mappedClusters,
          r.is_sharpened as boolean,
        );
      }
    });
  } else {
    // v1 — no tier replay, just the real recorded answer (or lack of one)
    // for each adaptive-phase question in delivery order.
    adaptiveIds.forEach((qid, j) => {
      const q = qMap[qid];
      if (!q) return;
      const r = responseByQid.get(qid);
      const status: JourneyEntry["status"] = r ? (r.is_sharpened ? "it_depends_then_answered" : "answered") : "skipped";
      journey.push({
        position: 21 + j + 1,
        phase: "adaptive",
        questionId: qid,
        pair: `${q.mappedClusters[0]} vs ${q.mappedClusters[1]}`,
        mappedClusters: q.mappedClusters,
        status,
        selection: (r?.selection as "A" | "B" | null) ?? null,
        chosenCluster: r ? (r.selection === "A" ? q.mappedClusters[0] : q.mappedClusters[1]) : null,
        rejectedCluster: r ? (r.selection === "A" ? q.mappedClusters[1] : q.mappedClusters[0]) : null,
        text: textFor(q, status === "it_depends_then_answered"),
      });
    });
  }

  journey.forEach((entry) => {
    if (entry.status === "skipped" && !entry.text) {
      const q = qMap[entry.questionId];
      if (q) entry.text = textFor(q, false);
    }
  });

  const matrix = {} as Record<ClusterKey, Record<ClusterKey, number>>;
  const matrixPositions = {} as Record<ClusterKey, Record<ClusterKey, number[]>>;
  CLUSTERS.forEach((a) => {
    matrix[a] = {} as Record<ClusterKey, number>;
    matrixPositions[a] = {} as Record<ClusterKey, number[]>;
    CLUSTERS.forEach((b) => {
      matrix[a][b] = 0;
      matrixPositions[a][b] = [];
    });
  });
  journey.forEach((entry) => {
    if (entry.chosenCluster && entry.rejectedCluster) {
      matrix[entry.chosenCluster][entry.rejectedCluster]++;
      matrixPositions[entry.chosenCluster][entry.rejectedCluster].push(entry.position);
    }
  });

  const trajectory: TrajectoryPoint[] = [];
  for (let n = 10; n <= responses.length; n++) {
    const soFar: BtResponse[] = responses
      .slice(0, n)
      .map((r) => ({ chosen_clusters: r.chosen_clusters, rejected_clusters: r.rejected_clusters }));
    const ranked = rankByBradleyTerry(soFar);
    const { stability } = top3Stability(soFar, 300, 1);
    trajectory.push({ n, top3: ranked.slice(0, 3).map((r) => r.cluster), stability });
  }

  return {
    respondentName: submission.respondent_name,
    userEmail: submission.user_email,
    usesNewBank,
    totalQuestions: responses.length,
    duplicateResponsesRemoved,
    skippedCount: journey.filter((j) => j.status === "skipped").length,
    itDependsCount: journey.filter((j) => j.status === "it_depends_then_answered").length,
    journey,
    matrix,
    matrixPositions,
    trajectory,
    topNeeds: submission.top_needs as TopNeed[] | null,
    clusterLabels: CLUSTER_LABELS,
  };
}
