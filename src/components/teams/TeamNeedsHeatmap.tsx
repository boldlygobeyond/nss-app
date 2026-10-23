"use client";

import { useCallback, useRef, useState } from "react";
import { CLUSTER_LABELS, type ClusterKey } from "@/lib/nss/clusters";
import {
  describeFavorability,
  favorabilityToTeal,
  heatmapDisplayNames,
  heatmapLegendGradientCss,
  type TeamMemberScore,
} from "@/lib/nss/teamScores";
import { useDismissOnOutsideOrEscape } from "@/lib/hooks/useDismissOnOutsideOrEscape";
import SnapshotDetailPanel from "./SnapshotDetailPanel";

interface Selected {
  member: TeamMemberScore;
  cluster: ClusterKey;
}

export default function TeamNeedsHeatmap({
  members,
  rowOrder,
}: {
  members: TeamMemberScore[];
  rowOrder: ClusterKey[];
}) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const displayNames = heatmapDisplayNames(members);
  const containerRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => setSelected(null), []);
  useDismissOnOutsideOrEscape(containerRef, selected !== null, dismiss);

  return (
    <div ref={containerRef} className="flex flex-col lg:flex-row gap-4 items-start">
      <div className="flex-1 min-w-0">
        <div className="overflow-x-auto rounded-xl border border-border/50">
          <table className="border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card p-3" />
                {members.map((m) => (
                  <th
                    key={m.userId}
                    className="p-2 text-xs font-semibold text-muted-foreground whitespace-nowrap text-center"
                  >
                    {displayNames[m.userId]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowOrder.map((cluster) => (
                <tr key={cluster} className="border-t border-border/30">
                  <th className="sticky left-0 z-10 bg-card p-2 pr-4 text-left text-xs font-medium text-foreground whitespace-nowrap">
                    {CLUSTER_LABELS[cluster]}
                  </th>
                  {members.map((m) => {
                    const value = m.favorability[cluster];
                    const isSelected = selected?.member.userId === m.userId && selected.cluster === cluster;
                    return (
                      <td key={m.userId} className="p-1.5">
                        <button
                          type="button"
                          onClick={() => setSelected(isSelected ? null : { member: m, cluster })}
                          title={`${m.fullName} — ${CLUSTER_LABELS[cluster]}`}
                          aria-label={`${m.fullName}, ${CLUSTER_LABELS[cluster]}: ${describeFavorability(value, m.firstName)}`}
                          style={{ backgroundColor: favorabilityToTeal(value) }}
                          className={`block w-12 h-10 sm:w-16 sm:h-12 rounded-md border transition-shadow ${
                            isSelected
                              ? "border-primary ring-2 ring-primary"
                              : "border-border/40 hover:ring-2 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-primary"
                          }`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-2.5 flex-wrap gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Lower relative priority</span>
            <span
              className="inline-block w-20 h-2.5 rounded-full"
              style={{ background: heatmapLegendGradientCss() }}
            />
            <span>Higher relative priority</span>
          </div>
        </div>
      </div>

      <SnapshotDetailPanel
        name={selected?.member.fullName ?? null}
        cluster={selected ? CLUSTER_LABELS[selected.cluster] : null}
        description={
          selected ? describeFavorability(selected.member.favorability[selected.cluster], selected.member.firstName) : null
        }
      />
    </div>
  );
}
