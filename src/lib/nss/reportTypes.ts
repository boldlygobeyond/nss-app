// Shape of the single consolidated report (stored as nss_submissions.report_data),
// shared verbatim between the employee and their manager rather than split
// into two separate documents.

// Static — not personalized, so generated once here rather than by the LLM.
export const RIPPLE_INTRO_TEXT =
  "Needs work as a connected system. Meeting one tends to give way for others to be met.";

export interface ReportData {
  keyPattern: string;
  choiceInsights: { headline: string; body: string }[];
  // Ordered priority sequence (highest-leverage need first) — these needs
  // reinforce each other rather than unlocking in strict one-way sequence.
  rippleChain: { cluster: string; body: string }[];
  signals: { signal: string; need: string; questions: string[] }[];
  managerInsights: { label: string; body: string }[];
}
