// buildInterpretation is pure and deterministic (no LLM, no DB) — this
// checks the exact approved sentence across the whole 1.0-5.0 range.
import { describe, it, expect } from "vitest";
import { buildInterpretation } from "../interpretiveCopy";

describe("buildInterpretation", () => {
  it("states the score and stops — no rating band label/description appended", () => {
    expect(buildInterpretation(3.7)).toBe(
      "Your average rating of 3.7 reflects how important it is for you to have Core Stability needs met in order to show up fully on this team.",
    );
  });

  it("formats a whole-number average with one decimal place", () => {
    expect(buildInterpretation(3.0)).toBe(
      "Your average rating of 3.0 reflects how important it is for you to have Core Stability needs met in order to show up fully on this team.",
    );
  });

  it("every 0.1 step from 1.0 to 5.0 produces the same sentence shape with just the score substituted", () => {
    for (let i = 10; i <= 50; i++) {
      const score = i / 10;
      const text = buildInterpretation(score);
      expect(text).toBe(
        `Your average rating of ${score.toFixed(1)} reflects how important it is for you to have Core Stability needs met in order to show up fully on this team.`,
      );
    }
  });

  it("never mentions diagnostic language or anything about whether needs are currently being met", () => {
    for (let i = 10; i <= 50; i++) {
      const text = buildInterpretation(i / 10);
      expect(text.toLowerCase()).not.toMatch(/diagnos|currently (being )?met|how well the team/);
    }
  });
});
