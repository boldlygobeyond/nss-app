import { describe, it, expect } from "vitest";
import { latestResponsePerQuestion } from "../responseDedup";

interface Row {
  question_id: number;
  answered_at: string;
  selection?: "A" | "B";
  chosen_clusters?: string[];
}

function row(question_id: number, answered_at: string, selection: "A" | "B", chosen = selection === "A" ? "X" : "Y"): Row {
  return { question_id, answered_at, selection, chosen_clusters: [chosen] };
}

describe("latestResponsePerQuestion", () => {
  it("passes a normal single-answer progression through unchanged", () => {
    const rows = [
      row(1, "2026-01-01T00:00:00.000Z", "A"),
      row(2, "2026-01-01T00:00:05.000Z", "B"),
      row(3, "2026-01-01T00:00:10.000Z", "A"),
    ];
    const result = latestResponsePerQuestion(rows);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.question_id)).toEqual([1, 2, 3]);
  });

  it("keeps the later row for a Back-navigation correction (reversed choice)", () => {
    // Same shape as Arthur's real Q131 duplicate: first answer B, then a
    // later, different answer (A) for the exact same question.
    const rows = [
      row(131, "2026-10-10T23:25:54.000Z", "B", "Recognition"),
      row(131, "2026-10-10T23:26:08.000Z", "A", "Connections"),
    ];
    const result = latestResponsePerQuestion(rows);
    expect(result).toHaveLength(1);
    expect(result[0].selection).toBe("A");
    expect(result[0].chosen_clusters).toEqual(["Connections"]);
  });

  it("collapses a matching duplicate (same answer repeated) to one row", () => {
    // Same shape as real pilot data (e.g. submission 03ed07c0's Q9): two
    // rows under half a second apart, identical selection — the exit-
    // animation stray-click pattern, not a genuine correction.
    const rows = [
      row(9, "2026-10-08T22:03:38.448Z", "A", "Belonging"),
      row(9, "2026-10-08T22:03:38.819Z", "A", "Belonging"),
    ];
    const result = latestResponsePerQuestion(rows);
    expect(result).toHaveLength(1);
    expect(result[0].selection).toBe("A");
  });

  it("handles rapid successive answer changes (3+ rows for one question)", () => {
    const rows = [
      row(13, "2026-09-25T18:20:02.000Z", "A", "Purpose"),
      row(13, "2026-09-25T18:20:04.000Z", "B", "Belonging"),
      row(13, "2026-09-25T18:20:20.000Z", "B", "Belonging"),
    ];
    const result = latestResponsePerQuestion(rows);
    expect(result).toHaveLength(1);
    expect(result[0].chosen_clusters).toEqual(["Belonging"]);
  });

  it("picks the winner by answered_at value, not array/arrival order (async writes landing out of order)", () => {
    // The later answer (by its own timestamp) appears FIRST in the array —
    // simulating a slower request for the earlier answer landing after a
    // faster request for the later one.
    const rows = [
      row(5, "2026-01-01T00:00:10.000Z", "B", "Y"),
      row(5, "2026-01-01T00:00:05.000Z", "A", "X"),
    ];
    const result = latestResponsePerQuestion(rows);
    expect(result).toHaveLength(1);
    expect(result[0].selection).toBe("B");
  });

  it("leaves no trace of a skipped question (simply never appears in the rows)", () => {
    const rows = [row(1, "2026-01-01T00:00:00.000Z", "A")];
    // Question 2 was skipped — no row for it at all, by construction of the
    // real write path (handleSkip never calls upsertResponse).
    const result = latestResponsePerQuestion(rows);
    expect(result.map((r) => r.question_id)).toEqual([1]);
  });

  it("is idempotent — deduplicating already-deduplicated data is a no-op", () => {
    // This is the property that makes a cross-device resume safe: reading
    // back already-authoritative rows and deduplicating them again can
    // never change anything.
    const rows = [row(1, "2026-01-01T00:00:00.000Z", "A"), row(2, "2026-01-01T00:00:05.000Z", "B")];
    const once = latestResponsePerQuestion(rows);
    const twice = latestResponsePerQuestion(once);
    expect(twice).toEqual(once);
  });

  it("sorts the result chronologically by the surviving row's answered_at", () => {
    const rows = [
      row(3, "2026-01-01T00:00:10.000Z", "A"),
      row(1, "2026-01-01T00:00:00.000Z", "A"),
      row(2, "2026-01-01T00:00:05.000Z", "A"),
    ];
    const result = latestResponsePerQuestion(rows);
    expect(result.map((r) => r.question_id)).toEqual([1, 2, 3]);
  });

  it("handles an empty input", () => {
    expect(latestResponsePerQuestion([])).toEqual([]);
  });
});
