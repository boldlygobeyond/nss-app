/**
 * Bradley-Terry adaptive delivery — replaces the win-rate "blocks of 7 near
 * 40-60%" adaptive phase (surveyEngine.ts's selectAdaptiveBlock) with a
 * question-at-a-time selector: after every answer, refit Bradley-Terry
 * strengths and ask about whichever pair of clusters currently has the
 * closest strength estimates — that's the comparison that carries the most
 * information, because it's the one the model is least sure about.
 *
 * Calibration (Q1-21, surveyEngine.ts's buildCalibrationSequence) is
 * unchanged — it already gives a balanced, well-connected comparison graph
 * for the initial Bradley-Terry fit, so there's no need to redesign it.
 * This module only takes over from Q22 onward.
 *
 * Selection priority, highest first:
 *  1. Staleness guard (hard ceiling): any cluster untouched for 8+
 *     questions forces the candidate pool down to pairs touching it,
 *     regardless of anything else pending. This sits above validation —
 *     an earlier version let validation preempt it indefinitely whenever a
 *     pair was pending, which let real sessions blow well past the 8-
 *     question ceiling (confirmed: one cluster went 13 questions silent in
 *     testing) because validation requests kept winning every single turn.
 *     Staleness is a hard guarantee, not a soft preference, so it can't be
 *     starved out by anything below it.
 *  2. Validation: a cluster pair where the person's last answer needed the
 *     "it depends" clarification gets re-tested with a *different* question
 *     on the same pair. Clicking "it depends" and then answering means they
 *     DO have a real preference, it's just that that particular scenario
 *     didn't resonate — so the fix isn't to trust the answer less, it's to
 *     confirm it with a better-fitting scenario on the same pair.
 *  3. Default: the pair with the closest current Bradley-Terry strength
 *     estimate — the comparison the model is least sure about.
 * Every tier is subject to the repeat cap below, and falls through to the
 * next tier if the cap empties it.
 *
 * Repeat cap: a naive "always ask the closest pair" selector tunnel-visions
 * onto one pair/region of the cluster graph once it's close, starving other
 * clusters of data (confirmed by simulation before this was wired in for
 * real). Capped at 2 consecutive asks of the same pair.
 *
 * Belonging-vs-Stability and Belonging-vs-Connections were previously
 * last-resort only (Oct 2026 decision, reversed later that same month):
 * they were judged weaker/less legitimate-feeling than the rest of the
 * bank, so they were excluded from normal selection. Reversed to see how
 * real respondents react to the actual questions rather than deciding on
 * the team's own read of them — they're now ordinary pairs, selected by
 * the same three tiers as everything else.
 */

import { CLUSTERS, type ClusterKey } from "./clusters";
import type { SurveyQuestion } from "./questions";
import { fitBradleyTerry, type BtResponse } from "./bradleyTerry";
import { shuffleArray } from "./surveyEngine";

function pairKey(a: ClusterKey, b: ClusterKey): string {
  return [a, b].sort().join("|");
}

const MAX_CONSECUTIVE = 2;
const MAX_CONSECUTIVE_CLUSTER = 2;
const STALE_LIMIT = 8;

export interface DeliveryState {
  /** Pair keys asked, most recent last — only the tail is ever inspected. */
  recentPairKeys: string[];
  /** Each question's two clusters, most recent last — only the tail is ever inspected. */
  recentQuestionClusters: Array<[ClusterKey, ClusterKey]>;
  /** Question index (1-based, overall count so far) each cluster was last asked about. */
  lastSeenAt: Record<ClusterKey, number>;
  /** Pair keys whose most recent answer needed "it depends" and haven't been re-confirmed yet. */
  pendingValidation: Set<string>;
}

export function initDeliveryState(seedIndex = 0): DeliveryState {
  return {
    recentPairKeys: [],
    recentQuestionClusters: [],
    lastSeenAt: Object.fromEntries(CLUSTERS.map((c) => [c, seedIndex])) as Record<ClusterKey, number>,
    pendingValidation: new Set(),
  };
}

/**
 * Backfills lastSeenAt from an already-answered sequence (e.g. the fixed
 * calibration phase), so the staleness guard doesn't think every cluster
 * has been silent since question 0 the moment the adaptive phase starts.
 * isSharpened per answer seeds pendingValidation the same way a live
 * calibration-phase "it depends" would.
 */
