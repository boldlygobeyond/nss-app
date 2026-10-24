// Team Snapshot scoring/layout helpers — pure functions over the existing
// Bradley-Terry output (bradleyTerry.ts), no changes to the scoring engine
// itself. Raw per-person favorability is never renormalized across the
// team — only averaged per cluster, for row ordering and the Needs
// Profile's average hash mark, both reading the exact same numbers.

import { CLUSTERS, CHART_ORDER, type ClusterKey } from "./clusters";
import { rankByBradleyTerry, btFavorability, type BtResponse } from "./bradleyTerry";

export interface TeamMemberInput {
  userId: string;
  submissionId: string;
  firstName: string;
  lastName: string;
  responses: BtResponse[];
}

export interface TeamMemberScore {
  userId: string;
  submissionId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  /** 0–1 per cluster, straight from btFavorability — not renormalized. */
  favorability: Record<ClusterKey, number>;
  /** 1 (strongest) – 7 (weakest) per cluster, within this person only. */
  rank: Record<ClusterKey, number>;
}

export function computeTeamMemberScores(members: TeamMemberInput[]): TeamMemberScore[] {
  return members.map((m) => {
    const ranked = rankByBradleyTerry(m.responses);
    const favorability = {} as Record<ClusterKey, number>;
    const rank = {} as Record<ClusterKey, number>;
    ranked.forEach((r) => {
      favorability[r.cluster] = btFavorability(r.strength);
      rank[r.cluster] = r.rank;
    });
    return {
      userId: m.userId,
      submissionId: m.submissionId,
      firstName: m.firstName,
      lastName: m.lastName,
      fullName: `${m.firstName} ${m.lastName}`.trim(),
      favorability,
      rank,
    };
  });
}

/**
 * Arithmetic mean of raw Bradley-Terry favorability per cluster, across
 * every completed team member — the single source of truth both the
 * heatmap's row order and the Needs Profile's average hash mark read, so
 * the two visualizations can never disagree about where a cluster's
 * average actually sits. Not a team-wide BT score (no cross-person
 * recomputation) — just the mean of each person's own already-computed
 * favorability value.
 */
export function computeClusterAverages(members: TeamMemberScore[]): Record<ClusterKey, number> {
  const avg = {} as Record<ClusterKey, number>;
  CLUSTERS.forEach((c) => {
    avg[c] = members.length === 0 ? 0.5 : members.reduce((sum, m) => sum + m.favorability[c], 0) / members.length;
  });
  return avg;
}

/**
 * Clusters ordered by descending team-average favorability (see
 * computeClusterAverages) — both the heatmap and Needs Profile render
 * their seven rows in this same order. Ties get a stable secondary sort
 * (the chart's fixed display order) so row order never jitters between
 * renders.
 */
export function computeTeamRowOrder(members: TeamMemberScore[]): ClusterKey[] {
  if (members.length === 0) return CHART_ORDER;
  const avg = computeClusterAverages(members);
  return [...CLUSTERS].sort((a, b) => {
    const diff = avg[b] - avg[a];
    if (Math.abs(diff) > 1e-9) return diff;
    return CHART_ORDER.indexOf(a) - CHART_ORDER.indexOf(b);
  });
}

// Five anchors instead of a single-slope ramp (linear or gamma-adjusted)
// over a plain light/dark teal pair. The earlier three-anchor version
// (10%->60%, 60%->90%) put its steepest slope around 60-90%, which left
// 40-70% — where most real pilot scores actually cluster, including the
// "no strong signal" boundary at 45-55% — nearly flat: two scores a few
// points apart in that band were visually indistinguishable. These five
// anchors spend extra slope specifically across 30-70% instead, and use
// the full 0-100% range (not 10-90%) so no real value gets clamped to an
// end-anchor's color.
const COLOR_STOPS: { at: number; hex: string }[] = [
  { at: 0.0, hex: "#F2FAFA" }, // lower priorities — subdued
  { at: 0.3, hex: "#BFE8EA" },
  { at: 0.5, hex: "#5BC7CB" }, // the "comparable to other needs" midpoint
  { at: 0.7, hex: "#0D97A0" },
  { at: 1.0, hex: "#004850" }, // strongest priorities — still the standout
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function favorabilityToTeal(value: number): string {
  const first = COLOR_STOPS[0];
  const last = COLOR_STOPS[COLOR_STOPS.length - 1];
  const clamped = Math.min(last.at, Math.max(first.at, value));

  let lower = first;
  let upper = last;
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (clamped >= COLOR_STOPS[i].at && clamped <= COLOR_STOPS[i + 1].at) {
      lower = COLOR_STOPS[i];
      upper = COLOR_STOPS[i + 1];
      break;
    }
  }

  const span = upper.at - lower.at;
  const t = span > 0 ? (clamped - lower.at) / span : 0;
  const [r1, g1, b1] = hexToRgb(lower.hex);
  const [r2, g2, b2] = hexToRgb(upper.hex);
  const r = Math.round(lerp(r1, r2, t));
  const g = Math.round(lerp(g1, g2, t));
  const b = Math.round(lerp(b1, b2, t));
  return `rgb(${r} ${g} ${b})`;
}

// CSS gradient for the legend swatch — built from the same anchors and
// positions actually used above, so the legend can never silently drift
// out of sync with what a cell's color really means.
export function heatmapLegendGradientCss(): string {
  const min = COLOR_STOPS[0].at;
  const max = COLOR_STOPS[COLOR_STOPS.length - 1].at;
  const stops = COLOR_STOPS.map((s) => `${s.hex} ${(((s.at - min) / (max - min)) * 100).toFixed(1)}%`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/**
 * Heatmap column headers: first name alone, unless two people on this team
 * share a first name, in which case just those people get a last initial
 * appended so the columns stay unambiguous without cluttering everyone
 * else's header.
 */
export function heatmapDisplayNames(members: TeamMemberScore[]): Record<string, string> {
  const counts = new Map<string, number>();
  members.forEach((m) => counts.set(m.firstName, (counts.get(m.firstName) ?? 0) + 1));
  const result: Record<string, string> = {};
  members.forEach((m) => {
    const needsDisambiguation = (counts.get(m.firstName) ?? 0) > 1;
    result[m.userId] = needsDisambiguation && m.lastName ? `${m.firstName} ${m.lastName[0]}.` : m.firstName;
  });
  return result;
}

export interface ProfileDotGroup {
  members: TeamMemberScore[];
  minValue: number;
  maxValue: number;
}

/**
 * Groups team members whose favorability for one cluster sit close enough
 * together that their dots will visually overlap on the Needs Profile, so
 * one hover/tap target can report every name at that position instead of
 * only whichever dot happens to be drawn on top of the others. Dots
 * themselves are never moved or merged — every member still gets its own
 * circle at its own true position; this only changes what a hover reveals.
 */
export function groupByProximity(
  members: TeamMemberScore[],
  cluster: ClusterKey,
  threshold = 0.035,
): ProfileDotGroup[] {
  const sorted = [...members].sort((a, b) => a.favorability[cluster] - b.favorability[cluster]);
  const groups: ProfileDotGroup[] = [];
  for (const m of sorted) {
    const value = m.favorability[cluster];
    const last = groups[groups.length - 1];
    if (last && value - last.maxValue <= threshold) {
      last.members.push(m);
      last.maxValue = value;
    } else {
      groups.push({ members: [m], minValue: value, maxValue: value });
    }
  }
  return groups;
}
