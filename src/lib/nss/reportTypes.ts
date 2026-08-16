// Shape of the single consolidated report (stored as nss_submissions.report_data),
// shared verbatim between the employee and their manager rather than split
// into two separate documents.

// Static — not personalized, so generated once here rather than by the LLM.
export const INTRO_TEXT =
  "Take a look at your Needs Signal Report to understand how your needs might show up in the workplace. Share the report with your manager and have a conversation about what you need from the team to show up as your best each and every day.";

export const SNAPSHOT_INTRO_TEXT =
  "These scores give you an initial snapshot of which needs are most important to you today. As you take more in-depth Boldly Go Beyond diagnostics in the future, you'll see the scores below start to dial in more precisely, and they'll evolve over time.";

export const RIPPLE_INTRO_TEXT =
  "Needs work as a connected system. When one need is met, it ripples out into other needs.";

export interface ReportData {
  keyPattern: string;
  choiceInsights: { headline: string; body: string }[];
  // Ordered priority sequence (highest-leverage need first) — these needs
  // reinforce each other rather than unlocking in strict one-way sequence.
  rippleChain: { cluster: string; body: string }[];
  signals: { signal: string; need: string; questions: string[] }[];
  managerInsights: { label: string; body: string }[];
}
