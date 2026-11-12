import { NRS_RATINGS } from "./ratingScale";

// Deterministic, template-based results-email interpretation — no LLM
// generation. The *category* is the raw average rounded to the nearest
// whole number (conventional rounding, .5 rounds up — Math.round already
// does this for our always-positive 1-5 range), never the one-decimal
// score shown alongside it. Wording is verbatim from the approved spec —
// do not rephrase. Labels are reused from ratingScale.ts's NRS_RATINGS so
// there's one place defining what each 1-5 value is called.
const RESONANCE_INTERPRETATIONS: Record<number, (clusterName: string) => string> = {
  1: (clusterName) => `Having your ${clusterName} needs met isn't something you're particularly looking for from this team.`,
  2: (clusterName) =>
    `You'd notice when your ${clusterName} needs are met on this team, but it wouldn't make much difference in how you show up.`,
  3: (clusterName) =>
    `You'd appreciate having your ${clusterName} needs met on this team, even if it wouldn't have a lasting impact on how you show up.`,
  4: (clusterName) =>
    `Having your ${clusterName} needs met on this team matters to you and can meaningfully affect how you show up.`,
  5: (clusterName) =>
    `Having your ${clusterName} needs met on this team is essential for you to show up fully. Without them, you'd find that difficult.`,
};

export function buildInterpretation(score: number, clusterName: string): { label: string; interpretation: string } {
  const category = Math.round(score);
  const label = NRS_RATINGS[category - 1].label;
  return { label, interpretation: RESONANCE_INTERPRETATIONS[category](clusterName) };
}
