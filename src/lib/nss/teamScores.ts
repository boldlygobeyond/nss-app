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

// The Needs Spectrum's three zones are not a new classification — they're
// BAND_PHRASES' existing five text bands grouped into three coarser
// buckets, using the exact same 0.55/0.45 cutoffs that already separate
// "no strong signal" from its neighbors above. "Clearer priority" and
// "relatively stronger priority" both read as the same zone; "relatively
// lower" and "less prominent" both read as the other. A dot's zone and its
// own detail text (describeFavorability) can therefore never disagree —
// they're derived from the same two numbers.
export type SpectrumZone = "lower" | "none" | "stronger";

export const SPECTRUM_ZONE_LABELS: Record<SpectrumZone, string> = {
  lower: "Lower Relative Priority",
  none: "No Strong Signal",
  stronger: "Stronger Relative Priority",
};

export function spectrumZoneFor(value: number): SpectrumZone {
  if (value >= 0.55) return "stronger";
  if (value >= 0.45) return "none";
  return "lower";
}

// Zone value-ranges, matching spectrumZoneFor exactly, and the share of
// the track each zone occupies. Track shares are presentational/nominal —
// the "no strong signal" zone covers only a 10-point value range but gets
// real visual width to hold, since it's a category boundary being drawn,
// not a proportional slice of the 0-1 value axis.
const ZONE_LAYOUT: Record<SpectrumZone, { valueMin: number; valueMax: number; trackMin: number; trackMax: number }> = {
  lower: { valueMin: 0, valueMax: 0.45, trackMin: 0, trackMax: 0.36 },
  none: { valueMin: 0.45, valueMax: 0.55, trackMin: 0.36, trackMax: 0.64 },
  stronger: { valueMin: 0.55, valueMax: 1, trackMin: 0.64, trackMax: 1 },
};

export function spectrumZoneTrackBounds(zone: SpectrumZone): { trackMin: number; trackMax: number } {
  return ZONE_LAYOUT[zone];
}

/**
 * Where a value falls within its own zone's value sub-range, as a 0-1
 * fraction — purely presentational (never used for scoring, ordering, or
 * the detail text), and always resolves against the same zone
 * spectrumZoneFor() would assign, so a dot's drawn position can never
 * fall in a different zone than what its own label says.
 */
export function spectrumWithinZoneT(value: number): number {
  const { valueMin, valueMax } = ZONE_LAYOUT[spectrumZoneFor(value)];
  return valueMax > valueMin ? (value - valueMin) / (valueMax - valueMin) : 0.5;
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
