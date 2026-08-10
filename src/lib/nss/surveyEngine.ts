/**
 * NSS Survey Engine — Win/Loss Tally Model
 *
 * Ported from Base44's src/lib/surveyEngine.js. Each A/B question maps each
 * option to specific clusters. Choosing an option records:
 *   - a WIN for the cluster(s) of the chosen option
 *   - a LOSS for the cluster(s) of the rejected option
 *
 * Win Rate = wins / (wins + losses)  (shown as %)
 *
 * Phases:
 *  - Calibration  Q1–Q21: present exactly 21 questions ensuring all 7 clusters
 *                         appear equally as options (3 appearances per cluster
 *                         as A-side, 3 as B-side across 21 questions).
 *  - Termination check at Q21: stop if >=3 clusters have winRate >= 75%
 *                               AND >=2 clusters have winRate <= 25%
 *  - Adaptive     Q22–Q56: blocks of 7. Prioritise questions that feature
 *                           clusters with "middle" win rates (40–60%).
 *                           Re-run termination check after each block.
 *  - Hard stop    Q50: always stop.
 */

import { CLUSTERS, type ClusterKey } from "./clusters";
import type { SurveyQuestion } from "./questions";

export type Tally = Record<ClusterKey, { wins: number; losses: number }>;

// ─── Tally helpers ──────────────────────────────────────────────────────────

export function initTally(): Tally {
  const t = {} as Tally;
  CLUSTERS.forEach((c) => {
    t[c] = { wins: 0, losses: 0 };
  });
  return t;
}

/** Win rate in [0, 1]. Returns 0.5 when no data yet (neutral). */
export function winRate(tally: Tally, cluster: ClusterKey): number {
  const { wins, losses } = tally[cluster];
  const total = wins + losses;
  return total === 0 ? 0.5 : wins / total;
}

export function recordAnswer(
  tally: Tally,
  chosenClusters: ClusterKey[],
  rejectedClusters: ClusterKey[],
): Tally {
  const next: Tally = JSON.parse(JSON.stringify(tally));
  chosenClusters.forEach((c) => {
    if (next[c]) next[c].wins++;
  });
  rejectedClusters.forEach((c) => {
    if (next[c]) next[c].losses++;
  });
  return next;
}

// ─── Termination check ──────────────────────────────────────────────────────

export function hasTerminationSignal(tally: Tally, questionsAnswered = 0): boolean {
  const hasData = (c: ClusterKey) => tally[c].wins + tally[c].losses >= 3;
  const ratesWithData = CLUSTERS.filter(hasData).map((c) => winRate(tally, c));

  if (ratesWithData.length < 5) return false; // need data on most clusters

  let highThresh: number;
  let lowThresh: number;
  if (questionsAnswered <= 21) {
    highThresh = 0.72;
    lowThresh = 0.28;
  } else if (questionsAnswered <= 28) {
    highThresh = 0.7;
    lowThresh = 0.3;
  } else if (questionsAnswered <= 35) {
    highThresh = 0.68;
    lowThresh = 0.32;
  } else {
    highThresh = 0.65;
    lowThresh = 0.35;
  }

  const highCount = ratesWithData.filter((r) => r >= highThresh).length;
  const lowCount = ratesWithData.filter((r) => r <= lowThresh).length;

  if (highCount >= 3 && lowCount >= 2) return true;

  // Looser fallback after Q35: if 5+ clusters are clearly resolved, stop
  if (questionsAnswered >= 35) {
    const resolved = ratesWithData.filter((r) => r >= 0.65 || r <= 0.35).length;
    if (resolved >= 5) return true;
  }

  return false;
}

export function shouldStop(tally: Tally, questionsAnswered: number): boolean {
  if (questionsAnswered >= 50) return true;
  return hasTerminationSignal(tally, questionsAnswered);
}

// ─── Question sequencing ─────────────────────────────────────────────────────

/**
 * Build the calibration sequence: Q1–Q21.
 * Guarantees every cluster appears exactly 3 times as A-side option
 * and 3 times as B-side option across 21 questions.
 */
