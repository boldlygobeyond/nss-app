// Team Needs Constellation — pure geometry for projecting each person's
// full seven-cluster favorability profile into a 2D similarity map.
// Deliberately separate from teamScores.ts: this module is about distance
// and projection math, not interpretation language, and touches none of
// the existing heatmap/spectrum calculations.

import { CLUSTERS, type ClusterKey } from "./clusters";

/**
 * Plain Euclidean distance across all seven raw favorability values.
 *
 * Considered and rejected: cosine/correlation distance on ranks, which
 * would compare only the *shape* of two profiles and treat a sharply
 * concentrated person and a nearly-flat person who share the same
 * ranking as identical. That throws away exactly the kind of
 * concentration signal this project has deliberately preserved
 * everywhere else (the heatmap and spectrum both explicitly avoid
 * per-person normalization for the same reason). Plain Euclidean
 * distance keeps that signal: two people who agree on *which* clusters
 * matter but differ in *how strongly* they feel about them are
 * correctly measured as different, not identical. It's also the more
 * defensible choice here because every person's seven values already
 * share the same reference point — favorability is anchored so 50%
 * always means "this person's own average cluster" — so comparing raw
 * values dimension-by-dimension across people is comparing like with
 * like, not mixing incompatible scales.
 */
export function euclideanDistance(
  a: Record<ClusterKey, number>,
  b: Record<ClusterKey, number>,
): number {
  let sumSq = 0;
  for (const c of CLUSTERS) {
    const d = a[c] - b[c];
    sumSq += d * d;
  }
  return Math.sqrt(sumSq);
}

export function buildDistanceMatrix(profiles: Record<ClusterKey, number>[]): number[][] {
  const n = profiles.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 0 : euclideanDistance(profiles[i], profiles[j]))),
  );
}

/**
 * Jacobi eigenvalue algorithm for small symmetric matrices — classical MDS
 * only ever needs this on an N x N matrix where N is the team's completed-
 * respondent count, so a simple, dependency-free, deterministic method is
 * more appropriate here than pulling in a general-purpose linear algebra
 * library for a handful of rows.
 */
function jacobiEigen(matrix: number[][], maxSweeps = 100, tol = 1e-12): { values: number[]; vectors: number[][] } {
  const n = matrix.length;
  const A = matrix.map((row) => [...row]);
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let offDiagSum = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) offDiagSum += A[p][q] * A[p][q];
    }
    if (offDiagSum < tol) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-14) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        const app = A[p][p];
        const aqq = A[q][q];
        const apq = A[p][q];
        A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        A[p][q] = 0;
        A[q][p] = 0;
        for (let i = 0; i < n; i++) {
          if (i === p || i === q) continue;
          const aip = A[i][p];
          const aiq = A[i][q];
          A[i][p] = c * aip - s * aiq;
          A[p][i] = A[i][p];
          A[i][q] = s * aip + c * aiq;
          A[q][i] = A[i][q];
        }
        for (let i = 0; i < n; i++) {
          const vip = V[i][p];
          const viq = V[i][q];
          V[i][p] = c * vip - s * viq;
          V[i][q] = s * vip + c * viq;
        }
      }
    }
  }

  const values = Array.from({ length: n }, (_, i) => A[i][i]);
  const vectors = Array.from({ length: n }, (_, k) => Array.from({ length: n }, (_, i) => V[i][k]));
  return { values, vectors };
}

export interface MdsResult {
  /** [x, y] per input profile, same order as the input array. */
  coords: [number, number][];
  /** Normalized (Kruskal stress-1) fit of the 2D projection to the true distances, in [0, ~1]. */
  stress: number;
}

/**
 * Classical (Torgerson) multidimensional scaling: double-centers the
 * squared-distance matrix, eigendecomposes it, and uses the two largest
 * eigenvalues/eigenvectors as 2D coordinates. Fully deterministic for a
 * given distance matrix — no random initialization, unlike iterative
 * (stress-minimization) MDS variants, which is what "stable positions
 * across rerenders" actually requires.
 */