export function seedDeliveryStateFromHistory(
  answered: { mappedClusters: [ClusterKey, ClusterKey]; isSharpened?: boolean }[],
): DeliveryState {
  const state = initDeliveryState(0);
  answered.forEach((q, i) => {
    const idx = i + 1;
    state.lastSeenAt[q.mappedClusters[0]] = idx;
    state.lastSeenAt[q.mappedClusters[1]] = idx;
    const key = pairKey(q.mappedClusters[0], q.mappedClusters[1]);
    if (q.isSharpened) state.pendingValidation.add(key);
    else state.pendingValidation.delete(key);
  });
  state.recentQuestionClusters = answered.slice(-10).map((q) => q.mappedClusters);
  return state;
}

/**
 * Call after recording the answer to the question selectNextBtQuestion just
 * returned, with whether that answer needed the sharpened "it depends"
 * version. Marks the pair for a confirming follow-up if so, or clears a
 * pending mark if this answer *was* that confirmation (came back direct).
 */
export function applyAnswerOutcome(
  state: DeliveryState,
  mappedClusters: [ClusterKey, ClusterKey],
  isSharpened: boolean,
): DeliveryState {
  const key = pairKey(mappedClusters[0], mappedClusters[1]);
  const pendingValidation = new Set(state.pendingValidation);
  pendingValidation.delete(key);
  if (isSharpened) pendingValidation.add(key);
  return { ...state, pendingValidation };
}

/**
 * Filters out a capped pair, returning [] (not the unfiltered list) when
 * that empties the tier — the caller must fall through to the next tier
 * rather than silently ignore the cap. Only the final tier gets to treat an
 * empty result as "ignore the cap, there's truly nothing else left."
 */
function applyRepeatCap(
  entries: Array<[string, SurveyQuestion[]]>,
  state: DeliveryState,
): Array<[string, SurveyQuestion[]]> {
  const recent = state.recentPairKeys.slice(-MAX_CONSECUTIVE);
  if (recent.length < MAX_CONSECUTIVE || !recent.every((k) => k === recent[0])) return entries;
  return entries.filter(([key]) => key !== recent[0]);
}

/**
 * A cluster that's appeared in each of the last MAX_CONSECUTIVE_CLUSTER
 * questions goes on cooldown — excluded from selection regardless of pair,
 * even though each of those questions was a different scenario and a
 * different opponent. Confirmed necessary by a real test run: the pair
 * repeat-cap alone let Purpose appear in 6 straight questions and Stability
 * in 5 (never the same pair twice, so the pair cap never triggered) —
 * exactly the kind of repetition that risks priming or fatiguing someone
 * toward an answer rather than reading their actual preference. This takes
 * priority over finishing a staleness catch-up quickly: better to spread a
 * stale cluster's relief across a couple of extra turns than to ask about
 * it three-plus times in a row.
 */
function applyClusterCooldown(
  entries: Array<[string, SurveyQuestion[]]>,
  state: DeliveryState,
): Array<[string, SurveyQuestion[]]> {
  const tail = state.recentQuestionClusters.slice(-MAX_CONSECUTIVE_CLUSTER);
  if (tail.length < MAX_CONSECUTIVE_CLUSTER) return entries;
  const onCooldown = new Set(
    CLUSTERS.filter((c) => tail.every(([a, b]) => a === c || b === c)),
  );
  if (onCooldown.size === 0) return entries;
  return entries.filter(([key]) => {
    const [a, b] = key.split("|") as ClusterKey[];
    return !onCooldown.has(a) && !onCooldown.has(b);
  });
}

/**
 * Which rule actually supplied the chosen question — returned alongside the
 * pick so a submission's real path can be audited after the fact (was the
 * staleness guard doing its job, was a validation request honored promptly)
 * without having to re-derive it by eye from raw response rows.
 */
export type SelectionTier = "staleness" | "validation" | "default" | "guard-relaxed";

