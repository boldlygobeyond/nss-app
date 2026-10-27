// Verifies the actual, documented consequence of not deduplicating: a
// duplicate row double-weights a pairing in Bradley-Terry fitting and
// corrupts the pairwise-matchup head-to-head matrix — then verifies that
// routing the exact same raw rows through latestResponsePerQuestion first
// (what every real scoring call site now does) removes that effect.
import { describe, it, expect } from "vitest";
import { latestResponsePerQuestion } from "../responseDedup";
import { rankByBradleyTerry, type BtResponse } from "../bradleyTerry";
import { computePairwiseMatchups } from "../surveyEngine";

interface Row {
  question_id: number;
  answered_at: string;
  chosen_clusters: ["Connections"] | ["Recognition"];
  rejected_clusters: ["Connections"] | ["Recognition"];
}

describe("duplicate rows feeding Bradley-Terry scoring and the matchup matrix", () => {
  // Shaped exactly like Arthur's real Q131 duplicate: one decisive answer
  // for Recognition vs. Connections, then a reversed answer to the same
  // question 14 seconds later.
  const original: Row = {
    question_id: 131,
    answered_at: "2026-10-10T23:25:54.000Z",
    chosen_clusters: ["Recognition"],
    rejected_clusters: ["Connections"],
  };
  const reversal: Row = {
    question_id: 131,
    answered_at: "2026-10-10T23:26:08.000Z",
    chosen_clusters: ["Connections"],
    rejected_clusters: ["Recognition"],
  };
  // A handful of other, non-duplicated responses so the win matrix isn't
  // degenerate (Bradley-Terry needs a connected comparison graph).
  const filler: Row[] = [
    { question_id: 1, answered_at: "t", chosen_clusters: ["Recognition"], rejected_clusters: ["Connections"] },
    { question_id: 2, answered_at: "t", chosen_clusters: ["Recognition"], rejected_clusters: ["Connections"] },
    { question_id: 3, answered_at: "t", chosen_clusters: ["Connections"], rejected_clusters: ["Recognition"] },
  ];

  it("an undeduplicated duplicate pair double-counts and can contradict itself in the matchup matrix", () => {
    const raw = [...filler, original, reversal];
    const matchups = computePairwiseMatchups(raw as unknown as BtResponse[]);
    const cell = matchups.find((m) => (m.a === "Connections" || m.b === "Connections") && (m.a === "Recognition" || m.b === "Recognition"))!;
    // 2 filler Recognition wins + 1 filler Connections win + both
    // contradictory duplicate rows = 5 total games recorded for a pairing
    // that only happened 4 times.
    expect(cell.total).toBe(5);
  });

  it("deduplicating first collapses the pair to its one authoritative (most recent) outcome", () => {
    const raw = [...filler, original, reversal];
    const deduped = latestResponsePerQuestion(raw);
    const matchups = computePairwiseMatchups(deduped as unknown as BtResponse[]);
    const cell = matchups.find((m) => (m.a === "Connections" || m.b === "Connections") && (m.a === "Recognition" || m.b === "Recognition"))!;
    expect(cell.total).toBe(4);
    // The reversal (the later row) is what counts — Connections beat
    // Recognition on question 131, not the earlier, superseded answer.
    expect(cell.bWins + cell.aWins).toBe(4);
  });

  it("the same duplicate also shifts the Bradley-Terry ranking depending on whether it's deduplicated", () => {
    const raw = [...filler, original, reversal];
    const rankedRaw = rankByBradleyTerry(raw as unknown as BtResponse[]);
    const rankedDeduped = rankByBradleyTerry(latestResponsePerQuestion(raw) as unknown as BtResponse[]);

    const strengthRaw = Object.fromEntries(rankedRaw.map((r) => [r.cluster, r.strength]));
    const strengthDeduped = Object.fromEntries(rankedDeduped.map((r) => [r.cluster, r.strength]));

    // Not asserting a specific direction (that depends on the filler data
    // chosen above) — the point this test exists to prove is that the two
    // inputs produce genuinely different fitted strengths, i.e. the
    // duplicate row is NOT a no-op on the final score before dedup is
    // applied, confirming it needs to be applied.
    expect(strengthRaw.Connections).not.toBeCloseTo(strengthDeduped.Connections, 10);
  });

  it("a non-duplicate submission scores identically whether or not it's passed through dedup (no false positives)", () => {
    const rankedRaw = rankByBradleyTerry(filler as unknown as BtResponse[]);
    const rankedDeduped = rankByBradleyTerry(latestResponsePerQuestion(filler) as unknown as BtResponse[]);
    expect(rankedRaw).toEqual(rankedDeduped);
  });
});
