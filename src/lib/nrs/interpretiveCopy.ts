import { NRS_RATINGS } from "./ratingScale";

// Deterministic, template-based results-email interpretation — no LLM
// generation, no invented score bands beyond the 5 rating levels already
// defined, no diagnostic categories, no per-response analysis. The
// already-approved rating label + description IS the interpretation, used
// directly rather than restated in different words.
export function buildInterpretation(score: number): string {
  const lower = Math.max(1, Math.min(5, Math.floor(score))) as 1 | 2 | 3 | 4 | 5;
  const upper = Math.max(1, Math.min(5, Math.ceil(score))) as 1 | 2 | 3 | 4 | 5;
  const fixed = score.toFixed(1);

  if (lower === upper) {
    const level = NRS_RATINGS[lower - 1];
    return `Your average rating of ${fixed} reflects how important it is for you to have Core Stability needs met in order to show up fully on this team: ${level.label} ("${level.description}").`;
  }

  const lowerLevel = NRS_RATINGS[lower - 1];
  const upperLevel = NRS_RATINGS[upper - 1];
  return `Your average rating of ${fixed} reflects how important it is for you to have Core Stability needs met in order to show up fully on this team, falling between ${lowerLevel.label} ("${lowerLevel.description}") and ${upperLevel.label} ("${upperLevel.description}").`;
}
