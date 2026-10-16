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

export interface JourneyEntry {
  position: number;
  phase: "calibration" | "adaptive";
  questionId: number;
  pair: string;
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
  const responses = rawResponses ?? [];

  const { data: questionRows } = await supabase.from("nss_questions").select("*");
  const allQuestions: SurveyQuestion[] = ((questionRows ?? []) as NssQuestionRow[]).map(questionFromRow);
  const qMap = Object.fromEntries(allQuestions.map((q) => [q.id, q]));
  const questions = allQuestions.filter((q) => q.id >= 51);

  const fullSequence = submission.question_sequence as number[];
  const responseByQid = new Map(responses.map((r) => [r.question_id, r]));
  const calibrationIds = fullSequence.slice(0, 21);
  // v1 (the original 50-question bank) used a completely different
  // selection mechanism (surveyEngine.ts's selectAdaptiveBlock — win-rate
  // blocks of 7, not one-at-a-time Bradley-Terry tiers). Replaying
  // selectNextBtQuestion against v1 history would produce a tier label
  // that looks plausible but never actually happened — so v1 submissions
  // skip the replay entirely and their adaptive-phase questions carry no
  // tier at all, rather than a fabricated one.
  const usesNewBank = fullSequence.some((id) => id >= 51);

  const journey: JourneyEntry[] = [];

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
      status,
      selection: (r?.selection as "A" | "B" | null) ?? null,
      chosenCluster: r ? (r.selection === "A" ? q.mappedClusters[0] : q.mappedClusters[1]) : null,
      rejectedCluster: r ? (r.selection === "A" ? q.mappedClusters[1] : q.mappedClusters[0]) : null,
      text: textFor(q, status === "it_depends_then_answered"),
    });
  });

  const calibrationResponses = responses.filter((r) => calibrationIds.includes(r.question_id));
  const adaptiveResponses = responses.filter((r) => !calibrationIds.includes(r.question_id));

  if (usesNewBank) {
    let state: DeliveryState = seedDeliveryStateFromHistory(
      calibrationResponses.map((r) => ({
        mappedClusters: qMap[r.question_id].mappedClusters,
        isSharpened: r.is_sharpened as boolean,
      })),
    );
    const calibrationCount = calibrationResponses.length;
    for (let j = 0; j < adaptiveResponses.length; j++) {
      const i = calibrationCount + j;
      const btResponsesSoFar: BtResponse[] = [...calibrationResponses, ...adaptiveResponses.slice(0, j)].map((r) => ({
        chosen_clusters: r.chosen_clusters,
        rejected_clusters: r.rejected_clusters,
      }));
      const seqPos = fullSequence.indexOf(adaptiveResponses[j].question_id);
      const usedIds = new Set(fullSequence.slice(0, seqPos));
      const replay = selectNextBtQuestion(questions, btResponsesSoFar, usedIds, state, i);
      const actual = adaptiveResponses[j];
      const actualQ = qMap[actual.question_id];
      if (!actualQ) continue;
      journey.push({
        position: 21 + j + 1,
        phase: "adaptive",
        questionId: actual.question_id,
        pair: `${actualQ.mappedClusters[0]} vs ${actualQ.mappedClusters[1]}`,
        status: actual.is_sharpened ? "it_depends_then_answered" : "answered",
        selection: actual.selection as "A" | "B",
        chosenCluster: actual.selection === "A" ? actualQ.mappedClusters[0] : actualQ.mappedClusters[1],
        rejectedCluster: actual.selection === "A" ? actualQ.mappedClusters[1] : actualQ.mappedClusters[0],
        tier: replay?.tier,
        text: textFor(actualQ, actual.is_sharpened as boolean),
      });
      const [a, b] = actualQ.mappedClusters;
      state = applyAnswerOutcome(
        {
          ...state,
          recentPairKeys: [...state.recentPairKeys, [a, b].sort().join("|")].slice(-10),
          recentQuestionClusters: [...state.recentQuestionClusters, [a, b] as [ClusterKey, ClusterKey]].slice(-10),
          lastSeenAt: { ...state.lastSeenAt, [a]: i, [b]: i },
        },
        actualQ.mappedClusters,
        actual.is_sharpened as boolean,
      );
    }
  } else {
    // v1 — no tier replay, just the real recorded answer for each
    // adaptive-phase question in order.
    adaptiveResponses.forEach((actual, j) => {
      const actualQ = qMap[actual.question_id];
      if (!actualQ) return;
      journey.push({
        position: 21 + j + 1,
        phase: "adaptive",
        questionId: actual.question_id,
        pair: `${actualQ.mappedClusters[0]} vs ${actualQ.mappedClusters[1]}`,
        status: actual.is_sharpened ? "it_depends_then_answered" : "answered",
        selection: actual.selection as "A" | "B",
        chosenCluster: actual.selection === "A" ? actualQ.mappedClusters[0] : actualQ.mappedClusters[1],
        rejectedCluster: actual.selection === "A" ? actualQ.mappedClusters[1] : actualQ.mappedClusters[0],
        text: textFor(actualQ, actual.is_sharpened as boolean),
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
