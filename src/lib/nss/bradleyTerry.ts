/**
 * Bradley-Terry scoring — replaces plain win/loss tallying with a pairwise
 * comparison model that accounts for strength of schedule.
 *
 * Plain win rate (surveyEngine.ts's Win/Loss Tally Model) treats every
 * matchup as equally informative, so a cluster that happened to face weak
 * opponents can rank above one that held its own against strong ones. This
 * module fits each cluster a latent "strength" via the standard MM/Zermelo
 * algorithm for Bradley-Terry models — the same math behind chess ratings —
 * which reasons transitively (if A beats B and B beats C, that's evidence
 * about A vs C even with no direct A-vs-C data) and degrades gracefully on
 * the current question bank's uneven pair coverage, rather than requiring a
 * balanced round robin to be trustworthy.
 */

import { CLUSTERS, type ClusterKey } from "./clusters";

const N = CLUSTERS.length;
const IDX: Record<ClusterKey, number> = Object.fromEntries(
  CLUSTERS.map((c, i) => [c, i]),
) as Record<ClusterKey, number>;

export interface BtResponse {
  chosen_clusters: ClusterKey[];
  rejected_clusters: ClusterKey[];
}

/** wins[i][j] = number of times cluster i beat cluster j. */
type WinMatrix = number[][];

function buildWinMatrix(responses: BtResponse[]): WinMatrix {
  const W: WinMatrix = Array.from({ length: N }, () => new Array(N).fill(0));
  for (const r of responses) {
    const chosen = r.chosen_clusters[0];
    const rejected = r.rejected_clusters[0];
    if (!chosen || !rejected) continue;
    W[IDX[chosen]][IDX[rejected]] += 1;
  }
  return W;
}

/**
 * Fits Bradley-Terry strengths via the MM (minorization-maximization)
 * algorithm, a.k.a. Zermelo's algorithm. Returns p_i = exp(beta_i),
 * normalized so the geometric mean across clusters is 1. Requires the
 * comparison graph to be connected — a cluster with zero comparisons to
 * the rest keeps its default strength of 1 (tied for last), since its
 * relative strength is genuinely undefined from the data.
 */
export function fitBradleyTerry(responses: BtResponse[], iters = 300, tol = 1e-9): number[] {
  const W = buildWinMatrix(responses);
  const n: number[][] = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => W[i][j] + W[j][i]),
  );
  const wins = W.map((row) => row.reduce((a, b) => a + b, 0));

  let p = new Array(N).fill(1);
  for (let iter = 0; iter < iters; iter++) {
    const pNew = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      let denom = 0;
      for (let j = 0; j < N; j++) {
        if (i === j || n[i][j] === 0) continue;
        denom += n[i][j] / (p[i] + p[j]);
      }
      pNew[i] = denom > 0 ? wins[i] / denom : p[i];
    }
    const gm = Math.exp(pNew.reduce((a, b) => a + Math.log(Math.max(b, 1e-9)), 0) / N);
    for (let i = 0; i < N; i++) pNew[i] /= gm;

    let maxDiff = 0;
    for (let i = 0; i < N; i++) maxDiff = Math.max(maxDiff, Math.abs(pNew[i] - p[i]));
    p = pNew;
    if (maxDiff < tol) break;
  }
  return p;
}

export interface BtRanked {
  cluster: ClusterKey;
  strength: number;
  rank: number;
}

export function rankByBradleyTerry(responses: BtResponse[]): BtRanked[] {
  const p = fitBradleyTerry(responses);
  return CLUSTERS.map((cluster, i) => ({ cluster, strength: p[i], rank: 0 }))
    .sort((a, b) => b.strength - a.strength)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Converts a Bradley-Terry strength into a 0-1 "favorability" figure, for
 * display anywhere the app previously showed a plain win rate (the needs
 * chart, top_needs/scores on the submission). fitBradleyTerry normalizes
 * strengths so their geometric mean is 1, so this is exactly the model's
 * own predicted win probability against a hypothetical average-strength
 * cluster — the natural BT-consistent replacement for "wins / total",
 * monotonic in strength so it never disagrees with the BT rank order.
 */
export function btFavorability(strength: number): number {
  return strength / (strength + 1);
}

/**
 * Bootstrap-resamples the actual answered responses to estimate how stable
 * the top-3 *set* is — the reliability signal plain win rate can't produce.
 * A resample that leaves the comparison graph disconnected is skipped
 * (can't be ranked), matching what real sparse data does to this model.
 */
export function top3Stability(responses: BtResponse[], nBoot = 400, seed = 1): {
  stability: number;
  pointTop3: ClusterKey[];
  perClusterTop3Rate: Record<ClusterKey, number>;
} {
  const pointRanked = rankByBradleyTerry(responses);
  const pointTop3 = pointRanked.slice(0, 3).map((r) => r.cluster);
  const pointTop3Set = new Set(pointTop3);

  // Deterministic, dependency-free PRNG (mulberry32) so results are reproducible.
  let s = seed;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let ok = 0;
  let valid = 0;
  const top3Counts: Record<ClusterKey, number> = Object.fromEntries(
    CLUSTERS.map((c) => [c, 0]),
  ) as Record<ClusterKey, number>;

  for (let b = 0; b < nBoot; b++) {
    const sample: BtResponse[] = [];
    for (let i = 0; i < responses.length; i++) {
      sample.push(responses[Math.floor(rand() * responses.length)]);
    }
    const W = buildWinMatrix(sample);
    // connectivity check via union-find over pairs with at least one game
    const parent = Array.from({ length: N }, (_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        if (W[i][j] + W[j][i] > 0) {
          const ri = find(i);
          const rj = find(j);
          if (ri !== rj) parent[ri] = rj;
        }
      }
    }
    const roots = new Set(CLUSTERS.map((_, i) => find(i)));
    if (roots.size > 1) continue; // disconnected resample, can't rank

    valid++;
    const ranked = rankByBradleyTerry(sample);
    const top3 = ranked.slice(0, 3).map((r) => r.cluster);
    top3.forEach((c) => (top3Counts[c] += 1));
    if (top3.length === 3 && top3.every((c) => pointTop3Set.has(c))) ok++;
  }

  const perClusterTop3Rate = Object.fromEntries(
    CLUSTERS.map((c) => [c, valid > 0 ? top3Counts[c] / valid : 0]),
  ) as Record<ClusterKey, number>;

  return { stability: valid > 0 ? ok / valid : 0, pointTop3, perClusterTop3Rate };
}
