// Covers the decision logic behind Back navigation, answer corrections,
// and duplicate prevention (NSS_Back_Navigation_And_Duplicate_Fix.md):
// confirmation vs. correction vs. first decisive answer, the decisive
// count, and that a question never ends up with two history entries.
// This is the exact module SurveyClient.tsx's handleAnswer/handleSkip call
// — not a parallel reimplementation — so these tests exercise the real
// decision logic, independent of React/Supabase.
import { describe, it, expect } from "vitest";
import {
  applyAnswerToHistory,
  applySkipToHistory,
  sharpenedForEntry,
  latestDecisiveEntries,
  type QuestionHistoryEntry,
} from "../questionHistory";

const base = {
  questionId: 5,
  chosenClusters: ["Recognition"],
  rejectedClusters: ["Connections"],
  mappedClusters: ["Recognition", "Connections"],
  answeredAt: "2026-10-26T10:00:00.000Z",
};

describe("applyAnswerToHistory", () => {
  it("1. standard answer -> appends a fresh decisive entry and counts it", () => {
    const result = applyAnswerToHistory({
      history: [],
      ...base,
      questionText: "standard?",
      choice: "A",
      isSharpened: false,
    });
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({ question_id: 5, status: "answered", user_selection: "A" });
    expect(result.isConfirmation).toBe(false);
    expect(result.decisiveCountDelta).toBe(1);
  });

  it("2. Back -> opposite answer -> replaces the entry, not a second one, and does not change the count", () => {
    const first = applyAnswerToHistory({
      history: [],
      ...base,
      questionText: "standard?",
      choice: "A",
      isSharpened: false,
    });
    const second = applyAnswerToHistory({
      history: first.history,
      ...base,
      questionText: "standard?",
      choice: "B",
      isSharpened: false,
      answeredAt: "2026-10-26T10:00:05.000Z",
    });
    expect(second.history).toHaveLength(1);
    expect(second.history[0]).toMatchObject({ user_selection: "B" });
    expect(second.isConfirmation).toBe(false);
    expect(second.decisiveCountDelta).toBe(0);
  });

  it("re-selecting the exact same answer, same wording, is a confirmation: no change, no count delta", () => {
    const first = applyAnswerToHistory({
      history: [],
      ...base,
      questionText: "standard?",
      choice: "A",
      isSharpened: false,
    });
    const confirm = applyAnswerToHistory({
      history: first.history,
      ...base,
      questionText: "standard?",
      choice: "A",
      isSharpened: false,
      answeredAt: "2026-10-26T10:00:05.000Z",
    });
    expect(confirm.isConfirmation).toBe(true);
    expect(confirm.decisiveCountDelta).toBe(0);
    // Nothing changed -- the returned history is the exact same reference,
    // not a new array with an identical entry, so a caller that skips the
    // setState call on isConfirmation doesn't silently drop data either.
    expect(confirm.history).toBe(first.history);
  });

  it("3. standard answer -> Back -> It Depends -> sharpened answer: replaces with sharpened wording recorded", () => {
    const first = applyAnswerToHistory({
      history: [],
      ...base,
      questionText: "standard?",
      choice: "A",
      isSharpened: false,
    });
    const sharpened = applyAnswerToHistory({
      history: first.history,
      ...base,
      questionText: "sharpened?",
      choice: "B",
      isSharpened: true,
      originalQuestionId: 4,
      answeredAt: "2026-10-26T10:00:05.000Z",
    });
    expect(sharpened.history).toHaveLength(1);
    expect(sharpened.history[0]).toMatchObject({
      is_sharpened_question: true,
      question_text: "sharpened?",
      user_selection: "B",
      original_question_id: 4,
    });
    expect(sharpened.isConfirmation).toBe(false);
    expect(sharpened.decisiveCountDelta).toBe(0);
  });

  it("4 & 5. sharpened answer -> Back -> same sharpened answer is a confirmation; a different one is a correction", () => {
    const first = applyAnswerToHistory({
      history: [],
      ...base,
      questionText: "sharpened?",
      choice: "A",
      isSharpened: true,
    });
    const same = applyAnswerToHistory({
      history: first.history,
      ...base,
      questionText: "sharpened?",
      choice: "A",
      isSharpened: true,
    });
    expect(same.isConfirmation).toBe(true);

    const changed = applyAnswerToHistory({
      history: first.history,
      ...base,
      questionText: "sharpened?",
      choice: "B",
      isSharpened: true,
    });
    expect(changed.isConfirmation).toBe(false);
    expect(changed.history).toHaveLength(1);
    expect(changed.history[0]).toMatchObject({ user_selection: "B" });
  });

  it("7. a previously skipped question, now answered, records a decisive answer and increments the count", () => {
    const history: QuestionHistoryEntry[] = [
      { question_id: 5, status: "skipped", mapped_clusters: ["Recognition", "Connections"], is_sharpened_question: false },
    ];
    const result = applyAnswerToHistory({
      history,
      ...base,
      questionText: "standard?",
      choice: "A",
      isSharpened: false,
    });
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({ status: "answered", user_selection: "A" });
    expect(result.decisiveCountDelta).toBe(1);
  });

  it("8. correcting an earlier question in a multi-question history only touches that one entry", () => {
    const history: QuestionHistoryEntry[] = [
      {
        question_id: 22,
        status: "answered",
        question_text: "q22",
        user_selection: "A",
        chosen_clusters: ["Recognition"],
        rejected_clusters: ["Connections"],
        mapped_clusters: ["Recognition", "Connections"],
        is_sharpened_question: false,
        answered_at: "t1",
      },
      {
        question_id: 23,
        status: "answered",
        question_text: "q23",
        user_selection: "B",
        chosen_clusters: ["Stability"],
        rejected_clusters: ["Growth"],
        mapped_clusters: ["Stability", "Growth"],
        is_sharpened_question: false,
        answered_at: "t2",
      },
    ];
    const result = applyAnswerToHistory({
      history,
      questionId: 22,
      questionText: "q22",
      choice: "B",
      chosenClusters: ["Connections"],
      rejectedClusters: ["Recognition"],
      mappedClusters: ["Recognition", "Connections"],
      isSharpened: false,
      answeredAt: "t3",
    });
    expect(result.history).toHaveLength(2);
    expect(result.history.find((h) => h.question_id === 22)).toMatchObject({ user_selection: "B" });
    expect(result.history.find((h) => h.question_id === 23)).toMatchObject({ user_selection: "B", question_text: "q23" });
    expect(result.decisiveCountDelta).toBe(0);
  });
});

