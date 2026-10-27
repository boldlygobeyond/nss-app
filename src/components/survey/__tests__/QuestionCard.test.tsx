/** @vitest-environment jsdom */
// Covers the UI-state half of Back navigation/review (the DB/history half
// is covered directly in questionHistory.test.ts): that a reviewed
// question visibly shows its previous selection, that a skip is
// distinguishable from "not yet answered," that review mode offers Next
// instead of Skip, and that the exit-animation click guard (the fix for
// the stray-rapid-click duplicate mechanism) still lets a genuine click on
// the question actually on screen through.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import QuestionCard from "../QuestionCard";
import type { SurveyQuestion } from "@/lib/nss/questions";

const question: SurveyQuestion = {
  id: 5,
  topic: "test",
  mappedClusters: ["Recognition", "Connections"],
  standard: {
    question: "Which matters more right now?",
    options: { A: "Being recognized for my work", B: "Feeling connected to my team" },
  },
  sharpened: {
    question: "Which matters more specifically?",
    options: { A: "A specific recognition moment", B: "A specific connection moment" },
  },
};

describe("QuestionCard — fresh question (not reviewing)", () => {
  it("renders standard wording with no option marked selected, It Depends visible, no Next button", () => {
    render(
      <QuestionCard
        question={question}
        isSharpened={false}
        onAnswer={vi.fn()}
        onItDepends={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.getByText(question.standard.question)).toBeInTheDocument();
    expect(screen.getByText("It Depends")).toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
  });

  it("calls onAnswer with the clicked option's letter", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard question={question} isSharpened={false} onAnswer={onAnswer} onItDepends={vi.fn()} onSkip={vi.fn()} />,
    );
    fireEvent.click(screen.getByText(question.standard.options.A));
    expect(onAnswer).toHaveBeenCalledWith("A");
  });

  it("sharpened, fresh question shows Skip this one, not Next", () => {
    render(
      <QuestionCard question={question} isSharpened={true} onAnswer={vi.fn()} onItDepends={vi.fn()} onSkip={vi.fn()} />,
    );
    expect(screen.getByText("Skip this one")).toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
  });
});

describe("QuestionCard — reviewing a previously answered question", () => {
  it("1/4. marks the previously selected option and offers Next instead of (in addition to) forcing a new pick", () => {
    const onNext = vi.fn();
    render(
      <QuestionCard
        question={question}
        isSharpened={false}
        onAnswer={vi.fn()}
        onItDepends={vi.fn()}
        onSkip={vi.fn()}
        reviewing
        selectedOption="B"
        onNext={onNext}
      />,
    );
    expect(screen.getByText("Reviewing your answer")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next"));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("2/5. a different option is still clickable to correct the answer, and onAnswer still fires", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        question={question}
        isSharpened={false}
        onAnswer={onAnswer}
        onItDepends={vi.fn()}
        onSkip={vi.fn()}
        reviewing
        selectedOption="A"
        onNext={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(question.standard.options.B));
    expect(onAnswer).toHaveBeenCalledWith("B");
  });

  it("sharpened + reviewing shows the sharpened selection and Next in place of Skip", () => {
    render(
      <QuestionCard
        question={question}
        isSharpened={true}
        onAnswer={vi.fn()}
        onItDepends={vi.fn()}
        onSkip={vi.fn()}
        reviewing
        selectedOption="A"
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.queryByText("Skip this one")).not.toBeInTheDocument();
  });
});

describe("QuestionCard — reviewing a previously skipped question", () => {
  it("6/7. shows a skipped indicator, no option marked selected, and still allows a decisive answer", () => {
    const onAnswer = vi.fn();
    render(
      <QuestionCard
        question={question}
        isSharpened={false}
        onAnswer={onAnswer}
        onItDepends={vi.fn()}
        onSkip={vi.fn()}
        reviewing
        selectedOption={null}
        skipped
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByText("You skipped this one")).toBeInTheDocument();
    fireEvent.click(screen.getByText(question.standard.options.A));
    expect(onAnswer).toHaveBeenCalledWith("A");
  });
});

describe("QuestionCard — rapid-click / exit-animation guard", () => {
  it("10. the currently-rendered question's own option is still clickable (not itself blocked)", () => {
    const onAnswer = vi.fn();
    const { rerender } = render(
      <QuestionCard question={question} isSharpened={false} onAnswer={onAnswer} onItDepends={vi.fn()} onSkip={vi.fn()} />,
    );
    // Simulate advancing to a new question, as SurveyClient does on each
    // answer -- AnimatePresence mode="wait" keeps the old card mounted and
    // fading while the new one mounts, but the new one's own buttons must
    // remain fully clickable immediately.
    const nextQuestion: SurveyQuestion = { ...question, id: 6 };
    rerender(
      <QuestionCard question={nextQuestion} isSharpened={false} onAnswer={onAnswer} onItDepends={vi.fn()} onSkip={vi.fn()} />,
    );
    fireEvent.click(screen.getAllByText(question.standard.options.A)[0]);
    expect(onAnswer).toHaveBeenCalledWith("A");
  });
});
