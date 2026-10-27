"use client";

import { useState } from "react";
import { CLUSTER_LABELS, type ClusterKey } from "@/lib/nss/clusters";
import { favorabilityToTeal, heatmapDisplayNames, heatmapLegendGradientCss, type TeamMemberScore } from "@/lib/nss/teamScores";

const LABEL_COLUMN = "10rem";
const MIN_MEMBER_COLUMN = "2.75rem";

function byFirstThenLastName(a: TeamMemberScore, b: TeamMemberScore): number {
  const firstCmp = a.firstName.localeCompare(b.firstName);
  if (firstCmp !== 0) return firstCmp;
  return a.lastName.localeCompare(b.lastName);
}

export default function TeamNeedsHeatmap({
  members,
  rowOrder,
}: {
  members: TeamMemberScore[];
  rowOrder: ClusterKey[];
}) {
  // Alphabetical by first name, last name as the tiebreaker — independent
  // of whatever order the caller's data happened to arrive in.
  const sortedMembers = [...members].sort(byFirstThenLastName);
  const displayNames = heatmapDisplayNames(sortedMembers);

  // Pure visual hover cue (no click, no tooltip, no stored selection) —
  // highlights the hovered cell's row label and column header so a
  // presenter can trace a pattern across a row or down a column without
  // the chart requiring interaction to tell its story.
  const [hovered, setHovered] = useState<{ userId: string; cluster: ClusterKey } | null>(null);

  const gridTemplateColumns = `${LABEL_COLUMN} repeat(${sortedMembers.length}, minmax(${MIN_MEMBER_COLUMN}, 1fr))`;

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-border/50">
        <div role="table" className="grid" style={{ gridTemplateColumns }} onMouseLeave={() => setHovered(null)}>
          <div role="row" className="contents">
            <div role="columnheader" className="sticky left-0 z-10 bg-card" />
            {sortedMembers.map((m) => (
              <div
                key={m.userId}
                role="columnheader"
                className={`p-2 text-xs font-semibold text-center whitespace-nowrap transition-colors ${
                  hovered?.userId === m.userId ? "text-foreground bg-secondary/60" : "text-muted-foreground"
                }`}
              >
                {displayNames[m.userId]}
              </div>
            ))}
          </div>
          {rowOrder.map((cluster) => (
            <div role="row" className="contents" key={cluster}>
              <div
                role="rowheader"
                className={`sticky left-0 z-10 bg-card p-2 pr-4 text-left text-xs font-medium whitespace-nowrap border-t border-border/30 flex items-center transition-colors ${
                  hovered?.cluster === cluster ? "text-foreground bg-secondary/60" : "text-foreground"
                }`}
              >
                {CLUSTER_LABELS[cluster]}
              </div>
              {sortedMembers.map((m) => {
                const value = m.favorability[cluster];
                return (
                  <div key={m.userId} role="cell" className="p-1.5 border-t border-border/30 flex items-center justify-center">
                    <div
                      aria-label={`${m.fullName} — ${CLUSTER_LABELS[cluster]}`}
                      onMouseEnter={() => setHovered({ userId: m.userId, cluster })}
                      style={{ backgroundColor: favorabilityToTeal(value) }}
                      className="w-full h-10 rounded-md border border-border/40"
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2.5 max-w-md mx-auto">
        <div className="h-2.5 rounded-full" style={{ background: heatmapLegendGradientCss() }} />
        <div className="flex items-center justify-between mt-1.5 text-sm text-muted-foreground">
          <span>Less favored</span>
          <span>More favored</span>
        </div>
      </div>
    </div>
  );
}