export function buildCalibrationSequence(questions: SurveyQuestion[]): {
  calibration: SurveyQuestion[];
  usedIds: Set<number>;
} {
  const TARGET = 3;
  const aCounts = {} as Record<ClusterKey, number>;
  const bCounts = {} as Record<ClusterKey, number>;
  CLUSTERS.forEach((c) => {
    aCounts[c] = 0;
    bCounts[c] = 0;
  });

  const pool = shuffleArray(questions);
  const selected: SurveyQuestion[] = [];
  const used = new Set<number>();

  for (let pass = 0; pass < 3 && selected.length < 21; pass++) {
    for (const q of pool) {
      if (used.has(q.id) || selected.length >= 21) continue;
      const [cA, cB] = q.mappedClusters;
      if (!cA || !cB) continue;
      if (aCounts[cA] < TARGET && bCounts[cB] < TARGET) {
        selected.push(q);
        used.add(q.id);
        aCounts[cA]++;
        bCounts[cB]++;
      }
    }
  }

  // If we couldn't fill 21 cleanly (edge case), pad with any unused question
  if (selected.length < 21) {
    for (const q of pool) {
      if (selected.length >= 21) break;
      if (!used.has(q.id)) {
        selected.push(q);
        used.add(q.id);
      }
    }
  }

  return {
    calibration: selected.slice(0, 21),
    usedIds: new Set(selected.slice(0, 21).map((q) => q.id)),
  };
}

/**
 * Select the next block of 7 questions for the adaptive phase.
 * Prioritises questions that contain at least one cluster with a "middle"
 * win rate (40%–60%), since those clusters need more data to resolve.
 */
export function selectAdaptiveBlock(
  questions: SurveyQuestion[],
  tally: Tally,
  usedIds: Set<number>,
): SurveyQuestion[] {
  const available = questions.filter((q) => !usedIds.has(q.id));
  if (available.length === 0) return [];

  const isMidRange = (c: ClusterKey) => {
    const r = winRate(tally, c);
    return r >= 0.4 && r <= 0.6;
  };

  const scored = available.map((q) => ({
    q,
    priority: q.mappedClusters.some(isMidRange) ? 1 : 0,
  }));

  const high = shuffleArray(scored.filter((s) => s.priority === 1)).map((s) => s.q);
  const low = shuffleArray(scored.filter((s) => s.priority === 0)).map((s) => s.q);

  return [...high, ...low].slice(0, 7);
}

// ─── Scoring / reporting helpers ─────────────────────────────────────────────

export interface ClusterScore {
  wins: number;
  losses: number;
  total: number;
  winRate: number;
}

export function tallyToScores(tally: Tally): Record<ClusterKey, ClusterScore> {
  const result = {} as Record<ClusterKey, ClusterScore>;
  CLUSTERS.forEach((c) => {
    const { wins, losses } = tally[c];
    result[c] = { wins, losses, total: wins + losses, winRate: winRate(tally, c) };
  });
  return result;
}

export interface TopNeed {
  cluster: ClusterKey;
  wins: number;
  losses: number;
  total: number;
  winRate: number;
}

export function getTopNeeds(tally: Tally): TopNeed[] {
  return CLUSTERS.map((c) => {
    const { wins, losses } = tally[c];
    return { cluster: c, wins, losses, total: wins + losses, winRate: winRate(tally, c) };
  }).sort((a, b) => b.winRate - a.winRate);
}

// ─── Pairwise matchups ──────────────────────────────────────────────────────

export interface PairwiseMatchup {
  a: ClusterKey;
  b: ClusterKey;
  aWins: number;
  bWins: number;
  total: number;
}

/**
 * Head-to-head tallies between cluster pairs, computed from the raw
 * chosen/rejected cluster on each answered question — the actual trade-offs
 * the person made, not an inference from aggregate win rates. Used to ground
 * report language like "when X and Y pulled in opposite directions, you
 * chose X" in something that really happened, rather than a plausible-
 * sounding guess.
 */
export function computePairwiseMatchups(
  responses: { chosen_clusters: ClusterKey[]; rejected_clusters: ClusterKey[] }[],
): PairwiseMatchup[] {
  const matchups = new Map<string, PairwiseMatchup>();

  for (const r of responses) {
    const chosen = r.chosen_clusters[0];
    const rejected = r.rejected_clusters[0];
    if (!chosen || !rejected) continue;

    const [a, b] = [chosen, rejected].sort();
    const key = `${a}|${b}`;
    const existing = matchups.get(key) ?? { a, b, aWins: 0, bWins: 0, total: 0 };
    existing.total++;
    if (chosen === a) existing.aWins++;
    else existing.bWins++;
    matchups.set(key, existing);
  }

  return Array.from(matchups.values());
}

// ─── Utility ─────────────────────────────────────────────────────────────────

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
