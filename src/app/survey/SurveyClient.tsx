"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { fetchQuestions, type SurveyQuestion } from "@/lib/nss/questions";
import {
  buildCalibrationSequence,
  selectAdaptiveBlock,
  initTally,
  recordAnswer,
  hasTerminationSignal,
  tallyToScores,
  getTopNeeds,
  type Tally,
  type TopNeed,
} from "@/lib/nss/surveyEngine";
import { CLUSTER_LABELS } from "@/lib/nss/clusters";
import { createSubmission, updateSubmissionProgress, finishSubmission, insertResponse } from "@/lib/nss/api";
import NovaGreeting from "@/components/survey/NovaGreeting";
import QuestionCard from "@/components/survey/QuestionCard";
import ProgressIndicator from "@/components/survey/ProgressIndicator";

const STORAGE_KEY = "nss_survey_state";
const STATE_VERSION = 1;
const HARD_STOP = 50;
const CALIBRATION_SIZE = 21;

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

type Phase = "loading" | "greeting" | "survey" | "completing" | "done";

export default function SurveyClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isResume = searchParams.get("resume") === "true";

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
  const [finalTopNeeds, setFinalTopNeeds] = useState<TopNeed[]>([]);

  const currentQuestion = sequence[questionIndex] || null;

  // ── Bootstrap: load questions + auth + resume state ──────────────────────
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const [{ data: userData }, qs] = await Promise.all([
        supabase.auth.getUser(),
        fetchQuestions(supabase),
      ]);
      if (cancelled) return;

      setUserId(userData.user?.id ?? null);
      setUserEmail(userData.user?.email ?? null);
      setQuestions(qs);

      const saved = isResume ? loadSavedState() : null;
      if (saved?.sequenceIds?.length) {
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
        setPhase("survey");
      } else {
        setPhase("greeting");
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResume]);

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
    });
  }, [phase, submissionId, userName, userPronouns, sequence, questionIndex, tally, questionsAnswered, answeredDetails, isSharpened]);

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
    const { calibration } = buildCalibrationSequence(questions);
    setSequence(calibration);
    setUsedIds(new Set(calibration.map((q) => q.id)));
    setUserName(name);
    setUserPronouns(pronouns);
    setPhase("survey");

    const freshTally = initTally();
    setTally(freshTally);

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
    async (finalTally: Tally, answered: number, seq: SurveyQuestion[]) => {
      setPhase("completing");
      const topNeeds = getTopNeeds(finalTally);
      const scores = tallyToScores(finalTally);

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
      setFinalTopNeeds(topNeeds);
      setTimeout(() => setPhase("done"), 1400);
    },
    [submissionId, supabase],
  );

  // ── Answer handler ─────────────────────────────────────────────────────────
  const handleAnswer = useCallback(
    (choice: "A" | "B") => {
      if (!currentQuestion) return;

      const [clusterA, clusterB] = currentQuestion.mappedClusters;
      const chosenClusters = choice === "A" ? [clusterA] : [clusterB];
      const rejectedClusters = choice === "A" ? [clusterB] : [clusterA];

      const newTally = recordAnswer(tally, chosenClusters, rejectedClusters);
      setTally(newTally);

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

      if (newAnswered >= HARD_STOP) {
        finishSurvey(newTally, newAnswered, sequence);
        return;
      }

      if (newAnswered === CALIBRATION_SIZE && hasTerminationSignal(newTally, newAnswered)) {
        finishSurvey(newTally, newAnswered, sequence);
        return;
      }

      if (newAnswered > CALIBRATION_SIZE && (newAnswered - CALIBRATION_SIZE) % 7 === 0 && hasTerminationSignal(newTally, newAnswered)) {
        finishSurvey(newTally, newAnswered, sequence);
        return;
      }

      const nextIdx = questionIndex + 1;
      if (nextIdx < sequence.length) {
        setQuestionIndex(nextIdx);
        return;
      }

      const block = selectAdaptiveBlock(questions, newTally, usedIds);
      if (block.length === 0) {
        finishSurvey(newTally, newAnswered, sequence);
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
    ],
  );

  // ── Skip / Back / Save & Exit ──────────────────────────────────────────────
  const handleItDepends = useCallback(() => setIsSharpened(true), []);

  const handleSkip = useCallback(() => {
    setIsSharpened(false);
    const nextIdx = questionIndex + 1;
    if (nextIdx < sequence.length) {
      setQuestionIndex(nextIdx);
      return;
    }
    const block = selectAdaptiveBlock(questions, tally, usedIds);
    if (block.length === 0) {
      finishSurvey(tally, questionsAnswered, sequence);
      return;
    }
    const newSeq = [...sequence, ...block];
    const newUsed = new Set(usedIds);
    block.forEach((q) => newUsed.add(q.id));
    setSequence(newSeq);
    setUsedIds(newUsed);
    setQuestionIndex(nextIdx);
  }, [questionIndex, sequence, questions, tally, usedIds, questionsAnswered, finishSurvey]);

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

  const handleSaveAndExit = useCallback(async () => {
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
    });
    if (submissionId) {
      try {
        await updateSubmissionProgress(supabase, submissionId, {
          tally,
          questionSequence: sequence.map((q) => q.id),
          questionsAnswered,
        });
      } catch {
        // best-effort
      }
    }
    router.push("/");
  }, [submissionId, userName, userPronouns, sequence, questionIndex, tally, questionsAnswered, answeredDetails, isSharpened, supabase, router]);

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

  if (phase === "done") {
    const topThree = finalTopNeeds.slice(0, 3);
    return (
      <div className="flex-1 max-w-2xl w-full mx-auto px-4 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
          <h1 className="font-heading text-2xl md:text-3xl font-semibold text-foreground mb-3">
            Thank you, {userName}.
          </h1>
          <p className="text-muted-foreground mb-10">
            Here&apos;s a first look at your top needs signals. Questions answered: {questionsAnswered}.
          </p>
          <div className="space-y-3 text-left mb-10">
            {topThree.map((need) => (
              <div key={need.cluster} className="bg-card border border-border/50 rounded-xl p-4 flex items-center justify-between">
                <span className="font-medium text-foreground">{CLUSTER_LABELS[need.cluster]}</span>
                <span className="text-primary font-semibold">{Math.round(need.winRate * 100)}%</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col items-center gap-3">
            {submissionId && (
              <button
                onClick={() => router.push(`/reports/${submissionId}`)}
                className="h-12 px-8 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
              >
                View my full report
              </button>
            )}
            <button
              onClick={() => router.push("/")}
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Return home
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 flex flex-col">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <button
          onClick={handleSaveAndExit}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors border border-border/50 rounded-lg px-3 py-1.5"
        >
          Save &amp; Exit
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