export function classicalMDS(distances: number[][]): MdsResult {
  const n = distances.length;
  if (n === 0) return { coords: [], stress: 0 };
  if (n === 1) return { coords: [[0, 0]], stress: 0 };

  const d2 = distances.map((row) => row.map((v) => v * v));
  const rowMeans = d2.map((row) => row.reduce((a, b) => a + b, 0) / n);
  const grandMean = rowMeans.reduce((a, b) => a + b, 0) / n;
  const B = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => -0.5 * (d2[i][j] - rowMeans[i] - rowMeans[j] + grandMean)),
  );

  const { values, vectors } = jacobiEigen(B);
  const order = values.map((_, i) => i).sort((a, b) => values[b] - values[a]);

  const coords: [number, number][] = Array.from({ length: n }, () => [0, 0]);
  for (let axis = 0; axis < 2; axis++) {
    const idx = order[axis];
    const lambda = Math.max(values[idx], 0);
    const vec = vectors[idx];
    // Sign is arbitrary from the eigendecomposition (a flipped eigenvector
    // is an equally valid solution) — fix it deterministically so the same
    // input always renders the same orientation, not an occasional mirror
    // image across reloads or minor floating-point differences.
    let maxAbsIdx = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(vec[i]) > Math.abs(vec[maxAbsIdx])) maxAbsIdx = i;
    }
    const sign = vec[maxAbsIdx] < 0 ? -1 : 1;
    const scale = Math.sqrt(lambda);
    for (let i = 0; i < n; i++) coords[i][axis] = sign * vec[i] * scale;
  }

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dhat = Math.hypot(coords[i][0] - coords[j][0], coords[i][1] - coords[j][1]);
      num += (distances[i][j] - dhat) ** 2;
      den += distances[i][j] ** 2;
    }
  }
  const stress = den > 0 ? Math.sqrt(num / den) : 0;

  return { coords, stress };
}

/**
 * Fits MDS coordinates into a square 0-100 virtual unit box, using one
 * uniform scale factor for both axes — scaling X and Y independently
 * would stretch whichever axis has the smaller spread, distorting the
 * very distances this projection exists to preserve.
 */
export function fitToUnitSquare(coords: [number, number][], padding = 14): [number, number][] {
  if (coords.length === 0) return [];
  if (coords.length === 1) return [[50, 50]];

  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const inner = 100 - padding * 2;
  const scale = Math.min(inner / spanX, inner / spanY);

  const centerOffsetX = (inner - spanX * scale) / 2;
  const centerOffsetY = (inner - spanY * scale) / 2;

  return coords.map(([x, y]) => [
    padding + centerOffsetX + (x - minX) * scale,
    padding + centerOffsetY + (y - minY) * scale,
  ]);
}

/**
 * Gently nudges apart any pair of points closer than minDist, in the same
 * 0-100 unit-square space fitToUnitSquare produces. Capped at a handful of
 * iterations with a direct minimal push (not a spring/force simulation),
 * so it clears genuine overlaps for legibility without snowballing into a
 * rearrangement that no longer reflects the underlying distances — points
 * that aren't actually overlapping are never touched.
 */
export function resolveOverlaps(points: [number, number][], minDist = 9, iterations = 3): [number, number][] {
  const pts: [number, number][] = points.map((p) => [...p] as [number, number]);
  const n = pts.length;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pts[j][0] - pts[i][0];
        const dy = pts[j][1] - pts[i][1];
        const dist = Math.hypot(dx, dy) || 0.0001;
        if (dist >= minDist) continue;
        const push = (minDist - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        pts[i][0] -= ux * push;
        pts[i][1] -= uy * push;
        pts[j][0] += ux * push;
        pts[j][1] += uy * push;
      }
    }
  }

  return pts;
}
