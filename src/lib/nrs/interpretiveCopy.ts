// Deterministic, template-based results-email interpretation — no LLM
// generation, no diagnostic categories, no per-response analysis. Just the
// score itself; the sentence stops there rather than restating the rating
// band's label/description, which read as too wordy in the actual email.
export function buildInterpretation(score: number): string {
  const fixed = score.toFixed(1);
  return `Your average rating of ${fixed} reflects how important it is for you to have Core Stability needs met in order to show up fully on this team.`;
}
