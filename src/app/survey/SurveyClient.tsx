"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile } from "@/lib/nss/userProfiles";
import { fetchQuestions, type SurveyQuestion } from "@/lib/nss/questions";
import {
  buildCalibrationSequence,
  selectAdaptiveBlock,
  initTally,
  recordAnswer,
  tallyToScores,
  getTopNeeds,
  type Tally,
} from "@/lib/nss/surveyEngine";
import {
  selectNextBtQuestion,
  seedDeliveryStateFromHistory,
  applyAnswerOutcome,
  initDeliveryState,
  btShouldStop,
  type DeliveryState,
} from "@/lib/nss/adaptiveDelivery";
import { rankByBradleyTerry, btFavorability, type BtResponse } from "@/lib/nss/bradleyTerry";
import { CLUSTERS, type ClusterKey } from "@/lib/nss/clusters";
import {
  createSubmission,
  updateSubmissionProgress,
  finishSubmission,
  upsertResponse,
  deleteResponse,
  StaleWriteError,
  findInProgressSubmission,
  listResponsesForSubmission,
} from "@/lib/nss/api";
import {
  applyAnswerToHistory,
  applySkipToHistory,
  sharpenedForEntry,
  latestDecisiveEntries,
  type AnsweredEntry,
  type QuestionHistoryEntry,
} from "@/lib/nss/questionHistory";
import NovaGreeting from "@/components/survey/NovaGreeting";
import QuestionCard from "@/components/survey/QuestionCard";
import ProgressIndicator from "@/components/survey/ProgressIndicator";

const STORAGE_KEY = "nss_survey_state";
// Bumped: the persisted shape changed from a flat answered-only array
// (AnsweredDetail[]) to a richer per-question history that also tracks
// skips (QuestionHistoryEntry[], discriminated by `status`) — an old
// stored blob wouldn't have `status` on its entries and would silently
// misbehave if loaded as the new shape, so it's invalidated like any
// other incompatible version.
const STATE_VERSION = 3;
const HARD_STOP = 50;
// Switches between the legacy win-rate engine and the Oct 2026 rebalance
// (new 86-question bank + Bradley-Terry delivery/scoring). Live in
// production today (confirmed via `vercel env ls`) — see questions.ts's
// matching useNewBank flag, which must agree with this one.
const USE_BT_ENGINE = process.env.NEXT_PUBLIC_NSS_ENGINE === "bt";

function serializeDeliveryState(state: DeliveryState) {
  return { ...state, pendingValidation: [...state.pendingValidation] };
}
function deserializeDeliveryState(raw: ReturnType<typeof serializeDeliveryState>): DeliveryState {
  return { ...raw, pendingValidation: new Set(raw.pendingValidation) };
}

interface SavedState {
  version: number;
  submissionId: string | null;
  userName: string;
  userPronouns: string;
  sequenceIds: number[];
  questionIndex: number;
  tally: Tally;
  questionsAnswered: number;
  questionHistory: QuestionHistoryEntry[];
  isSharpened: boolean;
  btResponses: BtResponse[];
  deliveryState: ReturnType<typeof serializeDeliveryState>;
}

function loadSavedState(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedState;
    if (!parsed.version || parsed.version < STATE_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistLocalState(state: Omit<SavedState, "version">) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: STATE_VERSION }));
  } catch {
    // ignore — best-effort only
  }
}

function sequenceFromIds(questions: SurveyQuestion[], ids: number[]): SurveyQuestion[] {
  const map = Object.fromEntries(questions.map((q) => [q.id, q]));
  return ids.map((id) => map[id]).filter(Boolean);
}

/**
 * Picks the next BT-adaptive question. On the very first call after
 * calibration ends (sequence.length === 21, checked by the caller),
 * deliveryState hasn't seen any of the 21 calibration answers yet — those
 * were played straight through from the fixed sequence, not selected by
 * this module — so it's seeded from that history first.
 */
