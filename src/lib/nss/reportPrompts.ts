// Consolidated report prompt — one document shared verbatim between the
// employee and their manager, replacing the old separate employee/manager
// report generators.

import { CLUSTER_LABELS, type ClusterKey } from "./clusters";
import type { TopNeed, PairwiseMatchup } from "./surveyEngine";
import type { BtRanked } from "./bradleyTerry";

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

// "Top 3" is an arbitrary line drawn across a continuous ranking — nothing
// stops the #4 cluster from being a near-exact tie with #3. Resampling the
// person's own answers (same bootstrap as bradleyTerry.ts's top3Stability)
// tells us when that's actually the case, so the report can say so instead
// of presenting a coin flip as a clear result.
function rankStabilityNote(
  rankStability: { stability: number; fourthCluster: ClusterKey | null } | undefined,
  top3Labels: string[],
): string {
  if (!rankStability || !rankStability.fourthCluster) return "";
  const { stability, fourthCluster } = rankStability;
  const pct = Math.round(stability * 100);
  if (stability >= 0.6) {
    return `\n\nRank stability — INTERNAL ONLY, never mention this percentage or the word "stability" in your output: resampling this person's actual answers reproduces this exact top 3 set ${pct}% of the time. That is a clear, stable result, no need to hedge on the #3 ranking.`;
  }
  const fourthLabel = CLUSTER_LABELS[fourthCluster];
  const thirdLabel = top3Labels[2];
  return `\n\nRank stability — INTERNAL ONLY, never mention this percentage, the word "stability", or any number in your output: resampling this person's actual answers reproduces this exact top 3 set only ${pct}% of the time. The #3 need (${thirdLabel}) and the next-ranked need (${fourthLabel}) are close enough to be a toss-up. Acknowledge this in plain language, rather than implying ${thirdLabel} is clearly and decisively ahead of ${fourthLabel}. CRITICAL — this acknowledgment must be woven INTO the keyPattern's existing 2 sentences, or INTO the body of one of the exactly-3 choiceInsights below, replacing or blending with what would already go there. It must NOT become a 4th choiceInsight, a 4th anything, or any new field anywhere in the JSON. Every array below keeps the exact count its own instructions already specify, no exceptions for this.`;
}

