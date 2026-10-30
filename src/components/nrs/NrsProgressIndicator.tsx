"use client";

import { motion } from "framer-motion";

// Visually modeled on src/components/survey/ProgressIndicator.tsx, minus
// the per-cluster signal dots — an NRS submission only ever concerns one
// cluster at a time, so there's nothing comparable to show there.
export default function NrsProgressIndicator({ current, total }: { current: number; total: number }) {
  const progress = Math.min((current / total) * 100, 100);

  return (
    <div className="w-full max-w-2xl mx-auto mb-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground font-body">
          Scenario {current} of {total}
        </span>
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
    </div>
  );
}
