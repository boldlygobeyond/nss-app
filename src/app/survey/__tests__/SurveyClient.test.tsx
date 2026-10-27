/** @vitest-environment jsdom */
// Mounts the REAL SurveyClient component — with its actual useState/
// useCallback wiring, the actual QuestionCard, and the actual
// questionHistory.ts/api.ts call sites — against a fake Supabase client
// and a small deterministic question-bank fixture. This is the end-to-end
// layer the 32 existing unit/QuestionCard tests don't reach: see
// NSS_Back_Navigation_And_Duplicate_Fix.md for why that gap existed and
// what's covered here versus there.
//
// buildCalibrationSequence shuffles its input via a function it calls on
// itself *within* surveyEngine.ts — mocking the module's export doesn't
// intercept that same-module call, so which 21 fixture questions open the
// survey (and in what order) is genuinely randomized every run, exactly
// as in production. These tests deliberately don't assume a fixed
// question order: they read whatever question is actually on screen from
// its own rendered heading and act on that, the same way a real
// respondent would.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CLUSTERS, type ClusterKey } from "@/lib/nss/clusters";
import type { SurveyQuestion } from "@/lib/nss/questions";
import SurveyClient from "../SurveyClient";

function allPairs(): [ClusterKey, ClusterKey][] {
  const pairs: [ClusterKey, ClusterKey][] = [];
  for (let i = 0; i < CLUSTERS.length; i++) {
    for (let j = i + 1; j < CLUSTERS.length; j++) pairs.push([CLUSTERS[i], CLUSTERS[j]]);
  }
  return pairs;
}

function makeQuestion(id: number, [a, b]: [ClusterKey, ClusterKey]): SurveyQuestion {
  return {
    id,
    topic: `${a}-vs-${b}`,
    mappedClusters: [a, b],
    standard: { question: `Q${id} standard: ${a} vs ${b}?`, options: { A: `${a} option`, B: `${b} option` } },
    sharpened: {
      question: `Q${id} sharpened: ${a} vs ${b}?`,
      options: { A: `${a} sharpened option`, B: `${b} sharpened option` },
    },
  };
}

const PAIRS = allPairs(); // exactly 21 — one per unique cluster pair
const CALIBRATION_QUESTIONS = PAIRS.map((pair, i) => makeQuestion(i + 1, pair)); // ids 1-21
// Adaptive-phase-only pool: reuses pairs (as the real ~4-per-pair bank
// does) so there's something for selectNextBtQuestion to pick from once
// calibration's 21 are all used.
const ADAPTIVE_EXTRA_QUESTIONS = PAIRS.slice(0, 10).map((pair, i) => makeQuestion(101 + i, pair));
const FIXTURE_QUESTIONS = [...CALIBRATION_QUESTIONS, ...ADAPTIVE_EXTRA_QUESTIONS];

function pairForId(id: number): [ClusterKey, ClusterKey] {
  return id >= 101 ? PAIRS[id - 101] : PAIRS[id - 1];
}

vi.mock("@/lib/nss/questions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nss/questions")>();
  return { ...actual, fetchQuestions: vi.fn(async () => FIXTURE_QUESTIONS) };
});
vi.mock("@/lib/nss/userProfiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nss/userProfiles")>();
  return { ...actual, getMyProfile: vi.fn(async () => null) };
});

let mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

// Reconfigured per test via setMockSupabase() before render(), so each
// test's createClient() call (both SurveyClient's and NovaGreeting's own)
// picks up that test's configuration.
let activeMockClient: ReturnType<typeof buildMockClient>["client"];
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => activeMockClient,
}));