export function buildReportPrompt(params: {
  firstName: string;
  respondentName: string;
  pronouns: string;
  topNeeds: TopNeed[];
  matchups: PairwiseMatchup[];
  rankStability?: { stability: number; fourthCluster: ClusterKey | null };
}): string {
  const { firstName, pronouns, topNeeds, matchups, rankStability } = params;
  const top3 = topNeeds.slice(0, 3);
  const top3Labels = top3.map((n) => CLUSTER_LABELS[n.cluster]);
  const allRanked = rankedList(topNeeds);
  const matchupText = matchupSummary(
    matchups,
    new Set(top3.map((n) => n.cluster)),
  );
  const stabilityNote = rankStabilityNote(rankStability, top3Labels);

  const pronoun = pronouns || "they/them";
  // Check "she" before "he" — "she/her" contains the substring "he", so
  // checking "he" first misclassified every she/her respondent as he/him.
  const heCapital = pronoun.includes("she") ? "She" : pronoun.includes("he") ? "He" : "They";
  const heLower = heCapital.toLowerCase();
  const hisHer = pronoun.includes("she") ? "her" : pronoun.includes("he") ? "his" : "their";
  const himHer = pronoun.includes("she") ? "her" : pronoun.includes("he") ? "him" : "them";

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
- Be direct and draw real conclusions everywhere the data supports them. The one exception is the note below about #3 vs #4: when it says those two are a toss-up, say so plainly in the report rather than implying a clear gap that is not actually there. This is the only place a caveat belongs, everything else stays direct per the rule above.

Person: ${firstName}, pronouns: ${pronoun}
Top 3 Priority Need Clusters (in order, strongest signal first): ${top3Labels.join(", ")}
Full ranked list: ${allRanked}

Actual head-to-head trade-off data — INTERNAL GROUNDING ONLY, never quote or paraphrase these numbers in your output. Use this only to decide which patterns are real and which insights are worth surfacing:
${matchupText}${stabilityNote}

Output ONLY a single valid JSON object, no markdown code fences, no commentary before or after. Match this exact shape:

{
  "keyPattern": "Exactly 2 sentences, second person, no numbers. First sentence: describe, in plain language, what they consistently protect or prioritize when forced to choose between competing needs. Second sentence: state directly and concretely what this means they need right now, in the form 'This shows that, right now, you need [X].' Make the practical implication explicit, not just the observation.",
  "choiceInsights": [
    // EXACTLY 3 entries in this array — not 2, not 4, exactly 3, even if the rank-stability note below gives you something to say. Each one a distinct, meaningful insight revealed by the trade-off data (prefer insights involving the top 3 clusters). Do NOT restate the key pattern. Do NOT describe the trade-off mechanics ("when X and Y competed", "you picked X over Y") — describe only what the pattern MEANS for how they work.
    {
      "headline": "A short headline sentence starting with 'You need...' (direct, not 'you might need') stating the core insight itself. No extra fields on this object beyond headline and body.",
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

// ─── Bradley-Terry-aware variant ─────────────────────────────────────────────
//
// Same output contract and voice rules as buildReportPrompt, but the ranking
// comes from Bradley-Terry (accounts for strength of schedule, not just raw
// win rate) and the model gets an extra internal-only grounding block so it
// can tell which specific matchups are well-supported versus too thin or too
// close to build a claim on — the same "reliability" signal from the admin
// matrix, but used to shape which insights this report is confident enough
// to make, not shown to the reader as numbers.

function categorizeMatchup(total: number, winnerShare: number): "decisive" | "narrow" | "thin" {
  if (total < 3) return "thin";
  if (winnerShare >= 0.65) return "decisive";
  return "narrow";
}

export function buildReliabilityGrounding(params: {
  btTop3: ClusterKey[];
  matchups: PairwiseMatchup[];
  responses: { chosen_clusters: ClusterKey[]; rejected_clusters: ClusterKey[]; is_sharpened: boolean }[];
}): string {
  const { btTop3, matchups, responses } = params;

  return btTop3
    .map((cluster) => {
      const label = CLUSTER_LABELS[cluster];
      const oppRecords = matchups
        .filter((m) => m.a === cluster || m.b === cluster)
        .map((m) => {
          const total = m.total;
          const winShare = m.a === cluster ? m.aWins / total : m.bWins / total;
          const winnerShare = Math.max(winShare, 1 - winShare);
          return categorizeMatchup(total, winnerShare);
        });

      const decisive = oppRecords.filter((c) => c === "decisive").length;
      const narrow = oppRecords.filter((c) => c === "narrow").length;
      const thin = oppRecords.filter((c) => c === "thin").length;

      const relevant = responses.filter(
        (r) => r.chosen_clusters.includes(cluster) || r.rejected_clusters.includes(cluster),
      );
      const sharpenedCount = relevant.filter((r) => r.is_sharpened).length;
      const confidenceShare = relevant.length > 0 ? 1 - sharpenedCount / relevant.length : 1;

      return (
        `${label}: faced ${oppRecords.length} other clusters head-to-head — a clear, well-supported edge over ${decisive} of them, ` +
        `a near-even split against ${narrow} (do not describe these as consistent or decisive either way), and ${thin} where too few head-to-head meetings happened to draw any conclusion (do not use these at all as evidence). ` +
        `${Math.round(confidenceShare * 100)}% of its trade-off answers were immediate (not flagged "it depends"); ${sharpenedCount} of ${relevant.length} needed the clarifying version of the question before an answer was given.`
      );
    })
    .join("\n");
}

export function buildReportPromptV2(params: {
  firstName: string;
  respondentName: string;
  pronouns: string;
  btRanked: BtRanked[];
  matchups: PairwiseMatchup[];
  responses: { chosen_clusters: ClusterKey[]; rejected_clusters: ClusterKey[]; is_sharpened: boolean }[];
}): string {
  const { firstName, pronouns, btRanked, matchups, responses } = params;
  const top3 = btRanked.slice(0, 3);
  const top3Clusters = top3.map((n) => n.cluster);
  const top3Labels = top3Clusters.map((c) => CLUSTER_LABELS[c]);
  const allRanked = btRanked
    .map((n) => `${n.rank}. ${CLUSTER_LABELS[n.cluster]}`)
    .join("\n");
  const matchupText = matchupSummary(matchups, new Set(top3Clusters));
  const reliabilityText = buildReliabilityGrounding({ btTop3: top3Clusters, matchups, responses });

  const pronoun = pronouns || "they/them";
  const heCapital = pronoun.includes("she") ? "She" : pronoun.includes("he") ? "He" : "They";
  const heLower = heCapital.toLowerCase();
  const hisHer = pronoun.includes("she") ? "her" : pronoun.includes("he") ? "his" : "their";
  const himHer = pronoun.includes("she") ? "her" : pronoun.includes("he") ? "him" : "them";

  return `You are generating a personalized Needs Signal Report. This single document is read by the person AND shared with their manager in a 1:1 — it is not two separate reports.

VOICE & TONE RULES — CRITICAL:
- Conversational, peer-to-peer, warm, and empowering. Never use "assessment," "test," "score you," or clinical/diagnostic language.
- Be direct and confident, not hedgy: "You need...", "You tended to...". Every claim should read as an observation offered for reflection, not a verdict, but state it plainly rather than softening it with "might" or "may".
- NEVER show your work. Never mention counts, ratios, frequencies, percentages, categories, or how many times something was chosen. The trade-off data given below is for your own internal grounding only, so every claim you make is actually true. The reader should only ever see the meaningful conclusion, never the measurement behind it.
- Do NOT predict or speculate about emotional reactions, coping styles, or behavior that wasn't directly observed in the choices made.
- No em-dashes anywhere. Use commas or periods instead.
- Keep sentences short and direct, one clear idea per sentence.
- Never use quotation marks around reflection questions.
- CLUSTER RULE — CRITICAL: Speak to clusters as whole orientations. Never invent or reference individual sub-needs within a cluster.
- The cluster names below are FIXED and APPROVED. Use them EXACTLY as written — never rename, rephrase, or shorten them.

Person: ${firstName}, pronouns: ${pronoun}
Top 3 Priority Need Clusters (in order, strongest signal first): ${top3Labels.join(", ")}
Full ranked list: ${allRanked}

Actual head-to-head trade-off data — INTERNAL GROUNDING ONLY, never quote or paraphrase these numbers in your output. Use this only to decide which patterns are real and which insights are worth surfacing:
${matchupText}

Reliability grounding — INTERNAL ONLY, never quote or paraphrase these numbers, categories, or percentages in your output. Use this only to decide, among the top clusters and specific matchups, which patterns are strongly supported versus which are too thin or too close to build a claim on:
- Only build a choiceInsight or use language like "consistently" about a SPECIFIC other-cluster comparison when that comparison is a "clear, well-supported edge" below. A "near-even split" is NOT consistent, describe it more softly instead (e.g. "tends to", "leans toward") or use a different, better-supported comparison instead. A matchup with "too few head-to-head meetings" must not be used as evidence for any claim at all.
- This does not mean every sentence should sound hedgy. It means: be selective about WHICH comparisons you build insights on, and prefer the ones with a clear, well-supported edge. State whatever you do say plainly and directly per the voice rules above.
${reliabilityText}

Output ONLY a single valid JSON object, no markdown code fences, no commentary before or after. Match this exact shape:

{
  "keyPattern": "Exactly 2 sentences, second person, no numbers. First sentence: describe, in plain language, what they consistently protect or prioritize when forced to choose between competing needs. Second sentence: state directly and concretely what this means they need right now, in the form 'This shows that, right now, you need [X].' Make the practical implication explicit, not just the observation.",
  "choiceInsights": [
    // EXACTLY 3 entries in this array — not 2, not 4, exactly 3. Each one a distinct, meaningful insight revealed by the trade-off data (prefer insights involving the top 3 clusters). Do NOT restate the key pattern. Do NOT describe the trade-off mechanics — describe only what the pattern MEANS for how they work.
    {
      "headline": "A short headline sentence starting with 'You need...' (direct, not 'you might need') stating the core insight itself.",
      "body": "1-2 sentences in second person explaining what this insight means in practice for how ${firstName} works and why it matters, referencing the relevant cluster(s) by their exact label where natural. Ground this in the matchup and reliability data internally, but state only the conclusion, never the measurement."
    }
  ],
  "rippleChain": [
    // EXACTLY 3 entries — not 2, not 4. Ordered by priority, starting with the #1 ranked cluster through the next two clusters from the ranked list above. These needs reinforce each other rather than unlocking in a strict one-way sequence.
    {
      "cluster": "Exact cluster label for this step, e.g. 'Core Stability'.",
      "body": "1-2 sentences, second person. For the FIRST entry: explain why this is the highest-leverage place to focus first. For the SECOND and THIRD entries: explain how attention to the earlier need(s) creates supportive conditions for this one, and that progress on this one feeds back into the earlier need(s) too."
    }
  ],
  "signals": [
    // Exactly 3 entries, one per top-3 cluster, in the same order as the top 3 list above.
    {
      "signal": "Starts with 'You notice yourself...' — 1 sentence listing 2-3 concrete, observable behaviors (not feelings) that MIGHT show up when this cluster's need is going unmet. Join the items with 'or', never 'and'.",
      "need": "The exact cluster label this row maps to, e.g. 'Core Stability'.",
      "questions": [
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
