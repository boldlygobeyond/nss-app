// The single source of truth for what a respondent has done with each
// question they've reached — answered or skipped, and under which wording
// — and for the decisions that follow from a new answer: is this a
// confirmation, a correction, or a first decisive answer; does it change
// the decisive-answer count; does it replace or append a history entry.
//
// Deliberately pure (no React, no Supabase) so SurveyClient.tsx's
// handleAnswer/handleSkip can stay thin wrappers around this, and so the
// decision logic itself — the part most load-bearing for not corrupting
// scoring or the adaptive sequence — can be tested directly. See
// NSS_Back_Navigation_And_Duplicate_Fix.md.

export interface AnsweredEntry {
  question_id: number;
  status: "answered";
  question_text: string;
  user_selection: "A" | "B";
  chosen_clusters: string[];
  rejected_clusters: string[];
  mapped_clusters: string[];
  is_sharpened_question: boolean;
  original_question_id?: number;
  answered_at: string;
}

export interface SkippedEntry {
  question_id: number;
  status: "skipped";
  mapped_clusters: string[];
  is_sharpened_question: boolean;
}

export type QuestionHistoryEntry = AnsweredEntry | SkippedEntry;

export interface ApplyAnswerResult {
  history: QuestionHistoryEntry[];
  entry: AnsweredEntry;
  /** True when this is a re-selection of the exact answer already stored, in the exact wording already stored — not a new response. */
  isConfirmation: boolean;
  /** How much the decisive-answer count should change: 1 for a fresh answer or a previously-skipped question now answered, 0 for a correction or a confirmation. */
  decisiveCountDelta: 0 | 1;
}

/**
 * Applies one answer to the history. Replaces the existing entry for this
 * question if there is one (a correction or a confirmation); appends a new
 * one otherwise (a fresh question, or a previously-skipped one now
 * answered). Never produces two entries for the same question_id.
 */
export function applyAnswerToHistory(params: {
  history: QuestionHistoryEntry[];
  questionId: number;
  questionText: string;
  choice: "A" | "B";
  chosenClusters: string[];
  rejectedClusters: string[];
  mappedClusters: string[];
  isSharpened: boolean;
  originalQuestionId?: number | null;
  answeredAt: string;
}): ApplyAnswerResult {
  const {
    history,
    questionId,
    questionText,
    choice,
    chosenClusters,
    rejectedClusters,
    mappedClusters,
    isSharpened,
    originalQuestionId,
    answeredAt,
  } = params;

  const priorIndex = history.findIndex((h) => h.question_id === questionId);
  const prior = priorIndex !== -1 ? history[priorIndex] : null;
  const priorWasDecisive = prior?.status === "answered";

  // Re-selecting the exact same answer, in the exact same wording, as
  // what's already stored isn't a new response — nothing about the
  // respondent's position on this pair changed.
  const isConfirmation =
    priorWasDecisive &&
    (prior as AnsweredEntry).user_selection === choice &&
    (prior as AnsweredEntry).is_sharpened_question === isSharpened;

  const entry: AnsweredEntry = {
    question_id: questionId,
    status: "answered",
    question_text: questionText,
    user_selection: choice,
    chosen_clusters: chosenClusters,
    rejected_clusters: rejectedClusters,
    mapped_clusters: mappedClusters,
    is_sharpened_question: isSharpened,
    ...(isSharpened && originalQuestionId ? { original_question_id: originalQuestionId } : {}),
    answered_at: answeredAt,
  };

  const newHistory: QuestionHistoryEntry[] = isConfirmation
    ? history
    : priorIndex !== -1
      ? history.map((h, i) => (i === priorIndex ? entry : h))
      : [...history, entry];

  return {
    history: newHistory,
    entry,
    isConfirmation,
    decisiveCountDelta: priorWasDecisive || isConfirmation ? 0 : 1,
  };
}

export interface ApplySkipResult {
  history: QuestionHistoryEntry[];
  /** -1 when this skip replaces a previously-decisive answer for this question (the decisive count must come back down to match) — 0 for a fresh skip or re-skipping an already-skipped question, neither of which ever counted toward it. */
  decisiveCountDelta: 0 | -1;
}

/**
 * Records a skip. Skips carry no scoring signal and never trigger
 * validation — only replaces/appends the history entry. Skip is now
 * reachable from a question that's already on record as a decisive
 * answer (reviewing a committed sharpened answer, or reconsidering a
 * standard one via "It Depends," can both end in Skip instead of a new
 * decisive pick) — decisiveCountDelta tells the caller whether that
 * actually un-counts a previously-decisive answer, since this function
 * has no access to persistence itself: a -1 here means the caller also
 * needs to delete that question's now-stale row from storage, not just
 * update local state.
 */
export function applySkipToHistory(params: {
  history: QuestionHistoryEntry[];
  questionId: number;
  mappedClusters: string[];
  isSharpened: boolean;
}): ApplySkipResult {
  const { history, questionId, mappedClusters, isSharpened } = params;
  const priorIndex = history.findIndex((h) => h.question_id === questionId);
  const prior = priorIndex !== -1 ? history[priorIndex] : null;
  const priorWasDecisive = prior?.status === "answered";
  const skipEntry: SkippedEntry = {
    question_id: questionId,
    status: "skipped",
    mapped_clusters: mappedClusters,
    is_sharpened_question: isSharpened,
  };
  const newHistory: QuestionHistoryEntry[] =
    priorIndex !== -1
      ? history.map((h, i) => (i === priorIndex ? skipEntry : h))
      : [...history, skipEntry];
  return { history: newHistory, decisiveCountDelta: priorWasDecisive ? -1 : 0 };
}

/** Which wording was last shown for this question, so navigating back to it restores the same view. Defaults to standard (false) for a question never reached. */
export function sharpenedForEntry(history: QuestionHistoryEntry[], questionId: number): boolean {
  return history.find((h) => h.question_id === questionId)?.is_sharpened_question ?? false;
}

/** The decisive answers only — what scoring and the adaptive engine should ever see. Skipped entries contribute nothing. */
export function latestDecisiveEntries(history: QuestionHistoryEntry[]): AnsweredEntry[] {
  return history.filter((h): h is AnsweredEntry => h.status === "answered");
}