function pullNextQuestionBt(
  pool: SurveyQuestion[],
  btResponsesSoFar: BtResponse[],
  usedIdsSoFar: Set<number>,
  currentDeliveryState: DeliveryState,
  answeredSoFar: number,
  calibrationJustCompleted: boolean,
  answeredHistoryForSeed: { mapped_clusters: string[]; is_sharpened_question: boolean }[],
): { question: SurveyQuestion; nextState: DeliveryState } | null {
  const stateForSelection = calibrationJustCompleted
    ? seedDeliveryStateFromHistory(
        answeredHistoryForSeed.map((d) => ({
          mappedClusters: d.mapped_clusters as [ClusterKey, ClusterKey],
          isSharpened: d.is_sharpened_question,
        })),
      )
    : currentDeliveryState;
  return selectNextBtQuestion(pool, btResponsesSoFar, usedIdsSoFar, stateForSelection, answeredSoFar);
}

type Phase = "loading" | "greeting" | "survey" | "completing";

export default function SurveyClient() {
  const router = useRouter();

  const supabase = useRef(createClient()).current;

  const [phase, setPhase] = useState<Phase>("loading");
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userTeam, setUserTeam] = useState<string | null>(null);

  const [greetingStep, setGreetingStep] = useState(0);
  const [userName, setUserName] = useState("");
  const [userPronouns, setUserPronouns] = useState("");
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  const [sequence, setSequence] = useState<SurveyQuestion[]>([]);
  const [usedIds, setUsedIds] = useState<Set<number>>(new Set());
  const [tally, setTally] = useState<Tally>(initTally());
  const [questionIndex, setQuestionIndex] = useState(0);
  const [isSharpened, setIsSharpened] = useState(false);
  const [questionsAnswered, setQuestionsAnswered] = useState(0);
  const [questionHistory, setQuestionHistory] = useState<QuestionHistoryEntry[]>([]);
  const [lastQuestionId, setLastQuestionId] = useState<number | null>(null);
  const [btResponses, setBtResponses] = useState<BtResponse[]>([]);
  const [deliveryState, setDeliveryState] = useState<DeliveryState>(initDeliveryState());
  const [writeFailureNotice, setWriteFailureNotice] = useState(false);

  const currentQuestion = sequence[questionIndex] || null;
  const currentHistoryEntry = currentQuestion
    ? (questionHistory.find((h) => h.question_id === currentQuestion.id) ?? null)
    : null;
  const isReviewing = currentHistoryEntry !== null;
  // True only for the single newest question — the one about to trigger a
  // stop-check and/or pull the next adaptive question once answered.
  // Reviewing anything earlier than this always just advances through the
  // sequence that's already there (see handleAnswer/handleReviewNext) —
  // "review navigation should feel predictable and chronological," not
  // jump to the end or re-trigger the adaptive engine mid-review.
  const isFrontier = questionIndex === sequence.length - 1;

  // Restoring the question on screen to how the respondent last left it
  // (standard vs. sharpened wording) is done explicitly at every call site
  // that navigates to a *different* question (handleBack, handleReviewNext,
  // and the advance branches in handleAnswer/handleSkip) via sharpenedForEntry
  // (questionHistory.ts), rather than derived in an effect keyed on the
  // question id — an effect would also need to not re-fire while manually
  // toggling "It Depends" on the *same* question, and setting state
  // synchronously in an effect body is the kind of thing that invites
  // cascading renders anyway.

  // QuestionCard's exit animation (AnimatePresence mode="wait", ~350ms)
  // keeps the outgoing card's buttons mounted and clickable while it fades
  // out. A click landing in that window fires onAnswer/onSkip again with
  // the *previous* question's stale closure — confirmed in testing (two
  // questions each got answered twice, back to back, with identical
  // selections). Guards both handlers; clears once the next question
  // actually renders. QuestionCard's exit transition also sets
  // pointerEvents: "none" the instant it starts leaving, closing the gap
  // at the animation level too, not just here.
  //
  // Confirmed by reproducing it directly: if anything inside handleAnswer
  // throws after processingRef is set but before the state updates that
  // would normally change currentQuestion/isSharpened, the effect below
  // never fires and the guard stays stuck forever — freezing the survey
  // with no error shown, recoverable only by reloading the page. The
  // timeout is a safety net: it only ever fires if something went wrong,
  // since the effect above always clears it first on a normal transition.
  const processingRef = useRef(false);
  const unstickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    processingRef.current = false;
    if (unstickTimerRef.current) {
      clearTimeout(unstickTimerRef.current);
      unstickTimerRef.current = null;
    }
  }, [currentQuestion, isSharpened]);
  useEffect(() => {
    return () => {
      if (unstickTimerRef.current) clearTimeout(unstickTimerRef.current);
    };
  }, []);

  const beginProcessing = useCallback(() => {
    if (processingRef.current) return false;
    processingRef.current = true;
    unstickTimerRef.current = setTimeout(() => {
      console.error("[SurveyClient] processingRef stuck for 2s — auto-unstuck. This means handleAnswer/handleSkip hit an error; check above for the real cause.");
      processingRef.current = false;
      unstickTimerRef.current = null;
    }, 2000);
    return true;
  }, []);

  // Per-question write queue — same-session ordering on top of the
  // database's own guarantee (migration 0021's upsert_nss_response does a
  // delete-then-insert inside one transaction, with explicit stale-write
  // rejection by the respondent's own click time), not the primary
  // correctness mechanism itself anymore.
  const pendingWritesRef = useRef<Map<number, Promise<void>>>(new Map());
  const queueWrite = useCallback((questionId: number, write: () => Promise<void>) => {
    const prior = pendingWritesRef.current.get(questionId) ?? Promise.resolve();
    const chained = prior.then(write).catch(() => {});
    pendingWritesRef.current.set(questionId, chained);
    return chained;
  }, []);

  // Writes one response, retrying once on a genuine failure (StaleWriteError
  // is not a failure — it means a newer answer already won, nothing to do)
  // before surfacing it: logged to the console always, and shown as a
  // small, non-blocking notice to the respondent only if the retry also
  // fails, rather than failing silently.
  const writeResponseWithRetry = useCallback(
    async (params: Parameters<typeof upsertResponse>[1]) => {
      try {
        await upsertResponse(supabase, params);
      } catch (err) {
        if (err instanceof StaleWriteError) {
          console.info(`[SurveyClient] write for question ${params.questionId} superseded by a newer answer; ignoring.`);
          return;
        }
        console.error(`[SurveyClient] failed to save answer for question ${params.questionId}, retrying once:`, err);
        try {
          await upsertResponse(supabase, params);
        } catch (retryErr) {
          if (retryErr instanceof StaleWriteError) return;
          console.error(`[SurveyClient] retry also failed for question ${params.questionId}:`, retryErr);
          setWriteFailureNotice(true);
        }
      }
    },
    [supabase],
  );

  // Deletes a stale decisive row when a reviewed answer is turned into a
  // skip instead (see handleSkip) — same retry-once-then-surface shape as
  // writeResponseWithRetry, without the stale-write concern a plain
  // delete-by-key doesn't have.
  const deleteResponseWithRetry = useCallback(
    async (params: { submissionId: string; questionId: number }) => {
      try {
        await deleteResponse(supabase, params);
      } catch (err) {
        console.error(`[SurveyClient] failed to delete the stale answer for question ${params.questionId}, retrying once:`, err);
        try {
          await deleteResponse(supabase, params);
        } catch (retryErr) {
          console.error(`[SurveyClient] retry also failed for question ${params.questionId}:`, retryErr);
          setWriteFailureNotice(true);
        }
      }
    },
    [supabase],
  );

  // ── Bootstrap: load questions + auth + resume state ──────────────────────
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const [{ data: userData }, qs] = await Promise.all([
        supabase.auth.getUser(),
        fetchQuestions(supabase),
      ]);
      if (cancelled) return;

      const uid = userData.user?.id ?? null;
      setUserId(uid);
      setUserEmail(userData.user?.email ?? null);
      setQuestions(qs);

      if (uid) {
        // Denormalized onto the submission at creation time below, same
        // reasoning as user_email/respondent_name — every downstream check
        // (CRM suppression, branding) reads the submission's own copy
        // rather than joining back to user_profiles each time.
        const profile = await getMyProfile(supabase, uid).catch(() => null);
        if (!cancelled) setUserTeam(profile?.team ?? null);
      }

      // The server's own record of this user's in-progress submission (if
      // any) is the source of truth for *whose* progress this is —
      // localStorage is keyed globally per-browser, not per-account, so a
      // previous person's abandoned attempt on this same browser would
      // otherwise get silently inherited by whoever logs in next.
      const inProgress = uid ? await findInProgressSubmission(supabase, uid) : null;
      if (cancelled) return;

      // Same-browser resume: fast path, works offline of any server round
      // trip — but only trust it once it's confirmed to be *this* user's
      // own submission. Skip entries (status: "skipped") only ever live
      // here — they're never written server-side (see handleSkip) — so a
      // skipped question's restored wording/badge only survives a reload
      // on the *same* browser with intact localStorage, not a resume from
      // a different device. That's a real, acknowledged limitation (see
      // the implementation report), not an oversight.
      const saved = loadSavedState();
      if (saved?.sequenceIds?.length && saved.submissionId && saved.submissionId === inProgress?.id) {
        setSequence(sequenceFromIds(qs, saved.sequenceIds));
        setUsedIds(new Set(saved.sequenceIds));
        setSubmissionId(saved.submissionId);
        setUserName(saved.userName);
        setUserPronouns(saved.userPronouns);
        setTally(saved.tally);
        setQuestionIndex(saved.questionIndex);
        setQuestionsAnswered(saved.questionsAnswered);
        setQuestionHistory(saved.questionHistory ?? []);
        setIsSharpened(saved.isSharpened);
        if (USE_BT_ENGINE) {
          setBtResponses(saved.btResponses ?? []);
          if (saved.deliveryState) setDeliveryState(deserializeDeliveryState(saved.deliveryState));
        }
        setPhase("survey");
        return;
      }
      if (saved) localStorage.removeItem(STORAGE_KEY);

      // Cross-device/session resume: no (trustworthy) local copy — new
      // browser, cleared storage, someone else's leftover state — but the
      // server still has an in-progress submission for this account;
      // rebuild playable state from it rather than restarting from question
      // one. questionHistory IS read again (handleAnswer's correction/
      // confirmation detection, keyed on question_id) — rebuilt from the
      // submission's own stored responses (already deduplicated to one row
      // per question — see responseDedup.ts) joined against the question
      // bank. Skips aren't persisted server-side at all, so a question
      // skipped before this resume point can't be distinguished from
      // "not yet reached" here — it'll show as fresh, not as a restored
      // skip; a real but accepted limitation of not adding server-side
      // skip storage for this change. questionIndex === questionsAnswered
      // always holds at rest: both start at 0 and increment together.
      if (inProgress?.question_sequence?.length) {
        setSequence(sequenceFromIds(qs, inProgress.question_sequence));
        setUsedIds(new Set(inProgress.question_sequence));
        setSubmissionId(inProgress.id);
        setUserName(inProgress.respondent_name);
        setUserPronouns(inProgress.pronouns ?? "");
        setTally(inProgress.win_loss_tally);
        setQuestionIndex(inProgress.questions_answered);
        setQuestionsAnswered(inProgress.questions_answered);
        const rows = await listResponsesForSubmission(supabase, inProgress.id);
        const reconstructed: QuestionHistoryEntry[] = rows
          .map((r): AnsweredEntry | null => {
            const q = qs.find((qq) => qq.id === r.question_id);
            if (!q) return null;
            const version = r.is_sharpened ? q.sharpened : q.standard;
            return {
              question_id: r.question_id,
              status: "answered",
              question_text: version.question,
              user_selection: r.selection,
              chosen_clusters: r.chosen_clusters,
              rejected_clusters: r.rejected_clusters,
              mapped_clusters: q.mappedClusters,
              is_sharpened_question: r.is_sharpened,
              ...(r.original_question_id ? { original_question_id: r.original_question_id } : {}),
              answered_at: r.answered_at,
            };
          })
          .filter((d): d is AnsweredEntry => d !== null);
        setQuestionHistory(reconstructed);
        setIsSharpened(false);
        if (USE_BT_ENGINE) {
          // is_sharpened/ordering for the *adaptive* questions aren't
          // replayed into deliveryState here (validation/staleness
          // bookkeeping starts fresh), acceptable for this cross-device
          // resume path — it's not the fresh test run that bookkeeping
          // exists to support.
          setBtResponses(rows);
          setDeliveryState(initDeliveryState(inProgress.questions_answered));
        }
        setPhase("survey");
        return;
      }

      setPhase("greeting");
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Auto-save to localStorage ─────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "survey") return;
    persistLocalState({
      submissionId,
      userName,
      userPronouns,
      sequenceIds: sequence.map((q) => q.id),
      questionIndex,
      tally,
      questionsAnswered,
      questionHistory,
      isSharpened,
      btResponses,
      deliveryState: serializeDeliveryState(deliveryState),
    });
  }, [
    phase,
    submissionId,
    userName,
    userPronouns,
    sequence,
    questionIndex,
    tally,
    questionsAnswered,
    questionHistory,
    isSharpened,
    btResponses,
    deliveryState,
  ]);

  // ── Debounced Supabase sync ────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "survey" || !submissionId) return;
    const timer = setTimeout(() => {
      updateSubmissionProgress(supabase, submissionId, {
        tally,
        questionSequence: sequence.map((q) => q.id),
        questionsAnswered,
      }).catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tally, questionsAnswered, submissionId, phase]);

  // ── Greeting complete ─────────────────────────────────────────────────────
  const handleGreetingComplete = async (name: string, pronouns: string) => {
    // Belonging-vs-Stability and Belonging-vs-Connections stay last-resort
    // only in the adaptive phase, but calibration now covers all 21 cluster
    // pairs (including these two) so every pair gets at least one direct
    // comparison to seed the Bradley-Terry fit with.
    const { calibration } = buildCalibrationSequence(questions);
    setSequence(calibration);
    setUsedIds(new Set(calibration.map((q) => q.id)));
    setUserName(name);
    setUserPronouns(pronouns);
    setPhase("survey");

    const freshTally = initTally();
    setTally(freshTally);
    if (USE_BT_ENGINE) {
      setBtResponses([]);
      setDeliveryState(initDeliveryState());
    }

    if (userId) {
      try {
        const result = await createSubmission(supabase, {
          userId,
          userEmail,
          respondentName: name,
          pronouns,
          initialTally: freshTally,
          questionSequence: calibration.map((q) => q.id),
          team: userTeam,
        });
        setSubmissionId(result.id);
      } catch {
        // best-effort — survey still works locally if the initial insert fails
      }
    }
  };

  // ── Finish survey ─────────────────────────────────────────────────────────
  const finishSurvey = useCallback(
    async (finalTally: Tally, answered: number, seq: SurveyQuestion[], finalBtResponses: BtResponse[]) => {
      setPhase("completing");
      const topNeeds = getTopNeeds(finalTally);
      const scores = tallyToScores(finalTally);

      // The chart/top_needs columns previously always showed plain win rate.
      // Once the narrative is BT-ranked, that's actively misleading whenever
      // the two disagree (exactly the case BT exists to fix) — a cluster can
      // look worse by raw win rate than one it's actually stronger than once
      // strength of schedule is accounted for. wins/losses/total stay as
      // real observed counts; only the displayed favorability figure (and
      // the sort order built from it) switches to the BT-consistent one.
      if (USE_BT_ENGINE) {
        const ranked = rankByBradleyTerry(finalBtResponses);
        const favorabilityByCluster = Object.fromEntries(
          ranked.map((r) => [r.cluster, btFavorability(r.strength)]),
        ) as Record<ClusterKey, number>;
        CLUSTERS.forEach((c) => {
          scores[c].winRate = favorabilityByCluster[c];
        });
        topNeeds.forEach((n) => {
          n.winRate = favorabilityByCluster[n.cluster];
        });
        topNeeds.sort((a, b) => b.winRate - a.winRate);
      }

      if (submissionId) {
        try {
          await finishSubmission(supabase, submissionId, {
            tally: finalTally,
            questionSequence: seq.map((q) => q.id),
            questionsAnswered: answered,
            topNeeds,
            scores,
          });
        } catch {
          // best-effort
        }
      }

      localStorage.removeItem(STORAGE_KEY);
      router.push(submissionId ? `/survey/report/${submissionId}` : "/");
    },
    [submissionId, supabase, router],
  );

  // ── Answer handler ─────────────────────────────────────────────────────────
  const handleAnswer = useCallback(
    (choice: "A" | "B") => {
      if (!currentQuestion || !beginProcessing()) return;
      try {
      const [clusterA, clusterB] = currentQuestion.mappedClusters;
      const chosenClusters = choice === "A" ? [clusterA] : [clusterB];
      const rejectedClusters = choice === "A" ? [clusterB] : [clusterA];
      const answeredAt = new Date().toISOString();

      const { history: newHistory, entry, isConfirmation, decisiveCountDelta } = applyAnswerToHistory({
        history: questionHistory,
        questionId: currentQuestion.id,
        questionText: (isSharpened ? currentQuestion.sharpened : currentQuestion.standard).question,
        choice,
        chosenClusters,
        rejectedClusters,
        mappedClusters: currentQuestion.mappedClusters,
        isSharpened,
        originalQuestionId: lastQuestionId,
        answeredAt,
      });
      if (!isConfirmation) setQuestionHistory(newHistory);

      // Rebuilt from newHistory (the corrected source of truth) rather than
      // patched incrementally — a correction replaces one entry in the
      // middle of the history, which an append-only update can't express
      // without drifting out of sync with what was actually answered.
      // Skipped entries contribute nothing to scoring.
      const answeredOnly = latestDecisiveEntries(newHistory);
      const newTally = answeredOnly.reduce(
        (t, d) => recordAnswer(t, d.chosen_clusters as ClusterKey[], d.rejected_clusters as ClusterKey[]),
        initTally(),
      );
      setTally(newTally);

      const newBtResponses: BtResponse[] = USE_BT_ENGINE
        ? answeredOnly.map((d) => ({
            chosen_clusters: d.chosen_clusters as ClusterKey[],
            rejected_clusters: d.rejected_clusters as ClusterKey[],
          }))
        : btResponses;
      if (USE_BT_ENGINE) setBtResponses(newBtResponses);

      // Validation is triggered by the explicit "It Depends" signal alone
      // — not by every correction. A correction given directly (picking
      // the other standard-wording option, no "It Depends") isn't
      // necessarily evidence of contextual uncertainty; it's just as
      // likely a plain fix of an earlier misclick, and treating every such
      // fix as equivalent to "it depends" would spend adaptive questions
      // re-probing pairs the respondent was never actually unsure about.
      // Reconsidering *through* It Depends — whether on a fresh question
      // or while reviewing one answered earlier — still triggers it, same
      // as it always has: that's the respondent's own explicit signal,
      // not an inference from the mere fact that something changed.
      const outcomeState =
        USE_BT_ENGINE && !isConfirmation
          ? applyAnswerOutcome(deliveryState, currentQuestion.mappedClusters, isSharpened)
          : deliveryState;
      if (USE_BT_ENGINE && !isConfirmation) setDeliveryState(outcomeState);

      // A decisive count only changes when a question that *didn't*
      // already have a decisive answer gets one — a fresh question, or a
      // previously-skipped one now being answered. A correction to an
      // already-decisive answer, or a confirmation, leaves the count
      // untouched either way.
      const newAnswered = questionsAnswered + decisiveCountDelta;
      setQuestionsAnswered(newAnswered);

      if (!isSharpened) setLastQuestionId(currentQuestion.id);

      if (submissionId && !isConfirmation) {
        const questionId = currentQuestion.id;
        const originalQuestionId = entry.original_question_id ?? null;
        const isSharpenedFlag = entry.is_sharpened_question;
        queueWrite(questionId, () =>
          writeResponseWithRetry({
            submissionId,
            questionId,
            originalQuestionId,
            isSharpened: isSharpenedFlag,
            selection: choice,
            chosenClusters,
            rejectedClusters,
            answeredAt,
          }),
        );
      }

      // Reviewing an earlier question (not the frontier) always just steps
      // forward through the sequence that's already there — no stop-check,
      // no pulling a new adaptive question. Those only make sense once the
      // respondent is back at the newest question again, extending the
      // survey for real. This is also what makes review feel chronological
      // rather than jumping around: Back to question 22 from 26, correct
      // it, and the very next thing shown is 23 — not back to 26.
      if (!isFrontier) {
        const nextIdx = questionIndex + 1;
        if (nextIdx < sequence.length) {
          setIsSharpened(sharpenedForEntry(newHistory, sequence[nextIdx].id));
          setQuestionIndex(nextIdx);
        }
        return;
      }

      const stopNow = USE_BT_ENGINE
        ? btShouldStop(newBtResponses, newAnswered, HARD_STOP)
        : newAnswered >= HARD_STOP;
      if (stopNow) {
        finishSurvey(newTally, newAnswered, sequence, newBtResponses);
        return;
      }

      const nextIdx = questionIndex + 1;
      if (nextIdx < sequence.length) {
        setIsSharpened(sharpenedForEntry(newHistory, sequence[nextIdx].id));
        setQuestionIndex(nextIdx);
        return;
      }

      if (USE_BT_ENGINE) {
        const next = pullNextQuestionBt(
          questions,
          newBtResponses,
          usedIds,
          outcomeState,
          newAnswered,
          sequence.length === 21,
          answeredOnly,
        );
        if (!next) {
          finishSurvey(newTally, newAnswered, sequence, newBtResponses);
          return;
        }
        const newSeq = [...sequence, next.question];
        const newUsed = new Set(usedIds);
        newUsed.add(next.question.id);
        setSequence(newSeq);
        setUsedIds(newUsed);
        setDeliveryState(next.nextState);
        setIsSharpened(false);
        setQuestionIndex(nextIdx);
        return;
      }

      const block = selectAdaptiveBlock(questions, newTally, usedIds);
      if (block.length === 0) {
        finishSurvey(newTally, newAnswered, sequence, newBtResponses);
        return;
      }
      const newSeq = [...sequence, ...block];
      const newUsed = new Set(usedIds);
      block.forEach((q) => newUsed.add(q.id));
      setSequence(newSeq);
      setUsedIds(newUsed);
      setIsSharpened(false);
      setQuestionIndex(nextIdx);
      } catch (error) {
        // The unstick timeout recovers either way, but log the real cause
        // rather than let this surface only as a mysterious 2s freeze.
        console.error("[SurveyClient] handleAnswer failed:", error);
      }
    },
    [
      currentQuestion,
      isFrontier,
      questionsAnswered,
      isSharpened,
      lastQuestionId,
      questionHistory,
      submissionId,
      questionIndex,
      sequence,
      usedIds,
      questions,
      finishSurvey,
      btResponses,
      deliveryState,
      beginProcessing,
      queueWrite,
      writeResponseWithRetry,
    ],
  );

  // ── Skip / Review-Next / Back / Save & Exit ───────────────────────────────
  const handleItDepends = useCallback(() => setIsSharpened(true), []);

  const handleSkip = useCallback(() => {
    if (!currentQuestion || !beginProcessing()) return;
    try {
      const { history: newHistory, decisiveCountDelta } = applySkipToHistory({
        history: questionHistory,
        questionId: currentQuestion.id,
        mappedClusters: currentQuestion.mappedClusters,
        isSharpened,
      });
      setQuestionHistory(newHistory);

      // -1 means this skip is replacing an already-decisive answer
      // (reviewing a committed sharpened answer, or reconsidering a
      // standard one via "It Depends," and choosing to skip instead) —
      // that row is now stale and needs deleting, not just left behind;
      // skip itself is never written, so there's nothing to delete on a
      // fresh skip or re-skipping an already-skipped question.
      const newAnswered = questionsAnswered + decisiveCountDelta;
      setQuestionsAnswered(newAnswered);
      if (decisiveCountDelta === -1 && submissionId) {
        const questionId = currentQuestion.id;
        queueWrite(questionId, () => deleteResponseWithRetry({ submissionId, questionId }));
      }

      const nextIdx = questionIndex + 1;
      if (nextIdx < sequence.length) {
        setIsSharpened(sharpenedForEntry(newHistory, sequence[nextIdx].id));
        setQuestionIndex(nextIdx);
        return;
      }

      if (USE_BT_ENGINE) {
        const next = pullNextQuestionBt(
          questions,
          btResponses,
          usedIds,
          deliveryState,
          newAnswered,
          sequence.length === 21,
          latestDecisiveEntries(newHistory),
        );
        if (!next) {
          finishSurvey(tally, newAnswered, sequence, btResponses);
          return;
        }
        const newSeq = [...sequence, next.question];
        const newUsed = new Set(usedIds);
        newUsed.add(next.question.id);
        setSequence(newSeq);
        setUsedIds(newUsed);
        setDeliveryState(next.nextState);
        setIsSharpened(false);
        setQuestionIndex(nextIdx);
        return;
      }

      const block = selectAdaptiveBlock(questions, tally, usedIds);
      if (block.length === 0) {
        finishSurvey(tally, newAnswered, sequence, btResponses);
        return;
      }
      const newSeq = [...sequence, ...block];
      const newUsed = new Set(usedIds);
      block.forEach((q) => newUsed.add(q.id));
      setSequence(newSeq);
      setUsedIds(newUsed);
      setIsSharpened(false);
      setQuestionIndex(nextIdx);
    } catch (error) {
      console.error("[SurveyClient] handleSkip failed:", error);
    }
  }, [
    currentQuestion,
    isSharpened,
    questionIndex,
    sequence,
    questions,
    tally,
    usedIds,
    questionsAnswered,
    submissionId,
    finishSurvey,
    btResponses,
    deliveryState,
    questionHistory,
    beginProcessing,
    queueWrite,
    deleteResponseWithRetry,
  ]);

  // Advances past a reviewed (already-answered or already-skipped)
  // question without touching it — no write, no count change, no
  // validation trigger, since nothing about it changed.
  const handleReviewNext = useCallback(() => {
    if (!beginProcessing()) return;
    try {
      const nextIdx = questionIndex + 1;
      if (nextIdx < sequence.length) {
        setIsSharpened(sharpenedForEntry(questionHistory, sequence[nextIdx].id));
        setQuestionIndex(nextIdx);
      }
    } catch (error) {
      console.error("[SurveyClient] handleReviewNext failed:", error);
    }
  }, [questionIndex, sequence, questionHistory, beginProcessing]);

  // Sharpened wording always steps back to standard wording of the SAME
  // question first, regardless of whether that sharpened state has
  // already been committed (answered or skipped) — only a second Back,
  // now on standard wording, moves to the previous question. Previously
  // this only applied to a not-yet-committed reask; an already-answered
  // sharpened question skipped straight past standard wording to the
  // previous question instead, which is exactly the gap this closes.
  // Nothing here touches which entry is recorded for this question —
  // toggling the displayed wording is never itself a write (see
  // applyAnswerToHistory) — so a committed sharpened answer is untouched
  // by passing through its own standard wording on the way back out.
  const handleBack = useCallback(() => {
    if (isSharpened) {
      setIsSharpened(false);
    } else if (questionIndex > 0) {
      const prevIdx = questionIndex - 1;
      setIsSharpened(sharpenedForEntry(questionHistory, sequence[prevIdx].id));
      setQuestionIndex(prevIdx);
    } else {
      setPhase("greeting");
      setGreetingStep(2);
    }
  }, [isSharpened, questionIndex, questionHistory, sequence]);

  const handleGreetingBack = () => {
    if (greetingStep === 0) router.push("/");
    else setGreetingStep((s) => s - 1);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (phase === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-secondary border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (phase === "greeting") {
    return (
      <NovaGreeting
        onComplete={handleGreetingComplete}
        step={greetingStep}
        setStep={setGreetingStep}
        onBack={handleGreetingBack}
      />
    );
  }

  if (phase === "completing") {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
          <h2 className="font-heading text-2xl font-semibold text-foreground mb-2">Analyzing your responses...</h2>
          <p className="text-muted-foreground">Nova is reviewing your signal patterns.</p>
          <div className="mt-6">
            <div className="w-8 h-8 border-4 border-secondary border-t-primary rounded-full animate-spin mx-auto" />
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 flex flex-col">
      {writeFailureNotice && (
        <div
          role="status"
          className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>Your last answer may not have saved. Check your connection and try again if this continues.</span>
          <button
            onClick={() => setWriteFailureNotice(false)}
            className="shrink-0 text-destructive/70 hover:text-destructive"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className="mb-3">
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      </div>

      {currentQuestion && (
        <QuestionCard
          question={currentQuestion}
          isSharpened={isSharpened}
          onAnswer={handleAnswer}
          onItDepends={handleItDepends}
          onSkip={handleSkip}
          reviewing={isReviewing}
          selectedOption={
            currentHistoryEntry?.status === "answered" && currentHistoryEntry.is_sharpened_question === isSharpened
              ? currentHistoryEntry.user_selection
              : null
          }
          skipped={currentHistoryEntry?.status === "skipped" && currentHistoryEntry.is_sharpened_question === isSharpened}
          onNext={handleReviewNext}
        />
      )}

      <div className="mt-6">
        <ProgressIndicator
          tally={tally}
          totalQuestions={HARD_STOP}
          questionsAnswered={questionsAnswered}
          currentQuestionNumber={questionIndex + 1}
        />
      </div>
    </div>
  );
}