describe("applySkipToHistory", () => {
  it("6. sharpened -> skip -> Back restores the skipped sharpened state", () => {
    const history = applySkipToHistory({ history: [], questionId: 5, mappedClusters: ["Recognition", "Connections"], isSharpened: true });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "skipped", is_sharpened_question: true });
    expect(sharpenedForEntry(history, 5)).toBe(true);
  });

  it("replaces rather than duplicates when skipping the same question twice", () => {
    const once = applySkipToHistory({ history: [], questionId: 5, mappedClusters: ["Recognition", "Connections"], isSharpened: false });
    const twice = applySkipToHistory({ history: once, questionId: 5, mappedClusters: ["Recognition", "Connections"], isSharpened: true });
    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ is_sharpened_question: true });
  });
});

describe("sharpenedForEntry", () => {
  it("defaults to standard wording for a question never reached", () => {
    expect(sharpenedForEntry([], 99)).toBe(false);
  });
});

describe("latestDecisiveEntries", () => {
  it("12. excludes skipped entries from scoring input", () => {
    const history: QuestionHistoryEntry[] = [
      {
        question_id: 1,
        status: "answered",
        question_text: "q1",
        user_selection: "A",
        chosen_clusters: ["Recognition"],
        rejected_clusters: ["Connections"],
        mapped_clusters: ["Recognition", "Connections"],
        is_sharpened_question: false,
        answered_at: "t1",
      },
      { question_id: 2, status: "skipped", mapped_clusters: ["Stability", "Growth"], is_sharpened_question: false },
    ];
    const decisive = latestDecisiveEntries(history);
    expect(decisive).toHaveLength(1);
    expect(decisive[0].question_id).toBe(1);
  });
});
