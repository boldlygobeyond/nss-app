// Report prompt builders — ported verbatim (voice rules, structure, wording)
// from the Base44 export's uploadNSSReports / regenerateAllUserReports
// functions, adapted to this project's TopNeed/cluster-label shapes.

import { CLUSTER_LABELS } from "./clusters";
import type { TopNeed } from "./surveyEngine";

function rankedList(topNeeds: TopNeed[]): string {
  return topNeeds
    .map((n, i) => `${i + 1}. ${CLUSTER_LABELS[n.cluster]} (${n.total} signals)`)
    .join("\n");
}

export function buildEmployeePrompt(firstName: string, topNeeds: TopNeed[]): string {
  const top3Labels = topNeeds.slice(0, 3).map((n) => CLUSTER_LABELS[n.cluster]);
  const allRanked = rankedList(topNeeds);
  const additionalClusters = topNeeds
    .slice(3, 5)
    .map((n) => CLUSTER_LABELS[n.cluster]);

  return `You are generating a personalized Employee Needs Insights Report. The tone is warm, direct, and reflective. Written in plain declarative sentences. No jargon, no filler phrases, no metaphors.

VOICE RULES:
- Use "you" and "your" throughout the entire report. Do NOT use the person's name anywhere in the body text.
- Do NOT reference how the report was generated, how many signals were counted, or any technical scoring language. This is an insights report, not a data report.
- CRITICAL: No em-dashes (—) anywhere in the report. Use commas or periods instead.
- No metaphors. No advice or how-to tips.
- Short paragraphs. 2-4 sentences max per section.
- Every sentence must feel specific and personal, not generic.
- LANGUAGE RULE — CRITICAL: Keep sentences short and direct, one clear idea per sentence. If a sentence needs a comma to hold two ideas together, split it into two sentences instead. Never sacrifice depth or nuance to do this — say just as much, in smaller, plainer pieces that don't need to be read twice.
- When a behavior depends on a condition, state the condition first. Write "When you feel accepted, you contribute more openly," not "You contribute more openly when you feel accepted" or "You contribute more openly in groups where you feel accepted."
- When contrasting a need being met versus unmet, always give the met/satisfied example first, then the unmet/unsatisfied example second.
- CLUSTER RULE — CRITICAL: Every section must speak to the CLUSTER as a whole orientation or tendency. NEVER name or discuss individual sub-needs within a cluster. Always stay at the cluster level.

Top 3 Priority Need Clusters: ${top3Labels.join(", ")}
Supporting clusters (lower priority): ${allRanked}

CRITICAL: The cluster names above are FIXED and APPROVED. Use them EXACTLY as written (e.g. "Core Stability", "Agency & Growth", "Emotional Ecosystem") as the section headers — do NOT rename, rephrase, shorten, or alter them in any way.

Generate the report using EXACTLY this structure (do NOT include any intro sentence before the Overview):

## Overview

3-4 short paragraphs written entirely in second person ("You come across as...", "You tend to...", "You operate from..."). Describe their overall character and working style based on their top clusters. What drives them. What doesn't. What they look like at their best. Use more short sentences rather than fewer long ones — each sentence carries exactly one idea. Keep the same depth of insight, just broken into smaller, plainer statements.

## Top Priority Need Clusters

IMPORTANT: These are broad need CLUSTERS, not individual needs. Write about the cluster theme as a whole tendency or orientation, not about specific sub-needs within it. Never mention individual need names — only cluster names.

### 1. ${top3Labels[0]}

2-3 short sentences in second person: what this cluster orientation reveals about how you work and what drives you. Stay at the cluster level — no individual sub-needs.

**Internal signals** (how you experience this cluster orientation internally):
- Short phrase about how this cluster shows up inside you
- Short phrase

**External signals** (what others might notice when this cluster is well-supported or under-supported):
- Short phrase observable to others
- Short phrase

**What supports you:**
- Short phrase
- Short phrase
- Short phrase

**Reflection:** One open, honest question for you to sit with about this cluster orientation.

### 2. ${top3Labels[1]}

2-3 short sentences in second person about this cluster orientation. Stay at the cluster level — no individual sub-needs.

**Internal signals:**
- Short phrase
- Short phrase

**External signals:**
- Short phrase
- Short phrase

**What supports you:**
- Short phrase
- Short phrase
- Short phrase

**Reflection:** One open, honest question.

### 3. ${top3Labels[2]}

2-3 short sentences in second person about this cluster orientation. Stay at the cluster level — no individual sub-needs.

**Internal signals:**
- Short phrase
- Short phrase

**External signals:**
- Short phrase
- Short phrase

**What supports you:**
- Short phrase
- Short phrase
- Short phrase

**Reflection:** One open, honest question.

## Additional Important Need Clusters

${
  additionalClusters.length > 0
    ? `The next most significant clusters for you are ${additionalClusters.join(" and ")}. Write 4-6 short, plain sentences in second person that describe these two clusters together — what they add to your overall picture, how they complement your top three, and what they say about the broader conditions you need to do your best work. Use short sentences, one idea each, rather than a few long, dense ones. Stay at the cluster level. No individual sub-needs.`
    : "Write 4-6 short, plain sentences about the next most significant supporting clusters based on the ranked list above."
}

## Signals to Look Out For

3 bullets in this exact format — bold label followed by 1 sentence in second person:
- **[Label]:** [One plain sentence describing the tension or blind spot for you.]
- **[Label]:** [One plain sentence.]
- **[Label]:** [One plain sentence.]

Focus on patterns like: quiet load-bearing, over-tolerance, under-expression of needs.

## Summary

2-3 short sentences in second person summarizing your core operating conditions. End with one punchy closing line about what you bring when your needs are met. Match the register of: "You don't need to be motivated. You need to not be obstructed."`;
}

