"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BENTO_CARDS, MISSION_CONTROL_CARDS } from "@/lib/nss/missionControlContent";
import DotMatrixDancer from "@/components/survey/DotMatrixDancer";

// Whimsical, deliberately silly — this is wait-time copy standing in for the
// "Mission Control System" pitch on the team/pilot variant, not product
// copy, so it's allowed to wink at the reader while the dancer does its
// thing up top.
const WAITING_PHRASES = [
  "Currently orbiting your insights.",
  "The astronaut insisted on a dance break. HR approved.",
  "Calibrating the cosmic vibes.",
  "Turns out humans are complicated. Who knew?",
  "Sorting signals from space junk.",
  "Your needs called. They'd like a little attention.",
  "Yes, he's still dancing.",
  "We don't have the heart to tell him nobody's watching.",
];
const PHRASE_MS = 3500;

function RotatingWaitingPhrase({ done }: { done: boolean }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % WAITING_PHRASES.length);
    }, PHRASE_MS);
    return () => clearInterval(timer);
  }, [done]);
  return (
    <div className="bg-card border border-border/50 rounded-2xl p-6 md:p-8 mb-10 w-3/4 max-w-2xl mx-auto text-center overflow-hidden">
      <div className="mb-2">
        <DotMatrixDancer done={done} />
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={done ? "done" : index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
          className="text-foreground text-lg leading-relaxed"
        >
          {done ? "...aaaand SCENE!" : WAITING_PHRASES[index]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

// "There's more beyond this one survey" pitch for the post-survey
// interstitial page — its own branded marketing-card look, matching the
// landing page rather than the report's own visual language (see
// ReportClosingPage for the PDF's report-styled version of this same copy).
//
// `simple` drops the lead-conversion framing for a team/pilot member: no
// headline, no "unlock" bullet list, no Mission Control card grid, no
// "schedule a call" pitch paragraph — just the rotating waiting-phrase box
// and whatever `cta` the caller passes (typically just "View My Report",
// no second button). `headline` is unused in this mode.
export default function MissionControlPitch({
  headline,
  cta,
  simple = false,
  done = false,
}: {
  headline: string;
  cta: ReactNode;
  simple?: boolean;
  done?: boolean;
}) {
  return (
    <>
      {!simple && (
        <h1 className="font-heading text-3xl md:text-4xl font-bold text-foreground mb-4 text-center leading-tight">
          {headline}
        </h1>
      )}

      {!simple && (
        <>
          <p className="text-muted-foreground text-lg mb-6 text-center leading-relaxed max-w-2xl mx-auto">
            By mapping your entire team&apos;s needs you get a deep understanding of how everyone&apos;s needs are
            interconnected so you can take shortcuts that unlock your team&apos;s true potential.
          </p>

          <div className="bg-card border border-border/50 rounded-2xl p-6 md:p-8 mb-20 max-w-2xl mx-auto">
            <p className="font-heading font-semibold text-foreground mb-4">Get ready to unlock:</p>
            <ul className="list-disc pl-5 space-y-3 text-foreground text-sm leading-relaxed">
              {BENTO_CARDS.map((card) => (
                <li key={card.title}>
                  <strong className="font-semibold">{card.title}:</strong>{" "}
                  <span className="text-muted-foreground">{card.body}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {simple ? (
        <RotatingWaitingPhrase done={done} />
      ) : (
        <div className="mb-20">
          <h2 className="font-heading text-2xl md:text-3xl font-bold text-foreground mb-8 text-center leading-snug">
            But the Needs Signal Survey is just one small piece of our Mission Control System.
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {MISSION_CONTROL_CARDS.map((card) => (
              <div key={card.title} className="bg-card border border-border/50 rounded-2xl p-6">
                <h3 className="font-heading text-lg font-semibold text-foreground mb-2">{card.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {simple ? (
        <div className="text-center">{cta}</div>
      ) : (
        <div className="bg-card border border-border/50 rounded-2xl p-8 md:p-10 text-center shadow-sm">
          <p className="text-foreground text-lg leading-relaxed mb-8 max-w-xl mx-auto">
            Ready to see what&apos;s possible for your crew? Look over your personal insights and schedule a call
            with our co-founders today to get the personalized flight plan for your team.
          </p>
          {cta}
        </div>
      )}
    </>
  );
}
