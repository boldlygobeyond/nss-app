"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
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
  isTieBreakOnlyPair,
  btShouldStop,
  type DeliveryState,
} from "@/lib/nss/adaptiveDelivery";
import { rankByBradleyTerry, btFavorability, type BtResponse } from "@/lib/nss/bradleyTerry";
import { CLUSTERS, type ClusterKey } from "@/lib/nss/clusters";
import {
  createSubmission,
  updateSubmissionProgress,
  finishSubmission,
  insertResponse,
  findInProgressSubmission,
  listResponsesForSubmission,
} from "@/lib/nss/api";
import NovaGreeting from "@/components/survey/NovaGreeting";
import QuestionCard from "@/components/survey/QuestionCard";
import ProgressIndicator from "@/components/survey/ProgressIndicator";

const STORAGE_KEY = "nss_survey_state";
const STATE_VERSION = 2;
const HARD_STOP = 50;
// Local-only test flag for the Oct 2026 rebalance (new 86-question bank +
// Bradley-Terry delivery/scoring). Never set in the deployed environment —
// see questions.ts's matching useNewBank flag.
const USE_BT_ENGINE = process.env.NEXT_PUBLIC_NSS_ENGINE === "bt";

function serializeDeliveryState(state: DeliveryState) {
  return { ...state, pendingValidation: [...state.pendingValidation] };
}
function deserializeDeliveryState(raw: ReturnType<typeof serializeDeliveryState>): DeliveryState {
  return { ...raw, pendingValidation: new Set(raw.pendingValidation) };
}

interface AnsweredDetail {
  question_id: number;
  question_text: string;
  user_selection: "A" | "B";
  chosen_clusters: string[];
  rejected_clusters: string[];
  mapped_clusters: string[];
  is_sharpened_question: boolean;
  original_question_id?: number;
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
  answeredDetails: AnsweredDetail[];
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
  const [answeredDetails, setAnsweredDetails] = useState<AnsweredDetail[]>([]);
  const [lastQuestionId, setLastQuestionId] = useState<number | null>(null);
  const [btResponses, setBtResponses] = useState<BtResponse[]>([]);
  const [deliveryState, setDeliveryState] = useState<DeliveryState>(initDeliveryState());

  const currentQuestion = sequence[questionIndex] || null;

  // QuestionCard's exit animation (AnimatePresence mode="wait", ~350ms)
  // keeps the outgoing card's buttons mounted and clickable while it fades
  // out. A click landing in that window fires onAnswer/onSkip again with
  // the *previous* question's stale closure — confirmed in testing (two
  // questions each got answered twice, back to back, with identical
  // selections). Guards both handlers; clears once the next question
  // actually renders.
  const processingRef = useRef(false);
  useEffect(() => {
    processingRef.current = false;
  }, [currentQuestion, isSharpened]);

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

      // The server's own record of this user's in-progress submission (if
      // any) is the source of truth for *whose* progress this is —
      // localStorage is keyed globally per-browser, not per-account, so a
      // previous person's abandoned attempt on this same browser would
      // otherwise get silently inherited by whoever logs in next.
      const inProgress = uid ? await findInProgressSubmission(supabase, uid) : null;
      if (cancelled) return;

