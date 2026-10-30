// Fixed 5-point importance scale, identical for every cluster and never
// shown alongside the underlying need name. Wording is verbatim from the
// approved spec — do not rephrase.
export const NRS_RATINGS = [
  { value: 1, label: "Not Here", description: "I'm not looking for this need here." },
  { value: 2, label: "Noticed", description: "I'd notice it, but it wouldn't change much." },
  { value: 3, label: "Appreciated", description: "I'd appreciate it, but no lasting impact." },
  { value: 4, label: "Impactful", description: "This would matter and affect how I show up." },
  { value: 5, label: "Deal Breaker", description: "Without it, I can't show up fully." },
] as const;

export type NrsRatingValue = (typeof NRS_RATINGS)[number]["value"];

export function nrsRatingByValue(value: number) {
  return NRS_RATINGS.find((r) => r.value === value) ?? null;
}