function makeChainable(
  resolvers: Partial<Record<"select" | "insert" | "update" | "delete", () => { data?: unknown; error?: unknown }>>,
  onResolve?: (op: "select" | "insert" | "update" | "delete", filters: Record<string, unknown>) => void,
) {
  const state: { op: "select" | "insert" | "update" | "delete"; filters: Record<string, unknown> } = {
    op: "select",
    filters: {},
  };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ["select", "in", "not", "order", "limit"]) builder[m] = vi.fn(chain);
  builder.eq = vi.fn((col: string, val: unknown) => {
    state.filters[col] = val;
    return builder;
  });
  builder.insert = vi.fn(() => {
    state.op = "insert";
    return builder;
  });
  builder.update = vi.fn(() => {
    state.op = "update";
    return builder;
  });
  builder.delete = vi.fn(() => {
    state.op = "delete";
    return builder;
  });
  const resolve = () => {
    onResolve?.(state.op, state.filters);
    return Promise.resolve((resolvers[state.op] ?? resolvers.select ?? (() => ({ data: null, error: null })))());
  };
  builder.maybeSingle = vi.fn(resolve);
  builder.single = vi.fn(resolve);
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => resolve().then(res, rej);
  return builder;
}

function buildMockClient(config: {
  userId: string;
  inProgressSubmission?: Record<string, unknown> | null;
  createdSubmission?: Record<string, unknown>;
  rpcImpl?: (name: string, args: Record<string, unknown>) => { error: unknown };
  onResponsesDelete?: (filters: Record<string, unknown>) => void;
}) {
  const rpcMock = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (config.rpcImpl) return config.rpcImpl(name, args);
    return { error: null };
  });
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: config.userId, email: "test@example.com" } } })) },
    from: vi.fn((table: string) => {
      if (table === "nss_submissions") {
        return makeChainable({
          select: () => ({ data: config.inProgressSubmission ?? null, error: null }),
          insert: () => ({ data: config.createdSubmission ?? { id: "sub-fresh" }, error: null }),
          update: () => ({ error: null }),
        });
      }
      if (table === "nss_responses") {
        return makeChainable({ select: () => ({ data: [], error: null }) }, (op, filters) => {
          if (op === "delete") config.onResponsesDelete?.(filters);
        });
      }
      return makeChainable({ select: () => ({ data: null, error: null }) });
    }),
    rpc: rpcMock,
  };
  return { client, rpcMock };
}

function setMockSupabase(config: Parameters<typeof buildMockClient>[0]) {
  const { client, rpcMock } = buildMockClient(config);
  activeMockClient = client;
  return rpcMock;
}

function headingText(): string {
  return screen.getByRole("heading", { level: 2 }).textContent ?? "";
}

function parseQuestionId(text: string): number {
  const m = text.match(/^Q(\d+)/);
  if (!m) throw new Error(`cannot parse a question id from heading "${text}"`);
  return Number(m[1]);
}

function currentQuestionId(): number {
  return parseQuestionId(headingText());
}

function isSharpenedHeading(): boolean {
  return headingText().includes(" sharpened:");
}

async function waitForHeadingChange(before: string) {
  await waitFor(() => {
    expect(headingText()).not.toBe(before);
  });
}

async function driveToSurvey() {
  const nameInput = await screen.findByPlaceholderText("Your first name");
  fireEvent.change(nameInput, { target: { value: "Test User" } });
  fireEvent.submit(nameInput.closest("form")!);
  const pronounButton = await screen.findByText("he/him");
  fireEvent.click(pronounButton);
  await new Promise((r) => setTimeout(r, 350)); // NovaGreeting's own 300ms step transition
  const readyButton = await screen.findByRole("button", { name: /begin/i });
  fireEvent.click(readyButton);
  await screen.findByRole("heading", { level: 2 });
  return currentQuestionId();
}

/** Clicks option A or B on whatever question is currently on screen (standard or sharpened, whichever is showing), and waits for the heading to change. Returns the new heading's question id. */
async function answer(letter: "A" | "B") {
  const id = currentQuestionId();
  const pair = pairForId(id);
  const wording = isSharpenedHeading() ? "sharpened option" : "option";
  const cluster = letter === "A" ? pair[0] : pair[1];
  const before = headingText();
  fireEvent.click(screen.getByText(`${cluster} ${wording}`));
  await waitForHeadingChange(before);
  return currentQuestionId();
}

beforeEach(() => {
  localStorage.clear();
  mockRouterPush = vi.fn();
});

