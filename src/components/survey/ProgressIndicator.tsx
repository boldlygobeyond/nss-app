"use client";

import { motion } from "framer-motion";
import { CLUSTERS, CLUSTER_LABELS, CLUSTER_COLORS } from "@/lib/nss/clusters";
import type { Tally } from "@/lib/nss/surveyEngine";

export default function ProgressIndicator({
  tally,
  totalQuestions,
  questionsAnswered,
}: {
  tally: Tally;
  totalQuestions: number;
  questionsAnswered: number;
}) {
  const total = totalQuestions || 50;
  const progress = Math.min((questionsAnswered / total) * 100, 100);

  return (
    <div className="w-full max-w-2xl mx-auto mb-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground font-body">Question {questionsAnswered + 1}</span>
        <span className="text-xs text-muted-foreground font-body">{Math.round(progress)}%</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      <div className="flex justify-center gap-2 mt-4">
        {CLUSTERS.map((c) => {
          const signals = tally[c].wins + tally[c].losses;
          const opacity = Math.min(0.3 + (signals / 6) * 0.7, 1);
          return (
            <div key={c} className="flex flex-col items-center gap-1" title={`${CLUSTER_LABELS[c]}: ${signals} signals`}>
              <div
                className="w-2.5 h-2.5 rounded-full transition-all duration-300"
                style={{
                  backgroundColor: CLUSTER_COLORS[c],
                  opacity,
                  transform: `scale(${0.8 + (signals / 6) * 0.4})`,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