export function buildManagerPrompt(
  firstName: string,
  respondentName: string,
  pronouns: string,
  topNeeds: TopNeed[],
): string {
  const top3Labels = topNeeds.slice(0, 3).map((n) => CLUSTER_LABELS[n.cluster]);
  const allRanked = rankedList(topNeeds);
  const pronoun = pronouns || "they/them";
  const heCapital = pronoun.includes("he") ? "He" : pronoun.includes("she") ? "She" : "They";
  const heLower = heCapital.toLowerCase();
  const hisHer = pronoun.includes("he") ? "his" : pronoun.includes("she") ? "her" : "their";
  const himHer = pronoun.includes("he") ? "him" : pronoun.includes("she") ? "her" : "them";

  return `You are generating a Manager Report about an employee. Tone: direct, warm, diagnostic. Written for a manager who wants clarity, not a coaching manual.

PRONOUN RULES — CRITICAL:
The employee's pronouns are: ${pronoun}
You MUST use these exact pronouns throughout the entire report when referring to this person:
- Subject: "${heLower}" (e.g. "${heLower} tends to...", "${heLower} works best when...")
- Possessive: "${hisHer}" (e.g. "${hisHer} approach...", "${hisHer} needs...")
- Object: "${himHer}" (e.g. "support ${himHer}...", "ask ${himHer}...")
Do NOT use "they/them/their" unless the employee's chosen pronouns are they/them. Do NOT use "he/his/him" unless the employee's chosen pronouns are he/him. Do NOT use "she/her" unless the employee's chosen pronouns are she/her. Use ONLY the pronouns listed above.

VOICE RULES:
- Written FOR the manager, ABOUT the employee. Use the pronouns specified above throughout — ${heLower}/${hisHer}/${himHer} — every time you refer to this person in third person.
- No performative praise. No generic tips.
- Plain declarative sentences. CRITICAL: No em-dashes (—) anywhere. Use commas or periods instead.
- Key signals must be punchy and specific, no hedging.
- Do NOT reference scores, signal counts, or how the report was generated.
- LANGUAGE RULE — CRITICAL: Keep sentences short and direct, one clear idea per sentence. If a sentence needs a comma to hold two ideas together, split it into two sentences instead. Never sacrifice depth or nuance to do this — say just as much, in smaller, plainer pieces that don't need to be read twice.
- When a behavior depends on a condition, state the condition first. Write "When the plan holds, he moves quickly," not "He moves quickly when the plan holds."
- When contrasting a need being met versus unmet, always give the met/satisfied example first, then the unmet/unsatisfied example second.
- CLUSTER RULE — CRITICAL: Every section must speak to CLUSTERS as whole orientations or tendencies. NEVER name or discuss individual sub-needs within a cluster. Always stay at the cluster level.
- PRONOUN CHECK: Before finalizing, review every sentence that refers to ${firstName} — confirm each uses "${heLower}", "${hisHer}", or "${himHer}" as appropriate. Do not default to "they/them" unless that is the chosen pronoun set.

Employee: ${respondentName} (pronouns: ${pronoun})

Top 3 Priority Need Clusters: ${top3Labels.join(", ")}
Supporting clusters: ${allRanked}

CRITICAL: The cluster names above are FIXED and APPROVED. Use them EXACTLY as written (e.g. "Core Stability", "Agency & Growth", "Emotional Ecosystem") as the section headers — do NOT rename, rephrase, shorten, or alter them in any way.

Generate the report using EXACTLY this structure (do NOT include a title heading — start directly with Summary of Top Need Clusters):

## Summary of Top Need Clusters

IMPORTANT: These are broad need CLUSTERS, not individual needs. Describe each cluster as a general orientation or tendency. Never name individual sub-needs — only cluster-level themes.

### 1. ${top3Labels[0]}

2 sentences: what this cluster orientation means for ${firstName} in practice as a whole tendency. Use ${heLower}/${hisHer}/${himHer} pronouns.

**Key signal:** Two short, concrete sentences. First, what it looks like when this cluster is well-supported for ${heLower} — the met condition. Second, what it looks like when it is under-supported — the unmet condition. Met condition always first.

### 2. ${top3Labels[1]}

2 sentences about this cluster orientation for ${firstName}. Use ${heLower}/${hisHer}/${himHer} pronouns.

**Key signal:** Two short, concrete sentences, same pattern — well-supported first, under-supported second.

### 3. ${top3Labels[2]}

2 sentences about this cluster orientation for ${firstName}. Use ${heLower}/${hisHer}/${himHer} pronouns.

**Key signal:** Two short, concrete sentences, same pattern — well-supported first, under-supported second.

## Additional Important Need Clusters

Write 4-6 short, plain sentences about the next most significant clusters from the supporting list. Describe what they add to ${firstName}'s overall profile and what they tell a manager about the broader conditions ${heLower} needs. Use short sentences, one idea each, rather than a few long, dense ones. Stay at the cluster level. Use ${heLower}/${hisHer}/${himHer} pronouns throughout.

## Reading the Signals

Generate a table with exactly these three columns: "When you see these signals...", "The underlying need is likely...", "Open the inquiry by asking..."

Include one row for each of the 3 top priority clusters. Each "When you see these signals..." cell should list 2-3 specific, observable behaviors. Each "The underlying need is likely..." cell should name the cluster plainly. Each "Open the inquiry by asking..." cell should contain one natural, conversational manager question (not clinical, not leading).

## How to Support ${firstName}

### Hidden Vulnerability

2-3 sentences on the pattern most likely to go unnoticed. Specific to ${firstName}'s profile. Use ${heLower}/${hisHer}/${himHer} pronouns. End with one concrete sentence on what a manager can do to get ahead of it.

### Leadership Bottom Line

"${firstName} doesn't need [X]. ${firstName} needs:" followed by 3-5 short bullet phrases (e.g. "Clean systems", "Real autonomy", "Clear purpose"). End with 1-2 sentences on what ${heLower} brings when those conditions are present.`;
}