describe("SurveyClient — real component, mocked Supabase only", () => {
  it("Back across multiple answered questions, a correction, and chronological forward review (no second write, no count change)", async () => {
    const rpc = setMockSupabase({ userId: "user-1", createdSubmission: { id: "sub-1" } });
    render(<SurveyClient />);
    const qA = await driveToSurvey();
    const pairA = pairForId(qA);

    await answer("A"); // Q(A) answered -> Q(B)
    const qB = currentQuestionId();
    await answer("A"); // Q(B) answered -> Q(C)
    expect(rpc).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(currentQuestionId()).toBe(qB));
    expect(screen.getByText("Reviewing your answer")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(currentQuestionId()).toBe(qA));
    expect(screen.getByText("Reviewing your answer")).toBeInTheDocument();

    // Correction: pick the OPPOSITE option on Q(A).
    const beforeCorrection = headingText();
    fireEvent.click(screen.getByText(`${pairA[1]} option`)); // the "B" side
    await waitForHeadingChange(beforeCorrection);

    // Chronological, not a jump back to Q(C): next stop is Q(B), still
    // showing its own original answer (review mode), not Q(C).
    expect(currentQuestionId()).toBe(qB);
    expect(screen.getByText("Reviewing your answer")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(3); // Q(A), Q(B), Q(A)-correction — no 4th call

    const beforeNext = headingText();
    fireEvent.click(screen.getByText("Next"));
    await waitForHeadingChange(beforeNext);
    expect(screen.queryByText("Reviewing your answer")).not.toBeInTheDocument(); // genuinely never visited before
    expect(rpc).toHaveBeenCalledTimes(3); // Next-without-change never writes

    // Decisive count: Q(A) + Q(B) = 2 (the correction didn't add a 3rd).
    expect(screen.getByText("Question 3")).toBeInTheDocument();

    const lastCall = rpc.mock.calls[2][1] as Record<string, unknown>;
    expect(lastCall).toMatchObject({ p_question_id: qA, p_selection: "B" });
  });

  it("Review Next without changing anything never issues another write", async () => {
    const rpc = setMockSupabase({ userId: "user-1", createdSubmission: { id: "sub-1" } });
    render(<SurveyClient />);
    const qA = await driveToSurvey();

    await answer("A");
    expect(rpc).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(currentQuestionId()).toBe(qA));
    const before = headingText();
    fireEvent.click(screen.getByText("Next"));
    await waitForHeadingChange(before);

    expect(rpc).toHaveBeenCalledTimes(1); // still just the original answer
  });

  it("skip under sharpened wording, Back restores sharpened + skip indicator, then a decisive answer counts once", async () => {
    const rpc = setMockSupabase({ userId: "user-1", createdSubmission: { id: "sub-1" } });
    render(<SurveyClient />);
    const qA = await driveToSurvey();
    const pairA = pairForId(qA);

    const beforeDepends = headingText();
    fireEvent.click(screen.getByText("It Depends"));
    await waitForHeadingChange(beforeDepends);
    expect(isSharpenedHeading()).toBe(true);

    const beforeSkip = headingText();
    fireEvent.click(screen.getByText("Skip this one"));
    await waitForHeadingChange(beforeSkip);
    expect(rpc).not.toHaveBeenCalled(); // a skip never writes

    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(currentQuestionId()).toBe(qA));
    expect(isSharpenedHeading()).toBe(true); // restored under the SAME (sharpened) wording it was skipped under
    expect(screen.getByText("You skipped this one")).toBeInTheDocument();

    const beforeDecisive = headingText();
    fireEvent.click(screen.getByText(`${pairA[0]} sharpened option`));
    await waitForHeadingChange(beforeDecisive);
    expect(rpc).toHaveBeenCalledTimes(1); // the first real write
    expect(screen.getByText("Question 2")).toBeInTheDocument(); // decisive count now 1
  });

  it("answered via It Depends, Back restores sharpened wording with the answer marked, not standard", async () => {
    setMockSupabase({ userId: "user-1", createdSubmission: { id: "sub-1" } });
    render(<SurveyClient />);
    const qA = await driveToSurvey();

    const beforeDepends = headingText();
    fireEvent.click(screen.getByText("It Depends"));
    await waitForHeadingChange(beforeDepends);
    await answer("B");

    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(currentQuestionId()).toBe(qA));
    expect(isSharpenedHeading()).toBe(true); // not standard
    expect(screen.getByText("Reviewing your answer")).toBeInTheDocument();
  });

  it("reload/resume: same-browser localStorage state is picked up directly, skipping the greeting", async () => {
    const savedState = {
      version: 3,
      submissionId: "sub-resume",
      userName: "Test User",
      userPronouns: "they/them",
      sequenceIds: [1, 2],
      questionIndex: 1,
      tally: Object.fromEntries(CLUSTERS.map((c) => [c, { wins: 0, losses: 0 }])),
      questionsAnswered: 1,
      questionHistory: [
        {
          question_id: 1,
          status: "answered",
          question_text: "Q1 standard: Agency vs Belonging?",
          user_selection: "A",
          chosen_clusters: ["Agency"],
          rejected_clusters: ["Belonging"],
          mapped_clusters: ["Agency", "Belonging"],
          is_sharpened_question: false,
          answered_at: new Date().toISOString(),
        },
      ],
      isSharpened: false,
      btResponses: [{ chosen_clusters: ["Agency"], rejected_clusters: ["Belonging"] }],
      deliveryState: {
        recentPairKeys: [],
        recentQuestionClusters: [],
        lastSeenAt: Object.fromEntries(CLUSTERS.map((c) => [c, 0])),
        pendingValidation: [],
      },
    };
    localStorage.setItem("nss_survey_state", JSON.stringify(savedState));

    setMockSupabase({ userId: "user-1", inProgressSubmission: { id: "sub-resume" } });
    render(<SurveyClient />);

    // Resumes straight into the survey at question 2 — no greeting shown.
    await screen.findByText(/^Q2 standard:/);
    expect(screen.queryByPlaceholderText("Your first name")).not.toBeInTheDocument();
    // The displayed question number reflects where resume actually landed
    // (position 2 in the restored sequence), matching the real position,
    // not some default.
    expect(screen.getByText("Question 2")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Back"));
    await screen.findByText(/^Q1 standard:/);
    expect(screen.getByText("Reviewing your answer")).toBeInTheDocument();
    // Reviewing the first question after a reload shows "Question 1", not
    // "Question 2" (frontier) and not reset to something else — restored
    // state feeds the same questionIndex-based display real navigation
    // uses, not a separately-tracked value that could drift after reload.
    expect(screen.getByText("Question 1")).toBeInTheDocument();
  });

  it("calibration hands off to the adaptive pool at question 22 with the right decisive count", async () => {
    const rpc = setMockSupabase({ userId: "user-1", createdSubmission: { id: "sub-1" } });
    render(<SurveyClient />);
    await driveToSurvey();

    // Several fixture pairs have two candidate questions (a calibration
    // one and an adaptive-only one) — same as the real bank, where several
    // questions can share a pair — so buildCalibrationSequence's own
    // shuffle, not this fixture's id numbering, decides which 21 end up in
    // calibration. The invariant that actually matters: exactly 21
    // distinct questions get asked before the handoff, and question 22 is
    // a genuinely new one, not a repeat.
    const seenIds = new Set<number>();
    for (let i = 0; i < 21; i++) {
      seenIds.add(currentQuestionId());
      await answer("A");
    }
    expect(seenIds.size).toBe(21);

    // Confirms the calibration -> adaptive handoff actually ran, not just
    // that calibration itself didn't crash.
    expect(seenIds.has(currentQuestionId())).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(21);
    expect(screen.getByText("Question 22")).toBeInTheDocument();
  }, 15000); // 21 sequential answer()/waitFor cycles comfortably exceed the 5s default

  it("rapid repeated clicks on the same option only produce one write and one advance", async () => {
    const rpc = setMockSupabase({ userId: "user-1", createdSubmission: { id: "sub-1" } });
    render(<SurveyClient />);
    const qA = await driveToSurvey();
    const pairA = pairForId(qA);

    const before = headingText();
    const optionButton = screen.getByText(`${pairA[0]} option`);
    // fireEvent.click() individually flushes React's render+effects before
    // returning (that's what act() guarantees), so two *separate*
    // fireEvent.click() calls can never land inside the same pre-commit
    // window a real rapid double-click does — by the time the second call
    // runs, the effect that resets processingRef has already committed.
    // Dispatching both raw events inside one act() batches them the way
    // two physical clicks landing within the same tick actually would,
    // which is the scenario beginProcessing's guard exists for.
    await act(async () => {
      optionButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      optionButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    await waitForHeadingChange(before);
    const afterFirstAdvance = headingText();
    // Give any wrongly-accepted extra clicks a chance to also take effect
    // before asserting nothing further moved.
    await new Promise((r) => setTimeout(r, 50));
    expect(headingText()).toBe(afterFirstAdvance);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("the displayed question number reflects the question being viewed, not decisive-answer progress", async () => {
    setMockSupabase({ userId: "user-1", createdSubmission: { id: "sub-1" } });
    render(<SurveyClient />);
    await driveToSurvey();
    expect(screen.getByText("Question 1")).toBeInTheDocument();

    await answer("A");
    expect(screen.getByText("Question 2")).toBeInTheDocument();
    await answer("A");
    expect(screen.getByText("Question 3")).toBeInTheDocument();
    expect(screen.getByText("4%")).toBeInTheDocument(); // 2/50 decisive

    // Waits on the heading (not just the progress label, which updates a
    // render ahead of the animated card — see waitForHeadingChange) so
    // the card is actually settled before the next interaction.
    let before = headingText();
    fireEvent.click(screen.getByText("Back"));
    await waitForHeadingChange(before);
    expect(screen.getByText("Question 2")).toBeInTheDocument();
    expect(screen.queryByText("Question 3")).not.toBeInTheDocument();
    // Completion stays pinned to real decisive progress while reviewing
    // an earlier question — reviewing never reduces it.
    expect(screen.getByText("4%")).toBeInTheDocument();

    before = headingText();
    fireEvent.click(screen.getByText("Back"));
    await waitForHeadingChange(before);
    expect(screen.getByText("Question 1")).toBeInTheDocument();
    expect(screen.getByText("4%")).toBeInTheDocument();

    // Moving forward again restores the correct numbering.
    before = headingText();
    fireEvent.click(screen.getByText("Next"));
    await waitForHeadingChange(before);
    expect(screen.getByText("Question 2")).toBeInTheDocument();

    before = headingText();
    fireEvent.click(screen.getByText("Next"));
    await waitForHeadingChange(before);
    expect(screen.getByText("Question 3")).toBeInTheDocument();
  });

  it("Back from an already-answered sharpened question steps to standard wording first, a second Back then goes to the previous question", async () => {
    setMockSupabase({ userId: "user-1", createdSubmission: { id: "sub-1" } });
    render(<SurveyClient />);
    const qA = await driveToSurvey();
    await answer("A"); // Q(A) answered standard -> advances to Q(B)
    const qB = currentQuestionId();

    const beforeDepends = headingText();
    fireEvent.click(screen.getByText("It Depends"));
    await waitForHeadingChange(beforeDepends);
    expect(isSharpenedHeading()).toBe(true);
    await answer("B"); // commits a sharpened answer for Q(B), advances to Q(C)
    const qC = currentQuestionId();
    expect(qC).not.toBe(qA);
    expect(qC).not.toBe(qB);

    // First Back: restores Q(B) in sharpened wording (pre-existing behavior).
    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(currentQuestionId()).toBe(qB));
    expect(isSharpenedHeading()).toBe(true);

    // Second Back: now steps to STANDARD wording of the SAME question —
    // the gap this fix closes. Previously an already-committed sharpened
    // answer skipped straight past standard wording to Q(A) instead.
    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(isSharpenedHeading()).toBe(false));
    expect(currentQuestionId()).toBe(qB);

    // Third Back: now moves to the preceding question.
    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(currentQuestionId()).toBe(qA));
  });

  it("choosing a standard answer after stepping back from a committed sharpened answer replaces it, not a duplicate record", async () => {
    const rpc = setMockSupabase({ userId: "user-1", createdSubmission: { id: "sub-1" } });
    render(<SurveyClient />);
    const qA = await driveToSurvey();
    const pairA = pairForId(qA);

    const beforeDepends = headingText();
    fireEvent.click(screen.getByText("It Depends"));
    await waitForHeadingChange(beforeDepends);
    await answer("B"); // commits sharpened B for Q(A)
    expect(rpc).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Back")); // -> sharpened restore
    await waitFor(() => expect(currentQuestionId()).toBe(qA));
    fireEvent.click(screen.getByText("Back")); // -> standard wording, same question
    await waitFor(() => expect(isSharpenedHeading()).toBe(false));
    expect(currentQuestionId()).toBe(qA);

    const beforeCorrection = headingText();
    fireEvent.click(screen.getByText(`${pairA[0]} option`));
    await waitForHeadingChange(beforeCorrection);
    expect(rpc).toHaveBeenCalledTimes(2); // a correction, not an additional record
    const lastCall = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(lastCall).toMatchObject({ p_question_id: qA, p_is_sharpened: false, p_selection: "A" });
  });

  it("returning to the sharpened view without choosing a new answer preserves the original sharpened selection", async () => {
    const rpc = setMockSupabase({ userId: "user-1", createdSubmission: { id: "sub-1" } });
    render(<SurveyClient />);
    const qA = await driveToSurvey();

    const beforeDepends = headingText();
    fireEvent.click(screen.getByText("It Depends"));
    await waitForHeadingChange(beforeDepends);
    await answer("B"); // commits sharpened B
    expect(rpc).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Back")); // -> sharpened restore
    await waitFor(() => expect(currentQuestionId()).toBe(qA));
    fireEvent.click(screen.getByText("Back")); // -> standard wording, same question
    await waitFor(() => expect(isSharpenedHeading()).toBe(false));

    // Without picking anything, return to sharpened wording via It Depends.
    const beforeReDepends = headingText();
    fireEvent.click(screen.getByText("It Depends"));
    await waitForHeadingChange(beforeReDepends);
    expect(isSharpenedHeading()).toBe(true);

    // Nothing was written just by looking — still exactly the one original write.
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("Skip is available on a reviewed, already-answered sharpened question; converting it to a skip decrements the count and deletes the stale row", async () => {
    const deletedFilters: Record<string, unknown>[] = [];
    const rpc = setMockSupabase({
      userId: "user-1",
      createdSubmission: { id: "sub-1" },
      onResponsesDelete: (filters) => deletedFilters.push(filters),
    });
    render(<SurveyClient />);
    const qA = await driveToSurvey();

    const beforeDepends = headingText();
    fireEvent.click(screen.getByText("It Depends"));
    await waitForHeadingChange(beforeDepends);
    await answer("A"); // commits a sharpened decisive answer for Q(A)
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByText("2%")).toBeInTheDocument(); // 1/50 decisive so far

    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(currentQuestionId()).toBe(qA));
    expect(isSharpenedHeading()).toBe(true);

    // Skip must be visible here now — previously only Next was shown
    // while reviewing a sharpened question, with no way to skip it.
    const beforeSkip = headingText();
    fireEvent.click(screen.getByText("Skip this one"));
    await waitForHeadingChange(beforeSkip);

    expect(deletedFilters).toEqual([{ submission_id: "sub-1", question_id: qA }]);
    expect(screen.getByText("0%")).toBeInTheDocument(); // decisive count correctly back to 0
    expect(rpc).toHaveBeenCalledTimes(1); // no new upsert call from skipping — the original write was deleted, not replaced
  });

  it("skipping while reconsidering a standard answer via It Depends also un-counts and deletes the prior (standard) row", async () => {
    const deletedFilters: Record<string, unknown>[] = [];
    const rpc = setMockSupabase({
      userId: "user-1",
      createdSubmission: { id: "sub-1" },
      onResponsesDelete: (filters) => deletedFilters.push(filters),
    });
    render(<SurveyClient />);
    const qA = await driveToSurvey();
    await answer("A"); // Q(A) answered under STANDARD wording
    expect(rpc).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(currentQuestionId()).toBe(qA));
    expect(isSharpenedHeading()).toBe(false);

    const beforeDepends = headingText();
    fireEvent.click(screen.getByText("It Depends")); // reconsider via sharpened, nothing committed yet
    await waitForHeadingChange(beforeDepends);
    expect(isSharpenedHeading()).toBe(true);

    const beforeSkip = headingText();
    fireEvent.click(screen.getByText("Skip this one"));
    await waitForHeadingChange(beforeSkip);

    expect(deletedFilters).toEqual([{ submission_id: "sub-1", question_id: qA }]);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});
