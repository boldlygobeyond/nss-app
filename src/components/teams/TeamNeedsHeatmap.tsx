"use client";

import { useState } from "react";
import { CLUSTER_LABELS, type ClusterKey } from "@/lib/nss/clusters";
import {
  describeFavorability,
  favorabilityToTeal,
  heatmapDisplayNames,
  type TeamMemberScore,
} from "@/lib/nss/teamScores";

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

  return (
    <div>
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
                        onClick={() => setSelected({ member: m, cluster })}
                        title={`${m.fullName} — ${CLUSTER_LABELS[cluster]}`}
                        aria-label={`${m.fullName}, ${CLUSTER_LABELS[cluster]}: ${describeFavorability(value, m.firstName)}`}
                        style={{ backgroundColor: favorabilityToTeal(value) }}
                        className={`block w-11 h-9 sm:w-14 sm:h-11 rounded-md border transition-shadow ${
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

      <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Lower relative priority</span>
          <span
            className="inline-block w-20 h-2.5 rounded-full"
            style={{ background: `linear-gradient(to right, ${favorabilityToTeal(0.1)}, ${favorabilityToTeal(0.9)})` }}
          />
          <span>Higher relative priority</span>
        </div>
      </div>

      <div className="mt-3 min-h-[2.5rem] rounded-lg bg-secondary/60 px-3 py-2 text-sm text-foreground">
        {selected ? (
          <>
            <span className="font-medium">{selected.member.fullName}</span>
            {" — "}
            <span>{CLUSTER_LABELS[selected.cluster]}</span>
            <span className="text-muted-foreground">
              {" · "}
              {describeFavorability(selected.member.favorability[selected.cluster], selected.member.firstName)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Click or tap any cell to see what it means.</span>
        )}
      </div>
    </div>
  );
}