      // Same-browser resume: fast path, works offline of any server round
      // trip — but only trust it once it's confirmed to be *this* user's
      // own submission.
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
        setAnsweredDetails(saved.answeredDetails);
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
      // one. answeredDetails/isSharpened aren't persisted server-side, but
      // neither is ever read again after this point (reports are built from
      // win_loss_tally/top_needs/scores, not from this array), so empty/
      // false is exact, not a lossy approximation. questionIndex ===
      // questionsAnswered always holds at rest: both start at 0 and
      // increment together on every answer.
      if (inProgress?.question_sequence?.length) {
        setSequence(sequenceFromIds(qs, inProgress.question_sequence));
        setUsedIds(new Set(inProgress.question_sequence));
        setSubmissionId(inProgress.id);
        setUserName(inProgress.respondent_name);
        setUserPronouns(inProgress.pronouns ?? "");
        setTally(inProgress.win_loss_tally);
        setQuestionIndex(inProgress.questions_answered);
        setQuestionsAnswered(inProgress.questions_answered);
        setAnsweredDetails([]);
        setIsSharpened(false);
        if (USE_BT_ENGINE) {
          // btResponses can be rebuilt exactly from the stored rows, but
          // is_sharpened/ordering aren't selected there today, so the
          // validation/staleness bookkeeping in deliveryState can't be —
          // acceptable here since this path is cross-device resume of an
          // old submission, not the fresh test run this flag is for.
          const rows = await listResponsesForSubmission(supabase, inProgress.id);
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
      answeredDetails,
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
    answeredDetails,
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
    // Belonging-vs-Stability and Belonging-vs-Connections are last-resort
    // only — excluded from calibration too, same as the adaptive phase.
    const calibrationPool = USE_BT_ENGINE
      ? questions.filter((q) => !isTieBreakOnlyPair(q.mappedClusters[0], q.mappedClusters[1]))
      : questions;
    const { calibration } = buildCalibrationSequence(calibrationPool);
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
      if (!currentQuestion || processingRef.current) return;
      processingRef.current = true;

      const [clusterA, clusterB] = currentQuestion.mappedClusters;
      const chosenClusters = choice === "A" ? [clusterA] : [clusterB];
      const rejectedClusters = choice === "A" ? [clusterB] : [clusterA];

      const newTally = recordAnswer(tally, chosenClusters, rejectedClusters);
      setTally(newTally);

      const newBtResponses = USE_BT_ENGINE
        ? [...btResponses, { chosen_clusters: chosenClusters, rejected_clusters: rejectedClusters }]
        : btResponses;
      if (USE_BT_ENGINE) setBtResponses(newBtResponses);

      const outcomeState = USE_BT_ENGINE
        ? applyAnswerOutcome(deliveryState, currentQuestion.mappedClusters, isSharpened)
        : deliveryState;
      if (USE_BT_ENGINE) setDeliveryState(outcomeState);

      const newAnswered = questionsAnswered + 1;
      setQuestionsAnswered(newAnswered);

      const version = isSharpened ? currentQuestion.sharpened : currentQuestion.standard;
      const detail: AnsweredDetail = {
        question_id: currentQuestion.id,
        question_text: version.question,
        user_selection: choice,
        chosen_clusters: chosenClusters,
        rejected_clusters: rejectedClusters,
        mapped_clusters: currentQuestion.mappedClusters,
        is_sharpened_question: isSharpened,
        ...(isSharpened && lastQuestionId ? { original_question_id: lastQuestionId } : {}),
      };
      const newDetails = [...answeredDetails, detail];
      setAnsweredDetails(newDetails);
      if (!isSharpened) setLastQuestionId(currentQuestion.id);
      setIsSharpened(false);

      if (submissionId) {
        insertResponse(supabase, {
          submissionId,
          questionId: currentQuestion.id,
          originalQuestionId: detail.original_question_id ?? null,
          isSharpened: detail.is_sharpened_question,
          selection: choice,
          chosenClusters,
          rejectedClusters,
        }).catch(() => {});
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
          newDetails,
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
      setQuestionIndex(nextIdx);
    },
    [
      currentQuestion,
      tally,
      questionsAnswered,
      isSharpened,
      lastQuestionId,
      answeredDetails,
      submissionId,
      supabase,
      questionIndex,
      sequence,
      usedIds,
      questions,
      finishSurvey,
      btResponses,
      deliveryState,
    ],
  );

  // ── Skip / Back / Save & Exit ──────────────────────────────────────────────
  const handleItDepends = useCallback(() => setIsSharpened(true), []);

  const handleSkip = useCallback(() => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsSharpened(false);
    const nextIdx = questionIndex + 1;
    if (nextIdx < sequence.length) {
      setQuestionIndex(nextIdx);
      return;
    }

    if (USE_BT_ENGINE) {
      const next = pullNextQuestionBt(
        questions,
        btResponses,
        usedIds,
        deliveryState,
        questionsAnswered,
        sequence.length === 21,
        answeredDetails,
      );
      if (!next) {
        finishSurvey(tally, questionsAnswered, sequence, btResponses);
        return;
      }
      const newSeq = [...sequence, next.question];
      const newUsed = new Set(usedIds);
      newUsed.add(next.question.id);
      setSequence(newSeq);
      setUsedIds(newUsed);
      setDeliveryState(next.nextState);
      setQuestionIndex(nextIdx);
      return;
    }

    const block = selectAdaptiveBlock(questions, tally, usedIds);
    if (block.length === 0) {
      finishSurvey(tally, questionsAnswered, sequence, btResponses);
      return;
    }
    const newSeq = [...sequence, ...block];
    const newUsed = new Set(usedIds);
    block.forEach((q) => newUsed.add(q.id));
    setSequence(newSeq);
    setUsedIds(newUsed);
    setQuestionIndex(nextIdx);
  }, [
    questionIndex,
    sequence,
    questions,
    tally,
    usedIds,
    questionsAnswered,
    finishSurvey,
    btResponses,
    deliveryState,
    answeredDetails,
  ]);

  const handleBack = useCallback(() => {
    if (isSharpened) {
      setIsSharpened(false);
    } else if (questionIndex > 0) {
      setQuestionIndex(questionIndex - 1);
    } else {
      setPhase("greeting");
      setGreetingStep(2);
    }
  }, [isSharpened, questionIndex]);

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
        />
      )}

      <div className="mt-6">
        <ProgressIndicator tally={tally} totalQuestions={HARD_STOP} questionsAnswered={questionsAnswered} />
      </div>
    </div>
  );
}
