"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Check } from "lucide-react";
import type { SurveyQuestion } from "@/lib/nss/questions";

function OptionButton({
  letter,
  text,
  selected,
  onClick,
}: {
  letter: "A" | "B";
  text: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-start h-auto py-4 px-5 text-sm md:text-base font-normal leading-relaxed border rounded-xl transition-all whitespace-normal ${
        selected
          ? letter === "A"
            ? "bg-primary/10 border-primary/40"
            : "bg-accent/10 border-accent/40"
          : `bg-transparent border-border/50 ${
              letter === "A" ? "hover:bg-primary/5 hover:border-primary/30" : "hover:bg-accent/5 hover:border-accent/30"
            }`
      }`}
    >
      <span
        className={`inline-flex items-center justify-center w-7 h-7 rounded-lg font-semibold text-xs mr-3 shrink-0 ${
          letter === "A" ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"
        }`}
      >
        {letter}
      </span>
      <span className="text-foreground flex-1">{text}</span>
      {selected && (
        <span className={`ml-3 shrink-0 ${letter === "A" ? "text-primary" : "text-accent"}`}>
          <Check className="w-4 h-4" />
        </span>
      )}
    </button>
  );
}

function NextButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-6 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
    >
      Next
    </button>
  );
}

export default function QuestionCard({
  question,
  isSharpened,
  onAnswer,
  onItDepends,
  onSkip,
  reviewing = false,
  selectedOption = null,
  skipped = false,
  onNext,
}: {
  question: SurveyQuestion;
  isSharpened: boolean;
  onAnswer: (choice: "A" | "B") => void;
  onItDepends: () => void;
  onSkip: () => void;
  reviewing?: boolean;
  selectedOption?: "A" | "B" | null;
  skipped?: boolean;
  onNext?: () => void;
}) {
  // A small, subtle status line rather than anything that competes with
  // the options themselves — "visually clear but not overwhelming."
  const statusLabel = reviewing ? (skipped ? "You skipped this one" : "Reviewing your answer") : null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${question.id}-${isSharpened ? "sharp" : "std"}`}
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        // pointerEvents: "none" here, not just on the outgoing card's own
        // buttons, so a click can't land on *anything* in it while it
        // fades out — framer-motion's AnimatePresence keeps this mounted
        // and otherwise fully interactive for the whole exit transition,
        // and SurveyClient's own double-submit guard resets as soon as
        // the *next* question becomes current, before this one has
        // finished leaving. A stray click in that window used to re-fire
        // onAnswer with this card's stale question/closure, writing a
        // second response for a question already answered a moment
        // earlier (see NSS_Back_Navigation_And_Duplicate_Fix.md).
        exit={{ opacity: 0, y: -30, scale: 0.97, pointerEvents: "none" }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-2xl mx-auto"
      >
        {isSharpened ? (
          <>
            <div className="bg-muted/30 rounded-2xl border border-border/30 px-6 py-4 opacity-50">
              <p className="text-muted-foreground text-sm md:text-base leading-relaxed">
                {question.standard.question}
              </p>
            </div>

            <div className="flex flex-col items-center my-1">
              <div className="w-px h-4 bg-accent/40" />
              <ChevronDown className="w-4 h-4 text-accent/60" />
            </div>

            <div className="bg-card rounded-2xl border-2 border-accent/25 shadow-sm p-6 md:p-8 relative">
              <div className="absolute -top-3 left-5 z-10 flex gap-2">
                <span className="bg-card text-accent text-xs font-medium px-3 py-1 rounded-full border border-accent/20">
                  Let me be more specific
                </span>
                {statusLabel && (
                  <span className="bg-card text-muted-foreground text-xs font-medium px-3 py-1 rounded-full border border-border/40">
                    {statusLabel}
                  </span>
                )}
              </div>
              <h2 className="font-heading text-xl md:text-2xl font-medium text-foreground mb-8 leading-relaxed mt-3">
                {question.sharpened.question}
              </h2>
              <div className="space-y-3">
                <OptionButton
                  letter="A"
                  text={question.sharpened.options.A}
                  selected={selectedOption === "A"}
                  onClick={() => onAnswer("A")}
                />
                <OptionButton
                  letter="B"
                  text={question.sharpened.options.B}
                  selected={selectedOption === "B"}
                  onClick={() => onAnswer("B")}
                />
              </div>
              <div className="mt-5 flex items-center justify-center gap-4">
                <button
                  onClick={onSkip}
                  className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                >
                  Skip this one
                </button>
                {reviewing && onNext && <NextButton onClick={onNext} />}
              </div>
            </div>
          </>
        ) : (
          <div className="bg-card rounded-2xl border border-border/50 shadow-sm p-6 md:p-8 relative">
            {statusLabel && (
              <div className="absolute -top-3 left-5 z-10">
                <span className="bg-card text-muted-foreground text-xs font-medium px-3 py-1 rounded-full border border-border/40">
                  {statusLabel}
                </span>
              </div>
            )}
            <h2 className="font-heading text-xl md:text-2xl font-medium text-foreground mb-8 leading-relaxed mt-3">
              {question.standard.question}
            </h2>
            <div className="space-y-3">
              <OptionButton
                letter="A"
                text={question.standard.options.A}
                selected={selectedOption === "A"}
                onClick={() => onAnswer("A")}
              />
              <OptionButton
                letter="B"
                text={question.standard.options.B}
                selected={selectedOption === "B"}
                onClick={() => onAnswer("B")}
              />
            </div>
            <div className="mt-5 flex items-center justify-center gap-4">
              <button
                onClick={onItDepends}
                className="text-muted-foreground hover:text-foreground text-sm transition-colors"
              >
                It Depends
              </button>
              {reviewing && onNext && <NextButton onClick={onNext} />}
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
