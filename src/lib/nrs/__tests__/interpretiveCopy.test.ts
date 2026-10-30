// buildInterpretation is pure and deterministic (no LLM, no DB) — this
// table-drives it across the whole 1.0-5.0 range plus exact-string checks
// for the whole-number and fractional cases called out in the spec.
import { describe, it, expect } from "vitest";
import { buildInterpretation } from "../interpretiveCopy";
import { NRS_RATINGS } from "../ratingScale";

describe("buildInterpretation", () => {
  it("a fractional average references both adjacent rating levels by their exact approved descriptions", () => {
    expect(buildInterpretation(4.2)).toBe(
      'Your average rating of 4.2 reflects how important it is for you to have Core Stability needs met in order to show up fully on this team, falling between Impactful ("This would matter and affect how I show up.") and Deal Breaker ("Without it, I can\'t show up fully.").',
    );
  });

  it("a whole-number average references only that single rating level", () => {
    expect(buildInterpretation(3.0)).toBe(
      'Your average rating of 3.0 reflects how important it is for you to have Core Stability needs met in order to show up fully on this team: Appreciated ("I\'d appreciate it, but no lasting impact.").',
    );
  });

  it("the minimum and maximum possible averages each reference a single level, not an out-of-range one", () => {
    expect(buildInterpretation(1.0)).toContain('Not Here ("I\'m not looking for this need here.")');
    expect(buildInterpretation(5.0)).toContain('Deal Breaker ("Without it, I can\'t show up fully.")');
  });

  it("every 0.1 step from 1.0 to 5.0 produces a string referencing only real, approved rating labels", () => {
    for (let i = 10; i <= 50; i++) {
      const score = i / 10;
      const text = buildInterpretation(score);
      expect(text).toContain(score.toFixed(1));
      const mentionedLevels = NRS_RATINGS.filter((r) => text.includes(`${r.label} ("${r.description}")`));
      // A whole number mentions exactly one level; a fractional score
      // mentions exactly its two adjacent levels.
      expect(mentionedLevels.length).toBe(Number.isInteger(score) ? 1 : 2);
    }
  });

  it("never mentions diagnostic language or anything about whether needs are currently being met", () => {
    for (let i = 10; i <= 50; i++) {
      const text = buildInterpretation(i / 10);
      expect(text.toLowerCase()).not.toMatch(/diagnos|currently (being )?met|how well the team/);
    }
  });
});
