// buildInterpretation is pure and deterministic (no LLM, no DB): the raw
// average is rounded to the nearest whole number (.5 rounds up) to pick
// one of five fixed label/sentence pairs, with the cluster name
// substituted in. This checks the exact approved wording and every
// rounding boundary.
import { describe, it, expect } from "vitest";
import { buildInterpretation } from "../interpretiveCopy";

const APPROVED = {
  1: {
    label: "Not Here",
    interpretation:
      "Having your Core Stability needs met isn't something you're particularly looking for from this team.",
  },
  2: {
    label: "Noticed",
    interpretation:
      "You'd notice when your Core Stability needs are met on this team, but it wouldn't make much difference in how you show up.",
  },
  3: {
    label: "Appreciated",
    interpretation:
      "You'd appreciate having your Core Stability needs met on this team, even if it wouldn't have a lasting impact on how you show up.",
  },
  4: {
    label: "Impactful",
    interpretation:
      "Having your Core Stability needs met on this team matters to you and can meaningfully affect how you show up.",
  },
  5: {
    label: "Deal Breaker",
    interpretation:
      "Having your Core Stability needs met on this team is essential for you to show up fully. Without them, you'd find that difficult.",
  },
} as const;

describe("buildInterpretation", () => {
  it("returns the exact approved label and sentence for each whole-number category", () => {
    for (const category of [1, 2, 3, 4, 5] as const) {
      expect(buildInterpretation(category, "Core Stability")).toEqual(APPROVED[category]);
    }
  });

  it("rounds .5 up at every boundary (conventional rounding)", () => {
    expect(buildInterpretation(1.0, "Core Stability")).toEqual(APPROVED[1]);
    expect(buildInterpretation(1.5, "Core Stability")).toEqual(APPROVED[2]);
    expect(buildInterpretation(2.5, "Core Stability")).toEqual(APPROVED[3]);
    expect(buildInterpretation(3.5, "Core Stability")).toEqual(APPROVED[4]);
    expect(buildInterpretation(4.5, "Core Stability")).toEqual(APPROVED[5]);
    expect(buildInterpretation(5.0, "Core Stability")).toEqual(APPROVED[5]);
  });

  it("rounds to the nearer whole number off the boundary", () => {
    expect(buildInterpretation(1.2, "Core Stability")).toEqual(APPROVED[1]);
    expect(buildInterpretation(1.9, "Core Stability")).toEqual(APPROVED[2]);
    expect(buildInterpretation(3.4, "Core Stability")).toEqual(APPROVED[3]);
    expect(buildInterpretation(4.6, "Core Stability")).toEqual(APPROVED[5]);
  });

  it("substitutes the given cluster name into the interpretation only", () => {
    const { label, interpretation } = buildInterpretation(4.2, "Agency & Growth");
    expect(label).toBe("Impactful");
    expect(interpretation).toBe(
      "Having your Agency & Growth needs met on this team matters to you and can meaningfully affect how you show up.",
    );
  });

  it("reuses the same lookup for every cluster, varying only the substituted name", () => {
    const clusters = ["Core Stability", "Agency & Growth", "Belonging & Identity", "Emotional Ecosystem"];
    for (const clusterName of clusters) {
      const { label, interpretation } = buildInterpretation(1.0, clusterName);
      expect(label).toBe("Not Here");
      expect(interpretation).toBe(
        `Having your ${clusterName} needs met isn't something you're particularly looking for from this team.`,
      );
    }
  });
});
