// Consolidated report prompt — one document shared verbatim between the
// employee and their manager, replacing the old separate employee/manager
// report generators.

import { CLUSTER_LABELS } from "./clusters";
import type { TopNeed, PairwiseMatchup } from "./surveyEngine";

function rankedList(topNeeds: TopNeed[]): string {
  return topNeeds.map((n, i) => `${i + 1}. ${CLUSTER_LABELS[n.cluster]} (${n.total} signals)`).join("\n");
}

function matchupSummary(matchups: PairwiseMatchup[], topClusters: Set<string>): string {
  const relevant = matchups
    .filter((m) => topClusters.has(m.a) || topClusters.has(m.b))
    .sort((x, y) => y.total - x.total)
    .slice(0, 8);

  if (relevant.length === 0) return "(no head-to-head data available)";

  return relevant
    .map((m) => {
      const aLabel = CLUSTER_LABELS[m.a];
      const bLabel = CLUSTER_LABELS[m.b];
      const winner = m.aWins >= m.bWins ? aLabel : bLabel;
      const winnerCount = Math.max(m.aWins, m.bWins);
      return `${aLabel} vs ${bLabel}: chose ${winner} ${winnerCount} of ${m.total} times`;
    })
    .join("\n");
}

export function buildReportPrompt(params: {
  firstName: string;
  respondentName: string;
  pronouns: string;
  topNeeds: TopNeed[];
  matchups: PairwiseMatchup[];
}): string {
  const { firstName, pronouns, topNeeds, matchups } = params;
  const top3 = topNeeds.slice(0, 3);
  const top3Labels = top3.map((n) => CLUSTER_LABELS[n.cluster]);
  const allRanked = rankedList(topNeeds);
  const matchupText = matchupSummary(
    matchups,
    new Set(top3.map((n) => n.cluster)),
  );

  const pronoun = pronouns || "they/them";
  const heCapital = pronoun.includes("he") ? "He" : pronoun.includes("she") ? "She" : "They";
  const heLower = heCapital.toLowerCase();
  const hisHer = pronoun.includes("he") ? "his" : pronoun.includes("she") ? "her" : "their";
  const himHer = pronoun.includes("he") ? "him" : pronoun.includes("she") ? "her" : "them";

  return `You are generating a personalized Needs Signal Report. This single document is read by the person AND shared with their manager in a 1:1 — it is not two separate reports.

VOICE & TONE RULES — CRITICAL:
- Conversational, peer-to-peer, warm, and empowering. Never use "assessment," "test," "score you," or clinical/diagnostic language.
- Be direct and confident, not hedgy: "You need...", "You tended to...". Every claim should read as an observation offered for reflection, not a verdict, but state it plainly rather than softening it with "might" or "may".
- NEVER show your work. Never mention counts, ratios, frequencies, percentages, or how many times something was chosen (do not say things like "3 out of 5 times," "you chose X most often," or "when X and Y competed"). The trade-off data given below is for your own internal grounding only, so every claim you make is actually true. The reader should only ever see the meaningful conclusion, never the measurement behind it.
- Do NOT predict or speculate about emotional reactions, coping styles, or behavior that wasn't directly observed in the choices made. For example, never say something like "you don't make a scene" — that is an unfounded assumption about how the person handles emotion, not something grounded in a trade-off they actually made. Only describe patterns strictly grounded in the explicit trade-off choices and matchup data given below.
- No em-dashes anywhere. Use commas or periods instead.
- Keep sentences short and direct, one clear idea per sentence. If a sentence needs a comma to hold two ideas together, split it into two sentences instead.
- Never use quotation marks around reflection questions.
- CLUSTER RULE — CRITICAL: Speak to clusters as whole orientations. Never invent or reference individual sub-needs within a cluster.
- The cluster names below are FIXED and APPROVED. Use them EXACTLY as written (e.g. "Core Stability", "Agency & Growth") — never rename, rephrase, or shorten them.

Person: ${firstName}, pronouns: ${pronoun}
Top 3 Priority Need Clusters (in order, strongest signal first): ${top3Labels.join(", ")}
Full ranked list: ${allRanked}

Actual head-to-head trade-off data — INTERNAL GROUNDING ONLY, never quote or paraphrase these numbers in your output. Use this only to decide which patterns are real and which insights are worth surfacing:
${matchupText}

Output ONLY a single valid JSON object, no markdown code fences, no commentary before or after. Match this exact shape:

{
  "keyPattern": "Exactly 2 sentences, second person, no numbers. First sentence: describe, in plain language, what they consistently protect or prioritize when forced to choose between competing needs. Second sentence: state directly and concretely what this means they need right now, in the form 'This shows that, right now, you need [X].' Make the practical implication explicit, not just the observation.",
  "choiceInsights": [
    // EXACTLY 3 entries in this array — not 2, not 4, exactly 3. Each one a distinct, meaningful insight revealed by the trade-off data (prefer insights involving the top 3 clusters). Do NOT restate the key pattern. Do NOT describe the trade-off mechanics ("when X and Y competed", "you picked X over Y") — describe only what the pattern MEANS for how they work.
    {
      "headline": "A short headline sentence starting with 'You need...' (direct, not 'you might need') stating the core insight itself.",
      "body": "1-2 sentences in second person explaining what this insight means in practice for how ${firstName} works and why it matters, referencing the relevant cluster(s) by their exact label where natural. Ground this in the matchup data internally, but state only the conclusion, never the measurement."
    }
  ],
  "rippleChain": [
    // EXACTLY 3 entries — not 2, not 4. Ordered by priority, starting with the #1 ranked cluster (highest-leverage, strongest signal) through the next two clusters from the ranked list above. These needs reinforce each other rather than unlocking in a strict one-way sequence — do not imply the second or third need is impossible to meet until the previous one is fully resolved.
    {
      "cluster": "Exact cluster label for this step, e.g. 'Core Stability'.",
      "body": "1-2 sentences, second person. For the FIRST entry: explain why this is the highest-leverage place to focus first, since it is the strongest signal. For the SECOND and THIRD entries: explain how attention to the earlier need(s) in this list creates supportive conditions for this one, and note that progress on this one likewise feeds back into supporting the earlier need(s) too, since these reinforce each other rather than flowing only one direction. Reference cluster names by their exact labels. Do not describe hypothetical behavior when a need is met or unmet — describe only the relationship between the needs themselves."
    }
  ],
  "signals": [
    // Exactly 3 entries, one per top-3 cluster, in the same order as the top 3 list above.
    {
      "signal": "Starts with 'You notice yourself...' — 1 sentence listing 2-3 concrete, observable behaviors (not feelings) that MIGHT show up when this cluster's need is going unmet. Join the items with 'or', never 'and' — these are alternative things someone might notice, not a checklist that all happen together. For example: 'You notice yourself double-checking plans, asking for confirmation on settled decisions, or holding back from new commitments.'",
      "need": "The exact cluster label this row maps to, e.g. 'Core Stability'.",
      "questions": [
        // Exactly 2-3 short, concrete, easy-to-answer reflection questions. No quotation marks. Plain text, no leading dash.
        "question one",
        "question two"
      ]
    }
  ],
  "managerInsights": [
    // Exactly 4 entries, personalized using the name "${firstName}" and pronouns ${heLower}/${hisHer}/${himHer} throughout (never "they/them" unless that is the pronoun set given above).
    {
      "label": "A short 2-4 word bolded-style label, no trailing colon or punctuation, e.g. 'Creating Steady Ground'",
      "body": "1 sentence written TO the manager, ABOUT ${firstName}, using ${heLower}/${hisHer}/${himHer} pronouns, explaining a concrete way the manager can support this need."
    }
  ]
}`;
}