export function selectNextBtQuestion(
  questions: SurveyQuestion[],
  responses: BtResponse[],
  usedIds: Set<number>,
  state: DeliveryState,
  questionIndex: number,
): { question: SurveyQuestion; nextState: DeliveryState; tier: SelectionTier } | null {
  const pool = questions.filter((q) => !usedIds.has(q.id));
  if (pool.length === 0) return null;

  const strengths = fitBradleyTerry(responses);
  const strengthOf = Object.fromEntries(CLUSTERS.map((c, i) => [c, strengths[i]])) as Record<ClusterKey, number>;

  const byPair = new Map<string, SurveyQuestion[]>();
  for (const q of pool) {
    const [a, b] = q.mappedClusters;
    const key = pairKey(a, b);
    const list = byPair.get(key) ?? [];
    list.push(q);
    byPair.set(key, list);
  }
  const allEntries = [...byPair.entries()];

  // Tier 1: staleness guard — hard ceiling, checked first so it can never be
  // starved out by validation requests winning every turn.
  const staleClusters = CLUSTERS.filter((c) => questionIndex - state.lastSeenAt[c] >= STALE_LIMIT);
  const stalenessEntries =
    staleClusters.length > 0
      ? allEntries.filter(([key]) => {
          const [a, b] = key.split("|") as ClusterKey[];
          return staleClusters.includes(a) || staleClusters.includes(b);
        })
      : [];
  // Tier 2: validate pairs whose last answer needed "it depends".
  const validationEntries = allEntries.filter(([key]) => state.pendingValidation.has(key));

  const guarded = (entries: Array<[string, SurveyQuestion[]]>) =>
    applyClusterCooldown(applyRepeatCap(entries, state), state);

  let candidates = guarded(stalenessEntries);
  const stalenessTierActive = candidates.length > 0;
  let tier: SelectionTier = "staleness";
  if (candidates.length === 0) {
    candidates = guarded(validationEntries);
    tier = "validation";
  }
  if (candidates.length === 0) {
    candidates = guarded(allEntries);
    tier = "default";
  }
  // Relax guards one at a time, weakest first, only once every tier above
  // has genuinely nothing left — cluster cooldown before the pair cap,
  // since repeating the literal same question back to back is worse than
  // two different questions merely sharing a cluster.
  if (candidates.length === 0) {
    candidates = applyRepeatCap(allEntries, state);
    tier = "guard-relaxed";
  }
  if (candidates.length === 0) {
    candidates = allEntries;
    tier = "guard-relaxed";
  }

  const strengthGap = (key: string) => {
    const [a, b] = key.split("|") as ClusterKey[];
    return Math.abs(strengthOf[a] - strengthOf[b]);
  };

  if (stalenessTierActive) {
    // Multiple clusters can be stale at once, and a question only ever
    // relieves its own two clusters — so when more than 2 are overdue in
    // the same stretch, draining that backlog takes multiple turns no
    // matter what. Two things keep the drain as fast as possible: prefer a
    // pair where BOTH sides are stale (clears two at once instead of one),
    // then within that, prefer whichever pair's most-overdue side is the
    // most overdue overall. Strength gap only breaks remaining ties.
    const staleCount = (key: string) => {
      const [a, b] = key.split("|") as ClusterKey[];
      return (staleClusters.includes(a) ? 1 : 0) + (staleClusters.includes(b) ? 1 : 0);
    };
    const severityOf = (key: string) => {
      const [a, b] = key.split("|") as ClusterKey[];
      return Math.max(questionIndex - state.lastSeenAt[a], questionIndex - state.lastSeenAt[b]);
    };
    candidates = [...candidates].sort(([keyA], [keyB]) => {
      const staleCountDiff = staleCount(keyB) - staleCount(keyA);
      if (staleCountDiff !== 0) return staleCountDiff;
      const severityDiff = severityOf(keyB) - severityOf(keyA);
      return severityDiff !== 0 ? severityDiff : strengthGap(keyA) - strengthGap(keyB);
    });
  } else {
    candidates = [...candidates].sort(([keyA], [keyB]) => strengthGap(keyA) - strengthGap(keyB));
  }

  const [chosenKey, chosenList] = candidates[0];
  const question = shuffleArray(chosenList)[0];
  const [a, b] = question.mappedClusters;

  const nextState: DeliveryState = {
    recentPairKeys: [...state.recentPairKeys, chosenKey].slice(-10),
    recentQuestionClusters: [...state.recentQuestionClusters, [a, b] as [ClusterKey, ClusterKey]].slice(-10),
    lastSeenAt: { ...state.lastSeenAt, [a]: questionIndex, [b]: questionIndex },
    pendingValidation: state.pendingValidation,
  };

  return { question, nextState, tier };
}

/**
 * Every respondent answers all 50 — no early stop. Bradley-Terry's
 * reliability signal (top3Stability, in bradleyTerry.ts) is still computed
 * and shown, but it informs the report, not whether the survey ends early;
 * a fixed-length survey gives every respondent the same, more accurate read.
 */
export function btShouldStop(_responses: BtResponse[], questionsAnswered: number, hardStop = 50): boolean {
  return questionsAnswered >= hardStop;
}
