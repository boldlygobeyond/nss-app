import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClusterKey } from "./clusters";

export interface NssQuestionRow {
  id: number;
  topic: string;
  cluster_a: ClusterKey;
  cluster_b: ClusterKey;
  standard_question: string;
  standard_option_a: string;
  standard_option_b: string;
  sharpened_question: string;
  sharpened_option_a: string;
  sharpened_option_b: string;
}

export interface SurveyQuestion {
  id: number;
  topic: string;
  mappedClusters: [ClusterKey, ClusterKey];
  standard: { question: string; options: { A: string; B: string } };
  sharpened: { question: string; options: { A: string; B: string } };
}

export function questionFromRow(row: NssQuestionRow): SurveyQuestion {
  return {
    id: row.id,
    topic: row.topic,
    mappedClusters: [row.cluster_a, row.cluster_b],
    standard: {
      question: row.standard_question,
      options: { A: row.standard_option_a, B: row.standard_option_b },
    },
    sharpened: {
      question: row.sharpened_question,
      options: { A: row.sharpened_option_a, B: row.sharpened_option_b },
    },
  };
}

// Oct 2026 question-bank rebalance: the deployed app only ever serves the
// original 50 (ids 1-50). The new 86-question bank (ids 51-136) lives in
// the same table, gated behind a local-only env flag, so it can be tested
// end-to-end without affecting what's actually live. Once the new bank
// replaces the old one for real, drop this split and the id filter.
const useNewBank = process.env.NEXT_PUBLIC_NSS_ENGINE === "bt";

export async function fetchQuestions(
  supabase: SupabaseClient,
): Promise<SurveyQuestion[]> {
  const query = supabase.from("nss_questions").select("*").order("id");
  const { data, error } = useNewBank ? await query.gte("id", 51) : await query.lte("id", 50);

  if (error) throw error;
  return (data as NssQuestionRow[]).map(questionFromRow);
}
