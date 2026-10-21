// Team Snapshot scoring/layout helpers — pure functions over the existing
// Bradley-Terry output (bradleyTerry.ts), no changes to the scoring engine
// itself. Validated against real pilot-team data before this was written:
// raw favorability (not re-normalized per person) preserves the real
// difference between concentrated and flat profiles, and average
// within-person rank was the most defensible simple row-ordering of the
// three methods tested (it agreed with the other two at the extremes,
// diverged only in the middle — same as they did with each other).

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
 * Average within-person Bradley-Terry rank per cluster, ascending (strongest
 * collective priority first). Every person contributes exactly one rank
 * 1–7 per cluster regardless of how differentiated their own answers were,
 * so this doesn't inherit the "more decisive answerer looks more extreme"
 * distortion that averaging raw favorability percentages would. Ties get a
 * stable secondary sort (the chart's fixed display order) so row order
 * never jitters between renders.
 */
export function computeTeamRowOrder(members: TeamMemberScore[]): ClusterKey[] {
  if (members.length === 0) return CHART_ORDER;
  const avgRank = {} as Record<ClusterKey, number>;
  CLUSTERS.forEach((c) => {
    avgRank[c] = members.reduce((sum, m) => sum + m.rank[c], 0) / members.length;
  });
  return [...CLUSTERS].sort((a, b) => {
    const diff = avgRank[a] - avgRank[b];
    if (Math.abs(diff) > 1e-9) return diff;
    return CHART_ORDER.indexOf(a) - CHART_ORDER.indexOf(b);
  });
}

// Color only ever maps the middle 80% of the theoretical 0–1 range — real
// pilot data topped out at 9%–94%, and the true 0%/100% ends only occur in
// degenerate all-win/all-loss cases that would otherwise burn the darkest
// and lightest cells on a case the scale will almost never see for real.
const COLOR_DOMAIN_MIN = 0.1;
const COLOR_DOMAIN_MAX = 0.9;

function clampColorT(value: number): number {
  const clamped = Math.min(COLOR_DOMAIN_MAX, Math.max(COLOR_DOMAIN_MIN, value));
  return (clamped - COLOR_DOMAIN_MIN) / (COLOR_DOMAIN_MAX - COLOR_DOMAIN_MIN);
}

// Brand teal is hsl(183 100% 34%) (globals.css --primary) — the dark end of
// this ramp lands close to it on purpose so the heatmap reads as "the same
// product," not a generic chart-library gradient.
export function favorabilityToTeal(value: number): string {
  const t = clampColorT(value);
  const saturation = 28 + t * 62; // 28% -> 90%
  const lightness = 93 - t * 63; // 93% -> 30%
  return `hsl(183 ${saturation}% ${lightness}%)`;
}

// Distinct per-person identity colors for the spectrum dots — deliberately
// rotated away from the heatmap's teal hue band (within ~20° of 183) so a
// dot's color never reads as if it were encoding a favorability value the
// way the heatmap's color does. Position encodes the value there instead.
export function personIdentityColor(index: number, total: number): string {
  const slice = 360 / Math.max(total, 1);
  let hue = (index * slice) % 360;
  if (hue > 163 && hue < 213) hue = (hue + 90) % 360;
  return `hsl(${Math.round(hue)} 62% 46%)`;
}

const BAND_PHRASES: { min: number; phrase: (name: string) => string }[] = [
  { min: 0.65, phrase: (n) => `One of ${n}'s clearer priorities` },
  { min: 0.55, phrase: (n) => `A relatively stronger priority for ${n}` },
  { min: 0.45, phrase: (n) => `Close to ${n}'s own average — no strong signal either way` },
  { min: 0.35, phrase: (n) => `A relatively lower priority for ${n}` },
  { min: -Infinity, phrase: (n) => `One of ${n}'s less prominent needs right now` },
];

export function describeFavorability(value: number, firstName: string): string {
  const band = BAND_PHRASES.find((b) => value >= b.min)!;
  return band.phrase(firstName);
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

export function initialsFor(member: TeamMemberScore): string {
  const first = member.firstName.trim()[0] ?? "";
  const last = member.lastName.trim()[0] ?? "";
  return `${first}${last}`.toUpperCase() || "?";
}

/**
 * Vertical "lane" per dot so nearly-identical scores on the same spectrum
 * row stay visually distinguishable instead of stacking exactly on top of
 * each other. Lanes are assigned from a sorted pass (closest values claim
 * adjacent lanes first) — this only ever changes a dot's vertical offset,
 * never its horizontal position, which stays a pure function of its value.
 */
export function assignSpectrumLanes(values: number[], collisionThreshold = 0.025): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const placed: { value: number; lane: number }[] = [];
  const lanes = new Array(values.length).fill(0);

  for (const { value, index } of order) {
    const used = new Set(
      placed.filter((p) => Math.abs(p.value - value) < collisionThreshold).map((p) => p.lane),
    );
    let lane = 0;
    for (let k = 0; used.has(lane); k++) {
      lane = k % 2 === 0 ? Math.floor(k / 2) + 1 : -(Math.floor(k / 2) + 1);
    }
    lanes[index] = lane;
    placed.push({ value, lane });
  }
  return lanes;
}
